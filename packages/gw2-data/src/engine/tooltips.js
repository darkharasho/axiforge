"use strict";

const { WEAPON_STRENGTH_MIDPOINT } = require("./constants");

/**
 * Compute tooltip damage for a skill.
 *
 * @param {Object} attributes - Result from computeAttributes() (needs .total and .derived)
 * @param {Object} skill - Skill object with facts array
 * @param {string} weaponType - Equipped weapon type (e.g. "greatsword", "staff")
 * @param {Object[]} modifiers - Active modifiers from collectModifiers()
 * @returns {Object|null} Tooltip result or null if skill has no Damage fact
 */
function computeTooltip(attributes, skill, weaponType, modifiers) {
  const facts = skill.facts || [];
  const damageFact = facts.find((f) => f.type === "Damage");
  if (!damageFact) return null;

  const coefficient = damageFact.dmg_multiplier || 0;
  const hits = damageFact.hit_count || 1;
  const weaponStrength = WEAPON_STRENGTH_MIDPOINT[weaponType] || 0;
  const power = attributes.total.Power || 0;

  // Target armor (standard PvE target: 2597)
  const targetArmor = 2597;

  // Collect applicable damage multipliers
  let damageMultiplier = 1;
  const appliedModifiers = [];
  for (const mod of modifiers) {
    if (mod.type === "damageMultiplier" && mod.condition === null) {
      damageMultiplier *= (1 + mod.value / 100);
      appliedModifiers.push(mod);
    }
  }

  // Effective power with crit
  const critChance = Math.min(100, attributes.derived.critChance || 0) / 100;
  const critDamage = (attributes.derived.critDamage || 150) / 100;
  const critMultiplier = 1 + critChance * (critDamage - 1);

  const damage = Math.round(
    coefficient * weaponStrength * power * damageMultiplier * critMultiplier / targetArmor
  );

  return {
    damage,
    totalDamage: damage * hits,
    coefficient,
    hits,
    weaponStrength,
    power,
    critMultiplier,
    damageMultiplier,
    modifiers: appliedModifiers,
  };
}

module.exports = { computeTooltip };
