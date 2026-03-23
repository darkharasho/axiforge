"use strict";

// computeCompBoonCoverage is in comp-boon-coverage.js which imports from
// boon-coverage.js (which imports from constants.js etc). Jest handles
// ES module transpilation via babel — same as the existing boon-coverage tests.
const { computeCompBoonCoverage } = require("../../../src/renderer/modules/comps/comp-boon-coverage");

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeComp(partyLines = []) {
  return { id: "comp-1", partyLines };
}

function makeLine(id, slots = []) {
  return { id, slots, capacity: 5 };
}

function makeBuild(id, profession, overrides = {}) {
  return {
    id,
    title: overrides.title || id,
    profession,
    gameMode: overrides.gameMode || "pve",
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    equipment: { weapons: {} },
    underwaterMode: false,
    activeWeaponSet: 1,
    ...overrides,
  };
}

// A catalog that produces Might from heal skill 100
function makeCatalog(skillsById = new Map()) {
  return {
    skillById: skillsById,
    traitById: new Map(),
    weaponSkillById: new Map(),
    specializationById: new Map(),
    skills: [],
    professionWeapons: {},
    legendById: new Map(),
    petById: new Map(),
  };
}

function makeMightSkill() {
  return {
    id: 100, name: "Healing Surge",
    description: "Heal yourself.",
    facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }],
    type: "Heal",
  };
}

function makeFurySkill() {
  return {
    id: 200, name: "Signet of Fury",
    description: "Grant Fury to allies.",
    facts: [{ type: "Buff", status: "Fury", duration: 6, apply_count: 0 }],
    type: "Utility",
  };
}

// Fake getCatalog: warms the catalogCache Map with the provided catalog
function makeGetCatalog(catalogCache, catalog) {
  return async (profession, gameMode) => {
    const key = `${profession}_${gameMode}`;
    if (!catalogCache.has(key)) catalogCache.set(key, catalog);
    return catalogCache.get(key);
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeCompBoonCoverage", () => {
  test("returns empty squad and empty lines when comp has no partyLines", async () => {
    const comp = makeComp([]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], new Map(), async () => null);
    expect(squad.size).toBe(0);
    expect(lines).toHaveLength(0);
  });

  test("returns empty squad when all lines have empty slots", async () => {
    const comp = makeComp([makeLine("l1", []), makeLine("l2", [])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], new Map(), async () => null);
    expect(squad.size).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0].boons.size).toBe(0);
    expect(lines[0].hasFilledSlots).toBe(false);
  });

  test("counts one boon from one build in one line", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might")).toMatchObject({ count: 1 });
    expect(squad.get("Might").providers).toHaveLength(1);
    expect(squad.get("Might").providers[0]).toMatchObject({
      buildId: "b1",
      buildName: "b1",
      lineLabel: "P1",
    });

    expect(lines[0].label).toBe("P1");
    expect(lines[0].hasFilledSlots).toBe(true);
    expect(lines[0].boons.get("Might")).toMatchObject({ count: 1 });
    expect(lines[0].boons.get("Might").providers[0]).toMatchObject({ buildId: "b1" });
  });

  test("aggregates the same boon from two builds in one line", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Guardian");
    b2.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1", "b2"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(2);
    expect(squad.get("Might").providers).toHaveLength(2);
    expect(lines[0].boons.get("Might").count).toBe(2);
  });

  test("aggregates boons across two lines into squad total", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Ranger");
    b2.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"]), makeLine("l2", ["b2"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(2);
    expect(squad.get("Might").providers[0].lineLabel).toBe("P1");
    expect(squad.get("Might").providers[1].lineLabel).toBe("P2");
    expect(lines[0].boons.get("Might").count).toBe(1);
    expect(lines[1].boons.get("Might").count).toBe(1);
  });

  test("different boons from different builds appear separately in squad", async () => {
    const b1 = makeBuild("b1", "Guardian");
    b1.skills.healId = 100;
    const b2 = makeBuild("b2", "Guardian");
    b2.skills.utilityIds = [200, 0, 0];
    const catalog = makeCatalog(new Map([[100, makeMightSkill()], [200, makeFurySkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1", "b2"])]);
    const { squad } = await computeCompBoonCoverage(comp, [b1, b2], catalogCache, getCatalog);

    expect(squad.get("Might").count).toBe(1);
    expect(squad.get("Fury").count).toBe(1);
  });

  test("skips build IDs not found in builds array", async () => {
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["ghost-build-id"])]);
    const { squad, lines } = await computeCompBoonCoverage(comp, [], catalogCache, getCatalog);

    expect(squad.size).toBe(0);
    expect(lines[0].hasFilledSlots).toBe(false);
  });

  test("skips builds whose catalog is not available", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    // getCatalog returns null — catalog never makes it into catalogCache
    const catalogCache = new Map();
    const getCatalog = async () => null;

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.size).toBe(0);
  });

  test("includes eliteSpec in providers when build has an elite specialization", async () => {
    const build = makeBuild("b1", "Guardian", {
      specializations: [{ specializationId: 62, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    });
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    catalog.specializationById = new Map([[62, { id: 62, name: "Firebrand", elite: true }]]);
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might").providers[0]).toMatchObject({
      buildId: "b1",
      eliteSpec: "Firebrand",
    });
  });

  test("includes eliteSpec from serialized build format (spec.elite + spec.name direct)", async () => {
    // Serialized builds store specializations with .elite and .name directly (no catalog lookup needed)
    const build = makeBuild("b1", "Guardian", {
      specializations: [{ id: 62, name: "Firebrand", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    });
    build.skills = { heal: null, utility: [{ id: 100, name: "Healing Surge" }], elite: null };
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might").providers[0]).toMatchObject({ eliteSpec: "Firebrand" });
  });

  test("eliteSpec is null when build uses no elite specialization", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    catalog.specializationById = new Map([[10, { id: 10, name: "Valor", elite: false }]]);
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might").providers[0].eliteSpec).toBeNull();
  });

  test("uses build.title as buildName when available", async () => {
    const build = makeBuild("b1", "Guardian", { title: "My Firebrand" });
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);

    expect(squad.get("Might").providers[0].buildName).toBe("My Firebrand");
  });
});

// Helper: build a catalog with upgradeCatalog (empty — no Concentration gear)
function makeUpgradeCatalog() {
  return {
    foodById: new Map(), utilityById: new Map(), runeById: new Map(),
    infusionById: new Map(), enrichmentById: new Map(),
  };
}

describe("computeCompBoonCoverage — sources and effectiveDuration on line providers", () => {
  test("line providers include sources array with effectiveDuration", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    // makeMightSkill has duration: 10, apply_count: 5
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const upgradeCatalog = makeUpgradeCatalog(); // no Concentration gear → bonus = 0
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, upgradeCatalog);

    const mightEntry = lines[0].boons.get("Might");
    expect(mightEntry).toBeDefined();
    const provider = mightEntry.providers[0];
    expect(provider.sources).toBeDefined();
    expect(provider.sources).toHaveLength(1);
    expect(provider.sources[0]).toMatchObject({
      type: "skill",
      name: "Healing Surge",
      stacks: 5,
      effectiveDuration: 10, // base 10s * (1 + 0) = 10s, no concentration
    });
  });

  test("effectiveDuration is multiplied by concentrationBonus from gear", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    // Give build Harrier's chest — gives 101 Concentration (ascended)
    build.equipment.slots = { chest: "Harrier's" };

    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    // makeMightSkill: duration: 10
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const upgradeCatalog = makeUpgradeCatalog();
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, upgradeCatalog);

    const provider = lines[0].boons.get("Might").providers[0];
    // 101 Concentration → 101/1500 = 0.0673 → 10 * 1.0673 = 10.7
    expect(provider.sources[0].effectiveDuration).toBeCloseTo(10.7, 1);
  });

  test("sources with duration 0 are filtered out", async () => {
    const zeroDurationSkill = {
      id: 300, name: "Zero Dur Skill",
      description: "Grant Might to allies.",
      facts: [{ type: "Buff", status: "Might", duration: 0, apply_count: 3 }],
      type: "Utility",
    };
    const build = makeBuild("b1", "Guardian");
    build.skills.utilityIds = [300, 0, 0];
    const catalog = makeCatalog(new Map([[300, zeroDurationSkill]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, makeUpgradeCatalog());

    // Might is provided (boon exists) but its source has duration 0 — filtered from sources
    const mightEntry = lines[0].boons.get("Might");
    if (mightEntry) {
      const provider = mightEntry.providers[0];
      if (provider?.sources) {
        expect(provider.sources.every(s => s.effectiveDuration > 0)).toBe(true);
      }
    }
  });

  test("squad providers do NOT include sources", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    const { squad } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog, makeUpgradeCatalog());

    const squadProvider = squad.get("Might").providers[0];
    expect(squadProvider.sources).toBeUndefined();
  });

  test("works with upgradeCatalog as undefined (backward compat)", async () => {
    const build = makeBuild("b1", "Guardian");
    build.skills.healId = 100;
    const catalog = makeCatalog(new Map([[100, makeMightSkill()]]));
    const catalogCache = new Map();
    const getCatalog = makeGetCatalog(catalogCache, catalog);

    const comp = makeComp([makeLine("l1", ["b1"])]);
    // Call without 5th param — should not throw
    const { lines } = await computeCompBoonCoverage(comp, [build], catalogCache, getCatalog);
    expect(lines[0].boons.get("Might")).toBeDefined();
  });
});
