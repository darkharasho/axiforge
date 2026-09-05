"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
const { BuildHistoryStore } = require("../../src/main/buildHistoryStore");
const { createTrash, RETENTION_DAYS } = require("../../src/main/trash");

async function makeHarness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-trashmod-"));
  const buildStore = new BuildStore(dir);
  const compStore = new CompStore(dir);
  const folderStore = new FolderStore(dir);
  const historyStore = new BuildHistoryStore(dir);
  await buildStore.init();
  await compStore.init();
  await folderStore.init();
  await historyStore.init();
  const trash = createTrash({ buildStore, compStore, folderStore, historyStore });
  return { dir, trash, buildStore, compStore, folderStore, historyStore };
}

describe("trash — builds", () => {
  let h;
  beforeEach(async () => { h = await makeHarness(); });
  afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

  test("trashing a build hides it from the library but keeps its history", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.historyStore.addEntry({
      buildId: build.id, authorLogin: "local", source: "local", summary: "Created", snapshot: build,
    });

    await h.trash.trashBuilds([build.id]);

    expect(await h.buildStore.listBuilds()).toEqual([]);
    // The whole reason trash beats undo: version history survives the delete.
    expect(await h.historyStore.getHistory(build.id)).toHaveLength(1);
  });

  test("trashing a build leaves its comp membership alone so restore is clean", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    const comp = await h.compStore.upsertComp({
      name: "Zerg", buildIds: [build.id], partyLines: [{ id: "l1", capacity: 5, slots: [build.id] }],
    });

    await h.trash.trashBuilds([build.id]);
    await h.trash.restore({ builds: [build.id] });

    const [back] = await h.compStore.listComps();
    expect(back.buildIds).toEqual([build.id]);
    expect(back.partyLines[0].slots).toEqual([build.id]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual([build.id]);
    expect(comp.id).toBeTruthy();
  });

  test("purging a build is where the comp unlink and history deletion finally happen", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge" });
    await h.compStore.upsertComp({
      name: "Zerg", buildIds: [build.id], partyLines: [{ id: "l1", capacity: 5, slots: [build.id] }],
    });
    await h.historyStore.addEntry({
      buildId: build.id, authorLogin: "local", source: "local", summary: "Created", snapshot: build,
    });
    await h.trash.trashBuilds([build.id]);

    await h.trash.purge({ builds: [build.id] });

    expect(await h.buildStore.listTrashedBuilds()).toEqual([]);
    const [comp] = await h.compStore.listComps();
    expect(comp.buildIds).toEqual([]);
    expect(comp.partyLines[0].slots).toEqual([]);
    expect(await h.historyStore.getHistory(build.id)).toEqual([]);
  });
});

describe("trash — folder cascade", () => {
  let h;
  let root;
  let child;
  let inRoot;
  let inChild;
  let outside;
  let compInRoot;

  beforeEach(async () => {
    h = await makeHarness();
    root = await h.folderStore.upsertFolder({ name: "WvW" });
    child = await h.folderStore.upsertFolder({ name: "Zerg", parentId: root.id });
    inRoot = await h.buildStore.upsertBuild({ title: "In root", folderId: root.id });
    inChild = await h.buildStore.upsertBuild({ title: "In child", folderId: child.id });
    outside = await h.buildStore.upsertBuild({ title: "Outside", folderId: null });
    compInRoot = await h.compStore.upsertComp({ name: "Comp", folderId: root.id });
  });
  afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

  test("trashing a folder takes its subtree, builds and comps with it", async () => {
    await h.trash.trashFolder(root.id);

    expect(await h.folderStore.listFolders()).toEqual([]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual([outside.id]);
    expect(await h.compStore.listComps()).toEqual([]);
  });

  test("the builds inside keep their folderId, so restore puts them back where they were", async () => {
    await h.trash.trashFolder(root.id);
    await h.trash.restore({ folders: [root.id] });

    const builds = await h.buildStore.listBuilds();
    expect(builds.find((b) => b.id === inRoot.id).folderId).toBe(root.id);
    expect(builds.find((b) => b.id === inChild.id).folderId).toBe(child.id);
    expect((await h.folderStore.listFolders()).map((f) => f.id).sort())
      .toEqual([root.id, child.id].sort());
    expect((await h.compStore.listComps()).map((c) => c.id)).toEqual([compInRoot.id]);
  });

  // A folder delete drags dozens of items along; the trash view should show the
  // one folder the user deleted, not a row per build inside it.
  test("the trash lists only the folder, not everything it dragged along", async () => {
    await h.trash.trashFolder(root.id);

    const items = await h.trash.listTrash();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "folder", id: root.id, name: "WvW" });
  });

  test("restoring the folder by id brings its whole batch back", async () => {
    await h.trash.trashFolder(root.id);
    const [item] = await h.trash.listTrash();

    await h.trash.restore({ folders: [item.id] });

    expect(await h.trash.listTrash()).toEqual([]);
    expect(await h.buildStore.listTrashedBuilds()).toEqual([]);
    expect(await h.compStore.listTrashedComps()).toEqual([]);
  });

  test("purging the folder clears the dangling folderId from its builds", async () => {
    await h.trash.trashFolder(root.id);

    await h.trash.purge({ folders: [root.id] });

    expect(await h.folderStore.listTrashedFolders()).toEqual([]);
    // The builds went with the folder, so they are gone too — not orphaned.
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual([outside.id]);
    expect(await h.buildStore.listTrashedBuilds()).toEqual([]);
  });

  test("a build trashed on its own is untouched by an unrelated folder restore", async () => {
    await h.trash.trashBuilds([outside.id]);
    await h.trash.trashFolder(root.id);

    await h.trash.restore({ folders: [root.id] });

    expect((await h.buildStore.listTrashedBuilds()).map((b) => b.id)).toEqual([outside.id]);
  });
});

// Restore has to land somewhere real. A folder that comes back under a parent
// that was purged in the meantime is invisible in the sidebar, which reads as
// "restore silently did nothing".
describe("trash — restoring into a container that is gone", () => {
  let h;
  beforeEach(async () => { h = await makeHarness(); });
  afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

  test("a build whose folder was purged comes back to the root, not to nowhere", async () => {
    const folder = await h.folderStore.upsertFolder({ name: "WvW" });
    const build = await h.buildStore.upsertBuild({ title: "Orphan", folderId: folder.id });
    await h.trash.trashBuilds([build.id]);
    await h.trash.trashFolder(folder.id);
    await h.trash.purge({ folders: [folder.id] });

    await h.trash.restore({ builds: [build.id] });

    const [back] = await h.buildStore.listBuilds();
    expect(back.id).toBe(build.id);
    expect(back.folderId).toBeNull();
  });

  test("a folder whose parent was purged comes back at the top level", async () => {
    const parent = await h.folderStore.upsertFolder({ name: "Parent" });
    const child = await h.folderStore.upsertFolder({ name: "Child", parentId: parent.id });
    await h.trash.trashFolder(child.id);
    await h.trash.trashFolder(parent.id);
    await h.trash.purge({ folders: [parent.id] });

    await h.trash.restore({ folders: [child.id] });

    const folders = await h.folderStore.listFolders();
    expect(folders.map((f) => f.id)).toEqual([child.id]);
    expect(folders[0].parentId).toBeNull();
  });

  test("a comp whose folder was purged comes back to the root", async () => {
    const folder = await h.folderStore.upsertFolder({ name: "WvW" });
    const comp = await h.compStore.upsertComp({ name: "Orphan comp", folderId: folder.id });
    await h.trash.trashComps([comp.id]);
    await h.trash.trashFolder(folder.id);
    await h.trash.purge({ folders: [folder.id] });

    await h.trash.restore({ comps: [comp.id] });

    const [back] = await h.compStore.listComps();
    expect(back.id).toBe(comp.id);
    expect(back.folderId).toBeNull();
  });

  test("a restore into a folder that still exists is left alone", async () => {
    const folder = await h.folderStore.upsertFolder({ name: "WvW" });
    const build = await h.buildStore.upsertBuild({ title: "Fine", folderId: folder.id });
    await h.trash.trashBuilds([build.id]);

    await h.trash.restore({ builds: [build.id] });

    expect((await h.buildStore.listBuilds())[0].folderId).toBe(folder.id);
  });
});

describe("trash — retention", () => {
  let h;
  beforeEach(async () => { h = await makeHarness(); });
  afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

  test("items older than the retention window are purged on sweep", async () => {
    const old = await h.buildStore.upsertBuild({ title: "Old" });
    const recent = await h.buildStore.upsertBuild({ title: "Recent" });
    const now = new Date("2026-09-05T00:00:00.000Z");
    const longAgo = new Date(now.getTime() - (RETENTION_DAYS + 1) * 86400000).toISOString();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    await h.buildStore.trashBuilds([old.id], { at: longAgo });
    await h.buildStore.trashBuilds([recent.id], { at: yesterday });

    await h.trash.purgeExpired(now);

    expect((await h.buildStore.listTrashedBuilds()).map((b) => b.id)).toEqual([recent.id]);
  });

  test("an item trashed exactly at the boundary is kept, not purged", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Boundary" });
    const now = new Date("2026-09-05T00:00:00.000Z");
    const exactly = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString();
    await h.buildStore.trashBuilds([build.id], { at: exactly });

    await h.trash.purgeExpired(now);

    expect((await h.buildStore.listTrashedBuilds()).map((b) => b.id)).toEqual([build.id]);
  });

  test("the sweep never touches live items", async () => {
    const live = await h.buildStore.upsertBuild({ title: "Live" });

    await h.trash.purgeExpired(new Date("2099-01-01T00:00:00.000Z"));

    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual([live.id]);
  });

  test("emptying the trash removes everything in it and nothing else", async () => {
    const live = await h.buildStore.upsertBuild({ title: "Live" });
    const doomed = await h.buildStore.upsertBuild({ title: "Doomed" });
    const comp = await h.compStore.upsertComp({ name: "Doomed comp" });
    await h.trash.trashBuilds([doomed.id]);
    await h.trash.trashComps([comp.id]);

    await h.trash.empty();

    expect(await h.trash.listTrash()).toEqual([]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual([live.id]);
  });
});

describe("trash — listing", () => {
  let h;
  beforeEach(async () => { h = await makeHarness(); });
  afterEach(async () => { await fs.rm(h.dir, { recursive: true, force: true }); });

  test("lists builds and comps with the name and date the UI needs", async () => {
    const build = await h.buildStore.upsertBuild({ title: "Scourge", profession: "Necromancer" });
    const comp = await h.compStore.upsertComp({ name: "Zerg" });
    await h.trash.trashBuilds([build.id], { at: "2026-09-01T00:00:00.000Z" });
    await h.trash.trashComps([comp.id], { at: "2026-09-02T00:00:00.000Z" });

    const items = await h.trash.listTrash();

    expect(items).toEqual([
      expect.objectContaining({ type: "comp", id: comp.id, name: "Zerg", deletedAt: "2026-09-02T00:00:00.000Z" }),
      expect.objectContaining({ type: "build", id: build.id, name: "Scourge", deletedAt: "2026-09-01T00:00:00.000Z" }),
    ]);
  });

  test("most recently deleted comes first", async () => {
    const a = await h.buildStore.upsertBuild({ title: "First" });
    const b = await h.buildStore.upsertBuild({ title: "Second" });
    await h.trash.trashBuilds([a.id], { at: "2026-01-01T00:00:00.000Z" });
    await h.trash.trashBuilds([b.id], { at: "2026-08-01T00:00:00.000Z" });

    expect((await h.trash.listTrash()).map((i) => i.name)).toEqual(["Second", "First"]);
  });
});
