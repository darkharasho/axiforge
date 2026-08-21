"use strict";
// Team sync engine (replaces the GitHub-org SharedLibrary). See
// docs/superpowers/specs/2026-08-21-team-sync-design.md §2.
//
// Invariants:
//   * A local change to a team item is persisted to the outbox BEFORE the IPC
//     handler that made it returns (callers await enqueue()).
//   * Outbox entries are never dropped on transient failure; only on success,
//     403/413 (with a user-visible error), or explicit conflict resolution.
//   * Pull never overwrites an item that has a pending outbox entry.

const { SyncApi } = require("./syncApi");

const POLL_INTERVAL_MS = 30_000;
const FOCUS_COOLDOWN_MS = 10_000;
const FLUSH_DEBOUNCE_MS = 1_000;
const FLUSH_MAX_DELAY_MS = 5_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const PAGE_SIZE = 200;
const FAILURES_BEFORE_TOAST = 3;

const BUILD_LOCAL_FIELDS = ["folderId", "pinned", "sortOrder", "compIds"];
const COMP_LOCAL_FIELDS = ["folderId", "sortOrder", "boonCoverageHtml"];

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

class TeamSync {
  constructor({ buildStore, compStore, folderStore, syncStore, historyStore, api, emit, now, setTimeoutImpl, clearTimeoutImpl } = {}) {
    this.buildStore = buildStore;
    this.compStore = compStore;
    this.folderStore = folderStore;
    this.syncStore = syncStore;
    this.historyStore = historyStore || null;
    this.api = api || new SyncApi({ getToken: async () => (await this.getSession())?.sessionToken || null });
    this._emit = typeof emit === "function" ? emit : () => {};
    this._now = now || Date.now;
    this._setTimeout = setTimeoutImpl || setTimeout;
    this._clearTimeout = clearTimeoutImpl || clearTimeout;
    this._flushTimers = new Map();   // teamId → { id, scheduledAt }
    this._inflight = new Map();      // teamId → Promise (flush)
    this._pullInProgress = new Set();
    this._pollTimer = null;
    this._lastFocusPullAt = 0;
    this._stopped = false;
  }

  // ─── Session ────────────────────────────────────────────────────────────────

  async getSession() {
    const auth = await this.buildStore.getAuth();
    const s = auth && auth.sync;
    if (!s || !s.sessionToken) return null;
    return { sessionToken: s.sessionToken, userId: s.userId, login: s.login };
  }

  async enableWithGithub(githubToken) {
    const { sessionToken, user } = await this.api.loginGithub(githubToken);
    const auth = await this.buildStore.getAuth();
    await this.buildStore.saveAuth({ ...auth, sync: { sessionToken, userId: user.id, login: user.login } });
    return user;
  }

  async disable() {
    this.stopPolling();
    try { await this.api.logout(); } catch { /* best effort — the session expires on its own */ }
    const auth = await this.buildStore.getAuth();
    const next = { ...auth };
    delete next.sync;
    await this.buildStore.saveAuth(next);
  }

  // Called on SYNC_UNAUTHORIZED: forget the session but keep outbox + cursors so
  // a re-login resumes where we left off.
  async _handleUnauthorized() {
    this.stopPolling();
    const auth = await this.buildStore.getAuth();
    if (auth && auth.sync) {
      const next = { ...auth };
      delete next.sync;
      await this.buildStore.saveAuth(next);
    }
    this._emit("sync-status", { status: "error", error: "auth" });
  }

  // ─── Teams ↔ root folders ───────────────────────────────────────────────────

  teamRootFor(folderId, folders) {
    let current = folderId ? folders.find((f) => f.id === folderId) : null;
    while (current) {
      if (current.teamId) return current;
      if (!current.parentId) return null;
      current = folders.find((f) => f.id === current.parentId);
    }
    return null;
  }

  rootFolderForTeam(teamId, folders) {
    return folders.find((f) => f.teamId === teamId) || null;
  }

  parentIdFor(folderId, rootId) {
    return folderId && folderId !== rootId ? folderId : null;
  }

  async _ensureRootFolder(team, role) {
    const folders = await this.folderStore.listFolders();
    const existing = this.rootFolderForTeam(team.id, folders) || folders.find((f) => f.id === team.id);
    if (existing && existing.parentId) {
      // A migrated/old folder that is nested cannot be a team root — re-root it.
      await this.folderStore.upsertFolder({ id: existing.id, name: team.name, parentId: null, shared: true, teamId: team.id, role });
      return existing.id;
    }
    await this.folderStore.upsertFolder({
      id: existing ? existing.id : team.id, name: team.name, parentId: null,
      sortOrder: existing ? existing.sortOrder : 0, shared: true, teamId: team.id, role,
    });
    return existing ? existing.id : team.id;
  }

  // Root folder becomes a personal folder; its contents stay on disk.
  async _detachTeam(teamId) {
    const timer = this._flushTimers.get(teamId);
    if (timer) { this._clearTimeout(timer.id); this._flushTimers.delete(teamId); }
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (root) {
      await this.folderStore.upsertFolder({ id: root.id, name: root.name, parentId: null, shared: false, teamId: null, role: null, orgName: undefined, lastSyncedAt: undefined });
      this._emit("sync-status", { status: "detached", folderId: root.id });
    }
    await this.syncStore.removeTeam(teamId);
  }

  async createTeam(name) {
    const out = await this.api.createTeam(name);
    await this._ensureRootFolder(out.team, out.role);
    return out;
  }

  async joinTeam(inviteCode) {
    const out = await this.api.joinTeam(inviteCode);
    await this._ensureRootFolder(out.team, out.role);
    await this.pullTeam(out.team.id);
    return out;
  }

  async listTeams() {
    let list;
    try {
      list = await this.api.listTeams();
    } catch (err) {
      if (err.code === "SYNC_UNAUTHORIZED") await this._handleUnauthorized();
      throw err;
    }
    const seen = new Set();
    for (const { team, role } of list) {
      seen.add(team.id);
      await this._ensureRootFolder(team, role);
    }
    const folders = await this.folderStore.listFolders();
    for (const f of folders) {
      if (f.teamId && !seen.has(f.teamId)) await this._detachTeam(f.teamId);
    }
    return list;
  }

  async leaveTeam(teamId) {
    const session = await this.getSession();
    if (!session) throw new Error("Team sync is not enabled.");
    await this.api.removeMember(teamId, session.userId);
    await this._detachTeam(teamId);
  }

  async deleteTeam(teamId) {
    await this.api.deleteTeam(teamId);
    await this._detachTeam(teamId);
  }

  async renameTeam(teamId, name) {
    const out = await this.api.renameTeam(teamId, name);
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (root) await this.folderStore.upsertFolder({ id: root.id, name: out.team.name, parentId: null, shared: true, teamId, role: root.role });
    return out;
  }

  listMembers(teamId) { return this.api.listMembers(teamId); }
  removeMember(teamId, userId) { return this.api.removeMember(teamId, userId); }
  rotateInvite(teamId) { return this.api.rotateInvite(teamId); }

  // ─── Bodies ─────────────────────────────────────────────────────────────────

  static buildBody(build) { return omit(build, BUILD_LOCAL_FIELDS); }
  static compBody(comp) { return omit(comp, COMP_LOCAL_FIELDS); }
  static folderBody(folder) { return { name: folder.name, sortOrder: folder.sortOrder || 0 }; }

  // ─── Outbox ─────────────────────────────────────────────────────────────────

  async enqueue(teamId, itemId, type, op) {
    await this.syncStore.enqueue(teamId, itemId, { type, op });
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    const folderId = root ? root.id : teamId;
    this._emit("sync-status", { status: "syncing", folderId });
    if (type !== "folder") this._emit("sync-status", { status: "syncing", type, id: itemId, folderId });
    this.scheduleFlush(teamId);
  }

  // Debounce per team: reset on each call, but never push the deadline past
  // FLUSH_MAX_DELAY_MS from the first call (continuous edits still sync).
  scheduleFlush(teamId, delayMs = FLUSH_DEBOUNCE_MS) {
    const existing = this._flushTimers.get(teamId);
    const now = this._now();
    let firstScheduledAt = now;
    if (existing) {
      firstScheduledAt = existing.firstScheduledAt;
      if (now - firstScheduledAt >= FLUSH_MAX_DELAY_MS - delayMs) return; // let it fire
      this._clearTimeout(existing.id);
    }
    const id = this._setTimeout(async () => {
      this._flushTimers.delete(teamId);
      await this.flushTeam(teamId).catch((err) => console.error("[team-sync] flush failed:", err.message));
    }, delayMs);
    this._flushTimers.set(teamId, { id, firstScheduledAt });
  }

  flushTeam(teamId) {
    if (this._inflight.has(teamId)) return this._inflight.get(teamId);
    const p = this._flushTeamInner(teamId).finally(() => this._inflight.delete(teamId));
    this._inflight.set(teamId, p);
    return p;
  }

  async flushAll() {
    for (const teamId of await this.syncStore.listTeamIds()) {
      await this.flushTeam(teamId).catch(() => {});
    }
  }

  async _flushTeamInner(teamId) {
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    const nowMs = this._now();
    const entries = (await this.syncStore.listOutbox(teamId))
      .filter((e) => !e.conflict && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= nowMs));
    for (const entry of entries) {
      if (!root) { await this.syncStore.dequeue(teamId, entry.itemId); continue; } // team detached
      const stop = await this._flushEntry(teamId, root, entry, session);
      if (stop) return;
    }
    if (root && !(await this.syncStore.listOutbox(teamId)).length) {
      this._emit("sync-status", { status: "synced", folderId: root.id });
    }
  }

  async _loadLocal(type, itemId) {
    if (type === "build") return (await this.buildStore.listBuilds()).find((b) => b.id === itemId) || null;
    if (type === "comp") return (await this.compStore.listComps()).find((c) => c.id === itemId) || null;
    if (type === "folder") return (await this.folderStore.listFolders()).find((f) => f.id === itemId) || null;
    return null;
  }

  _payloadFor(type, local, root) {
    if (type === "build") return { body: TeamSync.buildBody(local), parentId: this.parentIdFor(local.folderId, root.id) };
    if (type === "comp") return { body: TeamSync.compBody(local), parentId: this.parentIdFor(local.folderId, root.id) };
    return { body: TeamSync.folderBody(local), parentId: this.parentIdFor(local.parentId, root.id) };
  }

  // Returns true if the flush loop must stop (auth lost).
  async _flushEntry(teamId, root, entry, session) {
    const { itemId, type, op } = entry;
    const known = await this.syncStore.getVersion(teamId, itemId);
    const baseVersion = known ? known.version : null;
    const title = async () => { const l = await this._loadLocal(type, itemId); return (l && (l.title || l.name)) || itemId; };
    try {
      if (op === "put") {
        const local = await this._loadLocal(type, itemId);
        if (!local) { await this.syncStore.dequeue(teamId, itemId); return false; }
        const { body, parentId } = this._payloadFor(type, local, root);
        const res = await this.api.putItem(teamId, itemId, { type, parentId, body, baseVersion });
        await this.syncStore.setVersion(teamId, itemId, { version: res.version, createdBy: known ? known.createdBy : session.userId });
        await this.syncStore.dequeue(teamId, itemId);
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id, item: local });
      } else {
        if (baseVersion === null) { await this.syncStore.dequeue(teamId, itemId); return false; } // never reached the server
        try {
          await this.api.deleteItem(teamId, itemId, baseVersion);
        } catch (err) {
          if (err.code !== "SYNC_NOT_FOUND") throw err; // already gone = success
        }
        await this.syncStore.removeVersion(teamId, itemId);
        await this.syncStore.dequeue(teamId, itemId);
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id });
      }
      return false;
    } catch (err) {
      const code = err && err.code;
      if (code === "SYNC_CONFLICT") {
        await this.syncStore.patchOutbox(teamId, itemId, { conflict: err.current || { deleted: true } });
        this._emit("sync-conflict", { teamId, itemId, type, title: await title(), current: err.current || null });
        if (type !== "folder") this._emit("sync-status", { status: "conflict", type, id: itemId, folderId: root.id });
        return false;
      }
      if (code === "SYNC_FORBIDDEN" || code === "SYNC_TOO_LARGE" || code === "SYNC_INVALID") {
        await this.syncStore.dequeue(teamId, itemId);
        const error = code === "SYNC_FORBIDDEN" ? "forbidden" : code === "SYNC_TOO_LARGE" ? "too_large" : "invalid";
        this._emit("sync-status", { status: "error", type, id: itemId, folderId: root.id, error, message: err.message });
        if (code === "SYNC_FORBIDDEN") this.pullTeam(teamId).catch(() => {}); // restore server state locally
        return false;
      }
      if (code === "SYNC_UNAUTHORIZED") {
        await this._handleUnauthorized();
        return true;
      }
      // SYNC_OFFLINE / SYNC_RATE_LIMITED / unknown: keep and back off
      const attempts = (entry.attempts || 0) + 1;
      const delay = err.retryAfterMs || Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
      await this.syncStore.patchOutbox(teamId, itemId, { attempts, nextAttemptAt: new Date(this._now() + delay).toISOString() });
      if (type !== "folder") this._emit("sync-status", { status: "pending", type, id: itemId, folderId: root.id });
      this._emit("sync-status", { status: "pending", folderId: root.id });
      return false;
    }
  }

  // ─── Placeholders completed in later tasks ──────────────────────────────────
  async pullTeam(teamId) { await this.api.changes(teamId, 0, PAGE_SIZE); } // replaced in Task 6
  stopPolling() {
    if (this._pollTimer) { this._clearTimeout(this._pollTimer); this._pollTimer = null; }
  }
}

module.exports = {
  TeamSync,
  POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS,
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, PAGE_SIZE, FAILURES_BEFORE_TOAST,
};
