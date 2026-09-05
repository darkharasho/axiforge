"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
const { createArchive } = require("../../src/main/archive");

async function makeHarness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-archive-"));
  const buildStore = new BuildStore(dir);
  const compStore = new CompStore(dir);
  const folderStore = new FolderStore(dir);
  await buildStore.init();
  await compStore.init();
  await folderStore.init();
  const archive = createArchive({ buildStore, compStore, folderStore });
  return { dir, archive, buildStore, compStore, folderStore };
}

let h;
beforeEach(async () => { h = await makeHarness(); });
afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

// The single property that separates the archive from the trash. Everything
// else in this file is bookkeeping; this is the design.
describe("an archived record is still a live record", () => {
  test("archiving a build does NOT remove it from listBuilds", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.archive.archiveBuilds([build.id]);

    const listed = await h.buildStore.listBuilds();
    expect(listed.map((b) => b.id)).toEqual([build.id]);
    expect(listed[0].archivedAt).toBeTruthy();
  });

  test("a comp still resolves a build that was archived", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    const comp = await h.compStore.upsertComp({ name: "Zerg", buildIds: [build.id] });
    await h.archive.archiveBuilds([build.id]);

    const live = await h.buildStore.listBuilds();
    const saved = (await h.compStore.listComps()).find((c) => c.id === comp.id);
    // If this ever fails, archiving quietly guts every comp using the build.
    expect(saved.buildIds.every((id) => live.some((b) => b.id === id))).toBe(true);
  });

  test("archiving preserves everything about the build, including its published link", async () => {
    const build = await h.buildStore.upsertBuild({
      title: "Scourge", profession: "Necromancer", publishedFileId: "abc123", publishedKey: "k",
    });
    await h.archive.archiveBuilds([build.id]);
    const saved = (await h.buildStore.listBuilds())[0];
    expect(saved.publishedFileId).toBe("abc123");
    expect(saved.publishedKey).toBe("k");
    expect(saved.title).toBe("Scourge");
  });
});

describe("archive rows", () => {
  test("lists what was archived, newest first", async () => {
    const a = await h.buildStore.upsertBuild({ title: "Old", profession: "Guardian" });
    const b = await h.compStore.upsertComp({ name: "Newer" });
    await h.archive.archiveBuilds([a.id], { at: "2026-01-01T00:00:00.000Z" });
    await h.archive.archiveComps([b.id], { at: "2026-02-01T00:00:00.000Z" });

    const rows = await h.archive.listArchive();
    expect(rows.map((r) => [r.type, r.name])).toEqual([
      ["comp", "Newer"],
      ["build", "Old"],
    ]);
    expect(rows[1].profession).toBe("Guardian");
  });

  test("a build that was archived and then deleted belongs to the trash, not the archive", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.archive.archiveBuilds([build.id]);
    await h.buildStore.trashBuilds([build.id]);

    // Otherwise it shows in both places, and "Unarchive" would silently
    // resurrect something the user deleted.
    expect(await h.archive.listArchive()).toEqual([]);
    expect(await h.buildStore.listArchivedBuilds()).toEqual([]);
  });

  test("archiving something twice does not restamp it", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.archive.archiveBuilds([build.id], { at: "2026-01-01T00:00:00.000Z" });
    await h.archive.archiveBuilds([build.id], { at: "2026-06-01T00:00:00.000Z" });
    expect((await h.archive.listArchive())[0].archivedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("archiving a folder takes its contents with it", () => {
  async function folderWithStuff() {
    const parent = await h.folderStore.upsertFolder({ name: "Season 3" });
    const child = await h.folderStore.upsertFolder({ name: "Zerg", parentId: parent.id });
    const build = await h.buildStore.upsertBuild({ title: "Scourge", folderId: child.id });
    const comp = await h.compStore.upsertComp({ name: "Squad", folderId: parent.id });
    return { parent, child, build, comp };
  }

  test("the subtree, the builds and the comps are all stamped", async () => {
    const { parent, child, build, comp } = await folderWithStuff();
    const result = await h.archive.archiveFolder(parent.id);

    expect(new Set(result.folders)).toEqual(new Set([parent.id, child.id]));
    expect(result.builds).toEqual([build.id]);
    expect(result.comps).toEqual([comp.id]);
    // Leaving a build behind would strand it: its folder is gone from the
    // library, so nothing would ever draw it again.
    expect((await h.buildStore.listArchivedBuilds()).map((b) => b.id)).toEqual([build.id]);
  });

  test("only the folder the user picked gets a row", async () => {
    const { parent } = await folderWithStuff();
    await h.archive.archiveFolder(parent.id);
    const rows = await h.archive.listArchive();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "folder", name: "Season 3" });
  });

  test("un-archiving any one member brings the whole batch back", async () => {
    const { parent, child, build, comp } = await folderWithStuff();
    await h.archive.archiveFolder(parent.id);

    // Ask for just the build; the batch has to come with it.
    await h.archive.unarchive({ builds: [build.id] });

    expect(await h.archive.listArchive()).toEqual([]);
    expect(await h.buildStore.listArchivedBuilds()).toEqual([]);
    expect(await h.compStore.listArchivedComps()).toEqual([]);
    expect(await h.folderStore.listArchivedFolders()).toEqual([]);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === child.id).parentId).toBe(parent.id);
    expect((await h.compStore.listComps()).find((c) => c.id === comp.id).archivedAt).toBeUndefined();
  });

  test("a folder already in the trash is not dragged into the archive batch", async () => {
    const { parent, child } = await folderWithStuff();
    await h.folderStore.trashFolderTree(child.id, { batchId: "t1" });
    await h.archive.archiveFolder(parent.id);

    // Un-archiving must not be a back door that un-trashes it.
    const trashed = await h.folderStore.listTrashedFolders();
    expect(trashed.map((f) => f.id)).toEqual([child.id]);
    expect((await h.folderStore.listArchivedFolders()).map((f) => f.id)).toEqual([parent.id]);
  });
});

describe("un-archiving", () => {
  test("clears the stamp and puts the record back in the library view", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.archive.archiveBuilds([build.id]);
    await h.archive.unarchive({ builds: [build.id] });

    const saved = (await h.buildStore.listBuilds())[0];
    expect(saved.archivedAt).toBeNull();
    expect(saved.archiveBatchId).toBe("");
    expect(saved.archiveRoot).toBe(false);
    expect(await h.archive.listArchive()).toEqual([]);
  });

  test("independently archived items do not come back together", async () => {
    const a = await h.buildStore.upsertBuild({ title: "A" });
    const b = await h.buildStore.upsertBuild({ title: "B" });
    await h.archive.archiveBuilds([a.id]);
    await h.archive.archiveBuilds([b.id]);

    await h.archive.unarchive({ builds: [a.id] });
    expect((await h.buildStore.listArchivedBuilds()).map((x) => x.id)).toEqual([b.id]);
  });

  test("archiving two builds in one gesture un-archives them in one gesture", async () => {
    const a = await h.buildStore.upsertBuild({ title: "A" });
    const b = await h.buildStore.upsertBuild({ title: "B" });
    await h.archive.archiveBuilds([a.id, b.id]);

    await h.archive.unarchive({ builds: [a.id] });
    expect(await h.buildStore.listArchivedBuilds()).toEqual([]);
  });
});

// A team pull upserts the synced body, which deliberately carries no archive
// stamp. Without the carry-over in upsertBuild, a teammate's edit would drag an
// archived build back into your library -- and a trashed one back from the dead.
describe("a partial upsert does not clear local stamps", () => {
  test("archive stamp survives", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge", profession: "Necromancer" });
    await h.archive.archiveBuilds([build.id]);

    await h.buildStore.upsertBuild({ id: build.id, title: "Scourge (edited)", profession: "Necromancer" });

    const saved = (await h.buildStore.listBuilds())[0];
    expect(saved.title).toBe("Scourge (edited)");
    expect(saved.archivedAt).toBeTruthy();
  });

  test("trash stamp survives", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.buildStore.trashBuilds([build.id], { batchId: "b1" });

    await h.buildStore.upsertBuild({ id: build.id, title: "Scourge (edited)" });

    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect((await h.buildStore.listTrashedBuilds())[0].title).toBe("Scourge (edited)");
  });
});
