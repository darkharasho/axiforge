"use strict";
const {
  PROFESSIONS, professionToIndex, indexToProfession,
  WEAPONS, weaponToIndex, indexToWeapon, isWeaponTwoHanded,
  STAT_COMBOS_ORDERED, statToIndex, indexToStat,
  relicToIndex, indexToRelic,
  foodToIndex, indexToFood,
  utilityToIndex, indexToUtility,
  legendStringToIndex, indexToLegendString,
} = require("../../src/main/shareCodeTables");

describe("professions", () => {
  test("Guardian is 0, Revenant is 8", () => {
    expect(professionToIndex("Guardian")).toBe(0);
    expect(professionToIndex("Revenant")).toBe(8);
  });
  test("round-trip all professions", () => {
    for (let i = 0; i < PROFESSIONS.length; i++) {
      expect(professionToIndex(PROFESSIONS[i])).toBe(i);
      expect(indexToProfession(i)).toBe(PROFESSIONS[i]);
    }
  });
});

describe("weapons", () => {
  test("index 0 is empty", () => { expect(indexToWeapon(0)).toBe(""); });
  test("Greatsword is two-handed", () => { expect(isWeaponTwoHanded(weaponToIndex("greatsword"))).toBe(true); });
  test("Sword is not two-handed", () => { expect(isWeaponTwoHanded(weaponToIndex("sword"))).toBe(false); });
  test("all 19 weapons have indices 1-19", () => {
    expect(WEAPONS.length).toBe(20); // 0=empty + 19 weapons
  });
});

describe("stats", () => {
  test("index 0 is empty", () => { expect(indexToStat(0)).toBe(""); });
  test("Berserker's is 1", () => { expect(statToIndex("Berserker's")).toBe(1); });
  test("21 stat combos + empty = 22 entries", () => {
    expect(STAT_COMBOS_ORDERED.length).toBe(22);
  });
});

describe("relics", () => {
  test("alphabetically sorted — Relic of Agony before Relic of Akeem", () => {
    const agonyIdx = relicToIndex("Relic of Agony");
    const akeemIdx = relicToIndex("Relic of Akeem");
    expect(agonyIdx).toBeLessThan(akeemIdx);
    expect(agonyIdx).toBeGreaterThan(0);
  });
  test("index 0 returns empty string", () => { expect(indexToRelic(0)).toBe(""); });
  test("round-trip", () => {
    const idx = relicToIndex("Relic of the Warrior");
    expect(indexToRelic(idx)).toBe("Relic of the Warrior");
  });
  test("106 relics total", () => {
    expect(relicToIndex("Relic of the Zephyrite")).toBeGreaterThan(0);
  });
});

describe("food", () => {
  test("index 0 is empty", () => { expect(indexToFood(0)).toEqual({ label: "", id: 0 }); });
  test("round-trip first food item", () => {
    const idx = foodToIndex("Peppercorn-Crusted Sous-Vide Steak");
    expect(idx).toBe(1);
    expect(indexToFood(1).label).toBe("Peppercorn-Crusted Sous-Vide Steak");
  });
});

describe("utility buffs", () => {
  test("round-trip", () => {
    const idx = utilityToIndex("Superior Sharpening Stone");
    expect(idx).toBe(1);
    expect(indexToUtility(1).label).toBe("Superior Sharpening Stone");
  });
});

describe("revenant legends", () => {
  test("Legend1 (Glint) is index 1", () => { expect(legendStringToIndex("Legend1")).toBe(1); });
  test("round-trip all legends", () => {
    for (let i = 1; i <= 7; i++) {
      const str = indexToLegendString(i);
      expect(legendStringToIndex(str)).toBe(i);
    }
  });
  test("empty string returns 0", () => { expect(legendStringToIndex("")).toBe(0); });
});
