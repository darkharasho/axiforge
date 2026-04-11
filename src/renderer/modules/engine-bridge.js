// src/renderer/modules/engine-bridge.js
//
// Production bridge between renderer state and @axiapps/gw2-data engine.
// Only file that imports from the CJS engine package.

import * as _engine from "@axiapps/gw2-data/engine";
import { BOON_CONDITION_ICONS } from "./constants.js";

// Normalize CJS interop: Vite dev uses namespace, Rollup prod wraps in { default }
const engine = _engine.default || _engine;
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

  // Determine if berserk mode is toggled on (Warrior/Berserker spec 18).
  const activeKit = Number(editor.activeKit) || 0;
  const hasBerserker = (editor.specializations || []).some(
    (s) => Number(s?.specializationId || s?.id) === 18
  );
  const berserkActive = hasBerserker && activeKit > 0;

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
      sigils: equipment.sigils || {},
      infusions: equipment.infusions || {},
      enrichment: equipment.enrichment ? Number(equipment.enrichment) : null,
      food: equipment.food ? Number(equipment.food) : null,
      utility: equipment.utility ? Number(equipment.utility) : null,
    },
    gameMode: editor.gameMode || "pve",
    underwaterMode: isUnderwater,
    activeWeaponSet: editor.activeWeaponSet || 1,
    skills: isUnderwater ? (editor.underwaterSkills || {}) : (editor.skills || {}),
    assumedBoons,
    sigilStacks,
    berserkActive,
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
 * Shared helper: resolve all skills and traits from state for boon/combo analysis.
 * Handles standard and serialized build formats, flip skills, profession mechanics, bundle skills.
 */
function _resolveSkillsAndTraits(state, ctx, catalogs, weaponSkills = [], { filterWeapons = false } = {}) {
  const resolvedSkills = [...(weaponSkills || []).filter(Boolean)];
  const resolvedTraits = [];

  // Collect active specialization IDs for profession mechanic filtering
  const activeSpecIds = new Set();
  for (const spec of ctx.specializations || []) {
    const specId = Number(spec.specializationId || spec.id) || 0;
    if (specId) activeSpecIds.add(specId);
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

  // Resolve heal/utility/elite skills — support both standard and serialized format
  const skills = ctx.skills || {};
  const skillIds = [];
  // Standard format: healId, utilityIds[], eliteId
  if (skills.healId) skillIds.push(skills.healId);
  if (skills.utilityIds) skillIds.push(...skills.utilityIds);
  if (skills.eliteId) skillIds.push(skills.eliteId);
  // Serialized format: heal, utility[], elite (objects with .id)
  if (skills.heal?.id) skillIds.push(skills.heal.id);
  if (skills.utility) {
    for (const u of skills.utility) { if (u?.id) skillIds.push(u.id); }
  }
  if (skills.elite?.id) skillIds.push(skills.elite.id);

  const seenSkillIds = new Set();
  for (const id of skillIds.filter(Boolean)) {
    const numId = Number(id);
    if (seenSkillIds.has(numId)) continue;
    seenSkillIds.add(numId);
    const skill = catalogs.skillById.get(numId);
    if (skill) {
      resolvedSkills.push(skill);
      // Follow flipSkill one level deep
      if (skill.flipSkill) {
        const flip = catalogs.skillById.get(Number(skill.flipSkill));
        if (flip) resolvedSkills.push(flip);
      }
      // Follow bundleSkills (e.g., Engineer kits, Elementalist conjures)
      if (skill.bundleSkills) {
        for (const bsId of skill.bundleSkills) {
          const bs = catalogs.skillById.get(Number(bsId));
          if (bs && !seenSkillIds.has(bs.id)) {
            seenSkillIds.add(bs.id);
            resolvedSkills.push(bs);
          }
        }
      }
    }
  }

  // Collect profession mechanic skills (F1-F5) from catalog
  const ac = state.activeCatalog || {};
  const allCatalogSkills = ac.skills || [];
  // Build set of equipped weapon types for optional filtering
  const equippedWeapons = new Set();
  if (filterWeapons) {
    const weapons = (state.editor || {}).equipment?.weapons || {};
    for (const val of Object.values(weapons)) {
      if (val) equippedWeapons.add(String(val));
    }
  }
  for (const skill of allCatalogSkills) {
    if (!skill || skill.type !== "Profession") continue;
    // Skip if requires an unselected elite spec
    if (skill.specialization && !activeSpecIds.has(Number(skill.specialization))) continue;
    // Skip if weapon-filtered and this skill's weapon isn't equipped
    if (filterWeapons && skill.weaponType && !equippedWeapons.has(skill.weaponType)) continue;
    if (!seenSkillIds.has(skill.id)) {
      seenSkillIds.add(skill.id);
      resolvedSkills.push(skill);
    }
    // Include bundle skills (e.g., Firebrand tome chapters)
    if (skill.bundleSkills) {
      for (const bsId of skill.bundleSkills) {
        const bs = catalogs.skillById.get(Number(bsId));
        if (bs && !seenSkillIds.has(bs.id)) {
          seenSkillIds.add(bs.id);
          resolvedSkills.push(bs);
        }
      }
    }
  }

  return { resolvedSkills, resolvedTraits };
}

export function computeBoons(state, weaponSkills = []) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const { resolvedSkills, resolvedTraits } = _resolveSkillsAndTraits(state, ctx, catalogs, weaponSkills);

  const overrides = getOverrides();
  // Include ALL trait IDs from majorChoices/minorTraits (not just resolved ones)
  // so override checks like Twisted Medicine work even without catalog entries
  const activeTraitIds = new Set(resolvedTraits.map((t) => t.id));
  for (const spec of ctx.specializations || []) {
    for (const id of Object.values(spec.majorChoices || {})) {
      const n = Number(id);
      if (n) activeTraitIds.add(n);
    }
    const specData = catalogs.specializationById.get(Number(spec.specializationId || spec.id));
    for (const mid of specData?.minorTraits || []) {
      if (mid) activeTraitIds.add(Number(mid));
    }
  }
  const result = analyzeBoons(resolvedSkills, resolvedTraits, overrides, activeTraitIds);

  // Enrich boon/condition entries with icon URLs and hasAllySource for the renderer
  for (const entry of [...result.boons, ...result.conditions]) {
    entry.icon = BOON_CONDITION_ICONS[entry.name] || "";
    entry.hasAllySource = entry.sources.some((s) => s.isAlly);
  }

  return result;
}

/**
 * Compute combo fields/finishers via the engine.
 * Returns { fields, finishers }.
 */
export function computeCombos(state, weaponSkills = [], { filterWeapons = false } = {}) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const { resolvedSkills, resolvedTraits } = _resolveSkillsAndTraits(state, ctx, catalogs, weaponSkills, { filterWeapons });
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
 * Compute passive crit modifier from active traits.
 * Returns the bonus crit % from passive traits (e.g., Pinnacle of Strength).
 */
export function computePassiveCritModifier(state) {
  const ctx = buildEngineCtx(state);
  const catalogs = buildEngineCatalogs(state);
  const overrides = getOverrides();
  const mods = engineCollectModifiers(ctx, catalogs, overrides);
  let bonus = 0;
  for (const mod of mods) {
    if (mod.type === "critChance" && mod.condition === null) {
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
      bonuses[mod.target] = (bonuses[mod.target] || 0) + mod.value;
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
