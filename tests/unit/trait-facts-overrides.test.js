"use strict";

/**
 * Trait facts overrides (#162)
 *
 * The GW2 API returns incorrect fact values for some traits.
 * KNOWN_TRAIT_FACTS_OVERRIDES patches the facts array at catalog build time,
 * mirroring the existing KNOWN_SKILL_FACTS_OVERRIDES pattern.
 *
 * Versatile Rage (trait 1415, Discipline spec 51):
 *   - API returns Recharge: 4s
 *   - In-game value is Recharge: 5s
 */

// Mock the balance-splits module
jest.mock("../../lib/gw2-balance-splits", () => ({
  getSkillSplit: () => null,
  getTraitSplit: () => null,
  getSkillPveFacts: () => null,
  getTraitPveFacts: () => null,
}));

// Mock fetch module (required by catalog.js at import time)
jest.mock("../../src/main/gw2Data/fetch", () => ({
  GW2_API_ROOT: "https://api.guildwars2.com/v2",
  fetchCachedJson: jest.fn(),
  fetchGw2ByIds: jest.fn().mockResolvedValue([]),
  dedupeNumbers: (arr) => [...new Set(arr)],
}));

const {
  KNOWN_TRAIT_FACTS_OVERRIDES,
} = require("../../src/main/gw2Data/overrides");

describe("Trait facts overrides (#162)", () => {
  test("Versatile Rage (1415) has Recharge override of 5s", () => {
    const facts = KNOWN_TRAIT_FACTS_OVERRIDES.get(1415);
    expect(facts).toBeDefined();
    const recharge = facts.find((f) => f.type === "Recharge");
    expect(recharge).toBeDefined();
    expect(recharge.value).toBe(5);
  });

  test("Versatile Rage override preserves non-recharge facts", () => {
    const facts = KNOWN_TRAIT_FACTS_OVERRIDES.get(1415);
    const adrenaline = facts.find((f) => f.type === "Number" && f.text === "Adrenaline");
    expect(adrenaline).toBeDefined();
    expect(adrenaline.value).toBe(5);
    const combatOnly = facts.find((f) => f.type === "NoData" && f.text === "Combat Only");
    expect(combatOnly).toBeDefined();
  });
});
