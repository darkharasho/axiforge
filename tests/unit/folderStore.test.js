"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { FolderStore } = require("../../src/main/folderStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-folder-"));
  const store = new FolderStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// FolderStore CRUD
// ---------------------------------------------------------------------------

describe("FolderStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates folders.json if missing", async () => {
    const content = await fs.readFile(
      path.join(dir, "folders.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual([]);
  });

  test("preserves existing folders.json", async () => {
    const existing = [{ id: "x", name: "Test" }];
    await fs.writeFile(
      path.join(dir, "folders.json"),
      JSON.stringify(existing),
    );
    const store2 = new FolderStore(dir);
    await store2.init();
    const folders = await store2.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe("x");
  });
});

describe("FolderStore — listFolders", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns empty array initially", async () => {
    expect(await store.listFolders()).toEqual([]);
  });
});

describe("FolderStore — upsertFolder", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates folder with generated id", async () => {
    const folder = await store.upsertFolder({ name: "Raid Builds" });
    expect(folder.id).toBeTruthy();
    expect(folder.name).toBe("Raid Builds");
    expect(folder.parentId).toBe(null);
    expect(folder.sortOrder).toBe(0);
    expect(folder.createdAt).toBeTruthy();
    expect(folder.updatedAt).toBeTruthy();
  });

  test("updates existing folder by id", async () => {
    const created = await store.upsertFolder({ name: "Old Name" });
    const updated = await store.upsertFolder({
      id: created.id,
      name: "New Name",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("New Name");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    const folders = await store.listFolders();
    expect(folders).toHaveLength(1);
  });

  test("sets parentId when provided", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    const child = await store.upsertFolder({
      name: "Child",
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
  });

  test("rejects nesting deeper than 3 levels", async () => {
    const lvl1 = await store.upsertFolder({ name: "Level 1" });
    const lvl2 = await store.upsertFolder({
      name: "Level 2",
      parentId: lvl1.id,
    });
    const lvl3 = await store.upsertFolder({
      name: "Level 3",
      parentId: lvl2.id,
    });
    await expect(
      store.upsertFolder({ name: "Level 4", parentId: lvl3.id }),
    ).rejects.toThrow("Maximum folder nesting depth");
  });

  test("truncates name to 100 characters", async () => {
    const longName = "A".repeat(150);
    const folder = await store.upsertFolder({ name: longName });
    expect(folder.name).toBe("A".repeat(100));
  });
});

describe("FolderStore — deleteFolder", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes folder by id", async () => {
    const folder = await store.upsertFolder({ name: "Doomed" });
    await store.deleteFolder(folder.id);
    expect(await store.listFolders()).toEqual([]);
  });

  test("removes sub-folders when parent deleted", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    await store.upsertFolder({ name: "Child", parentId: parent.id });
    await store.deleteFolder(parent.id);
    expect(await store.listFolders()).toEqual([]);
  });

  test("returns ids of all deleted folders", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    const child = await store.upsertFolder({
      name: "Child",
      parentId: parent.id,
    });
    const deleted = await store.deleteFolder(parent.id);
    expect(deleted.sort()).toEqual([parent.id, child.id].sort());
  });

  test("no-op for unknown id", async () => {
    const deleted = await store.deleteFolder("nonexistent");
    expect(deleted).toEqual([]);
  });
});

describe("FolderStore — reorderFolders", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("updates sortOrder for batch of folders", async () => {
    const a = await store.upsertFolder({ name: "A" });
    const b = await store.upsertFolder({ name: "B" });
    await store.reorderFolders([
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 1 },
    ]);
    const folders = await store.listFolders();
    expect(folders.find((f) => f.id === a.id).sortOrder).toBe(2);
    expect(folders.find((f) => f.id === b.id).sortOrder).toBe(1);
  });
});

describe("FolderStore — folderExists", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns true for existing folder", async () => {
    const folder = await store.upsertFolder({ name: "Exists" });
    expect(await store.folderExists(folder.id)).toBe(true);
  });

  test("returns false for nonexistent folder", async () => {
    expect(await store.folderExists("nope")).toBe(false);
  });
});
