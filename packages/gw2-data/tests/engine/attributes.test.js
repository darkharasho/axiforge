"use strict";

const { computeAttributes, computeSlotStats, getExcludedSlots } = require("../../src/engine/attributes");

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

function makeCatalogs(overrides = {}) {
  return {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    infusionById: new Map(),
    enrichmentById: new Map(),
    ...overrides,
  };
}

describe("getExcludedSlots", () => {
  test("excludes aquatic slots in land mode", () => {
    const excluded = getExcludedSlots(false, 1);
    expect(excluded.has("breather")).toBe(true);
    expect(excluded.has("aquatic1")).toBe(true);
    expect(excluded.has("aquatic2")).toBe(true);
    expect(excluded.has("head")).toBe(false);
  });

  test("excludes land weapon slots in land mode for inactive set", () => {
    const excluded = getExcludedSlots(false, 1);
    expect(excluded.has("mainhand2")).toBe(true);
    expect(excluded.has("offhand2")).toBe(true);
    expect(excluded.has("mainhand1")).toBe(false);
  });

  test("excludes land-only slots in underwater mode", () => {
    const excluded = getExcludedSlots(true, 1);
    expect(excluded.has("head")).toBe(true);
    expect(excluded.has("mainhand1")).toBe(true);
    expect(excluded.has("breather")).toBe(false);
  });
});

describe("computeSlotStats", () => {
  test("3-stat combo returns major + minor stats", () => {
    const result = computeSlotStats("Berserker's", "chest", {}, "pve");
    expect(result).toEqual([
      { stat: "Power", value: 141 },
      { stat: "Precision", value: 101 },
      { stat: "Ferocity", value: 101 },
    ]);
  });

  test("4-stat combo returns 2 major + 2 minor stats", () => {
    const result = computeSlotStats("Marauder's", "chest", {}, "pve");
    expect(result).toEqual([
      { stat: "Power", value: 121 },
      { stat: "Precision", value: 121 },
      { stat: "Vitality", value: 66 },
      { stat: "Ferocity", value: 66 },
    ]);
  });

  test("Celestial uses c weight for all stats", () => {
    const result = computeSlotStats("Celestial", "chest", {}, "pve");
    expect(result.every((r) => r.value === 66)).toBe(true);
    expect(result).toHaveLength(9);
  });

  test("WvW Celestial excludes Expertise and Concentration", () => {
    const result = computeSlotStats("Celestial", "chest", {}, "wvw");
    expect(result.find((r) => r.stat === "Expertise")).toBeUndefined();
    expect(result.find((r) => r.stat === "Concentration")).toBeUndefined();
    expect(result).toHaveLength(7);
  });

  test("two-handed weapon uses TWO_HAND_WEIGHTS", () => {
    const weapons = { mainhand1: "greatsword" };
    const result = computeSlotStats("Berserker's", "mainhand1", weapons, "pve");
    expect(result[0]).toEqual({ stat: "Power", value: 251 });
  });
});

describe("computeAttributes", () => {
  test("empty build returns base stats only", () => {
    const result = computeAttributes(makeCtx(), makeCatalogs());
    expect(result.base.Power).toBe(1000);
    expect(result.base.Precision).toBe(1000);
    expect(result.base.Toughness).toBe(1000);
    expect(result.base.Vitality).toBe(1000);
    expect(result.base.Ferocity).toBe(0);
    expect(result.total.Power).toBe(1000);
  });

  test("equipment slots contribute to total", () => {
    const ctx = makeCtx({
      equipment: { slots: { chest: "Berserker's" }, weapons: {}, runes: {}, infusions: {} },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.equipment.Power).toBe(141);
    expect(result.total.Power).toBe(1141);
  });

  test("food flat bonuses parsed from buff text", () => {
    const catalogs = makeCatalogs({
      foodById: new Map([[100, { name: "Steak", buff: "+100 Power" }]]),
    });
    const ctx = makeCtx({ equipment: { slots: {}, weapons: {}, runes: {}, infusions: {}, food: 100 } });
    const result = computeAttributes(ctx, catalogs);
    expect(result.food.Power).toBe(100);
  });

  test("food 'to All Attributes' adds to all stats", () => {
    const catalogs = makeCatalogs({
      foodById: new Map([[101, { name: "Feast", buff: "+50 to All Attributes" }]]),
    });
    const ctx = makeCtx({ equipment: { slots: {}, weapons: {}, runes: {}, infusions: {}, food: 101 } });
    const result = computeAttributes(ctx, catalogs);
    expect(result.food.Power).toBe(50);
    expect(result.food.Ferocity).toBe(50);
    expect(result.food.HealingPower).toBe(50);
  });

  test("rune bonuses are cumulative per piece", () => {
    const catalogs = makeCatalogs({
      runeById: new Map([[24836, { name: "Scholar", bonuses: ["+25 Power", "+35 Ferocity", "+50 Power"] }]]),
    });
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: {}, runes: { head: 24836, shoulders: 24836, chest: 24836 }, infusions: {} },
    });
    const result = computeAttributes(ctx, catalogs);
    expect(result.runes.Power).toBe(75);
    expect(result.runes.Ferocity).toBe(35);
  });

  test("infusion attributes added", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: {}, infusions: { chest: [49431, 49431] }, runes: {} },
    });
    const result = computeAttributes(ctx, catalogs);
    expect(result.infusions.Power).toBe(10);
  });

  test("1H mainhand infusions count only 1 slot, not full array length (issue #201)", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    // mainhand1 has a 1H weapon (axe) with a 2-entry infusion array both filled
    const ctx = makeCtx({
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "axe" },
        runes: {},
        infusions: { mainhand1: [49431, 49431] },
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // Only 1 infusion should be counted for a 1H weapon, not 2
    expect(result.infusions.Power).toBe(5);
  });

  test("2H mainhand infusions count both slots (issue #201)", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    // mainhand1 has a 2H weapon (greatsword) with both infusion slots filled
    const ctx = makeCtx({
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "greatsword" },
        runes: {},
        infusions: { mainhand1: [49431, 49431] },
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // Both infusions should be counted for a 2H weapon
    expect(result.infusions.Power).toBe(10);
  });

  test("weapon swap does not change infusion count between 2H and 1H+1H sets (issue #201)", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    // Set 1: greatsword (2H) with 2 infusions
    // Set 2: axe (1H) + axe offhand (1H), each with 1 infusion
    const baseEquipment = {
      slots: {},
      weapons: { mainhand1: "greatsword", mainhand2: "axe", offhand2: "axe" },
      runes: {},
      infusions: {
        mainhand1: [49431, 49431],
        offhand1: [""],
        mainhand2: [49431, 49431],  // BUG: both filled by "Fill Infusions"
        offhand2: [49431],
      },
    };

    // Set 1 active: greatsword = 2 infusions
    const ctx1 = makeCtx({ activeWeaponSet: 1, equipment: { ...baseEquipment } });
    const result1 = computeAttributes(ctx1, catalogs);

    // Set 2 active: axe+axe = 2 infusions (1 mainhand + 1 offhand)
    const ctx2 = makeCtx({ activeWeaponSet: 2, equipment: { ...baseEquipment } });
    const result2 = computeAttributes(ctx2, catalogs);

    // Both sets should contribute the same number of infusion stats
    expect(result1.infusions.Power).toBe(10);  // 2 infusions × 5 Power
    expect(result2.infusions.Power).toBe(10);  // 2 infusions × 5 Power (not 3!)
  });

  test("offhand infusion not counted when mainhand has two-handed weapon (issue #226)", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    // mainhand1 = greatsword (2H), offhand1 weapon is empty (locked) but has leftover infusion
    const ctx = makeCtx({
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "greatsword" },
        runes: {},
        infusions: {
          mainhand1: [49431, 49431],
          offhand1: [49431],  // ghost infusion from previous 1H+offhand setup
        },
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // Should count only 2 infusions (greatsword mainhand1), not 3 (+ ghost offhand)
    expect(result.infusions.Power).toBe(10);
  });

  test("offhand infusion counted normally when mainhand is one-handed (issue #226)", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    // mainhand1 = axe (1H), offhand1 = axe (1H), both with infusions
    const ctx = makeCtx({
      activeWeaponSet: 1,
      equipment: {
        slots: {},
        weapons: { mainhand1: "axe", offhand1: "axe" },
        runes: {},
        infusions: {
          mainhand1: [49431, ""],
          offhand1: [49431],
        },
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // Both mainhand and offhand infusions should count
    expect(result.infusions.Power).toBe(10);
  });

  test("assumed Might boons add Power and ConditionDamage", () => {
    const ctx = makeCtx({ assumedBoons: { might: 25 } });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.boons.Power).toBe(750);
    expect(result.boons.ConditionDamage).toBe(750);
  });

  test("derived health uses profession base HP", () => {
    const ctx = makeCtx({ profession: "Warrior" });
    const result = computeAttributes(ctx, makeCatalogs());
    // Warrior base HP = 9212, base Vitality = 1000, health = 9212 + 1000*10 = 19212
    expect(result.derived.health).toBe(19212);
  });

  test("derived crit chance formula", () => {
    const ctx = makeCtx();
    const result = computeAttributes(ctx, makeCatalogs());
    // Base precision 1000: critChance = (1000 - 895) / 21 = 5%
    expect(result.derived.critChance).toBeCloseTo(5, 0);
  });

  test("derived armor includes weight class defense", () => {
    const ctx = makeCtx({ profession: "Warrior" });
    const result = computeAttributes(ctx, makeCatalogs());
    // Warrior = heavy = 1271 defense, base toughness 1000
    expect(result.derived.armor).toBe(2271);
  });

  test("trait conversions applied after base stats", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[500, {
        id: 500,
        facts: [{ type: "BuffConversion", source: "Vitality", target: "Power", percent: 10 }],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [] }]]),
    });
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 500 } }],
    });
    const result = computeAttributes(ctx, catalogs);
    // base Vitality = 1000, 10% = floor(100) = 100
    expect(result.conversions.Power).toBe(100);
    expect(result.total.Power).toBe(1100);
  });

  test("trait conversion does not include utility stats in source (issue #228)", () => {
    // Utility adds +100 Power flat. Trait converts 10% Power → Vitality.
    // The conversion source must be preConvBase (base+gear, no utility), not preConvTotal.
    // If utility Power were included: floor(1100 * 0.10) = 110 (too much).
    // Correct: floor(1000 * 0.10) = 100.
    const catalogs = makeCatalogs({
      traitById: new Map([[1449, {
        id: 1449,
        facts: [{ type: "BuffConversion", source: "Power", target: "Vitality", percent: 10 }],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [] }]]),
      utilityById: new Map([[99001, { id: 99001, buff: "+100 Power" }]]),
    });
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 1449 } }],
      equipment: {
        slots: {},
        weapons: {},
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: 99001,
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // preConvBase.Power = 1000 (base only, utility excluded from trait conversion source)
    expect(result.conversions.Vitality).toBe(100);
    // Total Vitality = 1000 (base) + 100 (conversion) = 1100
    expect(result.total.Vitality).toBe(1100);
    // Utility Power is still present in the total (just excluded from conversion source)
    expect(result.utility.Power).toBe(100);
    expect(result.total.Power).toBe(1100); // 1000 base + 100 utility
  });

  test("Great Fortitude: dual conversion (Power→Vitality and Power→Ferocity) uses preConvBase (issue #228)", () => {
    // Simulates Great Fortitude trait (id 1449) with a utility that adds Power.
    // Both conversions must use preConvBase.Power (without utility's +100 Power).
    const catalogs = makeCatalogs({
      traitById: new Map([[1449, {
        id: 1449,
        facts: [
          { type: "BuffConversion", source: "Power", target: "Vitality", percent: 10 },
          { type: "BuffConversion", source: "Power", target: "CritDamage", percent: 10 },
        ],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [] }]]),
      utilityById: new Map([[99001, { id: 99001, buff: "+100 Power" }]]),
    });
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 1449 } }],
      equipment: {
        slots: { chest: "Berserker's" },
        weapons: {},
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: 99001,
      },
    });
    const result = computeAttributes(ctx, catalogs);
    // preConvBase.Power = 1000 (base) + 141 (Berserker's chest) = 1141
    // Utility adds +100 Power (NOT included in conversion source)
    // Vitality from conversion: floor(1141 * 0.10) = 114
    // Ferocity from conversion: floor(1141 * 0.10) = 114
    expect(result.conversions.Vitality).toBe(114);
    expect(result.conversions.Ferocity).toBe(114);
  });

  test("berserk-conditional trait bonuses only apply when berserkActive", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[2046, {
        id: 2046,
        slot: "Minor",
        description: "Fatal Frenzy",
        facts: [
          { type: "AttributeAdjust", target: "Power", value: 150 },
          { type: "AttributeAdjust", target: "ConditionDamage", value: 300 },
        ],
      }]]),
      specializationById: new Map([[18, { id: 18, minorTraits: [2046] }]]),
    });
    const baseCtx = {
      specializations: [{ id: 18, majorChoices: {} }],
    };

    // Without berserk: bonuses NOT applied
    const resultOff = computeAttributes(makeCtx({ ...baseCtx, berserkActive: false }), catalogs);
    expect(resultOff.traits.Power).toBe(0);
    expect(resultOff.traits.ConditionDamage).toBe(0);

    // With berserk: bonuses applied
    const resultOn = computeAttributes(makeCtx({ ...baseCtx, berserkActive: true }), catalogs);
    expect(resultOn.traits.Power).toBe(150);
    expect(resultOn.traits.ConditionDamage).toBe(300);
  });

  test("Smash Brawler crit chance only applies when berserkActive (issue #225)", () => {
    // Trait 2049 must have berserkConditional:true in overrides.json for this test to pass.
    // Base precision 1000 → crit = (1000-895)/21 = 5%. With Smash Brawler +15% while berserk = 20%.
    const catalogs = makeCatalogs({
      traitById: new Map([[2049, {
        id: 2049,
        slot: "Major",
        description: "Smash Brawler",
        facts: [
          { type: "Percent", text: "Critical Chance Increase", percent: 15 },
          { type: "Percent", text: "Critical Chance Increase", percent: 5 },
        ],
        specialization: 18,
      }]]),
      specializationById: new Map([[18, { id: 18, minorTraits: [] }]]),
    });
    const baseCtx = {
      specializations: [{ id: 18, majorChoices: { 1: 2049 } }],
    };

    // Without berserk: no crit bonus from trait or berserk mode
    const resultOff = computeAttributes(makeCtx({ ...baseCtx, berserkActive: false }), catalogs);
    expect(resultOff.derived.critChance).toBeCloseTo(5, 5);

    // With berserk: +5% base berserk crit + +15% crit from Smash Brawler trait
    const resultOn = computeAttributes(makeCtx({ ...baseCtx, berserkActive: true }), catalogs);
    expect(resultOn.derived.critChance).toBeCloseTo(25, 5);
  });

  test("Smash Brawler WvW: berserk gives only Smash Brawler's 5% — no double-count from base (issue #259)", () => {
    // In WvW, BERSERK_CRIT_CHANCE_WVW = 0. The 5% comes entirely from Smash Brawler WvW fact.
    // Base precision (1000) → (1000-895)/21 = 5%. With berserk + Smash Brawler WvW: +5% = 10% total.
    const catalogs = makeCatalogs({
      traitById: new Map([[2049, {
        id: 2049,
        slot: "Major",
        description: "Smash Brawler",
        facts: [
          { type: "Percent", text: "Critical Chance Increase", percent: 15 }, // PvE
          { type: "Percent", text: "Critical Chance Increase", percent: 5 },  // WvW
        ],
        specialization: 18,
      }]]),
      specializationById: new Map([[18, { id: 18, minorTraits: [] }]]),
    });
    const baseCtx = { specializations: [{ id: 18, majorChoices: { 1: 2049 } }] };

    // Without berserk: no crit bonus
    const resultOff = computeAttributes(makeCtx({ ...baseCtx, gameMode: "wvw", berserkActive: false }), catalogs);
    expect(resultOff.derived.critChance).toBeCloseTo(5, 5);

    // With berserk in WvW: only Smash Brawler WvW (5%) — base berserk crit is 0 in WvW
    const resultOn = computeAttributes(makeCtx({ ...baseCtx, gameMode: "wvw", berserkActive: true }), catalogs);
    expect(resultOn.derived.critChance).toBeCloseTo(10, 5); // 5% precision base + 5% Smash Brawler WvW
  });

  test("base Berserk mode adds +5% crit chance even with no traits (issue #230)", () => {
    const catalogs = makeCatalogs({
      specializationById: new Map([[18, { id: 18, minorTraits: [] }]]),
    });
    const baseCtx = { specializations: [{ id: 18, majorChoices: {} }] };

    const resultOff = computeAttributes(makeCtx({ ...baseCtx, berserkActive: false }), catalogs);
    expect(resultOff.derived.critChance).toBeCloseTo(5, 5); // precision base only

    const resultOn = computeAttributes(makeCtx({ ...baseCtx, berserkActive: true }), catalogs);
    expect(resultOn.derived.critChance).toBeCloseTo(10, 5); // +5% from Berserk mode
  });

  test("signet passive buffs added", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [], eliteId: null },
      equipment: { slots: {}, weapons: {}, runes: {}, infusions: {} },
    });
    // Bane Signet (9093) = +180 Power
    ctx.skills.utilityIds = [9093];
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(180);
  });

  test("signet passive applied when activeSignets entry is true", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      activeSignets: { 9093: true },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(180);
  });

  test("signet passive skipped when activeSignets entry is false", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      activeSignets: { 9093: false },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(0);
  });

  test("signet passive applied when activeSignets is null (backward compat)", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      activeSignets: null,
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(180);
  });

  test("activeSignets toggle is per-signet", () => {
    // Bane Signet (9093) = +180 Power; Signet of Stone (12500) = +180 Toughness
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093, 12500], eliteId: null },
      activeSignets: { 9093: true, 12500: false },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(180);
    expect(result.signets.Toughness).toBe(0);
  });

  test("Pinnacle of Strength adds +10 Power per Might stack (40 instead of 30)", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[1453, {
        id: 1453,
        slot: "Minor",
        description: "Might applied to you grants more power. Your critical-hit chance is increased.",
        facts: [
          { type: "AttributeAdjust", target: "Power", value: 10 },
          { type: "Percent", text: "Critical Chance Increase", percent: 5 },
        ],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [1453] }]]),
    });
    const ctx = makeCtx({
      specializations: [{ specializationId: 4, majorChoices: {} }],
      assumedBoons: { might: 25 },
    });
    const result = computeAttributes(ctx, catalogs);
    // 25 stacks * 40 Power per stack = 1000 (not 750 + 10 passive)
    expect(result.boons.Power).toBe(1000);
    // No passive +10 Power from traits
    expect(result.traits.Power).toBe(0);
  });

  test("Pinnacle of Strength does not add Power when Might is 0", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[1453, {
        id: 1453,
        slot: "Minor",
        description: "Might applied to you grants more power. Your critical-hit chance is increased.",
        facts: [
          { type: "AttributeAdjust", target: "Power", value: 10 },
          { type: "Percent", text: "Critical Chance Increase", percent: 5 },
        ],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [1453] }]]),
    });
    const ctx = makeCtx({
      specializations: [{ specializationId: 4, majorChoices: {} }],
      assumedBoons: null,
    });
    const result = computeAttributes(ctx, catalogs);
    // No might = no bonus Power at all
    expect(result.boons.Power).toBe(0);
    expect(result.traits.Power).toBe(0);
  });

  test("Pinnacle of Strength adds passive 5% crit chance", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[1453, {
        id: 1453,
        slot: "Minor",
        description: "Might applied to you grants more power. Your critical-hit chance is increased.",
        facts: [
          { type: "AttributeAdjust", target: "Power", value: 10 },
          { type: "Percent", text: "Critical Chance Increase", percent: 5 },
        ],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [1453] }]]),
    });
    const ctx = makeCtx({
      specializations: [{ specializationId: 4, majorChoices: {} }],
    });
    const result = computeAttributes(ctx, catalogs);
    // Base crit at 1000 Precision = (1000-895)/21 = 5%
    // + 5% from Pinnacle of Strength = 10%
    expect(result.derived.critChance).toBeCloseTo(10, 0);
  });
});
