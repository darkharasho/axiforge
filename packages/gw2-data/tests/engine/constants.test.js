"use strict";

const {
  STAT_COMBOS,
  STAT_COMBOS_BY_LABEL,
  getStatCombo,
  getEffectiveStats,
  SLOT_WEIGHTS,
  TWO_HAND_WEIGHTS,
  LAND_ONLY_SLOTS,
  AQUATIC_SLOTS,
  PROFESSION_WEIGHT,
  ARMOR_DEFENSE_BY_WEIGHT,
  PROFESSION_BASE_HP,
  WEAPON_STRENGTH_MIDPOINT,
  BUFF_FACT_TYPES,
  MIGHT_POWER_PER_STACK,
  MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE,
  FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS,
  SIGNET_PASSIVE_BUFFS,
  BOON_NAMES,
  CONDITION_NAMES,
  CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER,
  ALL_STAT_KEYS,
  CONVERSION_TARGET_MAP,
} = require("../../src/engine/constants");

// ---------------------------------------------------------------------------
// getStatCombo / STAT_COMBOS_BY_LABEL
// ---------------------------------------------------------------------------
describe("getStatCombo", () => {
  test("returns combo for Berserker's", () => {
    const combo = getStatCombo("Berserker's");
    expect(combo).toBeDefined();
    expect(combo.label).toBe("Berserker's");
    expect(combo.stats).toEqual(["Power", "Precision", "Ferocity"]);
  });

  test("alias without apostrophe-s resolves to same combo", () => {
    const full = getStatCombo("Berserker's");
    const alias = getStatCombo("Berserker");
    expect(alias).toBe(full);
  });

  test("Wanderer alias resolves correctly", () => {
    const full = getStatCombo("Wanderer's");
    const alias = getStatCombo("Wanderer");
    expect(alias).toBe(full);
    expect(full.stats).toContain("Concentration");
  });

  test("Celestial returns all 9 stats", () => {
    const combo = getStatCombo("Celestial");
    expect(combo).toBeDefined();
    expect(combo.stats).toHaveLength(9);
    expect(combo.stats).toContain("Expertise");
    expect(combo.stats).toContain("Concentration");
  });

  test("returns undefined for unknown label", () => {
    expect(getStatCombo("Nonexistent")).toBeUndefined();
  });

  test("Marauder's is a 4-stat combo", () => {
    const combo = getStatCombo("Marauder's");
    expect(combo.stats).toHaveLength(4);
    expect(combo.stats).toEqual(["Power", "Precision", "Vitality", "Ferocity"]);
  });

  test("Viper's stats are correct", () => {
    const combo = getStatCombo("Viper's");
    expect(combo.stats).toEqual(["Power", "ConditionDamage", "Precision", "Expertise"]);
  });

  test("Demolisher has no apostrophe-s and is not aliased", () => {
    const combo = getStatCombo("Demolisher");
    expect(combo).toBeDefined();
    expect(combo.label).toBe("Demolisher");
  });
});

// ---------------------------------------------------------------------------
// getEffectiveStats
// ---------------------------------------------------------------------------
describe("getEffectiveStats", () => {
  test("PvE Celestial returns all 9 stats", () => {
    const combo = getStatCombo("Celestial");
    const stats = getEffectiveStats(combo, "pve");
    expect(stats).toHaveLength(9);
    expect(stats).toContain("Expertise");
    expect(stats).toContain("Concentration");
  });

  test("WvW Celestial excludes Expertise and Concentration", () => {
    const combo = getStatCombo("Celestial");
    const stats = getEffectiveStats(combo, "wvw");
    expect(stats).not.toContain("Expertise");
    expect(stats).not.toContain("Concentration");
    expect(stats).toHaveLength(7);
  });

  test("WvW non-Celestial combo returns all its stats unchanged", () => {
    const combo = getStatCombo("Berserker's");
    const stats = getEffectiveStats(combo, "wvw");
    expect(stats).toEqual(["Power", "Precision", "Ferocity"]);
  });

  test("PvE Trailblazer's (has Expertise) returns all stats", () => {
    const combo = getStatCombo("Trailblazer's");
    const stats = getEffectiveStats(combo, "pve");
    expect(stats).toContain("Expertise");
    expect(stats).toHaveLength(4);
  });

  test("returns empty array for null/undefined combo", () => {
    expect(getEffectiveStats(null, "pve")).toEqual([]);
    expect(getEffectiveStats(undefined, "wvw")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SLOT_WEIGHTS
// ---------------------------------------------------------------------------
describe("SLOT_WEIGHTS", () => {
  const EXPECTED_SLOTS = [
    "head", "shoulders", "chest", "hands", "legs", "feet",
    "mainhand1", "offhand1", "mainhand2", "offhand2",
    "back", "amulet", "ring1", "ring2", "accessory1", "accessory2",
    "breather", "aquatic1", "aquatic2",
  ];

  test("has exactly 19 slot keys", () => {
    expect(Object.keys(SLOT_WEIGHTS)).toHaveLength(19);
  });

  test("contains all expected slots", () => {
    for (const slot of EXPECTED_SLOTS) {
      expect(SLOT_WEIGHTS).toHaveProperty(slot);
    }
  });

  test("each slot has p, s, p4, s4, c keys", () => {
    for (const slot of EXPECTED_SLOTS) {
      const w = SLOT_WEIGHTS[slot];
      expect(typeof w.p).toBe("number");
      expect(typeof w.s).toBe("number");
      expect(typeof w.p4).toBe("number");
      expect(typeof w.s4).toBe("number");
      expect(typeof w.c).toBe("number");
    }
  });

  test("chest has the highest armor weights", () => {
    expect(SLOT_WEIGHTS.chest.p).toBe(141);
    expect(SLOT_WEIGHTS.chest.s).toBe(101);
  });

  test("aquatic slots have same weights as TWO_HAND_WEIGHTS", () => {
    expect(SLOT_WEIGHTS.aquatic1).toEqual(TWO_HAND_WEIGHTS);
    expect(SLOT_WEIGHTS.aquatic2).toEqual(TWO_HAND_WEIGHTS);
  });

  test("back slot has correct values", () => {
    expect(SLOT_WEIGHTS.back).toEqual({ p: 63, s: 40, p4: 51, s4: 27, c: 28 });
  });
});

// ---------------------------------------------------------------------------
// TWO_HAND_WEIGHTS
// ---------------------------------------------------------------------------
describe("TWO_HAND_WEIGHTS", () => {
  test("matches aquatic weapon weights", () => {
    expect(TWO_HAND_WEIGHTS).toEqual({ p: 251, s: 179, p4: 215, s4: 118, c: 118 });
  });

  test("has all five weight keys", () => {
    expect(Object.keys(TWO_HAND_WEIGHTS)).toEqual(["p", "s", "p4", "s4", "c"]);
  });
});

// ---------------------------------------------------------------------------
// LAND_ONLY_SLOTS / AQUATIC_SLOTS
// ---------------------------------------------------------------------------
describe("LAND_ONLY_SLOTS and AQUATIC_SLOTS", () => {
  test("LAND_ONLY_SLOTS contains expected slots", () => {
    expect(LAND_ONLY_SLOTS.has("head")).toBe(true);
    expect(LAND_ONLY_SLOTS.has("mainhand1")).toBe(true);
    expect(LAND_ONLY_SLOTS.has("offhand1")).toBe(true);
    expect(LAND_ONLY_SLOTS.has("mainhand2")).toBe(true);
    expect(LAND_ONLY_SLOTS.has("offhand2")).toBe(true);
    expect(LAND_ONLY_SLOTS.size).toBe(5);
  });

  test("AQUATIC_SLOTS contains expected slots", () => {
    expect(AQUATIC_SLOTS.has("breather")).toBe(true);
    expect(AQUATIC_SLOTS.has("aquatic1")).toBe(true);
    expect(AQUATIC_SLOTS.has("aquatic2")).toBe(true);
    expect(AQUATIC_SLOTS.size).toBe(3);
  });

  test("LAND_ONLY_SLOTS and AQUATIC_SLOTS are disjoint", () => {
    for (const slot of LAND_ONLY_SLOTS) {
      expect(AQUATIC_SLOTS.has(slot)).toBe(false);
    }
    for (const slot of AQUATIC_SLOTS) {
      expect(LAND_ONLY_SLOTS.has(slot)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// PROFESSION_BASE_HP
// ---------------------------------------------------------------------------
describe("PROFESSION_BASE_HP", () => {
  test("Warrior has high HP (9212)", () => {
    expect(PROFESSION_BASE_HP.Warrior).toBe(9212);
  });

  test("Berserker (elite spec of Warrior) has same HP as Warrior", () => {
    expect(PROFESSION_BASE_HP.Berserker).toBe(9212);
  });

  test("Necromancer and Harbinger have high HP", () => {
    expect(PROFESSION_BASE_HP.Necromancer).toBe(9212);
    expect(PROFESSION_BASE_HP.Harbinger).toBe(9212);
  });

  test("Ranger and its elite specs have medium HP (5922)", () => {
    expect(PROFESSION_BASE_HP.Ranger).toBe(5922);
    expect(PROFESSION_BASE_HP.Druid).toBe(5922);
    expect(PROFESSION_BASE_HP.Soulbeast).toBe(5922);
    expect(PROFESSION_BASE_HP.Untamed).toBe(5922);
  });

  test("Mesmer and Chronomancer have medium HP", () => {
    expect(PROFESSION_BASE_HP.Mesmer).toBe(5922);
    expect(PROFESSION_BASE_HP.Chronomancer).toBe(5922);
  });

  test("Guardian and its elite specs have low HP (1645)", () => {
    expect(PROFESSION_BASE_HP.Guardian).toBe(1645);
    expect(PROFESSION_BASE_HP.Dragonhunter).toBe(1645);
    expect(PROFESSION_BASE_HP.Firebrand).toBe(1645);
    expect(PROFESSION_BASE_HP.Willbender).toBe(1645);
  });

  test("Elementalist and Tempest and Weaver have low HP", () => {
    expect(PROFESSION_BASE_HP.Elementalist).toBe(1645);
    expect(PROFESSION_BASE_HP.Tempest).toBe(1645);
    expect(PROFESSION_BASE_HP.Weaver).toBe(1645);
  });

  test("Thief and Antiquary have low HP", () => {
    expect(PROFESSION_BASE_HP.Thief).toBe(1645);
    expect(PROFESSION_BASE_HP.Antiquary).toBe(1645);
  });
});

// ---------------------------------------------------------------------------
// PROFESSION_WEIGHT
// ---------------------------------------------------------------------------
describe("PROFESSION_WEIGHT", () => {
  test("light armor professions", () => {
    expect(PROFESSION_WEIGHT.Elementalist).toBe("light");
    expect(PROFESSION_WEIGHT.Mesmer).toBe("light");
    expect(PROFESSION_WEIGHT.Necromancer).toBe("light");
  });

  test("medium armor professions", () => {
    expect(PROFESSION_WEIGHT.Engineer).toBe("medium");
    expect(PROFESSION_WEIGHT.Ranger).toBe("medium");
    expect(PROFESSION_WEIGHT.Thief).toBe("medium");
  });

  test("heavy armor professions", () => {
    expect(PROFESSION_WEIGHT.Guardian).toBe("heavy");
    expect(PROFESSION_WEIGHT.Warrior).toBe("heavy");
    expect(PROFESSION_WEIGHT.Revenant).toBe("heavy");
  });
});

// ---------------------------------------------------------------------------
// ARMOR_DEFENSE_BY_WEIGHT
// ---------------------------------------------------------------------------
describe("ARMOR_DEFENSE_BY_WEIGHT", () => {
  test("has correct defense values", () => {
    expect(ARMOR_DEFENSE_BY_WEIGHT).toEqual({ light: 967, medium: 1118, heavy: 1271 });
  });
});

// ---------------------------------------------------------------------------
// WEAPON_STRENGTH_MIDPOINT
// ---------------------------------------------------------------------------
describe("WEAPON_STRENGTH_MIDPOINT", () => {
  const EXPECTED_WEAPONS = [
    "axe", "dagger", "mace", "pistol", "sword", "scepter",
    "focus", "shield", "torch", "warhorn",
    "greatsword", "hammer", "longbow", "rifle", "shortbow", "staff",
    "spear", "trident", "harpoon",
  ];

  test("has all 19 weapon types", () => {
    expect(Object.keys(WEAPON_STRENGTH_MIDPOINT)).toHaveLength(19);
  });

  test("contains all expected weapon keys", () => {
    for (const w of EXPECTED_WEAPONS) {
      expect(WEAPON_STRENGTH_MIDPOINT).toHaveProperty(w);
    }
  });

  test("axe and sword have same midpoint", () => {
    expect(WEAPON_STRENGTH_MIDPOINT.axe).toBe(952.5);
    expect(WEAPON_STRENGTH_MIDPOINT.sword).toBe(952.5);
  });

  test("rifle has the highest midpoint", () => {
    const max = Math.max(...Object.values(WEAPON_STRENGTH_MIDPOINT));
    expect(WEAPON_STRENGTH_MIDPOINT.rifle).toBe(max);
    expect(WEAPON_STRENGTH_MIDPOINT.rifle).toBe(1095.5);
  });

  test("aquatic weapons have midpoints", () => {
    expect(typeof WEAPON_STRENGTH_MIDPOINT.harpoon).toBe("number");
    expect(typeof WEAPON_STRENGTH_MIDPOINT.trident).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// BUFF_FACT_TYPES
// ---------------------------------------------------------------------------
describe("BUFF_FACT_TYPES", () => {
  test("contains Buff, ApplyBuffCondition, PrefixedBuff", () => {
    expect(BUFF_FACT_TYPES.has("Buff")).toBe(true);
    expect(BUFF_FACT_TYPES.has("ApplyBuffCondition")).toBe(true);
    expect(BUFF_FACT_TYPES.has("PrefixedBuff")).toBe(true);
    expect(BUFF_FACT_TYPES.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Might and Fury constants
// ---------------------------------------------------------------------------
describe("Might and Fury constants", () => {
  test("MIGHT_POWER_PER_STACK is 30", () => {
    expect(MIGHT_POWER_PER_STACK).toBe(30);
  });

  test("MIGHT_CONDI_PER_STACK is 30", () => {
    expect(MIGHT_CONDI_PER_STACK).toBe(30);
  });

  test("FURY_CRIT_CHANCE is 25 (PvE)", () => {
    expect(FURY_CRIT_CHANCE).toBe(25);
  });

  test("FURY_CRIT_CHANCE_WVW is 20", () => {
    expect(FURY_CRIT_CHANCE_WVW).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// STACKING_SIGIL_DEFS
// ---------------------------------------------------------------------------
describe("STACKING_SIGIL_DEFS", () => {
  test("has 9 entries", () => {
    expect(STACKING_SIGIL_DEFS).toHaveLength(9);
  });

  test("each entry has id, key, label, perStack, maxStacks", () => {
    for (const def of STACKING_SIGIL_DEFS) {
      expect(typeof def.id).toBe("number");
      expect(typeof def.key).toBe("string");
      expect(typeof def.label).toBe("string");
      expect(typeof def.perStack).toBe("number");
      expect(def.maxStacks).toBe(25);
    }
  });

  test("Bloodlust targets Power", () => {
    const bloodlust = STACKING_SIGIL_DEFS.find((d) => d.label === "Bloodlust");
    expect(bloodlust).toBeDefined();
    expect(bloodlust.stat).toBe("Power");
    expect(bloodlust.perStack).toBe(10);
    expect(bloodlust.id).toBe(24575);
  });

  test("Stars targets all stats", () => {
    const stars = STACKING_SIGIL_DEFS.find((d) => d.label === "Stars");
    expect(stars).toBeDefined();
    expect(Array.isArray(stars.allStats)).toBe(true);
    expect(stars.allStats).toHaveLength(9);
    expect(stars.perStack).toBe(2);
  });

  test("Benevolence uses modifier instead of stat", () => {
    const bene = STACKING_SIGIL_DEFS.find((d) => d.label === "Benevolence");
    expect(bene).toBeDefined();
    expect(bene.modifier).toBe("Outgoing Healing");
    expect(bene.stat).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SIGNET_PASSIVE_BUFFS
// ---------------------------------------------------------------------------
describe("SIGNET_PASSIVE_BUFFS", () => {
  test("is a Map", () => {
    expect(SIGNET_PASSIVE_BUFFS instanceof Map).toBe(true);
  });

  test("has 13 entries", () => {
    expect(SIGNET_PASSIVE_BUFFS.size).toBe(13);
  });

  test("Bane Signet (9093) grants Power 180", () => {
    const entry = SIGNET_PASSIVE_BUFFS.get(9093);
    expect(entry).toBeDefined();
    expect(entry.stat).toBe("Power");
    expect(entry.value).toBe(180);
  });

  test("Signet of Midnight (10234) grants Expertise 180", () => {
    const entry = SIGNET_PASSIVE_BUFFS.get(10234);
    expect(entry).toBeDefined();
    expect(entry.stat).toBe("Expertise");
    expect(entry.value).toBe(180);
  });

  test("Signet of the Wild (12491) grants Ferocity 180", () => {
    const entry = SIGNET_PASSIVE_BUFFS.get(12491);
    expect(entry).toBeDefined();
    expect(entry.stat).toBe("Ferocity");
    expect(entry.value).toBe(180);
  });

  test("all entries have stat string and value 180", () => {
    for (const [, entry] of SIGNET_PASSIVE_BUFFS) {
      expect(typeof entry.stat).toBe("string");
      expect(entry.value).toBe(180);
    }
  });
});

// ---------------------------------------------------------------------------
// BOON_NAMES
// ---------------------------------------------------------------------------
describe("BOON_NAMES", () => {
  test("has exactly 12 boons", () => {
    expect(BOON_NAMES.size).toBe(12);
  });

  test("contains all standard boons", () => {
    const expected = [
      "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
      "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
    ];
    for (const boon of expected) {
      expect(BOON_NAMES.has(boon)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CONDITION_NAMES
// ---------------------------------------------------------------------------
describe("CONDITION_NAMES", () => {
  test("contains canonical and variant names", () => {
    expect(CONDITION_NAMES.has("Blinded")).toBe(true);
    expect(CONDITION_NAMES.has("Blind")).toBe(true);
    expect(CONDITION_NAMES.has("Chilled")).toBe(true);
    expect(CONDITION_NAMES.has("Chill")).toBe(true);
    expect(CONDITION_NAMES.has("Immobilized")).toBe(true);
    expect(CONDITION_NAMES.has("Immobile")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CONDITION_NAME_NORMALIZE
// ---------------------------------------------------------------------------
describe("CONDITION_NAME_NORMALIZE", () => {
  test("Blind normalizes to Blinded", () => {
    expect(CONDITION_NAME_NORMALIZE.Blind).toBe("Blinded");
  });

  test("Chill normalizes to Chilled", () => {
    expect(CONDITION_NAME_NORMALIZE.Chill).toBe("Chilled");
  });

  test("Cripple normalizes to Crippled", () => {
    expect(CONDITION_NAME_NORMALIZE.Cripple).toBe("Crippled");
  });

  test("Immobilize and Immobilized both normalize to Immobile", () => {
    expect(CONDITION_NAME_NORMALIZE.Immobilize).toBe("Immobile");
    expect(CONDITION_NAME_NORMALIZE.Immobilized).toBe("Immobile");
  });

  test("Poison normalizes to Poisoned", () => {
    expect(CONDITION_NAME_NORMALIZE.Poison).toBe("Poisoned");
  });
});

// ---------------------------------------------------------------------------
// BOON_DISPLAY_ORDER
// ---------------------------------------------------------------------------
describe("BOON_DISPLAY_ORDER", () => {
  test("is an array of 12 boons", () => {
    expect(Array.isArray(BOON_DISPLAY_ORDER)).toBe(true);
    expect(BOON_DISPLAY_ORDER).toHaveLength(12);
  });

  test("contains same boons as BOON_NAMES", () => {
    for (const boon of BOON_DISPLAY_ORDER) {
      expect(BOON_NAMES.has(boon)).toBe(true);
    }
  });

  test("starts with Aegis and ends with Vigor", () => {
    expect(BOON_DISPLAY_ORDER[0]).toBe("Aegis");
    expect(BOON_DISPLAY_ORDER[BOON_DISPLAY_ORDER.length - 1]).toBe("Vigor");
  });
});

// ---------------------------------------------------------------------------
// ALL_STAT_KEYS
// ---------------------------------------------------------------------------
describe("ALL_STAT_KEYS", () => {
  test("has exactly 9 stat keys", () => {
    expect(ALL_STAT_KEYS).toHaveLength(9);
  });

  test("contains all expected stat keys", () => {
    const expected = [
      "Power", "Precision", "Toughness", "Vitality", "Ferocity",
      "ConditionDamage", "HealingPower", "Expertise", "Concentration",
    ];
    for (const key of expected) {
      expect(ALL_STAT_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// CONVERSION_TARGET_MAP
// ---------------------------------------------------------------------------
describe("CONVERSION_TARGET_MAP", () => {
  test("BoonDuration maps to Concentration", () => {
    expect(CONVERSION_TARGET_MAP.BoonDuration).toBe("Concentration");
  });

  test("ConditionDuration maps to Expertise", () => {
    expect(CONVERSION_TARGET_MAP.ConditionDuration).toBe("Expertise");
  });

  test("CritDamage maps to Ferocity", () => {
    expect(CONVERSION_TARGET_MAP.CritDamage).toBe("Ferocity");
  });

  test("Healing maps to HealingPower", () => {
    expect(CONVERSION_TARGET_MAP.Healing).toBe("HealingPower");
  });

  test("has exactly 4 entries", () => {
    expect(Object.keys(CONVERSION_TARGET_MAP)).toHaveLength(4);
  });

  test("all values are valid stat keys from ALL_STAT_KEYS", () => {
    for (const value of Object.values(CONVERSION_TARGET_MAP)) {
      expect(ALL_STAT_KEYS).toContain(value);
    }
  });
});
