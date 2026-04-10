// src/renderer/modules/engine-bridge.js
//
// Production bridge between renderer state and @axi/gw2-data engine.
// Only file that imports from the CJS engine package.

import * as engine from "@axi/gw2-data/engine";
const { computeAttributes, analyzeBoons, analyzeCombos, loadOverrides, computeSlotStats: engineSlotStats, collectModifiers: engineCollectModifiers } = engine;

// Re-export engine constants for renderer modules that need them
export const {
  MIGHT_POWER_PER_STACK,
  MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE,
  FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS,
  SIGNET_PASSIVE_BUFFS,
  BOON_NAMES,
  CONDITION_NAMES,
  CONDITION_NAME_NORMALIZE,
  BUFF_FACT_TYPES,
  STAT_COMBOS_BY_LABEL,
  SLOT_WEIGHTS,
  TWO_HAND_WEIGHTS,
  AQUATIC_SLOTS,
  LAND_ONLY_SLOTS,
} = engine;

// Cache overrides — loaded once, immutable
let _overrides = null;
function getOverrides() {
  if (!_overrides) _overrides = loadOverrides();
  return _overrides;
}

/**
 * Transform renderer state.editor into the engine's build context shape.
 */
export function buildEngineCtx(state, assumedBoons = null, sigilStacks = null) {
  const editor = state.editor || {};
  const equipment = editor.equipment || {};
  const isUnderwater = Boolean(editor.underwaterMode);

  return {
    profession: editor.profession || "",
    specializations: (editor.specializations || []).map((s) => ({
      id: s?.specializationId || s?.id,
      specializationId: s?.specializationId,
      majorChoices: s?.majorChoices || {},
    })),
    equipment: {
      slots: equipment.slots || {},
      weapons: equipment.weapons || {},
      runes: equipment.runes || {},
      infusions: equipment.infusions || {},
      enrichment: equipment.enrichment || null,
      food: equipment.food || null,
      utility: equipment.utility || null,
    },
    gameMode: editor.gameMode || "pve",
    underwaterMode: isUnderwater,
    activeWeaponSet: editor.activeWeaponSet || 1,
    skills: isUnderwater ? (editor.underwaterSkills || {}) : (editor.skills || {}),
    assumedBoons,
    sigilStacks,
  };
}

/**
 * Merge activeCatalog + upgradeCatalog into the engine's catalogs shape.
 */
export function buildEngineCatalogs(state) {
  const ac = state.activeCatalog || {};
  const uc = state.upgradeCatalog || {};
  return {
    traitById: ac.traitById || new Map(),
    skillById: ac.skillById || new Map(),
    specializationById: ac.specializationById || new Map(),
    runeById: uc.runeById || new Map(),
    foodById: uc.foodById || new Map(),
    utilityById: uc.utilityById || new Map(),
    infusionById: uc.infusionById || new Map(),
    enrichmentById: uc.enrichmentById || new Map(),
  };
}

/**
 * Compute all stats via the engine. Returns the full engine result:
 * { base, equipment, food, runes, infusions, enrichment, utility, signets,
 *   traits, conversions, boons, sigils, total, derived }
 */
export function computeStats(state, assumedBoons = null, sigilStacks = null) {
  const ctx = buildEngineCtx(state, assumedBoons, sigilStacks);
  const catalogs = buildEngineCatalogs(state);
  return computeAttributes(ctx, catalogs);
}

/**
 * Compute boon/condition coverage via the engine.
 * Returns { boons, conditions } in the same shape the renderer expects.
 */
export function computeBoons(state, weaponSkills = []) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const resolvedSkills = [...(weaponSkills || []).filter(Boolean)];
  const resolvedTraits = [];

  for (const spec of ctx.specializations || []) {
    const specId = Number(spec.specializationId || spec.id) || 0;
    const specData = catalogs.specializationById.get(specId);
    const allTraitIds = [
      ...Object.values(spec.majorChoices || {}),
      ...(specData?.minorTraits || []),
    ].map(Number).filter(Boolean);
    for (const tid of allTraitIds) {
      const trait = catalogs.traitById.get(tid);
      if (trait) resolvedTraits.push(trait);
    }
  }

  // Resolve heal/utility/elite skills
  const skills = ctx.skills || {};
  const skillIds = [skills.healId, ...(skills.utilityIds || []), skills.eliteId].filter(Boolean);
  for (const id of skillIds) {
    const skill = catalogs.skillById.get(Number(id));
    if (skill) resolvedSkills.push(skill);
  }

  const overrides = getOverrides();
  const activeTraitIds = new Set(resolvedTraits.map((t) => t.id));
  return analyzeBoons(resolvedSkills, resolvedTraits, overrides, activeTraitIds);
}

/**
 * Compute combo fields/finishers via the engine.
 * Returns { fields, finishers }.
 */
export function computeCombos(state, weaponSkills = []) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const resolvedSkills = [...(weaponSkills || []).filter(Boolean)];
  const resolvedTraits = [];

  for (const spec of ctx.specializations || []) {
    const specId = Number(spec.specializationId || spec.id) || 0;
    const specData = catalogs.specializationById.get(specId);
    const allTraitIds = [
      ...Object.values(spec.majorChoices || {}),
      ...(specData?.minorTraits || []),
    ].map(Number).filter(Boolean);
    for (const tid of allTraitIds) {
      const trait = catalogs.traitById.get(tid);
      if (trait) resolvedTraits.push(trait);
    }
  }

  const skills = ctx.skills || {};
  const skillIds = [skills.healId, ...(skills.utilityIds || []), skills.eliteId].filter(Boolean);
  for (const id of skillIds) {
    const skill = catalogs.skillById.get(Number(id));
    if (skill) resolvedSkills.push(skill);
  }

  return analyzeCombos(resolvedSkills, resolvedTraits);
}

/**
 * Thin wrapper around the engine's computeSlotStats.
 * Matches the old renderer signature: computeSlotStats(comboLabel, slotKey).
 */
export function computeSlotStatsFromState(state, comboLabel, slotKey) {
  const weapons = state.editor?.equipment?.weapons || {};
  const gameMode = state.editor?.gameMode || "pve";
  return engineSlotStats(comboLabel, slotKey, weapons, gameMode);
}

/**
 * Compute Fury crit modifier from active traits.
 * Returns the bonus crit % from Fury-related traits (e.g., Roiling Mists).
 */
export function computeFuryCritModifier(state) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const overrides = getOverrides();
  const mods = engineCollectModifiers(ctx, catalogs, overrides);
  let bonus = 0;
  for (const mod of mods) {
    if (mod.type === "critChance" && mod.condition === "fury") {
      bonus += mod.value;
    }
  }
  return bonus;
}

/**
 * Compute Fury stat bonuses from active traits.
 * Returns an object like { Ferocity: 120, Precision: 80 } or empty {}.
 */
export function computeFuryStatBonuses(state) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const overrides = getOverrides();
  const mods = engineCollectModifiers(ctx, catalogs, overrides);
  const bonuses = {};
  for (const mod of mods) {
    if (mod.type === "flatBonus" && mod.condition === "fury") {
      bonuses[mod.stat] = (bonuses[mod.stat] || 0) + mod.value;
    }
  }
  return bonuses;
}

/**
 * Get Might per-stack values, accounting for Notoriety trait override.
 */
export function computeMightPerStack(state) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const overrides = getOverrides();
  const mods = engineCollectModifiers(ctx, catalogs, overrides);
  for (const mod of mods) {
    if (mod.type === "mightModifier") {
      return { power: mod.power, condi: mod.condi };
    }
  }
  return { power: MIGHT_POWER_PER_STACK, condi: MIGHT_CONDI_PER_STACK };
}

/**
 * Compute total Concentration for a build object (used by comp-boon-coverage).
 * The build object has a different shape than state.editor — it comes from
 * the comp/party system. We construct a minimal ctx from it.
 */
export function computeBuildConcentration(build, upgradeCatalog) {
  if (!build?.equipment) return 0;
  const fakeState = {
    editor: {
      profession: build.profession || "",
      specializations: build.specializations || [],
      equipment: build.equipment,
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: {},
    },
    activeCatalog: { traitById: new Map(), skillById: new Map(), specializationById: new Map() },
    upgradeCatalog: upgradeCatalog || { runeById: new Map(), foodById: new Map(), utilityById: new Map(), infusionById: new Map(), enrichmentById: new Map() },
  };
  const result = computeStats(fakeState);
  return result.total.Concentration || 0;
}
