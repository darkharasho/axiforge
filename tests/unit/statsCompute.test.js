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
    // Base 1000 + all slot primary contributions
    expect(result.stats.Power).toBe(2531);
  });

  test("full Berserker's gear: Precision total", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Base 1000 + all slot secondary contributions
    expect(result.stats.Precision).toBe(2063);
  });

  test("full Berserker's gear: Ferocity total", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Base 0 + all slot secondary contributions (same as Precision secondary)
    expect(result.stats.Ferocity).toBe(1063);
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
    // Precision = 2063 => (2063 - 1000) / 21 + 5 = 50.619... + 5 = 55.6%
    expect(result.stats.CritChance).toBe("55.6%");
  });

  test("derived stat: CritDamage computed from Ferocity", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    // Ferocity = 1063 => 150 + 1063/15 = 150 + 70.866... = 220.9%
    expect(result.stats.CritDamage).toBe("220.9%");
  });

  test("derived stat: BoonDuration is 0.0% for Berserker's (no Concentration)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    expect(result.stats.BoonDuration).toBe("0.0%");
  });

  test("derived stat: ConditionDuration is 0.0% for Berserker's (no Expertise)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Necromancer");
    expect(result.stats.ConditionDuration).toBe("0.0%");
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
    // Head slot Berserker's: Power +60, Precision +43, Ferocity +43 (secondary)
    // 6 runes: bonuses[0]=+25P, bonuses[1]=+35F, bonuses[2]=+50P, bonuses[3]=+65F, bonuses[4]=+100P, bonuses[5]=no stat match
    expect(result.stats.Power).toBe(1000 + 60 + 25 + 50 + 100);
    // Ferocity: 43 from head Berserker's secondary + 35 + 65 from rune bonuses
    expect(result.stats.Ferocity).toBe(43 + 35 + 65);
  });

  test("modifiers array is returned (may be empty)", () => {
    const result = computePublishStats(makeFullBerserkerEquipment(), null, "Warrior");
    expect(Array.isArray(result.modifiers)).toBe(true);
  });
});
