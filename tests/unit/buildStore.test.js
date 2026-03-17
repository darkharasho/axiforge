"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-test-"));
  const store = new BuildStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

function makeBuild(overrides = {}) {
  return {
    title: "Test Build",
    profession: "Warrior",
    specializations: [],
    skills: { heal: null, utility: [null, null, null], elite: null },
    equipment: { statPackage: "Berserker", relic: "", food: "", utility: "" },
    tags: ["pve", "dps"],
    notes: "A test build",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BuildStore CRUD
// ---------------------------------------------------------------------------

describe("BuildStore — init", () => {
  let dir;

  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("creates base directory and files on init", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-init-test-"));
    dir = tmpDir;
    const nestedDir = path.join(tmpDir, "data", "nested");
    const store = new BuildStore(nestedDir);
    await store.init();

    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);

    const buildsData = JSON.parse(await fs.readFile(path.join(nestedDir, "builds.json"), "utf8"));
    expect(buildsData).toEqual([]);

    const authData = JSON.parse(await fs.readFile(path.join(nestedDir, "auth.json"), "utf8"));
    expect(authData).toEqual({});
  });

  test("init is idempotent — calling twice does not corrupt files", async () => {
    const { store, dir: d } = await makeTempStore();
    dir = d;
    await store.upsertBuild(makeBuild({ title: "Keep Me" }));
    await store.init(); // second init — should not overwrite
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(1);
    expect(builds[0].title).toBe("Keep Me");
  });
});

describe("BuildStore — listBuilds", () => {
  let store, dir;

  beforeEach(async () => {
    ({ store, dir } = await makeTempStore());
  });
  afterEach(async () => { await cleanupDir(dir); });

  test("returns empty array when no builds exist", async () => {
    const builds = await store.listBuilds();
    expect(builds).toEqual([]);
  });

  test("returns all saved builds", async () => {
    await store.upsertBuild(makeBuild({ title: "Build A" }));
    await store.upsertBuild(makeBuild({ title: "Build B" }));
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(2);
    const titles = builds.map((b) => b.title).sort();
    expect(titles).toEqual(["Build A", "Build B"]);
  });

  test("returns empty array when builds.json contains non-array data", async () => {
    const { dir: d } = await makeTempStore();
    dir = d;
    await fs.writeFile(path.join(d, "builds.json"), JSON.stringify({ broken: true }), "utf8");
    const brokenStore = new BuildStore(d);
    const builds = await brokenStore.listBuilds();
    expect(builds).toEqual([]);
  });

  test("returns empty array when builds.json is corrupt JSON", async () => {
    await fs.writeFile(path.join(dir, "builds.json"), "not valid json", "utf8");
    const builds = await store.listBuilds();
    expect(builds).toEqual([]);
  });

  test("normalizes stored builds on read", async () => {
    // Write a build with extra fields directly to disk
    await fs.writeFile(path.join(dir, "builds.json"), JSON.stringify([{
      id: "abc123",
      title: "Raw Build",
      profession: "Warrior",
      version: 1, // old version
      createdAt: "2024-01-01T00:00:00.000Z",
    }]), "utf8");
    const builds = await store.listBuilds();
    expect(builds[0].version).toBe(2); // normalized to version 2
    expect(builds[0].id).toBe("abc123");
    expect(builds[0].title).toBe("Raw Build");
    expect(builds[0].skills).toEqual({ heal: null, utility: [null, null, null], elite: null });
  });
});

describe("BuildStore — upsertBuild (create)", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("creates a new build with auto-generated UUID", async () => {
    const result = await store.upsertBuild(makeBuild({ title: "New Build" }));
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe("string");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/); // UUID pattern
  });

  test("persists to disk immediately", async () => {
    await store.upsertBuild(makeBuild({ title: "Persisted" }));
    const raw = JSON.parse(await fs.readFile(path.join(dir, "builds.json"), "utf8"));
    expect(raw).toHaveLength(1);
    expect(raw[0].title).toBe("Persisted");
  });

  test("always sets version: 2", async () => {
    const result = await store.upsertBuild(makeBuild());
    expect(result.version).toBe(2);
  });

  test("sets createdAt and updatedAt", async () => {
    const before = new Date().toISOString();
    const result = await store.upsertBuild(makeBuild());
    const after = new Date().toISOString();
    expect(result.createdAt >= before).toBe(true);
    expect(result.createdAt <= after).toBe(true);
    expect(result.updatedAt >= before).toBe(true);
  });

  test("multiple upserts without id creates separate builds", async () => {
    await store.upsertBuild(makeBuild({ title: "A" }));
    await store.upsertBuild(makeBuild({ title: "B" }));
    await store.upsertBuild(makeBuild({ title: "C" }));
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(3);
  });

  test("uses provided id instead of generating a new one", async () => {
    const result = await store.upsertBuild(makeBuild({ id: "my-custom-id" }));
    expect(result.id).toBe("my-custom-id");
  });
});

describe("BuildStore — upsertBuild (update)", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("updates existing build by id", async () => {
    const created = await store.upsertBuild(makeBuild({ title: "Original" }));
    const updated = await store.upsertBuild({ ...created, title: "Updated" });
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Updated");
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(1);
    expect(builds[0].title).toBe("Updated");
  });

  test("preserves createdAt on update", async () => {
    const created = await store.upsertBuild(makeBuild());
    const originalCreatedAt = created.createdAt;
    // Wait a tick to ensure updatedAt would differ
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.upsertBuild({ ...created, title: "Changed" });
    expect(updated.createdAt).toBe(originalCreatedAt);
  });

  test("updates updatedAt on second upsert", async () => {
    const created = await store.upsertBuild(makeBuild());
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.upsertBuild({ ...created, title: "Changed" });
    // updatedAt should be >= createdAt
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(updated.createdAt).getTime());
  });

  test("returns the updated build", async () => {
    const created = await store.upsertBuild(makeBuild());
    const updated = await store.upsertBuild({ ...created, tags: ["solo", "open-world"] });
    expect(updated.tags).toEqual(["solo", "open-world"]);
  });
});

describe("BuildStore — deleteBuild", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("removes the build with the given id", async () => {
    const a = await store.upsertBuild(makeBuild({ title: "A" }));
    const b = await store.upsertBuild(makeBuild({ title: "B" }));
    await store.deleteBuild(a.id);
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(1);
    expect(builds[0].id).toBe(b.id);
  });

  test("does nothing when id does not exist", async () => {
    await store.upsertBuild(makeBuild({ title: "Safe" }));
    await store.deleteBuild("non-existent-id");
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(1);
  });

  test("can delete all builds", async () => {
    const a = await store.upsertBuild(makeBuild({ title: "A" }));
    const b = await store.upsertBuild(makeBuild({ title: "B" }));
    await store.deleteBuild(a.id);
    await store.deleteBuild(b.id);
    const builds = await store.listBuilds();
    expect(builds).toEqual([]);
  });
});

describe("BuildStore — auth", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("getAuth returns empty object initially", async () => {
    const auth = await store.getAuth();
    expect(auth).toEqual({});
  });

  test("saveAuth persists auth data", async () => {
    await store.saveAuth({ token: "test-token-123", login: "octocat" });
    const auth = await store.getAuth();
    expect(auth.token).toBe("test-token-123");
    expect(auth.login).toBe("octocat");
  });

  test("saveAuth overwrites existing auth", async () => {
    await store.saveAuth({ token: "old-token" });
    await store.saveAuth({ token: "new-token" });
    const auth = await store.getAuth();
    expect(auth.token).toBe("new-token");
  });

  test("clearAuth removes all auth data", async () => {
    await store.saveAuth({ token: "some-token" });
    await store.clearAuth();
    const auth = await store.getAuth();
    expect(auth).toEqual({});
  });

  test("saveAuth with null saves empty object", async () => {
    await store.saveAuth({ token: "test" });
    await store.saveAuth(null);
    const auth = await store.getAuth();
    expect(auth).toEqual({});
  });

  test("getAuth returns empty object if auth.json is corrupt", async () => {
    await fs.writeFile(path.join(dir, "auth.json"), "not json", "utf8");
    const auth = await store.getAuth();
    expect(auth).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// normalizeBuild — exhaustive field-level tests
// ---------------------------------------------------------------------------

describe("normalizeBuild — title", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("uses 'Untitled Build' when title is empty", async () => {
    const result = await store.upsertBuild(makeBuild({ title: "" }));
    expect(result.title).toBe("Untitled Build");
  });

  test("uses 'Untitled Build' when title is whitespace only", async () => {
    const result = await store.upsertBuild(makeBuild({ title: "   " }));
    expect(result.title).toBe("Untitled Build");
  });

  test("truncates title to 140 characters", async () => {
    const long = "A".repeat(200);
    const result = await store.upsertBuild(makeBuild({ title: long }));
    expect(result.title).toHaveLength(140);
  });

  test("trims whitespace from title", async () => {
    const result = await store.upsertBuild(makeBuild({ title: "  My Build  " }));
    expect(result.title).toBe("My Build");
  });

  test("preserves normal title", async () => {
    const result = await store.upsertBuild(makeBuild({ title: "Power Warrior" }));
    expect(result.title).toBe("Power Warrior");
  });
});

describe("normalizeBuild — profession", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("uses professionName as fallback for profession field", async () => {
    const result = await store.upsertBuild({ ...makeBuild({ profession: "" }), professionName: "Guardian" });
    expect(result.profession).toBe("Guardian");
  });

  test("profession is empty string when both are missing", async () => {
    const result = await store.upsertBuild(makeBuild({ profession: "" }));
    expect(result.profession).toBe("");
  });
});

describe("normalizeBuild — notes", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("truncates notes to 12000 characters", async () => {
    const long = "x".repeat(15000);
    const result = await store.upsertBuild(makeBuild({ notes: long }));
    expect(result.notes).toHaveLength(12000);
  });

  test("preserves notes under the limit", async () => {
    const result = await store.upsertBuild(makeBuild({ notes: "Short note" }));
    expect(result.notes).toBe("Short note");
  });
});

describe("normalizeBuild — tags", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("accepts empty tags array", async () => {
    const result = await store.upsertBuild(makeBuild({ tags: [] }));
    expect(result.tags).toEqual([]);
  });

  test("caps tags at 20 entries", async () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const result = await store.upsertBuild(makeBuild({ tags }));
    expect(result.tags).toHaveLength(20);
  });

  test("truncates each tag to 40 characters", async () => {
    const result = await store.upsertBuild(makeBuild({ tags: ["A".repeat(60)] }));
    expect(result.tags[0]).toHaveLength(40);
  });

  test("filters out empty tag strings", async () => {
    const result = await store.upsertBuild(makeBuild({ tags: ["pve", "", "  ", "dps"] }));
    expect(result.tags).toEqual(["pve", "dps"]);
  });

  test("handles non-array tags gracefully", async () => {
    const result = await store.upsertBuild(makeBuild({ tags: null }));
    expect(result.tags).toEqual([]);
  });
});

describe("normalizeBuild — specializations", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("accepts empty specializations array", async () => {
    const result = await store.upsertBuild(makeBuild({ specializations: [] }));
    expect(result.specializations).toEqual([]);
  });

  test("caps specializations at 3 entries", async () => {
    const specs = [
      { id: 4, name: "Strength", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: {} },
      { id: 22, name: "Tactics", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: {} },
      { id: 51, name: "Berserker", elite: true, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: {} },
      { id: 18, name: "Defense", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: {} },
    ];
    const result = await store.upsertBuild(makeBuild({ specializations: specs }));
    expect(result.specializations).toHaveLength(3);
  });

  test("normalizes majorChoices keys to numbers", async () => {
    const result = await store.upsertBuild(makeBuild({
      specializations: [{
        id: 4, name: "Strength", elite: false, icon: "", background: "",
        minorTraits: [],
        majorChoices: { 1: 1444, 2: 1338, 3: 1451 },
        majorTraitsByTier: {},
      }],
    }));
    expect(result.specializations[0].majorChoices).toEqual({ 1: 1444, 2: 1338, 3: 1451 });
  });

  test("handles missing majorChoices gracefully", async () => {
    const result = await store.upsertBuild(makeBuild({
      specializations: [{ id: 4, name: "Strength", elite: false }],
    }));
    expect(result.specializations[0].majorChoices).toEqual({ 1: 0, 2: 0, 3: 0 });
  });

  test("converts spec id to number", async () => {
    const result = await store.upsertBuild(makeBuild({
      specializations: [{ id: "4", name: "Strength", elite: false }],
    }));
    expect(result.specializations[0].id).toBe(4);
  });

  test("normalizes elite to boolean", async () => {
    const result = await store.upsertBuild(makeBuild({
      specializations: [{ id: 51, name: "Berserker", elite: 1 }],
    }));
    expect(result.specializations[0].elite).toBe(true);
  });

  test("handles non-array specializations", async () => {
    const result = await store.upsertBuild(makeBuild({ specializations: null }));
    expect(result.specializations).toEqual([]);
  });
});

describe("normalizeBuild — skills", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  const skillRef = {
    id: 14402,
    name: "Mending",
    icon: "https://example.com/icon.png",
    description: "Heal yourself",
    slot: "Heal",
    type: "Heal",
    specialization: 0,
  };

  test("normalizes heal skill ref", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: { heal: skillRef, utility: [null, null, null], elite: null },
    }));
    expect(result.skills.heal).toEqual(skillRef);
  });

  test("returns null for heal when id is 0", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: { heal: { id: 0, name: "Bad" }, utility: [null, null, null], elite: null },
    }));
    expect(result.skills.heal).toBeNull();
  });

  test("returns null for heal when skill is null", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: { heal: null, utility: [null, null, null], elite: null },
    }));
    expect(result.skills.heal).toBeNull();
  });

  test("caps utility at 3 entries", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: { heal: null, utility: [skillRef, skillRef, skillRef, skillRef], elite: null },
    }));
    expect(result.skills.utility).toHaveLength(3);
  });

  test("fills missing utility slots with [null, null, null]", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: { heal: null, utility: undefined, elite: null },
    }));
    expect(result.skills.utility).toEqual([null, null, null]);
  });

  test("skill refs truncate description to 500 chars", async () => {
    const result = await store.upsertBuild(makeBuild({
      skills: {
        heal: { ...skillRef, description: "x".repeat(600) },
        utility: [null, null, null],
        elite: null,
      },
    }));
    expect(result.skills.heal.description).toHaveLength(500);
  });

  test("handles non-object skills gracefully", async () => {
    const result = await store.upsertBuild(makeBuild({ skills: null }));
    expect(result.skills.heal).toBeNull();
    expect(result.skills.utility).toEqual([null, null, null]);
    expect(result.skills.elite).toBeNull();
  });
});

describe("normalizeBuild — equipment", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("normalizes all equipment fields", async () => {
    const result = await store.upsertBuild(makeBuild({
      equipment: {
        statPackage: "Berserker",
        relic: "Relic of the Thief",
        food: "Bowl of Seaweed Salad",
        utility: "Superior Sharpening Stone",
      },
    }));
    expect(result.equipment.statPackage).toBe("Berserker");
    expect(result.equipment.relic).toBe("Relic of the Thief");
    expect(result.equipment.food).toBe("Bowl of Seaweed Salad");
    expect(result.equipment.utility).toBe("Superior Sharpening Stone");
  });

  test("handles missing equipment gracefully", async () => {
    const result = await store.upsertBuild(makeBuild({ equipment: null }));
    expect(result.equipment).toEqual({ statPackage: "", relic: "", food: "", utility: "", slots: {}, weapons: {}, runes: {}, sigils: {}, infusions: {}, enrichment: "" });
  });

  test("truncates statPackage to 80 chars", async () => {
    const result = await store.upsertBuild(makeBuild({ equipment: { statPackage: "x".repeat(100) } }));
    expect(result.equipment.statPackage).toHaveLength(80);
  });

});

describe("normalizeBuild — timestamps", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("preserves valid ISO createdAt", async () => {
    const result = await store.upsertBuild(makeBuild({ createdAt: "2024-06-01T12:00:00.000Z" }));
    expect(result.createdAt).toBe("2024-06-01T12:00:00.000Z");
  });

  test("generates createdAt when invalid date string provided", async () => {
    const before = Date.now();
    const result = await store.upsertBuild(makeBuild({ createdAt: "not-a-date" }));
    const after = Date.now();
    const created = new Date(result.createdAt).getTime();
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(after);
  });

  test("generates createdAt when missing", async () => {
    const result = await store.upsertBuild(makeBuild());
    expect(result.createdAt).toBeTruthy();
    expect(() => new Date(result.createdAt)).not.toThrow();
    expect(Number.isNaN(new Date(result.createdAt).getTime())).toBe(false);
  });
});

describe("normalizeBuild — legacy buildUrl field", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("preserves buildUrl for migration compatibility", async () => {
    const result = await store.upsertBuild(makeBuild({ buildUrl: "https://old-site.example.com/build/123" }));
    expect(result.buildUrl).toBe("https://old-site.example.com/build/123");
  });

  test("buildUrl is empty string when not provided", async () => {
    const result = await store.upsertBuild(makeBuild());
    expect(result.buildUrl).toBe("");
  });

  test("truncates buildUrl to 500 chars", async () => {
    const result = await store.upsertBuild(makeBuild({ buildUrl: "https://example.com/" + "x".repeat(500) }));
    expect(result.buildUrl).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

describe("BuildStore — settings", () => {
  let dir;

  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("getSetting returns null for unknown key", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    expect(await store.getSetting("nonexistent")).toBeNull();
  });

  test("setSetting persists and getSetting retrieves", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    await store.setSetting("lastGameMode", "wvw");
    expect(await store.getSetting("lastGameMode")).toBe("wvw");
  });

  test("setSetting overwrites previous value", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    await store.setSetting("lastGameMode", "wvw");
    await store.setSetting("lastGameMode", "pve");
    expect(await store.getSetting("lastGameMode")).toBe("pve");
  });

  test("settings survive re-instantiation (disk persistence)", async () => {
    ({ dir } = (await makeTempStore()));
    const store1 = new BuildStore(dir);
    await store1.init();
    await store1.setSetting("lastGameMode", "wvw");

    const store2 = new BuildStore(dir);
    await store2.init();
    expect(await store2.getSetting("lastGameMode")).toBe("wvw");
  });

  test("init creates settings.json if missing", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-settings-test-"));
    dir = tmpDir;
    const store = new BuildStore(tmpDir);
    await store.init();
    const exists = await fs.access(path.join(tmpDir, "settings.json")).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrent operations
// ---------------------------------------------------------------------------

describe("BuildStore — concurrent operations", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanupDir(dir); });

  test("sequential upserts accumulate builds correctly", async () => {
    const titles = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
    for (const title of titles) {
      await store.upsertBuild(makeBuild({ title }));
    }
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(titles.length);
  });
});

// ---------------------------------------------------------------------------
// normalizeBuild — underwaterSkills
// ---------------------------------------------------------------------------

describe("normalizeBuild — underwaterSkills", () => {
  test("missing underwaterSkills defaults to null refs", async () => {
    const { store, dir } = await makeTempStore();
    try {
      const result = await store.upsertBuild(makeBuild());
      expect(result.underwaterSkills).toEqual({
        heal: null,
        utility: [null, null, null],
        elite: null,
      });
    } finally {
      await cleanupDir(dir);
    }
  });

  test("underwaterSkills with valid refs are preserved", async () => {
    const { store, dir } = await makeTempStore();
    try {
      const uwSkills = {
        heal: { id: 5503, name: "Signet of Restoration", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: null,
      };
      const result = await store.upsertBuild(makeBuild({ underwaterSkills: uwSkills }));
      expect(result.underwaterSkills.heal.id).toBe(5503);
      expect(result.underwaterSkills.heal.name).toBe("Signet of Restoration");
    } finally {
      await cleanupDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// BuildStore — gameMode normalization
// ---------------------------------------------------------------------------

describe("BuildStore — publish metadata", () => {
  let store, dir;
  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("stores publishedSlug, publishedFileId, publishedKey on a build", async () => {
    const saved = await store.upsertBuild(makeBuild({
      publishedSlug: "power-reaper",
      publishedFileId: "a7f3b2c1",
      publishedKey: "xK9mP2qR4sT6uV8wAb3cDe",
    }));
    expect(saved.publishedSlug).toBe("power-reaper");
    expect(saved.publishedFileId).toBe("a7f3b2c1");
    expect(saved.publishedKey).toBe("xK9mP2qR4sT6uV8wAb3cDe");
  });

  test("publish metadata defaults to empty strings", async () => {
    const saved = await store.upsertBuild(makeBuild());
    expect(saved.publishedSlug).toBe("");
    expect(saved.publishedFileId).toBe("");
    expect(saved.publishedKey).toBe("");
  });

  test("publish metadata persists across list/read cycles", async () => {
    await store.upsertBuild(makeBuild({
      id: "pub-test",
      publishedSlug: "reaper",
      publishedFileId: "abc12345",
      publishedKey: "somekey",
    }));
    const builds = await store.listBuilds();
    const found = builds.find((b) => b.id === "pub-test");
    expect(found.publishedSlug).toBe("reaper");
    expect(found.publishedFileId).toBe("abc12345");
    expect(found.publishedKey).toBe("somekey");
  });
});

// ---------------------------------------------------------------------------
// New library fields
// ---------------------------------------------------------------------------

describe("BuildStore — library fields", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("normalizeBuild adds folderId, pinned, sortOrder defaults", async () => {
    const saved = await store.upsertBuild(makeBuild());
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.folderId).toBe(null);
    expect(build.pinned).toBe(false);
    expect(build.sortOrder).toBe(0);
  });

  test("preserves folderId when set", async () => {
    const saved = await store.upsertBuild(
      makeBuild({ folderId: "folder-123" }),
    );
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.folderId).toBe("folder-123");
  });

  test("preserves pinned when true", async () => {
    const saved = await store.upsertBuild(makeBuild({ pinned: true }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.pinned).toBe(true);
  });

  test("preserves sortOrder when set", async () => {
    const saved = await store.upsertBuild(makeBuild({ sortOrder: 5 }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.sortOrder).toBe(5);
  });

  test("coerces non-boolean pinned to boolean", async () => {
    const saved = await store.upsertBuild(makeBuild({ pinned: "yes" }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.pinned).toBe(true);
  });

  test("coerces non-number sortOrder to 0", async () => {
    const saved = await store.upsertBuild(makeBuild({ sortOrder: "abc" }));
    const builds = await store.listBuilds();
    const build = builds.find((b) => b.id === saved.id);
    expect(build.sortOrder).toBe(0);
  });
});

describe("BuildStore — gameMode normalization", () => {
  let dir;

  afterEach(async () => { if (dir) await cleanupDir(dir); });

  test("build without gameMode defaults to pve", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild());
    expect(saved.gameMode).toBe("pve");
  });

  test("build with gameMode wvw is preserved", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild({ gameMode: "wvw" }));
    expect(saved.gameMode).toBe("wvw");
  });

  test("gameMode is truncated to 10 chars", async () => {
    ({ dir } = (await makeTempStore()));
    const store = new BuildStore(dir);
    await store.init();
    const saved = await store.upsertBuild(makeBuild({ gameMode: "a".repeat(50) }));
    expect(saved.gameMode.length).toBeLessThanOrEqual(10);
  });
});
