"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { SyncStore } = require("../../src/main/syncStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-sync-"));
  const store = new SyncStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("SyncStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates syncState.json with empty object if missing", async () => {
    const content = await fs.readFile(path.join(dir, "syncState.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({});
  });

  test("preserves existing syncState.json", async () => {
    const existing = { "folder-1": { remoteShas: { "meta": "abc" } } };
    await fs.writeFile(path.join(dir, "syncState.json"), JSON.stringify(existing));
    const store2 = new SyncStore(dir);
    await store2.init();
    const state = await store2.getState();
    expect(state).toEqual(existing);
  });
});

describe("SyncStore — getShas / setShas", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("getShas returns empty object for unknown folder", async () => {
    expect(await store.getShas("unknown")).toEqual({});
  });

  test("setShas persists and retrieves SHA map", async () => {
    const shas = { "builds/b1": "sha-111", "comps/c1": "sha-222" };
    await store.setShas("folder-1", shas);
    expect(await store.getShas("folder-1")).toEqual(shas);
  });

  test("setSha updates a single entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111" });
    await store.setSha("folder-1", "builds/b2", "sha-222");
    const shas = await store.getShas("folder-1");
    expect(shas).toEqual({ "builds/b1": "sha-111", "builds/b2": "sha-222" });
  });

  test("removeSha deletes a single entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111", "builds/b2": "sha-222" });
    await store.removeSha("folder-1", "builds/b1");
    expect(await store.getShas("folder-1")).toEqual({ "builds/b2": "sha-222" });
  });

  test("removeFolder removes entire folder entry", async () => {
    await store.setShas("folder-1", { "builds/b1": "sha-111" });
    await store.removeFolder("folder-1");
    expect(await store.getShas("folder-1")).toEqual({});
  });
});
