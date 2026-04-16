// Equipment stat display — UI-only functions that consume engine results.
// Core computation lives in @axiapps/gw2-data/engine, accessed via engine-bridge.js.
import { state } from "./state.js";
import {
  STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, TWO_HAND_WEIGHTS,
  STACKING_SIGIL_DEFS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  AQUATIC_SLOTS, LAND_ONLY_SLOTS,
  SIGNET_PASSIVE_BUFFS,
  SIGNET_ACTIVE_EFFECTS,
} from "./engine-bridge.js";
import { GW2_WEAPONS_BY_ID, getEffectiveStats } from "./constants.js";
import {
  computeStats,
  computeSlotStatsFromState,
  computeFuryCritModifier as bridgeFuryCritModifier,
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
 * Thin wrapper preserving old API: computeEquipmentStats(assumedBoons?, sigilStacks?) → flat totals.
 * Used by tests and any remaining call sites.
 */
export function computeEquipmentStats(assumedBoons = null, sigilStacks = null) {
  return computeStats(state, assumedBoons, sigilStacks).total;
}

/**
 * Thin wrapper: computeTraitConversions(baseStats) → { stat: amount }.
 * Computes trait conversion contributions given baseline stats.
 */
export function computeTraitConversions(baseStats) {
  const result = computeStats(state);
  return _stripZeros(result.conversions || {});
}

/**
 * Thin wrapper: computeFuryCritModifier(gameMode?) → number.
 * Returns bonus crit % from Fury-related traits.
 */
export function computeFuryCritModifier(gameMode) {
  if (gameMode) state.editor.gameMode = gameMode;
  return bridgeFuryCritModifier(state);
}

/**
 * Thin wrapper: computeFuryStatBonuses(gameMode?) → { stat: amount }.
 */
export function computeFuryStatBonuses(gameMode) {
  if (gameMode) state.editor.gameMode = gameMode;
  return bridgeFuryStatBonuses(state);
}

/**
 * Thin wrapper: computeMightPerStack() → { power, condi }.
 */
export function computeMightPerStack() {
  return bridgeMightPerStack(state);
}

/**
 * Thin wrapper: computePassiveTraitBonuses(gameMode?) → { stat: amount }.
 * Returns flat stat bonuses from non-Fury passive traits.
 */
export function computePassiveTraitBonuses(gameMode) {
  if (gameMode) state.editor.gameMode = gameMode;
  const result = computeStats(state);
  return _stripZeros(result.traits || {});
}

/** Remove zero-valued entries to match legacy sparse-object API */
function _stripZeros(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Excluded slots helper — returns set of slot keys to skip based on
 * underwater mode and active weapon set.
 */
function getExcludedSlots() {
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const activeSet = Number(state.editor.activeWeaponSet) || 1;
  const excluded = new Set(isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS);
  if (isUnderwater) {
    excluded.add(activeSet === 2 ? "aquatic1" : "aquatic2");
  } else {
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
export function computeStatBreakdown(statKey, assumedBoons = null, sigilStacks = null, activeSignets = null) {
  const entries = [];
  const BASE_STATS = new Set(["Power", "Precision", "Toughness", "Vitality"]);
  if (BASE_STATS.has(statKey)) entries.push({ source: "Base", value: 1000, category: "base" });

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
      entries.push({ source: label, value: val, slotKey, category: "equipment" });
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
          entries.push({ source: `Food (${foodDef.name})`, value: Number(m[1]), icon: foodDef.icon, category: "food" });
        } else {
          const key = MAP[m[2]] || m[2];
          if (key === statKey) entries.push({ source: `Food (${foodDef.name})`, value: Number(m[1]), icon: foodDef.icon, category: "food" });
        }
      }
    }
  }

  // Infusions — cap mainhand weapon slots to 1 infusion for 1H weapons (issue #201)
  if (upgradeCatalog) {
    const toStatKey = (attr) => attr === "Healing" ? "HealingPower" : attr === "BoonDuration" ? "Concentration" : attr === "ConditionDuration" ? "Expertise" : attr;
    const infusions = state.editor.equipment?.infusions || {};
    const TWO_HAND_TYPES = new Set(["greatsword", "hammer", "longbow", "shortbow", "rifle", "staff", "spear", "trident", "harpoon-gun"]);
    const allInfusions = Object.entries(infusions)
      .filter(([k]) => !EXCLUDED_SLOTS.has(k))
      .flatMap(([slotKey, v]) => {
        const ids = Array.isArray(v) ? v : [v];
        if (slotKey.startsWith("mainhand") && !slotKey.startsWith("aquatic")) {
          const weaponType = weapons[slotKey] || "";
          if (weaponType && !TWO_HAND_TYPES.has(weaponType)) return ids.slice(0, 1);
        }
        return ids;
      });
    for (const id of allInfusions) {
      if (!id) continue;
      const def = upgradeCatalog.infusionById?.get(Number(id));
      if (!def?.infixUpgrade?.attributes) continue;
      for (const attr of def.infixUpgrade.attributes) {
        if (toStatKey(attr.attribute) === statKey && attr.modifier) {
          entries.push({ source: `Infusion (${def.name})`, value: attr.modifier, icon: def.icon, category: "infusion" });
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
            entries.push({ source: `Enrichment (${def.name})`, value: attr.modifier, icon: def.icon, category: "enrichment" });
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
      if (runeTotal) entries.push({ source: `Rune (${runeDef.name})`, value: runeTotal, icon: runeDef.icon, category: "rune" });
    }
  }

  // Utility
  const utilityId = state.editor.equipment?.utility;
  if (utilityId && upgradeCatalog) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(utilityId));
    if (utilDef) {
      const MAP = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower" };
      // Percentage conversions — use engine totals for source stats
      const totals = computeStats(state, assumedBoons, sigilStacks, activeSignets).total;
      const convRe = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = convRe.exec(utilDef.buff)) !== null) {
        const targetKey = MAP[m[1]] || m[1];
        if (targetKey !== statKey) continue;
        const pct = Number(m[2]) / 100;
        const sourceKey = MAP[m[3]] || m[3];
        const sourceBase = (totals[sourceKey] || 0);
        const val = Math.round(sourceBase * pct);
        if (val) entries.push({ source: `${utilDef.name} (${m[2]}% of ${m[3]})`, value: val, category: "utility" });
      }
      // Conditional flat (writs)
      const writRe = /Gain (\d+) (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) When Health/g;
      while ((m = writRe.exec(utilDef.buff)) !== null) {
        const key = MAP[m[2]] || m[2];
        if (key === statKey) entries.push({ source: `${utilDef.name}`, value: Number(m[1]), category: "utility" });
      }
      // Flat bonuses
      const flatRe = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) {
        const key = MAP[m[2]] || m[2];
        if (key === statKey) entries.push({ source: `${utilDef.name}`, value: Number(m[1]), category: "utility" });
      }
    }
  }

  // Signet passive / active buffs
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const skills = isUnderwater ? (state.editor.underwaterSkills || {}) : (state.editor.skills || {});
  const signetSkillIds = [
    skills.healId,
    ...(skills.utilityIds || []),
    skills.eliteId,
  ].filter(Boolean).map(Number);
  const getSignetState = (id) => {
    if (!activeSignets) return "passive";
    const v = activeSignets instanceof Map ? activeSignets.get(id) : activeSignets[id];
    if (v === "active")   return "active";
    if (v === "cooldown" || v === false) return "cooldown";
    return "passive";
  };
  for (const skillId of signetSkillIds) {
    const catalog = state.activeCatalog;
    const skillData = catalog?.skillById?.get(skillId);
    const name = skillData?.name || `Signet (${skillId})`;
    const sigState = getSignetState(skillId);
    // Passive contribution
    if (sigState === "passive") {
      const buff = SIGNET_PASSIVE_BUFFS.get(skillId);
      if (buff && buff.stat === statKey) {
        entries.push({ source: `Signet (${name})`, value: buff.value, icon: skillData?.icon, category: "skill" });
      }
    }
    // Active-effect direct stat contribution
    if (sigState === "active") {
      const active = SIGNET_ACTIVE_EFFECTS.get(skillId);
      if (active?.stats?.[statKey]) {
        entries.push({ source: `Signet Active (${name})`, value: active.stats[statKey], icon: skillData?.icon, category: "skill" });
      }
    }
  }

  // Assumed boon contributions (including boons from activated signet actives)
  const engineResult = computeStats(state, assumedBoons, sigilStacks, activeSignets);
  const sigActBoons = engineResult.signetActiveBoons || { might: 0, fury: false };
  {
    const mightStacks = (assumedBoons?.might || 0) + sigActBoons.might;
    if (mightStacks > 0) {
      const mightValues = bridgeMightPerStack(state);
      if (statKey === "Power") {
        const assumedPart = (assumedBoons?.might || 0) * mightValues.power;
        const signetPart = sigActBoons.might * mightValues.power;
        if (assumedPart > 0) entries.push({ source: `Boon (Might ×${assumedBoons.might})`, value: assumedPart, category: "boon" });
        if (signetPart > 0)  entries.push({ source: `Signet Active (Might ×${sigActBoons.might})`, value: signetPart, category: "boon" });
      }
      if (statKey === "ConditionDamage") {
        const assumedPart = (assumedBoons?.might || 0) * mightValues.condi;
        const signetPart = sigActBoons.might * mightValues.condi;
        if (assumedPart > 0) entries.push({ source: `Boon (Might ×${assumedBoons.might})`, value: assumedPart, category: "boon" });
        if (signetPart > 0)  entries.push({ source: `Signet Active (Might ×${sigActBoons.might})`, value: signetPart, category: "boon" });
      }
    }
    const hasFury = assumedBoons?.fury || sigActBoons.fury;
    if (hasFury) {
      const furyBonuses = bridgeFuryStatBonuses(state);
      if (furyBonuses[statKey]) {
        const label = sigActBoons.fury && !assumedBoons?.fury ? "Signet Active (Fury)" : "Boon (Fury)";
        entries.push({ source: label, value: furyBonuses[statKey], category: "boon" });
      }
    }
  }

  // Passive trait flat stat bonuses — per-trait breakdown from engine (reuse result computed above)
  if (engineResult.traitDetails) {
    for (const detail of engineResult.traitDetails) {
      if (detail.target === statKey && detail.value) {
        entries.push({ source: detail.name, value: detail.value, category: "trait" });
      }
    }
  } else if (engineResult.traits[statKey]) {
    entries.push({ source: "Trait bonus", value: engineResult.traits[statKey], category: "trait" });
  }

  // Trait conversion contributions
  if (engineResult.conversions[statKey]) {
    entries.push({ source: "Trait conversion", value: engineResult.conversions[statKey], category: "trait" });
  }

  // Stacking sigil contributions
  if (sigilStacks) {
    for (const def of STACKING_SIGIL_DEFS) {
      const stacks = sigilStacks[def.key] || 0;
      if (stacks <= 0) continue;
      const matches = def.allStats ? def.allStats.includes(statKey) : def.stat === statKey;
      if (matches) {
        entries.push({ source: `Sigil (${def.label} ×${stacks})`, value: stacks * def.perStack, category: "sigil" });
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
