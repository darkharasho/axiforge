// GW2 CDN and wiki image base URLs
export const _RW = "https://render.guildwars2.com/file";
export const _WK = "https://wiki.guildwars2.com/images";

// Conduit (spec unknown) F2 skill variant mapping: legend swap skill ID → Release Potential skill ID.
// Each stance has two known swap skill IDs (active/inactive forms); both map to the same variant.
export const CONDUIT_F2_BY_SWAP = new Map([
  [27659, 78845], [28134, 78845], // Legendary Assassin Stance → Release Potential: Assassin
  [26650, 78895], [28419, 78895], // Legendary Dwarf Stance    → Release Potential: Warrior
  [28376, 78615], [28494, 78615], // Legendary Demon Stance    → Release Potential: Mesmer
  [28141, 78501], [28195, 78501], // Legendary Centaur Stance  → Release Potential: Monk
  [76610, 78661],                 // Legendary Entity Stance   → Release Potential: Dervish
]);

// For 4-stat combos: first 2 stats are major (0.3 multiplier), last 2 are minor (0.165 multiplier)
export const STAT_COMBOS = [
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
  { label: "Crusader",       stats: ["Power", "Toughness", "Ferocity", "HealingPower"] },
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
  { label: "Giver's",       stats: ["Toughness", "HealingPower", "Concentration"] },
  { label: "Captain's",     stats: ["Toughness", "Power", "HealingPower"] },
  { label: "Vigilant",      stats: ["Power", "Toughness", "Concentration"] },
  { label: "Apostate's",    stats: ["ConditionDamage", "Toughness", "HealingPower"] },
  { label: "Plaguedoctor's", stats: ["ConditionDamage", "Vitality", "HealingPower", "Concentration"] },
  { label: "Marshal's",     stats: ["Power", "HealingPower", "Precision", "ConditionDamage"] },
  { label: "Demolisher",    stats: ["Power", "Precision", "Toughness", "Ferocity"] },
  { label: "Commander's",   stats: ["Power", "Precision", "Toughness", "Concentration"] },
];

// In WvW, Celestial gear does not grant Expertise or Concentration.
const WVW_CELESTIAL_EXCLUDED = new Set(["Expertise", "Concentration"]);

/**
 * Return the effective stats array for a combo, accounting for game-mode restrictions.
 * In WvW, Celestial excludes Expertise and Concentration.
 */
export function getEffectiveStats(combo, gameMode) {
  if (!combo) return [];
  if (gameMode === "wvw" && combo.label === "Celestial") {
    return combo.stats.filter((s) => !WVW_CELESTIAL_EXCLUDED.has(s));
  }
  return combo.stats;
}

export const STAT_COMBOS_BY_LABEL = new Map(
  STAT_COMBOS.flatMap((c) => {
    const entries = [[c.label, c]];
    // Add alias without "'s" so imported builds (e.g. "Wanderer") resolve correctly
    if (c.label.endsWith("'s")) entries.push([c.label.slice(0, -2), c]);
    return entries;
  })
);

// Ascended/Legendary stat weights per slot.
// p/s = 3-stat major/minor; p4/s4 = 4-stat major/minor; c = Celestial per-stat.
// Derived from GW2 API attribute_adjustment × stat multipliers (0.35/0.25/0.3/0.165).
export const SLOT_WEIGHTS = {
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
export const TWO_HAND_WEIGHTS = { p: 251, s: 179, p4: 215, s4: 118, c: 118 };

export const EQUIP_ARMOR_SLOTS = [
  { key: "head",      label: "Head",      icon: "Head_slot.png" },
  { key: "shoulders", label: "Shoulders", icon: "Shoulder_slot.png" },
  { key: "chest",     label: "Chest",     icon: "Chest_slot.png" },
  { key: "hands",     label: "Hands",     icon: "Hand_slot.png" },
  { key: "legs",      label: "Legs",      icon: "Leg_slot.png" },
  { key: "feet",      label: "Feet",      icon: "Feet_slot.png" },
];

export const EQUIP_WEAPON_SETS = [
  [{ key: "mainhand1", label: "Main Hand", hand: "main" }, { key: "offhand1", label: "Off Hand", hand: "off" }],
  [{ key: "mainhand2", label: "Main Hand", hand: "main" }, { key: "offhand2", label: "Off Hand", hand: "off" }],
];

export const GW2_WEAPONS = [
  { id: "axe",        label: "Axe",        hand: "main",    icon: `${_WK}/b/b5/Bandit_Cleaver.png` },
  { id: "dagger",     label: "Dagger",      hand: "either",  icon: `${_WK}/a/ac/Bandit_Shiv.png` },
  { id: "mace",       label: "Mace",        hand: "either",  icon: `${_WK}/b/b3/Bandit_Mallet.png` },
  { id: "pistol",     label: "Pistol",      hand: "either",  icon: `${_WK}/f/f3/Bandit_Revolver.png` },
  { id: "sword",      label: "Sword",       hand: "main",    icon: `${_WK}/e/e1/Bandit_Slicer.png` },
  { id: "scepter",    label: "Scepter",     hand: "main",    icon: `${_WK}/9/95/Bandit_Baton.png` },
  { id: "focus",      label: "Focus",       hand: "off",     icon: `${_WK}/d/da/Bandit_Focus.png` },
  { id: "shield",     label: "Shield",      hand: "off",     icon: `${_WK}/7/7c/Bandit_Ward.png` },
  { id: "torch",      label: "Torch",       hand: "off",     icon: `${_WK}/7/7e/Bandit_Torch.png` },
  { id: "warhorn",    label: "Warhorn",     hand: "off",     icon: `${_WK}/3/31/Bandit_Bugle.png` },
  { id: "greatsword", label: "Greatsword",  hand: "two",     icon: `${_WK}/0/0b/Bandit_Sunderer.png` },
  { id: "hammer",     label: "Hammer",      hand: "two",     icon: `${_WK}/f/fb/Bandit_Demolisher.png` },
  { id: "longbow",    label: "Longbow",     hand: "two",     icon: `${_WK}/2/2d/Bandit_Longbow.png` },
  { id: "rifle",      label: "Rifle",       hand: "two",     icon: `${_WK}/3/37/Bandit_Musket.png` },
  { id: "shortbow",   label: "Short Bow",   hand: "two",     icon: `${_WK}/2/2f/Bandit_Short_Bow.png` },
  { id: "staff",      label: "Staff",       hand: "two",     icon: `${_WK}/9/98/Bandit_Spire.png` },
  { id: "harpoon",    label: "Harpoon Gun", hand: "aquatic", icon: `${_WK}/2/20/Bandit_Harpoon_Gun.png` },
  { id: "spear",      label: "Spear",       hand: "two",     icon: `${_WK}/c/c9/Bandit_Spear.png` },
  { id: "trident",    label: "Trident",     hand: "aquatic", icon: `${_WK}/6/66/Bandit_Trident.png` },
];

// Exotic level 80 weapon strength midpoints (avg of min/max per wiki.guildwars2.com/wiki/Weapon_strength).
export const WEAPON_STRENGTH_MIDPOINT = {
  axe: 952.5, dagger: 952.5, mace: 952.5, pistol: 952.5, sword: 952.5, scepter: 952.5,
  focus: 857.5, shield: 857.5, torch: 857.5, warhorn: 857,
  greatsword: 1047.5, hammer: 1048, longbow: 1000, rifle: 1095.5, shortbow: 952.5, staff: 1048,
  spear: 952.5, trident: 952.5, harpoon: 952.5,
};

export const EQUIP_TRINKET_SLOTS = [
  { key: "back",       label: "Back",        icon: "Back_slot.png",    filledIcon: "https://render.guildwars2.com/file/5EBEA1A467236237FCBACDC09969647956C4A371/1701118.png" },
  { key: "amulet",     label: "Amulet",      icon: "Amulet_slot.png",  filledIcon: "https://render.guildwars2.com/file/4944FD054FD80D805B0BFFB2DA60363A7DD31FDB/1614376.png" },
  { key: "ring1",      label: "Ring 1",      icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png" },
  { key: "ring2",      label: "Ring 2",      icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png" },
  { key: "accessory1", label: "Accessory 1", icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png" },
  { key: "accessory2", label: "Accessory 2", icon: "Trinket_slot.png", filledIcon: "https://render.guildwars2.com/file/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png" },
];

export const EQUIP_UNDERWATER_SLOTS = [
  { key: "breather", label: "Breather",  icon: `${_WK}/8/88/Breathing_apparatus_slot.png`, filledIcon: `${_WK}/0/08/Selachimorpha.png` },
  { key: "aquatic1", label: "Weapon 1",  hand: "aquatic" },
  { key: "aquatic2", label: "Weapon 2",  hand: "aquatic" },
];

// Underwater mode constants
export const MECHANIST_DEPTH_CHARGES_ID = 63210;
export const MECHANIST_SPEC_ID = 70;

// Revenant legends blocked underwater (legend string IDs from GW2 API)
// Legend1 = Glint (Herald elite spec, spec ID 52), Legend5 = Kalla (Renegade elite spec, spec ID 63)
export const UNDERWATER_BLOCKED_LEGENDS = new Set(["Legend1", "Legend5"]);

// Ranger pets usable underwater (GW2 API has no type field — this is hardcoded).
// Aquatic-only: Shark, Armor Fish, Jellyfish variants
// Amphibious (land + water): all Drakes, Siege Turtle
export const AQUATIC_PET_IDS = new Set([
  7, 12, 18, 19, 45,          // Drakes: Salamander, Marsh, Ice, River, Reef
  21,                           // Shark
  40,                           // Armor Fish
  41, 42, 43,                   // Jellyfish: Blue, Red, Rainbow
  66,                           // Siege Turtle
]);

// Slot sets for stat computation mode switching
export const LAND_ONLY_SLOTS = new Set(["head", "mainhand1", "offhand1", "mainhand2", "offhand2"]);
export const AQUATIC_SLOTS = new Set(["breather", "aquatic1", "aquatic2"]);

export const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

export const PROFESSION_THEMES = {
  Guardian: "prof-guardian",
  Warrior: "prof-warrior",
  Necromancer: "prof-necromancer",
  Engineer: "prof-engineer",
  Ranger: "prof-ranger",
  Thief: "prof-thief",
  Mesmer: "prof-mesmer",
  Elementalist: "prof-elementalist",
  Revenant: "prof-revenant",
};

// Total defense from a full set of level 80 Ascended/Legendary armor (6 pieces).
// Armor (derived stat) = Toughness + total defense.
export const ARMOR_DEFENSE_BY_WEIGHT = { light: 967, medium: 1118, heavy: 1271 };

const _R = "https://render.guildwars2.com/file";
export const LEGENDARY_ARMOR_ICONS = {
  light: {
    head:      `${_R}/06146C9BD029041178F50B5D9ACD0A76E7051408/1634576.png`,
    shoulders: `${_R}/A77403E5F0EB03E46E686B12297A04707AF50278/1634579.png`,
    chest:     `${_R}/C8FB494379CC98171EFB0F13923CACFD047743B3/1634574.png`,
    hands:     `${_R}/9703DBC0926F6BB4072032E6B55BE593F6B750CD/1634575.png`,
    legs:      `${_R}/65A4D3A41592D10EEABD0BC0D611F13A383B0261/1634577.png`,
    feet:      `${_R}/FD60D4E3986FA46F4FEBB8131B65159195260B19/1634578.png`,
  },
  medium: {
    head:      `${_R}/49092A1358E528DEC67EFA1C090546ED034642E2/1634588.png`,
    shoulders: `${_R}/CF7609512FC6527D805F2B74F26AF4549FF4E808/1634591.png`,
    chest:     `${_R}/57360F35D1210D12010F6AE772382450A07D08F6/1634586.png`,
    hands:     `${_R}/C57E5E5FA69261A2503CBB50080A6C023A155C49/1634587.png`,
    legs:      `${_R}/EBD907C061747927AE062D1B41BC13D0EAF14AD5/1634589.png`,
    feet:      `${_R}/BF4C6A48BA02BD6D6AC32F1E9C3F32A50399E336/1634590.png`,
  },
  heavy: {
    head:      `${_R}/2695A8E44B7F07EF15A20857790EFCA91513F5F0/1634565.png`,
    shoulders: `${_R}/0F0F4BE73C9316BAA4956A3AA622CB0AE84D9CEA/1634567.png`,
    chest:     `${_R}/DACF9B1ACBE8687B6B31ABC0CF295301120D7A67/1634563.png`,
    hands:     `${_R}/A5DD0D661970F02CC26D04B510C7C94259B99520/1634564.png`,
    legs:      `${_R}/EA9294557C175A43567906721E43962EC4B12D34/1634566.png`,
    feet:      `${_R}/E895D40AE0D1A500FFFDB955C27A98FF687AA4C1/1634562.png`,
  },
};

export const GW2_WEAPONS_BY_ID    = new Map(GW2_WEAPONS.map((w) => [w.id, w]));

export const PROFESSION_CONCEPT_ART = {
  Elementalist: `${_WK}/5/5e/Elementalist_04_concept_art.png`,
  Mesmer:       `${_WK}/4/4a/Mesmer_04_concept_art.png`,
  Necromancer:  `${_WK}/4/43/Necromancer_04_concept_art.png`,
  Guardian:     `${_WK}/8/88/Guardian_04_concept_art.png`,
  Warrior:      `${_WK}/5/56/Warrior_04_concept_art.png`,
  Ranger:       `${_WK}/f/f5/Ranger_04_concept_art.png`,
  Thief:        `${_WK}/3/35/Thief_04_concept_art.png`,
  Engineer:     `${_WK}/e/e5/Engineer_04_concept_art.png`,
  Revenant:     `${_WK}/1/18/Revenant_02_concept_art.jpg`,
};

// Base HP at level 80 EXCLUDING base vitality contribution.
// Formula: totalHP = baseHP + (Vitality * 10), where base Vitality = 1000.
// High (9212): Warrior, Necromancer → 9212 + 10000 = 19212
// Medium (5922): Revenant, Engineer, Ranger, Mesmer → 5922 + 10000 = 15922
// Low (1645): Guardian, Thief, Elementalist → 1645 + 10000 = 11645
export const PROFESSION_BASE_HP = {
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

// Attributes panel stat display order — matches in-game stat doll (issue #230).
// Power, Toughness, Vitality come first; Precision/Crit Chance follows after Health.
// Row keys in display order. ConditionDamage shares a row with HealingPower (right cell).
export const STAT_DISPLAY_KEYS = [
  "Power", "Toughness", "Vitality", "Precision",
  "Ferocity", "ConditionDamage", "Expertise", "Concentration",
];

export const ANTIQUARY_OFFENSIVE_ARTIFACTS = [
  76582,  // Metal Legion Guitar
  76550,  // Forged Surfer Dash
  77288,  // Mistburn Mortar
  77192,  // Summon Kryptis Turret
];
export const ANTIQUARY_DEFENSIVE_ARTIFACTS = [
  76702,  // Exalted Hammer
  76816,  // Chak Shield
  76800,  // Holo-Dancer Decoy
  76733,  // Zephyrite Sun Crystal (non-F2 slots use variant 78309 instead)
];
// Prolific Plunderer (trait 2346, tier 1): grants an additional artifact slot (F4) on each draw.
export const ANTIQUARY_PROLIFIC_PLUNDERER_TRAIT_ID = 2346;

// Ranger F1–F3 skills are pet-family-dependent. The GW2 API does not expose pet families,
// and all Ranger Profession_1–3 skills are tagged spec=55 in the API even though they apply
// to Core Ranger, Druid, and Untamed as well. This map provides the authoritative lookup.
// Keys are pet IDs; values are {p1, p2, p3} skill IDs for Profession_1/2/3 (F1/F2/F3).
// p3 is archetype-based (Ferocious/Stout/Deadly/Versatile/Supportive) — same within a family.
// p4 (Eternal Bond 59554) is Soulbeast-only and handled separately via eliteSpecId check.
// F3 (Beast skill) is determined by each pet's individual archetype, not family.
// Archetype → F3 skill: Stout=45797, Deadly=40588, Versatile=43375, Ferocious=40729, Supportive=44626
// F1/F2 are shared per family (from Ranger profession API), except newer pets with unique IDs.
export const RANGER_PET_FAMILY_SKILLS = new Map([
  // === Avian (p1: Swoop 44991, p2: 42042) ===
  [44, { p1: 44991, p2: 42042, p3: 40588 }],  // Hawk — Deadly
  [10, { p1: 44991, p2: 42042, p3: 43375 }],  // Raven — Versatile
  [32, { p1: 44991, p2: 42042, p3: 43375 }],  // White Raven — Versatile
  [30, { p1: 44991, p2: 42042, p3: 44626 }],  // Owl — Supportive
  [31, { p1: 44991, p2: 42042, p3: 40729 }],  // Eagle — Ferocious
  [72, { p1: 79203, p2: 78091, p3: 43375 }],  // Raptor Swiftwing (newer) — Versatile
  // === Ursine/Bear (p1: Bite 43136, p2: 43060) ===
  [23, { p1: 43136, p2: 43060, p3: 45797 }],  // Black Bear — Stout
  [20, { p1: 43136, p2: 43060, p3: 40588 }],  // Murellow — Deadly
  [24, { p1: 43136, p2: 43060, p3: 43375 }],  // Polar Bear — Versatile
  [25, { p1: 43136, p2: 43060, p3: 40729 }],  // Arctodus — Ferocious
  [5,  { p1: 43136, p2: 43060, p3: 44626 }],  // Brown Bear — Supportive
  // === Canine (p1: Crippling Leap 43726, p2: 42894) ===
  [8,  { p1: 43726, p2: 42894, p3: 45797 }],  // Alpine Wolf — Stout
  [29, { p1: 43726, p2: 42894, p3: 40588 }],  // Wolf — Deadly
  [4,  { p1: 43726, p2: 42894, p3: 43375 }],  // Krytan Drakehound — Versatile
  [28, { p1: 43726, p2: 42894, p3: 40729 }],  // Hyena — Ferocious
  [22, { p1: 43726, p2: 42894, p3: 44626 }],  // Fern Hound — Supportive
  // === Devourer (p1: Tail Lash 43068, p2: 41461) ===
  [6,  { p1: 43068, p2: 41461, p3: 40588 }],  // Carrion Devourer — Deadly
  [26, { p1: 43068, p2: 41461, p3: 43375 }],  // Whiptail Devourer — Versatile
  [27, { p1: 43068, p2: 41461, p3: 40729 }],  // Lashtail Devourer — Ferocious
  // === Drake (p1: Chomp 41537, p2: 41575) ===
  [18, { p1: 41537, p2: 41575, p3: 45797 }],  // Ice Drake — Stout
  [7,  { p1: 41537, p2: 41575, p3: 40588 }],  // Salamander Drake — Deadly
  [45, { p1: 41537, p2: 41575, p3: 43375 }],  // Reef Drake — Versatile
  [19, { p1: 41537, p2: 41575, p3: 40729 }],  // River Drake — Ferocious
  [12, { p1: 41537, p2: 41575, p3: 44626 }],  // Marsh Drake — Supportive
  // === Feline (p1: Bite 40625, p2: 44514) ===
  [9,  { p1: 40625, p2: 44514, p3: 45797 }],  // Snow Leopard — Stout
  [3,  { p1: 40625, p2: 44514, p3: 40588 }],  // Lynx — Deadly
  [11, { p1: 40625, p2: 44514, p3: 43375 }],  // Jaguar — Versatile
  [54, { p1: 40625, p2: 44514, p3: 43375 }],  // Cheetah — Versatile
  [47, { p1: 40625, p2: 44514, p3: 40729 }],  // Tiger — Ferocious
  [55, { p1: 40625, p2: 44514, p3: 40729 }],  // Sand Lion — Ferocious
  [1,  { p1: 40625, p2: 44514, p3: 44626 }],  // Jungle Stalker — Supportive
  [63, { p1: 40625, p2: 67382, p3: 45797 }],  // White Tiger — Stout, unique F2: Phase Pounce
  [70, { p1: 73733, p2: 73938, p3: 40729 }],  // Warclaw (newer) — Ferocious, unique F1/F2
  // === Jellyfish/aquatic (p1: Healing Cloud 43186, p2: 41837) ===
  [41, { p1: 43186, p2: 41837, p3: 40588 }],  // Blue Jellyfish — Deadly
  [43, { p1: 43186, p2: 41837, p3: 40588 }],  // Rainbow Jellyfish — Deadly
  [42, { p1: 43186, p2: 41837, p3: 43375 }],  // Red Jellyfish — Versatile
  // === Moa (p1: Harmonic Cry 44617, p2: 43548) ===
  [13, { p1: 44617, p2: 43548, p3: 45797 }],  // Blue Moa — Stout
  [15, { p1: 44617, p2: 43548, p3: 43375 }],  // Pink Moa — Versatile
  [16, { p1: 44617, p2: 43548, p3: 43375 }],  // Black Moa — Versatile
  [17, { p1: 44617, p2: 43548, p3: 40729 }],  // Red Moa — Ferocious
  [14, { p1: 44617, p2: 43548, p3: 44626 }],  // White Moa — Supportive
  // === Porcine (p1: Maul 41406, p2: 46432) ===
  [38, { p1: 41406, p2: 46432, p3: 45797 }],  // Siamoth — Stout
  [37, { p1: 41406, p2: 46432, p3: 40588 }],  // Warthog — Deadly
  [2,  { p1: 41406, p2: 46432, p3: 43375 }],  // Boar — Versatile
  [39, { p1: 41406, p2: 46432, p3: 40729 }],  // Pig — Ferocious
  [64, { p1: 0,     p2: 64882, p3: 44626 }],  // Wallow (newer) — Supportive; F1 "Vampiric Bite" missing from API
  // === Spider (p1: Entangling Web 44097, p2: 43671) ===
  [33, { p1: 44097, p2: 43671, p3: 40588 }],  // Forest Spider — Deadly
  [34, { p1: 44097, p2: 43671, p3: 43375 }],  // Jungle Spider — Versatile
  [36, { p1: 44097, p2: 43671, p3: 43375 }],  // Black Widow Spider — Versatile
  [35, { p1: 44097, p2: 43671, p3: 40729 }],  // Cave Spider — Ferocious
  // === Wyvern (p1: Tail Lash 46386, p2: Wing Buffet 41908) ===
  [48, { p1: 46386, p2: 41908, p3: 43375 }],  // Electric Wyvern — Versatile
  [51, { p1: 46386, p2: 41908, p3: 40588 }],  // Fire Wyvern — Deadly
  // === Unique pets ===
  [40, { p1: 42717, p2: 44885, p3: 45797 }],  // Armor Fish — Stout
  [21, { p1: 42797, p2: 44360, p3: 40588 }],  // Shark — Deadly
  [52, { p1: 41206, p2: 45479, p3: 40588 }],  // Bristleback — Deadly
  [61, { p1: 44384, p2: 40111, p3: 40588 }],  // Fanged Iboga — Deadly
  [69, { p1: 72851, p2: 72636, p3: 40588 }],  // Spinegazer (newer) — Deadly
  [71, { p1: 75771, p2: 75814, p3: 40588 }],  // Janthiri Bee (newer) — Deadly
  [67, { p1: 71282, p2: 70889, p3: 43375 }],  // Aether Hunter (newer) — Versatile
  [46, { p1: 42907, p2: 40255, p3: 40729 }],  // Smokescale — Ferocious
  [59, { p1: 41524, p2: 45743, p3: 40729 }],  // Rock Gazelle — Ferocious
  [68, { p1: 71499, p2: 71546, p3: 40729 }],  // Sky-Chak Striker (newer) — Ferocious
  [65, { p1: 64038, p2: 41908, p3: 40729 }],  // Phoenix (newer) — Ferocious
  [57, { p1: 43788, p2: 43701, p3: 44626 }],  // Jacaranda — Supportive
  [66, { p1: 64699, p2: 66258, p3: 44626 }],  // Siege Turtle (newer) — Supportive
]);

// Render CDN icon URLs for boons and conditions, used as fallback when fact.icon is absent.
export const BOON_CONDITION_ICONS = {
  // Boons
  Aegis:          `${_RW}/DFB4D1B50AE4D6A275B349E15B179261EE3EB0AF/102854.png`,
  Alacrity:       `${_RW}/4FDAC2113B500104121753EF7E026E45C141E94D/1938787.png`,
  Fury:           `${_RW}/96D90DF84CAFE008233DD1C2606A12C1A0E68048/102842.png`,
  Might:          `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  Protection:     `${_RW}/CD77D1FAB7B270223538A8F8ECDA1CFB044D65F4/102834.png`,
  Quickness:      `${_RW}/D4AB6401A6D6917C3D4F230764452BCCE1035B0D/1012835.png`,
  Regeneration:   `${_RW}/F69996772B9E18FD18AD0AABAB25D7E3FC42F261/102835.png`,
  Resistance:     `${_RW}/50BAC1B8E10CFAB9E749A5D910D4A9DCF29EBB7C/961398.png`,
  Resolution:     `${_RW}/D104A6B9344A2E2096424A3C300E46BC2926E4D7/2440718.png`,
  Stability:      `${_RW}/3D3A1C2D6D791C05179AB871902D28782C65C244/415959.png`,
  Swiftness:      `${_RW}/20CFC14967E67F7A3FD4A4B8722B4CF5B8565E11/102836.png`,
  Vigor:          `${_RW}/58E92EBAF0DB4DA7C4AC04D9B22BCA5ECF0100DE/102843.png`,
  // Conditions
  Bleeding:       `${_RW}/79FF0046A5F9ADA3B4C4EC19ADB4CB124D5F0021/102848.png`,
  Blinded:        `${_RW}/09770136BB76FD0DBE1CC4267DEED54774CB20F6/102837.png`,
  Burning:        `${_RW}/B47BF5803FED2718D7474EAF9617629AD068EE10/102849.png`,
  Chilled:        `${_RW}/28C4EC547A3516AF0242E826772DA43A5EAC3DF3/102839.png`,
  Confusion:      `${_RW}/289AA0A4644F0E044DED3D3F39CED958E1DDFF53/102880.png`,
  Crippled:       `${_RW}/070325E519C178D502A8160523766070D30C0C19/102838.png`,
  Fear:           `${_RW}/30307A6E766D74B6EB09EDA12A4A2DE50E4D76F4/102869.png`,
  Immobile:       `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Poisoned:       `${_RW}/559B0AF9FB5E1243D2649FAAE660CCB338AACC19/102840.png`,
  Slow:           `${_RW}/F60D1EF5271D7B9319610855676D320CD25F01C6/961397.png`,
  Taunt:          `${_RW}/02EED459AD65FAF7DF32A260E479C625070841B9/1228472.png`,
  Torment:        `${_RW}/10BABF2708CA3575730AC662A2E72EC292565B08/598887.png`,
  Vulnerability:  `${_RW}/3A394C1A0A3257EB27A44842DDEEF0DF000E1241/102850.png`,
  Weakness:       `${_RW}/6CB0E64AF9AA292E332A38C1770CE577E2CDE0E8/102853.png`,
  // Wiki spelling variants of standard conditions
  Blind:          `${_RW}/09770136BB76FD0DBE1CC4267DEED54774CB20F6/102837.png`,
  Cripple:        `${_RW}/070325E519C178D502A8160523766070D30C0C19/102838.png`,
  Chill:          `${_RW}/28C4EC547A3516AF0242E826772DA43A5EAC3DF3/102839.png`,
  Immobilize:     `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Immobilized:    `${_RW}/397A613651BFCA2832B6469CE34735580A2C120E/102844.png`,
  Poison:         `${_RW}/559B0AF9FB5E1243D2649FAAE660CCB338AACC19/102840.png`,
};

// Assumed boon stat effects (per GW2 wiki, level 80)
export const MIGHT_MAX_STACKS = 25;
export const STABILITY_MAX_STACKS = 25;

export const BOON_DISPLAY_ORDER = [
  "Aegis", "Alacrity", "Fury", "Might", "Protection", "Quickness",
  "Regeneration", "Resistance", "Resolution", "Stability", "Swiftness", "Vigor",
];

// Combo field type display colors — bg and text pairs matching the mockup
export const COMBO_FIELD_COLORS = {
  Fire:      { bg: "#5a3a2a", text: "#f96", border: "#7a5a3a", emoji: "\ud83d\udd25" },
  Water:     { bg: "#2a3a5a", text: "#6af", border: "#3a5a7a", emoji: "\ud83d\udca7" },
  Light:     { bg: "#5a5a3a", text: "#ee8", border: "#7a7a5a", emoji: "\u2728" },
  Dark:      { bg: "#3a2a3a", text: "#c8a", border: "#5a3a5a", emoji: "\ud83c\udf11" },
  Ethereal:  { bg: "#3a3a5a", text: "#aaf", border: "#5a5a7a", emoji: "\ud83d\udd2e" },
  Ice:       { bg: "#2a4a5a", text: "#8de", border: "#3a6a7a", emoji: "\u2744\ufe0f" },
  Lightning: { bg: "#5a5a2a", text: "#ee6", border: "#7a7a3a", emoji: "\u26a1" },
  Smoke:     { bg: "#3a3a3a", text: "#aaa", border: "#5a5a5a", emoji: "\ud83d\udca8" },
  Poison:    { bg: "#2a4a2a", text: "#8d8", border: "#3a6a3a", emoji: "\u2620\ufe0f" },
};

export const COMBO_FIELD_DISPLAY_ORDER = [
  "Fire", "Water", "Light", "Dark", "Ethereal", "Ice", "Lightning", "Smoke", "Poison",
];

// Combo finisher type display colors
export const COMBO_FINISHER_COLORS = {
  Blast:      { bg: "#4a3a5a", text: "#c8f", border: "#6a5a7a", emoji: "\ud83d\udca5" },
  Whirl:      { bg: "#3a4a4a", text: "#8dd", border: "#5a6a6a", emoji: "\ud83c\udf00" },
  Leap:       { bg: "#4a4a3a", text: "#dd8", border: "#6a6a5a", emoji: "\ud83e\uddb6" },
  Projectile: { bg: "#4a3a3a", text: "#d88", border: "#6a5a5a", emoji: "\u27a1\ufe0f" },
};

export const COMBO_FINISHER_DISPLAY_ORDER = ["Blast", "Whirl", "Leap", "Projectile"];

// Fallback icons keyed by GW2 API fact type, for facts missing fact.icon.
// Icons sourced from render.guildwars2.com via /v2/skills API responses.
export const FACT_TYPE_ICONS = {
  Damage:              `${_RW}/61AA4919C4A7990903241B680A69530121E994C7/156657.png`,
  Range:               `${_RW}/0AAB34BEB1C9F4A25EC612DDBEACF3E20B2810FA/156666.png`,
  Number:              `${_RW}/BBE8191A494B0352259C10EADFDACCE177E6DA5B/1770208.png`,
  Duration:            `${_RW}/7B2193ACCF77E56C13E608191B082D68AA0FAA71/156659.png`,
  Time:                `${_RW}/7B2193ACCF77E56C13E608191B082D68AA0FAA71/156659.png`,
  Recharge:            `${_RW}/D767B963D120F077C3B163A05DC05A7317D7DB70/156651.png`,
  Radius:              `${_RW}/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png`,
  Distance:            `${_RW}/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png`,
  StunBreak:           `${_RW}/DCF0719729165FD8910E034CA4E0780F90582D15/156654.png`,
  Unblockable:         `${_RW}/9352ED3244417304995F26CB01AE76BB7E547052/156661.png`,
  AttributeAdjust:     `${_RW}/D4347C52157B040943051D7E09DEAD7AF63D4378/156662.png`,
  AttributeConversion: `${_RW}/D4347C52157B040943051D7E09DEAD7AF63D4378/156662.png`,
  ComboFinisher:       `${_RW}/A513F3653D33FBA4220D2D307799F8A327A36A3B/156656.png`,
  ComboField:          `${_RW}/59E0DB6A699810641C959926ADFEF73E08CC255B/156655.png`,
  Percent:             `${_RW}/0AAB34BEB1C9F4A25EC612DDBEACF3E20B2810FA/156666.png`,
  // Generic fallback for Buff/condition types with unknown status names
  Buff:                `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  ApplyBuffCondition:  `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
  PrefixedBuff:        `${_RW}/2FA9DF9D6BC17839BBEA14723F1C53D645DDB5E1/102852.png`,
};
