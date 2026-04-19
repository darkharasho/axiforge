"use strict";

const {
  STAT_COMBOS_BY_LABEL,
  getEffectiveStats,
  SLOT_WEIGHTS,
  TWO_HAND_WEIGHTS,
  LAND_ONLY_SLOTS,
  AQUATIC_SLOTS,
  PROFESSION_BASE_HP,
  PROFESSION_WEIGHT,
  ARMOR_DEFENSE_BY_WEIGHT,
  MIGHT_POWER_PER_STACK,
  MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE,
  FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS,
  SIGNET_PASSIVE_BUFFS,
  SIGNET_ACTIVE_EFFECTS,
  ALL_STAT_KEYS,
  CONVERSION_TARGET_MAP,
} = require("./constants");

const { collectModifiers, isFuryTrait } = require("./modifiers");
const { loadOverrides } = require("./overrides");

// ---------------------------------------------------------------------------
// Two-handed weapon types (no GW2_WEAPONS_BY_ID map — check by type string)
// ---------------------------------------------------------------------------
const TWO_HAND_WEAPON_TYPES = new Set([
  "greatsword", "hammer", "longbow", "shortbow", "rifle", "staff",
  "spear", "trident", "harpoon-gun",
]);

// ---------------------------------------------------------------------------
// Stat name normalization maps for text parsing
// ---------------------------------------------------------------------------
const FOOD_STAT_MAP = {
  "Condition Damage": "ConditionDamage",
  "Healing Power": "HealingPower",
  "Healing": "HealingPower",
  "Power": "Power",
  "Precision": "Precision",
  "Toughness": "Toughness",
  "Vitality": "Vitality",
  "Ferocity": "Ferocity",
  "Concentration": "Concentration",
  "Expertise": "Expertise",
};

// Regex patterns for text parsing
const FOOD_REGEX = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Attributes)/g;
const RUNE_REGEX = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats)/;
const UTILITY_CONVERSION_REGEX = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
const UTILITY_WRIT_REGEX = /Gain (\d+) (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) When Health/g;
const UTILITY_FLAT_REGEX = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;

// ---------------------------------------------------------------------------
// Helper: create zeroed stat object
// ---------------------------------------------------------------------------
function zeroStats() {
  const obj = {};
  for (const key of ALL_STAT_KEYS) obj[key] = 0;
  return obj;
}

// ---------------------------------------------------------------------------
// Helper: add value to stat object in-place
// ---------------------------------------------------------------------------
function addStat(obj, stat, value) {
  const key = CONVERSION_TARGET_MAP[stat] || stat;
  if (key in obj) {
    obj[key] += value;
  }
}

// ---------------------------------------------------------------------------
// getExcludedSlots(underwaterMode, activeWeaponSet) — pure function
// ---------------------------------------------------------------------------
function getExcludedSlots(underwaterMode, activeWeaponSet) {
  const isUnderwater = Boolean(underwaterMode);
  const activeSet = Number(activeWeaponSet) || 1;
  const excluded = new Set(isUnderwater ? LAND_ONLY_SLOTS : AQUATIC_SLOTS);

  if (isUnderwater) {
    excluded.add(activeSet === 2 ? "aquatic1" : "aquatic2");
  } else {
    if (activeSet === 2) {
      excluded.add("mainhand1");
      excluded.add("offhand1");
    } else {
      excluded.add("mainhand2");
      excluded.add("offhand2");
    }
  }

  return excluded;
}

// ---------------------------------------------------------------------------
// computeSlotStats(comboLabel, slotKey, weapons, gameMode) — pure function
// ---------------------------------------------------------------------------
function computeSlotStats(comboLabel, slotKey, weapons, gameMode) {
  const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
  if (!combo) return [];

  // Determine slot weights
  let weights = SLOT_WEIGHTS[slotKey];
  if (!weights) return [];

  // Check for two-handed weapon
  const isTwoHand =
    slotKey.startsWith("mainhand") &&
    TWO_HAND_WEAPON_TYPES.has(weapons && weapons[slotKey]);
  if (isTwoHand) {
    weights = TWO_HAND_WEIGHTS;
  }

  const effectiveStats = getEffectiveStats(combo, gameMode);
  const count = effectiveStats.length;
  const result = [];

  if (count <= 3) {
    // p/s pattern: first stat is major (p), rest are minor (s)
    effectiveStats.forEach((stat, i) => {
      result.push({ stat, value: i === 0 ? weights.p : weights.s });
    });
  } else if (count === 4) {
    // p4/p4/s4/s4 pattern: first 2 major, last 2 minor
    effectiveStats.forEach((stat, i) => {
      result.push({ stat, value: i < 2 ? weights.p4 : weights.s4 });
    });
  } else {
    // >4 stats: celestial — all use c weight
    effectiveStats.forEach((stat) => {
      result.push({ stat, value: weights.c });
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Parse food buff text into stat contributions
// ---------------------------------------------------------------------------
function parseFoodBuff(buffText) {
  const stats = zeroStats();
  if (!buffText) return stats;

  FOOD_REGEX.lastIndex = 0;
  let match;
  while ((match = FOOD_REGEX.exec(buffText)) !== null) {
    const value = parseInt(match[1], 10);
    const statName = match[2];
    if (statName === "to All Attributes") {
      for (const key of ALL_STAT_KEYS) stats[key] += value;
    } else {
      const key = FOOD_STAT_MAP[statName];
      if (key) stats[key] += value;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Parse rune bonus text (single bonus string)
// ---------------------------------------------------------------------------
function parseRuneBonus(bonusText) {
  const match = RUNE_REGEX.exec(bonusText);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const statName = match[2];
  if (statName === "to All Stats") {
    return { allStats: true, value };
  }
  const key = FOOD_STAT_MAP[statName];
  if (!key) return null;
  return { stat: key, value };
}

// ---------------------------------------------------------------------------
// Parse utility buff text into stat contributions
// Uses preConvTotal for conversion-style bonuses
// ---------------------------------------------------------------------------
function parseUtilityBuff(buffText, preConvTotal) {
  const stats = zeroStats();
  if (!buffText) return stats;

  // Pattern 1: conversion ("Gain [Stat] Equal to N% of Your [SourceStat]")
  UTILITY_CONVERSION_REGEX.lastIndex = 0;
  let match;
  while ((match = UTILITY_CONVERSION_REGEX.exec(buffText)) !== null) {
    const targetStat = FOOD_STAT_MAP[match[1]] || match[1];
    const pct = parseFloat(match[2]);
    const sourceStat = FOOD_STAT_MAP[match[3]] || match[3];
    const sourceVal = preConvTotal[sourceStat] || 0;
    const bonus = Math.round(sourceVal * pct / 100);
    if (targetStat in stats) stats[targetStat] += bonus;
  }

  // Pattern 2: writ ("Gain N [Stat] When Health")
  UTILITY_WRIT_REGEX.lastIndex = 0;
  while ((match = UTILITY_WRIT_REGEX.exec(buffText)) !== null) {
    const value = parseInt(match[1], 10);
    const key = FOOD_STAT_MAP[match[2]] || match[2];
    if (key in stats) stats[key] += value;
  }

  // Pattern 3: flat ("+N [Stat]")
  UTILITY_FLAT_REGEX.lastIndex = 0;
  while ((match = UTILITY_FLAT_REGEX.exec(buffText)) !== null) {
    const value = parseInt(match[1], 10);
    const key = FOOD_STAT_MAP[match[2]] || match[2];
    if (key in stats) stats[key] += value;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// computeAttributes(ctx, catalogs) — main function
// ---------------------------------------------------------------------------
function computeAttributes(ctx, catalogs) {
  const overrides = loadOverrides();
  const gameMode = ctx.gameMode || "pve";
  const underwaterMode = ctx.underwaterMode || false;
  const activeWeaponSet = ctx.activeWeaponSet || 1;
  const equipment = ctx.equipment || {};
  const weapons = equipment.weapons || {};

  // Get excluded slots
  const excluded = getExcludedSlots(underwaterMode, activeWeaponSet);

  // -------------------------------------------------------------------------
  // Step 1: Base stats
  // -------------------------------------------------------------------------
  const base = {
    Power: 1000,
    Precision: 1000,
    Toughness: 1000,
    Vitality: 1000,
    Ferocity: 0,
    ConditionDamage: 0,
    Expertise: 0,
    Concentration: 0,
    HealingPower: 0,
  };

  // -------------------------------------------------------------------------
  // Step 2: Equipment slots
  // -------------------------------------------------------------------------
  const equipmentStats = zeroStats();
  const slots = equipment.slots || {};
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (excluded.has(slotKey)) continue;
    if (!comboLabel) continue;
    const slotStats = computeSlotStats(comboLabel, slotKey, weapons, gameMode);
    for (const { stat, value } of slotStats) {
      if (stat in equipmentStats) equipmentStats[stat] += value;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Food
  // -------------------------------------------------------------------------
  const foodStats = zeroStats();
  if (equipment.food && catalogs.foodById) {
    const food = catalogs.foodById.get(equipment.food);
    if (food?.buff) {
      const parsed = parseFoodBuff(food.buff);
      for (const key of ALL_STAT_KEYS) foodStats[key] += parsed[key];
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Runes — count per rune ID across equipped slots, apply cumulative bonuses
  // -------------------------------------------------------------------------
  const runeStats = zeroStats();
  if (equipment.runes && catalogs.runeById) {
    // Count rune IDs (excluding excluded slots)
    const runeCounts = new Map();
    for (const [slotKey, runeId] of Object.entries(equipment.runes)) {
      if (excluded.has(slotKey)) continue;
      if (!runeId) continue;
      const id = Number(runeId);
      runeCounts.set(id, (runeCounts.get(id) || 0) + 1);
    }

    // Apply cumulative bonuses up to count (max 6)
    for (const [runeId, count] of runeCounts) {
      const rune = catalogs.runeById.get(runeId);
      if (!rune?.bonuses) continue;
      const bonuses = rune.bonuses;
      const applyCount = Math.min(count, 6, bonuses.length);
      for (let i = 0; i < applyCount; i++) {
        const parsed = parseRuneBonus(bonuses[i]);
        if (!parsed) continue;
        if (parsed.allStats) {
          for (const key of ALL_STAT_KEYS) runeStats[key] += parsed.value;
        } else {
          runeStats[parsed.stat] += parsed.value;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Infusions — per slot, flatMap arrays, lookup infixUpgrade.attributes
  // For mainhand weapon slots, limit infusion count based on weapon type:
  // 1H weapons get 1 infusion slot, 2H/aquatic weapons get 2.
  // -------------------------------------------------------------------------
  const infusionStats = zeroStats();
  if (equipment.infusions && catalogs.infusionById) {
    for (const [slotKey, infusionIds] of Object.entries(equipment.infusions)) {
      if (excluded.has(slotKey)) continue;
      const ids = Array.isArray(infusionIds) ? infusionIds : [infusionIds];
      // Cap infusion slots for mainhand weapons: 2H = 2, 1H = 1
      let maxSlots = ids.length;
      if (slotKey.startsWith("mainhand") || slotKey.startsWith("aquatic")) {
        const weaponType = weapons[slotKey] || "";
        if (weaponType && !slotKey.startsWith("aquatic")) {
          maxSlots = TWO_HAND_WEAPON_TYPES.has(weaponType) ? 2 : 1;
        }
      }
      const limit = Math.min(ids.length, maxSlots);
      for (let i = 0; i < limit; i++) {
        const infId = ids[i];
        if (!infId) continue;
        const inf = catalogs.infusionById.get(Number(infId));
        if (!inf?.infixUpgrade?.attributes) continue;
        for (const attr of inf.infixUpgrade.attributes) {
          const key = CONVERSION_TARGET_MAP[attr.attribute] || attr.attribute;
          if (key in infusionStats) infusionStats[key] += attr.modifier || 0;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Enrichment
  // -------------------------------------------------------------------------
  const enrichmentStats = zeroStats();
  if (equipment.enrichment && catalogs.enrichmentById) {
    const enr = catalogs.enrichmentById.get(Number(equipment.enrichment));
    if (enr?.infixUpgrade?.attributes) {
      for (const attr of enr.infixUpgrade.attributes) {
        const key = CONVERSION_TARGET_MAP[attr.attribute] || attr.attribute;
        if (key in enrichmentStats) enrichmentStats[key] += attr.modifier || 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 7: Signets
  // -------------------------------------------------------------------------
  const signetStats = zeroStats();
  // Boons granted by activated signet active skills (aggregated for engine use).
  const signetActiveBoons = { might: 0, fury: false };
  if (ctx.skills) {
    const skillIds = [
      ctx.skills.healId,
      ...(ctx.skills.utilityIds || []),
      ctx.skills.eliteId,
    ].filter(Boolean).map(Number);

    // Signet state per signet — three values:
    //   undefined / "passive" / true  → passive bonus applies (default)
    //   "active"                      → skill used: active effect applies, passive removed
    //   "cooldown" / false            → on cooldown: passive removed, no active bonus yet
    // Absent/null activeSignets → all passives apply (backward compatible).
    const activeSignets = ctx.activeSignets;
    const getSignetState = (id) => {
      if (!activeSignets) return "passive";
      const v = activeSignets instanceof Map ? activeSignets.get(id) : activeSignets[id];
      if (v === "active")   return "active";
      if (v === "cooldown" || v === false) return "cooldown";
      return "passive"; // undefined, true, "passive"
    };

    for (const skillId of skillIds) {
      const state = getSignetState(skillId);
      const buff = SIGNET_PASSIVE_BUFFS.get(skillId);
      if (buff && buff.stat in signetStats && state === "passive") {
        signetStats[buff.stat] += buff.value;
      }
      // When signet active is used, apply its active-skill effect.
      if (state === "active") {
        const active = SIGNET_ACTIVE_EFFECTS.get(skillId);
        if (active) {
          if (active.stats) {
            for (const [stat, val] of Object.entries(active.stats)) {
              if (stat in signetStats) signetStats[stat] += val;
            }
          }
          if (active.boons) {
            if (active.boons.might) signetActiveBoons.might += active.boons.might;
            if (active.boons.fury)  signetActiveBoons.fury = true;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: Pre-conversion totals (base + equipment + food + runes + infusions + enrichment + signets)
  // (Utility is added after — but wait for its conversion to use pre-conv totals)
  // Note: We compute pre-conv totals without utility first, then add utility (non-conversion parts)
  // Actually per spec: utility conversion uses preConvTotal. We'll compute pre-conv WITHOUT utility,
  // parse utility conversions using that, then add utility flat/writ parts separately.
  // -------------------------------------------------------------------------
  const preConvBase = zeroStats();
  for (const key of ALL_STAT_KEYS) {
    preConvBase[key] = (base[key] || 0) + equipmentStats[key] + foodStats[key] +
      runeStats[key] + infusionStats[key] + enrichmentStats[key] + signetStats[key];
  }

  // Parse utility buff using preConvBase as the "preConvTotal" for conversion
  const utilityStats = zeroStats();
  if (equipment.utility && catalogs.utilityById) {
    const utility = catalogs.utilityById.get(equipment.utility);
    if (utility?.buff) {
      const parsed = parseUtilityBuff(utility.buff, preConvBase);
      for (const key of ALL_STAT_KEYS) utilityStats[key] += parsed[key];
    }
  }

  // Recompute pre-conv totals including utility (for trait conversions)
  const preConvTotal = zeroStats();
  for (const key of ALL_STAT_KEYS) {
    preConvTotal[key] = preConvBase[key] + utilityStats[key];
  }

  // -------------------------------------------------------------------------
  // Step 10: Traits — flat bonuses from active traits
  // -------------------------------------------------------------------------
  const traitStats = zeroStats();
  const traitDetails = []; // per-trait breakdown: { traitId, name, target, value }
  const modifiers = collectModifiers(ctx, catalogs, overrides);
  const furyAssumed = Boolean(ctx.assumedBoons?.fury) || signetActiveBoons.fury;
  const berserkActive = Boolean(ctx.berserkActive);

  for (const mod of modifiers) {
    if (mod.type !== "flatBonus") continue;
    // Apply if: passive (condition === null), fury (when assumed or from signet active), or berserk (when toggled)
    if (mod.condition === null
        || (mod.condition === "fury" && furyAssumed)
        || (mod.condition === "berserk" && berserkActive)) {
      if (mod.target in traitStats) {
        traitStats[mod.target] += mod.value;
        // Extract trait ID from source (e.g. "trait:1338" → 1338)
        const traitId = Number(mod.source?.replace("trait:", "")) || 0;
        const trait = traitId && catalogs?.traitById?.get(traitId);
        traitDetails.push({
          traitId,
          name: trait?.name || mod.source,
          target: mod.target,
          value: mod.value,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 11: Conversions — trait conversion modifiers
  // -------------------------------------------------------------------------
  const conversionStats = zeroStats();
  for (const mod of modifiers) {
    if (mod.type !== "conversion") continue;
    const sourceVal = preConvTotal[mod.sourceAttr] || 0;
    const bonus = Math.floor(sourceVal * mod.percent / 100);
    if (mod.target in conversionStats) {
      conversionStats[mod.target] += bonus;
    }
  }

  // -------------------------------------------------------------------------
  // Step 12: Boons — Might stacks, fury crit (handled in derived)
  // -------------------------------------------------------------------------
  const boonStats = zeroStats();
  // Total Might stacks = user-assumed + any from activated signet actives
  const mightStacks = (ctx.assumedBoons?.might || 0) + signetActiveBoons.might;
  // Fury = user-assumed OR granted by an activated signet active
  const furyFromSignet = signetActiveBoons.fury;

  if (mightStacks > 0) {
    // Check for mightModifier overrides from traits
    let mightPower = MIGHT_POWER_PER_STACK;
    let mightCondi = MIGHT_CONDI_PER_STACK;
    for (const mod of modifiers) {
      if (mod.type === "mightModifier") {
        if (mod.power != null) mightPower = mod.power;
        if (mod.condi != null) mightCondi = mod.condi;
      }
    }
    boonStats.Power += mightStacks * mightPower;
    boonStats.ConditionDamage += mightStacks * mightCondi;
  }

  // -------------------------------------------------------------------------
  // Step 13: Sigils — stacking sigil contributions
  // -------------------------------------------------------------------------
  const sigilStats = zeroStats();
  const sigilStacks = ctx.sigilStacks || {};
  for (const def of STACKING_SIGIL_DEFS) {
    const stacks = sigilStacks[def.key] || 0;
    if (stacks <= 0) continue;
    if (def.stat) {
      if (def.stat in sigilStats) sigilStats[def.stat] += stacks * def.perStack;
    } else if (def.allStats) {
      for (const stat of def.allStats) {
        if (stat in sigilStats) sigilStats[stat] += stacks * def.perStack;
      }
    }
    // Note: def.modifier (e.g., "Outgoing Healing") is not a stat — skip
  }

  // -------------------------------------------------------------------------
  // Step 14: Total
  // -------------------------------------------------------------------------
  const total = zeroStats();
  const sources = [base, equipmentStats, foodStats, runeStats, infusionStats,
    enrichmentStats, utilityStats, signetStats, traitStats, conversionStats,
    boonStats, sigilStats];
  for (const src of sources) {
    for (const key of ALL_STAT_KEYS) {
      total[key] += src[key] || 0;
    }
  }

  // -------------------------------------------------------------------------
  // Step 15: Derived stats
  // -------------------------------------------------------------------------
  const weightClass = PROFESSION_WEIGHT[ctx.profession] || "medium";
  const profBaseHp = PROFESSION_BASE_HP[ctx.profession] || 0;

  const health = profBaseHp + total.Vitality * 10;

  // Crit bonus from traits and boons
  let critBonus = 0;
  // Passive crit chance modifiers (always active, condition === null)
  for (const mod of modifiers) {
    if (mod.type === "critChance" && mod.condition === null) {
      critBonus += mod.value;
    }
  }
  // Fury crit bonus
  if (furyAssumed) {
    critBonus += gameMode === "wvw" ? FURY_CRIT_CHANCE_WVW : FURY_CRIT_CHANCE;
    for (const mod of modifiers) {
      if (mod.type === "critChance" && mod.condition === "fury") {
        critBonus += mod.value;
      }
    }
  }
  // Berserk crit bonus (only when berserk mode is active)
  if (berserkActive) {
    for (const mod of modifiers) {
      if (mod.type === "critChance" && mod.condition === "berserk") {
        critBonus += mod.value;
      }
    }
  }

  const critChance = Math.min(100, (total.Precision - 895) / 21 + critBonus);
  const critDamage = 150 + total.Ferocity / 15;
  const conditionDuration = total.Expertise / 15;
  const boonDuration = total.Concentration / 15;
  const armor = total.Toughness + ARMOR_DEFENSE_BY_WEIGHT[weightClass];

  const derived = {
    health,
    critChance,
    critDamage,
    conditionDuration,
    boonDuration,
    armor,
  };

  return {
    base,
    equipment: equipmentStats,
    food: foodStats,
    runes: runeStats,
    infusions: infusionStats,
    enrichment: enrichmentStats,
    utility: utilityStats,
    signets: signetStats,
    signetActiveBoons,
    traits: traitStats,
    traitDetails,
    conversions: conversionStats,
    boons: boonStats,
    sigils: sigilStats,
    total,
    derived,
  };
}

module.exports = { computeAttributes, computeSlotStats, getExcludedSlots };
