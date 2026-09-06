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
const migration = require("./teamSyncMigration");
const access = require("./folderAccess");
// Hoisted out of the module object: `setGrant`'s own `access` parameter shadows
// it, so reaching through the module there silently yields undefined.
const { EVERYONE } = access;

const POLL_INTERVAL_MS = 30_000;
const FOCUS_COOLDOWN_MS = 10_000;
const FLUSH_DEBOUNCE_MS = 1_000;
const FLUSH_MAX_DELAY_MS = 5_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const PAGE_SIZE = 200;
// How many times one pull will restart its from-0 walk before giving up on the
// prune. Only an out-of-date server re-signals more than once. @see _pullTeamInner
const MAX_RESYNC_RESTARTS = 3;
const FAILURES_BEFORE_TOAST = 3;

// Archiving is a personal "get this out of my way", not a statement about the
// team's library, so the stamps stay on this machine like `pinned` does.
const ARCHIVE_FIELDS = ["archivedAt", "archiveBatchId", "archiveRoot"];
const BUILD_LOCAL_FIELDS = ["folderId", "pinned", "sortOrder", "compIds", ...ARCHIVE_FIELDS];
const COMP_LOCAL_FIELDS = ["folderId", "sortOrder", "boonCoverageHtml", ...ARCHIVE_FIELDS];

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

class TeamSync {
  constructor({ buildStore, compStore, folderStore, syncStore, historyStore, compHistoryStore, trash, api, emit, now, setTimeoutImpl, clearTimeoutImpl } = {}) {
    this.buildStore = buildStore;
    this.compStore = compStore;
    this.folderStore = folderStore;
    this.syncStore = syncStore;
    this.historyStore = historyStore || null;
    this.compHistoryStore = compHistoryStore || null;
    // Required before any tombstone can be applied — see _applyTombstone.
    this.trash = trash || null;
    this.api = api || new SyncApi({ getToken: async () => (await this.getSession())?.sessionToken || null });
    this._emit = typeof emit === "function" ? emit : () => {};
    this._now = now || Date.now;
    this._setTimeout = setTimeoutImpl || setTimeout;
    this._clearTimeout = clearTimeoutImpl || clearTimeout;
    this._flushTimers = new Map();   // teamId → { id, scheduledAt }
    this._inflight = new Map();      // teamId → Promise (flush)
    this._flushAgain = new Set();    // teamId → another flush was requested while one was in flight
    this._pullInProgress = new Set();
    this._migrationInProgress = false; // M2: listTeams() must not adopt/detach mid-migration
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
    await this.buildStore.updateAuth((auth) => ({ ...auth, sync: { sessionToken, userId: user.id, login: user.login } }));
    return user;
  }

  async disable() {
    this.stopPolling();
    try { await this.api.logout(); } catch { /* best effort — the session expires on its own */ }
    await this.buildStore.updateAuth((auth) => { delete auth.sync; return auth; });
  }

  // Called on SYNC_UNAUTHORIZED: forget the session but keep outbox + cursors so
  // a re-login resumes where we left off.
  async _handleUnauthorized() {
    this.stopPolling();
    // m4: read-modify-write inside the store's auth queue, so a concurrent
    // writer (the startup legacy cleanup) cannot put the dead token back.
    await this.buildStore.updateAuth((auth) => {
      if (!auth || !auth.sync) return undefined;
      delete auth.sync;
      return auth;
    });
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

  // `adoptById`: the caller (the legacy-library migration) explicitly chose the
  // local folder whose id equals `team.id`. Without it, an id match alone is NOT
  // permission to absorb a folder — see the comment below.
  async _ensureRootFolder(team, role, { adoptById = false } = {}) {
    const folders = await this.folderStore.listFolders();
    let existing = this.rootFolderForTeam(team.id, folders);
    const sameId = folders.find((f) => f.id === team.id) || null;
    // SECURITY (R18): team ids are client-supplied (`POST /teams { id }`, added
    // for the migration's "re-link in place"), and local folder ids leak in
    // `.axicode` exports. So "a local folder happens to have this id" is
    // attacker-choosable and must never, on its own, turn a private folder into
    // a team root. Adopt by id only when the folder is demonstrably a legacy
    // GitHub-org root (`orgName`) or the user picked it in the migration flow.
    if (!existing && sameId && (adoptById || sameId.orgName)) existing = sameId;
    // An unrelated personal folder already owns this id: leave it alone and give
    // the team root a fresh id of its own.
    const idTaken = !existing && !!sameId;

    if (existing) {
      // R17: a folder that is now a team root can't also be a GitHub-org shared
      // folder. Joiners never run the migration, so this is where their legacy
      // root loses `orgName` (and with it the orphan banner).
      if (existing.orgName) await this.folderStore.clearLegacyFields(existing.id);
      if (existing.parentId) {
        // A migrated/old folder that is nested cannot be a team root — re-root it.
        await this.folderStore.upsertFolder({ id: existing.id, name: team.name, parentId: null, shared: true, teamId: team.id, role });
        return existing.id;
      }
      // Skip the upsert (and its updatedAt bump) when nothing actually changed —
      // pullAll/listTeams run on every poll tick and would otherwise touch every
      // root folder every 30s.
      const unchanged = existing.name === team.name && existing.role === role && existing.teamId === team.id;
      if (!unchanged) {
        await this.folderStore.upsertFolder({
          id: existing.id, name: team.name, parentId: null,
          sortOrder: existing.sortOrder, shared: true, teamId: team.id, role,
        });
      }
      return existing.id;
    }

    const created = await this.folderStore.upsertFolder({
      id: idTaken ? undefined : team.id, name: team.name, parentId: null,
      sortOrder: 0, shared: true, teamId: team.id, role,
    });
    return created.id;
  }

  // Root folder becomes a personal folder; its contents stay on disk.
  async _detachTeam(teamId) {
    const timer = this._flushTimers.get(teamId);
    if (timer) { this._clearTimeout(timer.id); this._flushTimers.delete(teamId); }
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (root) {
      await this.folderStore.upsertFolder({ id: root.id, name: root.name, parentId: null, shared: false, teamId: null, role: null });
      await this.folderStore.clearLegacyFields(root.id); // R6: upsert ignores `orgName: undefined`
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
    // M2: a migration owns the local folder <-> team mapping until it finishes
    // (or rolls back). Adopting a legacy root here mid-run would strip its
    // legacy markers and strand it on a team a rollback is about to delete, and
    // detaching would fight the migration's own bookkeeping. The next poll
    // reconciles everything a few seconds later.
    if (this._migrationInProgress) return list;
    const seen = new Set();
    for (const { team, role } of list) {
      seen.add(team.id);
      await this._ensureRootFolder(team, role);
      // Seeds the grant mirror for a team joined on another machine, or on a
      // fresh install, where no resync has been asked for yet.
      if (role !== "owner" && Object.keys(await this.syncStore.getGrants(team.id)).length === 0) {
        await this._refreshGrants(team.id);
      }
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
      // The only branch here that surfaces nothing a person can read: the badge
      // says "Waiting to sync" whether this is a dropped wifi packet or the
      // server answering 500 forever, and it retries silently until it works.
      // Log the reason so a stuck item can be diagnosed from the main-process
      // log instead of guessing. Every other branch carries its message into a
      // sync-status event, so this is the one that needs it.
      console.warn(`[team-sync] ${teamId}: ${type} ${itemId} not sent (${code || "unknown"}${err && err.status ? ` ${err.status}` : ""}): ${err && err.message}; attempt ${attempts}, retrying in ${Math.round(delay / 1000)}s`);
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
    let resyncs = 0;
    for (;;) {
      let page;
      try {
        page = await this.api.changes(teamId, cursor, PAGE_SIZE, { resyncing: resyncSeen !== null });
      } catch (err) {
        if (err.code === "SYNC_UNAUTHORIZED") { await this._handleUnauthorized(); }
        throw err;
      }
      // A resync can arrive MID-WALK: the server signals it for any cursor below
      // `grants_seq`, and `grants_seq` is stamped with the team's latest seq, so
      // every page boundary of a from-0 re-pull is below it too. This used to
      // fall through to the item loop as an ordinary empty page with
      // `hasMore: false`, which ended the walk early and left `resyncSeen`
      // holding only the ids seen so far — and `_pruneUnseen` then trashed
      // everything past page one. Restart the walk instead; a walk that never
      // finishes must never prune. `resyncing` above tells an up-to-date server
      // not to re-signal at all, which is what makes this converge.
      if (page.resync) {
        if (resyncs >= MAX_RESYNC_RESTARTS) {
          // An older server that keeps re-signalling. Leave the data alone and
          // let the next pull try again — stuck is recoverable, pruned is not.
          console.warn(`[team-sync] ${teamId}: server kept asking for a resync; skipping the prune`);
          return;
        }
        resyncs += 1;
        // A resync is the only signal that this user's access changed, so it is
        // also the only moment the grant mirror can go stale. @see _refreshGrants
        await this._refreshGrants(teamId);
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

  /**
   * Apply a server-side tombstone locally — by STAGING the item in the trash,
   * exactly as a local delete does.
   *
   * This used to destroy: `buildStore.deleteBuild` filters the record straight
   * out of builds.json, and `historyStore.deleteHistory` took its entire version
   * history with it. So a delete you performed yourself was recoverable for 30
   * days while the identical delete performed by a teammate was unrecoverable
   * the instant it arrived — no trash row, no undo, no history, nothing on
   * screen to say it had happened. In a shared folder that is the delete that
   * matters most, because you did not do it and may not agree with it.
   *
   * Nothing here enqueues anything: the team has already removed the item, so
   * this is purely local catch-up. Putting it back from the trash re-pushes it
   * (see the trash:restore handler), which is the undelete.
   *
   * A folder trashes its whole subtree under one batch id rather than clearing
   * folderId off the builds inside it — the old behaviour dumped a teammate's
   * folder contents loose into your root.
   *
   * Shared by `_applyItem` (real tombstones) and `_pruneUnseen` (resync — items
   * no longer present on the server).
   *
   * @param {string} author login to attribute the deletion to in history
   */
  async _applyTombstone(teamId, root, type, id, author = "teammate") {
    if (!this.trash) {
      // Deliberately NOT falling back to the old destructive path: silently
      // hard-deleting a teammate's item because of a wiring mistake is the
      // exact failure this method exists to stop.
      throw new Error("teamSync: no trash wired — refusing to apply a tombstone destructively");
    }

    if (type === "build") {
      // Record WHO removed it before it leaves the library views, so the folder
      // history panel can show the deletion and offer it back.
      //
      // The trashed list is searched too, and that is not belt-and-braces: the
      // server cascades a folder delete into a tombstone per item and emits the
      // FOLDER first, so by the time a build's own tombstone lands the folder
      // cascade has already staged it. Reading only listBuilds() meant the one
      // delete most worth recording — a whole shared folder — recorded nothing.
      if (this.historyStore) {
        const existing = (await this.buildStore.listBuilds()).find((b) => b.id === id)
          || (await this.buildStore.listTrashedBuilds()).find((b) => b.id === id);
        if (existing) {
          await this.historyStore.addEntry({
            buildId: id, authorLogin: author, source: "team-sync",
            summary: "Deleted", snapshot: existing,
          }).catch((err) => console.warn("[history] tombstone addEntry failed:", err.message));
        }
      }
      await this.trash.trashBuilds([id]);
    } else if (type === "comp") {
      if (this.compHistoryStore) {
        const existing = (await this.compStore.listComps()).find((c) => c.id === id)
          || (await this.compStore.listTrashedComps()).find((c) => c.id === id);
        if (existing) {
          await this.compHistoryStore.addEntry({
            compId: id, authorLogin: author, source: "team-sync",
            summary: "Deleted", snapshot: existing,
          }).catch((err) => console.warn("[comp-history] tombstone addEntry failed:", err.message));
        }
      }
      await this.trash.trashComps([id]);
    } else if (type === "folder") {
      await this.trash.trashFolder(id);
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
    // Folders FIRST, so a pruned folder claims its contents into one trash
    // batch and the per-item candidates below then find them already staged and
    // skip. The other order produces a trash row per build instead of the one
    // row for the folder the user would recognise.
    const candidates = [
      ...folders.filter((f) => teamFolderIds.has(f.id) && f.id !== root.id).map((f) => ({ type: "folder", id: f.id })),
      ...comps.filter((c) => teamFolderIds.has(c.folderId)).map((c) => ({ type: "comp", id: c.id })),
      ...builds.filter((b) => teamFolderIds.has(b.folderId)).map((b) => ({ type: "build", id: b.id })),
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
      await this._applyTombstone(teamId, root, item.type, item.id, author);
      return;
    }

    // R6.3: don't rely solely on the version-echo check above for history
    // attribution — an item we've never synced locally (known == null) but
    // that we ourselves authored (e.g. pushed from another device under the
    // same account) must not be recorded as a teammate's change either.
    const isOwnWrite = !!(item.updatedBy && session && item.updatedBy.userId === session.userId);

    const body = item.body || {};
    let saved = null;
    // What actually changed, for the sync-status event below as well as history.
    // It can only be worked out HERE: `existing` is the pre-change record, and
    // the upsert a few lines down overwrites it. Null for our own writes — there
    // is nobody to attribute and nothing to announce.
    let summary = null;
    if (item.type === "folder") {
      saved = await this.folderStore.upsertFolder({ id: item.id, name: body.name, sortOrder: body.sortOrder, parentId: folderId });
    } else if (item.type === "build") {
      let existing = null;
      if (!isOwnWrite) {
        const { summarizeBuildChange } = require("./buildHistoryStore");
        existing = (await this.buildStore.listBuilds()).find((b) => b.id === item.id) || null;
        summary = existing ? summarizeBuildChange(existing, { ...body, folderId }) : "Created";
      }
      if (this.historyStore && !isOwnWrite) {
        this.historyStore.addEntry({
          buildId: item.id, authorLogin: author, source: "team-sync",
          summary,
          snapshot: existing || { ...body, id: item.id, folderId },
        }).catch((err) => console.warn("[history] team-sync addEntry failed:", err.message));
      }
      saved = await this.buildStore.upsertBuild({ ...body, id: item.id, folderId });
    } else if (item.type === "comp") {
      // Same attribution rule as builds: a teammate's restructuring of a comp is
      // exactly the change someone will want to look up later.
      if (this.compHistoryStore && !isOwnWrite) {
        const { summarizeCompChange } = require("./compHistoryStore.js");
        const existing = (await this.compStore.listComps()).find((c) => c.id === item.id);
        const builds = await this.buildStore.listBuilds();
        const titleOf = (id) => builds.find((b) => b.id === id)?.title;
        await this.compHistoryStore.addEntry({
          compId: item.id, authorLogin: author, source: "team-sync",
          summary: existing ? summarizeCompChange(existing, { ...body, folderId }, titleOf) : "Created",
          snapshot: existing || { ...body, id: item.id, folderId },
        }).catch((err) => console.warn("[comp-history] team-sync addEntry failed:", err.message));
      }
      saved = await this.compStore.upsertComp({ ...body, id: item.id, folderId });
    }
    await this.syncStore.setVersion(teamId, item.id, { version: item.version, createdBy });
    this._emit("sync-status", {
      status: "synced", type: item.type, id: item.id, folderId: root.id, item: saved,
      ...(summary ? { summary, author } : {}),
    });
  }

  /**
   * The team's shared trash: what everyone deleted, and the content to put back.
   *
   * Deliberately server-backed rather than assembled from local copies. The
   * local trash can only offer back what THIS machine happened to hold when the
   * tombstone arrived — a teammate who was offline, or who joined afterwards,
   * has nothing at all. The server kept the body, so it can answer for everyone.
   */
  async listTeamTrash(teamId) {
    const res = await this.api.listTrash(teamId);
    return (res && res.items) || [];
  }

  /**
   * Undo a team deletion for the whole team.
   *
   * The restore is an ordinary write server-side, so it reaches every client —
   * including this one — through the normal changes feed. Pulling straight
   * afterwards just means the user does not have to wait for the next poll.
   */
  async restoreFromTeamTrash(teamId, itemId) {
    const res = await this.api.restoreItem(teamId, itemId);

    // The same items are almost certainly sitting in the LOCAL trash too — the
    // tombstone staged them here when it arrived. upsertBuild deliberately
    // carries a trash stamp over from the existing record, so that a teammate's
    // edit cannot resurrect something you deleted; without clearing the stamp
    // first, the pull below would write the restored body onto a record that
    // stays invisible. An explicit team restore is the one case where "bring it
    // back" is exactly what was asked for.
    const ids = new Set(res?.restored || [itemId]);
    if (this.trash && ids.size) {
      const [builds, comps, folders] = await Promise.all([
        this.buildStore.listTrashedBuilds(),
        this.compStore.listTrashedComps(),
        this.folderStore.listTrashedFolders(),
      ]);
      const pick = (records) => records.filter((r) => ids.has(r.id)).map((r) => r.id);
      const selection = { builds: pick(builds), comps: pick(comps), folders: pick(folders) };
      if (selection.builds.length || selection.comps.length || selection.folders.length) {
        await this.trash.restore(selection);
      }
    }

    await this.pullTeam(teamId).catch(() => {});
    return res;
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

    const { uploaded, failed } = await this._bulkUpload(teamId, items, onProgress);

    // Re-parent the folder under the team root. Its subtree keeps its structure.
    await this.folderStore.upsertFolder({ id: folderId, name: folder.name, parentId: root.id, sortOrder: folder.sortOrder });
    this._emit("sync-status", { status: "synced", folderId: root.id });
    return { uploaded, failed };
  }

  // Upload `items` (already ordered parents-before-children) to the team in
  // batches, recording versions for everything the server accepted. Shared by
  // shareFolderToTeam and the legacy-library migration.
  /**
   * Upload `items` (already ordered parents-before-children) to the team in
   * batches, recording versions for everything the server accepted. Shared by
   * shareFolderToTeam and the legacy-library migration.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.skipOversize] report 413s in `skipped` (the item
   *   stays on disk as local-only data, spec §5) instead of failing the run.
   * @returns {Promise<{ uploaded: number, failed: object[], skipped: object[], uploadedIds: string[] }>}
   */
  async _bulkUpload(teamId, items, onProgress, { skipOversize = false } = {}) {
    const session = await this.getSession();
    if (!session) throw new Error("Team sync is not enabled.");
    const failed = [];
    const skipped = [];
    const uploadedIds = [];
    let done = 0;
    const MAX_RATE_LIMIT_WAITS = 5;

    const accept = async (itemId, version, createdBy) => {
      await this.syncStore.setVersion(teamId, itemId, { version, createdBy });
      uploadedIds.push(itemId);
    };
    const tooLarge = (itemId, message) => {
      const entry = { itemId, status: 413, message: message || "Too large for the sync server." };
      (skipOversize ? skipped : failed).push(entry);
    };

    // R3: the server charges bulk writes per item against a per-user
    // writes/min budget, so a large share can hit SYNC_RATE_LIMITED on a
    // later batch. Retry the SAME batch after waiting, instead of failing
    // the whole share or skipping items. Returns null when the server
    // rejected the whole BODY as too large (the caller splits and retries).
    const rawBulk = async (batch) => {
      let waits = 0;
      for (;;) {
        try {
          const { results } = await this.api.bulk(teamId, batch);
          return results;
        } catch (err) {
          if (err && err.code === "SYNC_RATE_LIMITED" && waits < MAX_RATE_LIMIT_WAITS) {
            waits += 1;
            await this._wait(err.retryAfterMs || 60_000);
            continue;
          }
          if (err && err.code === "SYNC_TOO_LARGE") return null;
          throw err;
        }
      }
    };

    const sendBatch = async (batch, isRetry = false) => {
      const results = await rawBulk(batch);
      if (results === null) {
        // m5: the client batches by COUNT, the Worker caps the body by BYTES —
        // 50 large-but-legal items 413 as a whole. Halve and retry; only an
        // item that 413s on its own is genuinely unshippable.
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          await sendBatch(batch.slice(0, mid), isRetry);
          await sendBatch(batch.slice(mid), isRetry);
          return;
        }
        tooLarge(batch[0].itemId, "This item is too large for the sync server.");
        return;
      }
      const retry = [];
      for (const r of results) {
        if (r.status === 200 || r.status === 201) {
          await accept(r.itemId, r.version, session.userId);
        } else if (r.status === 409 && r.current && !r.current.deleted) {
          const serverBy = (r.current.createdBy && r.current.createdBy.userId) || session.userId;
          const src = batch.find((it) => it.itemId === r.itemId);
          if (isRetry || !src) {
            // R3: we already re-sent this item against the server's version and
            // it conflicted again (or we cannot re-send it) — someone raced us.
            // Take the server copy so a re-run is idempotent instead of piling
            // up "Already exists" failures forever.
            await accept(r.itemId, r.current.version, serverBy);
          } else {
            // m1: a 409 on the FIRST attempt means the id already existed in
            // this team before we sent anything. Recording the server version
            // and calling it "uploaded" would silently discard the local body
            // (the next pull would overwrite it). Re-send with the server's
            // version as the base so our local content wins.
            retry.push({ ...src, baseVersion: r.current.version });
          }
        } else if (r.status === 413) {
          tooLarge(r.itemId, r.message);
        } else {
          failed.push({ itemId: r.itemId, status: r.status, message: r.message || (r.status === 409 ? "Already exists in the team." : "Rejected.") });
        }
      }
      if (retry.length) await sendBatch(retry, true);
    };

    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      await sendBatch(batch);
      done += batch.length;
      // M3: a progress listener (an IPC send to a WebContents that may have been
      // destroyed) must never be able to fail an upload — the migration treats a
      // throw here as "the upload failed" and rolls a good team back.
      if (onProgress) { try { onProgress({ done, total: items.length }); } catch { /* ignore */ } }
    }
    return { uploaded: uploadedIds.length, failed, skipped, uploadedIds };
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

  // ─── Legacy GitHub-org library migration ────────────────────────────────────
  // The logic lives in teamSyncMigration.js (this file is big enough); these
  // are thin delegates so IPC and callers keep a single entry point.

  legacyStatus() { return migration.legacyStatus(this); }
  migrateOrgLibrary(opts, onProgress) { return migration.migrateOrgLibrary(this, opts, onProgress); }
  cleanupLegacyFolders() { return migration.cleanupLegacyFolders(this); }

  // ─── Per-folder access ──────────────────────────────────────────────────────
  // Mirrors of the server rules, for UX. The server is the authority; these stop
  // an edit BEFORE it is written locally and queued, so the user is not told
  // "saved" and then told "forbidden" a few seconds later.

  /**
   * Re-read this user's grants for one team.
   *
   * Called when the server asks for a resync, which is exactly when a grant
   * changed — a grant edit stamps the team's seq onto the affected member, and
   * nothing else does. So this costs one request per grant change rather than
   * one per poll.
   */
  async _refreshGrants(teamId) {
    let payload;
    try {
      payload = await this.api.listGrants(teamId);
    } catch (err) {
      // Not fatal: a stale mirror only means the UI offers something the server
      // will refuse, which is where we were before this existed.
      if (err.code === "SYNC_UNAUTHORIZED") await this._handleUnauthorized();
      return null;
    }
    // The server hands back this user's grants and the team's blanket ones in
    // one list, told apart by the '*' pseudo-user. Merged, they would be
    // indistinguishable — and a personal grant has to be able to except a
    // blanket one at the same folder.
    const grants = {};
    const everyone = {};
    for (const g of payload?.grants || []) {
      (g.userId === EVERYONE ? everyone : grants)[g.folderId] = g.access;
    }
    await this.syncStore.setGrants(teamId, grants, everyone);
    return grants;
  }

  listGrants(teamId) { return this.api.listGrants(teamId); }

  async setGrant(teamId, folderId, userId, access) {
    const out = access === "inherit"
      ? await this.api.clearGrant(teamId, folderId, userId)
      : await this.api.setGrant(teamId, folderId, userId, access);
    // Changing your OWN grant is possible (an owner demoted to member elsewhere
    // is not, but a mirror that lags is still worse than one refresh).
    // A blanket change moves this user's own floor too, so it needs the same
    // refresh a change to their own grant does.
    const session = await this.getSession();
    if (userId === EVERYONE || (session && session.userId === userId)) await this._refreshGrants(teamId);
    return out;
  }

  /** What the current user may do with the contents of `folderId`. */
  async accessAt(folderId) {
    const folders = await this.folderStore.listFolders();
    const root = this.teamRootFor(folderId, folders);
    if (!root) return "delete"; // personal folder — nothing to restrict
    const grants = await this.syncStore.getGrants(root.teamId);
    const everyone = await this.syncStore.getEveryoneGrants(root.teamId);
    return access.accessAt({ folders, folderId, teamId: root.teamId, grants, everyone, role: root.role });
  }

  /** Folder id → access, for every folder in every team the user belongs to. */
  async accessMap() {
    const folders = await this.folderStore.listFolders();
    const out = {};
    for (const root of folders.filter((f) => f.teamId)) {
      const grants = await this.syncStore.getGrants(root.teamId);
      const everyone = await this.syncStore.getEveryoneGrants(root.teamId);
      Object.assign(out, access.buildAccessMap({ folders, root, teamId: root.teamId, grants, everyone, role: root.role }));
    }
    return out;
  }

  /** Refuse a write into a folder this user may only read (or cannot see). */
  async assertCanWrite(folderId) {
    if (access.rank(await this.accessAt(folderId)) < access.LEVELS.write) {
      throw new Error("You do not have permission to change things in that folder.");
    }
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

  /**
   * Whether this user may delete one item, taking grants into account.
   *
   * `canDelete` above answers the creator question and predates grants; this
   * layers the folder rule on top, because an outright `delete` grant lets you
   * remove a teammate's work and a `read` one takes away removing your own.
   *
   * @param {string|null} folderId where the item lives
   */
  async canDeleteIn(teamId, itemId, folderId) {
    const level = access.rank(await this.accessAt(folderId));
    if (level >= access.LEVELS.delete) return true;
    if (level < access.LEVELS.write) return false;
    return this.canDelete(teamId, itemId);
  }
}

module.exports = {
  TeamSync,
  POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS,
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, PAGE_SIZE, FAILURES_BEFORE_TOAST,
};
