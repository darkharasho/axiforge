"use strict";

/**
 * Tests for stats.js — computeSlotStats() and computeEquipmentStats().
 *
 * These functions drive the attributes panel, health orb, and detail panel
 * damage estimates, so correctness is critical.
 */

const { computeSlotStats, computeEquipmentStats, computeBuildConcentration } = require("../../../src/renderer/modules/stats");
const { state } = require("../../../src/renderer/modules/state");

// ---------------------------------------------------------------------------
// Helpers — reset state.editor before each test
// ---------------------------------------------------------------------------

function makeEditor(slots = {}, food = "", utility = "") {
  return {
    profession: "Warrior",
    equipment: { slots, food, utility, weapons: {} },
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
  };
}

beforeEach(() => {
  state.editor = makeEditor();
});

// ---------------------------------------------------------------------------
// computeSlotStats
// ---------------------------------------------------------------------------

describe("computeSlotStats — 3-stat combos", () => {
  test("Berserker's chest returns Power primary, Precision+Ferocity secondary", () => {
    const result = computeSlotStats("Berserker's", "chest");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ stat: "Power",     value: 134 });
    expect(result[1]).toEqual({ stat: "Precision",  value: 96  });
    expect(result[2]).toEqual({ stat: "Ferocity",   value: 96  });
  });

  test("Berserker's head returns correct head weights", () => {
    const result = computeSlotStats("Berserker's", "head");
    expect(result[0]).toEqual({ stat: "Power",    value: 60 });
    expect(result[1]).toEqual({ stat: "Precision", value: 43 });
    expect(result[2]).toEqual({ stat: "Ferocity",  value: 43 });
  });

  test("returns empty for unknown combo", () => {
    expect(computeSlotStats("Nonexistent Combo", "chest")).toEqual([]);
  });

  test("returns empty for unknown slot", () => {
    expect(computeSlotStats("Berserker's", "unknownSlot")).toEqual([]);
  });

  test("Sinister mainhand1 — 3 stats with ConditionDamage primary", () => {
    const result = computeSlotStats("Sinister", "mainhand1");
    expect(result).toHaveLength(3);
    expect(result[0].stat).toBe("ConditionDamage");
    expect(result[0].value).toBe(120); // p weight for mainhand1
    expect(result[1].stat).toBe("Power");
    expect(result[1].value).toBe(85);  // s weight for mainhand1
  });
});

describe("computeSlotStats — 4-stat combos", () => {
  test("Viper's chest applies 4-stat scaling formula", () => {
    // Viper's: Power, ConditionDamage, Precision, Expertise
    // chest weights: p=134, s=96
    const result = computeSlotStats("Viper's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ stat: "Power",          value: Math.round(134 * 0.895) });
    expect(result[1]).toEqual({ stat: "ConditionDamage", value: Math.round(96  * 0.889) });
    expect(result[2]).toEqual({ stat: "Precision",       value: Math.round(96  * 0.889) });
    expect(result[3]).toEqual({ stat: "Expertise",       value: Math.round(134 * 0.452) });
  });

  test("Marauder's ring1 applies 4-stat formula", () => {
    // ring1 weights: p=126, s=85 (trinket)
    const result = computeSlotStats("Marauder's", "ring1");
    expect(result).toHaveLength(4);
    expect(result[0].stat).toBe("Power");
    expect(result[3].stat).toBe("Ferocity");
    // Each value should be a positive integer
    for (const r of result) expect(r.value).toBeGreaterThan(0);
  });
});

describe("computeSlotStats — missing stat combos (issue #29)", () => {
  test("Sentinel's is defined and uses Vitality as primary 3-stat", () => {
    const result = computeSlotStats("Sentinel's", "chest");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ stat: "Vitality", value: 134 });
    expect(result[1]).toEqual({ stat: "Power",    value: 96  });
    expect(result[2]).toEqual({ stat: "Toughness", value: 96 });
  });

  test("Wanderer's is defined and uses Toughness primary 4-stat", () => {
    const result = computeSlotStats("Wanderer's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0].stat).toBe("Toughness");
    expect(result[1].stat).toBe("Power");
    expect(result[2].stat).toBe("Vitality");
    expect(result[3].stat).toBe("Concentration");
    for (const r of result) expect(r.value).toBeGreaterThan(0);
  });

  test("Diviner's is defined and uses Power primary 4-stat", () => {
    const result = computeSlotStats("Diviner's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0].stat).toBe("Power");
    expect(result[1].stat).toBe("Ferocity");
    expect(result[2].stat).toBe("Concentration");
    expect(result[3].stat).toBe("Precision");
    for (const r of result) expect(r.value).toBeGreaterThan(0);
  });
});

describe("computeSlotStats — 9-stat combo (Celestial)", () => {
  test("Celestial chest distributes evenly across 9 stats", () => {
    // chest: p=134, s=96; each = Math.round((134 + 2*96) / 9)
    const each = Math.round((134 + 2 * 96) / 9);
    const result = computeSlotStats("Celestial", "chest");
    expect(result).toHaveLength(9);
    for (const r of result) expect(r.value).toBe(each);
    const stats = result.map((r) => r.stat);
    expect(stats).toContain("Power");
    expect(stats).toContain("HealingPower");
    expect(stats).toContain("Expertise");
  });
});

// ---------------------------------------------------------------------------
// computeEquipmentStats
// ---------------------------------------------------------------------------

describe("computeEquipmentStats — base values", () => {
  test("returns base stats when no equipment is selected", () => {
    state.editor = makeEditor({});
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
    expect(result.Precision).toBe(1000);
    expect(result.Toughness).toBe(1000);
    expect(result.Vitality).toBe(1000);
    expect(result.Ferocity).toBe(0);
    expect(result.ConditionDamage).toBe(0);
    expect(result.HealingPower).toBe(0);
    expect(result.Expertise).toBe(0);
    expect(result.Concentration).toBe(0);
  });
});

describe("computeEquipmentStats — single slot contributions", () => {
  test("Berserker's chest adds Power/Precision/Ferocity correctly", () => {
    state.editor = makeEditor({ chest: "Berserker's" });
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 134);
    expect(result.Precision).toBe(1000 + 96);
    expect(result.Ferocity).toBe(96);
  });

  test("Cleric's amulet adds HealingPower primary, Toughness+Power secondary", () => {
    // Cleric's: HealingPower, Toughness, Power
    // amulet weights: p=157, s=108
    state.editor = makeEditor({ amulet: "Cleric's" });
    const result = computeEquipmentStats();
    expect(result.HealingPower).toBe(157);
    expect(result.Toughness).toBe(1000 + 108);
    expect(result.Power).toBe(1000 + 108);
  });

  test("unknown combo label is silently ignored", () => {
    state.editor = makeEditor({ chest: "Fake Stats That Do Not Exist" });
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000); // base unchanged
  });

  test("empty slot value is skipped", () => {
    state.editor = makeEditor({ chest: "", head: "" });
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });
});

describe("computeEquipmentStats — multiple slot accumulation", () => {
  test("full Berserker's armor set accumulates all 6 armor slots", () => {
    // armor: head(p60,s43), shoulders(p45,s32), chest(p134,s96), hands(p45,s32), legs(p90,s64), feet(p45,s32)
    const armorSlots = { head: "Berserker's", shoulders: "Berserker's", chest: "Berserker's",
                         hands: "Berserker's", legs: "Berserker's",  feet: "Berserker's" };
    state.editor = makeEditor(armorSlots);
    const result = computeEquipmentStats();
    const totalPrimary   = 60 + 45 + 134 + 45 + 90 + 45;  // = 419
    const totalSecondary = 43 + 32 +  96 + 32 + 64 + 32;  // = 299
    expect(result.Power).toBe(1000 + totalPrimary);
    expect(result.Precision).toBe(1000 + totalSecondary);
    expect(result.Ferocity).toBe(totalSecondary);
  });

  test("dual weapon set adds mainhand1 + mainhand2", () => {
    // mainhand1 and mainhand2 each: p=120, s=85
    state.editor = makeEditor({ mainhand1: "Berserker's", mainhand2: "Berserker's" });
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 120 + 120);
    expect(result.Precision).toBe(1000 + 85 + 85);
    expect(result.Ferocity).toBe(85 + 85);
  });
});

describe("computeEquipmentStats — food contributions", () => {
  const mockFoodCatalog = {
    foodById: new Map([
      [91734, { id: 91734, name: "Peppercorn-Crusted Sous-Vide Steak", buff: "-10% Incoming Damage | +100 Power | +70 Ferocity" }],
      [91690, { id: 91690, name: "Bowl of Fruit Salad with Mint Garnish", buff: "+10% Outgoing Healing | +100 Healing Power | +70 Concentration" }],
    ]),
  };

  beforeEach(() => { state.upgradeCatalog = mockFoodCatalog; });
  afterEach(() => { state.upgradeCatalog = null; });

  test("Peppercorn-Crusted Sous-Vide Steak adds Power and Ferocity", () => {
    // buff: "-10% Incoming Damage | +100 Power | +70 Ferocity"
    state.editor = makeEditor({}, "91734");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 100);
    expect(result.Ferocity).toBe(70);
  });

  test("Bowl of Fruit Salad with Mint Garnish adds HealingPower and Concentration", () => {
    // buff: "+10% Outgoing Healing | +100 Healing Power | +70 Concentration"
    state.editor = makeEditor({}, "91690");
    const result = computeEquipmentStats();
    expect(result.HealingPower).toBe(100);
    expect(result.Concentration).toBe(70);
  });

  test("unknown food ID adds nothing", () => {
    state.editor = makeEditor({}, "99999999");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });

  test("empty food string adds nothing", () => {
    state.editor = makeEditor({}, "");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });

  test("food stacks on top of equipment stats", () => {
    // Berserker's chest + food with +100 Power
    state.editor = makeEditor({ chest: "Berserker's" }, "91734");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 134 + 100);
    expect(result.Ferocity).toBe(96 + 70);
  });

  test("food with 'to All Attributes' adds to every stat", () => {
    state.upgradeCatalog = {
      foodById: new Map([
        [91713, { id: 91713, name: "Feast of All-Stat Food", buff: "-10% Incoming Damage | +45 to All Attributes | +10% Karma" }],
      ]),
    };
    state.editor = makeEditor({}, "91713");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 45);
    expect(result.Precision).toBe(1000 + 45);
    expect(result.Toughness).toBe(1000 + 45);
    expect(result.Vitality).toBe(1000 + 45);
    expect(result.Ferocity).toBe(45);
    expect(result.ConditionDamage).toBe(45);
    expect(result.HealingPower).toBe(45);
    expect(result.Expertise).toBe(45);
    expect(result.Concentration).toBe(45);
  });
});

describe("computeEquipmentStats — 4-stat combo accumulation", () => {
  test("Viper's chest applies 4-stat scaling and accumulates correctly", () => {
    state.editor = makeEditor({ chest: "Viper's" });
    const result = computeEquipmentStats();
    // Viper's: Power(0), ConditionDamage(1), Precision(2), Expertise(3)
    // chest: p=134, s=96
    expect(result.Power).toBe(1000 + Math.round(134 * 0.895));
    expect(result.ConditionDamage).toBe(Math.round(96 * 0.889));
    expect(result.Precision).toBe(1000 + Math.round(96 * 0.889));
    expect(result.Expertise).toBe(Math.round(134 * 0.452));
  });
});

describe("computeEquipmentStats — utility contributions", () => {
  const mockUtilityCatalog = {
    foodById: new Map(),
    utilityById: new Map([
      [9443, { id: 9443, name: "Superior Sharpening Stone",
        buff: "Gain Power Equal to 3% of Your Precision | Gain Power Equal to 6% of Your Ferocity | +10% Experience from Kills" }],
      [67530, { id: 67530, name: "Furious Sharpening Stone",
        buff: "Gain Power Equal to 3% of Your Precision | Gain Ferocity Equal to 3% of Your Precision | +10% Experience from Kills" }],
      [73191, { id: 73191, name: "Writ of Masterful Strength",
        buff: "Gain 200 Power When Health above 90% | +10% Experience from Kills" }],
    ]),
  };

  beforeEach(() => { state.upgradeCatalog = mockUtilityCatalog; });
  afterEach(() => { state.upgradeCatalog = null; });

  test("Superior Sharpening Stone converts Precision and Ferocity to Power", () => {
    // base Precision = 1000, base Ferocity = 0
    state.editor = makeEditor({}, "", "9443");
    const result = computeEquipmentStats();
    // Power += round(1000 * 0.03) + round(0 * 0.06) = 30
    expect(result.Power).toBe(1000 + 30);
  });

  test("Furious Sharpening Stone converts Precision to Power and Ferocity", () => {
    state.editor = makeEditor({}, "", "67530");
    const result = computeEquipmentStats();
    // Power += round(1000 * 0.03) = 30, Ferocity += round(1000 * 0.03) = 30
    expect(result.Power).toBe(1000 + 30);
    expect(result.Ferocity).toBe(30);
  });

  test("Writ of Masterful Strength adds flat Power", () => {
    state.editor = makeEditor({}, "", "73191");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 200);
  });

  test("utility stacks on top of equipment stats", () => {
    // Berserker's chest (Power 134, Precision 96, Ferocity 96) + Superior Sharpening Stone
    state.editor = makeEditor({ chest: "Berserker's" }, "", "9443");
    const result = computeEquipmentStats();
    // Power += round((1000+96) * 0.03) + round(96 * 0.06) = 33 + 6 = 39
    expect(result.Power).toBe(1000 + 134 + 33 + 6);
  });

  test("unknown utility ID adds nothing", () => {
    state.editor = makeEditor({}, "", "99999999");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });

  test("empty utility string adds nothing", () => {
    state.editor = makeEditor({}, "", "");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });
});

describe("computeEquipmentStats — underwater mode", () => {
  test("underwater mode uses breather instead of head", () => {
    state.editor = {
      ...makeEditor({
        head: "Berserker's",
        shoulders: "Berserker's",
        chest: "Berserker's",
        hands: "Berserker's",
        legs: "Berserker's",
        feet: "Berserker's",
        breather: "Marauder's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Vitality).toBeGreaterThan(1000);
  });

  test("underwater mode excludes land weapon stats", () => {
    state.editor = {
      ...makeEditor({
        mainhand1: "Berserker's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });

  test("underwater mode includes aquatic weapon stats", () => {
    state.editor = {
      ...makeEditor({
        aquatic1: "Berserker's",
      }),
      underwaterMode: true,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Power).toBeGreaterThan(1000);
  });

  test("land mode still excludes aquatic slots (existing behavior)", () => {
    state.editor = {
      ...makeEditor({
        aquatic1: "Berserker's",
        breather: "Berserker's",
      }),
      underwaterMode: false,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// computeBuildConcentration
// ---------------------------------------------------------------------------

function makeUpgradeCatalog(overrides = {}) {
  return {
    foodById: overrides.foodById || new Map(),
    utilityById: overrides.utilityById || new Map(),
    runeById: overrides.runeById || new Map(),
    infusionById: overrides.infusionById || new Map(),
    enrichmentById: overrides.enrichmentById || new Map(),
  };
}

describe("computeBuildConcentration", () => {
  test("returns 0 when build has no equipment", () => {
    const build = { equipment: null };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });

  test("returns 0 when build equipment has no slots", () => {
    const build = { equipment: {} };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });

  test("returns slot Concentration even when upgradeCatalog is null", () => {
    // Harrier's gives Concentration — slot stats don't need catalog
    const build = { equipment: { slots: { head: "Harrier's" } } };
    const result = computeBuildConcentration(build, null);
    expect(result).toBeGreaterThan(0);
  });

  test("Harrier's chest adds Concentration from slot stats", () => {
    // Harrier's: Power (primary), Healing Power, Concentration (secondary)
    // chest secondary weight = 96
    const build = { equipment: { slots: { chest: "Harrier's" } } };
    const result = computeBuildConcentration(build, makeUpgradeCatalog());
    expect(result).toBe(96); // chest secondary weight
  });

  test("adds flat Concentration from food buff string", () => {
    const foodDef = { buff: "+40 Concentration" };
    const catalog = makeUpgradeCatalog({
      foodById: new Map([[1001, foodDef]]),
    });
    const build = { equipment: { slots: {}, food: "1001" } };
    expect(computeBuildConcentration(build, catalog)).toBe(40);
  });

  test("returns slot Concentration only when upgradeCatalog is null (rune/food/util skipped)", () => {
    const build = { equipment: { slots: { chest: "Harrier's" }, food: "1001" } };
    // Without catalog, food lookup is skipped
    expect(computeBuildConcentration(build, null)).toBe(96);
  });

  test("accumulates Concentration from multiple sources", () => {
    const foodDef = { buff: "+40 Concentration" };
    const catalog = makeUpgradeCatalog({ foodById: new Map([[1001, foodDef]]) });
    const build = { equipment: { slots: { chest: "Harrier's" }, food: "1001" } };
    // 96 from slot + 40 from food = 136
    expect(computeBuildConcentration(build, catalog)).toBe(136);
  });

  test("excludes aquatic slots (always land mode)", () => {
    // aquatic1 is in AQUATIC_SLOTS — should be excluded
    const build = { equipment: { slots: { aquatic1: "Harrier's" } } };
    expect(computeBuildConcentration(build, makeUpgradeCatalog())).toBe(0);
  });

  test("adds Concentration from rune 'to All Stats' bonus", () => {
    const runeDef = { bonuses: ["+50 to All Stats"] };
    const catalog = makeUpgradeCatalog({
      runeById: new Map([[2001, runeDef]]),
    });
    const build = { equipment: { slots: {}, runes: { head: "2001" } } };
    expect(computeBuildConcentration(build, catalog)).toBe(50);
  });
});
