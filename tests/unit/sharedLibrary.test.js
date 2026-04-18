"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { FolderStore } = require("../../src/main/folderStore");
const { SyncStore } = require("../../src/main/syncStore");
const { SharedLibrary } = require("../../src/main/sharedLibrary");

// Mock githubApi module
jest.mock("../../src/main/githubApi");
const githubApi = require("../../src/main/githubApi");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "axiforge-sync-engine-"));
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Helper: create a BuildStore-like object
function mockBuildStore(builds = []) {
  return {
    listBuilds: jest.fn(async () => [...builds]),
    upsertBuild: jest.fn(async (b) => ({ ...b, updatedAt: new Date().toISOString() })),
    deleteBuild: jest.fn(async () => {}),
    getAuth: jest.fn(async () => ({
      token: "fake-token",
      sharedLibrary: { orgName: "test-org", repoName: "axibuilds-shared" },
    })),
  };
}

function mockCompStore(comps = []) {
  return {
    listComps: jest.fn(async () => [...comps]),
    upsertComp: jest.fn(async (c) => ({ ...c, updatedAt: new Date().toISOString() })),
    deleteComp: jest.fn(async () => {}),
    removeBuildFromComps: jest.fn(async () => {}),
  };
}

describe("SharedLibrary — pullFolder", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(async () => cleanupDir(dir));

  test("pulls new builds from remote into local store", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      name: "Shared", shared: true, orgName: "test-org",
    });

    // Remote has one build
    githubApi.getRepoTree.mockResolvedValue([
      { path: `folders/${folder.id}/meta.json`, sha: "meta-sha" },
      { path: `folders/${folder.id}/builds/b1.json`, sha: "build-sha" },
    ]);
    githubApi.getFileContents.mockResolvedValue({
      content: JSON.stringify({ id: "b1", title: "Remote Build", profession: "Warrior" }),
      sha: "build-sha",
    });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(folder.id);

    expect(buildStore.upsertBuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b1", title: "Remote Build", folderId: folder.id })
    );
    // SHA should be tracked
    const shas = await syncStore.getShas(folder.id);
    expect(shas[`builds/b1`]).toBe("build-sha");
  });

  test("skips unchanged files (matching SHA)", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      name: "Shared", shared: true, orgName: "test-org",
    });
    await syncStore.setShas(folder.id, { "meta": "meta-sha", "builds/b1": "same-sha" });

    githubApi.getRepoTree.mockResolvedValue([
      { path: `folders/${folder.id}/meta.json`, sha: "meta-sha" },
      { path: `folders/${folder.id}/builds/b1.json`, sha: "same-sha" },
    ]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(folder.id);

    expect(githubApi.getFileContents).not.toHaveBeenCalled();
    expect(buildStore.upsertBuild).not.toHaveBeenCalled();
  });

  test("removes locally tracked builds deleted on remote", async () => {
    const buildStore = mockBuildStore([
      { id: "b1", title: "Old", folderId: "f1" },
    ]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({
      id: "f1", name: "Shared", shared: true, orgName: "test-org",
    });
    await syncStore.setShas("f1", { "builds/b1": "old-sha" });

    // Remote tree has no builds
    githubApi.getRepoTree.mockResolvedValue([
      { path: "folders/f1/meta.json", sha: "meta-sha" },
    ]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder("f1");

    expect(buildStore.deleteBuild).toHaveBeenCalledWith("b1");
  });
});

describe("SharedLibrary — pushBuild", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(async () => cleanupDir(dir));

  test("creates new file when no SHA tracked", async () => {
    const build = { id: "b1", title: "New Build", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });

    githubApi.putSharedFile.mockResolvedValue({ sha: "new-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pushBuild(build);

    expect(githubApi.putSharedFile).toHaveBeenCalledWith(
      "fake-token", "test-org", "axibuilds-shared",
      "folders/f1/builds/b1.json",
      expect.any(String),  // JSON content
      null,                // no SHA = create
      "main",
      expect.any(String),  // commit message
    );
    const shas = await syncStore.getShas("f1");
    expect(shas["builds/b1"]).toBe("new-sha");
  });

  test("updates with SHA when tracked (optimistic locking)", async () => {
    const build = { id: "b1", title: "Updated", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "existing-sha" });

    githubApi.putSharedFile.mockResolvedValue({ sha: "updated-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pushBuild(build);

    expect(githubApi.putSharedFile).toHaveBeenCalledWith(
      "fake-token", "test-org", "axibuilds-shared",
      "folders/f1/builds/b1.json",
      expect.any(String),
      "existing-sha",     // existing SHA for optimistic lock
      "main",
      expect.any(String),
    );
    const shas = await syncStore.getShas("f1");
    expect(shas["builds/b1"]).toBe("updated-sha");
  });

  test("retries with remote SHA on 409 and succeeds", async () => {
    const build = { id: "b1", title: "Mine", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "stale-sha" });

    const conflict = new Error("Conflict");
    conflict.status = 409;
    githubApi.putSharedFile
      .mockRejectedValueOnce(conflict)       // first attempt fails
      .mockResolvedValueOnce({ sha: "fresh-sha" }); // retry succeeds
    githubApi.getFileContents.mockResolvedValue({ content: "{}", sha: "remote-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    const result = await lib.pushBuild(build);

    expect(result.conflict).toBe(false);
    // SHA updated with the result of the successful retry
    const shas = await syncStore.getShas("f1");
    expect(shas["builds/b1"]).toBe("fresh-sha");
    expect(githubApi.putSharedFile).toHaveBeenCalledTimes(2);
  });

  test("throws when 409 persists after retry", async () => {
    const build = { id: "b1", title: "Mine", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "stale-sha" });

    const conflict = new Error("Conflict");
    conflict.status = 409;
    githubApi.putSharedFile.mockRejectedValue(conflict);
    githubApi.getFileContents.mockResolvedValue({ content: "{}", sha: "remote-sha" });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await expect(lib.pushBuild(build)).rejects.toThrow("Conflict");
  });
});

// ─── pullAll — concurrency guard ────────────────────────────────────────────

describe("SharedLibrary — pullAll concurrency guard", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("concurrent pullAll() calls only run one inner pull", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    // Make getHeadSha take long enough to overlap two calls
    let getHeadShaCallCount = 0;
    githubApi.getHeadSha.mockImplementation(async () => {
      getHeadShaCallCount++;
      await new Promise((r) => setTimeout(r, 20));
      return "sha-abc";
    });
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });

    // Fire two concurrent pullAll() calls
    await Promise.all([lib.pullAll(), lib.pullAll()]);

    // getHeadSha should only have been called once (second call was dropped by guard)
    expect(getHeadShaCallCount).toBe(1);
  });

  test("_pullInProgress is reset to false after completion", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockResolvedValue("sha-1");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll();
    expect(lib._pullInProgress).toBe(false);
  });

  test("_pullInProgress is reset to false even if inner pull throws", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockRejectedValue(new Error("unexpected"));
    // Non-UNAUTHORIZED non-RATE_LIMITED error falls through to getRepoTree
    githubApi.getRepoTree.mockRejectedValue(new Error("network error"));

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll(); // should not throw
    expect(lib._pullInProgress).toBe(false);
  });

  test("second pullAll() succeeds after the first completes", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha
      .mockResolvedValueOnce("sha-1")
      .mockResolvedValueOnce("sha-2");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll();
    await lib.pullAll();
    expect(githubApi.getHeadSha).toHaveBeenCalledTimes(2);
  });
});

// ─── pullAll — HEAD SHA cache ────────────────────────────────────────────────

describe("SharedLibrary — HEAD SHA cache", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("skips full pull when HEAD SHA has not changed", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockResolvedValue("same-sha");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll(); // first call — populates _lastHeadSha
    await lib.pullAll(); // second call — should skip getRepoTree

    expect(githubApi.getRepoTree).toHaveBeenCalledTimes(1);
  });

  test("does full pull when HEAD SHA changes", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha
      .mockResolvedValueOnce("sha-1")
      .mockResolvedValueOnce("sha-2");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll();
    await lib.pullAll();

    expect(githubApi.getRepoTree).toHaveBeenCalledTimes(2);
  });

  test("invalidateHeadShaCache() forces next pull to fetch tree", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockResolvedValue("same-sha");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll(); // first pull — caches sha
    lib.invalidateHeadShaCache();
    await lib.pullAll(); // second pull — cache invalidated, should fetch tree

    expect(githubApi.getRepoTree).toHaveBeenCalledTimes(2);
  });

  test("null HEAD SHA from API does not short-circuit (always fetches tree)", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    // API returns null (e.g. empty repo)
    githubApi.getHeadSha.mockResolvedValue(null);
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll();
    await lib.pullAll();

    // null SHA should not cause early return (condition: `headSha && headSha === this._lastHeadSha`)
    expect(githubApi.getRepoTree).toHaveBeenCalledTimes(2);
  });
});

// ─── pullAll — rate limit backoff ────────────────────────────────────────────

describe("SharedLibrary — rate limit backoff", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("stops pulling when getHeadSha returns GITHUB_RATE_LIMITED", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    const rateLimitErr = new Error("Rate limited");
    rateLimitErr.code = "GITHUB_RATE_LIMITED";
    rateLimitErr.retryAfterMs = 60_000;
    githubApi.getHeadSha.mockRejectedValue(rateLimitErr);
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullAll();

    expect(githubApi.getRepoTree).not.toHaveBeenCalled();
    expect(lib._rateLimitedUntil).toBeGreaterThan(Date.now());
  });

  test("skips pull while within rate-limit window", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockResolvedValue("sha-1");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    // Set rate limit window far into the future
    lib._rateLimitedUntil = Date.now() + 60_000;
    await lib.pullAll();

    expect(githubApi.getHeadSha).not.toHaveBeenCalled();
    expect(githubApi.getRepoTree).not.toHaveBeenCalled();
  });

  test("resumes pulling after rate-limit window expires", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getHeadSha.mockResolvedValue("sha-new");
    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    // Set rate limit window already expired
    lib._rateLimitedUntil = Date.now() - 1;
    await lib.pullAll();

    expect(githubApi.getHeadSha).toHaveBeenCalled();
  });

  test("uses retryAfterMs from error when available", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    const rateLimitErr = new Error("Rate limited");
    rateLimitErr.code = "GITHUB_RATE_LIMITED";
    rateLimitErr.retryAfterMs = 120_000;
    githubApi.getHeadSha.mockRejectedValue(rateLimitErr);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    const before = Date.now();
    await lib.pullAll();

    // Should be ~120s from now (allow some slack)
    expect(lib._rateLimitedUntil).toBeGreaterThan(before + 110_000);
    expect(lib._rateLimitedUntil).toBeLessThan(before + 130_000);
  });

  test("defaults to 60s backoff when retryAfterMs is absent", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    const rateLimitErr = new Error("Rate limited");
    rateLimitErr.code = "GITHUB_RATE_LIMITED";
    // no retryAfterMs
    githubApi.getHeadSha.mockRejectedValue(rateLimitErr);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    const before = Date.now();
    await lib.pullAll();

    expect(lib._rateLimitedUntil).toBeGreaterThan(before + 55_000);
    expect(lib._rateLimitedUntil).toBeLessThan(before + 65_000);
  });
});

// ─── pullAll — 401 token expiry ──────────────────────────────────────────────

describe("SharedLibrary — 401 token expiry handling", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("stops polling when getHeadSha returns GITHUB_UNAUTHORIZED", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    const unauthorizedErr = new Error("Unauthorized");
    unauthorizedErr.code = "GITHUB_UNAUTHORIZED";
    githubApi.getHeadSha.mockRejectedValue(unauthorizedErr);

    const emitted = [];
    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore, emit: (...a) => emitted.push(a) });
    lib.startPolling(100); // start so there's something to stop
    await lib.pullAll();

    expect(lib._pollTimer).toBeNull();
    expect(emitted).toContainEqual(["sync-status", { status: "error", error: "auth" }]);
  });

  test("stops polling when getRepoTree returns GITHUB_UNAUTHORIZED", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    // Let getHeadSha return a new SHA so it proceeds to getRepoTree
    githubApi.getHeadSha.mockResolvedValue("sha-new");

    const unauthorizedErr = new Error("Unauthorized");
    unauthorizedErr.code = "GITHUB_UNAUTHORIZED";
    githubApi.getRepoTree.mockRejectedValue(unauthorizedErr);

    const emitted = [];
    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore, emit: (...a) => emitted.push(a) });
    lib.startPolling(100);
    await lib.pullAll();

    expect(lib._pollTimer).toBeNull();
    expect(emitted).toContainEqual(["sync-status", { status: "error", error: "auth" }]);
  });
});

// ─── schedulePush — timer shape and max-delay ────────────────────────────────

describe("SharedLibrary — schedulePush timer shape", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  function makeLib(buildStore, compStore) {
    return new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
  }

  test("stores timer as {id, scheduledAt} object", () => {
    const lib = makeLib(mockBuildStore(), mockCompStore());
    const item = { id: "b1", folderId: "f1", title: "Build" };
    const before = Date.now();
    lib.schedulePush("build", item, 5000);
    const timer = lib._pushTimers.get("build:b1");
    expect(timer).toBeDefined();
    expect(typeof timer.id).not.toBe("undefined");
    expect(timer.scheduledAt).toBeGreaterThanOrEqual(before);
    expect(timer.scheduledAt).toBeLessThanOrEqual(Date.now());
    clearTimeout(timer.id);
  });

  test("reschedules debounce when called again within max-delay", () => {
    jest.useFakeTimers();
    try {
      const lib = makeLib(mockBuildStore(), mockCompStore());
      const item = { id: "b1", folderId: "f1", title: "Build" };
      lib.schedulePush("build", item, 2000, 10_000);
      const firstTimer = lib._pushTimers.get("build:b1");
      lib.schedulePush("build", item, 2000, 10_000);
      const secondTimer = lib._pushTimers.get("build:b1");
      // Timer ID should have changed (re-scheduled)
      expect(secondTimer.id).not.toBe(firstTimer.id);
    } finally {
      jest.useRealTimers();
    }
  });

  test("does not reschedule when elapsed >= maxDelayMs - delayMs (lets existing timer fire)", () => {
    jest.useFakeTimers();
    try {
      const lib = makeLib(mockBuildStore(), mockCompStore());
      const item = { id: "b1", folderId: "f1", title: "Build" };
      const delayMs = 2000;
      const maxDelayMs = 4000;
      lib.schedulePush("build", item, delayMs, maxDelayMs);
      const firstTimer = lib._pushTimers.get("build:b1");

      // Simulate that enough time has passed to trigger the max-delay ceiling
      // scheduledAt set to enough in the past that elapsed >= maxDelayMs - delayMs
      firstTimer.scheduledAt = Date.now() - (maxDelayMs - delayMs + 1);

      lib.schedulePush("build", item, delayMs, maxDelayMs);
      const secondTimer = lib._pushTimers.get("build:b1");

      // Timer should NOT have changed — early return, existing timer kept
      expect(secondTimer.id).toBe(firstTimer.id);
    } finally {
      jest.useRealTimers();
    }
  });

  test("comp timer stored under 'comp:<id>' key", () => {
    const lib = makeLib(mockBuildStore(), mockCompStore());
    const item = { id: "c1", folderId: "f1", name: "Comp" };
    lib.schedulePush("comp", item, 5000);
    expect(lib._pushTimers.has("comp:c1")).toBe(true);
    clearTimeout(lib._pushTimers.get("comp:c1").id);
  });
});

// ─── schedulePushFolderMeta — timer shape ────────────────────────────────────

describe("SharedLibrary — schedulePushFolderMeta timer shape", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("stores timer as {id, scheduledAt} object under meta:<folderId> key", () => {
    const lib = new SharedLibrary({ buildStore: mockBuildStore(), compStore: mockCompStore(), folderStore, syncStore });
    const before = Date.now();
    lib.schedulePushFolderMeta("f1", 5000);
    const timer = lib._pushTimers.get("meta:f1");
    expect(timer).toBeDefined();
    expect(typeof timer.id).not.toBe("undefined");
    expect(timer.scheduledAt).toBeGreaterThanOrEqual(before);
    clearTimeout(timer.id);
  });

  test("replaces existing meta timer (not duplicated)", () => {
    jest.useFakeTimers();
    try {
      const lib = new SharedLibrary({ buildStore: mockBuildStore(), compStore: mockCompStore(), folderStore, syncStore });
      lib.schedulePushFolderMeta("f1", 2000);
      const first = lib._pushTimers.get("meta:f1");
      lib.schedulePushFolderMeta("f1", 2000);
      const second = lib._pushTimers.get("meta:f1");
      expect(second.id).not.toBe(first.id);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── unshareFolder — cancels pending timers ──────────────────────────────────

describe("SharedLibrary — unshareFolder timer cancellation", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("clears all pending push timers before unsharing", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });

    // Queue up two timers (build + meta)
    lib.schedulePush("build", { id: "b1", folderId: folder.id }, 60_000);
    lib.schedulePushFolderMeta(folder.id, 60_000);
    expect(lib._pushTimers.size).toBe(2);

    await lib.unshareFolder(folder.id);

    // All timers should have been cancelled and removed
    expect(lib._pushTimers.size).toBe(0);
  });

  test("handles timer objects with {id, scheduledAt} shape without throwing", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);
    const folder = await folderStore.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });

    githubApi.getRepoTree.mockResolvedValue([]);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });

    // Manually insert a timer with the object shape to confirm clearTimeout(timer?.id ?? timer) works
    const tid = setTimeout(() => {}, 60_000);
    lib._pushTimers.set("build:test", { id: tid, scheduledAt: Date.now() });

    await expect(lib.unshareFolder(folder.id)).resolves.not.toThrow();
    expect(lib._pushTimers.size).toBe(0);
  });
});

// ─── subfolder re-parenting on disconnect-reconnect ──────────────────────────

describe("SharedLibrary — subfolder re-parenting on reconnect", () => {
  let dir, syncStore, folderStore;
  beforeEach(async () => {
    dir = await makeTempDir();
    syncStore = new SyncStore(dir);
    folderStore = new FolderStore(dir);
    await syncStore.init();
    await folderStore.init();
  });
  afterEach(() => cleanupDir(dir));

  test("re-links subfolder under shared root when it exists with wrong parentId", async () => {
    // Scenario: user previously had 'sub-folder' as a root-level shared folder,
    // then disconnected (shared: false, parentId: null). Now the org structure has
    // 'sub-folder' as a SUBFOLDER of 'root-folder'. On pull, the subfolder must be
    // re-linked under root-folder so builds appear in the right place.
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);

    // Root shared folder
    const rootFolder = await folderStore.upsertFolder({
      id: "root-folder",
      name: "Org Root",
      shared: true,
      orgName: "test-org",
    });

    // Subfolder exists locally with no parent (former root-level shared folder after disconnect)
    await folderStore.upsertFolder({
      id: "sub-folder",
      name: "SubFolderA",
      // parentId: null — simulating post-disconnect state
    });

    // Remote: build stored under root-folder path but with folderId = sub-folder
    githubApi.getRepoTree.mockResolvedValue([
      { path: "folders/root-folder/builds/b1.json", sha: "b1-sha" },
    ]);
    githubApi.getFileContents.mockImplementation(async (_token, _org, _repo, filePath) => {
      if (filePath === "folders/root-folder/builds/b1.json") {
        return {
          content: JSON.stringify({
            id: "b1",
            title: "Dev Build",
            folderId: "sub-folder",
            _syncSubFolderName: "SubFolderA",
          }),
          sha: "b1-sha",
        };
      }
      return { content: null };
    });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(rootFolder.id);

    // The subfolder should now be parented under root-folder
    const folders = await folderStore.listFolders();
    const subFolder = folders.find((f) => f.id === "sub-folder");
    expect(subFolder).toBeDefined();
    expect(subFolder.parentId).toBe("root-folder");

    // Build should be placed in the subfolder
    expect(buildStore.upsertBuild).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b1", folderId: "sub-folder" })
    );
  });

  test("does not re-link subfolder when parentId is already correct", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);

    const rootFolder = await folderStore.upsertFolder({
      id: "root-folder",
      name: "Org Root",
      shared: true,
      orgName: "test-org",
    });

    // Subfolder correctly parented under root-folder
    await folderStore.upsertFolder({
      id: "sub-folder",
      name: "SubFolderA",
      parentId: "root-folder",
    });

    githubApi.getRepoTree.mockResolvedValue([
      { path: "folders/root-folder/builds/b1.json", sha: "b1-sha" },
    ]);
    githubApi.getFileContents.mockImplementation(async (_token, _org, _repo, filePath) => {
      if (filePath === "folders/root-folder/builds/b1.json") {
        return {
          content: JSON.stringify({
            id: "b1",
            title: "Dev Build",
            folderId: "sub-folder",
          }),
          sha: "b1-sha",
        };
      }
      return { content: null };
    });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(rootFolder.id);

    // parentId should remain correct
    const folders = await folderStore.listFolders();
    const subFolder = folders.find((f) => f.id === "sub-folder");
    expect(subFolder.parentId).toBe("root-folder");
  });

  test("re-links subfolder from meta.subfolders when it has wrong parentId", async () => {
    const buildStore = mockBuildStore([]);
    const compStore = mockCompStore([]);

    const rootFolder = await folderStore.upsertFolder({
      id: "root-folder",
      name: "Org Root",
      shared: true,
      orgName: "test-org",
    });

    // Subfolder exists at root level (wrong parentId)
    await folderStore.upsertFolder({
      id: "sub-folder",
      name: "SubFolderA",
      // parentId: null — root-level personal folder after disconnect
    });

    // Remote: meta.json lists sub-folder as a subfolder of root-folder
    const metaContent = JSON.stringify({
      id: "root-folder",
      name: "Org Root",
      sortOrder: 0,
      subfolders: [{ id: "sub-folder", name: "SubFolderA", parentId: "root-folder" }],
    });

    githubApi.getRepoTree.mockResolvedValue([
      { path: "folders/root-folder/meta.json", sha: "meta-sha-new" },
    ]);
    githubApi.getFileContents.mockImplementation(async (_token, _org, _repo, filePath) => {
      if (filePath === "folders/root-folder/meta.json") {
        return { content: metaContent, sha: "meta-sha-new" };
      }
      return { content: null };
    });

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    await lib.pullFolder(rootFolder.id);

    const folders = await folderStore.listFolders();
    const subFolder = folders.find((f) => f.id === "sub-folder");
    expect(subFolder).toBeDefined();
    expect(subFolder.parentId).toBe("root-folder");
  });
});
