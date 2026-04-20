"use strict";

/**
 * WvW berserk crit regression tests (issue #259).
 *
 * Data source: packages/gw2-data/tests/fixtures/fixtures.json (real GW2 API data,
 * wiki-verified). The GW2 wiki confirms for Smash Brawler (trait 2049):
 *   "15% (5% in WvW) increased critical-strike chance while in berserk mode"
 *
 * In WvW mode, BERSERK_CRIT_CHANCE_WVW = 0: the base berserk crit is suppressed.
 * Crit while in berserk comes entirely from berserk-conditional traits (Smash Brawler WvW: +5%).
 * Previously, the PvE base of 5% was incorrectly added in WvW too, causing +10% instead of +5%.
 */

const path = require("path");
const {
  computeBerserkCritModifier,
  BERSERK_CRIT_CHANCE,
  BERSERK_CRIT_CHANCE_WVW,
} = require("../../../src/renderer/modules/engine-bridge");
const { state } = require("../../../src/renderer/modules/state");

// Load real GW2 API fixture data (captured from live API + wiki-verified)
const FIXTURES = require(path.join(
  __dirname,
  "../../../packages/gw2-data/tests/fixtures/fixtures.json"
));

const SMASH_BRAWLER_TRAIT_ID = 2049;
const BERSERK_SKILL_ID = 30185;

// Real Smash Brawler trait from GW2 API — facts are unmodified API response.
// Wiki: "Critical Chance Increase 15% (PvE/PvP) / 5% (WvW)"
const smashBrawlerApiTrait = FIXTURES.traits.find((t) => t.id === SMASH_BRAWLER_TRAIT_ID)?.api;
if (!smashBrawlerApiTrait) {
  throw new Error(
    "Smash Brawler (trait 2049) not found in fixtures.json. " +
    "Run: node packages/gw2-data/tests/fixtures/capture.js"
  );
}

// Wiki-verified expected values for Smash Brawler crit:
const SMASH_BRAWLER_CRIT_PVE = 15; // wiki: "15% in PvE/PvP"
const SMASH_BRAWLER_CRIT_WVW = 5;  // wiki: "5% in WvW"

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

// Catalog built from real API data — only mock is specializationById (API doesn't
// include minorTraits in the traits endpoint; full catalog requires profession fetch).
const realDataCatalog = {
  traitById: new Map([[SMASH_BRAWLER_TRAIT_ID, smashBrawlerApiTrait]]),
  specializationById: new Map([[18, { id: 18, minorTraits: [] }]]),
  skillById: new Map(),
};

beforeEach(() => {
  state.activeCatalog = realDataCatalog;
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

describe("Smash Brawler fixture data integrity", () => {
  test("fixture contains exactly two Critical Chance Increase facts", () => {
    const critFacts = smashBrawlerApiTrait.facts.filter(
      (f) => f.type === "Percent" && f.text === "Critical Chance Increase"
    );
    expect(critFacts).toHaveLength(2);
  });

  test("first crit fact is 15% (PvE/PvP, wiki-verified)", () => {
    const critFacts = smashBrawlerApiTrait.facts.filter(
      (f) => f.type === "Percent" && f.text === "Critical Chance Increase"
    );
    expect(critFacts[0].percent).toBe(SMASH_BRAWLER_CRIT_PVE);
  });

  test("second crit fact is 5% (WvW, wiki-verified)", () => {
    const critFacts = smashBrawlerApiTrait.facts.filter(
      (f) => f.type === "Percent" && f.text === "Critical Chance Increase"
    );
    expect(critFacts[1].percent).toBe(SMASH_BRAWLER_CRIT_WVW);
  });
});

describe("computeBerserkCritModifier — WvW mode (issue #259)", () => {
  test("WvW + berserk active + Smash Brawler: returns 5% (Smash Brawler WvW only, wiki-verified)", () => {
    state.editor = makeEditor({ gameMode: "wvw" });
    const result = computeBerserkCritModifier(state);
    // BERSERK_CRIT_CHANCE_WVW (0) + Smash Brawler WvW (5) = 5
    expect(result).toBe(SMASH_BRAWLER_CRIT_WVW);
  });

  test("WvW + berserk inactive: returns 0", () => {
    state.editor = makeEditor({ gameMode: "wvw", activeKit: 0 });
    expect(computeBerserkCritModifier(state)).toBe(0);
  });

  test("PvE + berserk active + Smash Brawler: returns 20% (5 base + 15 Smash Brawler PvE, wiki-verified)", () => {
    state.editor = makeEditor({ gameMode: "pve" });
    const result = computeBerserkCritModifier(state);
    // BERSERK_CRIT_CHANCE (5) + Smash Brawler PvE (15) = 20
    expect(result).toBe(BERSERK_CRIT_CHANCE + SMASH_BRAWLER_CRIT_PVE);
  });

  test("WvW + berserk active + no Smash Brawler: returns 0 (no base berserk crit in WvW)", () => {
    state.editor = {
      ...makeEditor({ gameMode: "wvw" }),
      specializations: [{ specializationId: 18, majorChoices: {} }],
    };
    expect(computeBerserkCritModifier(state)).toBe(0);
  });

  test("PvE + berserk active + no Smash Brawler: returns 5% (base berserk crit only)", () => {
    state.editor = {
      ...makeEditor({ gameMode: "pve" }),
      specializations: [{ specializationId: 18, majorChoices: {} }],
    };
    expect(computeBerserkCritModifier(state)).toBe(BERSERK_CRIT_CHANCE);
  });
});
