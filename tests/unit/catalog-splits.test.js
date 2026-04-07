/**
 * Integration tests for balance splits applied during catalog construction.
 *
 * These tests import and exercise the actual applyBalanceSplit function from
 * catalog.js, which is the same function called by mapSkill(), traits.map(),
 * and weaponSkills mapping during catalog construction.
 */

// Mock the balance-splits module that catalog.js imports.
// Path is relative to this test file; Jest resolves it to an absolute path and
// matches it against any require() that resolves to the same absolute path.
jest.mock("../../lib/gw2-balance-splits", () => ({
  getSkillSplit: (id, mode) => {
    if (mode === "pve") return null;
    const splits = {
      "1234": { facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }] },
    };
    return splits[String(id)] || null;
  },
  getTraitSplit: (id, mode) => {
    if (mode === "pve") return null;
    const splits = {
      "5678": { facts: [{ type: "Buff", text: "Might", status: "Might", duration: 5, apply_count: 2 }] },
    };
    return splits[String(id)] || null;
  },
  getSkillPveFacts: (id) => {
    const data = {
      "1234": { facts: [{ type: "AttributeAdjust", text: "Healing", value: 100, target: "Healing", hit_count: 1, coefficient: 0.75 }] },
    };
    return data[String(id)] || null;
  },
  getTraitPveFacts: () => null,
}));

// Mock fetch module (required by catalog.js at import time)
jest.mock("../../src/main/gw2Data/fetch", () => ({
  GW2_API_ROOT: "https://api.guildwars2.com/v2",
  fetchCachedJson: jest.fn(),
  fetchGw2ByIds: jest.fn().mockResolvedValue([]),
  dedupeNumbers: (arr) => [...new Set(arr)],
}));

// Mock overrides module (required by catalog.js at import time)
jest.mock("../../src/main/gw2Data/overrides", () => ({
  KNOWN_SKILL_DESCRIPTION_OVERRIDES: new Map(),
  KNOWN_SKILL_FACTS_OVERRIDES: new Map(),
  KNOWN_TRAIT_FACTS_OVERRIDES: new Map(),
  KNOWN_SKILL_SPEC_OVERRIDES: new Map(),
  KNOWN_SKILL_SLOT_OVERRIDES: new Map(),
  PHOTON_FORGE_SKILL_ID: 0, PHOTON_FORGE_BUNDLE: [],
  RADIANT_FORGE_SKILL_ID: 0, RADIANT_FORGE_BUNDLE: [], RADIANT_FORGE_FLIP_SKILLS: [],
  DEATH_SHROUD_SKILL_ID: 0, DEATH_SHROUD_BUNDLE: [], DEATH_SHROUD_FLIP_SKILLS: [],
  LICH_FORM_SKILL_ID: 0, LICH_FORM_BUNDLE: [], LICH_FORM_FLIP_SKILLS: [],
  SHADOW_SHROUD_SKILL_ID: 0, SHADOW_SHROUD_BUNDLE: [],
  FIREBRAND_TOME_CHAPTERS: new Map(),
  GUNSABER_SKILL_ID: 0, GUNSABER_BUNDLE: [], GUNSABER_BUNDLE_SKILLS: [],
  DRAGON_TRIGGER_SKILL_ID: 0, DRAGON_TRIGGER_BUNDLE: [], DRAGON_TRIGGER_BUNDLE_SKILLS: [],
  ELIXIR_TOOLBELT_OVERRIDES: new Map(),
  LEGEND_FLIP_OVERRIDES: new Map(),
}));

const { applyBalanceSplit } = require("../../src/main/gw2Data/catalog");

describe("Catalog balance splits integration", () => {
  describe("skill splits", () => {
    test("overrides facts for WvW skill with split", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(0.5);
      expect(mapped.hasSplit).toBe(true);
    });

    test("does not override facts for PvE mode", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "pve");
      expect(mapped.facts[0].dmg_multiplier).toBe(1.0);
      expect(mapped.hasSplit).toBeUndefined();
    });

    test("does not override skill without split", () => {
      const mapped = { id: 9999, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(1.0);
      expect(mapped.hasSplit).toBeUndefined();
    });
  });

  describe("trait splits", () => {
    test("merges facts for WvW trait with split — preserves unmatched base facts, appends new split facts", () => {
      const mapped = { id: 5678, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "wvw");
      // Base Number fact has no matching type in the split, so it is preserved unchanged
      expect(mapped.facts[0].type).toBe("Number");
      expect(mapped.facts[0].value).toBe(10);
      // The unmatched split Buff fact is appended and marked
      expect(mapped.facts[1].type).toBe("Buff");
      expect(mapped.facts[1]._splitFact).toBe(true);
      expect(mapped.hasSplit).toBe(true);
    });

    test("does not override facts for PvE mode", () => {
      const mapped = { id: 5678, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "pve");
      expect(mapped.facts[0].type).toBe("Number");
      expect(mapped.hasSplit).toBeUndefined();
    });

    test("does not override trait without split", () => {
      const mapped = { id: 9999, facts: [{ type: "Number", value: 10 }] };
      applyBalanceSplit(mapped, "trait", "wvw");
      expect(mapped.facts[0].type).toBe("Number");
      expect(mapped.hasSplit).toBeUndefined();
    });
  });

  describe("weapon skill splits", () => {
    test("weapon skills use skill split lookup", () => {
      const mapped = { id: 1234, facts: [{ type: "Damage", dmg_multiplier: 1.0 }] };
      applyBalanceSplit(mapped, "skill", "wvw");
      expect(mapped.facts[0].dmg_multiplier).toBe(0.5);
      expect(mapped.hasSplit).toBe(true);
    });
  });
});
