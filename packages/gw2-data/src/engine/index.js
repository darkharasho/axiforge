"use strict";

const { computeAttributes, computeSlotStats, getExcludedSlots } = require("./attributes");
const { collectModifiers, collectActiveTraitIds, isFuryTrait } = require("./modifiers");
const { computeTooltip } = require("./tooltips");
const { buildInteractionGraph } = require("./graph");
const { analyzeBoons, isAllyTargeted, normalizeName } = require("./boons");
const { analyzeCombos } = require("./combos");
const { loadOverrides, getOverride } = require("./overrides");
const {
  STAT_COMBOS, STAT_COMBOS_BY_LABEL, getStatCombo, getEffectiveStats,
  SLOT_WEIGHTS, TWO_HAND_WEIGHTS, LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  PROFESSION_WEIGHT, ARMOR_DEFENSE_BY_WEIGHT, PROFESSION_BASE_HP,
  WEAPON_STRENGTH_MIDPOINT, BUFF_FACT_TYPES,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS, SIGNET_PASSIVE_BUFFS, SIGNET_ACTIVE_EFFECTS,
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, ALL_STAT_KEYS, CONVERSION_TARGET_MAP,
} = require("./constants");

class StatEngine {
  /**
   * @param {Object} catalogs - GW2 API catalog data
   * @param {Map} [overrides] - Override map (auto-loaded if not provided)
   */
  constructor(catalogs, overrides) {
    this._catalogs = catalogs;
    this._overrides = overrides || loadOverrides();
  }

  computeAttributes(ctx) {
    return computeAttributes(ctx, this._catalogs);
  }

  collectModifiers(ctx) {
    return collectModifiers(ctx, this._catalogs, this._overrides);
  }

  computeTooltip(ctx, skill, weaponType) {
    const attrs = this.computeAttributes(ctx);
    const mods = this.collectModifiers(ctx);
    return computeTooltip(attrs, skill, weaponType, mods);
  }

  analyzeBoons(skills, traits, activeTraitIds) {
    return analyzeBoons(skills, traits, this._overrides, activeTraitIds);
  }

  analyzeCombos(skills, traits) {
    return analyzeCombos(skills, traits);
  }
}

module.exports = {
  StatEngine,
  // Re-export individual modules for direct use
  computeAttributes,
  computeSlotStats,
  getExcludedSlots,
  collectModifiers,
  collectActiveTraitIds,
  isFuryTrait,
  computeTooltip,
  buildInteractionGraph,
  analyzeBoons,
  isAllyTargeted,
  normalizeName,
  analyzeCombos,
  loadOverrides,
  getOverride,
  // Constants
  STAT_COMBOS, STAT_COMBOS_BY_LABEL, getStatCombo, getEffectiveStats,
  SLOT_WEIGHTS, TWO_HAND_WEIGHTS, LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  PROFESSION_WEIGHT, ARMOR_DEFENSE_BY_WEIGHT, PROFESSION_BASE_HP,
  WEAPON_STRENGTH_MIDPOINT, BUFF_FACT_TYPES,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS, SIGNET_PASSIVE_BUFFS, SIGNET_ACTIVE_EFFECTS,
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, ALL_STAT_KEYS, CONVERSION_TARGET_MAP,
};
