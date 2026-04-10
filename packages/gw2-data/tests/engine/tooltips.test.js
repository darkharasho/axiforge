"use strict";

const { computeTooltip } = require("../../src/engine/tooltips");
const { WEAPON_STRENGTH_MIDPOINT } = require("../../src/engine/constants");

describe("computeTooltip", () => {
  const baseAttrs = {
    total: { Power: 3000, Precision: 2000, Ferocity: 900 },
    derived: { critChance: 57.6, critDamage: 210.0 },
  };

  test("computes damage from coefficient and weapon strength", () => {
    const skill = {
      id: 5489, name: "Fireball",
      facts: [{ type: "Damage", dmg_multiplier: 0.75, hit_count: 1 }],
    };
    const result = computeTooltip(baseAttrs, skill, "staff", []);
    expect(result.coefficient).toBe(0.75);
    expect(result.hits).toBe(1);
    expect(result.weaponStrength).toBe(WEAPON_STRENGTH_MIDPOINT.staff);
    expect(result.damage).toBeGreaterThan(0);
  });

  test("multi-hit skill multiplies by hit count", () => {
    const skill = {
      id: 100, name: "Multi",
      facts: [{ type: "Damage", dmg_multiplier: 0.5, hit_count: 3 }],
    };
    const result = computeTooltip(baseAttrs, skill, "sword", []);
    expect(result.hits).toBe(3);
    expect(result.totalDamage).toBe(result.damage * 3);
  });

  test("applies damage multiplier modifiers", () => {
    const skill = {
      id: 101, name: "Big Hit",
      facts: [{ type: "Damage", dmg_multiplier: 1.0, hit_count: 1 }],
    };
    const mods = [{ source: "trait:500", type: "damageMultiplier", value: 10, condition: null }];
    const withMods = computeTooltip(baseAttrs, skill, "greatsword", mods);
    const withoutMods = computeTooltip(baseAttrs, skill, "greatsword", []);
    expect(withMods.damage).toBeGreaterThan(withoutMods.damage);
  });

  test("returns null for skill with no Damage fact", () => {
    const skill = { id: 102, name: "Heal", facts: [{ type: "AttributeAdjust" }] };
    const result = computeTooltip(baseAttrs, skill, "staff", []);
    expect(result).toBeNull();
  });

  test("uses correct weapon strength for weapon type", () => {
    const skill = {
      id: 103, name: "Shot",
      facts: [{ type: "Damage", dmg_multiplier: 1.0, hit_count: 1 }],
    };
    const rifle = computeTooltip(baseAttrs, skill, "rifle", []);
    const dagger = computeTooltip(baseAttrs, skill, "dagger", []);
    expect(rifle.weaponStrength).toBe(1095.5);
    expect(dagger.weaponStrength).toBe(952.5);
    expect(rifle.damage).toBeGreaterThan(dagger.damage);
  });
});
