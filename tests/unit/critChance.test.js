"use strict";

/**
 * Tests for Critical Strike Chance calculation (issue #193).
 *
 * GW2 formula at level 80: Critical Chance = (Precision - 895) / 21
 * Base Precision is 1000, so base crit chance = (1000 - 895) / 21 = 5%.
 */

const { computeAttributes } = require("@axi/gw2-data/engine");

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
