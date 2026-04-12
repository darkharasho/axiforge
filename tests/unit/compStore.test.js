"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { CompStore } = require("../../src/main/compStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-comp-"));
  const store = new CompStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

function makeComp(overrides = {}) {
  return {
    name: "Test Comp",
    tags: [],
    notes: "",
    ...overrides,
  };
}

describe("CompStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates comps.json if missing", async () => {
    const content = await fs.readFile(path.join(dir, "comps.json"), "utf-8");
    expect(JSON.parse(content)).toEqual([]);
  });

  test("preserves existing comps.json", async () => {
    const existing = [{ id: "x", name: "Test" }];
    await fs.writeFile(path.join(dir, "comps.json"), JSON.stringify(existing));
    const store2 = new CompStore(dir);
    await store2.init();
    const comps = await store2.listComps();
    expect(comps).toHaveLength(1);
    expect(comps[0].id).toBe("x");
  });
});

describe("CompStore — listComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("returns empty array initially", async () => {
    expect(await store.listComps()).toEqual([]);
  });
});

describe("CompStore — upsertComp", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates a new comp with defaults", async () => {
    const comp = await store.upsertComp(makeComp());
    expect(comp.id).toBeTruthy();
    expect(comp.name).toBe("Test Comp");
    expect(comp.buildIds).toEqual([]);
    expect(comp.partyLines).toHaveLength(1);
    expect(comp.partyLines[0].capacity).toBe(5);
    expect(comp.partyLines[0].slots).toEqual([]);
    expect(comp.folderId).toBeNull();
    expect(comp.createdAt).toBeTruthy();
    expect(comp.updatedAt).toBeTruthy();
  });

  test("updates existing comp by id", async () => {
    const created = await store.upsertComp(makeComp());
    const updated = await store.upsertComp({ ...created, name: "Updated" });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Updated");
    expect(updated.createdAt).toBe(created.createdAt);
    const all = await store.listComps();
    expect(all).toHaveLength(1);
  });

  test("truncates name to 140 chars", async () => {
    const comp = await store.upsertComp(makeComp({ name: "x".repeat(200) }));
    expect(comp.name.length).toBe(140);
  });

  test("truncates notes to 100000 chars", async () => {
    const comp = await store.upsertComp(makeComp({ notes: "x".repeat(110000) }));
    expect(comp.notes.length).toBe(100000);
  });

  test("defaults gameMode to null", async () => {
    const comp = await store.upsertComp(makeComp());
    expect(comp.gameMode).toBeNull();
  });

  test("persists gameMode: pve", async () => {
    const comp = await store.upsertComp(makeComp({ gameMode: "pve" }));
    expect(comp.gameMode).toBe("pve");
  });

  test("persists gameMode: wvw", async () => {
    const comp = await store.upsertComp(makeComp({ gameMode: "wvw" }));
    expect(comp.gameMode).toBe("wvw");
  });

  test("persists gameMode null (unlocked)", async () => {
    const comp = await store.upsertComp(makeComp({ gameMode: null }));
    expect(comp.gameMode).toBeNull();
  });

  test("gameMode survives an update round-trip", async () => {
    const created = await store.upsertComp(makeComp({ gameMode: "wvw" }));
    const updated = await store.upsertComp({ ...created, name: "New Name" });
    expect(updated.gameMode).toBe("wvw");
  });

  test("normalizes invalid gameMode values to null", async () => {
    for (const bad of ["pvp", "", 0, true, {}, undefined]) {
      const comp = await store.upsertComp(makeComp({ gameMode: bad }));
      expect(comp.gameMode).toBeNull();
    }
  });
});

describe("CompStore — deleteComp", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes a comp by id", async () => {
    const comp = await store.upsertComp(makeComp());
    await store.deleteComp(comp.id);
    expect(await store.listComps()).toEqual([]);
  });
});

describe("CompStore — reorderComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("updates sortOrder for given ids", async () => {
    const a = await store.upsertComp(makeComp({ name: "A" }));
    const b = await store.upsertComp(makeComp({ name: "B" }));
    await store.reorderComps([
      { id: a.id, sortOrder: 2 },
      { id: b.id, sortOrder: 1 },
    ]);
    const comps = await store.listComps();
    expect(comps.find((c) => c.id === a.id).sortOrder).toBe(2);
    expect(comps.find((c) => c.id === b.id).sortOrder).toBe(1);
  });
});

describe("CompStore — removeBuildFromComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes a build id from buildIds and all party line slots", async () => {
    const comp = await store.upsertComp(makeComp({
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1", "b2"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b2"]);
    expect(comps[0].partyLines[0].slots).toEqual(["b2"]);
  });

  test("cleans slots even when build id is not in buildIds", async () => {
    await store.upsertComp(makeComp({
      buildIds: ["b2"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1", "b2"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b2"]);
    expect(comps[0].partyLines[0].slots).toEqual(["b2"]);
  });

  test("no-op when build id is not present", async () => {
    await store.upsertComp(makeComp({ buildIds: ["b1"], partyLines: [{ id: "pl1", capacity: 5, slots: ["b1"] }] }));
    await store.removeBuildFromComps("nonexistent");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b1"]);
    expect(comps[0].partyLines[0].slots).toEqual(["b1"]);
  });
});

describe("CompStore — published fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("persists publishedFileId, publishedKey, publishedSlug on upsert", async () => {
    const comp = await store.upsertComp(makeComp({
      publishedFileId: "file-abc-123",
      publishedKey: "key-xyz-456",
      publishedSlug: "my-cool-comp",
    }));
    expect(comp.publishedFileId).toBe("file-abc-123");
    expect(comp.publishedKey).toBe("key-xyz-456");
    expect(comp.publishedSlug).toBe("my-cool-comp");

    // survives a listComps round-trip (read back from disk)
    const comps = await store.listComps();
    expect(comps[0].publishedFileId).toBe("file-abc-123");
    expect(comps[0].publishedKey).toBe("key-xyz-456");
    expect(comps[0].publishedSlug).toBe("my-cool-comp");
  });

  test("preserves published fields when updating other fields", async () => {
    const created = await store.upsertComp(makeComp({
      publishedFileId: "file-abc-123",
      publishedKey: "key-xyz-456",
      publishedSlug: "my-cool-comp",
    }));
    // update only the name — do not pass published fields
    const updated = await store.upsertComp({ ...created, name: "Renamed", publishedFileId: undefined, publishedKey: undefined, publishedSlug: undefined });
    expect(updated.publishedFileId).toBe("file-abc-123");
    expect(updated.publishedKey).toBe("key-xyz-456");
    expect(updated.publishedSlug).toBe("my-cool-comp");
  });
});

describe("CompStore — deleteComps (batch)", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("deletes multiple comps by id array", async () => {
    const a = await store.upsertComp(makeComp({ name: "A" }));
    const b = await store.upsertComp(makeComp({ name: "B" }));
    const c = await store.upsertComp(makeComp({ name: "C" }));
    await store.deleteComps([a.id, c.id]);
    const comps = await store.listComps();
    expect(comps).toHaveLength(1);
    expect(comps[0].id).toBe(b.id);
  });

  test("no-op when ids array is empty", async () => {
    await store.upsertComp(makeComp({ name: "A" }));
    await store.deleteComps([]);
    expect(await store.listComps()).toHaveLength(1);
  });

  test("ignores non-existent ids", async () => {
    const a = await store.upsertComp(makeComp({ name: "A" }));
    await store.deleteComps(["nonexistent", a.id]);
    expect(await store.listComps()).toEqual([]);
  });
});

describe("CompStore — addTagsToComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("adds tags to multiple comps", async () => {
    const a = await store.upsertComp(makeComp({ name: "A", tags: ["existing"] }));
    const b = await store.upsertComp(makeComp({ name: "B", tags: [] }));
    await store.addTagsToComps([a.id, b.id], ["new-tag", "another"]);
    const comps = await store.listComps();
    expect(comps.find((c) => c.id === a.id).tags).toEqual(["existing", "new-tag", "another"]);
    expect(comps.find((c) => c.id === b.id).tags).toEqual(["new-tag", "another"]);
  });

  test("does not duplicate existing tags", async () => {
    const a = await store.upsertComp(makeComp({ name: "A", tags: ["t1"] }));
    await store.addTagsToComps([a.id], ["t1", "t2"]);
    const comps = await store.listComps();
    expect(comps[0].tags).toEqual(["t1", "t2"]);
  });

  test("updates updatedAt timestamp", async () => {
    const a = await store.upsertComp(makeComp({ name: "A" }));
    const before = a.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    await store.addTagsToComps([a.id], ["tag"]);
    const comps = await store.listComps();
    expect(comps[0].updatedAt).not.toBe(before);
  });
});

describe("CompStore — removeTagsFromComps", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("removes specified tags from multiple comps", async () => {
    const a = await store.upsertComp(makeComp({ name: "A", tags: ["keep", "remove"] }));
    const b = await store.upsertComp(makeComp({ name: "B", tags: ["remove", "also-keep"] }));
    await store.removeTagsFromComps([a.id, b.id], ["remove"]);
    const comps = await store.listComps();
    expect(comps.find((c) => c.id === a.id).tags).toEqual(["keep"]);
    expect(comps.find((c) => c.id === b.id).tags).toEqual(["also-keep"]);
  });

  test("no-op when tags to remove are not present", async () => {
    const a = await store.upsertComp(makeComp({ name: "A", tags: ["t1"] }));
    const before = a.updatedAt;
    await store.removeTagsFromComps([a.id], ["nonexistent"]);
    const comps = await store.listComps();
    expect(comps[0].tags).toEqual(["t1"]);
    expect(comps[0].updatedAt).toBe(before);
  });
});

describe("CompStore — removeBuildFromComps — gameMode unlock", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("clears gameMode when last build is removed", async () => {
    await store.upsertComp(makeComp({
      gameMode: "pve",
      buildIds: ["b1"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual([]);
    expect(comps[0].gameMode).toBeNull();
  });

  test("does not clear gameMode when builds remain", async () => {
    await store.upsertComp(makeComp({
      gameMode: "pve",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "pl1", capacity: 5, slots: ["b1", "b2"] }],
    }));
    await store.removeBuildFromComps("b1");
    const comps = await store.listComps();
    expect(comps[0].buildIds).toEqual(["b2"]);
    expect(comps[0].gameMode).toBe("pve");
  });
});
