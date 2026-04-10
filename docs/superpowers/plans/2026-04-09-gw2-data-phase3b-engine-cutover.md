# @axi/gw2-data Phase 3b: Engine Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the old stat computation code from the renderer and make `@axi/gw2-data/engine` the sole computation path.

**Architecture:** `engine-bridge.js` becomes the production bridge with `computeStats()` and `computeBoons()` wrappers. All call sites switch from `computeEquipmentStats()` / `computeBoonCoverage()` to the bridge functions. Old computation code (~900 lines) is deleted from `stats.js` and `boon-coverage.js`. Duplicated constants are removed from `constants.js`.

**Tech Stack:** ES modules (renderer), CommonJS (`@axi/gw2-data`), Vite bundler

---

## File Structure

| File | Action | Responsibility After |
|------|--------|---------------------|
| `src/renderer/modules/engine-bridge.js` | Modify | Production bridge: state→engine transforms, `computeStats()`, `computeBoons()`, `computeCombos()`, constant re-exports |
| `src/renderer/modules/stats.js` | Modify (heavy deletion) | UI-only: `computeStatBreakdown()`, `computeUpgradeModifiers()`, thin wrappers for `computeSlotStats()` and `computeBuildConcentration()` |
| `src/renderer/modules/boon-coverage.js` | Modify (heavy deletion) | `computePartyCoverage()` only — rewired to use engine |
| `src/renderer/modules/constants.js` | Modify (delete duplicates) | UI-only constants (icons, display order, weapon defs, etc.) |
| `src/renderer/modules/equipment.js` | Modify (import changes + call site rewiring) | No computation — uses bridge |
| `src/renderer/modules/detail-panel.js` | Modify (import changes + call site rewiring) | No computation — uses bridge |
| `src/renderer/modules/skills.js` | Modify (import changes + call site rewiring) | No computation — uses bridge |
| `src/renderer/modules/comps/comp-boon-coverage.js` | Modify (import change) | Uses bridge for `computeBuildConcentration` |

---

### Task 1: Upgrade engine-bridge.js to Production Bridge

Convert `engine-bridge.js` from a dev-only validation module into the production bridge. Delete validators, add computation wrappers and constant re-exports.

**Files:**
- Modify: `src/renderer/modules/engine-bridge.js`

- [ ] **Step 1: Replace engine-bridge.js contents**

Replace the entire file with this production bridge:

```js
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
```

- [ ] **Step 2: Verify production build succeeds**

Run: `npm run build:renderer`
Expected: Build succeeds (validation code no longer imported anywhere yet — that's fine, the call sites still import the old validators but we'll fix those in Tasks 3-5)

Note: The build may fail because the old imports from `engine-bridge.js` (`validateStatResult`, `validateBoonResult`) no longer exist. That's expected — we fix those imports in Tasks 3-5. If the build fails here, that's OK; proceed to the next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/engine-bridge.js
git commit -m "feat: convert engine-bridge to production bridge with computation wrappers"
```

---

### Task 2: Gut stats.js — Delete Core Computation, Keep UI Functions

Delete all core computation functions from `stats.js` (lines 1–629). Keep `computeStatBreakdown()` and `computeUpgradeModifiers()`, rewiring them to use the engine bridge. Add thin wrappers for functions still needed by other modules.

**Files:**
- Modify: `src/renderer/modules/stats.js`

- [ ] **Step 1: Replace stats.js contents**

Replace the entire file. The new file keeps only `computeStatBreakdown()`, `computeUpgradeModifiers()`, and thin wrappers:

```js
// Equipment stat display — UI-only functions that consume engine results.
// Core computation lives in @axi/gw2-data/engine, accessed via engine-bridge.js.
import { state } from "./state.js";
import {
  STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, TWO_HAND_WEIGHTS,
  STACKING_SIGIL_DEFS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  AQUATIC_SLOTS, LAND_ONLY_SLOTS,
} from "./engine-bridge.js";
import { GW2_WEAPONS_BY_ID, getEffectiveStats } from "./constants.js";
import {
  computeStats,
  computeSlotStatsFromState,
  computeFuryStatBonuses as bridgeFuryStatBonuses,
  computeMightPerStack as bridgeMightPerStack,
  computeBuildConcentration as bridgeBuildConcentration,
} from "./engine-bridge.js";

/**
 * Thin wrapper: computeSlotStats(comboLabel, slotKey)
 * Delegates to engine via bridge, preserving the old 2-arg signature
 * used by equipment.js and roleEstimator.js.
 */
export function computeSlotStats(comboLabel, slotKey) {
  return computeSlotStatsFromState(state, comboLabel, slotKey);
}

/**
 * Thin wrapper: computeBuildConcentration(build, upgradeCatalog)
 * Used by comp-boon-coverage.js for party comp displays.
 */
export function computeBuildConcentration(build, upgradeCatalog) {
  return bridgeBuildConcentration(build, upgradeCatalog);
}

/**
 * Excluded slots helper — returns set of slot keys to skip based on
 * underwater mode and active weapon set.
 */
function getExcludedSlots() {
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const activeSet = Number(state.editor.activeWeaponSet) || 1;
  const excluded = new Set(isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS);
  if (!isUnderwater) {
    if (activeSet === 1) { excluded.add("mainhand2"); excluded.add("offhand2"); }
    else { excluded.add("mainhand1"); excluded.add("offhand1"); }
  }
  return excluded;
}

/**
 * Compute a detailed breakdown of all sources contributing to a given stat key.
 * Returns an array of { source: string, value: number } entries.
 * This is a UI-only function for hover tooltips.
 */
export function computeStatBreakdown(statKey, assumedBoons = null, sigilStacks = null) {
  const entries = [];
  const BASE_STATS = new Set(["Power", "Precision", "Toughness", "Vitality"]);
  if (BASE_STATS.has(statKey)) entries.push({ source: "Base", value: 1000 });

  const slots = state.editor.equipment?.slots || {};
  const EXCLUDED_SLOTS = getExcludedSlots();
  const SLOT_LABELS = {
    head: "Head", shoulders: "Shoulders", chest: "Chest", hands: "Hands", legs: "Legs", feet: "Feet",
    mainhand1: "Mainhand 1", offhand1: "Offhand 1", mainhand2: "Mainhand 2", offhand2: "Offhand 2",
    back: "Back", amulet: "Amulet", ring1: "Ring 1", ring2: "Ring 2", accessory1: "Accessory 1", accessory2: "Accessory 2",
    breather: "Breather", aquatic1: "Aquatic 1", aquatic2: "Aquatic 2",
  };

  // Equipment slots
  const weapons = state.editor.equipment?.weapons || {};
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel || EXCLUDED_SLOTS.has(slotKey)) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    let w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    if (slotKey.startsWith("mainhand") && GW2_WEAPONS_BY_ID.get(weapons[slotKey])?.hand === "two") {
      w = TWO_HAND_WEIGHTS;
    }
    const n = combo.stats.length;
    let val = 0;
    if (n <= 3) {
      if (combo.stats[0] === statKey) val = w.p;
      else if (combo.stats.includes(statKey)) val = w.s;
    } else if (n === 4) {
      const idx = combo.stats.indexOf(statKey);
      if (idx === 0 || idx === 1) val = w.p4;
      else if (idx === 2 || idx === 3) val = w.s4;
    } else {
      if (combo.stats.includes(statKey)) val = w.c;
    }
    if (val) {
      const weaponName = weapons[slotKey] || "";
      const label = weaponName
        ? `${SLOT_LABELS[slotKey] || slotKey} — ${weaponName} (${comboLabel})`
        : `${SLOT_LABELS[slotKey] || slotKey} (${comboLabel})`;
      entries.push({ source: label, value: val, slotKey });
    }
  }

  const upgradeCatalog = state.upgradeCatalog;

  // Food
  const foodId = state.editor.equipment?.food;
  if (foodId && upgradeCatalog) {
    const foodDef = upgradeCatalog.foodById?.get(Number(foodId));
    if (foodDef) {
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Attributes)/g;
      const MAP = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower", "Healing": "HealingPower" };
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        if (m[2] === "to All Attributes") {
          entries.push({ source: `Food (${foodDef.name})`, value: Number(m[1]), icon: foodDef.icon });
        } else {
          const key = MAP[m[2]] || m[2];
          if (key === statKey) entries.push({ source: `Food (${foodDef.name})`, value: Number(m[1]), icon: foodDef.icon });
        }
      }
    }
  }

  // Infusions
  if (upgradeCatalog) {
    const toStatKey = (attr) => attr === "Healing" ? "HealingPower" : attr === "BoonDuration" ? "Concentration" : attr === "ConditionDuration" ? "Expertise" : attr;
    const infusions = state.editor.equipment?.infusions || {};
    const allInfusions = Object.entries(infusions)
      .filter(([k]) => !EXCLUDED_SLOTS.has(k))
      .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
    for (const id of allInfusions) {
      if (!id) continue;
      const def = upgradeCatalog.infusionById?.get(Number(id));
      if (!def?.infixUpgrade?.attributes) continue;
      for (const attr of def.infixUpgrade.attributes) {
        if (toStatKey(attr.attribute) === statKey && attr.modifier) {
          entries.push({ source: `Infusion (${def.name})`, value: attr.modifier, icon: def.icon });
        }
      }
    }

    // Enrichment
    const enrichmentId = state.editor.equipment?.enrichment;
    if (enrichmentId) {
      const def = upgradeCatalog.enrichmentById?.get(Number(enrichmentId));
      if (def?.infixUpgrade?.attributes) {
        for (const attr of def.infixUpgrade.attributes) {
          if (toStatKey(attr.attribute) === statKey && attr.modifier) {
            entries.push({ source: `Enrichment (${def.name})`, value: attr.modifier, icon: def.icon });
          }
        }
      }
    }

    // Runes
    const RUNE_BONUS_RE = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats)/;
    const MAP = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower", "Healing": "HealingPower" };
    const runes = state.editor.equipment?.runes || {};
    const runeCounts = new Map();
    for (const [slot, id] of Object.entries(runes)) {
      if (!id || EXCLUDED_SLOTS.has(slot)) continue;
      runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
    }
    for (const [runeId, count] of runeCounts) {
      const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
      if (!runeDef?.bonuses?.length) continue;
      const activeBonuses = runeDef.bonuses.slice(0, Math.min(count, 6));
      let runeTotal = 0;
      for (const bonus of activeBonuses) {
        const m = RUNE_BONUS_RE.exec(bonus);
        if (!m) continue;
        const val = Number(m[1]);
        if (m[2] === "to All Stats") runeTotal += val;
        else { const key = MAP[m[2]] || m[2]; if (key === statKey) runeTotal += val; }
      }
      if (runeTotal) entries.push({ source: `Rune (${runeDef.name})`, value: runeTotal, icon: runeDef.icon });
    }
  }

  // Utility
  const utilityId = state.editor.equipment?.utility;
  if (utilityId && upgradeCatalog) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(utilityId));
    if (utilDef) {
      const MAP = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower" };
      // Percentage conversions — use engine totals for source stats
      const totals = computeStats(state, assumedBoons, sigilStacks).total;
      const convRe = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = convRe.exec(utilDef.buff)) !== null) {
        const targetKey = MAP[m[1]] || m[1];
        if (targetKey !== statKey) continue;
        const pct = Number(m[2]) / 100;
        const sourceKey = MAP[m[3]] || m[3];
        const sourceBase = (totals[sourceKey] || 0);
        const val = Math.round(sourceBase * pct);
        if (val) entries.push({ source: `${utilDef.name} (${m[2]}% of ${m[3]})`, value: val });
      }
      // Conditional flat (writs)
      const writRe = /Gain (\d+) (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) When Health/g;
      while ((m = writRe.exec(utilDef.buff)) !== null) {
        const key = MAP[m[2]] || m[2];
        if (key === statKey) entries.push({ source: `${utilDef.name}`, value: Number(m[1]) });
      }
      // Flat bonuses
      const flatRe = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) {
        const key = MAP[m[2]] || m[2];
        if (key === statKey) entries.push({ source: `${utilDef.name}`, value: Number(m[1]) });
      }
    }
  }

  // Assumed boon contributions
  if (assumedBoons) {
    const mightStacks = assumedBoons.might || 0;
    if (mightStacks > 0) {
      const mightValues = bridgeMightPerStack(state);
      if (statKey === "Power") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * mightValues.power });
      }
      if (statKey === "ConditionDamage") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * mightValues.condi });
      }
    }
    if (assumedBoons.fury) {
      const furyBonuses = bridgeFuryStatBonuses(state);
      if (furyBonuses[statKey]) {
        entries.push({ source: "Boon (Fury)", value: furyBonuses[statKey] });
      }
    }
  }

  // Passive trait flat stat bonuses — derive from engine result
  const engineResult = computeStats(state, assumedBoons, sigilStacks);
  if (engineResult.traits[statKey]) {
    entries.push({ source: "Trait bonus", value: engineResult.traits[statKey] });
  }

  // Trait conversion contributions
  if (engineResult.conversions[statKey]) {
    entries.push({ source: "Trait conversion", value: engineResult.conversions[statKey] });
  }

  // Stacking sigil contributions
  if (sigilStacks) {
    for (const def of STACKING_SIGIL_DEFS) {
      const stacks = sigilStacks[def.key] || 0;
      if (stacks <= 0) continue;
      const matches = def.allStats ? def.allStats.includes(statKey) : def.stat === statKey;
      if (matches) {
        entries.push({ source: `Sigil (${def.label} ×${stacks})`, value: stacks * def.perStack });
      }
    }
  }

  return entries;
}

/**
 * Collect non-attribute modifiers from equipped upgrades (rune %, sigil buffs, etc.).
 * Returns a Map of modifier text → total value.
 * This is a UI-only function — reads directly from state and upgrade catalog.
 */
export function computeUpgradeModifiers() {
  const modifiers = new Map();
  const addMod = (label, value) => modifiers.set(label, (modifiers.get(label) || 0) + value);

  const upgradeCatalog = state.upgradeCatalog;
  if (!upgradeCatalog) return modifiers;

  const PCT_RE = /\+(\d+)%\s+(.+)/;
  const FLAT_STAT_RE = /\+\d+\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats|to All Attributes)/;

  const EXCLUDED_SLOTS = getExcludedSlots();

  // Rune percentage modifiers
  const runes = state.editor.equipment?.runes || {};
  const runeCounts = new Map();
  for (const [slot, id] of Object.entries(runes)) {
    if (!id || EXCLUDED_SLOTS.has(slot)) continue;
    runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
  }
  for (const [runeId, count] of runeCounts) {
    const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
    if (!runeDef?.bonuses?.length) continue;
    const activeBonuses = runeDef.bonuses.slice(0, Math.min(count, 6));
    for (const bonus of activeBonuses) {
      if (FLAT_STAT_RE.test(bonus)) continue;
      const m = PCT_RE.exec(bonus);
      if (m) addMod(m[2], Number(m[1]));
    }
  }

  // Sigil buff modifiers
  const sigils = state.editor.equipment?.sigils || {};
  const isUnderwater = Boolean(state.editor.underwaterMode);
  let activeSigilIds;
  if (isUnderwater) {
    const aquaticSet = (Number(state.editor.activeWeaponSet) || 1) === 2 ? "aquatic2" : "aquatic1";
    activeSigilIds = [...(Array.isArray(sigils[aquaticSet]) ? sigils[aquaticSet] : [])].filter(Boolean);
  } else {
    const activeSet = Number(state.editor.activeWeaponSet) || 1;
    const mhKey = activeSet === 2 ? "mainhand2" : "mainhand1";
    const ohKey = activeSet === 2 ? "offhand2" : "offhand1";
    activeSigilIds = [
      ...(Array.isArray(sigils[mhKey]) ? sigils[mhKey] : []),
      ...(Array.isArray(sigils[ohKey]) ? sigils[ohKey] : []),
    ].filter(Boolean);
  }
  for (const sigilId of activeSigilIds) {
    const def = upgradeCatalog.sigilById?.get(Number(sigilId));
    const desc = def?.buffDescription || "";
    const m = PCT_RE.exec(desc);
    if (m) addMod(m[2], Number(m[1]));
  }

  // Infusion buff modifiers
  const infusions = state.editor.equipment?.infusions || {};
  const allInfusionIds = Object.entries(infusions)
    .filter(([k]) => !EXCLUDED_SLOTS.has(k))
    .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
  for (const id of allInfusionIds) {
    if (!id) continue;
    const def = upgradeCatalog.infusionById?.get(Number(id));
    const desc = def?.buffDescription || "";
    for (const line of desc.split("\n")) {
      const m = PCT_RE.exec(line.trim());
      if (m) addMod(m[2], Number(m[1]));
    }
  }

  // Enrichment buff modifiers
  const enrichmentId = state.editor.equipment?.enrichment;
  if (enrichmentId) {
    const def = upgradeCatalog.enrichmentById?.get(Number(enrichmentId));
    const desc = def?.buffDescription || "";
    for (const line of desc.split("\n")) {
      const m = PCT_RE.exec(line.trim());
      if (m) addMod(m[2], Number(m[1]));
    }
  }

  // Food percentage modifiers
  const foodId = state.editor.equipment?.food;
  if (foodId) {
    const foodDef = upgradeCatalog.foodById?.get(Number(foodId));
    if (foodDef?.buff) {
      for (const segment of foodDef.buff.split(" | ")) {
        if (FLAT_STAT_RE.test(segment)) continue;
        const m = PCT_RE.exec(segment.trim());
        if (m) addMod(m[2], Number(m[1]));
      }
    }
  }

  // Utility percentage modifiers
  const utilityId = state.editor.equipment?.utility;
  if (utilityId) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(utilityId));
    if (utilDef?.buff) {
      for (const segment of utilDef.buff.split(" | ")) {
        if (FLAT_STAT_RE.test(segment)) continue;
        const m = PCT_RE.exec(segment.trim());
        if (m) addMod(m[2], Number(m[1]));
      }
    }
  }

  // Burst Recharge from traits
  const catalog = state.activeCatalog;
  if (catalog?.traitById) {
    // Collect active trait IDs from state
    const activeIds = new Set();
    for (const spec of state.editor.specializations || []) {
      for (const id of Object.values(spec?.majorChoices || {})) {
        const n = Number(id);
        if (n) activeIds.add(n);
      }
      const specId = Number(spec?.specializationId || spec?.id) || 0;
      const specData = specId ? catalog.specializationById?.get(specId) : null;
      for (const minorId of specData?.minorTraits || []) {
        if (minorId) activeIds.add(Number(minorId));
      }
    }
    for (const traitId of activeIds) {
      const trait = catalog.traitById.get(traitId);
      if (!trait || trait.slot !== "Minor") continue;
      // Primal Rage (1831): API omits the 10% burst recharge reduction fact
      if (traitId === 1831) {
        addMod("Burst Recharge", 10);
        continue;
      }
      const desc = (trait.description || "").toLowerCase();
      if (!desc.includes("burst")) continue;
      for (const fact of trait.facts || []) {
        if (fact.type === "Percent" && fact.text === "Recharge Reduced" && fact.percent > 0) {
          addMod("Burst Recharge", fact.percent);
        }
      }
    }
  }

  return modifiers;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/stats.js
git commit -m "refactor: gut stats.js — delete core computation, keep UI breakdown functions"
```

---

### Task 3: Gut boon-coverage.js — Delete Core, Keep Party Wrapper

Delete all core boon computation from `boon-coverage.js`. Keep only `computePartyCoverage()`, rewired to use the engine bridge.

**Files:**
- Modify: `src/renderer/modules/boon-coverage.js`

- [ ] **Step 1: Replace boon-coverage.js contents**

```js
// Boon coverage — party-level aggregation wrapper.
// Core boon computation lives in @axi/gw2-data/engine, accessed via engine-bridge.js.
import { computeBoons, computeCombos } from "./engine-bridge.js";
import { state } from "./state.js";

/**
 * Compute full party coverage for a single build: boons, conditions, combo fields, finishers.
 * Delegates core boon/condition computation to the engine.
 */
export function computePartyCoverage(catalog, editor, weaponSkills = []) {
  // Build a temporary state object for the bridge functions.
  // The bridge needs state.editor and state.activeCatalog/upgradeCatalog.
  const bridgeState = {
    editor,
    activeCatalog: catalog,
    upgradeCatalog: state.upgradeCatalog || {},
  };

  const { boons, conditions } = computeBoons(bridgeState, weaponSkills);
  const { fields: comboFields, finishers: comboFinishers } = computeCombos(bridgeState, weaponSkills);

  return { boons, conditions, comboFields, comboFinishers };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/boon-coverage.js
git commit -m "refactor: gut boon-coverage.js — delegate to engine, keep party wrapper"
```

---

### Task 4: Delete Duplicated Constants

Remove constants from `constants.js` that are now imported from the engine via `engine-bridge.js`.

**Files:**
- Modify: `src/renderer/modules/constants.js`

- [ ] **Step 1: Identify and delete duplicated constants**

Delete these constants from `constants.js` (they are now re-exported from `engine-bridge.js`):

- `MIGHT_POWER_PER_STACK` (line 548)
- `MIGHT_CONDI_PER_STACK` (line 549)
- `FURY_CRIT_CHANCE` (line 551)
- `FURY_CRIT_CHANCE_WVW` (line 552)
- `BUFF_FACT_TYPES` (line 545)
- `STACKING_SIGIL_DEFS` (line 559–569)
- `STACKING_SIGIL_IDS` (line 570–571)
- `SIGNET_PASSIVE_BUFFS` (line 575–596)
- `BOON_NAMES` (line 598–601)
- `CONDITION_NAMES` (line 603–608)
- `CONDITION_NAME_NORMALIZE` (line 610–613)

Also delete from the `export` block at the bottom of `constants.js` any references to these deleted constants.

Do NOT delete:
- `BOON_CONDITION_ICONS` — UI icons
- `BOON_DISPLAY_ORDER` — UI display order
- `MIGHT_MAX_STACKS`, `STABILITY_MAX_STACKS` — UI display constants for boon pickers
- `STAT_COMBOS`, `STAT_COMBOS_BY_LABEL`, `SLOT_WEIGHTS`, `TWO_HAND_WEIGHTS` — still used by `stats.js` (imported from bridge, but `constants.js` may have other consumers)
- Any weapon/armor/profession constants

**Important:** Check which other renderer modules import the deleted constants from `constants.js`. Those imports must be updated to import from `engine-bridge.js` instead. Key files to check:
- `equipment.js` imports `MIGHT_POWER_PER_STACK`, `MIGHT_CONDI_PER_STACK`, `FURY_CRIT_CHANCE`, `FURY_CRIT_CHANCE_WVW`, `STACKING_SIGIL_DEFS`
- `detail-panel.js` imports `BUFF_FACT_TYPES`
- `stats.js` — already handled in Task 2 (imports from bridge)

- [ ] **Step 2: Update imports in equipment.js**

Change the constants import in `equipment.js` (line 9) to remove deleted constants. Add an import from `engine-bridge.js` for those same constants:

```js
// Remove from constants.js import:
// FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW, MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK, STACKING_SIGIL_DEFS

// Add to engine-bridge.js import:
import { ..., FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW, MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK, STACKING_SIGIL_DEFS } from "./engine-bridge.js";
```

- [ ] **Step 3: Update imports in detail-panel.js**

Change `BUFF_FACT_TYPES` import from `constants.js` to `engine-bridge.js`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/constants.js src/renderer/modules/equipment.js src/renderer/modules/detail-panel.js
git commit -m "refactor: delete duplicated constants, import from engine bridge"
```

---

### Task 5: Rewire equipment.js Call Sites

Replace all `computeEquipmentStats()` and `computeBoonCoverage()` calls in `equipment.js` with engine bridge calls. Remove validation guards. Update imports.

**Files:**
- Modify: `src/renderer/modules/equipment.js`

- [ ] **Step 1: Update imports**

Replace the import block (lines 13, 20-21, 23):

```js
// OLD:
import { computeSlotStats, computeEquipmentStats, computeUpgradeModifiers, computeStatBreakdown, computeTraitConversions, computeFuryCritModifier, computeFuryStatBonuses, computeMightPerStack } from "./stats.js";
import { computeBoonCoverage } from "./boon-coverage.js";
import { validateStatResult, validateBoonResult } from "./engine-bridge.js";

export { computeSlotStats, computeEquipmentStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";

// NEW:
import { computeSlotStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";
import { computeStats, computeBoons, computeFuryCritModifier, computeFuryStatBonuses, computeMightPerStack } from "./engine-bridge.js";

export { computeSlotStats, computeUpgradeModifiers, computeStatBreakdown } from "./stats.js";
export { computeStats } from "./engine-bridge.js";
```

- [ ] **Step 2: Rewire updateHealthOrb() (~line 311)**

```js
// OLD:
const computed = computeEquipmentStats();
if (process.env.NODE_ENV !== "production") {
  validateStatResult(computed, state, "equipment.js:updateHealthOrb");
}
const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;

// NEW:
const result = computeStats(state);
const totalHp = baseHp > 0 ? baseHp + (result.total.Vitality || 0) * 10 : 0;
```

- [ ] **Step 3: Rewire boon coverage (~line 1050)**

```js
// OLD:
const coverage = computeBoonCoverage(catalog, state.editor, weaponSkills);
if (process.env.NODE_ENV !== "production") {
  validateBoonResult(coverage, state, "equipment.js:boonCoverage", catalog, state.editor, weaponSkills);
}

// NEW:
const coverage = computeBoons(state, weaponSkills);
```

- [ ] **Step 4: Rewire renderStats (~line 1491)**

```js
// OLD:
const computed = computeEquipmentStats(_assumedBoons, _sigilStacks);
if (process.env.NODE_ENV !== "production") {
  validateStatResult(computed, state, "equipment.js:renderStats", _assumedBoons, _sigilStacks);
}
const traitBonuses = computeTraitConversions(computed);
...
const health = baseHP + (computed.Vitality || 0) * 10;
...
const furyCritPct = (gm === "wvw" ? FURY_CRIT_CHANCE_WVW : FURY_CRIT_CHANCE) + computeFuryCritModifier(gm);
...

// NEW:
const result = computeStats(state, _assumedBoons, _sigilStacks);
const computed = result.total;
const traitBonuses = result.conversions;
...
const health = baseHP + (computed.Vitality || 0) * 10;
...
const furyCritPct = (gm === "wvw" ? FURY_CRIT_CHANCE_WVW : FURY_CRIT_CHANCE) + computeFuryCritModifier(state);
...
```

- [ ] **Step 5: Rewire computeMightPerStack and computeFuryStatBonuses calls**

These are used in `buildBoonTooltipHTML()` (~lines 1221 and 1235). Change from no-arg calls to passing `state`:

```js
// OLD:
const mightValues = computeMightPerStack();
const furyPct = ... + computeFuryCritModifier(gm);
const furyStats = computeFuryStatBonuses(gm);

// NEW:
const mightValues = computeMightPerStack(state);
const furyPct = ... + computeFuryCritModifier(state);
const furyStats = computeFuryStatBonuses(state);
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "refactor: rewire equipment.js to use engine bridge"
```

---

### Task 6: Rewire detail-panel.js Call Sites

Replace `computeEquipmentStats()` calls with `computeStats()`. Remove validation guards.

**Files:**
- Modify: `src/renderer/modules/detail-panel.js`

- [ ] **Step 1: Update imports**

```js
// OLD:
import { computeEquipmentStats, computeUpgradeModifiers } from "./stats.js";
import { validateStatResult } from "./engine-bridge.js";

// NEW:
import { computeUpgradeModifiers } from "./stats.js";
import { computeStats } from "./engine-bridge.js";
```

- [ ] **Step 2: Rewire selectDetail (~line 91)**

```js
// OLD:
const computed = computeEquipmentStats();
if (process.env.NODE_ENV !== "production") {
  validateStatResult(computed, state, "detail-panel.js:selectDetail");
}
const power = computed.Power || 1000;
const precision = computed.Precision || 1000;
const ferocity = computed.Ferocity || 0;

// NEW:
const computed = computeStats(state).total;
const power = computed.Power || 1000;
const precision = computed.Precision || 1000;
const ferocity = computed.Ferocity || 0;
```

- [ ] **Step 3: Rewire showHoverPreview (~line 379)**

```js
// OLD:
const computed = computeEquipmentStats();
if (process.env.NODE_ENV !== "production") {
  validateStatResult(computed, state, "detail-panel.js:showHoverPreview");
}
const power = computed.Power || 1000;
const precision = computed.Precision || 1000;
const ferocity = computed.Ferocity || 0;

// NEW:
const computed = computeStats(state).total;
const power = computed.Power || 1000;
const precision = computed.Precision || 1000;
const ferocity = computed.Ferocity || 0;
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/detail-panel.js
git commit -m "refactor: rewire detail-panel.js to use engine bridge"
```

---

### Task 7: Rewire skills.js Call Sites

Replace `computeEquipmentStats()` and `computeBoonCoverage()` calls with engine bridge calls. Remove validation guards.

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Update imports**

```js
// OLD:
import { computeEquipmentStats } from "./stats.js";
import { computeBoonCoverage } from "./boon-coverage.js";
import { validateStatResult, validateBoonResult } from "./engine-bridge.js";

// NEW:
import { computeStats, computeBoons } from "./engine-bridge.js";
```

- [ ] **Step 2: Rewire _renderBoonCoverage (~line 1057)**

```js
// OLD:
const coverage = computeBoonCoverage(catalog, editor, weaponSkills);
if (process.env.NODE_ENV !== "production") {
  validateBoonResult(coverage, state, "skills.js:renderBoonCoverage", catalog, editor, weaponSkills);
}

// NEW:
const coverage = computeBoons(state, weaponSkills);
```

- [ ] **Step 3: Rewire _renderSkillBar (~line 1778)**

```js
// OLD:
const computed = computeEquipmentStats();
if (process.env.NODE_ENV !== "production") {
  validateStatResult(computed, state, "skills.js:renderSkillBar");
}
const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;

// NEW:
const result = computeStats(state);
const totalHp = baseHp > 0 ? baseHp + (result.total.Vitality || 0) * 10 : 0;
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "refactor: rewire skills.js to use engine bridge"
```

---

### Task 8: Update comp-boon-coverage.js Import

Update the `computeBuildConcentration` import to come from the new location.

**Files:**
- Modify: `src/renderer/modules/comps/comp-boon-coverage.js`

- [ ] **Step 1: Update import**

```js
// OLD:
import { computeBuildConcentration } from "../stats.js";

// NEW:
import { computeBuildConcentration } from "../stats.js";
```

Actually, `computeBuildConcentration` is still exported from `stats.js` as a thin wrapper (see Task 2). No import change needed — the export path is unchanged. Verify this is the case.

- [ ] **Step 2: Verify no other broken imports**

Run: `npm run build:renderer`
Expected: Build succeeds with no unresolved imports.

- [ ] **Step 3: Commit (if any changes were needed)**

---

### Task 9: Build Verification and Smoke Test

Verify the full build succeeds, all tests pass, and the production bundle doesn't contain old computation code.

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose 2>&1 | tail -15`
Expected: All tests pass (1554+)

- [ ] **Step 2: Build renderer**

Run: `npm run build:renderer`
Expected: Build succeeds

- [ ] **Step 3: Verify old code is gone from bundle**

Run: `grep -c "computeTraitConversions\|computeFuryCritModifier\|collectActiveTraitIds\|computePassiveTraitBonuses\|isFuryTrait\|extractBuffFacts\|extractComboFields\|computeBoonCoverage\|normalizeName" dist/renderer/assets/index-*.js`
Expected: 0 (none of the deleted function names appear in the production bundle)

- [ ] **Step 4: Build site**

Run: `npm run build:site`
Expected: Build succeeds

- [ ] **Step 5: Verify validation code is gone**

Run: `grep -c "ENGINE-MISMATCH\|validateStatResult\|validateBoonResult" dist/renderer/assets/index-*.js`
Expected: 0

- [ ] **Step 6: Line count comparison**

Run: `wc -l src/renderer/modules/stats.js src/renderer/modules/boon-coverage.js src/renderer/modules/engine-bridge.js`
Expected: `stats.js` ~360 lines (down from 991), `boon-coverage.js` ~25 lines (down from 427), `engine-bridge.js` ~220 lines (up from 161)
