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
    expect(result[0]).toEqual({ stat: "Power",     value: 141 });
    expect(result[1]).toEqual({ stat: "Precision",  value: 101 });
    expect(result[2]).toEqual({ stat: "Ferocity",   value: 101 });
  });

  test("Berserker's head returns correct head weights", () => {
    const result = computeSlotStats("Berserker's", "head");
    expect(result[0]).toEqual({ stat: "Power",    value: 63 });
    expect(result[1]).toEqual({ stat: "Precision", value: 45 });
    expect(result[2]).toEqual({ stat: "Ferocity",  value: 45 });
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
    expect(result[0].value).toBe(125); // p weight for mainhand1 (ascended)
    expect(result[1].stat).toBe("Power");
    expect(result[1].value).toBe(90);  // s weight for mainhand1 (ascended)
  });
});

describe("computeSlotStats — 4-stat combos", () => {
  test("Viper's chest applies 4-stat 2-2 pattern", () => {
    // Viper's: Power, ConditionDamage (major), Precision, Expertise (minor)
    // chest weights: p4=121, s4=66
    const result = computeSlotStats("Viper's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ stat: "Power",          value: 121 });
    expect(result[1]).toEqual({ stat: "ConditionDamage", value: 121 });
    expect(result[2]).toEqual({ stat: "Precision",       value: 66 });
    expect(result[3]).toEqual({ stat: "Expertise",       value: 66 });
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
    expect(result[0]).toEqual({ stat: "Vitality", value: 141 });
    expect(result[1]).toEqual({ stat: "Power",    value: 101 });
    expect(result[2]).toEqual({ stat: "Toughness", value: 101 });
  });

  test("Wanderer's is defined with Power+Vitality major, Toughness+Concentration minor", () => {
    const result = computeSlotStats("Wanderer's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0].stat).toBe("Power");
    expect(result[1].stat).toBe("Vitality");
    expect(result[2].stat).toBe("Toughness");
    expect(result[3].stat).toBe("Concentration");
    // Major stats get p4, minor stats get s4
    expect(result[0].value).toBe(121); // p4 for chest
    expect(result[2].value).toBe(66);  // s4 for chest
  });

  test("Diviner's is defined with Power+Concentration major, Ferocity+Precision minor", () => {
    const result = computeSlotStats("Diviner's", "chest");
    expect(result).toHaveLength(4);
    expect(result[0].stat).toBe("Power");
    expect(result[1].stat).toBe("Concentration");
    expect(result[2].stat).toBe("Ferocity");
    expect(result[3].stat).toBe("Precision");
    expect(result[0].value).toBe(121); // p4 for chest
    expect(result[2].value).toBe(66);  // s4 for chest
  });
});

describe("computeSlotStats — 9-stat combo (Celestial)", () => {
  test("Celestial chest uses per-stat Celestial weight", () => {
    // chest: c=66 (Celestial per-stat weight)
    const result = computeSlotStats("Celestial", "chest");
    expect(result).toHaveLength(9);
    for (const r of result) expect(r.value).toBe(66);
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
    expect(result.Power).toBe(1000 + 141);
    expect(result.Precision).toBe(1000 + 101);
    expect(result.Ferocity).toBe(101);
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
    // armor (ascended): head(p63,s45), shoulders(p47,s34), chest(p141,s101), hands(p47,s34), legs(p94,s67), feet(p47,s34)
    const armorSlots = { head: "Berserker's", shoulders: "Berserker's", chest: "Berserker's",
                         hands: "Berserker's", legs: "Berserker's",  feet: "Berserker's" };
    state.editor = makeEditor(armorSlots);
    const result = computeEquipmentStats();
    const totalPrimary   = 63 + 47 + 141 + 47 + 94 + 47;  // = 439
    const totalSecondary = 45 + 34 + 101 + 34 + 67 + 34;   // = 315
    expect(result.Power).toBe(1000 + totalPrimary);
    expect(result.Precision).toBe(1000 + totalSecondary);
    expect(result.Ferocity).toBe(totalSecondary);
  });

  test("only active weapon set contributes (default = set 1)", () => {
    // mainhand1 and mainhand2 each: p=125, s=90 (ascended)
    // Only the active set (default = 1) should count
    state.editor = makeEditor({ mainhand1: "Berserker's", mainhand2: "Berserker's" });
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 125);
    expect(result.Precision).toBe(1000 + 90);
    expect(result.Ferocity).toBe(90);
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
    // Berserker's chest (ascended) + food with +100 Power
    state.editor = makeEditor({ chest: "Berserker's" }, "91734");
    const result = computeEquipmentStats();
    expect(result.Power).toBe(1000 + 141 + 100);
    expect(result.Ferocity).toBe(101 + 70);
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
  test("Viper's chest applies 4-stat 2-2 pattern and accumulates correctly", () => {
    state.editor = makeEditor({ chest: "Viper's" });
    const result = computeEquipmentStats();
    // Viper's: Power+CondDmg (major p4=121), Precision+Expertise (minor s4=66)
    expect(result.Power).toBe(1000 + 121);
    expect(result.ConditionDamage).toBe(121);
    expect(result.Precision).toBe(1000 + 66);
    expect(result.Expertise).toBe(66);
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
    // Berserker's chest ascended (Power 141, Precision 101, Ferocity 101) + Superior Sharpening Stone
    state.editor = makeEditor({ chest: "Berserker's" }, "", "9443");
    const result = computeEquipmentStats();
    // Power += round((1000+101) * 0.03) + round(101 * 0.06) = 33 + 6 = 39
    expect(result.Power).toBe(1000 + 141 + 33 + 6);
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
// computeEquipmentStats — active weapon set filtering (issue #64)
// ---------------------------------------------------------------------------

describe("computeEquipmentStats — active weapon set filtering", () => {
  test("only active weapon set 1 contributes to stats on land", () => {
    // Set 1 = Berserker's, Set 2 = Celestial. With set 1 active, only set 1 should count.
    state.editor = {
      ...makeEditor({
        mainhand1: "Berserker's", offhand1: "Berserker's",
        mainhand2: "Celestial",   offhand2: "Celestial",
      }),
      activeWeaponSet: 1,
    };
    const result = computeEquipmentStats();
    // mainhand1 + offhand1 Berserker's: Power = 2×125 = 250, Precision = 2×90 = 180
    expect(result.Power).toBe(1000 + 250);
    expect(result.Precision).toBe(1000 + 180);
    // Celestial stats from set 2 should NOT be included
    expect(result.Expertise).toBe(0);
    expect(result.Concentration).toBe(0);
    expect(result.HealingPower).toBe(0);
  });

  test("only active weapon set 2 contributes to stats on land", () => {
    state.editor = {
      ...makeEditor({
        mainhand1: "Berserker's", offhand1: "Berserker's",
        mainhand2: "Celestial",   offhand2: "Celestial",
      }),
      activeWeaponSet: 2,
    };
    const result = computeEquipmentStats();
    // Only Celestial set 2 should count: 2 weapons × 59 per stat = 118
    expect(result.Expertise).toBe(118);
    expect(result.Concentration).toBe(118);
    // Berserker's set 1 should NOT be included — base Power = 1000 + Celestial 118
    expect(result.Power).toBe(1000 + 118);
  });

  test("switching active set changes which weapon stats are included", () => {
    state.editor = {
      ...makeEditor({
        mainhand1: "Berserker's",
        mainhand2: "Cleric's",
      }),
      activeWeaponSet: 1,
    };
    const r1 = computeEquipmentStats();
    expect(r1.HealingPower).toBe(0); // Berserker's has no HealingPower

    state.editor.activeWeaponSet = 2;
    const r2 = computeEquipmentStats();
    expect(r2.HealingPower).toBe(125); // Cleric's mainhand2 primary = HealingPower
  });

  test("underwater mode only includes active aquatic weapon", () => {
    // Aquatic weapons are 2H — weights: p=251, s=179, c=118
    state.editor = {
      ...makeEditor({
        aquatic1: "Berserker's",
        aquatic2: "Celestial",
      }),
      underwaterMode: true,
      activeWeaponSet: 1,
      underwaterSkills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    const r1 = computeEquipmentStats();
    // Only aquatic1 (Berserker's) should count: Power primary = 251
    expect(r1.Power).toBe(1000 + 251);
    expect(r1.Expertise).toBe(0); // Celestial not included

    state.editor.activeWeaponSet = 2;
    const r2 = computeEquipmentStats();
    // Only aquatic2 (Celestial) should count: per-stat = 118
    expect(r2.Expertise).toBe(118);
    expect(r2.Power).toBe(1000 + 118); // Celestial Power, not Berserker's
  });

  test("armor slots are unaffected by weapon set selection", () => {
    state.editor = {
      ...makeEditor({
        head: "Berserker's",
        chest: "Berserker's",
        mainhand1: "Celestial",
      }),
      activeWeaponSet: 2, // set 2 is active, but set 2 has no weapons
    };
    const result = computeEquipmentStats();
    // Armor should still count even though active set is 2
    expect(result.Power).toBe(1000 + 63 + 141); // head(63) + chest(141)
    // mainhand1 is set 1 — should be excluded since set 2 is active
    expect(result.Ferocity).toBe(45 + 101); // head(45) + chest(101), no weapon contribution
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
    // chest secondary weight = 101 (ascended)
    const build = { equipment: { slots: { chest: "Harrier's" } } };
    const result = computeBuildConcentration(build, makeUpgradeCatalog());
    expect(result).toBe(101); // chest secondary weight (ascended)
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
    expect(computeBuildConcentration(build, null)).toBe(101);
  });

  test("accumulates Concentration from multiple sources", () => {
    const foodDef = { buff: "+40 Concentration" };
    const catalog = makeUpgradeCatalog({ foodById: new Map([[1001, foodDef]]) });
    const build = { equipment: { slots: { chest: "Harrier's" }, food: "1001" } };
    // 101 from slot + 40 from food = 141
    expect(computeBuildConcentration(build, catalog)).toBe(141);
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
