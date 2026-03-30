"use strict";

// Embed static constants
// For 4-stat combos: first 2 stats are major (0.3 multiplier), last 2 are minor (0.165 multiplier)
const _STAT_COMBOS_ENTRIES = [
  ["Berserker's", { stats: ["Power", "Precision", "Ferocity"] }],
  ["Marauder's", { stats: ["Power", "Precision", "Vitality", "Ferocity"] }],
  ["Assassin's", { stats: ["Precision", "Power", "Ferocity"] }],
  ["Valkyrie", { stats: ["Power", "Vitality", "Ferocity"] }],
  ["Dragon's", { stats: ["Power", "Ferocity", "Vitality", "Precision"] }],
  ["Viper's", { stats: ["Power", "ConditionDamage", "Precision", "Expertise"] }],
  ["Grieving", { stats: ["Power", "ConditionDamage", "Ferocity", "Precision"] }],
  ["Sinister", { stats: ["ConditionDamage", "Power", "Precision"] }],
  ["Dire", { stats: ["ConditionDamage", "Toughness", "Vitality"] }],
  ["Rabid", { stats: ["ConditionDamage", "Toughness", "Precision"] }],
  ["Carrion", { stats: ["ConditionDamage", "Power", "Vitality"] }],
  ["Trailblazer's", { stats: ["Toughness", "ConditionDamage", "Vitality", "Expertise"] }],
  ["Knight's", { stats: ["Toughness", "Power", "Precision"] }],
  ["Soldier's", { stats: ["Power", "Toughness", "Vitality"] }],
  ["Sentinel's", { stats: ["Vitality", "Power", "Toughness"] }],
  ["Wanderer's", { stats: ["Power", "Vitality", "Toughness", "Concentration"] }],
  ["Diviner's", { stats: ["Power", "Concentration", "Ferocity", "Precision"] }],
  ["Cleric's", { stats: ["HealingPower", "Toughness", "Power"] }],
  ["Minstrel's", { stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] }],
  ["Harrier's", { stats: ["Power", "HealingPower", "Concentration"] }],
  ["Ritualist's", { stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] }],
  ["Seraph", { stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] }],
  ["Crusader", { stats: ["Power", "Toughness", "Ferocity", "HealingPower"] }],
  ["Zealot's", { stats: ["Power", "Precision", "HealingPower"] }],
  ["Giver's", { stats: ["Toughness", "HealingPower", "Concentration"] }],
  ["Celestial", { stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] }],
];
// Add aliases without "'s" so imported builds (e.g. "Wanderer") resolve correctly
const STAT_COMBOS_BY_LABEL = new Map(
  _STAT_COMBOS_ENTRIES.flatMap(([label, combo]) => {
    const entries = [[label, combo]];
    if (label.endsWith("'s")) entries.push([label.slice(0, -2), combo]);
    return entries;
  })
);

// Ascended/Legendary stat weights per slot.
// p/s = 3-stat major/minor; p4/s4 = 4-stat major/minor; c = Celestial per-stat.
// Derived from GW2 API attribute_adjustment × stat multipliers (0.35/0.25/0.3/0.165).
const SLOT_WEIGHTS = {
  head:       { p: 63,  s: 45,  p4: 54,  s4: 30, c: 30 },
  shoulders:  { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  chest:      { p: 141, s: 101, p4: 121, s4: 66, c: 66 },
  hands:      { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  legs:       { p: 94,  s: 67,  p4: 81,  s4: 44, c: 44 },
  feet:       { p: 47,  s: 34,  p4: 40,  s4: 22, c: 22 },
  mainhand1:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand1:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  mainhand2:  { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  offhand2:   { p: 125, s: 90,  p4: 107, s4: 59, c: 59 },
  back:       { p: 63,  s: 40,  p4: 51,  s4: 27, c: 28 },
  amulet:     { p: 157, s: 108, p4: 132, s4: 71, c: 72 },
  ring1:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  ring2:      { p: 126, s: 85,  p4: 105, s4: 56, c: 57 },
  accessory1: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
  accessory2: { p: 110, s: 74,  p4: 92,  s4: 49, c: 50 },
};

const PROFESSION_BASE_HP = {
  Warrior: 19212, Necromancer: 19212, Revenant: 15922,
  Engineer: 15922, Ranger: 15922, Mesmer: 15922,
  Guardian: 11645, Thief: 11645, Elementalist: 11645,
};

function computePublishStats(equipment, upgradeCatalog, profession) {
  if (!equipment) return { stats: {}, modifiers: [] };

  const slots = equipment.slots || {};
  const totals = {
    Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };

  // Equipment slot contributions
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p;
      for (let i = 1; i < n; i++) totals[combo.stats[i]] = (totals[combo.stats[i]] || 0) + w.s;
    } else if (n === 4) {
      // 2-2 pattern: first 2 stats are major, last 2 are minor
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p4;
      totals[combo.stats[1]] = (totals[combo.stats[1]] || 0) + w.p4;
      totals[combo.stats[2]] = (totals[combo.stats[2]] || 0) + w.s4;
      totals[combo.stats[3]] = (totals[combo.stats[3]] || 0) + w.s4;
    } else {
      for (const stat of combo.stats) totals[stat] = (totals[stat] || 0) + w.c;
    }
  }

  // Food flat stat contributions
  if (equipment.food && upgradeCatalog) {
    const foodDef = upgradeCatalog.foodById?.get(Number(equipment.food));
    if (foodDef) {
      const foodStatMap = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower", "Healing": "HealingPower" };
      const ALL_STAT_KEYS = ["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "HealingPower", "Concentration", "Expertise"];
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Attributes)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        if (m[2] === "to All Attributes") {
          for (const key of ALL_STAT_KEYS) totals[key] += Number(m[1]);
        } else {
          const key = foodStatMap[m[2]] || m[2];
          if (totals[key] !== undefined) totals[key] += Number(m[1]);
        }
      }
    }
  }

  // Infusion/enrichment stat contributions (via infix_upgrade.attributes)
  if (upgradeCatalog) {
    const toStatKey = (attr) => attr === "Healing" ? "HealingPower" : attr === "ConditionDamage" ? "ConditionDamage" : attr;
    const addInfixAttributes = (infixUpgrade) => {
      if (!infixUpgrade?.attributes) return;
      for (const attr of infixUpgrade.attributes) {
        const key = toStatKey(attr.attribute);
        if (totals[key] !== undefined) totals[key] += attr.modifier || 0;
      }
    };

    // Infusions
    const infusions = equipment.infusions || {};
    for (const v of Object.values(infusions)) {
      const ids = Array.isArray(v) ? v : [v];
      for (const id of ids) {
        if (!id) continue;
        const def = upgradeCatalog.infusionById?.get(Number(id));
        if (def) addInfixAttributes(def.infixUpgrade);
      }
    }
    // Enrichment
    if (equipment.enrichment) {
      const def = upgradeCatalog.enrichmentById?.get(Number(equipment.enrichment));
      if (def) addInfixAttributes(def.infixUpgrade);
    }
    // Rune bonuses
    const runes = equipment.runes || {};
    const runeCounts = new Map();
    for (const id of Object.values(runes)) {
      if (!id) continue;
      runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
    }
    const RUNE_STAT_MAP = { "Power": "Power", "Precision": "Precision", "Toughness": "Toughness", "Vitality": "Vitality", "Ferocity": "Ferocity", "Concentration": "Concentration", "Expertise": "Expertise", "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower", "Healing": "HealingPower" };
    const ALL_STAT_KEYS = ["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "HealingPower", "Concentration", "Expertise"];
    const RUNE_RE = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats)/;
    for (const [runeId, count] of runeCounts) {
      const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
      if (!runeDef?.bonuses?.length) continue;
      for (const bonus of runeDef.bonuses.slice(0, Math.min(count, 6))) {
        const m = RUNE_RE.exec(bonus);
        if (!m) continue;
        const value = Number(m[1]);
        if (m[2] === "to All Stats") {
          for (const key of ALL_STAT_KEYS) totals[key] += value;
        } else {
          const key = RUNE_STAT_MAP[m[2]];
          if (key && totals[key] !== undefined) totals[key] += value;
        }
      }
    }
  }

  // Utility consumable contributions
  if (equipment.utility && upgradeCatalog) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(equipment.utility));
    if (utilDef) {
      const UTIL_MAP = { "Power": "Power", "Precision": "Precision", "Toughness": "Toughness", "Vitality": "Vitality", "Ferocity": "Ferocity", "Concentration": "Concentration", "Expertise": "Expertise", "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower" };
      // Pattern 1: conversion
      const convRe = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = convRe.exec(utilDef.buff)) !== null) {
        const targetKey = UTIL_MAP[m[1]];
        const pct = Number(m[2]) / 100;
        const sourceKey = UTIL_MAP[m[3]];
        if (targetKey && sourceKey && totals[sourceKey] !== undefined) {
          totals[targetKey] = (totals[targetKey] || 0) + Math.round(totals[sourceKey] * pct);
        }
      }
      // Pattern 2: conditional flat (writs)
      const writRe = /Gain (\d+) (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) When Health/g;
      while ((m = writRe.exec(utilDef.buff)) !== null) {
        const key = UTIL_MAP[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
      // Pattern 3: flat bonuses
      const flatRe = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) {
        const key = UTIL_MAP[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
    }
  }

  // Derived stats
  const baseHP = PROFESSION_BASE_HP[profession] || 11645;
  const health = baseHP + totals.Vitality * 10;
  const critChance = ((totals.Precision - 1000) / 21 + 5).toFixed(1) + "%";
  const critDamage = (150 + totals.Ferocity / 15).toFixed(1) + "%";
  const boonDuration = (totals.Concentration / 15).toFixed(1) + "%";
  const condDuration = (totals.Expertise / 15).toFixed(1) + "%";

  const stats = {
    ...totals,
    Health: health,
    CritChance: critChance,
    CritDamage: critDamage,
    BoonDuration: boonDuration,
    ConditionDuration: condDuration,
  };

  // Collect modifier text lines (non-stat buffs from upgrades)
  const modifiers = [];
  // TODO: parse modifier lines from rune/sigil/food buff text if needed

  return { stats, modifiers };
}

// ── Lightweight role estimation (mirrors renderer roleEstimator.js) ──────────

const MIN_THRESHOLD = 700;
const HYBRID_RATIO  = 0.10;

const ROLE_SCORERS = [
  { role: "Power DPS",    fn: s => s.Power * 1.0 + s.Precision * 0.5 + s.Ferocity * 0.5 },
  { role: "Condi DPS",    fn: s => s.ConditionDamage * 1.0 + s.Expertise * 0.8 },
  { role: "Boon Support", fn: s => s.Concentration * 1.5 + s.HealingPower * 0.3 },
  { role: "Heal Support", fn: s => s.HealingPower * 1.5 + s.Concentration * 0.3 },
];

function estimateRole(build) {
  const slots = build?.equipment?.slots;
  if (!slots || !Object.values(slots).some(Boolean)) return null;

  const totals = {
    Power: 0, Precision: 0, Toughness: 0, Vitality: 0,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };

  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] += w.p;
      for (let i = 1; i < n; i++) totals[combo.stats[i]] += w.s;
    } else if (n === 4) {
      totals[combo.stats[0]] += w.p4;
      totals[combo.stats[1]] += w.p4;
      totals[combo.stats[2]] += w.s4;
      totals[combo.stats[3]] += w.s4;
    } else {
      for (const stat of combo.stats) totals[stat] += w.c;
    }
  }

  const scored = ROLE_SCORERS.map(({ role, fn }) => ({ role, score: fn(totals) }));
  scored.sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  if (first.score < MIN_THRESHOLD) return "Unknown";
  if (second && second.score >= MIN_THRESHOLD && (first.score - second.score) / first.score < HYBRID_RATIO) {
    return "Hybrid";
  }
  return first.role;
}

module.exports = { computePublishStats, estimateRole };
