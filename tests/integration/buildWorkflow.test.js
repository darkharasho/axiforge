"use strict";

/**
 * Integration tests for the full build workflow:
 * - BuildStore CRUD with realistic build data
 * - Build serialization/deserialization round-trips
 * - siteBundle generation from stored builds
 * - Cross-module interaction (store → bundle → publish shape)
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { buildSpaBundle, buildEncryptedBuildFile } = require("../../src/main/siteBundle");
const { generateEncryptionKey } = require("../../src/main/buildEncryption");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-integration-"));
  const store = new BuildStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Realistic build objects covering all 9 professions
function makeRealisticBuild(profession, overrides = {}) {
  const profBuilds = {
    Warrior: {
      title: "Power Berserker",
      profession: "Warrior",
      specializations: [
        { id: 4,  name: "Strength",  elite: false, icon: "str.png",  background: "str-bg.png",  minorTraits: [214, 180, 92],   majorChoices: { 1: 1444, 2: 1338, 3: 1451 }, majorTraitsByTier: { 1: [{ id: 1444, name: "Perseverance", icon: "", description: "", tier: 1 }], 2: [{ id: 1338, name: "Dual Wield Mastery", icon: "", description: "", tier: 2 }], 3: [{ id: 1451, name: "Berserker's Power", icon: "", description: "", tier: 3 }] } },
        { id: 18, name: "Defense",   elite: false, icon: "def.png",  background: "def-bg.png",  minorTraits: [],              majorChoices: { 1: 0, 2: 0, 3: 0 },            majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 51, name: "Berserker", elite: true,  icon: "bers.png", background: "bers-bg.png", minorTraits: [1692, 1835, 1831], majorChoices: { 1: 1831, 2: 1841, 3: 2039 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 14402, name: "Mending", icon: "mending.png", description: "Heal", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [
          { id: 14516, name: "Balanced Stance", icon: "bs.png", description: "Stance", slot: "Utility", type: "Utility", specialization: 0 },
          { id: 14507, name: "Shake It Off!", icon: "sio.png", description: "Shout", slot: "Utility", type: "Utility", specialization: 0 },
          { id: 14410, name: "Signet of Fury", icon: "sof.png", description: "Signet", slot: "Utility", type: "Utility", specialization: 0 },
        ],
        elite: { id: 14404, name: "Rampage", icon: "rampage.png", description: "Transform", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "Bowl of Sweet and Spicy Butternut Squash Soup", utility: "Superior Sharpening Stone" },
      tags: ["pve", "dps", "power", "warrior"],
      notes: "Best-in-slot power warrior for raids.",
    },
    Engineer: {
      title: "Power Holosmith",
      profession: "Engineer",
      specializations: [
        { id: 6,  name: "Firearms",  elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 38, name: "Tools",     elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 57, name: "Holosmith", elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 5802, name: "Healing Turret", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 6161, name: "Supply Drop", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "", food: "", utility: "" },
      tags: ["pve", "dps", "engineer"],
      notes: "Photon Forge burst windows.",
    },
    Guardian: {
      title: "Condi Firebrand",
      profession: "Guardian",
      specializations: [
        { id: 16, name: "Radiance",  elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 49, name: "Honor",     elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 62, name: "Firebrand", elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 9083, name: "Shelter", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [
          { id: 44364, name: "Tome of Justice", icon: "", description: "", slot: "Profession_1", type: "Profession", specialization: 62 },
          { id: 41780, name: "Tome of Resolve", icon: "", description: "", slot: "Profession_2", type: "Profession", specialization: 62 },
          { id: 42259, name: "Tome of Courage", icon: "", description: "", slot: "Profession_3", type: "Profession", specialization: 62 },
        ],
        elite: { id: 9, name: "Renewed Focus", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Ritualist", relic: "Relic of the Fireworks", food: "Bowl of Beef Rendang", utility: "Toxic Focusing Crystal" },
      tags: ["pve", "condi", "guardian", "support"],
      notes: "Tome rotations for maximum condition uptime.",
    },
    Ranger: {
      title: "Power Soulbeast",
      profession: "Ranger",
      specializations: [
        { id: 8,  name: "Marksmanship", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 32, name: "Wilderness Survival", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 55, name: "Soulbeast",    elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 5503, name: "Troll Unguent", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 12540, name: "Entangle", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "", utility: "" },
      tags: ["pve", "dps", "ranger"],
      notes: "",
    },
    Thief: {
      title: "Power Deadeye",
      profession: "Thief",
      specializations: [
        { id: 28, name: "Deadly Arts",    elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 35, name: "Critical Strikes", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 58, name: "Deadeye",         elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 13050, name: "Channeled Vigor", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 13050, name: "Dagger Storm", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "", utility: "" },
      tags: ["pve", "dps", "thief"],
      notes: "",
    },
    Elementalist: {
      title: "Power Weaver",
      profession: "Elementalist",
      specializations: [
        { id: 26, name: "Fire",   elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 41, name: "Earth",  elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 56, name: "Weaver", elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 5504, name: "Glyph of Elemental Harmony", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 5505, name: "Tornado", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "", utility: "" },
      tags: ["pve", "dps", "elementalist"],
      notes: "",
    },
    Mesmer: {
      title: "Power Chronomancer",
      profession: "Mesmer",
      specializations: [
        { id: 23, name: "Domination",    elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 24, name: "Dueling",       elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 59, name: "Chronomancer",  elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 10213, name: "Ether Feast", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 10211, name: "Moa Morph", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "", food: "", utility: "" },
      tags: ["pve", "dps", "mesmer"],
      notes: "",
    },
    Necromancer: {
      title: "Power Reaper",
      profession: "Necromancer",
      specializations: [
        { id: 39, name: "Spite",   elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 50, name: "Curses",  elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 34, name: "Reaper",  elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 10533, name: "Well of Blood", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 10550, name: "Lich Form", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "", utility: "" },
      tags: ["pve", "dps", "necromancer"],
      notes: "",
    },
    Revenant: {
      title: "Power Renegade",
      profession: "Revenant",
      specializations: [
        { id: 74, name: "Invocation", elite: false, icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 52, name: "Herald",     elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
        { id: 63, name: "Renegade",   elite: true,  icon: "", background: "", minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      ],
      skills: {
        heal: { id: 27356, name: "Enchanted Daggers", icon: "", description: "", slot: "Heal", type: "Heal", specialization: 0 },
        utility: [null, null, null],
        elite: { id: 26821, name: "Jade Winds", icon: "", description: "", slot: "Elite", type: "Elite", specialization: 0 },
      },
      equipment: { statPackage: "Berserker", relic: "Relic of the Thief", food: "", utility: "" },
      tags: ["pve", "dps", "revenant"],
      notes: "",
    },
  };

  const base = profBuilds[profession] || { title: profession, profession, specializations: [], skills: { heal: null, utility: [null, null, null], elite: null }, equipment: { statPackage: "", relic: "", food: "", utility: "" }, tags: [], notes: "" };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Build persistence round-trips
// ---------------------------------------------------------------------------

describe("Build persistence — round-trip serialization", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  const professions = ["Warrior", "Engineer", "Guardian", "Ranger", "Thief", "Elementalist", "Mesmer", "Necromancer", "Revenant"];

  for (const prof of professions) {
    test(`${prof} build round-trips through store without data loss`, async () => {
      const build = makeRealisticBuild(prof);
      const saved = await store.upsertBuild(build);
      const retrieved = (await store.listBuilds()).find((b) => b.id === saved.id);

      expect(retrieved).toBeTruthy();
      expect(retrieved.profession).toBe(prof);
      expect(retrieved.title).toBe(build.title);
      expect(retrieved.equipment.statPackage).toBe(build.equipment.statPackage);
      expect(retrieved.specializations.length).toBe(build.specializations.length);

      // Skills round-trip
      if (build.skills.heal) {
        expect(retrieved.skills.heal.id).toBe(build.skills.heal.id);
        expect(retrieved.skills.heal.name).toBe(build.skills.heal.name);
      }
      if (build.skills.elite) {
        expect(retrieved.skills.elite.id).toBe(build.skills.elite.id);
      }
    });
  }

  test("specialization majorChoices round-trips correctly", async () => {
    const build = makeRealisticBuild("Warrior");
    const saved = await store.upsertBuild(build);
    const retrieved = (await store.listBuilds()).find((b) => b.id === saved.id);

    const spec = retrieved.specializations[0]; // Strength
    expect(spec.majorChoices[1]).toBe(1444);
    expect(spec.majorChoices[2]).toBe(1338);
    expect(spec.majorChoices[3]).toBe(1451);
  });

  test("equipment fields round-trip", async () => {
    const build = makeRealisticBuild("Guardian");
    const saved = await store.upsertBuild(build);
    const retrieved = (await store.listBuilds()).find((b) => b.id === saved.id);

    expect(retrieved.equipment.statPackage).toBe("Ritualist");
    expect(retrieved.equipment.relic).toBe("Relic of the Fireworks");
    expect(retrieved.equipment.food).toBe("Bowl of Beef Rendang");
    expect(retrieved.equipment.utility).toBe("Toxic Focusing Crystal");
  });

  test("tags array round-trips", async () => {
    const build = makeRealisticBuild("Warrior");
    const saved = await store.upsertBuild(build);
    const retrieved = (await store.listBuilds()).find((b) => b.id === saved.id);
    expect(retrieved.tags).toEqual(["pve", "dps", "power", "warrior"]);
  });

  test("notes field round-trips", async () => {
    const build = makeRealisticBuild("Warrior");
    const saved = await store.upsertBuild(build);
    const retrieved = (await store.listBuilds()).find((b) => b.id === saved.id);
    expect(retrieved.notes).toBe("Best-in-slot power warrior for raids.");
  });
});

// ---------------------------------------------------------------------------
// Build library management — multi-profession library
// ---------------------------------------------------------------------------

describe("Build library — multi-profession management", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  const professions = ["Warrior", "Engineer", "Guardian", "Ranger", "Thief", "Elementalist", "Mesmer", "Necromancer", "Revenant"];

  test("can store all 9 profession builds simultaneously", async () => {
    for (const prof of professions) {
      await store.upsertBuild(makeRealisticBuild(prof));
    }
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(9);
  });

  test("each profession's build is distinct and retrievable", async () => {
    const saved = {};
    for (const prof of professions) {
      const b = await store.upsertBuild(makeRealisticBuild(prof));
      saved[prof] = b.id;
    }
    const builds = await store.listBuilds();
    for (const prof of professions) {
      const found = builds.find((b) => b.id === saved[prof]);
      expect(found).toBeTruthy();
      expect(found.profession).toBe(prof);
    }
  });

  test("can delete specific profession build without affecting others", async () => {
    const ids = {};
    for (const prof of professions) {
      const b = await store.upsertBuild(makeRealisticBuild(prof));
      ids[prof] = b.id;
    }
    await store.deleteBuild(ids.Warrior);
    const remaining = await store.listBuilds();
    expect(remaining).toHaveLength(8);
    expect(remaining.find((b) => b.id === ids.Warrior)).toBeUndefined();
    expect(remaining.find((b) => b.profession === "Guardian")).toBeTruthy();
  });

  test("can update a build while keeping others intact", async () => {
    const warriorB = await store.upsertBuild(makeRealisticBuild("Warrior"));
    const guardianB = await store.upsertBuild(makeRealisticBuild("Guardian"));

    await store.upsertBuild({ ...warriorB, title: "Power Berserker v2", notes: "Updated." });

    const builds = await store.listBuilds();
    const warrior = builds.find((b) => b.id === warriorB.id);
    const guardian = builds.find((b) => b.id === guardianB.id);

    expect(warrior.title).toBe("Power Berserker v2");
    expect(warrior.notes).toBe("Updated.");
    expect(guardian.title).toBe("Condi Firebrand"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// siteBundle integration — stored builds → site
// ---------------------------------------------------------------------------

describe("siteBundle integration — SPA and encrypted build files", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  test("SPA bundle contains expected files", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toBeTruthy();
    expect(bundle["site/404.html"]).toBeTruthy();
    expect(bundle["site/.nojekyll"]).toBe("\n");
    const assetKeys = Object.keys(bundle).filter(k => k.startsWith("site/assets/"));
    expect(assetKeys.length).toBeGreaterThan(0);
  });

  test("SPA bundle HTML references Vite asset paths", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toContain("assets/");
  });

  test("encrypted build file has correct path and is not plaintext", async () => {
    const warriorBuild = makeRealisticBuild("Warrior");
    await store.upsertBuild(warriorBuild);
    const builds = await store.listBuilds();
    const build = builds[0];

    const key = generateEncryptionKey();
    const result = buildEncryptedBuildFile(build, "abc12345", key);
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(result.content).not.toContain("Warrior");
    expect(result.content).not.toContain("Mending");
  });

  test("all 9 profession builds can be encrypted individually", async () => {
    const professions = ["Warrior", "Engineer", "Guardian", "Ranger", "Thief", "Elementalist", "Mesmer", "Necromancer", "Revenant"];
    for (const prof of professions) {
      await store.upsertBuild(makeRealisticBuild(prof));
    }
    const builds = await store.listBuilds();
    expect(builds).toHaveLength(9);

    for (const build of builds) {
      const key = generateEncryptionKey();
      const result = buildEncryptedBuildFile(build, "file" + build.id.slice(0, 4), key);
      expect(result.filePath).toMatch(/^site\/builds\/.+\.enc$/);
      expect(result.content.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Build update / version management
// ---------------------------------------------------------------------------

describe("Build versioning — update tracking", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  test("all builds have version=2", async () => {
    for (const prof of ["Warrior", "Guardian", "Necromancer"]) {
      await store.upsertBuild(makeRealisticBuild(prof));
    }
    const builds = await store.listBuilds();
    for (const b of builds) {
      expect(b.version).toBe(2);
    }
  });

  test("createdAt is earlier than or equal to updatedAt", async () => {
    const saved = await store.upsertBuild(makeRealisticBuild("Warrior"));
    expect(new Date(saved.createdAt).getTime()).toBeLessThanOrEqual(new Date(saved.updatedAt).getTime());
  });

  test("update preserves original createdAt", async () => {
    const original = await store.upsertBuild(makeRealisticBuild("Warrior"));
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.upsertBuild({ ...original, notes: "Revised" });
    expect(updated.createdAt).toBe(original.createdAt);
  });
});

// ---------------------------------------------------------------------------
// Auth persistence integration
// ---------------------------------------------------------------------------

describe("Auth integration", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  test("auth persists across store reload (simulate app restart)", async () => {
    await store.saveAuth({ token: "ghs_test_token", login: "octocat" });

    // Simulate reload by creating a new BuildStore instance pointing to same dir
    const store2 = new BuildStore(dir);
    await store2.init(); // should not overwrite existing auth
    const auth = await store2.getAuth();
    expect(auth.token).toBe("ghs_test_token");
    expect(auth.login).toBe("octocat");
  });

  test("builds persist across store reload", async () => {
    await store.upsertBuild(makeRealisticBuild("Warrior"));
    await store.upsertBuild(makeRealisticBuild("Guardian"));

    const store2 = new BuildStore(dir);
    await store2.init();
    const builds = await store2.listBuilds();
    expect(builds).toHaveLength(2);
  });

  test("clearAuth does not affect builds", async () => {
    await store.saveAuth({ token: "test" });
    await store.upsertBuild(makeRealisticBuild("Warrior"));
    await store.clearAuth();

    const auth = await store.getAuth();
    const builds = await store.listBuilds();
    expect(auth).toEqual({});
    expect(builds).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — malformed build data handling
// ---------------------------------------------------------------------------

describe("Edge cases — malformed build data", () => {
  let store, dir;

  beforeEach(async () => { ({ store, dir } = await makeTempStore()); });
  afterEach(async () => { await cleanup(dir); });

  test("build with all null fields normalizes without throwing", async () => {
    const result = await store.upsertBuild({
      title: null,
      profession: null,
      specializations: null,
      skills: null,
      equipment: null,
      tags: null,
      notes: null,
    });
    expect(result.title).toBe("Untitled Build");
    expect(result.profession).toBe("");
    expect(result.specializations).toEqual([]);
    expect(result.skills.heal).toBeNull();
    expect(result.skills.utility).toEqual([null, null, null]);
    expect(result.equipment.statPackage).toBe("");
    expect(result.tags).toEqual([]);
    expect(result.notes).toBe("");
  });

  test("build with extreme tag count is capped at 20", async () => {
    const result = await store.upsertBuild({
      title: "Overcrowded",
      tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
    });
    expect(result.tags).toHaveLength(20);
  });

  test("build with 4 specializations is capped at 3", async () => {
    const specs = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: `Spec ${i}` }));
    const result = await store.upsertBuild({ title: "Too Many Specs", specializations: specs });
    expect(result.specializations).toHaveLength(3);
  });

  test("encrypted build file handles builds with null skills gracefully", async () => {
    await store.upsertBuild({ title: "No Skills", profession: "Warrior", skills: null });
    const builds = await store.listBuilds();
    const key = generateEncryptionKey();
    const result = buildEncryptedBuildFile(builds[0], "test1234", key);
    expect(result.filePath).toBe("site/builds/test1234.enc");
    expect(result.content.length).toBeGreaterThan(0);
  });
});
