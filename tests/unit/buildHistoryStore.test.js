"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildHistoryStore } = require("../../src/main/buildHistoryStore");

// The storage half is exercised in tests/unit/history/historyStore.test.js.
// What is left here is what is specific to BUILDS: where its logs land, which
// differ it is wired to, and the v1 behaviours that still have meaning under
// the new API — author and source are recorded, deletion removes the history,
// records are isolated, concurrent writes do not drop entries, and the log
// survives a restart.
//
// The v1 cap tests are gone on purpose. There is no cap any more: a per-record
// append-only log of patches costs a few hundred bytes an edit, so throwing a
// build's fifty-first version away was a cost nobody was paying.

let dir;
let store;

function build(over = {}) {
  return {
    id: "b1",
    title: "Power Berserker",
    profession: "Warrior",
    equipment: { statPackage: "Berserker", runes: {}, slots: {}, weapons: {}, sigils: {}, infusions: {} },
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [], elite: null },
    specializations: [],
    tags: [],
    notes: "",
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-bhs-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("BuildHistoryStore — init", () => {
  test("creates the builds history directory", async () => {
    const stat = await fs.stat(path.join(dir, "history", "builds"));
    expect(stat.isDirectory()).toBe(true);
  });

  test("is idempotent", async () => {
    await store.init();
    await expect(store.init()).resolves.toBeUndefined();
  });

  test("never throws, even when the directory cannot be created", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const file = path.join(dir, "not-a-dir");
    await fs.writeFile(file, "x");
    // History must never block app launch: it logs and degrades.
    await expect(new BuildHistoryStore(file).init()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test("one log file per record, named for the build", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    await store.appendVersion({ recordId: "b2", before: null, after: build({ id: "b2" }) });
    const names = await fs.readdir(path.join(dir, "history", "builds"));
    expect(names.sort()).toEqual(["b1.jsonl", "b2.jsonl"]);
  });
});

describe("BuildHistoryStore — appendVersion", () => {
  test("records the author and the source", async () => {
    const v = await store.appendVersion({
      recordId: "b1", before: null, after: build(), author: "vette", source: "team-sync",
    });
    expect(v).toMatchObject({ author: "vette", source: "team-sync", recordId: "b1" });
  });

  test("defaults the author and source to local", async () => {
    const v = await store.appendVersion({ recordId: "b1", before: null, after: build() });
    expect(v).toMatchObject({ author: "local", source: "local" });
  });

  test("records are isolated from one another", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "one" }) });
    await store.appendVersion({ recordId: "b2", before: null, after: build({ id: "b2", title: "two" }) });
    expect((await store.listVersions("b1")).versions).toHaveLength(1);
    expect(await store.getVersion("b1", 1)).toMatchObject({ title: "one" });
    expect(await store.getVersion("b2", 1)).toMatchObject({ title: "two" });
  });

  test("the log survives a restart", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    const store2 = new BuildHistoryStore(dir);
    await store2.init();
    expect((await store2.listVersions("b1")).versions).toHaveLength(1);
    expect(await store2.getVersion("b1", 1)).toEqual(build());
  });

  test("an unknown record has no history rather than an error", async () => {
    expect(await store.listVersions("nonexistent")).toEqual({ versions: [], nextCursor: null });
  });
});

// The whole reason the structural differ exists. `majorTraitsByTier` and
// `minorTraits` embed the entire GW2 catalog of trait options, so v1's
// `JSON.stringify(before.specializations) !== JSON.stringify(after.specializations)`
// made a build the player had not touched read as "specializations changed"
// every time a game patch reworded one option's description.
describe("BuildHistoryStore — a game patch is not an edit", () => {
  function withSpecs(over = {}) {
    return build({
      specializations: [{
        id: 18,
        name: "Defense",
        majorChoices: { 1: 1293, 2: 1329, 3: 1341 },
        majorTraitsByTier: { 1: [{ id: 1293, name: "Adrenal Health", description: "Gain health." }] },
        minorTraits: [{ id: 1339, name: "Thick Skin", description: "Toughness." }],
      }],
      ...over,
    });
  }

  test("a reworded trait description writes no version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: withSpecs() });
    const patched = withSpecs();
    patched.specializations[0].majorTraitsByTier[1][0].description = "Gain health on hit.";
    patched.specializations[0].minorTraits[0].description = "Gain toughness.";
    expect(await store.appendVersion({ recordId: "b1", after: patched })).toBeNull();
    expect((await store.listVersions("b1")).versions).toHaveLength(1);
  });

  test("actually choosing a different trait does write one", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: withSpecs() });
    const edited = withSpecs();
    edited.specializations[0].majorChoices[2] = 1297;
    const v = await store.appendVersion({ recordId: "b1", after: edited });
    expect(v.ops).toEqual([{ t: "trait", line: 0, tier: 2, before: 1329, after: 1297 }]);
  });

  test("publishing a build is not an edit either", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    const published = build({ publishedSlug: "abc", publishedAt: "2026-09-01T00:00:00.000Z", buildUrl: "https://x" });
    expect(await store.appendVersion({ recordId: "b1", after: published })).toBeNull();
  });
});

describe("BuildHistoryStore — deleteHistory", () => {
  test("removes the record's history", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    await store.deleteHistory("b1");
    expect((await store.listVersions("b1")).versions).toEqual([]);
  });

  test("leaves other records alone", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    await store.appendVersion({ recordId: "b2", before: null, after: build({ id: "b2" }) });
    await store.deleteHistory("b1");
    expect((await store.listVersions("b2")).versions).toHaveLength(1);
  });

  test("the deletion is durable across a restart", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build() });
    await store.deleteHistory("b1");
    const store2 = new BuildHistoryStore(dir);
    await store2.init();
    expect((await store2.listVersions("b1")).versions).toEqual([]);
  });

  test("deleting an unknown record is a no-op", async () => {
    await expect(store.deleteHistory("nonexistent")).resolves.toBeUndefined();
  });
});

describe("BuildHistoryStore — concurrency", () => {
  test("concurrent appends to one record do not drop versions", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }) });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.appendVersion({
        recordId: "b1", after: build({ title: `t${i + 1}` }), author: `author${i}`,
      })),
    );
    const { versions } = await store.listVersions("b1", { limit: 50 });
    expect(versions.map((x) => x.v)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  test("concurrent appends across records do not interleave", async () => {
    await Promise.all(["b1", "b2", "b3"].map((id) =>
      store.appendVersion({ recordId: id, before: null, after: build({ id }) })));
    for (const id of ["b1", "b2", "b3"]) {
      expect(await store.getVersion(id, 1)).toMatchObject({ id });
    }
  });
});
