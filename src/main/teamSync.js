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
    this._flushAgain = new Set();    // teamId → another flush was requested while one was in flight
    this._pullInProgress = new Set();
    this._pullAllInflight = null; // R6.1: pullAll() re-entrancy guard
    this._pollTimer = null;
    this._lastFocusPullAt = 0;
    this._stopped = false;
  }

  // Promise wrapper around this._setTimeout, so rate-limit backoffs in
  // shareFolderToTeam() drive off the same fake-timer plumbing tests use.
  _wait(ms) {
    return new Promise((resolve) => this._setTimeout(resolve, ms));
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
    const visited = new Set();
    while (current) {
      if (visited.has(current.id)) return null; // cyclic parentId chain — no team root here
      visited.add(current.id);
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
    // Skip the upsert (and its updatedAt bump) when nothing actually changed —
    // pullAll/listTeams run on every poll tick and would otherwise touch every
    // root folder every 30s.
    const unchanged = existing && existing.name === team.name && existing.role === role && existing.teamId === team.id;
    if (!unchanged) {
      await this.folderStore.upsertFolder({
        id: existing ? existing.id : team.id, name: team.name, parentId: null,
        sortOrder: existing ? existing.sortOrder : 0, shared: true, teamId: team.id, role,
      });
    }
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
      // No actor identity is available here: a detach is inferred from the team
      // disappearing from listTeams (or from the user leaving/deleting it), not
      // from a tombstone that would carry an `updated_by` login. The folder name
      // is what the renderer needs to name the folder in its toast.
      this._emit("sync-status", { status: "detached", folderId: root.id, name: root.name });
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

  // If a flush is already in flight for this team, record that another pass
  // is wanted and return the SAME promise — it resolves only once the
  // in-flight pass AND the follow-up pass it triggers have both completed, so
  // callers that enqueue mid-flush and then await flushTeam() see their item
  // actually sent, not just "a" flush finishing.
  flushTeam(teamId) {
    if (this._inflight.has(teamId)) {
      this._flushAgain.add(teamId);
      return this._inflight.get(teamId);
    }
    const run = async () => {
      do {
        await this._flushTeamInner(teamId);
      } while (this._flushAgain.delete(teamId));
    };
    const p = run().finally(() => this._inflight.delete(teamId));
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
    // R6.2: FORBIDDEN/NOT_FOUND entries request a repull via `needsRepull`
    // instead of each doing its own listTeams()+pullTeam() inline — N such
    // entries in one flush would otherwise serialize N full pulls.
    let needsRepull = false;
    for (const entry of entries) {
      if (!root) { await this.syncStore.dequeue(teamId, entry.itemId, { queuedAt: entry.queuedAt }); continue; } // team detached
      const result = await this._flushEntry(teamId, root, entry, session);
      if (result.needsRepull) needsRepull = true;
      if (result.stop) return;
    }
    if (needsRepull) {
      try { await this.listTeams(); } catch (err2) { console.warn("[team-sync] reconcile after forbidden/not-found failed:", err2.message); }
      // C2: a rejected write produced NO new seq, so an incremental pull from
      // the stored cursor returns nothing and the local mutation the IPC
      // handler already applied would diverge from the server forever. Pull
      // the whole team from 0 instead so every rejected change is repaired.
      await this._fullRepull(teamId).catch((err3) => console.warn("[team-sync] repair pull failed:", err3.message));
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
    const { itemId, type, op, queuedAt } = entry;
    const known = await this.syncStore.getVersion(teamId, itemId);
    const baseVersion = known ? known.version : null;
    const title = async () => { const l = await this._loadLocal(type, itemId); return (l && (l.title || l.name)) || itemId; };
    try {
      if (op === "put") {
        const local = await this._loadLocal(type, itemId);
        if (!local) { await this.syncStore.dequeue(teamId, itemId, { queuedAt }); return { stop: false, needsRepull: false }; }
        const { body, parentId } = this._payloadFor(type, local, root);
        const res = await this.api.putItem(teamId, itemId, { type, parentId, body, baseVersion });
        // The server write really happened — record the new version even if a
        // fresher enqueue (different queuedAt) has since replaced this entry;
        // that fresh entry will be flushed next with the updated baseVersion.
        await this.syncStore.setVersion(teamId, itemId, { version: res.version, createdBy: known ? known.createdBy : session.userId });
        await this.syncStore.dequeue(teamId, itemId, { queuedAt });
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id, item: local });
      } else {
        if (baseVersion === null) { await this.syncStore.dequeue(teamId, itemId, { queuedAt }); return { stop: false, needsRepull: false }; } // never reached the server
        try {
          await this.api.deleteItem(teamId, itemId, baseVersion);
        } catch (err) {
          if (err.code !== "SYNC_NOT_FOUND") throw err; // already gone = success
        }
        await this.syncStore.removeVersion(teamId, itemId);
        await this.syncStore.dequeue(teamId, itemId, { queuedAt });
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id });
      }
      return { stop: false, needsRepull: false };
    } catch (err) {
      const code = err && err.code;
      if (code === "SYNC_CONFLICT") {
        await this.syncStore.patchOutbox(teamId, itemId, { conflict: err.current || { deleted: true } }, { queuedAt });
        this._emit("sync-conflict", { teamId, itemId, type, title: await title(), current: err.current || null });
        if (type !== "folder") this._emit("sync-status", { status: "conflict", type, id: itemId, folderId: root.id });
        return { stop: false, needsRepull: false };
      }
      // FORBIDDEN and NOT_FOUND both mean "the server doesn't recognize this
      // write" (removed from the team, or the item/team no longer exists) —
      // handle them identically: drop the entry, surface a per-item error,
      // and ask the caller (_flushTeamInner) to reconcile team membership
      // and re-pull ONCE after the whole flush, not once per entry (R6.2).
      if (code === "SYNC_FORBIDDEN" || code === "SYNC_NOT_FOUND") {
        const dequeued = await this.syncStore.dequeue(teamId, itemId, { queuedAt });
        // C2: drop the recorded version too, so the full re-pull that follows
        // re-applies the server's copy instead of skipping it as an echo of a
        // write that never actually landed. Only when the entry we flushed is
        // still the current one — a fresher enqueue must keep its baseVersion.
        if (dequeued) await this.syncStore.removeVersion(teamId, itemId);
        const error = code === "SYNC_FORBIDDEN" ? "forbidden" : "not_found";
        this._emit("sync-status", { status: "error", type, id: itemId, folderId: root.id, error, message: err.message });
        return { stop: false, needsRepull: true };
      }
      if (code === "SYNC_TOO_LARGE" || code === "SYNC_INVALID") {
        await this.syncStore.dequeue(teamId, itemId, { queuedAt });
        const error = code === "SYNC_TOO_LARGE" ? "too_large" : "invalid";
        this._emit("sync-status", { status: "error", type, id: itemId, folderId: root.id, error, message: err.message });
        return { stop: false, needsRepull: false };
      }
      if (code === "SYNC_UNAUTHORIZED") {
        await this._handleUnauthorized();
        return { stop: true, needsRepull: false };
      }
      // SYNC_OFFLINE / SYNC_RATE_LIMITED / unknown: keep and back off
      const attempts = (entry.attempts || 0) + 1;
      const delay = err.retryAfterMs || Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
      await this.syncStore.patchOutbox(teamId, itemId, { attempts, nextAttemptAt: new Date(this._now() + delay).toISOString() }, { queuedAt });
      if (type !== "folder") this._emit("sync-status", { status: "pending", type, id: itemId, folderId: root.id });
      this._emit("sync-status", { status: "pending", folderId: root.id });
      return { stop: false, needsRepull: false };
    }
  }

  // ─── Pull ───────────────────────────────────────────────────────────────────

  pullTeam(teamId) {
    const key = `pull:${teamId}`;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = this._pullTeamInner(teamId).finally(() => this._inflight.delete(key));
    this._inflight.set(key, p);
    return p;
  }

  // C2: replay the team's whole change log from seq 0. Used after a write the
  // server rejected (403/404), where an incremental pull would return nothing.
  // Because `since === 0` the server never sets `resync`, so `_pruneUnseen`
  // does NOT run — pending local-only work must survive this.
  async _fullRepull(teamId) {
    const key = `pull:${teamId}`;
    // A poll's incremental pull may already be in flight (pulls and flushes
    // de-dupe on different keys). Let it finish first, otherwise it would
    // overwrite our cursor reset with its own nextSeq and no from-0 pull would
    // ever happen. Loop: another pull may have been started while we waited.
    for (;;) {
      const inflight = this._inflight.get(key);
      if (!inflight) break;
      await inflight.catch(() => {});
    }
    // Claim the pull slot synchronously (no await between the loop exiting and
    // the set), so a poll tick that fires between our cursor reset and our
    // from-0 pull joins this promise instead of racing it with a stale cursor.
    const p = (async () => {
      await this.syncStore.setCursor(teamId, 0);
      await this._pullTeamInner(teamId);
    })().finally(() => this._inflight.delete(key));
    this._inflight.set(key, p);
    return p;
  }

  async _pullTeamInner(teamId) {
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) return;
    let { cursor } = await this.syncStore.getTeam(teamId);
    // Set once the server tells us our cursor predates a tombstone purge
    // (R1 / spec §2.4). While set, every item id we see is recorded so that,
    // once the full re-pull from 0 completes, anything NOT seen can be
    // pruned locally (it was purged from the server's change log).
    let resyncSeen = null;
    for (;;) {
      let page;
      try {
        page = await this.api.changes(teamId, cursor, PAGE_SIZE);
      } catch (err) {
        if (err.code === "SYNC_UNAUTHORIZED") { await this._handleUnauthorized(); }
        throw err;
      }
      if (page.resync && resyncSeen === null) {
        resyncSeen = new Set();
        cursor = 0;
        continue;
      }
      // I1: if applying an item throws we must NOT persist a cursor past it —
      // that would lose the change forever. Stop at the first failure, park the
      // cursor just before it, and throw so pullAll()'s failure counting (and
      // the 3-strike `pull-error` toast) surfaces the problem. The next poll
      // replays from that item; everything before it was already applied and
      // re-applying is idempotent.
      let failed = null;
      for (const item of page.items) {
        if (resyncSeen) resyncSeen.add(item.id);
        this._emit("sync-status", { status: "syncing", type: item.type, id: item.id, folderId: root.id });
        try {
          await this._applyItem(teamId, root, item, session);
        } catch (err) {
          console.error(`[team-sync] apply ${item.type} ${item.id} failed:`, err.message);
          failed = item;
          break;
        }
      }
      if (failed) {
        const before = Number.isInteger(failed.seq) ? failed.seq - 1 : cursor;
        await this.syncStore.setCursor(teamId, before);
        throw new Error(`PULL_APPLY_FAILED:${failed.type}:${failed.id}`);
      }
      cursor = page.nextSeq;
      await this.syncStore.setCursor(teamId, cursor);
      if (!page.hasMore) break;
    }
    if (resyncSeen) await this._pruneUnseen(teamId, root, resyncSeen);
    await this.folderStore.upsertFolder({ id: root.id, name: root.name, parentId: null, shared: true, teamId, role: root.role, lastSyncedAt: new Date(this._now()).toISOString() });
    this._emit("sync-status", { status: "synced", folderId: root.id });
  }

  // Delete an item from every local store it can appear in, mirroring a
  // server-side tombstone. Shared by `_applyItem` (real tombstones) and
  // `_pruneUnseen` (resync — items no longer present on the server).
  async _applyTombstone(teamId, root, type, id) {
    if (type === "build") {
      await this.buildStore.deleteBuild(id);
      await this.compStore.removeBuildFromComps(id);
      if (this.historyStore) this.historyStore.deleteHistory(id).catch(() => {});
    } else if (type === "comp") {
      await this.compStore.deleteComp(id);
      await this.buildStore.clearCompFromBuilds([id]);
    } else if (type === "folder") {
      const removed = await this.folderStore.deleteFolder(id);
      if (removed.length) await this.buildStore.clearFolderFromBuilds(removed);
    }
    await this.syncStore.removeVersion(teamId, id);
    this._emit("sync-status", { status: "synced", type, id, folderId: root.id, removed: true });
  }

  // R1: after a full resync re-pull from 0, drop anything under the team
  // root that the server no longer has and that isn't awaiting an outbox
  // flush (a pending local write is left alone — the flush will 409/resolve
  // it against the server's current state).
  //
  // Known gap: an item whose outbox entry was DROPPED by a 413/403 (spec §5
  // says it should stay on disk as local-only data) has no pending entry left,
  // so a later resync prune deletes it locally. Documented, not fixed here.
  async _pruneUnseen(teamId, root, seenIds) {
    const team = await this.syncStore.getTeam(teamId);
    const folders = await this.folderStore.listFolders();
    const teamFolderIds = new Set(
      folders.filter((f) => f.id === root.id || (this.teamRootFor(f.id, folders) || {}).id === root.id).map((f) => f.id),
    );
    const builds = await this.buildStore.listBuilds();
    const comps = await this.compStore.listComps();
    const candidates = [
      ...comps.filter((c) => teamFolderIds.has(c.folderId)).map((c) => ({ type: "comp", id: c.id })),
      ...builds.filter((b) => teamFolderIds.has(b.folderId)).map((b) => ({ type: "build", id: b.id })),
      ...folders.filter((f) => teamFolderIds.has(f.id) && f.id !== root.id).map((f) => ({ type: "folder", id: f.id })),
    ];
    for (const { type, id } of candidates) {
      if (seenIds.has(id) || team.outbox[id]) continue;
      await this._applyTombstone(teamId, root, type, id);
    }
  }

  async _applyItem(teamId, root, item, session) {
    const known = await this.syncStore.getVersion(teamId, item.id);
    // Our own write echoed back — but only if the item is actually still here.
    // C2: after a rejected local mutation (403/404) the item can be MISSING
    // locally while its version is still known (e.g. the descendants of a
    // folder delete the server refused); the re-pull must restore those, so a
    // version match alone is not enough to skip.
    if (known && known.version === item.version && (await this._loadLocal(item.type, item.id))) return;
    const team = await this.syncStore.getTeam(teamId);
    if (team.outbox[item.id]) return;                                     // local change pending — flush decides
    const createdBy = item.createdBy ? item.createdBy.userId : null;
    const author = (item.updatedBy && item.updatedBy.login) || "teammate";
    const folderId = item.parentId || root.id;

    if (item.deleted) {
      await this._applyTombstone(teamId, root, item.type, item.id);
      return;
    }

    // R6.3: don't rely solely on the version-echo check above for history
    // attribution — an item we've never synced locally (known == null) but
    // that we ourselves authored (e.g. pushed from another device under the
    // same account) must not be recorded as a teammate's change either.
    const isOwnWrite = !!(item.updatedBy && session && item.updatedBy.userId === session.userId);

    const body = item.body || {};
    let saved = null;
    if (item.type === "folder") {
      saved = await this.folderStore.upsertFolder({ id: item.id, name: body.name, sortOrder: body.sortOrder, parentId: folderId });
    } else if (item.type === "build") {
      if (this.historyStore && !isOwnWrite) {
        const { summarizeBuildChange } = require("./buildHistoryStore");
        const existing = (await this.buildStore.listBuilds()).find((b) => b.id === item.id);
        this.historyStore.addEntry({
          buildId: item.id, authorLogin: author, source: "team-sync",
          summary: existing ? summarizeBuildChange(existing, { ...body, folderId }) : "Created",
          snapshot: existing || { ...body, id: item.id, folderId },
        }).catch((err) => console.warn("[history] team-sync addEntry failed:", err.message));
      }
      saved = await this.buildStore.upsertBuild({ ...body, id: item.id, folderId });
    } else if (item.type === "comp") {
      saved = await this.compStore.upsertComp({ ...body, id: item.id, folderId });
    }
    await this.syncStore.setVersion(teamId, item.id, { version: item.version, createdBy });
    this._emit("sync-status", { status: "synced", type: item.type, id: item.id, folderId: root.id, item: saved });
  }

  // R6.1: onFocus() can overlap a slow scheduled poll tick; without this
  // guard two concurrent pullAll() calls race on getTeam().failures /
  // setFailures (a lost update breaks the "exactly one pull-error at 3"
  // guarantee). A call made while one is already running gets the SAME
  // in-flight promise instead of starting a second pass.
  pullAll() {
    if (this._pullAllInflight) return this._pullAllInflight;
    const p = this._pullAllInner().finally(() => { this._pullAllInflight = null; });
    this._pullAllInflight = p;
    return p;
  }

  async _pullAllInner() {
    await this.flushAll();
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    for (const root of folders.filter((f) => f.teamId)) {
      const teamId = root.teamId;
      try {
        await this.pullTeam(teamId);
        await this.syncStore.setFailures(teamId, 0);
      } catch (err) {
        if (err.code === "SYNC_UNAUTHORIZED") return;
        // R2: the team is gone for us (deleted, or we were removed) — let
        // listTeams() detach the root folder locally. This isn't a transient
        // failure, so it doesn't count toward FAILURES_BEFORE_TOAST.
        if (err.code === "SYNC_FORBIDDEN" || err.code === "SYNC_NOT_FOUND") {
          try { await this.listTeams(); } catch (err2) { console.warn(`[team-sync] listTeams after ${err.code} failed:`, err2.message); }
          continue;
        }
        const failures = (await this.syncStore.getTeam(teamId)).failures + 1;
        await this.syncStore.setFailures(teamId, failures);
        console.warn(`[team-sync] pull ${teamId} failed (${failures}):`, err.message);
        if (failures === FAILURES_BEFORE_TOAST) this._emit("sync-status", { status: "error", error: "pull", folderId: root.id });
      }
    }
  }

  startPolling(intervalMs = POLL_INTERVAL_MS) {
    this.stopPolling();
    const tick = async () => {
      this._pollTimer = null;
      try { await this.pullAll(); } catch (err) { console.error("[team-sync] poll error:", err.message); }
      if (!(await this.getSession())) return; // unauthorized mid-poll: stay stopped
      this._pollTimer = this._setTimeout(tick, intervalMs);
    };
    this._pollTimer = this._setTimeout(tick, intervalMs);
  }

  async onFocus() {
    const now = this._now();
    if (now - this._lastFocusPullAt < FOCUS_COOLDOWN_MS) return;
    this._lastFocusPullAt = now;
    await this.pullAll().catch(() => {});
  }

  // Called on disable() (and directly by callers that want to fully halt
  // background sync) — also clears any pending debounced flushes and the
  // flush-again markers so nothing fires after this returns.
  stopPolling() {
    if (this._pollTimer) { this._clearTimeout(this._pollTimer); this._pollTimer = null; }
    for (const { id } of this._flushTimers.values()) this._clearTimeout(id);
    this._flushTimers.clear();
    this._flushAgain.clear();
  }

  // ─── Conflicts ──────────────────────────────────────────────────────────────

  async resolveConflict(teamId, itemId, choice) {
    const team = await this.syncStore.getTeam(teamId);
    const entry = team.outbox[itemId];
    if (!entry || !entry.conflict) return;
    const remote = entry.conflict;
    const queuedAt = entry.queuedAt;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) { await this.syncStore.dequeue(teamId, itemId, { queuedAt }); return; }
    if (choice === "theirs") {
      // Guarded: if the entry we're resolving has since been replaced by a
      // fresh enqueue (a re-edit racing this call), the dequeue is a no-op —
      // do NOT apply the stale `current` over the newer local edit. The
      // fresh entry has no conflict and will flush/conflict on its own.
      const dequeued = await this.syncStore.dequeue(teamId, itemId, { queuedAt });
      if (!dequeued) return;
      if (remote && remote.id) {
        await this.syncStore.removeVersion(teamId, itemId); // force apply even if versions matched
        await this._applyItem(teamId, root, remote, await this.getSession());
        return;
      }
      // I7: a 409 with `current: null` is stored as a bare `{ deleted: true }`
      // — there is nothing to apply, but the recorded version is now stale
      // (the server no longer has that item), so every future edit would 409
      // forever. Drop it; the local copy stays as a personal-looking copy in
      // the team folder and the next edit re-creates it with baseVersion null.
      await this.syncStore.removeVersion(teamId, itemId);
      return;
    }
    // "mine": adopt the server's version as our base and push again now.
    if (remote && !remote.deleted && remote.version) {
      await this.syncStore.setVersion(teamId, itemId, { version: remote.version, createdBy: remote.createdBy ? remote.createdBy.userId : null });
    } else {
      await this.syncStore.removeVersion(teamId, itemId); // re-create over a tombstone
    }
    const patched = await this.syncStore.patchOutbox(teamId, itemId, { conflict: null, attempts: 0, nextAttemptAt: null }, { queuedAt });
    if (!patched) return; // stale — a fresher entry replaced this one; let its own flush drive it
    await this.flushTeam(teamId);
  }

  // ─── Sharing folders ────────────────────────────────────────────────────────

  collectFolderTree(folderId, folders) {
    const out = [folderId];
    const queue = [folderId];
    while (queue.length) {
      const id = queue.shift();
      for (const f of folders) if (f.parentId === id) { out.push(f.id); queue.push(f.id); }
    }
    return out;
  }

  // Depth of every folder in `collectFolderTree(folderId, ...)` RELATIVE to
  // `folderId` (the root of the tree is 0).
  _relativeDepths(folderId, folders) {
    const depths = new Map([[folderId, 0]]);
    for (const id of this.collectFolderTree(folderId, folders)) {
      if (id === folderId) continue;
      const f = folders.find((x) => x.id === id);
      depths.set(id, (depths.get(f && f.parentId) || 0) + 1);
    }
    return depths;
  }

  // Queue a whole folder subtree for the team. "put" walks the tree (parents
  // before children, then its builds, then its comps); "delete" queues a single
  // folder delete — the server cascades to descendants.
  async enqueueFolderTree(teamId, folderId, op) {
    if (op === "delete") {
      await this.enqueue(teamId, folderId, "folder", "delete");
      return { count: 1 };
    }
    const folders = await this.folderStore.listFolders();
    const treeIds = this.collectFolderTree(folderId, folders);
    const treeSet = new Set(treeIds);
    let count = 0;
    for (const id of treeIds) { await this.enqueue(teamId, id, "folder", "put"); count += 1; }
    for (const b of (await this.buildStore.listBuilds()).filter((x) => treeSet.has(x.folderId))) {
      await this.enqueue(teamId, b.id, "build", "put"); count += 1;
    }
    for (const c of (await this.compStore.listComps()).filter((x) => treeSet.has(x.folderId))) {
      await this.enqueue(teamId, c.id, "comp", "put"); count += 1;
    }
    return { count };
  }

  async shareFolderToTeam(folderId, teamId, onProgress) {
    const session = await this.getSession();
    if (!session) throw new Error("Team sync is not enabled.");
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) throw new Error("Team not found locally.");
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found.");
    // Must be a top-level personal folder that isn't already part of a team.
    // Check "already in a team" first so a folder nested under a team root
    // reports that (more specific) reason rather than the generic
    // not-top-level one.
    if (folder.teamId || this.teamRootFor(folderId, folders)) throw new Error("SHARE_ALREADY_IN_TEAM");
    if (folder.parentId) throw new Error("SHARE_NOT_TOP_LEVEL");

    // I2: sharing re-parents this folder under the team root, so the tree gains
    // a level. folderStore rejects an upsert whose parent is already at depth 3
    // (team root = 1, shared folder = 2, its children = 3), which means a
    // grandchild of `folderId` would land at depth 4 and be silently dropped on
    // every teammate's pull. Refuse before uploading anything.
    const depths = this._relativeDepths(folderId, folders);
    for (const d of depths.values()) if (d >= 2) throw new Error("SHARE_TOO_DEEP");

    const treeIds = this.collectFolderTree(folderId, folders);
    const treeSet = new Set(treeIds);
    const builds = (await this.buildStore.listBuilds()).filter((b) => treeSet.has(b.folderId));
    const comps = (await this.compStore.listComps()).filter((c) => treeSet.has(c.folderId));

    // Folders first (parents before children — collectFolderTree is BFS), then items.
    const items = [];
    for (const id of treeIds) {
      const f = folders.find((x) => x.id === id);
      const parentId = id === folderId ? null : f.parentId;
      items.push({ itemId: id, type: "folder", parentId, body: TeamSync.folderBody(f), baseVersion: null });
    }
    for (const b of builds) items.push({ itemId: b.id, type: "build", parentId: b.folderId, body: TeamSync.buildBody(b), baseVersion: null });
    for (const c of comps) items.push({ itemId: c.id, type: "comp", parentId: c.folderId, body: TeamSync.compBody(c), baseVersion: null });

    const failed = [];
    let done = 0;
    const MAX_RATE_LIMIT_WAITS = 5;
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      // R3: the server charges bulk writes per item against a per-user
      // writes/min budget, so a large share can hit SYNC_RATE_LIMITED on a
      // later batch. Retry the SAME batch after waiting, instead of failing
      // the whole share or skipping items.
      let results;
      let waits = 0;
      for (;;) {
        try {
          ({ results } = await this.api.bulk(teamId, batch));
          break;
        } catch (err) {
          if (err && err.code === "SYNC_RATE_LIMITED" && waits < MAX_RATE_LIMIT_WAITS) {
            waits += 1;
            await this._wait(err.retryAfterMs || 60_000);
            continue;
          }
          throw err;
        }
      }
      for (const r of results) {
        if (r.status === 200 || r.status === 201) {
          await this.syncStore.setVersion(teamId, r.itemId, { version: r.version, createdBy: session.userId });
        } else if (r.status === 409 && r.current && !r.current.deleted) {
          // R3: someone else (or a retried earlier attempt) already put this
          // item in the team — treat it as uploaded so re-running the share
          // after a partial failure is idempotent instead of piling up
          // "Already exists" failures forever.
          await this.syncStore.setVersion(teamId, r.itemId, { version: r.current.version, createdBy: (r.current.createdBy && r.current.createdBy.userId) || session.userId });
        } else {
          failed.push({ itemId: r.itemId, status: r.status, message: r.message || (r.status === 409 ? "Already exists in the team." : "Rejected.") });
        }
      }
      done += batch.length;
      if (onProgress) onProgress({ done, total: items.length });
    }

    // Re-parent the folder under the team root. Its subtree keeps its structure.
    await this.folderStore.upsertFolder({ id: folderId, name: folder.name, parentId: root.id, sortOrder: folder.sortOrder });
    this._emit("sync-status", { status: "synced", folderId: root.id });
    return { uploaded: items.length - failed.length, failed };
  }

  // Owner only (enforced by the caller / server). The folder tree stays on disk
  // as personal data; teammates receive tombstones.
  async stopSharing(folderId) {
    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found.");
    const root = this.teamRootFor(folderId, folders);
    if (!root || root.id === folderId) throw new Error("Not a shared sub-folder of a team.");
    const teamId = root.teamId;
    const known = await this.syncStore.getVersion(teamId, folderId);
    if (known) {
      try {
        await this.api.deleteItem(teamId, folderId, known.version);
      } catch (err) {
        if (err.code !== "SYNC_NOT_FOUND") throw err;
      }
    }
    const treeIds = this.collectFolderTree(folderId, folders);
    const treeSet = new Set(treeIds);
    const itemIds = [
      ...treeIds,
      ...(await this.buildStore.listBuilds()).filter((b) => treeSet.has(b.folderId)).map((b) => b.id),
      ...(await this.compStore.listComps()).filter((c) => treeSet.has(c.folderId)).map((c) => c.id),
    ];
    for (const id of itemIds) {
      await this.syncStore.removeVersion(teamId, id);
      await this.syncStore.dequeue(teamId, id);
    }
    await this.folderStore.upsertFolder({ id: folderId, name: folder.name, parentId: null, sortOrder: folder.sortOrder });
    this._emit("sync-status", { status: "synced", folderId: root.id });
  }

  // Client-side mirror of the server rule, for UX (the server is the authority).
  async canDelete(teamId, itemId) {
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) return true;
    if (root.role === "owner") return true;
    const known = await this.syncStore.getVersion(teamId, itemId);
    if (!known) return true; // never synced — nothing to protect
    const session = await this.getSession();
    return !!session && known.createdBy === session.userId;
  }
}

module.exports = {
  TeamSync,
  POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS,
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, PAGE_SIZE, FAILURES_BEFORE_TOAST,
};
