"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildHistoryStore, summarizeBuildChange } = require("../../src/main/buildHistoryStore");

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "axiforge-history-"));
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── BuildHistoryStore ──────────────────────────────────────────────────────

describe("BuildHistoryStore — init", () => {
  let dir, store;
  beforeEach(async () => {
    dir = await makeTempDir();
    store = new BuildHistoryStore(dir);
  });
  afterEach(() => cleanupDir(dir));

  test("creates build-history.json if it does not exist", async () => {
    await store.init();
    const raw = await fs.readFile(path.join(dir, "build-history.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({});
  });

  test("does not overwrite existing file", async () => {
    const existing = { b1: [{ id: "e1" }] };
    await fs.writeFile(path.join(dir, "build-history.json"), JSON.stringify(existing), "utf-8");
    await store.init();
    const raw = await fs.readFile(path.join(dir, "build-history.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(existing);
  });
});

describe("BuildHistoryStore — addEntry", () => {
  let dir, store;
  beforeEach(async () => {
    dir = await makeTempDir();
    store = new BuildHistoryStore(dir);
    await store.init();
  });
  afterEach(() => cleanupDir(dir));

  test("returns entry with expected shape", async () => {
    const entry = await store.addEntry({
      buildId: "b1",
      authorLogin: "someuser",
      source: "shared-sync",
      summary: "notes updated",
      snapshot: { title: "My Build" },
    });

    expect(entry).toMatchObject({
      buildId: "b1",
      authorLogin: "someuser",
      source: "shared-sync",
      summary: "notes updated",
      snapshot: { title: "My Build" },
    });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.timestamp).toBe("string");
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  test("defaults authorLogin to 'local' when omitted", async () => {
    const entry = await store.addEntry({ buildId: "b1", summary: "changed" });
    expect(entry.authorLogin).toBe("local");
  });

  test("defaults source to 'local' when omitted", async () => {
    const entry = await store.addEntry({ buildId: "b1" });
    expect(entry.source).toBe("local");
  });

  test("defaults summary to 'build updated' when omitted", async () => {
    const entry = await store.addEntry({ buildId: "b1" });
    expect(entry.summary).toBe("build updated");
  });

  test("stores entry so getHistory returns it", async () => {
    await store.addEntry({ buildId: "b1", summary: "first" });
    const history = await store.getHistory("b1");
    expect(history).toHaveLength(1);
    expect(history[0].summary).toBe("first");
  });

  test("prepends entries — newest first", async () => {
    await store.addEntry({ buildId: "b1", summary: "first" });
    await store.addEntry({ buildId: "b1", summary: "second" });
    const history = await store.getHistory("b1");
    expect(history[0].summary).toBe("second");
    expect(history[1].summary).toBe("first");
  });

  test("multiple buildIds are stored independently", async () => {
    await store.addEntry({ buildId: "b1", summary: "build one" });
    await store.addEntry({ buildId: "b2", summary: "build two" });
    expect(await store.getHistory("b1")).toHaveLength(1);
    expect(await store.getHistory("b2")).toHaveLength(1);
    expect((await store.getHistory("b1"))[0].summary).toBe("build one");
  });

  test("caps at 50 entries — oldest entries are dropped", async () => {
    for (let i = 0; i < 55; i++) {
      await store.addEntry({ buildId: "b1", summary: `entry-${i}` });
    }
    const history = await store.getHistory("b1");
    expect(history).toHaveLength(50);
    // Newest entries are kept (last ones added)
    expect(history[0].summary).toBe("entry-54");
    expect(history[49].summary).toBe("entry-5");
  });

  test("cap does not affect a different build's history", async () => {
    for (let i = 0; i < 52; i++) {
      await store.addEntry({ buildId: "b1", summary: `entry-${i}` });
    }
    await store.addEntry({ buildId: "b2", summary: "b2-entry" });
    expect(await store.getHistory("b2")).toHaveLength(1);
    expect((await store.getHistory("b2"))[0].summary).toBe("b2-entry");
  });

  test("persists to disk across separate store instances", async () => {
    await store.addEntry({ buildId: "b1", summary: "persisted entry" });

    const store2 = new BuildHistoryStore(dir);
    const history = await store2.getHistory("b1");
    expect(history).toHaveLength(1);
    expect(history[0].summary).toBe("persisted entry");
  });
});

describe("BuildHistoryStore — getHistory", () => {
  let dir, store;
  beforeEach(async () => {
    dir = await makeTempDir();
    store = new BuildHistoryStore(dir);
    await store.init();
  });
  afterEach(() => cleanupDir(dir));

  test("returns empty array for unknown buildId", async () => {
    const history = await store.getHistory("nonexistent");
    expect(history).toEqual([]);
  });

  test("returns all entries for known buildId", async () => {
    await store.addEntry({ buildId: "b1", summary: "a" });
    await store.addEntry({ buildId: "b1", summary: "b" });
    const history = await store.getHistory("b1");
    expect(history).toHaveLength(2);
  });
});

describe("BuildHistoryStore — deleteHistory", () => {
  let dir, store;
  beforeEach(async () => {
    dir = await makeTempDir();
    store = new BuildHistoryStore(dir);
    await store.init();
  });
  afterEach(() => cleanupDir(dir));

  test("removes all entries for a buildId", async () => {
    await store.addEntry({ buildId: "b1", summary: "entry" });
    await store.deleteHistory("b1");
    expect(await store.getHistory("b1")).toEqual([]);
  });

  test("does not affect other buildIds", async () => {
    await store.addEntry({ buildId: "b1", summary: "b1-entry" });
    await store.addEntry({ buildId: "b2", summary: "b2-entry" });
    await store.deleteHistory("b1");
    const history = await store.getHistory("b2");
    expect(history).toHaveLength(1);
    expect(history[0].summary).toBe("b2-entry");
  });

  test("is a no-op for unknown buildId (no error thrown)", async () => {
    await expect(store.deleteHistory("ghost")).resolves.toBeUndefined();
  });

  test("persists deletion to disk", async () => {
    await store.addEntry({ buildId: "b1", summary: "entry" });
    await store.deleteHistory("b1");

    const store2 = new BuildHistoryStore(dir);
    expect(await store2.getHistory("b1")).toEqual([]);
  });
});

// ─── summarizeBuildChange ───────────────────────────────────────────────────

describe("summarizeBuildChange", () => {
  const base = {
    title: "My Build",
    profession: "Guardian",
    gameMode: "pve",
    specializations: [{ id: 1 }],
    skills: [{ id: 10 }],
    underwaterSkills: [],
    equipment: [{ slot: "Head" }],
    notes: "some notes",
    tags: ["meta"],
  };

  test("returns 'build created' when before is null", () => {
    expect(summarizeBuildChange(null, base)).toBe("build created");
  });

  test("returns 'build created' when before is undefined", () => {
    expect(summarizeBuildChange(undefined, base)).toBe("build created");
  });

  test("detects title change", () => {
    const after = { ...base, title: "New Title" };
    expect(summarizeBuildChange(base, after)).toBe('title: "My Build" → "New Title"');
  });

  test("detects profession change", () => {
    const after = { ...base, profession: "Warrior" };
    expect(summarizeBuildChange(base, after)).toBe("profession: Guardian → Warrior");
  });

  test("detects gameMode change", () => {
    const after = { ...base, gameMode: "wvw" };
    expect(summarizeBuildChange(base, after)).toBe("game mode: pve → wvw");
  });

  test("treats missing gameMode as 'pve' for comparison", () => {
    const before = { ...base, gameMode: undefined };
    const after = { ...base, gameMode: "pve" };
    expect(summarizeBuildChange(before, after)).toBe("build updated");
  });

  test("detects specializations change", () => {
    const after = { ...base, specializations: [{ id: 2 }] };
    expect(summarizeBuildChange(base, after)).toBe("specializations changed");
  });

  test("detects skills change", () => {
    const after = { ...base, skills: [{ id: 99 }] };
    expect(summarizeBuildChange(base, after)).toBe("skills changed");
  });

  test("detects underwaterSkills change", () => {
    const after = { ...base, underwaterSkills: [{ id: 5 }] };
    expect(summarizeBuildChange(base, after)).toBe("underwater skills changed");
  });

  test("detects equipment change", () => {
    const after = { ...base, equipment: [{ slot: "Chest" }] };
    expect(summarizeBuildChange(base, after)).toBe("equipment changed");
  });

  test("detects notes change", () => {
    const after = { ...base, notes: "different notes" };
    expect(summarizeBuildChange(base, after)).toBe("notes updated");
  });

  test("detects tags change", () => {
    const after = { ...base, tags: ["meta", "burst"] };
    expect(summarizeBuildChange(base, after)).toBe("tags changed");
  });

  test("returns 'build updated' when nothing changed", () => {
    const after = { ...base };
    expect(summarizeBuildChange(base, after)).toBe("build updated");
  });

  test("reports all changes when multiple fields differ", () => {
    const after = { ...base, title: "Different", profession: "Warrior" };
    expect(summarizeBuildChange(base, after)).toBe('title: "My Build" → "Different"; profession: Guardian → Warrior');
  });

  test("reports both profession and game mode when both change", () => {
    const after = { ...base, profession: "Warrior", gameMode: "wvw" };
    expect(summarizeBuildChange(base, after)).toBe("profession: Guardian → Warrior; game mode: pve → wvw");
  });

  test("specific skill slot changes — heal and elite", () => {
    const before = {
      ...base,
      skills: { heal: { id: 1 }, utility: [null, null, null], elite: { id: 10 } },
    };
    const after = {
      ...base,
      skills: { heal: { id: 2 }, utility: [null, null, null], elite: { id: 11 } },
    };
    expect(summarizeBuildChange(before, after)).toBe("heal, elite skills changed");
  });

  test("specific skill slot changes — single utility slot", () => {
    const before = {
      ...base,
      skills: { heal: { id: 1 }, utility: [{ id: 5 }, { id: 6 }, { id: 7 }], elite: { id: 10 } },
    };
    const after = {
      ...base,
      skills: { heal: { id: 1 }, utility: [{ id: 5 }, { id: 99 }, { id: 7 }], elite: { id: 10 } },
    };
    expect(summarizeBuildChange(before, after)).toBe("utility 2 skill changed");
  });

  test("underwater skill changes use 'underwater' prefix", () => {
    const before = { ...base, underwaterSkills: { heal: { id: 1 }, utility: [null, null, null], elite: { id: 10 } } };
    const after  = { ...base, underwaterSkills: { heal: { id: 2 }, utility: [null, null, null], elite: { id: 10 } } };
    expect(summarizeBuildChange(before, after)).toBe("underwater heal skill changed");
  });

  test("equipment stat package change is reported specifically", () => {
    const before = { ...base, equipment: { statPackage: "Berserker", slots: {}, weapons: {}, runes: {}, sigils: {}, infusions: {} } };
    const after  = { ...base, equipment: { statPackage: "Viper", slots: {}, weapons: {}, runes: {}, sigils: {}, infusions: {} } };
    expect(summarizeBuildChange(before, after)).toBe("stat package: Berserker → Viper changed");
  });

  test("equipment rune and sigil changes are reported specifically", () => {
    const before = { ...base, equipment: { slots: {}, weapons: {}, runes: { head: "Rune of X" }, sigils: {}, infusions: {} } };
    const after  = { ...base, equipment: { slots: {}, weapons: {}, runes: { head: "Rune of Y" }, sigils: {}, infusions: {} } };
    expect(summarizeBuildChange(before, after)).toBe("runes changed");
  });

  test("multiple equipment categories listed when multiple change", () => {
    const before = { ...base, equipment: { slots: { head: "a" }, weapons: { mainhand: "x" }, runes: {}, sigils: {}, infusions: {} } };
    const after  = { ...base, equipment: { slots: { head: "b" }, weapons: { mainhand: "y" }, runes: {}, sigils: {}, infusions: {} } };
    const result = summarizeBuildChange(before, after);
    expect(result).toContain("armor/trinkets");
    expect(result).toContain("weapons");
  });
});
