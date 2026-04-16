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

  test("returns conflict info on 409", async () => {
    const build = { id: "b1", title: "Mine", folderId: "f1" };
    const buildStore = mockBuildStore([build]);
    const compStore = mockCompStore([]);
    await folderStore.upsertFolder({ id: "f1", name: "Shared", shared: true, orgName: "test-org" });
    await syncStore.setShas("f1", { "builds/b1": "stale-sha" });

    const err = new Error("Conflict");
    err.status = 409;
    githubApi.putSharedFile.mockRejectedValue(err);

    const lib = new SharedLibrary({ buildStore, compStore, folderStore, syncStore });
    const result = await lib.pushBuild(build);

    expect(result.conflict).toBe(true);
  });
});
