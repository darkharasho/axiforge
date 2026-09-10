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
  BERSERK_CRIT_CHANCE,
  BERSERK_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS,
  SIGNET_PASSIVE_BUFFS,
  SIGNET_ACTIVE_EFFECTS,
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
export function buildEngineCtx(state, assumedBoons = null, sigilStacks = null, activeSignets = null) {
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
    activeSignets,
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
    relicByName: uc.relicByName || new Map(),
  };
}

/**
 * Resolve the equipped relic into an entity the boon/fact analyzers can walk.
 * Relics are stored on the build by name, and the upgrade catalog attaches the
 * GW2-API-shaped `facts` array (desktop calls the flavour text `buff`, the web
 * catalog calls it `description`).
 */
function _resolveRelic(state, catalogs) {
  const name = (state.editor || {}).equipment?.relic || "";
  if (!name) return null;
  const def = catalogs.relicByName?.get(name);
  if (!def?.facts?.length) return null;
  return {
    id: def.id,
    name: def.name || name,
    icon: def.icon || "",
    description: def.description || def.buff || "",
    facts: def.facts,
  };
}

/**
 * Compute all stats via the engine. Returns the full engine result:
 * { base, equipment, food, runes, infusions, enrichment, utility, signets,
 *   traits, conversions, boons, sigils, total, derived }
 */
export function computeStats(state, assumedBoons = null, sigilStacks = null, activeSignets = null) {
  const ctx = buildEngineCtx(state, assumedBoons, sigilStacks, activeSignets);
  const catalogs = buildEngineCatalogs(state);
  return computeAttributes(ctx, catalogs);
}

// Matches the "Ambush." / "Unleashed Ambush." prefix the GW2 API puts on every
// elite-spec ambush description. `Ambush Assault` and `Illusionary Ambush` carry
// the word in their *name* only, so match the description, not the name.
const AMBUSH_DESCRIPTION_RE = /^\s*(unleashed\s+)?ambush\.\s*/i;

/**
 * True for an elite-spec ambush skill: a spec-gated Weapon_1 replacement that is
 * only on the bar while the spec mechanic (Mirage Cloak, Unleash) is active.
 */
function _isAmbushSkill(skill) {
  return skill?.slot === "Weapon_1"
    && !!Number(skill?.specialization)
    && AMBUSH_DESCRIPTION_RE.test(skill?.description || "");
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

  // Seeded with the weapon slots already in resolvedSkills so no later pass can
  // add the same skill twice (Untamed's unleashed ambush sits in Weapon_1 while
  // Unleash is toggled on, and would otherwise be counted as two sources).
  const seenSkillIds = new Set(resolvedSkills.map((s) => Number(s.id)).filter(Boolean));
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
  // Equipped weapon types, lowercased: the build stores them lowercase ("rifle")
  // while the catalog spells them out ("Rifle").
  const equippedWeapons = new Set();
  for (const val of Object.values((state.editor || {}).equipment?.weapons || {})) {
    if (val) equippedWeapons.add(String(val).toLowerCase());
  }
  const hasEquipped = (skill) => equippedWeapons.has(String(skill.weaponType || "").toLowerCase());
  for (const skill of allCatalogSkills) {
    if (!skill || skill.type !== "Profession") continue;
    // Ambushes are resolved by the dedicated pass below, which weapon-gates them
    // even when the caller didn't ask for weapon filtering.
    if (_isAmbushSkill(skill)) continue;
    // Skip if requires an unselected elite spec
    if (skill.specialization && !activeSpecIds.has(Number(skill.specialization))) continue;
    // Skip if weapon-filtered and this skill's weapon isn't equipped
    if (filterWeapons && skill.weaponType && !hasEquipped(skill)) continue;
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

  // Elite-spec ambush skills (Mirage's Mirage Cloak, Untamed's Unleashed Power).
  // They replace Weapon_1 only while the spec mechanic is up, so they are never in
  // the equipped weapon slots, and the API types them inconsistently — Mirage's
  // rifle/staff/greatsword/dagger/trident ambushes are "Weapon" while its
  // axe/scepter/sword/spear ones are "Profession" — so neither the weapon-skill
  // resolver nor the profession-mechanic pass above can find them all. The
  // "Ambush." description marker is what the game itself uses to label them.
  // Always weapon-gated: an ambush for a weapon you don't carry is unreachable.
  for (const skill of allCatalogSkills) {
    if (!skill || !_isAmbushSkill(skill)) continue;
    if (!activeSpecIds.has(Number(skill.specialization))) continue;
    if (!hasEquipped(skill)) continue;
    if (seenSkillIds.has(skill.id)) continue;
    seenSkillIds.add(skill.id);
    resolvedSkills.push(skill);
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
  const relic = _resolveRelic(state, catalogs);
  const result = analyzeBoons(resolvedSkills, resolvedTraits, overrides, activeTraitIds, relic ? [relic] : []);

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
 * Compute crit bonus from active Berserk mode: base +5% plus any berserk-conditional trait bonuses.
 * Returns 0 when berserk is not active.
 */
export function computeBerserkCritModifier(state) {
  const ctx = buildEngineCtx(state);
  if (!ctx.berserkActive) return 0;
  const catalogs = buildEngineCatalogs(state);
  const overrides = getOverrides();
  const mods = engineCollectModifiers(ctx, catalogs, overrides);
  const base = ctx.gameMode === "wvw" ? BERSERK_CRIT_CHANCE_WVW : BERSERK_CRIT_CHANCE;
  let bonus = base;
  for (const mod of mods) {
    if (mod.type === "critChance" && mod.condition === "berserk") {
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
      return { power: mod.power ?? MIGHT_POWER_PER_STACK, condi: mod.condi ?? MIGHT_CONDI_PER_STACK };
    }
  }
  return { power: MIGHT_POWER_PER_STACK, condi: MIGHT_CONDI_PER_STACK };
}

/**
 * Build a minimal ctx from a comp/party build object, whose shape differs from
 * state.editor. Shared by the Concentration/Expertise duration helpers.
 */
function _fakeStateForBuild(build, upgradeCatalog) {
  return {
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
}

/**
 * Compute total Concentration for a build object (used by comp-boon-coverage
 * to scale boon durations).
 */
export function computeBuildConcentration(build, upgradeCatalog) {
  if (!build?.equipment) return 0;
  const result = computeStats(_fakeStateForBuild(build, upgradeCatalog));
  return result.total.Concentration || 0;
}

/**
 * Compute total Expertise for a build object. Condition duration scales off
 * Expertise, not Concentration — reusing the boon helper would report wrong
 * durations on the condition coverage panel.
 */
export function computeBuildExpertise(build, upgradeCatalog) {
  if (!build?.equipment) return 0;
  const result = computeStats(_fakeStateForBuild(build, upgradeCatalog));
  return result.total.Expertise || 0;
}
