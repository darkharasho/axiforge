"use strict";

const { computePublishStats } = require("../../src/main/statsCompute");

// All equipment slots that have stat weights
const ALL_STAT_SLOTS = [
  "head", "shoulders", "chest", "hands", "legs", "feet",
  "mainhand1", "offhand1", "mainhand2", "offhand2",
  "back", "amulet", "ring1", "ring2", "accessory1", "accessory2",
];

function makeFullBerserkerEquipment() {
  const slots = {};
  for (const slot of ALL_STAT_SLOTS) {
    slots[slot] = "Berserker's";
  }
  return { slots, runes: {}, infusions: {}, enrichment: "", food: null, utility: null };
}

describe("computePublishStats", () => {
  test("returns empty stats for null equipment", () => {
    const result = computePublishStats(null, null, "Warrior");
    expect(result.stats).toEqual({});
    expect(result.modifiers).toEqual([]);
  });

  test("full Berserker's gear: Power total", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Base 1000 + all slot primary contributions (ascended weights)
    expect(result.stats.Power).toBe(2631);
  });

  test("full Berserker's gear: Precision total", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Base 1000 + all slot secondary contributions (ascended weights)
    expect(result.stats.Precision).toBe(2141);
  });

  test("full Berserker's gear: Ferocity total", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Base 0 + all slot secondary contributions (ascended weights)
    expect(result.stats.Ferocity).toBe(1141);
  });

  test("full Berserker's gear: Vitality stays at base (no Vitality in Berserker's)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    expect(result.stats.Vitality).toBe(1000);
  });

  test("derived stat: Health uses profession base HP + Vitality * 10 (Necromancer)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Necromancer base HP = 19212, Vitality = 1000
    expect(result.stats.Health).toBe(19212 + 1000 * 10);
  });

  test("derived stat: Health uses correct base HP for Warrior", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Warrior");
    // Warrior base HP = 19212
    expect(result.stats.Health).toBe(19212 + 1000 * 10);
  });

  test("derived stat: Health uses correct base HP for Elementalist", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Elementalist");
    // Elementalist base HP = 11645
    expect(result.stats.Health).toBe(11645 + 1000 * 10);
  });

  test("derived stat: CritChance computed from Precision", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Precision = 2141 => (2141 - 1000) / 21 + 5 = 54.333... + 5 = 59.3%
    expect(result.stats.CritChance).toBe("59.3%");
  });

  test("derived stat: CritDamage computed from Ferocity", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Ferocity = 1141 => 150 + 1141/15 = 150 + 76.066... = 226.1%
    expect(result.stats.CritDamage).toBe("226.1%");
  });

  test("derived stat: BoonDuration is 0.0% for Berserker's (no Concentration)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    expect(result.stats.BoonDuration).toBe("0.0%");
  });

  test("derived stat: ConditionDuration is 0.0% for Berserker's (no Expertise)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    expect(result.stats.ConditionDuration).toBe("0.0%");
  });

  test("stat combo without apostrophe-s resolves correctly (issue #81)", () => {
    // Builds imported from gw2skills may store "Wanderer" instead of "Wanderer's"
    const equipment = {
      slots: { chest: "Wanderer" },
      runes: {}, infusions: {},
    };
    const result = computePublishStats(equipment, null, "Guardian");
    // Wanderer's chest: Power p4=121, Vitality p4=121, Toughness s4=66, Concentration s4=66
    expect(result.stats.Power).toBe(1000 + 121);
    expect(result.stats.Vitality).toBe(1000 + 121);
    expect(result.stats.Toughness).toBe(1000 + 66);
    expect(result.stats.Concentration).toBe(66);
  });

  test("equipment with no slots set returns only base stats", () => {
    const equipment = { slots: {}, runes: {}, infusions: {} };
    const result = computePublishStats(equipment, null, "Guardian");
    // Base values: Power=1000, Precision=1000, Toughness=1000, Vitality=1000, rest=0
    expect(result.stats.Power).toBe(1000);
    expect(result.stats.Precision).toBe(1000);
    expect(result.stats.Ferocity).toBe(0);
    expect(result.stats.ConditionDamage).toBe(0);
  });

  test("unknown profession falls back to Elementalist base HP (11645)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "UnknownProf");
    expect(result.stats.Health).toBe(11645 + 1000 * 10);
  });

  test("rune bonuses are added when upgradeCatalog is provided", () => {
    const equipment = {
      slots: { head: "Berserker's" },
      runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" },
      infusions: {},
    };
    // Scholar rune: 6 bonuses, first two give +25 Power, +35 Power
    const upgradeCatalog = {
      runeById: new Map([[24836, {
        id: 24836, name: "Superior Rune of the Scholar",
        bonuses: ["+25 Power", "+35 Ferocity", "+50 Power", "+65 Ferocity", "+100 Power", "+10% damage when above 90% health"],
      }]]),
      infusionById: new Map(),
      enrichmentById: new Map(),
      foodById: new Map(),
      utilityById: new Map(),
    };
    const result = computePublishStats(equipment, upgradeCatalog, "Necromancer");
    // Head slot Berserker's (ascended): Power +63, Precision +45, Ferocity +45
    // 6 runes: bonuses[0]=+25P, bonuses[1]=+35F, bonuses[2]=+50P, bonuses[3]=+65F, bonuses[4]=+100P, bonuses[5]=no stat match
    expect(result.stats.Power).toBe(1000 + 63 + 25 + 50 + 100);
    // Ferocity: 45 from head Berserker's secondary + 35 + 65 from rune bonuses
    expect(result.stats.Ferocity).toBe(45 + 35 + 65);
  });

  test("modifiers array is returned (may be empty)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Warrior");
    expect(Array.isArray(result.modifiers)).toBe(true);
  });

  test("single head slot Viper's: 4-stat uses 2-2 pattern (two major, two minor)", () => {
    const equipment = { slots: { head: "Viper's" }, runes: {}, infusions: {} };
    const result = computePublishStats(equipment, null, "Necromancer");
    // Viper's: Power + CondDmg are both major (p4=54), Precision + Expertise are both minor (s4=30)
    expect(result.stats.Power).toBe(1000 + 54);
    expect(result.stats.ConditionDamage).toBe(54);  // major stat, NOT minor
    expect(result.stats.Precision).toBe(1000 + 30);
    expect(result.stats.Expertise).toBe(30);         // minor stat
  });

  test("full Viper's gear: 4-stat totals", () => {
    const slots = {};
    for (const slot of ALL_STAT_SLOTS) slots[slot] = "Viper's";
    const equipment = { slots, runes: {}, infusions: {} };
    const result = computePublishStats(equipment, null, "Necromancer");
    // Major stats (Power, CondDmg) sum of p4 across all 16 slots = 1381
    expect(result.stats.Power).toBe(1000 + 1381);
    expect(result.stats.ConditionDamage).toBe(1381);
    // Minor stats (Precision, Expertise) sum of s4 across all 16 slots = 750
    expect(result.stats.Precision).toBe(1000 + 750);
    expect(result.stats.Expertise).toBe(750);
  });

  test("full Celestial gear: all 9 stats equal", () => {
    const slots = {};
    for (const slot of ALL_STAT_SLOTS) slots[slot] = "Celestial";
    const equipment = { slots, runes: {}, infusions: {} };
    const result = computePublishStats(equipment, null, "Necromancer");
    // Celestial: all stats get c weight, sum across 16 slots = 756
    expect(result.stats.Ferocity).toBe(756);
    expect(result.stats.ConditionDamage).toBe(756);
    expect(result.stats.HealingPower).toBe(756);
    expect(result.stats.Expertise).toBe(756);
    expect(result.stats.Concentration).toBe(756);
    // Base stats get +1000
    expect(result.stats.Power).toBe(1000 + 756);
    expect(result.stats.Precision).toBe(1000 + 756);
  });

  test("food with 'to All Attributes' adds to every stat", () => {
    const equipment = { slots: {}, runes: {}, infusions: {}, food: "91713", utility: "" };
    const upgradeCatalog = {
      runeById: new Map(),
      infusionById: new Map(),
      enrichmentById: new Map(),
      foodById: new Map([
        [91713, { id: 91713, name: "Feast of All-Stat Food", buff: "-10% Incoming Damage | +45 to All Attributes | +10% Karma" }],
      ]),
      utilityById: new Map(),
    };
    const result = computePublishStats(equipment, upgradeCatalog, "Warrior");
    expect(result.stats.Power).toBe(1000 + 45);
    expect(result.stats.Precision).toBe(1000 + 45);
    expect(result.stats.Toughness).toBe(1000 + 45);
    expect(result.stats.Vitality).toBe(1000 + 45);
    expect(result.stats.Ferocity).toBe(45);
    expect(result.stats.ConditionDamage).toBe(45);
    expect(result.stats.HealingPower).toBe(45);
    expect(result.stats.Expertise).toBe(45);
    expect(result.stats.Concentration).toBe(45);
  });
});
