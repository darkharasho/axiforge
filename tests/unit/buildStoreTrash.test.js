"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-trash-"));
  const store = new BuildStore(dir);
  await store.init();
  return { store, dir };
}

function makeBuild(overrides = {}) {
  return { title: "Test Build", profession: "Warrior", ...overrides };
}

describe("BuildStore — trash", () => {
  let store;
  let dir;
  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test("a trashed build disappears from listBuilds", async () => {
    const a = await store.upsertBuild(makeBuild({ title: "Keep" }));
    const b = await store.upsertBuild(makeBuild({ title: "Trash me" }));

    await store.trashBuilds([b.id]);

    expect((await store.listBuilds()).map((x) => x.id)).toEqual([a.id]);
  });

  test("a trashed build is still on disk, listed by listTrashedBuilds", async () => {
    const b = await store.upsertBuild(makeBuild({ title: "Trash me" }));
    await store.trashBuilds([b.id]);

    const trashed = await store.listTrashedBuilds();
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({ id: b.id, title: "Trash me" });
    expect(typeof trashed[0].deletedAt).toBe("string");
  });

  // The whole point of trash over hard delete: the record is untouched, so
  // published links and comp membership survive the round trip.
  test("restore brings the build back with its published fields intact", async () => {
    const b = await store.upsertBuild(makeBuild({
      title: "Published",
      publishedSlug: "published-build",
      publishedKey: "key-1",
      compIds: ["c1"],
    }));
    await store.trashBuilds([b.id]);
    await store.restoreBuilds([b.id]);

    const [back] = await store.listBuilds();
    expect(back).toMatchObject({
      id: b.id,
      title: "Published",
      publishedSlug: "published-build",
      publishedKey: "key-1",
      compIds: ["c1"],
    });
    expect(back.deletedAt).toBeFalsy();
    expect(await store.listTrashedBuilds()).toEqual([]);
  });

  // THE data-loss trap: every write path reads the build list, mutates it and
  // writes the whole array back. If those paths use the trash-filtered read,
  // saving any build silently erases every trashed build on disk.
  test("saving another build does not erase trashed builds", async () => {
    const doomed = await store.upsertBuild(makeBuild({ title: "Trashed" }));
    await store.trashBuilds([doomed.id]);

    await store.upsertBuild(makeBuild({ title: "Brand new" }));

    expect((await store.listTrashedBuilds()).map((b) => b.id)).toEqual([doomed.id]);
  });

  test("editing a live build does not erase trashed builds", async () => {
    const live = await store.upsertBuild(makeBuild({ title: "Live" }));
    const doomed = await store.upsertBuild(makeBuild({ title: "Trashed" }));
    await store.trashBuilds([doomed.id]);

    await store.upsertBuild({ ...live, title: "Live, renamed" });

    expect((await store.listTrashedBuilds()).map((b) => b.id)).toEqual([doomed.id]);
  });

  test("deleting a build permanently does not erase other trashed builds", async () => {
    const doomed = await store.upsertBuild(makeBuild({ title: "Trashed" }));
    const other = await store.upsertBuild(makeBuild({ title: "Hard deleted" }));
    await store.trashBuilds([doomed.id]);

    await store.deleteBuild(other.id);

    expect((await store.listTrashedBuilds()).map((b) => b.id)).toEqual([doomed.id]);
  });

  test("moving builds between folders does not touch trashed builds", async () => {
    const live = await store.upsertBuild(makeBuild({ title: "Live" }));
    const doomed = await store.upsertBuild(makeBuild({ title: "Trashed", folderId: "f1" }));
    await store.trashBuilds([doomed.id]);

    await store.moveBuilds([live.id, doomed.id], "f2");

    // The trashed build keeps the folder it was in, so restore puts it back there.
    const [trashed] = await store.listTrashedBuilds();
    expect(trashed.folderId).toBe("f1");
  });

  test("trashing records which folder the build was in so restore is faithful", async () => {
    const b = await store.upsertBuild(makeBuild({ folderId: "f1" }));
    await store.trashBuilds([b.id]);
    await store.restoreBuilds([b.id]);

    expect((await store.listBuilds())[0].folderId).toBe("f1");
  });

  test("trashing a batch stamps them with a shared batch id", async () => {
    const a = await store.upsertBuild(makeBuild({ title: "A" }));
    const b = await store.upsertBuild(makeBuild({ title: "B" }));

    await store.trashBuilds([a.id, b.id], { batchId: "batch-1" });

    const trashed = await store.listTrashedBuilds();
    expect(trashed.map((x) => x.trashBatchId)).toEqual(["batch-1", "batch-1"]);
  });

  test("purge permanently removes only items trashed before the cutoff", async () => {
    const old = await store.upsertBuild(makeBuild({ title: "Old" }));
    const recent = await store.upsertBuild(makeBuild({ title: "Recent" }));
    await store.trashBuilds([old.id], { at: "2026-01-01T00:00:00.000Z" });
    await store.trashBuilds([recent.id], { at: "2026-09-01T00:00:00.000Z" });

    const purged = await store.purgeTrashedBuilds("2026-06-01T00:00:00.000Z");

    expect(purged).toEqual([old.id]);
    expect((await store.listTrashedBuilds()).map((b) => b.id)).toEqual([recent.id]);
  });

  test("purge never touches builds that were not trashed", async () => {
    const live = await store.upsertBuild(makeBuild({ title: "Live" }));

    await store.purgeTrashedBuilds("2099-01-01T00:00:00.000Z");

    expect((await store.listBuilds()).map((b) => b.id)).toEqual([live.id]);
  });

  test("emptying the trash removes every trashed build and returns their ids", async () => {
    const live = await store.upsertBuild(makeBuild({ title: "Live" }));
    const a = await store.upsertBuild(makeBuild({ title: "A" }));
    const b = await store.upsertBuild(makeBuild({ title: "B" }));
    await store.trashBuilds([a.id, b.id]);

    const purged = await store.purgeTrashedBuilds();

    expect(purged.sort()).toEqual([a.id, b.id].sort());
    expect(await store.listTrashedBuilds()).toEqual([]);
    expect((await store.listBuilds()).map((x) => x.id)).toEqual([live.id]);
  });

  test("restoring an id that is not in the trash is a no-op, not a crash", async () => {
    const live = await store.upsertBuild(makeBuild({ title: "Live" }));
    await expect(store.restoreBuilds(["nope"])).resolves.toBeDefined();
    expect((await store.listBuilds()).map((b) => b.id)).toEqual([live.id]);
  });

  test("restore returns the builds it actually restored", async () => {
    const b = await store.upsertBuild(makeBuild({ title: "Back" }));
    await store.trashBuilds([b.id]);

    const restored = await store.restoreBuilds([b.id, "nope"]);

    expect(restored.map((x) => x.id)).toEqual([b.id]);
  });
});
