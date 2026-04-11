"use strict";

// Canonical profession order — matches spec profession table.
const PROFESSIONS = [
  "Guardian", "Warrior", "Engineer", "Ranger", "Thief",
  "Elementalist", "Mesmer", "Necromancer", "Revenant",
];
const _profIdx = new Map(PROFESSIONS.map((p, i) => [p, i]));
function professionToIndex(name) { return _profIdx.get(name) ?? -1; }
function indexToProfession(idx) { return PROFESSIONS[idx] || ""; }

// Weapon type table — index 0 = empty, 1-19 = weapons.
const WEAPONS = [
  "",
  "axe", "dagger", "mace", "pistol", "sword", "scepter",
  "focus", "shield", "torch", "warhorn",
  "greatsword", "hammer", "longbow", "rifle", "shortbow", "staff",
  "harpoon", "spear", "trident",
];
const _weapIdx = new Map(WEAPONS.map((w, i) => [w, i]));
function weaponToIndex(id) { return _weapIdx.get(id) ?? 0; }
function indexToWeapon(idx) { return WEAPONS[idx] || ""; }
const TWO_HANDED = new Set([11, 12, 13, 14, 15, 16, 18]);
function isWeaponTwoHanded(idx) { return TWO_HANDED.has(idx); }

// Stat combo table — index 0 = empty, 1-21 = stats.
const STAT_COMBOS_ORDERED = [
  "",
  "Berserker's", "Marauder's", "Assassin's", "Valkyrie", "Dragon's",
  "Viper's", "Grieving", "Sinister", "Dire", "Rabid", "Carrion",
  "Trailblazer's", "Knight's", "Soldier's", "Cleric's", "Minstrel's",
  "Harrier's", "Ritualist's", "Seraph", "Zealot's", "Celestial",
];
const _statIdx = new Map(STAT_COMBOS_ORDERED.map((s, i) => [s, i]));
function statToIndex(label) { return _statIdx.get(label) ?? 0; }
function indexToStat(idx) { return STAT_COMBOS_ORDERED[idx] || ""; }

// Relic table — sorted alphabetically per spec.
const _relicLabels = require("./relics");
const RELICS_SORTED = ["", ..._relicLabels];
const _relicIdx = new Map(RELICS_SORTED.map((r, i) => [r, i]));
function relicToIndex(label) { return _relicIdx.get(label) ?? 0; }
function indexToRelic(idx) { return RELICS_SORTED[idx] || ""; }

// Food table — ordered by array position in constants.js GW2_FOOD.
const FOOD_ORDERED = [
  { label: "", id: 0 },
  { label: "Peppercorn-Crusted Sous-Vide Steak", id: 91734 },
  { label: "Cilantro Lime Sous-Vide Steak", id: 91805 },
  { label: "Bowl of Sweet and Spicy Butternut Squash Soup", id: 41569 },
  { label: "Plate of Truffle Steak Dinner", id: 12469 },
  { label: "Bowl of Fancy Potato and Leek Soup", id: 12485 },
  { label: "Plate of Beef Rendang", id: 86997 },
  { label: "Plate of Kimchi Pancakes", id: 96578 },
  { label: "Mint-Pear Cured Meat Flatbread", id: 91703 },
  { label: "Clove-Spiced Pear and Cured Meat Flatbread", id: 91784 },
  { label: "Mint and Veggie Flatbread", id: 91727 },
  { label: "Delicious Rice Ball", id: 68634 },
  { label: "Eggs Benedict with Mint-Parsley Sauce", id: 91758 },
  { label: "Bowl of Fruit Salad with Mint Garnish", id: 91690 },
  { label: "Bowl of Seaweed Salad", id: 12471 },
];
const _foodIdx = new Map(FOOD_ORDERED.map((f, i) => [f.label, i]));
function foodToIndex(label) { return _foodIdx.get(label) ?? 0; }
function indexToFood(idx) { return FOOD_ORDERED[idx] || FOOD_ORDERED[0]; }

// Utility buff table
const UTILITY_ORDERED = [
  { label: "", id: 0 },
  { label: "Superior Sharpening Stone", id: 78305 },
  { label: "Furious Sharpening Stone", id: 67530 },
  { label: "Bountiful Sharpening Stone", id: 67531 },
  { label: "Bountiful Maintenance Oil", id: 67528 },
  { label: "Furious Maintenance Oil", id: 67529 },
];
const _utilIdx = new Map(UTILITY_ORDERED.map((u, i) => [u.label, i]));
function utilityToIndex(label) { return _utilIdx.get(label) ?? 0; }
function indexToUtility(idx) { return UTILITY_ORDERED[idx] || UTILITY_ORDERED[0]; }

// Revenant legend string → index mapping.
const LEGEND_STRINGS = ["", "Legend1", "Legend2", "Legend3", "Legend4", "Legend5", "Legend6", "Legend7"];
const _legIdx = new Map(LEGEND_STRINGS.map((l, i) => [l, i]));
function legendStringToIndex(str) { return _legIdx.get(str) ?? 0; }
function indexToLegendString(idx) { return LEGEND_STRINGS[idx] || ""; }

module.exports = {
  PROFESSIONS, professionToIndex, indexToProfession,
  WEAPONS, weaponToIndex, indexToWeapon, isWeaponTwoHanded,
  STAT_COMBOS_ORDERED, statToIndex, indexToStat,
  relicToIndex, indexToRelic,
  FOOD_ORDERED, foodToIndex, indexToFood,
  UTILITY_ORDERED, utilityToIndex, indexToUtility,
  LEGEND_STRINGS, legendStringToIndex, indexToLegendString,
};
