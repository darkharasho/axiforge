"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "axiforge-trash2-"));
}

describe("CompStore — trash", () => {
  let store;
  let dir;
  beforeEach(async () => {
    dir = await tempDir();
    store = new CompStore(dir);
    await store.init();
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test("a trashed comp leaves listComps but stays in the trash", async () => {
    const keep = await store.upsertComp({ name: "Keep" });
    const doomed = await store.upsertComp({ name: "Doomed" });

    await store.trashComps([doomed.id]);

    expect((await store.listComps()).map((c) => c.id)).toEqual([keep.id]);
    expect((await store.listTrashedComps()).map((c) => c.id)).toEqual([doomed.id]);
  });

  test("restore brings the comp back with its party lines intact", async () => {
    const comp = await store.upsertComp({
      name: "Zerg",
      gameMode: "wvw",
      buildIds: ["b1"],
      partyLines: [{ id: "l1", capacity: 5, slots: ["b1", null] }],
    });
    await store.trashComps([comp.id]);
    await store.restoreComps([comp.id]);

    const [back] = await store.listComps();
    expect(back).toMatchObject({
      id: comp.id,
      name: "Zerg",
      gameMode: "wvw",
      buildIds: ["b1"],
      partyLines: [{ id: "l1", slots: ["b1", null] }],
    });
    expect(back.deletedAt).toBeFalsy();
  });

  // Same data-loss trap as builds: upsertComp rewrites the whole array.
  test("saving another comp does not erase trashed comps", async () => {
    const doomed = await store.upsertComp({ name: "Doomed" });
    await store.trashComps([doomed.id]);

    await store.upsertComp({ name: "Brand new" });

    expect((await store.listTrashedComps()).map((c) => c.id)).toEqual([doomed.id]);
  });

  test("permanently deleting one comp does not erase trashed comps", async () => {
    const doomed = await store.upsertComp({ name: "Doomed" });
    const other = await store.upsertComp({ name: "Hard deleted" });
    await store.trashComps([doomed.id]);

    await store.deleteComp(other.id);

    expect((await store.listTrashedComps()).map((c) => c.id)).toEqual([doomed.id]);
  });

  test("purge removes only comps trashed before the cutoff", async () => {
    const old = await store.upsertComp({ name: "Old" });
    const recent = await store.upsertComp({ name: "Recent" });
    await store.trashComps([old.id], { at: "2026-01-01T00:00:00.000Z" });
    await store.trashComps([recent.id], { at: "2026-09-01T00:00:00.000Z" });

    const purged = await store.purgeTrashedComps("2026-06-01T00:00:00.000Z");

    expect(purged).toEqual([old.id]);
    expect((await store.listTrashedComps()).map((c) => c.id)).toEqual([recent.id]);
  });
});

describe("FolderStore — trash", () => {
  let store;
  let dir;
  beforeEach(async () => {
    dir = await tempDir();
    store = new FolderStore(dir);
    await store.init();
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  async function tree() {
    const root = await store.upsertFolder({ name: "WvW" });
    const mid = await store.upsertFolder({ name: "Zerg", parentId: root.id });
    const leaf = await store.upsertFolder({ name: "Frontline", parentId: mid.id });
    const other = await store.upsertFolder({ name: "PvE" });
    return { root, mid, leaf, other };
  }

  test("trashing a folder trashes its whole subtree", async () => {
    const { root, mid, leaf, other } = await tree();

    const trashed = await store.trashFolderTree(root.id);

    expect(trashed.sort()).toEqual([root.id, mid.id, leaf.id].sort());
    expect((await store.listFolders()).map((f) => f.id)).toEqual([other.id]);
  });

  test("the subtree shares one batch id so restore is a single act", async () => {
    const { root } = await tree();

    await store.trashFolderTree(root.id, { batchId: "batch-1" });

    const trashed = await store.listTrashedFolders();
    expect(trashed.every((f) => f.trashBatchId === "batch-1")).toBe(true);
  });

  // The trash view lists what the user actually deleted — one row for the
  // folder, not one row per descendant it dragged along.
  test("only the folder the user deleted is marked as the batch root", async () => {
    const { root, mid, leaf } = await tree();

    await store.trashFolderTree(root.id);

    const trashed = await store.listTrashedFolders();
    expect(trashed.filter((f) => f.trashRoot).map((f) => f.id)).toEqual([root.id]);
    expect(trashed.filter((f) => !f.trashRoot).map((f) => f.id).sort())
      .toEqual([mid.id, leaf.id].sort());
  });

  test("restoring the subtree puts every folder back under its original parent", async () => {
    const { root, mid, leaf } = await tree();
    await store.trashFolderTree(root.id);

    await store.restoreFolders([root.id, mid.id, leaf.id]);

    const folders = await store.listFolders();
    expect(folders.find((f) => f.id === mid.id).parentId).toBe(root.id);
    expect(folders.find((f) => f.id === leaf.id).parentId).toBe(mid.id);
  });

  test("saving another folder does not erase trashed folders", async () => {
    const { root } = await tree();
    await store.trashFolderTree(root.id);

    await store.upsertFolder({ name: "Brand new" });

    expect((await store.listTrashedFolders()).length).toBe(3);
  });

  // Depth is capped at 3; a trashed subtree must not count against a live one.
  test("a trashed folder does not block creating a folder at the same depth", async () => {
    const { root, mid } = await tree();
    await store.trashFolderTree(root.id);

    const fresh = await store.upsertFolder({ name: "Fresh" });
    await expect(store.upsertFolder({ name: "Child", parentId: fresh.id })).resolves.toBeDefined();
    expect(mid.parentId).toBe(root.id);
  });

  test("purge removes only folders trashed before the cutoff", async () => {
    const { root, other } = await tree();
    await store.trashFolderTree(root.id, { at: "2026-01-01T00:00:00.000Z" });
    await store.trashFolderTree(other.id, { at: "2026-09-01T00:00:00.000Z" });

    const purged = await store.purgeTrashedFolders("2026-06-01T00:00:00.000Z");

    expect(purged).toHaveLength(3);
    expect((await store.listTrashedFolders()).map((f) => f.id)).toEqual([other.id]);
  });
});
