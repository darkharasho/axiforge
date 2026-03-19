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
