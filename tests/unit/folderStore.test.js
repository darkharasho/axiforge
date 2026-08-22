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

describe("FolderStore — touchFolders", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("updates updatedAt for specified folders", async () => {
    const folder = await store.upsertFolder({ name: "Test" });
    const originalUpdated = folder.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 5));
    await store.touchFolders([folder.id]);
    const folders = await store.listFolders();
    const updated = folders.find((f) => f.id === folder.id);
    expect(updated.updatedAt).not.toBe(originalUpdated);
    expect(updated.createdAt).toBe(folder.createdAt);
  });

  test("does not touch unspecified folders", async () => {
    const a = await store.upsertFolder({ name: "A" });
    const b = await store.upsertFolder({ name: "B" });
    await new Promise((r) => setTimeout(r, 5));
    await store.touchFolders([a.id]);
    const folders = await store.listFolders();
    expect(folders.find((f) => f.id === b.id).updatedAt).toBe(b.updatedAt);
  });

  test("no-op for empty array", async () => {
    await store.touchFolders([]);
    // Should not throw
  });
});

describe("FolderStore — shared folder fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("upsertFolder preserves shared field on create", async () => {
    const folder = await store.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });
    expect(folder.shared).toBe(true);
    expect(folder.orgName).toBe("test-org");
  });

  test("upsertFolder preserves shared fields on update", async () => {
    const folder = await store.upsertFolder({ name: "Shared", shared: true, orgName: "test-org" });
    const updated = await store.upsertFolder({ id: folder.id, name: "Renamed", shared: true, orgName: "test-org", lastSyncedAt: "2026-01-01T00:00:00Z" });
    expect(updated.shared).toBe(true);
    expect(updated.orgName).toBe("test-org");
    expect(updated.lastSyncedAt).toBe("2026-01-01T00:00:00Z");
  });

  test("shared defaults to undefined when not provided", async () => {
    const folder = await store.upsertFolder({ name: "Personal" });
    expect(folder.shared).toBeUndefined();
  });

  test("shared folders cannot have a parentId", async () => {
    const parent = await store.upsertFolder({ name: "Parent" });
    await expect(
      store.upsertFolder({ name: "Shared", shared: true, orgName: "org", parentId: parent.id })
    ).rejects.toThrow("Shared folders must be top-level");
  });

  test("non-shared folders can nest under shared folders", async () => {
    const shared = await store.upsertFolder({ name: "Shared", shared: true, orgName: "org" });
    const child = await store.upsertFolder({ name: "Child", parentId: shared.id });
    expect(child.parentId).toBe(shared.id);
    expect(child.shared).toBeUndefined();
  });

  test("caller-specified id is preserved on create", async () => {
    const folder = await store.upsertFolder({ id: "custom-id-123", name: "Remote", shared: true, orgName: "org" });
    expect(folder.id).toBe("custom-id-123");
  });
});

// ---------------------------------------------------------------------------
// FolderStore — concurrent write safety
// ---------------------------------------------------------------------------

describe("FolderStore — concurrent write safety", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("concurrent upsertFolder calls do not lose subfolder changes", async () => {
    // Simulate the race between pullAll updating the root shared folder
    // (lastSyncedAt) and the user creating a subfolder via folders:save.
    // Without write serialization the last write wins and the subfolder
    // created by the IPC handler is silently dropped.
    await store.upsertFolder({
      id: "shared-root",
      name: "Shared Root",
      shared: true,
      orgName: "test-org",
    });

    // Fire N concurrent subfolder creations. Without a write queue each call
    // reads the same initial state and the last write clobbers the rest.
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.upsertFolder({ name: `Sub${i}`, parentId: "shared-root" }),
      ),
    );

    const folders = await store.listFolders();
    const subs = folders.filter((f) => f.parentId === "shared-root");
    expect(subs).toHaveLength(N);
  });
});

describe("team fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("clearLegacyFields removes orgName/lastSyncedAt", async () => {
    await store.upsertFolder({ id: "legacy", name: "Old", shared: true, orgName: "gw2eww", lastSyncedAt: "2026-01-01T00:00:00.000Z" });
    const cleared = await store.clearLegacyFields("legacy");
    expect(cleared.orgName).toBeUndefined();
    expect(cleared.lastSyncedAt).toBeUndefined();
    expect(cleared).toMatchObject({ id: "legacy", name: "Old", shared: true });
    const stored = (await store.listFolders()).find((f) => f.id === "legacy");
    expect(stored.orgName).toBeUndefined();
    expect(stored.lastSyncedAt).toBeUndefined();
    // unknown ids are a no-op, not a throw
    expect(await store.clearLegacyFields("nope")).toBeNull();
  });

  test("clearLegacyFields bumps updatedAt like every other mutator", async () => {
    const before = await store.upsertFolder({ id: "legacy", name: "Old", shared: true, orgName: "gw2eww" });
    const cleared = await store.clearLegacyFields("legacy");
    expect(new Date(cleared.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime() - 1);
    expect(cleared.updatedAt).not.toBe(before.updatedAt);
    // a no-op clear must not churn updatedAt
    const again = await store.clearLegacyFields("legacy");
    expect(again.updatedAt).toBe(cleared.updatedAt);
  });

  test("persists teamId/role on create and update; null clears", async () => {
    const f = await store.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    expect(f).toMatchObject({ shared: true, teamId: "team-1", role: "owner" });
    const kept = await store.upsertFolder({ id: "team-1", name: "EWW renamed", shared: true });
    expect(kept).toMatchObject({ teamId: "team-1", role: "owner" });
    const cleared = await store.upsertFolder({ id: "team-1", name: "EWW", shared: false, teamId: null, role: null });
    expect(cleared.teamId).toBeUndefined();
    expect(cleared.role).toBeUndefined();
    expect(cleared.shared).toBe(false);
  });
});
