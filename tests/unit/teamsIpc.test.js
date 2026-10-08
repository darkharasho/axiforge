"use strict";
/**
 * Behavioural coverage of the main process's teams:* (and team-aware CRUD) IPC
 * handlers.
 *
 * This file used to read src/main/index.js as a STRING and assert substrings
 * ("Stop sharing", `handle("teams:…"`). Every one of those assertions passed
 * while the stop-sharing feature was 100% broken (security review M4/M2) — a
 * grep cannot tell a working handler from `() => {}`. So the file now BOOTS THE
 * REAL MAIN PROCESS against a temp userData dir, captures what it registers via
 * ipcMain.handle, and invokes those handlers.
 *
 * What is faked, and only what is faked:
 *   - `electron`     — app/BrowserWindow/ipcMain/screen/… (there is no Electron
 *                      runtime under jest). ipcMain.handle records the handler;
 *                      contextBridge/ipcRenderer let the REAL preload bridge be
 *                      driven against the REAL handlers.
 *   - `./syncApi`    — the HTTP boundary to the Worker. Everything below it
 *                      (TeamSync, the outbox, the stores) is real, on real files.
 *   - `./gw2Data`, `./githubApi`, `./localApi*`, `./autoUpdate`, `./axicodeFile`
 *                    — network / OS side effects irrelevant to these flows.
 *
 * Timers are faked so TeamSync's 30s poll and 1s outbox debounce never fire on
 * their own (the outbox is asserted as state, not raced against), and every
 * boot is torn down in afterEach by firing the real app "will-quit" handler,
 * which stops the poll timer and any pending flush.
 */

const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { waitFor, settle } = require("../helpers/waitFor");

// Per-load context; the electron mock closes over this (reassigned by loadMain).
let mockCtx = null;
// Fake SyncApi surface; every method is a jest.fn the tests can program.
let mockApi = null;

const mockApiMethods = [
  "loginGithub", "logout", "createTeam", "joinTeam", "listTeams", "listMembers",
  "removeMember", "rotateInvite", "renameTeam", "setTeamPublishOwner", "deleteTeam", "changes",
  "putItem", "deleteItem", "bulk",
];

jest.mock("electron", () => ({
  app: {
    commandLine: { appendSwitch() {} },
    isPackaged: false,
    getName: () => "axiforge-desktop-test",
    getVersion: () => "0.0.0-test",
    getPath: () => mockCtx.userData,
    setPath: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    on: (event, fn) => { (mockCtx.appListeners[event] ||= []).push(fn); },
    quit: () => { mockCtx.quit = true; },
  },
  BrowserWindow: Object.assign(function BrowserWindow() {}, {
    getAllWindows: () => mockCtx.windows,
    fromWebContents: () => null,
  }),
  ipcMain: {
    handle: (channel, fn) => { mockCtx.handlers.set(channel, fn); },
    on: () => {},
    removeHandler: () => {},
  },
  contextBridge: { exposeInMainWorld: (_k, api) => { mockCtx.exposed = api; } },
  ipcRenderer: {
    invoke: (channel, ...args) => mockCtx.bridgeInvoke(channel, ...args),
    on: () => {},
    removeAllListeners: () => {},
    send: () => {},
  },
  dialog: { showErrorBox: () => {}, showMessageBox: async () => ({ response: 0 }) },
  clipboard: { writeText: () => {}, readText: () => "" },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  shell: { openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
}));

jest.mock("../../src/main/syncApi", () => {
  const actual = jest.requireActual("../../src/main/syncApi");
  class SyncApi {
    constructor() { /* the fake ignores baseUrl/getToken — tests program mockApi */ }
  }
  for (const m of mockApiMethods) {
    SyncApi.prototype[m] = function (...args) { return mockApi[m](...args); };
  }
  return { ...actual, SyncApi };
});

jest.mock("../../src/main/gw2Data", () => ({
  getProfessionList: jest.fn(async () => []),
  getProfessionCatalog: jest.fn(async () => ({})),
  getUpgradeCatalog: jest.fn(async () => ({})),
  getWikiSummary: jest.fn(async () => null),
  getWikiRelatedData: jest.fn(async () => null),
  initDiskCache: jest.fn(async () => {}),
  clearDiskCache: jest.fn(async () => {}),
  initWikiClient: jest.fn(() => {}),
  clearCatalogCache: jest.fn(() => {}),
}));

jest.mock("../../src/main/githubApi", () => ({
  TARGET_REPO: "axibuilds",
  getViewer: jest.fn(async () => ({ login: "me", id: 1, avatarUrl: null, htmlUrl: "" })),
  listTargets: jest.fn(async () => []),
  ensureAxiForgeRepo: jest.fn(async () => {}),
  ensurePages: jest.fn(async () => {}),
  getPagesBuildStatus: jest.fn(async () => ({})),
  getRepo: jest.fn(async () => ({})),
  ensurePagesWorkflow: jest.fn(async () => {}),
  triggerPagesWorkflow: jest.fn(async () => {}),
  publishSiteBundle: jest.fn(async () => ({})),
  deleteFile: jest.fn(async () => {}),
  pollUrlLive: jest.fn(async () => true),
}));

jest.mock("../../src/main/githubAuth", () => ({
  beginGitHubDeviceAuth: jest.fn(async () => ({})),
  completeGitHubDeviceAuth: jest.fn(async () => ({})),
}));

jest.mock("../../src/main/localApi", () => ({
  createLocalApi: jest.fn(() => ({ start: async () => ({ port: 0 }), stop: async () => {} })),
  generateToken: jest.fn(() => "local-token"),
  httpError: (status, message) => Object.assign(new Error(message), { status }),
}));

jest.mock("../../src/main/localApiDiscovery", () => ({
  writeDiscoveryFile: jest.fn(async () => {}),
  removeDiscoveryFileSync: jest.fn(() => {}),
}));

jest.mock("../../src/main/autoUpdate", () => ({ initAutoUpdate: jest.fn(() => {}) }));
jest.mock("../../src/main/axicodeFile", () => ({ registerAxicodeFileHandlers: jest.fn(() => {}) }));
// The publish handlers assemble the SPA bundle out of dist/site — a build
// artifact, not behaviour these tests assert (they check WHICH OWNER a publish
// goes to). Left real, the suite passes only on a machine that happens to have
// run `npm run build:site` and fails everywhere else, CI included.
jest.mock("../../src/main/siteBundle", () => ({
  ...jest.requireActual("../../src/main/siteBundle"),
  buildSpaBundle: () => ({ "site/index.html": "<!doctype html>\n" }),
}));

// ─── Harness ────────────────────────────────────────────────────────────────

const ISO = "2026-01-01T00:00:00.000Z";
const SESSION = { sessionToken: "sess", userId: "me", login: "me" };

function apiError(code, extra = {}) {
  const { SyncApiError } = jest.requireActual("../../src/main/syncApi");
  const status = { SYNC_UNAUTHORIZED: 401, SYNC_FORBIDDEN: 403, SYNC_NOT_FOUND: 404, SYNC_CONFLICT: 409, SYNC_TOO_LARGE: 413, SYNC_RATE_LIMITED: 429, SYNC_INVALID: 400, SYNC_OFFLINE: 0 }[code];
  return new SyncApiError(code, extra.message || code, { status, current: extra.current || null });
}

function makeFakeApi() {
  const api = {};
  for (const m of mockApiMethods) {
    // Offline by default: nothing in these tests should depend on an
    // unprogrammed call reaching a server, and an offline outbox stays put so
    // it can be asserted.
    api[m] = jest.fn(async () => { throw apiError("SYNC_OFFLINE"); });
  }
  api.changes.mockImplementation(async () => ({ items: [], nextSeq: 0, hasMore: false }));
  api.listTeams.mockImplementation(async () => { throw apiError("SYNC_OFFLINE"); });
  return api;
}

const folder = (over) => ({ parentId: null, sortOrder: 0, createdAt: ISO, updatedAt: ISO, ...over });
const build = (over) => ({ profession: "Warrior", folderId: null, createdAt: ISO, updatedAt: ISO, ...over });
const comp = (over) => ({ buildIds: [], createdAt: ISO, updatedAt: ISO, ...over });

let loaded = null;

/**
 * Boot the real src/main/index.js against a fresh temp userData dir.
 * Seeds are written to disk BEFORE boot so the stores read them at init().
 */
async function loadMain({ auth = { sync: SESSION }, folders = [], builds = [], comps = [], syncState = {} } = {}) {
  jest.resetModules();
  const userData = await fsp.mkdtemp(path.join(os.tmpdir(), "axiforge-mainipc-"));
  const dataDir = path.join(userData, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  if (auth) fs.writeFileSync(path.join(dataDir, "auth.json"), JSON.stringify(auth));
  fs.writeFileSync(path.join(dataDir, "folders.json"), JSON.stringify(folders));
  fs.writeFileSync(path.join(dataDir, "builds.json"), JSON.stringify(builds));
  fs.writeFileSync(path.join(dataDir, "comps.json"), JSON.stringify(comps));
  fs.writeFileSync(path.join(dataDir, "syncState.json"), JSON.stringify(syncState));

  mockCtx = {
    userData,
    dataDir,
    handlers: new Map(),
    appListeners: {},
    windows: [],
    exposed: null,
    sent: [],           // everything the main process pushed at a renderer
    bridgeInvoke: (channel, ...args) => invoke(channel, ...args),
  };
  mockApi = makeFakeApi();
  // One window, so teamSyncEmit()/broadcast() have somewhere to send.
  mockCtx.windows.push({
    isDestroyed: () => false,
    isMinimized: () => false,
    restore() {}, show() {}, focus() {},
    webContents: { send: (channel, data) => mockCtx.sent.push({ channel, data }), isDestroyed: () => false },
  });

  const prevArgv = process.argv;
  process.argv = ["node", "index.js", "--headless"];
  try {
    require("../../src/main/index.js");
  } finally {
    process.argv = prevArgv;
  }
  // whenReady's async chain registers handlers; teams:outbox is the last one.
  // Bounded by wall clock, not tick count — this is the exact bet waitFor exists
  // to remove. The chain awaits the file-backed stores and the local API's
  // socket bind, and those resolve off the threadpool, so "5000 setImmediate
  // turns" is really "~50ms on this laptop": it held here and gave up early on a
  // loaded CI runner, failing the whole suite.
  await waitFor(() => mockCtx.handlers.has("teams:outbox"), {
    label: "main process finished startup",
  });

  const { TeamSync } = require("../../src/main/teamSync");
  loaded = { userData, dataDir, TeamSync };
  return loaded;
}

function invoke(channel, ...args) {
  const fn = mockCtx.handlers.get(channel);
  if (!fn) return Promise.reject(new Error(`No handler registered for ${channel}`));
  return Promise.resolve(fn(fakeEvent(), ...args));
}

function fakeEvent(sender) {
  return { sender: sender || { isDestroyed: () => false, send: (channel, data) => mockCtx.sent.push({ channel, data }) } };
}

const readSyncState = () => JSON.parse(fs.readFileSync(path.join(mockCtx.dataDir, "syncState.json"), "utf8"));
// syncState.json keys the outbox by item id; flatten it back to entries.
const outboxFor = (teamId) =>
  Object.entries(readSyncState()[teamId]?.outbox || {}).map(([itemId, entry]) => ({ itemId, ...entry }));
const fireAppEvent = (event, ...args) => (mockCtx.appListeners[event] || []).forEach((fn) => fn(...args));


beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick", "queueMicrotask", "performance", "Date"] });
});
afterAll(() => { jest.useRealTimers(); });

afterEach(async () => {
  if (loaded) {
    fireAppEvent("will-quit");     // stops polling + pending flush timers
    // Let this boot's startup chain (pullAll / legacy cleanup / snapshot) settle
    // before the temp dir goes away, so no fs work is left in flight when the
    // jest worker is handed to the next test file.
    await settle();
    await fsp.rm(loaded.userData, { recursive: true, force: true }).catch(() => {});
    loaded = null;
  }
});

// A team root + one shared sub-folder + one build in that sub-folder.
const TEAM_ID = "11111111-2222-4333-8444-555555555555";
const teamTree = ({ role = "owner" } = {}) => ({
  folders: [
    folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role }),
    folder({ id: "sub", name: "Sub", parentId: TEAM_ID }),
    folder({ id: "solo", name: "Solo" }),
  ],
  builds: [build({ id: "b1", title: "Shared build", folderId: "sub" })],
  syncState: {
    [TEAM_ID]: {
      cursor: 3,
      versions: { sub: { version: 2, createdBy: "me" }, b1: { version: 1, createdBy: "me" } },
      outbox: {},
      failures: 0,
    },
  },
});

// ─── The IPC surface itself ─────────────────────────────────────────────────

const TEAM_CHANNELS = [
  "teams:get-session", "teams:enable", "teams:disable", "teams:list", "teams:create",
  "teams:join", "teams:leave", "teams:delete", "teams:rename", "teams:members",
  "teams:remove-member", "teams:rotate-invite", "teams:set-publish-owner",
  "teams:share-folder", "teams:stop-sharing",
  "teams:pull", "teams:pull-all", "teams:resolve-conflict", "teams:outbox",
  "teams:legacy-status", "teams:migrate-org-library",
];

describe("the teams IPC surface", () => {
  test("every teams:* channel is registered in main AND reachable through the real preload bridge", async () => {
    await loadMain();
    for (const channel of TEAM_CHANNELS) {
      expect(mockCtx.handlers.has(channel)).toBe(true);
    }
    // Drive the REAL preload: record which channels its exposed methods invoke.
    const seen = new Set();
    mockCtx.bridgeInvoke = async (channel) => { seen.add(channel); return null; };
    require("../../src/preload/index.js");
    expect(mockCtx.exposed).toBeTruthy();
    for (const value of Object.values(mockCtx.exposed)) {
      if (typeof value !== "function") continue;
      try { await value(); } catch { /* argument-less calls may reject; we only want the channel */ }
    }
    const missing = TEAM_CHANNELS.filter((c) => !seen.has(c));
    expect(missing).toEqual([]);
  });

  // The compare modal's whole diff comes down this one channel. A typo in
  // either half is otherwise caught by nothing: the main-process logic is unit
  // tested (history/compareVersions.test.js) and the renderer is tested against
  // a stub, so only this pins that the two names actually meet.
  test("history:compare is registered in main and is what the preload's compareHistory invokes", async () => {
    await loadMain();
    expect(mockCtx.handlers.has("history:compare")).toBe(true);

    const calls = [];
    mockCtx.bridgeInvoke = async (channel, ...args) => { calls.push([channel, ...args]); return null; };
    require("../../src/preload/index.js");
    await mockCtx.exposed.compareHistory("build", "b1", 1, 3);
    expect(calls).toEqual([["history:compare", "build", "b1", 1, 3]]);
  });

  test("the dead GitHub-org sync surface is not registered at all", async () => {
    await loadMain();
    const dead = [...mockCtx.handlers.keys()].filter((c) => c.startsWith("shared-library:"));
    expect(dead).toEqual([]);
  });

  test("teams:get-session hands the renderer an identity, never the bearer token", async () => {
    await loadMain({ auth: { token: "gh", sync: SESSION } });
    const session = await invoke("teams:get-session");
    expect(session).toEqual({ userId: "me", login: "me" });
    expect(JSON.stringify(session)).not.toContain("sess");
  });

  test("teams:get-session is null when team sync was never enabled", async () => {
    await loadMain({ auth: { token: "gh" } });
    expect(await invoke("teams:get-session")).toBeNull();
  });

  test("teams:outbox reports queued work per team", async () => {
    await loadMain(teamTree());
    await invoke("builds:save", build({ id: "b1", title: "Renamed", folderId: "sub" }));
    const outbox = await invoke("teams:outbox");
    expect(outbox[TEAM_ID].map((e) => [e.type, e.op])).toEqual([["build", "put"]]);
  });
});

// ─── Stop sharing (security M2 / M4: this shipped broken under green greps) ──

describe("teams:stop-sharing", () => {
  test("un-shares the SUB-FOLDER the UI passes: the folder goes personal and the team copy is deleted", async () => {
    await loadMain(teamTree());
    mockApi.deleteItem.mockResolvedValue({ version: 3, seq: 9 });

    await expect(invoke("teams:stop-sharing", "sub")).resolves.toBeUndefined();

    expect(mockApi.deleteItem).toHaveBeenCalledWith(TEAM_ID, "sub", 2);
    const folders = await invoke("folders:list");
    expect(folders.find((f) => f.id === "sub")).toMatchObject({ parentId: null });
    expect(folders.find((f) => f.id === "sub").teamId).toBeUndefined();
    // The build stays local, in the (now personal) folder.
    expect((await invoke("builds:list")).find((b) => b.id === "b1")).toMatchObject({ folderId: "sub" });
    // …and every version record for the tree is gone, so no future edit 409s.
    expect(readSyncState()[TEAM_ID].versions).toEqual({});
  });

  test("REFUSES the team root — the id the broken UI used to pass", async () => {
    await loadMain(teamTree());
    await expect(invoke("teams:stop-sharing", TEAM_ID)).rejects.toThrow(/Not a shared sub-folder of a team/);
    expect(mockApi.deleteItem).not.toHaveBeenCalled();
    expect((await invoke("folders:list")).find((f) => f.id === TEAM_ID)).toMatchObject({ teamId: TEAM_ID, shared: true });
  });

  test("a member cannot stop sharing a folder, and nothing is deleted server-side", async () => {
    await loadMain(teamTree({ role: "member" }));
    await expect(invoke("teams:stop-sharing", "sub")).rejects.toThrow(/Only the team owner can stop sharing/);
    expect(mockApi.deleteItem).not.toHaveBeenCalled();
    expect((await invoke("folders:list")).find((f) => f.id === "sub")).toMatchObject({ parentId: TEAM_ID });
  });

  test("a folder outside any team is refused (no accidental detach of personal folders)", async () => {
    await loadMain(teamTree());
    await expect(invoke("teams:stop-sharing", "solo")).rejects.toThrow(/Only the team owner can stop sharing/);
    expect((await invoke("folders:list")).find((f) => f.id === "solo")).toMatchObject({ parentId: null });
  });
});

// ─── Progress senders (engine M3) ───────────────────────────────────────────

describe("share/migration progress can never fail the upload", () => {
  test("teams:share-folder still shares when the renderer's WebContents is gone", async () => {
    await loadMain({
      folders: [
        folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner" }),
        folder({ id: "solo", name: "Solo" }),
      ],
      builds: [build({ id: "b9", title: "Local", folderId: "solo" })],
    });
    mockApi.bulk.mockResolvedValue({ results: [
      { itemId: "solo", status: 201, version: 1, seq: 1 },
      { itemId: "b9", status: 201, version: 1, seq: 2 },
    ] });
    const deadSender = { isDestroyed: () => true, send: () => { throw new Error("Object has been destroyed"); } };

    const res = await mockCtx.handlers.get("teams:share-folder")(fakeEvent(deadSender), "solo", TEAM_ID);

    expect(res.failed).toEqual([]);
    expect((await invoke("folders:list")).find((f) => f.id === "solo")).toMatchObject({ parentId: TEAM_ID });
  });

  test("a sender that throws on send (mid-reload) does not fail the share either", async () => {
    await loadMain({
      folders: [
        folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner" }),
        folder({ id: "solo", name: "Solo" }),
      ],
    });
    mockApi.bulk.mockResolvedValue({ results: [{ itemId: "solo", status: 201, version: 1, seq: 1 }] });
    const flakySender = { isDestroyed: () => false, send: () => { throw new Error("Render frame was disposed"); } };

    await expect(
      mockCtx.handlers.get("teams:share-folder")(fakeEvent(flakySender), "solo", TEAM_ID)
    ).resolves.toMatchObject({ failed: [] });
  });
});

// ─── Ownership / depth guards run BEFORE the local write ────────────────────

describe("guards run before the local write", () => {
  const memberTree = () => ({
    folders: [
      folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "member" }),
      folder({ id: "sub", name: "Sub", parentId: TEAM_ID }),
      folder({ id: "mine", name: "Mine" }),
    ],
    builds: [build({ id: "b1", title: "Their build", folderId: "sub" })],
    comps: [comp({ id: "c1", name: "Their comp", folderId: "sub" })],
    syncState: {
      [TEAM_ID]: {
        cursor: 1,
        versions: {
          sub: { version: 1, createdBy: "mate" },
          b1: { version: 1, createdBy: "mate" },
          c1: { version: 1, createdBy: "mate" },
        },
        outbox: {},
        failures: 0,
      },
    },
  });

  test("a member moving a teammate's BUILD out of the team is refused and nothing is written", async () => {
    await loadMain(memberTree());
    await expect(invoke("builds:save", build({ id: "b1", title: "Their build", folderId: "mine" })))
      .rejects.toThrow(/can move it out of the team/);
    expect((await invoke("builds:list")).find((b) => b.id === "b1")).toMatchObject({ folderId: "sub" });
    expect(outboxFor(TEAM_ID)).toEqual([]);
  });

  test("a member moving a teammate's COMP out of the team is refused and nothing is written", async () => {
    await loadMain(memberTree());
    await expect(invoke("comps:save", comp({ id: "c1", name: "Their comp", folderId: "mine" })))
      .rejects.toThrow(/can move it out of the team/);
    expect((await invoke("comps:list")).find((c) => c.id === "c1")).toMatchObject({ folderId: "sub" });
    expect(outboxFor(TEAM_ID)).toEqual([]);
  });

  test("a member moving a teammate's FOLDER out of the team is refused and nothing is written", async () => {
    await loadMain(memberTree());
    await expect(invoke("folders:save", folder({ id: "sub", name: "Sub", parentId: null })))
      .rejects.toThrow(/can move it out of the team/);
    expect((await invoke("folders:list")).find((f) => f.id === "sub")).toMatchObject({ parentId: TEAM_ID });
    expect(outboxFor(TEAM_ID)).toEqual([]);
  });

  test("a move that would push a GRANDCHILD past the depth limit is refused before the write", async () => {
    await loadMain({
      folders: [
        folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner" }),
        folder({ id: "sub", name: "Sub", parentId: TEAM_ID }),
        folder({ id: "top", name: "Top" }),
        folder({ id: "child", name: "Child", parentId: "top" }),
      ],
    });
    // top (+ its child) under sub would be depth 3 and 4 — teammates could never apply it.
    await expect(invoke("folders:save", folder({ id: "top", name: "Top", parentId: "sub" })))
      .rejects.toThrow(/FOLDER_TOO_DEEP/);
    expect((await invoke("folders:list")).find((f) => f.id === "top")).toMatchObject({ parentId: null });
    expect(outboxFor(TEAM_ID)).toEqual([]);
  });

  test("a team ROOT folder cannot be renamed or re-parented through folders:save", async () => {
    await loadMain(teamTree());
    await expect(invoke("folders:save", folder({ id: TEAM_ID, name: "Renamed", teamId: TEAM_ID })))
      .rejects.toThrow(/Settings → Teams/);
    expect((await invoke("folders:list")).find((f) => f.id === TEAM_ID)).toMatchObject({ name: "Squad" });
  });
});

// ─── Mutations reach the outbox ─────────────────────────────────────────────

describe("team-aware mutations enqueue the right outbox ops", () => {
  test("saving and deleting a build in a team folder enqueues put then delete", async () => {
    await loadMain(teamTree());
    await invoke("builds:save", build({ id: "b2", title: "New", folderId: "sub" }));
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "b2", type: "build", op: "put" })]);
    await invoke("builds:delete", "b2");
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "b2", type: "build", op: "delete" })]);
  });

  test("saving and deleting a comp in a team folder enqueues put then delete", async () => {
    await loadMain(teamTree());
    await invoke("comps:save", comp({ id: "c2", name: "New comp", folderId: "sub" }));
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "c2", type: "comp", op: "put" })]);
    await invoke("comps:delete", "c2");
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "c2", type: "comp", op: "delete" })]);
  });

  // The bug behind "team comps delete themselves": a partial comps:save (the
  // rename prompt sends {id, name}) dropped folderId, upsertComp stored null,
  // and comps:save read null as "left the team" -- enqueueing a DELETE that
  // tombstones the comp for the WHOLE team. Nobody asked for a delete.
  test("a partial comp save never enqueues a team delete", async () => {
    await loadMain(teamTree());
    await invoke("comps:save", comp({ id: "c2", name: "New comp", folderId: "sub" }));
    await invoke("comps:save", { id: "c2", name: "Renamed" });
    expect(outboxFor(TEAM_ID)).toEqual([
      expect.objectContaining({ itemId: "c2", type: "comp", op: "put" }),
    ]);
    expect((await invoke("comps:list")).find((c) => c.id === "c2")).toMatchObject({
      name: "Renamed", folderId: "sub",
    });
  });

  test("saving and deleting a sub-folder enqueues folder put then folder delete", async () => {
    await loadMain(teamTree());
    await invoke("folders:save", folder({ id: "sub", name: "Sub renamed", parentId: TEAM_ID }));
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "sub", type: "folder", op: "put" })]);
    await invoke("folders:delete", "sub");
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "sub", type: "folder", op: "delete" })]);
  });

  test("moving a personal folder INTO a team enqueues the whole subtree, not just the folder", async () => {
    await loadMain({
      folders: [
        folder({ id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner" }),
        folder({ id: "top", name: "Top" }),
        folder({ id: "child", name: "Child", parentId: "top" }),
      ],
      builds: [build({ id: "b3", title: "Inside", folderId: "child" })],
    });
    await invoke("folders:save", folder({ id: "top", name: "Top", parentId: TEAM_ID }));
    const queued = outboxFor(TEAM_ID).map((e) => `${e.type}:${e.itemId}`).sort();
    expect(queued).toEqual(["build:b3", "folder:child", "folder:top"]);
  });

  test("moving a folder from one team to another tombstones it in the old team and uploads it to the new one", async () => {
    const OTHER = "99999999-2222-4333-8444-555555555555";
    await loadMain({
      folders: [
        folder({ id: TEAM_ID, name: "A", shared: true, teamId: TEAM_ID, role: "owner" }),
        folder({ id: OTHER, name: "B", shared: true, teamId: OTHER, role: "owner" }),
        folder({ id: "sub", name: "Sub", parentId: TEAM_ID }),
      ],
      builds: [build({ id: "b4", title: "Travelling", folderId: "sub" })],
      syncState: { [TEAM_ID]: { cursor: 1, versions: { sub: { version: 1, createdBy: "me" } }, outbox: {}, failures: 0 } },
    });
    await invoke("folders:save", folder({ id: "sub", name: "Sub", parentId: OTHER }));
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "sub", type: "folder", op: "delete" })]);
    expect(outboxFor(OTHER).map((e) => `${e.type}:${e.itemId}`).sort()).toEqual(["build:b4", "folder:sub"]);
  });

  test("a save that omits folderId is an edit, not a move to personal", async () => {
    await loadMain(teamTree());
    await invoke("builds:save", { id: "b1", title: "Renamed", profession: "Warrior" });
    const saved = (await invoke("builds:list")).find((b) => b.id === "b1");
    expect(saved).toMatchObject({ folderId: "sub", title: "Renamed" });
    // A move out would have queued a delete against the team; an edit queues a put.
    expect(outboxFor(TEAM_ID)).toEqual([expect.objectContaining({ itemId: "b1", op: "put" })]);
  });

  test("a renderer save carrying an old receipt cannot regress the stored one", async () => {
    const tree = teamTree();
    tree.builds = [build({ id: "b1", title: "Shared build", folderId: "sub", publishedFileId: "f", publishedKey: "k", publishedHash: "NEW" })];
    tree.comps = [comp({ id: "c1", name: "Comp", folderId: "sub", publishedFileId: "cf", publishedKey: "ck", publishedHash: "CNEW", publishedMemberHashes: { b1: "NEW" } })];
    await loadMain(tree);
    await invoke("builds:save", { id: "b1", title: "Edited", profession: "Warrior", publishedHash: "OLD" });
    await invoke("comps:save", { id: "c1", name: "Edited", publishedHash: "COLD", publishedMemberHashes: { b1: "OLD" } });
    const b = (await invoke("builds:list")).find((x) => x.id === "b1");
    const c = (await invoke("comps:list")).find((x) => x.id === "c1");
    expect(b).toMatchObject({ title: "Edited", publishedHash: "NEW" });
    expect(c).toMatchObject({ name: "Edited", publishedHash: "CNEW", publishedMemberHashes: { b1: "NEW" } });
  });

  test("personal-folder mutations touch no outbox at all", async () => {
    await loadMain(teamTree());
    await invoke("builds:save", build({ id: "b5", title: "Private", folderId: "solo" }));
    expect(readSyncState()[TEAM_ID].outbox).toEqual({});
  });
});

// ─── A failing enqueue must not fail the IPC call ───────────────────────────

describe("a failing outbox write never fails a mutation the user already made", () => {
  test.each([
    ["builds:save", () => ["builds:save", build({ id: "bx", title: "X", folderId: "sub" })]],
    ["comps:save", () => ["comps:save", comp({ id: "cx", name: "X", folderId: "sub" })]],
    ["folders:save", () => ["folders:save", folder({ id: "sub", name: "Sub 2", parentId: TEAM_ID })]],
    ["builds:delete", () => ["builds:delete", "b1"]],
  ])("%s still resolves, and the failure surfaces as a sync error", async (_label, argsFor) => {
    const { TeamSync } = await loadMain(teamTree());
    const boom = new Error("disk full");
    jest.spyOn(TeamSync.prototype, "enqueue").mockRejectedValue(boom);
    jest.spyOn(TeamSync.prototype, "enqueueFolderTree").mockRejectedValue(boom);

    const [channel, ...args] = argsFor();
    await expect(invoke(channel, ...args)).resolves.toBeDefined();

    const errors = mockCtx.sent.filter((e) => e.channel === "sync-status" && e.data?.status === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[errors.length - 1].data).toMatchObject({ error: "outbox", message: "disk full" });
  });
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

describe("polling lifecycle", () => {
  test("a team session makes startup reconcile with the server, and will-quit halts sync", async () => {
    const { TeamSync } = await loadMain(teamTree());
    // Startup runs pullAll(), which asks the server for this team's changes.
    await waitFor(() => mockApi.changes.mock.calls.length > 0, { label: "startup pullAll reached api.changes" });
    expect(mockApi.changes).toHaveBeenCalledWith(TEAM_ID, 3, expect.any(Number), expect.any(Object));

    const stopSpy = jest.spyOn(TeamSync.prototype, "stopPolling");
    fireAppEvent("will-quit");
    expect(stopSpy).toHaveBeenCalled();
  });

  test("no team session → the app never talks to the sync server", async () => {
    await loadMain({ auth: { token: "gh" } });
    expect(mockApi.listTeams).not.toHaveBeenCalled();
    expect(mockApi.changes).not.toHaveBeenCalled();
  });
});


// ─── Publishing follows the team, not the machine ───────────────────────────
//
// The bug: a member hit Publish on the team's comp and it went to their own
// GitHub account, silently, because the only publish target there was belonged
// to the machine. These assert the owner the publish actually reaches GitHub
// with — githubApi is the mocked boundary, so this is the real handler running.

describe("publishing inside a team", () => {
  const AUTH = {
    sync: SESSION,
    token: "gh-token",
    onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true },
  };
  // Same tree, with the team pointed at its org (as listTeams mirrors it).
  const publishingTeam = () => {
    const tree = teamTree();
    tree.folders[0] = folder({
      id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner",
      publishOwner: "gw2eww", publishOwnerType: "org",
    });
    tree.builds.push(build({ id: "b2", title: "My build", folderId: "solo" }));
    return { ...tree, auth: AUTH };
  };
  const github = () => require("../../src/main/githubApi");

  test("a build in a team publishes to the team's owner, as an org", async () => {
    await loadMain(publishingTeam());
    await invoke("builds:publish-build", "b1", {});
    expect(github().ensureAxiForgeRepo).toHaveBeenCalledWith("gh-token", "gw2eww", "org");
  });

  test("a build outside the team still publishes to the personal target", async () => {
    await loadMain(publishingTeam());
    await invoke("builds:publish-build", "b2", {});
    expect(github().ensureAxiForgeRepo).toHaveBeenCalledWith("gh-token", "me", "user");
  });

  // onboarding is this machine's own publishing setup. A team publish that
  // stamped itself onto it would repoint the personal target at the team's org
  // and report the team's site build as the user's own.
  test("a team publish does not rewrite the personal target", async () => {
    await loadMain(publishingTeam());
    await invoke("builds:publish-build", "b1", {});
    const auth = JSON.parse(fs.readFileSync(path.join(mockCtx.dataDir, "auth.json"), "utf8"));
    expect(auth.onboarding).toMatchObject({ targetOwner: "me", targetOwnerType: "user" });
  });

  // Every team that predates this. Their publishing must not move.
  test("a team with no target falls back to the personal one", async () => {
    await loadMain({ ...teamTree(), auth: AUTH });
    await invoke("builds:publish-build", "b1", {});
    expect(github().ensureAxiForgeRepo).toHaveBeenCalledWith("gh-token", "me", "user");
  });

  test("teams:set-publish-owner reaches the server and mirrors onto the root folder", async () => {
    await loadMain({ ...teamTree(), auth: AUTH });
    mockApi.setTeamPublishOwner.mockResolvedValue({
      team: { id: TEAM_ID, name: "Squad", publishOwner: "gw2eww", publishOwnerType: "org" },
      role: "owner",
    });
    await invoke("teams:set-publish-owner", TEAM_ID, "gw2eww", "org");
    expect(mockApi.setTeamPublishOwner).toHaveBeenCalledWith(TEAM_ID, "gw2eww", "org");
    const folders = await invoke("folders:list");
    expect(folders.find((f) => f.id === TEAM_ID)).toMatchObject({ publishOwner: "gw2eww", publishOwnerType: "org" });
  });
});

// ─── Publish on save ────────────────────────────────────────────────────────

describe("publish on save", () => {
  const AUTH = {
    sync: SESSION,
    token: "gh-token",
    viewer: { login: "me" },
    onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true },
  };
  const github = () => require("../../src/main/githubApi");
  const statuses = () => mockCtx.sent.filter((m) => m.channel === "publish:status").map((m) => m.data);
  const lastStatus = () => statuses().at(-1);
  const queueFile = () => path.join(mockCtx.userData, "publish-queue.json");
  // A real AES-256 key: a publish re-encrypts with the record's own key.
  const KEY = Buffer.alloc(32, 7).toString("base64url");
  const mine = (over) => build({ id: "p1", title: "Mine", folderId: "solo", publishedFileId: "pf", publishedKey: KEY, publishedSlug: "mine", publishedOwner: "me", publishedHash: "OLD", ...over });
  const tree = (builds) => ({ ...teamTree(), builds, auth: AUTH });

  test("saving a changed build queues it and persists the queue", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Mine, edited", profession: "Warrior" });
    expect(lastStatus().items["build:p1"]).toEqual({ state: "queued" });
    await waitFor(() => fs.existsSync(queueFile()), { label: "queue persisted" });
    expect(JSON.parse(fs.readFileSync(queueFile(), "utf8")).pending).toEqual(["build:p1"]);
  });

  test("a save that leaves the published content alone is not queued", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:publish-build", "p1", {});
    const [stored] = (await invoke("builds:list")).filter((x) => x.id === "p1");
    mockCtx.sent.length = 0;
    await invoke("builds:save", stored);
    expect(statuses().some((s) => s.items["build:p1"])).toBe(false);
  });

  test("builds:publish-build keeps its response shape (local API)", async () => {
    await loadMain(tree([mine()]));
    const res = await invoke("builds:publish-build", "p1", {});
    expect(res).toMatchObject({ slug: "mine", fileId: "pf", changed: true });
    expect(res.pagesUrl).toMatch(new RegExp(`^https://me\\.github\\.io/axibuilds/\\?n=mine&b=pf\\.${KEY}`));
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });

  test("a build owned by someone else asks once, then publishes after \"mine\"", async () => {
    await loadMain(tree([mine({ publishedOwner: "mate" })]));
    await invoke("builds:save", { id: "p1", title: "Edit 1", profession: "Warrior" });
    await invoke("builds:save", { id: "p1", title: "Edit 2", profession: "Warrior" });
    const asks = mockCtx.sent.filter((m) => m.channel === "publish:needs-owner-choice");
    expect(asks.map((m) => m.data)).toEqual([{ kind: "build", id: "p1", owner: "mate" }]);
    expect(lastStatus().items["build:p1"]).toEqual({ state: "declined", owner: "mate" });
    await invoke("publish:set-choice", "build", "p1", "mine");
    await waitFor(() => github().publishSiteBundle.mock.calls.length === 1, { label: "published after choice" });
    expect(github().publishSiteBundle.mock.calls[0][1]).toBe("me");
  });

  test("\"theirs\" stops further saves from publishing", async () => {
    await loadMain(tree([mine({ publishedOwner: "mate" })]));
    await invoke("publish:set-choice", "build", "p1", "theirs");
    await invoke("builds:save", { id: "p1", title: "Edit", profession: "Warrior" });
    expect(lastStatus().items["build:p1"]).toEqual({ state: "declined" });
    expect(mockCtx.sent.some((m) => m.channel === "publish:needs-owner-choice")).toBe(false);
  });

  test("publishing is refused, and the queue paused, until setup is done", async () => {
    await loadMain({ ...tree([mine()]), auth: { ...AUTH, onboarding: { targetOwner: "me", branch: "main" } } });
    await expect(invoke("builds:publish-build", "p1", {})).rejects.toThrow(/Set up publishing/);
    expect((await invoke("publish:snapshot")).paused).toBe("disconnected");
  });

  test("an explicit publish of a team item goes through while setup pauses the queue", async () => {
    const t = tree([mine()]);
    t.folders[0] = folder({
      id: TEAM_ID, name: "Squad", shared: true, teamId: TEAM_ID, role: "owner",
      publishOwner: "gw2eww", publishOwnerType: "org",
    });
    t.builds.push(build({ id: "b1", title: "Shared build", folderId: "sub" }));
    await loadMain({ ...t, auth: { ...AUTH, onboarding: { targetOwner: "me", branch: "main" } } });
    await invoke("builds:save", { id: "p1", title: "Edited", profession: "Warrior" });
    await invoke("publish:retry", "build", "p1");
    await waitFor(() => lastStatus()?.paused === "disconnected", { label: "queue paused" });
    const res = await invoke("builds:publish-build", "b1", {});
    expect(res.pagesUrl).toMatch(/^https:\/\/gw2eww\.github\.io\//);
    expect(github().ensureAxiForgeRepo).toHaveBeenCalledWith("gh-token", "gw2eww", "org");
    // The personal item is still not set up, so the round paused the queue again.
    expect((await invoke("publish:snapshot")).paused).toBe("disconnected");
  });

  test("a tag edit on a published comp queues it", async () => {
    const pc = comp({ id: "c1", name: "Squad comp", folderId: "solo", publishedFileId: "cf", publishedKey: KEY, publishedSlug: "squad", publishedOwner: "me", publishedHash: "OLD" });
    await loadMain({ ...tree([]), comps: [pc] });
    await invoke("comps:add-tags", ["c1"], ["wvw"]);
    expect(lastStatus().items["comp:c1"]).toEqual({ state: "queued" });
  });

  test("publish:get-link returns a published item's link without publishing", async () => {
    await loadMain(tree([mine()]));
    const url = await invoke("publish:get-link", "build", "p1");
    expect(url).toBe(`https://me.github.io/axibuilds/?n=mine&b=pf.${KEY}`);
    expect(github().publishSiteBundle).not.toHaveBeenCalled();
  });

  test("publish:bulk-candidates counts never-published items; bulk-enqueue queues them", async () => {
    await loadMain(tree([mine(), build({ id: "n1", title: "New", folderId: "solo" }), build({ id: "n2", title: "", profession: "" })]));
    // tree() replaces teamTree's builds: p1 is published, n2 has no profession.
    expect(await invoke("publish:bulk-candidates")).toBe(1);
    expect(await invoke("publish:bulk-enqueue")).toBe(1);
    expect(Object.keys(lastStatus().items)).toEqual(["build:n1"]);
  });

  test("quitting with saves pending runs one round, then quits", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Edited", profession: "Warrior" });
    const event = { preventDefault: jest.fn() };
    fireAppEvent("before-quit", event);
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => mockCtx.quit === true, { label: "quit after flush" });
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });

  test("a Discord share of a queued build waits for its upload", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Edited", profession: "Warrior" });
    await invoke("discord:share-build", "p1", []);
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });
});
