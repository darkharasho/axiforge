"use strict";

// ---------------------------------------------------------------------------
// GW2 game constants extracted from src/renderer/modules/constants.js
// Pure data module — no renderer imports, no DOM deps.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STAT_COMBOS — array of { label, stats } objects
// For 4-stat combos: first 2 stats are major (0.3 multiplier), last 2 are minor (0.165 multiplier)
// ---------------------------------------------------------------------------
const STAT_COMBOS = [
  { label: "Berserker's",   stats: ["Power", "Precision", "Ferocity"] },
  { label: "Marauder's",    stats: ["Power", "Precision", "Vitality", "Ferocity"] },
  { label: "Assassin's",    stats: ["Precision", "Power", "Ferocity"] },
  { label: "Valkyrie",      stats: ["Power", "Vitality", "Ferocity"] },
  { label: "Dragon's",      stats: ["Power", "Ferocity", "Vitality", "Precision"] },
  { label: "Viper's",       stats: ["Power", "ConditionDamage", "Precision", "Expertise"] },
  { label: "Grieving",      stats: ["Power", "ConditionDamage", "Ferocity", "Precision"] },
  { label: "Sinister",      stats: ["ConditionDamage", "Power", "Precision"] },
  { label: "Dire",          stats: ["ConditionDamage", "Toughness", "Vitality"] },
  { label: "Rabid",         stats: ["ConditionDamage", "Toughness", "Precision"] },
  { label: "Carrion",       stats: ["ConditionDamage", "Power", "Vitality"] },
  { label: "Trailblazer's", stats: ["Toughness", "ConditionDamage", "Vitality", "Expertise"] },
  { label: "Knight's",      stats: ["Toughness", "Power", "Precision"] },
  { label: "Soldier's",     stats: ["Power", "Toughness", "Vitality"] },
  { label: "Sentinel's",    stats: ["Vitality", "Power", "Toughness"] },
  { label: "Wanderer's",    stats: ["Power", "Vitality", "Toughness", "Concentration"] },
  { label: "Diviner's",     stats: ["Power", "Concentration", "Ferocity", "Precision"] },
  { label: "Cleric's",      stats: ["HealingPower", "Toughness", "Power"] },
  { label: "Minstrel's",    stats: ["Toughness", "HealingPower", "Vitality", "Concentration"] },
  { label: "Harrier's",     stats: ["Power", "HealingPower", "Concentration"] },
  { label: "Ritualist's",   stats: ["Vitality", "ConditionDamage", "Expertise", "Concentration"] },
  { label: "Seraph",        stats: ["Precision", "ConditionDamage", "HealingPower", "Concentration"] },
  { label: "Crusader",      stats: ["Power", "Toughness", "Ferocity", "HealingPower"] },
  { label: "Zealot's",      stats: ["Power", "Precision", "HealingPower"] },
  { label: "Giver's",       stats: ["Toughness", "HealingPower", "Concentration"] },
  { label: "Celestial",     stats: ["Power", "Precision", "Toughness", "Vitality", "ConditionDamage", "Ferocity", "HealingPower", "Expertise", "Concentration"] },
  // Added in issue #133 — missing PvE / WvW stat sets
  { label: "Apothecary's",  stats: ["HealingPower", "Toughness", "ConditionDamage"] },
  { label: "Magi's",        stats: ["HealingPower", "Precision", "Vitality"] },
  { label: "Shaman's",      stats: ["Vitality", "ConditionDamage", "HealingPower"] },
  { label: "Rampager's",    stats: ["Precision", "Power", "ConditionDamage"] },
  { label: "Cavalier's",    stats: ["Toughness", "Power", "Ferocity"] },
  { label: "Nomad's",       stats: ["Toughness", "Vitality", "HealingPower"] },
  { label: "Settler's",     stats: ["Toughness", "ConditionDamage", "HealingPower"] },
  { label: "Captain's",     stats: ["Toughness", "Power", "HealingPower"] },
  { label: "Vigilant",      stats: ["Power", "Toughness", "Concentration"] },
  { label: "Apostate's",    stats: ["ConditionDamage", "Toughness", "HealingPower"] },
  { label: "Plaguedoctor's", stats: ["ConditionDamage", "Vitality", "HealingPower", "Concentration"] },
  { label: "Marshal's",     stats: ["Power", "HealingPower", "Precision", "ConditionDamage"] },
  { label: "Demolisher",    stats: ["Power", "Precision", "Toughness", "Ferocity"] },
  { label: "Commander's",   stats: ["Power", "Precision", "Toughness", "Concentration"] },
];

// Map from label → combo object (includes alias without "'s" suffix)
const STAT_COMBOS_BY_LABEL = new Map(
  STAT_COMBOS.flatMap((c) => {
    const entries = [[c.label, c]];
    // Add alias without "'s" so imported builds (e.g. "Wanderer") resolve correctly
    if (c.label.endsWith("'s")) entries.push([c.label.slice(0, -2), c]);
    return entries;
  })
);

/**
 * Look up a stat combo by label (or alias without "'s").
 * Returns the combo object or undefined.
 */
function getStatCombo(label) {
  return STAT_COMBOS_BY_LABEL.get(label);
}

// In WvW, Celestial gear does not grant Expertise or Concentration.
const WVW_CELESTIAL_EXCLUDED = new Set(["Expertise", "Concentration"]);

/**
 * Return the effective stats array for a combo, accounting for game-mode restrictions.
 * In WvW, Celestial excludes Expertise and Concentration.
 * @param {{ label: string, stats: string[] }} combo
 * @param {string} gameMode - "pve" | "wvw" | "pvp"
 * @returns {string[]}
 */
function getEffectiveStats(combo, gameMode) {
  if (!combo) return [];
  if (gameMode === "wvw" && combo.label === "Celestial") {
    return combo.stats.filter((s) => !WVW_CELESTIAL_EXCLUDED.has(s));
  }
  return combo.stats;
}

// ---------------------------------------------------------------------------
// SLOT_WEIGHTS — ascended/legendary stat weights per slot
// p/s = 3-stat major/minor; p4/s4 = 4-stat major/minor; c = Celestial per-stat
// ---------------------------------------------------------------------------
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
  breather:   { p: 63,  s: 45,  p4: 54,  s4: 30, c: 30 },
  aquatic1:   { p: 251, s: 179, p4: 215, s4: 118, c: 118 },
  aquatic2:   { p: 251, s: 179, p4: 215, s4: 118, c: 118 },
};

// Two-handed land weapon stat weights (same as aquatic — attribute_adjustment 716.8).
const TWO_HAND_WEIGHTS = { p: 251, s: 179, p4: 215, s4: 118, c: 118 };

// ---------------------------------------------------------------------------
// Slot classification sets
// ---------------------------------------------------------------------------
const LAND_ONLY_SLOTS = new Set(["head", "mainhand1", "offhand1", "mainhand2", "offhand2"]);
const AQUATIC_SLOTS = new Set(["breather", "aquatic1", "aquatic2"]);

// ---------------------------------------------------------------------------
// Profession constants
// ---------------------------------------------------------------------------
const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

// Total defense from a full set of level 80 Ascended/Legendary armor (6 pieces).
const ARMOR_DEFENSE_BY_WEIGHT = { light: 967, medium: 1118, heavy: 1271 };

// Base HP at level 80 EXCLUDING base vitality contribution.
// Formula: totalHP = baseHP + (Vitality * 10), where base Vitality = 1000.
// High (9212): Warrior, Necromancer
// Medium (5922): Revenant, Engineer, Ranger, Mesmer
// Low (1645): Guardian, Thief, Elementalist
const PROFESSION_BASE_HP = {
  Warrior: 9212, Berserker: 9212, Spellbreaker: 9212, Bladesworn: 9212, Paragon: 9212,
  Necromancer: 9212, Reaper: 9212, Scourge: 9212, Harbinger: 9212,
  Revenant: 5922, Herald: 5922, Renegade: 5922, Vindicator: 5922,
  Engineer: 5922, Scrapper: 5922, Holosmith: 5922, Mechanist: 5922,
  Ranger: 5922, Druid: 5922, Soulbeast: 5922, Untamed: 5922,
  Mesmer: 5922, Chronomancer: 5922, Mirage: 5922, Virtuoso: 5922,
  Guardian: 1645, Dragonhunter: 1645, Firebrand: 1645, Willbender: 1645,
  Thief: 1645, Daredevil: 1645, Deadeye: 1645, Specter: 1645, Antiquary: 1645,
  Elementalist: 1645, Tempest: 1645, Weaver: 1645, Catalyst: 1645,
};

// ---------------------------------------------------------------------------
// Weapon strength midpoints
// Exotic level 80 weapon strength midpoints (avg of min/max per wiki.guildwars2.com/wiki/Weapon_strength)
// ---------------------------------------------------------------------------
const WEAPON_STRENGTH_MIDPOINT = {
  axe: 952.5, dagger: 952.5, mace: 952.5, pistol: 952.5, sword: 952.5, scepter: 952.5,
  focus: 857.5, shield: 857.5, torch: 857.5, warhorn: 857,
  greatsword: 1047.5, hammer: 1048, longbow: 1000, rifle: 1095.5, shortbow: 952.5, staff: 1048,
  spear: 952.5, trident: 952.5, harpoon: 952.5,
};

// ---------------------------------------------------------------------------
// Boon/condition constants
// ---------------------------------------------------------------------------

// Fact types where the icon represents the boon/condition being applied.
const BUFF_FACT_TYPES = new Set(["Buff", "ApplyBuffCondition", "PrefixedBuff"]);

// Assumed boon stat effects (per GW2 wiki, level 80)
const MIGHT_POWER_PER_STACK = 30;
const MIGHT_CONDI_PER_STACK = 30;
const FURY_CRIT_CHANCE = 25;        // percentage points (PvE)
const FURY_CRIT_CHANCE_WVW = 20;    // percentage points (WvW)
const BERSERK_CRIT_CHANCE = 5;      // base crit from Berserk mode (Berserker elite spec)

// ---------------------------------------------------------------------------
// Stacking sigils
// ---------------------------------------------------------------------------
const _ALL_STATS = ["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "Expertise", "Concentration", "HealingPower"];
const STACKING_SIGIL_DEFS = [
  { id: 24575, key: "sigilBloodlust",   label: "Bloodlust",        stat: "Power",           perStack: 10, maxStacks: 25 },
  { id: 81045, key: "sigilBounty",      label: "Bounty",           stat: "Concentration",   perStack: 9,  maxStacks: 25 },
  { id: 24578, key: "sigilCorruption",  label: "Corruption",       stat: "ConditionDamage", perStack: 10, maxStacks: 25 },
  { id: 67341, key: "sigilCruelty",     label: "Cruelty",          stat: "Ferocity",        perStack: 10, maxStacks: 25 },
  { id: 24584, key: "sigilBenevolence", label: "Benevolence",      modifier: "Outgoing Healing", perStack: 0.5, maxStacks: 25 },
  { id: 24582, key: "sigilLife",        label: "Life",             stat: "HealingPower",    perStack: 10, maxStacks: 25 },
  { id: 49457, key: "sigilMomentum",    label: "Momentum",         stat: "Toughness",       perStack: 5,  maxStacks: 25 },
  { id: 24580, key: "sigilPerception",  label: "Perception",       stat: "Precision",       perStack: 10, maxStacks: 25 },
  { id: 86170, key: "sigilStars",       label: "Stars",            allStats: _ALL_STATS,    perStack: 2,  maxStacks: 25 },
];

// ---------------------------------------------------------------------------
// Signet passive buffs
// ---------------------------------------------------------------------------
// The GW2 API does not expose these values; maintained as a static map.
// Key = skill ID, value = { stat, value }.
// Source: https://wiki.guildwars2.com/wiki/Signet (PvE values, all 180 as of 2025-06).
const SIGNET_PASSIVE_BUFFS = new Map([
  // Guardian
  [9093,  { stat: "Power",           value: 180 }], // Bane Signet
  [9151,  { stat: "ConditionDamage", value: 180 }], // Signet of Wrath
  [9163,  { stat: "Concentration",   value: 180 }], // Signet of Mercy
  // Warrior
  [14404, { stat: "Power",           value: 180 }], // Signet of Might
  [14410, { stat: "Precision",       value: 180 }], // Signet of Fury
  // Ranger
  [12500, { stat: "Toughness",       value: 180 }], // Signet of Stone
  [12491, { stat: "Ferocity",        value: 180 }], // Signet of the Wild
  // Thief
  [13046, { stat: "Power",           value: 180 }], // Assassin's Signet
  [13062, { stat: "Precision",       value: 180 }], // Signet of Agility
  // Elementalist
  [5542,  { stat: "Precision",       value: 180 }], // Signet of Fire
  // Mesmer
  [10232, { stat: "ConditionDamage", value: 180 }], // Signet of Domination
  [10234, { stat: "Expertise",       value: 180 }], // Signet of Midnight
  // Necromancer
  [10622, { stat: "Power",           value: 180 }], // Signet of Spite
]);

// ---------------------------------------------------------------------------
// Signet active effects
// ---------------------------------------------------------------------------
// What each signet grants when its active skill is used (not the passive).
// Key = skill ID. Value:
//   stats: { StatKey: amount } — direct flat stat boost for the active duration
//   boons: { might: N }       — N stacks of Might (each gives +30 Power, +30 CondiDmg)
//   boons: { fury: true }     — Fury boon (25% crit chance PvE / 20% WvW)
// Signets whose active has no stat-relevant effect (launch, immob, revive, etc.) are omitted.
// Source: https://wiki.guildwars2.com/wiki/Signet (PvE values)
const SIGNET_ACTIVE_EFFECTS = new Map([
  // Warrior
  [14404, { boons: { might: 10 } }],                          // Signet of Might → 10× Might
  [14410, { stats: { Precision: 360, Ferocity: 360 } }],      // Signet of Fury  → +360 Prec, +360 Fero
  // Ranger
  [12491, { boons: { might: 10 } }],                          // Signet of the Wild → 10× Might
  // Elementalist
  [5542,  { boons: { fury: true } }],                         // Signet of Fire  → Fury
]);

// ---------------------------------------------------------------------------
// Boon / condition name sets
// ---------------------------------------------------------------------------
const BOON_NAMES = new Set([
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
]);

const CONDITION_NAMES = new Set([
  "Bleeding", "Blind", "Blinded", "Burning", "Chill", "Chilled",
  "Confusion", "Cripple", "Crippled", "Fear", "Immobile", "Immobilize", "Immobilized",
  "Poison", "Poisoned", "Slow", "Taunt", "Torment",
  "Vulnerability", "Weakness",
]);

const CONDITION_NAME_NORMALIZE = {
  Blind: "Blinded", Chill: "Chilled", Cripple: "Crippled",
  Immobilize: "Immobile", Immobilized: "Immobile", Poison: "Poisoned",
};

const BOON_DISPLAY_ORDER = [
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
];

// ---------------------------------------------------------------------------
// Stat key lists
// ---------------------------------------------------------------------------
const ALL_STAT_KEYS = [
  "Power", "Precision", "Toughness", "Vitality", "Ferocity",
  "ConditionDamage", "HealingPower", "Expertise", "Concentration",
];

// ---------------------------------------------------------------------------
// CONVERSION_TARGET_MAP — GW2 API AttributeConversion target names → our stat keys
// Source: src/renderer/modules/stats.js
// ---------------------------------------------------------------------------
const CONVERSION_TARGET_MAP = {
  BoonDuration:      "Concentration",
  ConditionDuration: "Expertise",
  CritDamage:        "Ferocity",
  Healing:           "HealingPower",
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  STAT_COMBOS,
  STAT_COMBOS_BY_LABEL,
  getStatCombo,
  getEffectiveStats,
  SLOT_WEIGHTS,
  TWO_HAND_WEIGHTS,
  LAND_ONLY_SLOTS,
  AQUATIC_SLOTS,
  PROFESSION_WEIGHT,
  ARMOR_DEFENSE_BY_WEIGHT,
  PROFESSION_BASE_HP,
  WEAPON_STRENGTH_MIDPOINT,
  BUFF_FACT_TYPES,
  MIGHT_POWER_PER_STACK,
  MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE,
  FURY_CRIT_CHANCE_WVW,
  BERSERK_CRIT_CHANCE,
  STACKING_SIGIL_DEFS,
  SIGNET_PASSIVE_BUFFS,
  SIGNET_ACTIVE_EFFECTS,
  BOON_NAMES,
  CONDITION_NAMES,
  CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER,
  ALL_STAT_KEYS,
  CONVERSION_TARGET_MAP,
};
