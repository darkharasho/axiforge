"use strict";

/**
 * Tests for stat display order in the attributes panel (issue #230).
 *
 * The in-game stat doll shows: Power, Toughness, Vitality, Precision, Ferocity, ...
 * Precision and Crit Chance must appear after Vitality and Health.
 */

const { STAT_DISPLAY_KEYS } = require("../../../src/renderer/modules/constants");

describe("Attributes panel stat display order (issue #230)", () => {
  test("STAT_DISPLAY_KEYS is defined and contains core stats", () => {
    expect(Array.isArray(STAT_DISPLAY_KEYS)).toBe(true);
    expect(STAT_DISPLAY_KEYS).toContain("Precision");
    expect(STAT_DISPLAY_KEYS).toContain("Vitality");
  });

  test("Vitality appears before Precision to match in-game stat doll", () => {
    const vitIdx = STAT_DISPLAY_KEYS.indexOf("Vitality");
    const precIdx = STAT_DISPLAY_KEYS.indexOf("Precision");
    expect(vitIdx).toBeGreaterThanOrEqual(0);
    expect(precIdx).toBeGreaterThanOrEqual(0);
    expect(vitIdx).toBeLessThan(precIdx);
  });

  test("Power is first stat", () => {
    expect(STAT_DISPLAY_KEYS[0]).toBe("Power");
  });

  test("Toughness appears before Vitality", () => {
    const toughIdx = STAT_DISPLAY_KEYS.indexOf("Toughness");
    const vitIdx = STAT_DISPLAY_KEYS.indexOf("Vitality");
    expect(toughIdx).toBeLessThan(vitIdx);
  });

  test("HealingPower is not a standalone row (shares row with ConditionDamage)", () => {
    expect(STAT_DISPLAY_KEYS).not.toContain("HealingPower");
    expect(STAT_DISPLAY_KEYS).toContain("ConditionDamage");
  });
});
