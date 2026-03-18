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

  test("truncates notes to 12000 chars", async () => {
    const comp = await store.upsertComp(makeComp({ notes: "x".repeat(15000) }));
    expect(comp.notes.length).toBe(12000);
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
