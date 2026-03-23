// Equipment stat computation — pure logic over state + constants, no DOM deps.
import { state } from "./state.js";
import {
  STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK, STACKING_SIGIL_DEFS,
} from "./constants.js";

/**
 * Map GW2 API AttributeConversion target names to our stat keys.
 * The API uses derived-stat names for some targets.
 */
const CONVERSION_TARGET_MAP = {
  BoonDuration: "Concentration",
  ConditionDuration: "Expertise",
  CritDamage: "Ferocity",
  Healing: "HealingPower",
};

/**
 * Compute stat bonuses from active trait AttributeConversion facts.
 * Reads base stats (before conversions) and returns a map of bonus stats to add.
 * Formula per conversion: floor(baseStatValue * percent / 100)
 *
 * @param {Object} baseStats - Current stat totals (before trait conversions)
 * @returns {Object} bonuses - Map of stat key → bonus value to add
 */
export function computeTraitConversions(baseStats) {
  const bonuses = {};
  const catalog = state.catalog;
  if (!catalog?.traitById) return bonuses;

  // Collect active trait IDs from selected specializations
  const activeTraitIds = new Set(
    (state.editor.specializations || [])
      .flatMap((s) => Object.values(s?.majorChoices || {}))
      .map(Number)
      .filter(Boolean)
  );
  if (!activeTraitIds.size) return bonuses;

  for (const traitId of activeTraitIds) {
    const trait = catalog.traitById.get(traitId);
    if (!trait?.facts) continue;
    for (const fact of trait.facts) {
      // Only process AttributeConversion facts — other fact types (Buff, etc.)
      // may coincidentally have source/target/percent fields.
      if (fact.type !== "AttributeConversion") continue;
      if (!fact.source || !fact.target || !fact.percent) continue;
      const sourceVal = baseStats[fact.source] || 0;
      if (!sourceVal) continue;
      const targetKey = CONVERSION_TARGET_MAP[fact.target] || fact.target;
      const bonus = Math.floor(sourceVal * fact.percent / 100);
      bonuses[targetKey] = (bonuses[targetKey] || 0) + bonus;
    }
  }

  return bonuses;
}

/**
 * Build the set of equipment slot keys to exclude from stat calculations.
 * Excludes the opposite environment's slots AND the inactive weapon set.
 */
function getExcludedSlots() {
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const activeSet = Number(state.editor.activeWeaponSet) || 1;
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

export function computeSlotStats(comboLabel, slotKey) {
  const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
  const w = SLOT_WEIGHTS[slotKey];
  if (!combo || !w) return [];
  const n = combo.stats.length;
  const result = [];
  if (n <= 3) {
    result.push({ stat: combo.stats[0], value: w.p });
    for (let i = 1; i < n; i++) result.push({ stat: combo.stats[i], value: w.s });
  } else if (n === 4) {
    // 2-2 pattern: first 2 stats are major, last 2 are minor
    result.push({ stat: combo.stats[0], value: w.p4 });
    result.push({ stat: combo.stats[1], value: w.p4 });
    result.push({ stat: combo.stats[2], value: w.s4 });
    result.push({ stat: combo.stats[3], value: w.s4 });
  } else {
    for (const stat of combo.stats) result.push({ stat, value: w.c });
  }
  return result;
}

export function computeEquipmentStats(assumedBoons = null, sigilStacks = null) {
  const slots = state.editor.equipment?.slots || {};
  const totals = {
    Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000,
    Ferocity: 0, ConditionDamage: 0, Expertise: 0, Concentration: 0, HealingPower: 0,
  };
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = getExcludedSlots();
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel || EXCLUDED_SLOTS.has(slotKey)) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p;
      for (let i = 1; i < combo.stats.length; i++) {
        totals[combo.stats[i]] = (totals[combo.stats[i]] || 0) + w.s;
      }
    } else if (n === 4) {
      // 2-2 pattern: first 2 stats are major, last 2 are minor
      totals[combo.stats[0]] = (totals[combo.stats[0]] || 0) + w.p4;
      totals[combo.stats[1]] = (totals[combo.stats[1]] || 0) + w.p4;
      totals[combo.stats[2]] = (totals[combo.stats[2]] || 0) + w.s4;
      totals[combo.stats[3]] = (totals[combo.stats[3]] || 0) + w.s4;
    } else {
      for (const stat of combo.stats) {
        totals[stat] = (totals[stat] || 0) + w.c;
      }
    }
  }

  // Food flat stat contributions (+N StatName patterns)
  const foodId = state.editor.equipment?.food;
  if (foodId) {
    const foodDef = state.upgradeCatalog?.foodById?.get(Number(foodId));
    if (foodDef) {
      const foodStatMap = {
        "Condition Damage": "ConditionDamage", "Healing Power": "HealingPower",
        "Healing": "HealingPower",
        "Power": "Power", "Precision": "Precision", "Toughness": "Toughness",
        "Vitality": "Vitality", "Ferocity": "Ferocity",
        "Concentration": "Concentration", "Expertise": "Expertise",
      };
      const re = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Attributes)/g;
      const ALL_STAT_KEYS = ["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "HealingPower", "Concentration", "Expertise"];
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        if (m[2] === "to All Attributes") {
          for (const key of ALL_STAT_KEYS) totals[key] = (totals[key] || 0) + Number(m[1]);
        } else {
          const key = foodStatMap[m[2]];
          if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
        }
      }
    }
  }

  // Upgrade stat contributions (infusions, enrichments, runes)
  const upgradeCatalog = state.upgradeCatalog;
  if (upgradeCatalog) {
    // Helper: resolve API attribute name to our stat key
    const toStatKey = (attr) =>
      attr === "Healing" ? "HealingPower"
      : attr === "ConditionDamage" ? "ConditionDamage"
      : attr === "HealingPower" ? "HealingPower"
      : attr;

    // Helper: add infix_upgrade.attributes to totals
    const addInfixAttributes = (infixUpgrade) => {
      if (!infixUpgrade?.attributes) return;
      for (const attr of infixUpgrade.attributes) {
        const key = toStatKey(attr.attribute);
        if (totals[key] !== undefined) totals[key] += attr.modifier || 0;
      }
    };

    // Infusions (some slots are arrays: back=2, rings=3; exclude underwater)
    const infusions = state.editor.equipment?.infusions || {};
    const allInfusionIds = Object.entries(infusions)
      .filter(([k]) => !EXCLUDED_SLOTS.has(k))
      .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
    for (const id of allInfusionIds) {
      if (!id) continue;
      const def = upgradeCatalog.infusionById?.get(Number(id));
      if (def) addInfixAttributes(def.infixUpgrade);
    }

    // Enrichment (amulet)
    const enrichmentId = state.editor.equipment?.enrichment;
    if (enrichmentId) {
      const def = upgradeCatalog.enrichmentById?.get(Number(enrichmentId));
      if (def) addInfixAttributes(def.infixUpgrade);
    }

    // Runes — bonuses are cumulative per piece equipped.
    // Each bonus line may contain "+N StatName" flat stats to parse.
    const RUNE_BONUS_STAT_MAP = {
      "Power": "Power", "Precision": "Precision", "Toughness": "Toughness",
      "Vitality": "Vitality", "Ferocity": "Ferocity", "Concentration": "Concentration",
      "Expertise": "Expertise", "Condition Damage": "ConditionDamage",
      "Healing Power": "HealingPower", "Healing": "HealingPower",
    };
    const RUNE_BONUS_RE = /\+(\d+)\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats)/;
    const ALL_STAT_KEYS = ["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "HealingPower", "Concentration", "Expertise"];

    const runes = state.editor.equipment?.runes || {};
    // Count how many of each rune ID are equipped (exclude breather)
    const runeCounts = new Map();
    for (const [slot, id] of Object.entries(runes)) {
      if (!id || EXCLUDED_SLOTS.has(slot)) continue;
      runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
    }
    for (const [runeId, count] of runeCounts) {
      const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
      if (!runeDef?.bonuses?.length) continue;
      // Apply bonuses up to the count equipped (max 6)
      const activeBonuses = runeDef.bonuses.slice(0, Math.min(count, 6));
      for (const bonus of activeBonuses) {
        const m = RUNE_BONUS_RE.exec(bonus);
        if (!m) continue;
        const value = Number(m[1]);
        if (m[2] === "to All Stats") {
          for (const key of ALL_STAT_KEYS) totals[key] += value;
        } else {
          const key = RUNE_BONUS_STAT_MAP[m[2]];
          if (key && totals[key] !== undefined) totals[key] += value;
        }
      }
    }
  }

  // Utility consumable stat contributions
  const utilityId = state.editor.equipment?.utility;
  if (utilityId) {
    const utilDef = state.upgradeCatalog?.utilityById?.get(Number(utilityId));
    if (utilDef) {
      const UTIL_STAT_MAP = {
        "Power": "Power", "Precision": "Precision", "Toughness": "Toughness",
        "Vitality": "Vitality", "Ferocity": "Ferocity", "Concentration": "Concentration",
        "Expertise": "Expertise", "Condition Damage": "ConditionDamage",
        "Healing Power": "HealingPower",
      };
      // Pattern 1: "Gain [Stat] Equal to [N]% of Your [SourceStat]"
      const convRe = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = convRe.exec(utilDef.buff)) !== null) {
        const targetKey = UTIL_STAT_MAP[m[1]];
        const pct = Number(m[2]) / 100;
        const sourceKey = UTIL_STAT_MAP[m[3]];
        if (targetKey && sourceKey && totals[sourceKey] !== undefined) {
          totals[targetKey] = (totals[targetKey] || 0) + Math.round(totals[sourceKey] * pct);
        }
      }
      // Pattern 2: "Gain [N] [Stat] When Health..." (writs — conditional flat stats)
      const writRe = /Gain (\d+) (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) When Health/g;
      while ((m = writRe.exec(utilDef.buff)) !== null) {
        const key = UTIL_STAT_MAP[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
      // Pattern 3: "+N StatName" flat bonuses (food-style, some special utils)
      const flatRe = /\+(\d+)\s+(Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) {
        const key = UTIL_STAT_MAP[m[2]];
        if (key) totals[key] = (totals[key] || 0) + Number(m[1]);
      }
    }
  }

  // Assumed boon contributions (session-only, not persisted)
  if (assumedBoons) {
    totals.Power += (assumedBoons.might || 0) * MIGHT_POWER_PER_STACK;
    totals.ConditionDamage += (assumedBoons.might || 0) * MIGHT_CONDI_PER_STACK;
  }

  // Stacking sigil contributions
  if (sigilStacks) {
    for (const def of STACKING_SIGIL_DEFS) {
      const stacks = sigilStacks[def.key] || 0;
      if (stacks > 0) {
        totals[def.stat] = (totals[def.stat] || 0) + stacks * def.perStack;
      }
    }
  }

  // Trait AttributeConversion contributions
  const traitBonuses = computeTraitConversions(totals);
  for (const [key, bonus] of Object.entries(traitBonuses)) {
    totals[key] = (totals[key] || 0) + bonus;
  }

  return totals;
}

/**
 * Compute total Concentration for a given build from its equipment.
 * Always uses land mode (aquatic slots excluded).
 * Returns 0 if build.equipment is absent.
 * Returns slot-only Concentration if upgradeCatalog is null.
 */
export function computeBuildConcentration(build, upgradeCatalog) {
  if (!build?.equipment) return 0;
  const equipment = build.equipment;
  const slots = equipment.slots || {};
  let concentration = 0;

  // Stat combo slots — no catalog needed
  const EXCLUDED = AQUATIC_SLOTS; // always land mode
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel || EXCLUDED.has(slotKey)) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
    const n = combo.stats.length;
    if (n <= 3) {
      if (combo.stats[0] === "Concentration") concentration += w.p;
      else {
        for (let i = 1; i < n; i++) {
          if (combo.stats[i] === "Concentration") concentration += w.s;
        }
      }
    } else if (n === 4) {
      const idx = combo.stats.indexOf("Concentration");
      if (idx === 0 || idx === 1) concentration += w.p4;
      else if (idx === 2 || idx === 3) concentration += w.s4;
    } else {
      if (combo.stats.includes("Concentration")) concentration += w.c;
    }
  }

  if (!upgradeCatalog) return concentration;

  // Food
  const foodId = equipment.food;
  if (foodId) {
    const foodDef = upgradeCatalog.foodById?.get(Number(foodId));
    if (foodDef) {
      const re = /\+(\d+)\s+(Concentration|to All Attributes)/g;
      let m;
      while ((m = re.exec(foodDef.buff)) !== null) {
        concentration += Number(m[1]); // both "Concentration" and "to All Attributes" add flat value
      }
    }
  }

  // Infusions (land slots only)
  // Note: GW2 API uses the literal "Concentration" in infixUpgrade.attributes
  // (unlike some other stats that have aliases), so no normalization is needed here.
  const infusions = equipment.infusions || {};
  const allInfusionIds = Object.entries(infusions)
    .filter(([k]) => !EXCLUDED.has(k))
    .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
  for (const id of allInfusionIds) {
    if (!id) continue;
    const def = upgradeCatalog.infusionById?.get(Number(id));
    if (def?.infixUpgrade?.attributes) {
      for (const attr of def.infixUpgrade.attributes) {
        if (attr.attribute === "Concentration") concentration += attr.modifier || 0;
      }
    }
  }

  // Enrichment
  // Note: GW2 API uses the literal "Concentration" in infixUpgrade.attributes
  // (unlike some other stats that have aliases), so no normalization is needed here.
  const enrichmentId = equipment.enrichment;
  if (enrichmentId) {
    const def = upgradeCatalog.enrichmentById?.get(Number(enrichmentId));
    if (def?.infixUpgrade?.attributes) {
      for (const attr of def.infixUpgrade.attributes) {
        if (attr.attribute === "Concentration") concentration += attr.modifier || 0;
      }
    }
  }

  // Runes (exclude aquatic slots)
  const RUNE_BONUS_RE = /\+(\d+)\s+(Concentration|to All Stats)/;
  const runes = equipment.runes || {};
  const runeCounts = new Map();
  for (const [slot, id] of Object.entries(runes)) {
    if (!id || EXCLUDED.has(slot)) continue;
    runeCounts.set(String(id), (runeCounts.get(String(id)) || 0) + 1);
  }
  for (const [runeId, count] of runeCounts) {
    const runeDef = upgradeCatalog.runeById?.get(Number(runeId));
    if (!runeDef?.bonuses?.length) continue;
    const activeBonuses = runeDef.bonuses.slice(0, Math.min(count, 6));
    for (const bonus of activeBonuses) {
      const m = RUNE_BONUS_RE.exec(bonus);
      if (!m) continue;
      concentration += Number(m[1]);
    }
  }

  // Utility
  const utilityId = equipment.utility;
  if (utilityId) {
    const utilDef = upgradeCatalog.utilityById?.get(Number(utilityId));
    if (utilDef) {
      // Note: "Gain Concentration Equal to N% of Your X" conversion pattern is omitted
      // intentionally — computing it would require the full stat totals, and this pattern
      // is rare/non-existent for Concentration in practice.
      // Pattern 1: conditional flat (writs)
      const writRe = /Gain (\d+) Concentration When Health/g;
      let m;
      while ((m = writRe.exec(utilDef.buff)) !== null) concentration += Number(m[1]);
      // Pattern 2: flat bonuses
      const flatRe = /\+(\d+)\s+Concentration/g;
      while ((m = flatRe.exec(utilDef.buff)) !== null) concentration += Number(m[1]);
    }
  }

  return concentration;
}

/**
 * Compute a detailed breakdown of all sources contributing to a given stat key.
 * Returns an array of { source: string, value: number } entries.
 */
export function computeStatBreakdown(statKey, assumedBoons = null, sigilStacks = null) {
  const entries = [];
  const BASE_STATS = new Set(["Power", "Precision", "Toughness", "Vitality"]);
  if (BASE_STATS.has(statKey)) entries.push({ source: "Base", value: 1000 });

  const slots = state.editor.equipment?.slots || {};
  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = getExcludedSlots();
  const SLOT_LABELS = {
    head: "Head", shoulders: "Shoulders", chest: "Chest", hands: "Hands", legs: "Legs", feet: "Feet",
    mainhand1: "Mainhand 1", offhand1: "Offhand 1", mainhand2: "Mainhand 2", offhand2: "Offhand 2",
    back: "Back", amulet: "Amulet", ring1: "Ring 1", ring2: "Ring 2", accessory1: "Accessory 1", accessory2: "Accessory 2",
    breather: "Breather", aquatic1: "Aquatic 1", aquatic2: "Aquatic 2",
  };

  // Equipment slots
  for (const [slotKey, comboLabel] of Object.entries(slots)) {
    if (!comboLabel || EXCLUDED_SLOTS.has(slotKey)) continue;
    const combo = STAT_COMBOS_BY_LABEL.get(comboLabel);
    const w = SLOT_WEIGHTS[slotKey];
    if (!combo || !w) continue;
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
      const weapons = state.editor.equipment?.weapons || {};
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
      const STAT_NAMES = { Power: "Power", Precision: "Precision", Toughness: "Toughness", Vitality: "Vitality",
        Ferocity: "Ferocity", ConditionDamage: "Condition Damage", HealingPower: "Healing Power",
        Concentration: "Concentration", Expertise: "Expertise" };
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
    const toStatKey = (attr) => attr === "Healing" ? "HealingPower" : attr;
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
      // Percentage conversions — need current totals for source stats
      const totals = computeEquipmentStats(assumedBoons, sigilStacks);
      const convRe = /Gain (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise) Equal to (\d+(?:\.\d+)?)% of Your (Condition Damage|Healing Power|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise)/g;
      let m;
      while ((m = convRe.exec(utilDef.buff)) !== null) {
        const targetKey = MAP[m[1]] || m[1];
        if (targetKey !== statKey) continue;
        const pct = Number(m[2]) / 100;
        const sourceKey = MAP[m[3]] || m[3];
        // Subtract own utility contribution to get pre-utility source value
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
      if (statKey === "Power") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * MIGHT_POWER_PER_STACK });
      }
      if (statKey === "ConditionDamage") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * MIGHT_CONDI_PER_STACK });
      }
    }
  }

  // Trait conversion contributions
  // Note: computeEquipmentStats returns post-conversion totals (trait bonuses already applied).
  // If two traits chain conversions (e.g. Power→Precision, Precision→Ferocity), the breakdown
  // entry for the second conversion may be slightly inflated vs. the actual total. This is
  // acceptable — GW2 conversion chains are rare, and the stat totals displayed are correct.
  const traitBase = computeEquipmentStats(assumedBoons, sigilStacks);
  const traitBonuses = computeTraitConversions(traitBase);
  if (traitBonuses[statKey]) {
    entries.push({ source: "Trait conversion", value: traitBonuses[statKey] });
  }

  // Stacking sigil contributions
  if (sigilStacks) {
    for (const def of STACKING_SIGIL_DEFS) {
      const stacks = sigilStacks[def.key] || 0;
      if (stacks > 0 && def.stat === statKey) {
        entries.push({ source: `Sigil (${def.label} ×${stacks})`, value: stacks * def.perStack });
      }
    }
  }

  return entries;
}

/**
 * Collect non-attribute modifiers from equipped upgrades (rune %, sigil buffs, infusion buffs).
 * Returns a Map of modifier text → total value (aggregated where possible).
 * Example: "+10% Might Duration" from 2 rune bonuses → { "Might Duration": 20 }
 */
export function computeUpgradeModifiers() {
  const modifiers = new Map(); // label → numeric total
  const addMod = (label, value) => modifiers.set(label, (modifiers.get(label) || 0) + value);

  const upgradeCatalog = state.upgradeCatalog;
  if (!upgradeCatalog) return modifiers;

  // Regex for percentage bonuses in rune bonus text: "+N% Something"
  const PCT_RE = /\+(\d+)%\s+(.+)/;
  // Regex for flat bonuses we already handle as stats — skip these
  const FLAT_STAT_RE = /\+\d+\s+(Condition Damage|Healing Power|Healing|Power|Precision|Toughness|Vitality|Ferocity|Concentration|Expertise|to All Stats|to All Attributes)/;

  const isUnderwater = Boolean(state.editor.underwaterMode);
  const EXCLUDED_SLOTS = getExcludedSlots();

  // Rune percentage modifiers (cumulative per piece, exclude breather)
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

  // Sigil buff modifiers (from active weapon set)
  const sigils = state.editor.equipment?.sigils || {};
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

  // Infusion buff modifiers (percentage lines from buffDescription, exclude underwater)
  const infusions = state.editor.equipment?.infusions || {};
  const allInfusionIds = Object.entries(infusions)
    .filter(([k]) => !EXCLUDED_SLOTS.has(k))
    .flatMap(([, v]) => Array.isArray(v) ? v : [v]);
  for (const id of allInfusionIds) {
    if (!id) continue;
    const def = upgradeCatalog.infusionById?.get(Number(id));
    const desc = def?.buffDescription || "";
    // Infusion buff can have multiple lines
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

  return modifiers;
}
