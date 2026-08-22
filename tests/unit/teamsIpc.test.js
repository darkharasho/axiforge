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

// Per-load context; the electron mock closes over this (reassigned by loadMain).
let mockCtx = null;
// Fake SyncApi surface; every method is a jest.fn the tests can program.
let mockApi = null;

const mockApiMethods = [
  "loginGithub", "logout", "createTeam", "joinTeam", "listTeams", "listMembers",
  "removeMember", "rotateInvite", "renameTeam", "deleteTeam", "changes",
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
  for (let i = 0; i < 5000 && !mockCtx.handlers.has("teams:outbox"); i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  if (!mockCtx.handlers.has("teams:outbox")) throw new Error("main process never finished startup");

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
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
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
  "teams:remove-member", "teams:rotate-invite", "teams:share-folder", "teams:stop-sharing",
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
    for (let i = 0; i < 200 && !mockApi.changes.mock.calls.length; i += 1) await new Promise((r) => setImmediate(r));
    expect(mockApi.changes).toHaveBeenCalledWith(TEAM_ID, 3, expect.any(Number));

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

