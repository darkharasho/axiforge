"use strict";

/**
 * Tests for Critical Strike Chance calculation (issue #193).
 *
 * GW2 formula at level 80: Critical Chance = (Precision - 895) / 21
 * Base Precision is 1000, so base crit chance = (1000 - 895) / 21 = 5%.
 */

const { computeAttributes } = require("@axiapps/gw2-data/engine");

function makeCtx(overrides = {}) {
  return {
    profession: "Warrior",
    specializations: [],
    equipment: {
      slots: {},
      weapons: {},
      runes: {},
      infusions: {},
      enrichment: null,
      food: null,
      utility: null,
    },
    gameMode: "pve",
    underwaterMode: false,
    activeWeaponSet: 1,
    skills: {},
    assumedBoons: null,
    sigilStacks: null,
    ...overrides,
  };
}

function makeCatalogs() {
  return {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    sigilById: new Map(),
    relicById: new Map(),
  };
}

describe("Critical Strike Chance formula (issue #193)", () => {
  test("base precision 1000 gives 5% crit chance, not 10%", () => {
    const ctx = makeCtx();
    const result = computeAttributes(ctx, makeCatalogs());
    // GW2 formula: (1000 - 895) / 21 = 5.0%
    expect(result.derived.critChance).toBeCloseTo(5.0, 1);
  });

  test("precision 2000 gives correct crit chance", () => {
    const ctx = makeCtx();
    const result = computeAttributes(ctx, makeCatalogs());
    // With 1000 base precision: (1000 - 895) / 21 ≈ 5.0
    // The formula should NOT add an extra 5%
    expect(result.derived.critChance).toBeLessThan(6);
  });
});

describe("Skill-specific crit traits must not inflate crit chance (issue #209)", () => {
  test("Precise Strike (trait 1011) does not add 100% crit chance", () => {
    // Trait 1011 "Opening Strike has an increased chance to critically strike"
    // The percent:100 fact means Opening Strike gets 100% crit, NOT a passive bonus
    const catalogs = makeCatalogs();
    catalogs.traitById = new Map([
      [1011, {
        id: 1011,
        slot: "Minor",
        description: "Opening Strike has an increased chance to critically strike.",
        facts: [
          { type: "Percent", text: "Critical Chance Increase", percent: 100 },
        ],
      }],
    ]);
    catalogs.specializationById = new Map([
      [8, { minorTraits: [1011] }],
    ]);

    const ctx = makeCtx({
      profession: "Ranger",
      specializations: [{ specializationId: 8, majorChoices: {} }],
    });

    const result = computeAttributes(ctx, catalogs);
    // Base crit is ~5%. With the bug, this would be 100%.
    expect(result.derived.critChance).toBeLessThan(10);
  });

  test("Hidden Killer (trait 1215) does not add 100% crit chance", () => {
    const catalogs = makeCatalogs();
    catalogs.traitById = new Map([
      [1215, {
        id: 1215,
        slot: "Major",
        description: "Gain bonus critical-hit chance while stealthed.",
        facts: [
          { type: "Percent", text: "Critical Chance Increase", percent: 100 },
        ],
      }],
    ]);

    const ctx = makeCtx({
      profession: "Thief",
      specializations: [{ id: 35, majorChoices: { 3: 1215 } }],
    });

    const result = computeAttributes(ctx, catalogs);
    expect(result.derived.critChance).toBeLessThan(10);
  });

  test("Burst Precision (trait 1336) does not add 100% crit chance", () => {
    const catalogs = makeCatalogs();
    catalogs.traitById = new Map([
      [1336, {
        id: 1336,
        slot: "Major",
        description: "Burst skills have an increased critical chance.",
        facts: [
          { type: "Percent", text: "Critical Chance Increase", percent: 100 },
        ],
      }],
    ]);

    const ctx = makeCtx({
      profession: "Warrior",
      specializations: [{ id: 36, majorChoices: { 3: 1336 } }],
    });

    const result = computeAttributes(ctx, catalogs);
    expect(result.derived.critChance).toBeLessThan(10);
  });
});
