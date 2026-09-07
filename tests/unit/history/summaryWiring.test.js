"use strict";
/**
 * The name resolvers history summaries need, asserted through the REAL main
 * process.
 *
 * `renderSummary` can only say "moved to Raids/Support" if something hands it a
 * `folderNameOf`; the same goes for a comp slot's `buildNameOf` and
 * `categoryNameOf`. Nothing was supplying them, and no unit test could notice —
 * every history unit test constructs its own store. So this file boots
 * src/main/index.js the way tests/unit/teamsIpc.test.js does and asserts on the
 * rendered NAME, which is the only thing that can tell a wired resolver from an
 * absent one.
 *
 * The electron/module fakes below are the same set teamsIpc.test.js uses, and
 * for the same reasons; see that file's header.
 */
const os = require("node:os");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { waitFor } = require("../../helpers/waitFor");

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

jest.mock("../../../src/main/syncApi", () => {
  const actual = jest.requireActual("../../../src/main/syncApi");
  class SyncApi {
    constructor() { /* the fake ignores baseUrl/getToken — tests program mockApi */ }
  }
  for (const m of mockApiMethods) {
    SyncApi.prototype[m] = function (...args) { return mockApi[m](...args); };
  }
  return { ...actual, SyncApi };
});

jest.mock("../../../src/main/gw2Data", () => ({
  getProfessionList: jest.fn(async () => []),
  getProfessionCatalog: jest.fn(async () => ({})),
  // Runes/sigils/infusions/enrichment/food/utility are stored as item ids, so
  // this catalog is what turns them into names. See the "item ids" describe.
  getUpgradeCatalog: jest.fn(async () => ({
    enrichmentById: new Map([[79926, { id: 79926, name: "Vision Enrichment" }]]),
    runeById: new Map([[24703, { id: 24703, name: "Superior Rune of the Scholar" }]]),
  })),
  getWikiSummary: jest.fn(async () => null),
  getWikiRelatedData: jest.fn(async () => null),
  initDiskCache: jest.fn(async () => {}),
  clearDiskCache: jest.fn(async () => {}),
  initWikiClient: jest.fn(() => {}),
  clearCatalogCache: jest.fn(() => {}),
}));

jest.mock("../../../src/main/githubApi", () => ({
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

jest.mock("../../../src/main/githubAuth", () => ({
  beginGitHubDeviceAuth: jest.fn(async () => ({})),
  completeGitHubDeviceAuth: jest.fn(async () => ({})),
}));

jest.mock("../../../src/main/localApi", () => ({
  createLocalApi: jest.fn(() => ({ start: async () => ({ port: 0 }), stop: async () => {} })),
  generateToken: jest.fn(() => "local-token"),
  httpError: (status, message) => Object.assign(new Error(message), { status }),
}));

jest.mock("../../../src/main/localApiDiscovery", () => ({
  writeDiscoveryFile: jest.fn(async () => {}),
  removeDiscoveryFileSync: jest.fn(() => {}),
}));

jest.mock("../../../src/main/autoUpdate", () => ({ initAutoUpdate: jest.fn(() => {}) }));
jest.mock("../../../src/main/axicodeFile", () => ({ registerAxicodeFileHandlers: jest.fn(() => {}) }));

// ─── Harness ────────────────────────────────────────────────────────────────

const ISO = "2026-01-01T00:00:00.000Z";
const SESSION = { sessionToken: "sess", userId: "me", login: "me" };

function apiError(code, extra = {}) {
  const { SyncApiError } = jest.requireActual("../../../src/main/syncApi");
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
    require("../../../src/main/index.js");
  } finally {
    process.argv = prevArgv;
  }
  // whenReady's async chain registers handlers; teams:outbox is the last one.
  for (let i = 0; i < 5000 && !mockCtx.handlers.has("teams:outbox"); i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  if (!mockCtx.handlers.has("teams:outbox")) throw new Error("main process never finished startup");

  const { TeamSync } = require("../../../src/main/teamSync");
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

// ─── A5: the summaries name what they are talking about ─────────────────────

const FOLDERS = [
  folder({ id: "raids", name: "Raids" }),
  folder({ id: "support", name: "Support", parentId: "raids" }),
];

describe("a folder move names the folder", () => {
  test("builds:save renders the destination's name, not 'another folder'", async () => {
    await loadMain({
      folders: FOLDERS,
      builds: [build({ id: "b1", title: "Heal Tempest", folderId: "raids" })],
    });

    await invoke("builds:save", { id: "b1", title: "Heal Tempest", folderId: "support" });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length > 0);

    const { versions } = await invoke("builds:get-history", "b1");
    expect(versions[0].summary).toContain("Raids/Support");
  });

  // A move on its own is bookkeeping the library did on the user's behalf, so it
  // is not a build version — but nothing about it is lost. The diff base is the
  // last VERSIONED document, so the move travels with the next real edit and is
  // still named there; it just does not get a row of its own.
  test("a move alone writes no version, and the next edit still names where it went", async () => {
    await loadMain({
      folders: FOLDERS,
      builds: [build({ id: "b1", title: "Heal Tempest", folderId: null })],
    });

    await invoke("builds:save", { id: "b1", title: "Renamed", folderId: null });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 1);

    await invoke("builds:save", { id: "b1", title: "Renamed", folderId: "support" });
    await invoke("builds:save", { id: "b1", title: "Renamed again", folderId: "support" });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 2);

    // Two, not three: the move in between never became one. appendVersion is
    // fire-and-forget, so let anything still in flight land before counting.
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    const { versions } = await invoke("builds:get-history", "b1");
    expect(versions).toHaveLength(2);
    expect(versions[0].summary).toContain("moved to Raids/Support");
    expect(versions[0].summary).toContain("Renamed again");
  });

  test("comps:save names the folder too", async () => {
    await loadMain({
      folders: FOLDERS,
      comps: [comp({ id: "c1", name: "Squad", folderId: "raids" })],
    });

    await invoke("comps:save", { id: "c1", name: "Squad", folderId: "support" });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length > 0);

    const { versions } = await invoke("comps:get-history", "c1");
    expect(versions[0].summary).toContain("Raids/Support");
  });
});

describe("a comp slot names the build and the category", () => {
  const CAT = "cat-support";
  const seed = {
    folders: FOLDERS,
    builds: [build({ id: "b1", title: "Heal Tempest", folderId: "raids" })],
    comps: [comp({
      id: "c1", name: "Squad", folderId: "raids",
      categories: [{ id: CAT, name: "Healers", buildIds: ["b1"] }],
      partyLines: [{ slots: [null, null, null, null, null] }],
    })],
  };

  test("comps:save names a build dropped into a slot", async () => {
    await loadMain(seed);
    await invoke("comps:save", {
      id: "c1", name: "Squad", folderId: "raids",
      categories: seed.comps[0].categories,
      partyLines: [{ slots: ["b1", null, null, null, null] }],
    });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length > 0);
    const { versions } = await invoke("comps:get-history", "c1");
    expect(versions[0].summary).toContain("Heal Tempest");
  });

  // The reviewer's finding: category slots read "any cat-support".
  test("comps:save names a CATEGORY slot", async () => {
    await loadMain(seed);
    await invoke("comps:save", {
      id: "c1", name: "Squad", folderId: "raids",
      categories: seed.comps[0].categories,
      partyLines: [{ slots: [`tag:${CAT}`, null, null, null, null] }],
    });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length > 0);
    const { versions } = await invoke("comps:get-history", "c1");
    expect(versions[0].summary).toContain("any Healers");
    expect(versions[0].summary).not.toContain(CAT);
  });

  // comps:revert supplied no summaryOpts at all while comps:save did, so the
  // same edit was worded two different ways depending on how it happened.
  test("comps:revert words a slot change the same way comps:save does", async () => {
    await loadMain(seed);
    const base = {
      id: "c1", name: "Squad", folderId: "raids",
      categories: seed.comps[0].categories,
    };
    // v1: the empty line. v2: the build in slot 1.
    await invoke("comps:save", { ...base, partyLines: [{ slots: [null, null, null, null, null] }] });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length >= 1);
    await invoke("comps:save", { ...base, partyLines: [{ slots: ["b1", null, null, null, null] }] });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length >= 2);

    // Putting the slot back has to be worded the way the save that filled it
    // was — comps:revert supplied no summaryOpts at all.
    await invoke("comps:revert", "c1", 1);
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length >= 3);

    const { versions } = await invoke("comps:get-history", "c1");
    expect(versions[0].summary).toContain("Heal Tempest");
  });
});

// history:compare labels every op with the SAME vocabulary as the entry list;
// replacing its summaryOpts with `{}` must not leave the suite green.
describe("history:compare labels ops with the same names", () => {
  test("a folder move compares as a named move", async () => {
    await loadMain({
      folders: FOLDERS,
      builds: [build({ id: "b1", title: "Heal Tempest", folderId: "raids" })],
    });
    await invoke("builds:save", { id: "b1", title: "Heal Tempest", folderId: null });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 1);
    // The move rides along with an edit: on its own it writes no build version.
    await invoke("builds:save", { id: "b1", title: "Renamed", folderId: "support" });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 2);

    const { ops } = await invoke("history:compare", "build", "b1", 1, 2);
    const move = ops.find((o) => o.path === "folderId");
    expect(move.label).toBe("moved to Raids/Support");
  });

  test("a comp slot compares as a named build", async () => {
    await loadMain({
      folders: FOLDERS,
      builds: [build({ id: "b1", title: "Heal Tempest", folderId: "raids" })],
      comps: [comp({ id: "c1", name: "Squad", folderId: "raids", partyLines: [{ slots: [null, null, null, null, null] }] })],
    });
    await invoke("comps:save", { id: "c1", name: "Renamed", folderId: "raids", partyLines: [{ slots: [null, null, null, null, null] }] });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length >= 1);
    await invoke("comps:save", { id: "c1", name: "Renamed", folderId: "raids", partyLines: [{ slots: ["b1", null, null, null, null] }] });
    await waitFor(async () => (await invoke("comps:get-history", "c1")).versions.length >= 2);

    const { ops } = await invoke("history:compare", "comp", "c1", 1, 2);
    expect(ops.map((o) => o.label).join(" | ")).toContain("Heal Tempest");
  });
});

// ─── item ids ───────────────────────────────────────────────────────────────
//
// Reported as "changing enrichment showed an ID, not the name". Nothing was
// supplying an `itemNameOf`, so every rune, sigil, infusion, enrichment, food
// and utility change recorded its raw GW2 id — and a one-line summary is
// frozen into the log when the version is written, so it stayed an id forever.
// Only a test through the real main process can tell a wired resolver from an
// absent one; renderSummary's own unit tests pass their resolver in by hand.

describe("item ids are named, not printed raw", () => {
  const withEnrichment = (enrichment) => ({
    id: "b1", title: "Bladesworn", folderId: null, equipment: { enrichment },
  });

  test("builds:save names an enrichment instead of showing its id", async () => {
    await loadMain({ builds: [build(withEnrichment(""))] });

    // The origin keyframe first: a record's v1 is never a diff, and v2 is the
    // one that has to phrase the change.
    await invoke("builds:save", withEnrichment(""));
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 1);
    await invoke("builds:save", withEnrichment("79926"));
    await waitFor(async () =>
      (await invoke("builds:get-history", "b1")).versions.some((v) => /enrichment/.test(v.summary)));

    const entry = (await invoke("builds:get-history", "b1")).versions
      .find((v) => /enrichment/.test(v.summary));
    expect(entry.summary).toBe("enrichment: (none) → Vision Enrichment");
    expect(entry.summary).not.toContain("79926");
  });

  test("builds:save names a rune too — the same resolver covers gear upgrades", async () => {
    await loadMain({ builds: [build({ id: "b1", title: "Bladesworn", folderId: null })] });

    await invoke("builds:save", { id: "b1", title: "Bladesworn", folderId: null });
    await waitFor(async () => (await invoke("builds:get-history", "b1")).versions.length >= 1);
    await invoke("builds:save", {
      id: "b1", title: "Bladesworn", folderId: null,
      equipment: { runes: { head: "24703" } },
    });
    await waitFor(async () =>
      (await invoke("builds:get-history", "b1")).versions.some((v) => /head rune/.test(v.summary)));

    const entry = (await invoke("builds:get-history", "b1")).versions
      .find((v) => /head rune/.test(v.summary));
    expect(entry.summary).toContain("Superior Rune of the Scholar");
    expect(entry.summary).not.toContain("24703");
  });
});
