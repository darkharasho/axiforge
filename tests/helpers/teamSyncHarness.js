"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
const { SyncStore } = require("../../src/main/syncStore");
const { BuildHistoryStore } = require("../../src/main/buildHistoryStore");
const { SyncApiError } = require("../../src/main/syncApi");
const { TeamSync } = require("../../src/main/teamSync");

function apiError(code, extra = {}) {
  const status = { SYNC_UNAUTHORIZED: 401, SYNC_FORBIDDEN: 403, SYNC_NOT_FOUND: 404, SYNC_CONFLICT: 409, SYNC_TOO_LARGE: 413, SYNC_RATE_LIMITED: 429, SYNC_INVALID: 400, SYNC_OFFLINE: 0 }[code];
  return new SyncApiError(code, extra.message || code, { status, current: extra.current || null, retryAfterMs: extra.retryAfterMs || null });
}

function fakeApi() {
  const api = {};
  for (const m of ["loginGithub", "logout", "createTeam", "joinTeam", "listTeams", "listMembers", "removeMember", "rotateInvite", "renameTeam", "deleteTeam", "changes", "putItem", "deleteItem", "bulk"]) {
    api[m] = jest.fn(async () => { throw new Error(`unexpected api.${m}`); });
  }
  api.changes.mockImplementation(async () => ({ items: [], nextSeq: 0, hasMore: false }));
  return api;
}

async function makeHarness({ session = { sessionToken: "sess", userId: "me", login: "me" } } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-teamsync-"));
  const buildStore = new BuildStore(dir);
  const compStore = new CompStore(dir);
  const folderStore = new FolderStore(dir);
  const syncStore = new SyncStore(dir);
  const historyStore = new BuildHistoryStore(dir);
  await Promise.all([buildStore.init(), compStore.init(), folderStore.init(), syncStore.init(), historyStore.init()]);
  if (session) await buildStore.saveAuth({ token: "gh", viewer: { login: "me" }, sync: session });
  const api = fakeApi();
  const events = [];
  const emit = (channel, data) => events.push({ channel, ...data });
  let nowMs = Date.parse("2026-08-21T12:00:00Z");
  const timers = [];
  const setTimeoutImpl = (fn, ms) => { const t = { fn, at: nowMs + ms, cleared: false }; timers.push(t); return t; };
  const clearTimeoutImpl = (t) => { if (t) t.cleared = true; };
  const sync = new TeamSync({ buildStore, compStore, folderStore, syncStore, historyStore, api, emit, now: () => nowMs, setTimeoutImpl, clearTimeoutImpl });
  // Fire every timer due at or before nowMs+ms (in order), awaiting async callbacks.
  async function advance(ms) {
    nowMs += ms;
    for (;;) {
      const due = timers.filter((t) => !t.cleared && !t.fired && t.at <= nowMs).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.fired = true;
      await due.fn();
    }
  }
  const cleanup = () => { sync.stopPolling(); return fs.rm(dir, { recursive: true, force: true }); };
  return { dir, buildStore, compStore, folderStore, syncStore, historyStore, api, events, sync, advance, now: () => nowMs, cleanup, apiError };
}

module.exports = { makeHarness, fakeApi, apiError };
