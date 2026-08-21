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
