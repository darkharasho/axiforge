"use strict";

/**
 * WvW berserk crit regression tests (issue #259).
 *
 * In WvW mode, BERSERK_CRIT_CHANCE_WVW = 0: the base berserk crit is suppressed.
 * Crit while in berserk comes entirely from berserk-conditional traits (Smash Brawler WvW: +5%).
 * Previously, the PvE base of 5% was incorrectly added in WvW too, causing +10% instead of +5%.
 */

const {
  computeBerserkCritModifier,
  BERSERK_CRIT_CHANCE,
  BERSERK_CRIT_CHANCE_WVW,
} = require("../../../src/renderer/modules/engine-bridge");
const { state } = require("../../../src/renderer/modules/state");

const SMASH_BRAWLER_TRAIT_ID = 2049;
const BERSERK_SKILL_ID = 30185;

function makeEditor(overrides = {}) {
  return {
    profession: "Warrior",
    equipment: { slots: {}, food: "", utility: "", weapons: {}, runes: {}, infusions: {} },
    specializations: [{ specializationId: 18, majorChoices: { 1: SMASH_BRAWLER_TRAIT_ID } }],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    activeKit: BERSERK_SKILL_ID,
    ...overrides,
  };
}

const smashBrawlerCatalog = {
  traitById: new Map([[SMASH_BRAWLER_TRAIT_ID, {
    id: SMASH_BRAWLER_TRAIT_ID,
    slot: "Major",
    description: "Smash Brawler",
    facts: [
      { type: "Percent", text: "Critical Chance Increase", percent: 15 }, // PvE
      { type: "Percent", text: "Critical Chance Increase", percent: 5 },  // WvW
    ],
    specialization: 18,
  }]]),
  specializationById: new Map([[18, { id: 18, minorTraits: [] }]]),
  skillById: new Map(),
};

beforeEach(() => {
  state.activeCatalog = smashBrawlerCatalog;
});
afterEach(() => {
  state.activeCatalog = null;
});

describe("BERSERK_CRIT_CHANCE_WVW constant", () => {
  test("BERSERK_CRIT_CHANCE is 5 (PvE base)", () => {
    expect(BERSERK_CRIT_CHANCE).toBe(5);
  });

  test("BERSERK_CRIT_CHANCE_WVW is 0 (no inherent berserk crit in WvW)", () => {
    expect(BERSERK_CRIT_CHANCE_WVW).toBe(0);
  });
});

describe("computeBerserkCritModifier — WvW mode (issue #259)", () => {
  test("WvW + berserk active + Smash Brawler: returns 5% (Smash Brawler WvW only)", () => {
    state.editor = makeEditor({ gameMode: "wvw" });
    const result = computeBerserkCritModifier(state);
    // Should be BERSERK_CRIT_CHANCE_WVW (0) + Smash Brawler WvW (5) = 5
    expect(result).toBe(5);
  });

  test("WvW + berserk inactive: returns 0", () => {
    state.editor = makeEditor({ gameMode: "wvw", activeKit: 0 });
    const result = computeBerserkCritModifier(state);
    expect(result).toBe(0);
  });

  test("PvE + berserk active + Smash Brawler: returns 20% (5 base + 15 Smash Brawler PvE)", () => {
    state.editor = makeEditor({ gameMode: "pve" });
    const result = computeBerserkCritModifier(state);
    // BERSERK_CRIT_CHANCE (5) + Smash Brawler PvE (15) = 20
    expect(result).toBe(20);
  });

  test("WvW + berserk active + no Smash Brawler: returns 0 (no base berserk crit in WvW)", () => {
    state.editor = {
      ...makeEditor({ gameMode: "wvw" }),
      specializations: [{ specializationId: 18, majorChoices: {} }],
    };
    const result = computeBerserkCritModifier(state);
    // BERSERK_CRIT_CHANCE_WVW (0) + no traits = 0
    expect(result).toBe(0);
  });

  test("PvE + berserk active + no Smash Brawler: returns 5% (base berserk crit)", () => {
    state.editor = {
      ...makeEditor({ gameMode: "pve" }),
      specializations: [{ specializationId: 18, majorChoices: {} }],
    };
    const result = computeBerserkCritModifier(state);
    // BERSERK_CRIT_CHANCE (5) = 5
    expect(result).toBe(5);
  });
});
