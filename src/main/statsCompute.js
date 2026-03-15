"use strict";

// Embed static constants
const STAT_COMBOS_BY_LABEL = new Map([
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
  ["Cleric's", { stats: ["HealingPower", "Toughness", "Power"] }],
  ["Minstrel's", { stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] }],
  ["Harrier's", { stats: ["Power", "HealingPower", "Concentration"] }],
  ["Ritualist's", { stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] }],
  ["Seraph", { stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] }],
  ["Zealot's", { stats: ["Power", "Precision", "HealingPower"] }],
  ["Celestial", { stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] }],
]);

const SLOT_WEIGHTS = {
  head: { p: 60, s: 43 }, shoulders: { p: 45, s: 32 }, chest: { p: 134, s: 96 },
  hands: { p: 45, s: 32 }, legs: { p: 90, s: 64 }, feet: { p: 45, s: 32 },
  mainhand1: { p: 120, s: 85 }, offhand1: { p: 90, s: 64 },
  mainhand2: { p: 120, s: 85 }, offhand2: { p: 90, s: 64 },
  back: { p: 63, s: 40 }, amulet: { p: 157, s: 108 },
  ring1: { p: 126, s: 85 }, ring2: { p: 126, s: 85 },
  accessory1: { p: 110, s: 74 }, accessory2: { p: 110, s: 74 },
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
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + Math.round(w.p * 0.895);
      totals[combo.stats[1]] = (totals[combo.stats[1]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[2]] = (totals[combo.stats[2]] || 0) + Math.round(w.s * 0.889);
      totals[combo.stats[3]] = (totals[combo.stats[3]] || 0) + Math.round(w.p * 0.452);
    } else {
      const each = Math.round((w.p + 2 * w.s) / n);
      for (const stat of combo.stats) totals[stat] = (totals[stat] || 0) + each;
    }
  }

  // Food flat stat contributions
  if (equipment.food && upgradeCatalog) {
    const foodDef = upgradeCatalog.foodById?.get(Number(equipment.food));
    if (foodDef) {
      const foodStatMap = { "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower", "Healing": "HealingPower" };
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        const key = foodStatMap[m[2]] || m[2];
        if (totals[key] !== undefined) totals[key] += Number(m[1]);
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

module.exports = { computePublishStats };
