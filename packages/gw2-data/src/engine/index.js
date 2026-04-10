"use strict";

const { computeAttributes, computeSlotStats, getExcludedSlots } = require("./attributes");
const { collectModifiers, collectActiveTraitIds, isFuryTrait } = require("./modifiers");
const { computeTooltip } = require("./tooltips");
const { buildInteractionGraph } = require("./graph");
const { analyzeBoons, isAllyTargeted, normalizeName } = require("./boons");
const { analyzeCombos } = require("./combos");
const { loadOverrides, getOverride } = require("./overrides");
const constants = require("./constants");

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
  // Re-export constants
  ...constants,
};
