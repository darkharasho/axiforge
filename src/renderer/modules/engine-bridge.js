// src/renderer/modules/engine-bridge.js
//
// Adapter layer between renderer state and @axi/gw2-data engine.
// Only file that knows about both shapes. Dev-mode only validation.

import { computeAttributes, analyzeBoons, loadOverrides } from "@axi/gw2-data/engine";

// Cache overrides — loaded once, immutable
let _overrides = null;
function getOverrides() {
  if (!_overrides) _overrides = loadOverrides();
  return _overrides;
}

const ALL_STAT_KEYS = [
  "Power", "Precision", "Toughness", "Vitality", "Ferocity",
  "ConditionDamage", "Expertise", "Concentration", "HealingPower",
];

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
 * Run engine computation and compare against old code's result.
 * Logs mismatches to console. Only call in dev mode.
 */
export function validateStatResult(oldTotals, state, label, assumedBoons = null, sigilStacks = null) {
  try {
    const ctx = buildEngineCtx(state, assumedBoons, sigilStacks);
    const catalogs = buildEngineCatalogs(state);
    const engineResult = computeAttributes(ctx, catalogs);
    const newTotals = engineResult.total;

    const mismatches = [];
    for (const key of ALL_STAT_KEYS) {
      const oldVal = oldTotals[key] || 0;
      const newVal = newTotals[key] || 0;
      if (oldVal !== newVal) {
        mismatches.push(`${key}: old=${oldVal}, new=${newVal}`);
      }
    }

    if (mismatches.length > 0) {
      console.warn(`[ENGINE-MISMATCH] ${label} —`, mismatches.join(" | "));
    }
  } catch (err) {
    console.error(`[ENGINE-ERROR] ${label} —`, err.message);
  }
}

/**
 * Run engine boon analysis and compare against old code's result.
 * Logs mismatches to console. Only call in dev mode.
 */
export function validateBoonResult(oldResult, state, label, catalog, editor, weaponSkills) {
  try {
    const resolvedSkills = (weaponSkills || []).filter(Boolean);
    const resolvedTraits = [];

    const ctx = buildEngineCtx(state);
    const catalogs = buildEngineCatalogs(state);

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
    const engineResult = analyzeBoons(resolvedSkills, resolvedTraits, overrides, activeTraitIds);

    // Compare boon names
    const oldBoonNames = new Set((oldResult.boons || []).map((b) => b.name));
    const newBoonNames = new Set((engineResult.boons || []).map((b) => b.name));
    const missingBoons = [...oldBoonNames].filter((n) => !newBoonNames.has(n));
    const extraBoons = [...newBoonNames].filter((n) => !oldBoonNames.has(n));

    const oldCondNames = new Set((oldResult.conditions || []).map((c) => c.name));
    const newCondNames = new Set((engineResult.conditions || []).map((c) => c.name));
    const missingConds = [...oldCondNames].filter((n) => !newCondNames.has(n));
    const extraConds = [...newCondNames].filter((n) => !oldCondNames.has(n));

    const issues = [];
    if (missingBoons.length) issues.push(`missing boons: ${missingBoons.join(", ")}`);
    if (extraBoons.length) issues.push(`extra boons: ${extraBoons.join(", ")}`);
    if (missingConds.length) issues.push(`missing conditions: ${missingConds.join(", ")}`);
    if (extraConds.length) issues.push(`extra conditions: ${extraConds.join(", ")}`);

    if (issues.length > 0) {
      console.warn(`[ENGINE-MISMATCH] ${label} —`, issues.join(" | "));
    }
  } catch (err) {
    console.error(`[ENGINE-ERROR] ${label} —`, err.message);
  }
}
