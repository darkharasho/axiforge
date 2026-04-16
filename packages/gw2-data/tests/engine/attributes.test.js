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

  // ── 3-state signet tests ──────────────────────────────────────────────────

  test("signet 'passive' string state applies passive bonus (same as true)", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      activeSignets: { 9093: "passive" },
    });
    expect(computeAttributes(ctx, makeCatalogs()).signets.Power).toBe(180);
  });

  test("signet 'cooldown' state removes passive, applies no active effect", () => {
    // Bane Signet (9093) has no SIGNET_ACTIVE_EFFECTS entry — cooldown = no bonus
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      activeSignets: { 9093: "cooldown" },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(0);
  });

  test("Signet of Fury 'active' state applies +360 Precision +360 Ferocity (not passive +180 Precision)", () => {
    // Signet of Fury (14410): passive = +180 Precision; active = +360 Precision +360 Ferocity
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [14410], eliteId: null },
      activeSignets: { 14410: "active" },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Precision).toBe(360);
    expect(result.signets.Ferocity).toBe(360);
  });

  test("Signet of Might 'active' state removes Power passive and adds 10 Might stacks to boons", () => {
    // Signet of Might (14404): passive = +180 Power; active = 10× Might = +300 Power/Condi
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [14404], eliteId: null },
      activeSignets: { 14404: "active" },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    // Passive Power gone
    expect(result.signets.Power).toBe(0);
    // Boon Power from 10× Might = 10 × 30 = 300
    expect(result.boons.Power).toBe(300);
    expect(result.boons.ConditionDamage).toBe(300);
    // signetActiveBoons exposed for UI
    expect(result.signetActiveBoons.might).toBe(10);
  });

  test("Signet of Fury 'cooldown' removes Precision passive with no active stats", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [14410], eliteId: null },
      activeSignets: { 14410: "cooldown" },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Precision).toBe(0);
    expect(result.signets.Ferocity).toBe(0);
  });

  test("signetActiveBoons.might stacks with user assumedBoons.might", () => {
    // User has 5 assumed Might stacks + Signet of Might active gives 10 more = 15 total
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [14404], eliteId: null },
      activeSignets: { 14404: "active" },
      assumedBoons: { might: 5 },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    // 15 × 30 = 450 Power from boons
    expect(result.boons.Power).toBe(450);
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
