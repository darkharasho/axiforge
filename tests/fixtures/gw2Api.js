/**
 * GW2 API mock fixtures for testing.
 * Covers all 9 professions with enough detail to exercise the key code paths
 * in gw2Data.js: spec overrides, slot overrides, bundle assignments,
 * elixir toolbelt overrides, Firebrand chapters, transform bundles, legends, pets.
 */

// ---------------------------------------------------------------------------
// PROFESSIONS
// ---------------------------------------------------------------------------

const MOCK_PROFESSIONS = {
  Warrior: {
    id: "Warrior", name: "Warrior",
    icon: "https://render.guildwars2.com/file/warrior-icon.png",
    icon_big: "https://render.guildwars2.com/file/warrior-icon-big.png",
    specializations: [4, 22, 51, 18, 61],
    skills: [
      { id: 14402, slot: "Heal",         specialization: 0,  type: "Heal" },
      { id: 14516, slot: "Utility",      specialization: 0,  type: "Utility" },
      { id: 14404, slot: "Elite",        specialization: 0,  type: "Elite" },
      { id: 14367, slot: "Profession_1", specialization: 0,  type: "Profession" }, // Sword core burst (Flurry)
      { id: 14375, slot: "Profession_1", specialization: 0,  type: "Profession" }, // Greatsword core burst (Arcing Slice)
      { id: 30682, slot: "Profession_1", specialization: 18, type: "Profession" }, // Sword primal burst (Flaming Flurry)
      { id: 29852, slot: "Profession_1", specialization: 18, type: "Profession" }, // Greatsword primal burst (Arc Divider)
      { id: 30185, slot: "Profession_2", specialization: 18, type: "Profession" }, // Berserk toggle
      { id: 42494, slot: "Profession_1", specialization: 61, type: "Profession" }, // Spellbreaker Sword burst (Flurry)
    ],
    weapons: {
      Sword: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 14360, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
      Shield: {
        flags: ["Offhand"],
        specialization: 0,
        skills: [{ id: 14521, slot: "Weapon_4", offhand: "", attunement: "" }],
      },
      Greatsword: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [{ id: 14447, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
      HarpoonGun: {
        flags: ["Aquatic", "TwoHand"],
        specialization: 0,
        skills: [{ id: 14489, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Engineer: {
    id: "Engineer", name: "Engineer",
    icon: "https://render.guildwars2.com/file/engineer-icon.png",
    icon_big: "https://render.guildwars2.com/file/engineer-icon-big.png",
    specializations: [6, 29, 38, 43, 57, 70, 80],
    skills: [
      // Heal
      { id: 5802, slot: "Heal",     specialization: 0,  type: "Heal" },
      // Utility elixirs — toolbelt_skill in API points to wrong Detonate variants
      { id: 5834, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir H
      { id: 5821, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir B
      { id: 5860, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir C
      { id: 5968, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir R
      { id: 5861, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir S
      { id: 5862, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir U
      { id: 5832, slot: "Utility",  specialization: 0,  type: "Utility" }, // Elixir X (no Toss)
      // Photon Forge (Holosmith F5)
      { id: 42938, slot: "Profession_5", specialization: 57, type: "Profession" },
      // Scrapper Function Gyro variants (API wrongly says spec=57)
      { id: 72103, slot: "Profession_5", specialization: 57, type: "Profession" },
      { id: 72114, slot: "Profession_5", specialization: 57, type: "Profession" },
      // Elite
      { id: 6161, slot: "Elite",    specialization: 0,  type: "Elite" },
    ],
    weapons: {
      Pistol: {
        flags: ["Mainhand", "Offhand"],
        specialization: 0,
        skills: [{ id: 5805, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
      Rifle: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [{ id: 5811, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Guardian: {
    id: "Guardian", name: "Guardian",
    icon: "https://render.guildwars2.com/file/guardian-icon.png",
    icon_big: "https://render.guildwars2.com/file/guardian-icon-big.png",
    specializations: [16, 46, 49, 27, 62, 65, 81],
    skills: [
      { id: 9083, slot: "Heal",           specialization: null, type: "Heal" },
      { id: 9168, slot: "Utility",        specialization: null, type: "Utility" },
      // Dragonhunter F skills — NOT here; discovered via minor trait 1848
      // Firebrand tomes (spec=62, from /v2/skills fallback)
      { id: 44364, slot: "Profession_1",  specialization: null, type: "Profession" }, // Tome of Justice
      { id: 41780, slot: "Profession_2",  specialization: null, type: "Profession" }, // Tome of Resolve
      { id: 42259, slot: "Profession_3",  specialization: null, type: "Profession" }, // Tome of Courage
      // Luminary Radiant Forge
      { id: 77073, slot: "Profession_1",  specialization: 81,   type: "Profession" }, // Enter Radiant Forge
      // Virtues (core)
      { id: 29887, slot: "Profession_1",  specialization: 27,   type: "Profession" }, // DH F1 (from trait)
      { id: 30783, slot: "Profession_2",  specialization: 27,   type: "Profession" }, // DH F2 (from trait)
      { id: 30029, slot: "Profession_3",  specialization: 27,   type: "Profession" }, // DH F3 (from trait)
      { id: 9,     slot: "Elite",         specialization: null, type: "Elite" },
    ],
    weapons: {
      Sword: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 9104, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [
      {
        id: 37, category: "EliteSpecializations",
        track: [
          { type: "Skill", skill_id: 30783 }, // Test of Faith (DH F2)
          { type: "Skill", skill_id: 30029 }, // Fragments of Faith (DH F3)
        ],
      },
      {
        id: 417, category: "EliteSpecializations",
        track: [
          { type: "Skill", skill_id: 44364 }, // Tome of Justice
          { type: "Skill", skill_id: 41780 }, // Tome of Resolve
          { type: "Skill", skill_id: 42259 }, // Tome of Courage
        ],
      },
    ],
  },

  Ranger: {
    id: "Ranger", name: "Ranger",
    icon: "https://render.guildwars2.com/file/ranger-icon.png",
    icon_big: "https://render.guildwars2.com/file/ranger-icon-big.png",
    specializations: [8, 25, 32, 30, 55, 72],
    skills: [
      { id: 5503, slot: "Heal",        specialization: 0,  type: "Heal" },
      { id: 12489, slot: "Utility",    specialization: 0,  type: "Utility" },
      { id: 12540, slot: "Elite",      specialization: 0,  type: "Elite" },
      // Untamed profession skills
      { id: 63209, slot: "Profession_1", specialization: 72, type: "Profession" },
      { id: 63258, slot: "Profession_2", specialization: 72, type: "Profession" },
      { id: 63094, slot: "Profession_3", specialization: 72, type: "Profession" },
      { id: 63147, slot: "Profession_5", specialization: 72, type: "Profession" },
      { id: 63344, slot: "Profession_5", specialization: 72, type: "Profession" },
    ],
    weapons: {
      Longbow: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [{ id: 12466, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Thief: {
    id: "Thief", name: "Thief",
    icon: "https://render.guildwars2.com/file/thief-icon.png",
    icon_big: "https://render.guildwars2.com/file/thief-icon-big.png",
    specializations: [28, 35, 44, 58, 71, 77],
    skills: [
      { id: 13050, slot: "Heal",             specialization: 0,  type: "Heal" },
      { id: 13082, slot: "Utility",          specialization: 0,  type: "Utility" },
      // Steal (core Thief F1)
      { id: 13132, slot: "Profession_1",     specialization: 0,  type: "Profession" },
      // Daredevil F1 (in profession.skills)
      { id: 30423, slot: "Profession_1",     specialization: 44, type: "Profession" },
      // Deadeye's Mark (Profession_1, spec=58 from /v2/skills; profession endpoint has no spec field)
      { id: 43390, slot: "Profession_1",     specialization: 0,  type: "Profession" },
      // Mercy (Deadeye utility skill, not a profession mechanic)
      { id: 41372, slot: "Utility",          specialization: 0,  type: "Utility" },
      // Specter Siphon at Profession_1 (not actually here — comes from extraSkillIds in gw2Data)
      // Antiquary (spec=77) F1 — Skritt Swipe replaces Steal; API returns specialization=77 correctly.
      { id: 77397, slot: "Profession_1",     specialization: 77, type: "Profession" }, // Skritt Swipe
      // Antiquary (spec=77) F2/F3 — API returns specialization=0 for these; KNOWN_SKILL_SPEC_OVERRIDES corrects to 77.
      { id: 77277, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Mistburn Mortar
      { id: 77288, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Mistburn Mortar (variant)
      { id: 76733, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Zephyrite Sun Crystal (F2)
      { id: 78309, slot: "Profession_3",     specialization: 0,  type: "Profession" }, // Zephyrite Sun Crystal (F3)
      { id: 77192, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Summon Kryptis Turret
      { id: 76900, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Summon Kryptis Turret (variant)
      { id: 76550, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Forged Surfer Dash
      { id: 76582, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Metal Legion Guitar
      { id: 76601, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Exalted Hammer (variant 1)
      { id: 76702, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Exalted Hammer (variant 2)
      { id: 76800, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Holo-Dancer Decoy
      { id: 76816, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Chak Shield
      { id: 76909, slot: "Profession_2",     specialization: 0,  type: "Profession" }, // Unstable Skritt Bomb
      { id: 13076, slot: "Elite",            specialization: 0,  type: "Elite" },
    ],
    weapons: {
      Dagger: {
        flags: ["Mainhand", "Offhand"],
        specialization: 0,
        skills: [{ id: 13010, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
      Pistol: {
        flags: ["Offhand"],
        specialization: 0,
        skills: [{ id: 13026, slot: "Weapon_4", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Elementalist: {
    id: "Elementalist", name: "Elementalist",
    icon: "https://render.guildwars2.com/file/elementalist-icon.png",
    icon_big: "https://render.guildwars2.com/file/elementalist-icon-big.png",
    specializations: [31, 41, 26, 37, 48, 56],
    skills: [
      { id: 5503,  slot: "Heal",        specialization: 0,  type: "Heal" },
      { id: 5504,  slot: "Utility",     specialization: 0,  type: "Utility" },
      { id: 5505,  slot: "Elite",       specialization: 0,  type: "Elite" },
      // Attunement buttons — wrong slots in API, must be overridden
      { id: 76703, slot: "Profession_2", specialization: 56, type: "Profession" }, // Fire Attunement (wrong slot in API)
      { id: 76988, slot: "Profession_1", specialization: 56, type: "Profession" }, // Water Attunement (wrong slot)
      { id: 76580, slot: "Profession_1", specialization: 56, type: "Profession" }, // Air Attunement (wrong slot)
      { id: 77082, slot: "Profession_1", specialization: 56, type: "Profession" }, // Earth Attunement (wrong slot)
      // Weaver dual attack skills
      { id: 76585, slot: "Weapon_3",     specialization: 56, type: "Weapon" }, // dual attack
      { id: 76811, slot: "Weapon_3",     specialization: 56, type: "Weapon" }, // dual attack
      { id: 77089, slot: "Weapon_3",     specialization: 56, type: "Weapon" }, // dual attack
      { id: 76707, slot: "Weapon_3",     specialization: 56, type: "Weapon" }, // dual attack
    ],
    weapons: {
      Staff: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [
          // One Weapon_1 ref per attunement so availableAttunements covers all four
          { id: 5507, slot: "Weapon_1", offhand: "", attunement: "Fire" },
          { id: 5508, slot: "Weapon_1", offhand: "", attunement: "Water" },
          { id: 5509, slot: "Weapon_1", offhand: "", attunement: "Air" },
          { id: 5510, slot: "Weapon_1", offhand: "", attunement: "Earth" },
          // Weaver dual-attack slot-3 skills referenced here so they land in weaponSkillById
          { id: 76585, slot: "Weapon_3", offhand: "", attunement: "" }, // Aqua Surge (Water+Fire)
          { id: 76811, slot: "Weapon_3", offhand: "", attunement: "" }, // Earthen Vortex (Earth+Air)
          { id: 77089, slot: "Weapon_3", offhand: "", attunement: "" }, // Plasma Burst (Fire+Air)
          { id: 76707, slot: "Weapon_3", offhand: "", attunement: "" }, // Seismic Impact (Earth+Water)
        ],
      },
      Scepter: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 5470, slot: "Weapon_1", offhand: "", attunement: "Fire" }],
      },
    },
    training: [],
  },

  Mesmer: {
    id: "Mesmer", name: "Mesmer",
    icon: "https://render.guildwars2.com/file/mesmer-icon.png",
    icon_big: "https://render.guildwars2.com/file/mesmer-icon-big.png",
    specializations: [23, 24, 45, 40, 59, 61],
    skills: [
      { id: 10213, slot: "Heal",        specialization: 0,  type: "Heal" },
      { id: 10220, slot: "Utility",     specialization: 0,  type: "Utility" },
      // Shatter skills
      { id: 10192, slot: "Profession_1", specialization: 0, type: "Profession" },
      { id: 10267, slot: "Profession_2", specialization: 0, type: "Profession" },
      { id: 10191, slot: "Profession_3", specialization: 0, type: "Profession" },
      { id: 10197, slot: "Profession_4", specialization: 0, type: "Profession" },
      { id: 10211, slot: "Elite",        specialization: 0, type: "Elite" },
    ],
    weapons: {
      Sword: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 10173, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Necromancer: {
    id: "Necromancer", name: "Necromancer",
    icon: "https://render.guildwars2.com/file/necromancer-icon.png",
    icon_big: "https://render.guildwars2.com/file/necromancer-icon-big.png",
    specializations: [19, 39, 50, 34, 64, 76],
    skills: [
      { id: 10533, slot: "Heal",             specialization: 0,  type: "Heal" },
      { id: 10544, slot: "Utility",          specialization: 0,  type: "Utility" },
      // Death Shroud (F1, core)
      { id: 10574, slot: "Profession_1",     specialization: 0,  type: "Profession" },
      // Reaper's Shroud (F1, spec=34)
      { id: 30792, slot: "Profession_1",     specialization: 34, type: "Profession" },
      // Harbinger's Shroud (F1, spec=64)
      { id: 62567, slot: "Profession_1",     specialization: 64, type: "Profession" },
      // Ritualist's Shroud (F1, spec=76; API returns spec=0)
      { id: 77238, slot: "Profession_1",     specialization: 0,  type: "Profession" },
      // Lich Form (elite)
      { id: 10550, slot: "Elite",            specialization: 0,  type: "Elite" },
    ],
    weapons: {
      Axe: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 10556, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },

  Revenant: {
    id: "Revenant", name: "Revenant",
    icon: "https://render.guildwars2.com/file/revenant-icon.png",
    icon_big: "https://render.guildwars2.com/file/revenant-icon-big.png",
    specializations: [52, 63, 69, 74, 79],
    skills: [
      // Legend utility skills (locked to legends)
      { id: 27356, slot: "Heal",        specialization: 0,  type: "Heal" },
      { id: 26557, slot: "Utility",     specialization: 0,  type: "Utility" },
      { id: 26821, slot: "Elite",       specialization: 0,  type: "Elite" },
      // Legend swap (Profession_1)
      { id: 28134, slot: "Profession_1", specialization: 0, type: "Profession" },
      // Alliance Tactics (Vindicator F3) — in extraSkillIds, spec override to 69
      // Conduit Release Potential variants — in extraSkillIds
    ],
    weapons: {
      Sword: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [{ id: 26679, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
      Staff: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [{ id: 26557, slot: "Weapon_1", offhand: "", attunement: "" }],
      },
    },
    training: [],
  },
};

// ---------------------------------------------------------------------------
// SPECIALIZATIONS (minimal, keyed by ID)
// ---------------------------------------------------------------------------

const MOCK_SPECIALIZATIONS = {
  // Warrior
  4:  { id: 4,  name: "Strength",      profession: "Warrior",       elite: false, icon: "", background: "", minor_traits: [214, 180, 92],   major_traits: [1444, 1338, 1451, 1340, 1454, 1457, 1379] },
  22: { id: 22, name: "Tactics",       profession: "Warrior",       elite: false, icon: "", background: "", minor_traits: [386, 396, 394],  major_traits: [1471, 1469, 1484, 1486, 1487, 1489, 1485] },
  18: { id: 18, name: "Berserker",     profession: "Warrior",       elite: true,  icon: "", background: "", minor_traits: [1692, 1835, 1831], major_traits: [1831, 1855, 1862, 1841, 1848, 1836, 2039] },
  51: { id: 51, name: "Discipline",    profession: "Warrior",       elite: false, icon: "", background: "", minor_traits: [],                major_traits: [] },
  61: { id: 61, name: "Spellbreaker",  profession: "Warrior",       elite: true,  icon: "", background: "", minor_traits: [],                major_traits: [] },

  // Engineer
  6:  { id: 6,  name: "Firearms",      profession: "Engineer",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  29: { id: 29, name: "Explosives",    profession: "Engineer",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  38: { id: 38, name: "Tools",         profession: "Engineer",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  43: { id: 43, name: "Scrapper",      profession: "Engineer",      elite: true,  icon: "", background: "", minor_traits: [1879, 1974, 1954], major_traits: [1882, 2052, 1954, 1941, 1969, 1971, 2052] },
  57: { id: 57, name: "Holosmith",     profession: "Engineer",      elite: true,  icon: "", background: "", minor_traits: [2059, 2093, 2121], major_traits: [2059, 2105, 2066, 2103, 2116, 2119, 2075] },
  70: { id: 70, name: "Mechanist",     profession: "Engineer",      elite: true,  icon: "", background: "", minor_traits: [2280, 2284, 2296], major_traits: [2280, 2288, 2290, 2293, 2302, 2316, 2332],
        // Mechanist has trait skills for F1-F3 mech commands
  },
  80: { id: 80, name: "Amalgam",       profession: "Engineer",      elite: true,  icon: "", background: "", minor_traits: [],                major_traits: [] },

  // Guardian
  16: { id: 16, name: "Radiance",      profession: "Guardian",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  46: { id: 46, name: "Valor",         profession: "Guardian",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  49: { id: 49, name: "Honor",         profession: "Guardian",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  27: { id: 27, name: "Dragonhunter",  profession: "Guardian",      elite: true,  icon: "", background: "", minor_traits: [1847, 1848, 1838], major_traits: [1835, 1868, 1876, 1898, 1878, 1869, 2089] },
  62: { id: 62, name: "Firebrand",     profession: "Guardian",      elite: true,  icon: "", background: "", minor_traits: [2075, 2107, 2116], major_traits: [2101, 2076, 2065, 2102, 2063, 2105, 2082] },
  65: { id: 65, name: "Willbender",    profession: "Guardian",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  81: { id: 81, name: "Luminary",      profession: "Guardian",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },

  // Ranger
  8:  { id: 8,  name: "Marksmanship",  profession: "Ranger",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  25: { id: 25, name: "Skirmishing",   profession: "Ranger",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  32: { id: 32, name: "Wilderness Survival", profession: "Ranger",  elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  30: { id: 30, name: "Nature Magic",  profession: "Ranger",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  55: { id: 55, name: "Soulbeast",     profession: "Ranger",        elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  72: { id: 72, name: "Untamed",       profession: "Ranger",        elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },

  // Thief
  28: { id: 28, name: "Deadly Arts",   profession: "Thief",         elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  35: { id: 35, name: "Critical Strikes", profession: "Thief",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  44: { id: 44, name: "Daredevil",     profession: "Thief",         elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  58: { id: 58, name: "Deadeye",       profession: "Thief",         elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  71: { id: 71, name: "Specter",       profession: "Thief",         elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  77: { id: 77, name: "Antiquary",    profession: "Thief",         elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [2346] },

  // Elementalist
  26: { id: 26, name: "Fire",          profession: "Elementalist",  elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  37: { id: 37, name: "Air",           profession: "Elementalist",  elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  41: { id: 41, name: "Earth",         profession: "Elementalist",  elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  31: { id: 31, name: "Water",         profession: "Elementalist",  elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  48: { id: 48, name: "Tempest",       profession: "Elementalist",  elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  56: { id: 56, name: "Weaver",        profession: "Elementalist",  elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },

  // Mesmer
  23: { id: 23, name: "Domination",    profession: "Mesmer",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  24: { id: 24, name: "Dueling",       profession: "Mesmer",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  45: { id: 45, name: "Chaos",         profession: "Mesmer",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  40: { id: 40, name: "Illusions",     profession: "Mesmer",        elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  59: { id: 59, name: "Chronomancer",  profession: "Mesmer",        elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  61: { id: 61, name: "Mirage",        profession: "Mesmer",        elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },

  // Necromancer
  19: { id: 19, name: "Soul Reaping",  profession: "Necromancer",   elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  39: { id: 39, name: "Spite",         profession: "Necromancer",   elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  50: { id: 50, name: "Curses",        profession: "Necromancer",   elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  34: { id: 34, name: "Reaper",        profession: "Necromancer",   elite: true,  icon: "", background: "", minor_traits: [1714, 1716, 1940], major_traits: [1945, 1974, 2031, 2040, 1986, 2020, 2030] },
  64: { id: 64, name: "Harbinger",     profession: "Necromancer",   elite: true,  icon: "", background: "", minor_traits: [2204, 2198, 2232], major_traits: [2204, 2178, 2218, 2215, 2220, 2223, 2232] },
  76: { id: 76, name: "Ritualist",     profession: "Necromancer",   elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },

  // Revenant
  52: { id: 52, name: "Herald",        profession: "Revenant",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  63: { id: 63, name: "Renegade",      profession: "Revenant",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  69: { id: 69, name: "Vindicator",    profession: "Revenant",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
  74: { id: 74, name: "Herald",        profession: "Revenant",      elite: false, icon: "", background: "", minor_traits: [],  major_traits: [] },
  79: { id: 79, name: "Conduit",       profession: "Revenant",      elite: true,  icon: "", background: "", minor_traits: [],  major_traits: [] },
};

// ---------------------------------------------------------------------------
// TRAITS (minimal, keyed by ID)
// ---------------------------------------------------------------------------

const MOCK_TRAITS = {
  // Dragonhunter minor trait 1848 "Virtuous Action" — carries DH F skills
  1848: {
    id: 1848, name: "Virtuous Action", specialization: 27, tier: 1, order: 0,
    slot: "Minor", icon: "", description: "Virtuous Action",
    facts: [],
    skills: [
      { id: 29887, slot: "Profession_1", icon: "" }, // DH Hunter's Ward (F1)
      { id: 30783, slot: "Profession_2", icon: "" }, // DH Test of Faith (F2)
      { id: 30029, slot: "Profession_3", icon: "" }, // DH Fragments of Faith (F3)
    ],
  },
  // Some placeholder traits for other specs
  1714: { id: 1714, name: "Chilling Nova",     specialization: 34, tier: 1, order: 0, slot: "Minor", icon: "", description: "", facts: [], skills: [] },
  1716: { id: 1716, name: "Soul Eater",        specialization: 34, tier: 2, order: 0, slot: "Minor", icon: "", description: "", facts: [], skills: [] },
  1940: { id: 1940, name: "Decimate Defenses", specialization: 34, tier: 3, order: 0, slot: "Minor", icon: "", description: "", facts: [], skills: [] },
  // Antiquary (spec 77) major trait: Prolific Plunderer — adds a 3rd artifact slot (F4) on each draw
  2346: { id: 2346, name: "Prolific Plunderer", specialization: 77, tier: 1, order: 2, slot: "Major", icon: "", description: "", facts: [], skills: [] },
};

// ---------------------------------------------------------------------------
// SKILLS (comprehensive, keyed by numeric ID)
// ---------------------------------------------------------------------------

function makeSkill(id, overrides = {}) {
  return {
    id,
    name: overrides.name || `Skill ${id}`,
    icon: overrides.icon || `https://render.guildwars2.com/file/skill-${id}.png`,
    description: overrides.description || `Description for skill ${id}`,
    slot: overrides.slot || "",
    type: overrides.type || "Utility",
    specialization: overrides.specialization !== undefined ? overrides.specialization : 0,
    professions: overrides.professions || [],
    weapon_type: overrides.weapon_type !== undefined ? overrides.weapon_type : "None",
    attunement: overrides.attunement !== undefined ? overrides.attunement : "None",
    dual_attunement: overrides.dual_attunement !== undefined ? overrides.dual_attunement : "None",
    categories: overrides.categories || [],
    flags: overrides.flags || [],
    facts: overrides.facts || [],
    toolbelt_skill: overrides.toolbelt_skill || 0,
    flip_skill: overrides.flip_skill || 0,
    bundle_skills: overrides.bundle_skills || [],
    transform_skills: overrides.transform_skills || [],
  };
}

const MOCK_SKILLS = {
  // ---- Guardian ----
  9083:  makeSkill(9083,  { name: "Shelter",          slot: "Heal",         type: "Heal",       professions: ["Guardian"] }),
  9168:  makeSkill(9168,  { name: "Bane Signet",      slot: "Utility",      type: "Utility",    professions: ["Guardian"] }),
  9:     makeSkill(9,     { name: "Renewed Focus",    slot: "Elite",        type: "Elite",      professions: ["Guardian"] }),
  // Core Guardian virtues — Virtue of Justice flips to Spear of Justice (DH)
  9115:  makeSkill(9115,  { name: "Virtue of Justice",  slot: "Profession_1", type: "Profession", professions: ["Guardian"], flip_skill: 29887 }),
  9120:  makeSkill(9120,  { name: "Virtue of Resolve",  slot: "Profession_2", type: "Profession", professions: ["Guardian"], flip_skill: 30783 }),
  9107:  makeSkill(9107,  { name: "Virtue of Courage",  slot: "Profession_3", type: "Profession", professions: ["Guardian"], flip_skill: 30029 }),
  // Dragonhunter F1-F3 (flip targets of core virtues, spec 27)
  29887: makeSkill(29887, { name: "Spear of Justice",   slot: "Profession_1", type: "Profession", specialization: 27, professions: ["Guardian"], flip_skill: 33134 }),
  30783: makeSkill(30783, { name: "Wings of Resolve",   slot: "Profession_2", type: "Profession", specialization: 27, professions: ["Guardian"] }),
  30029: makeSkill(30029, { name: "Shield of Courage",  slot: "Profession_3", type: "Profession", specialization: 27, professions: ["Guardian"] }),
  33134: makeSkill(33134, { name: "Hunter's Verdict",   slot: "Profession_1", type: "Profession", specialization: 27, professions: ["Guardian"] }),
  // Firebrand tomes (spec 62)
  44364: makeSkill(44364, { name: "Tome of Justice",  slot: "Profession_1", type: "Profession", specialization: 62, professions: ["Guardian"] }),
  41780: makeSkill(41780, { name: "Tome of Resolve",  slot: "Profession_2", type: "Profession", specialization: 62, professions: ["Guardian"] }),
  42259: makeSkill(42259, { name: "Tome of Courage",  slot: "Profession_3", type: "Profession", specialization: 62, professions: ["Guardian"] }),
  // Luminary (spec 81)
  77073: makeSkill(77073, { name: "Enter Radiant Forge", slot: "Profession_1", type: "Profession", specialization: 81, professions: ["Guardian"] }),

  // ---- Warrior ----
  14402: makeSkill(14402, { name: "Mending",      slot: "Heal",    type: "Heal",    professions: ["Warrior"], flags: [] }),
  14516: makeSkill(14516, { name: "Balanced Stance", slot: "Utility", type: "Utility", professions: ["Warrior"], flags: ["NoUnderwater"] }),
  14404: makeSkill(14404, { name: "Rampage",      slot: "Elite",   type: "Elite",   professions: ["Warrior"] }),
  14360: makeSkill(14360, { name: "Sever Artery", slot: "Weapon_1", type: "Weapon", weapon_type: "Sword" }),
  14521: makeSkill(14521, { name: "Shield Bash",  slot: "Weapon_4", type: "Weapon", weapon_type: "Shield" }),
  14447: makeSkill(14447, { name: "Whirlwind Attack", slot: "Weapon_1", type: "Weapon", weapon_type: "Greatsword" }),
  14489: makeSkill(14489, { name: "Harpoon Pull", slot: "Weapon_1", type: "Weapon", weapon_type: "HarpoonGun" }),
  // Warrior profession mechanics (burst / primal burst / Berserk toggle)
  14367: makeSkill(14367, { name: "Flurry",                 slot: "Profession_1", type: "Profession", weapon_type: "Sword",       professions: ["Warrior"] }),
  14375: makeSkill(14375, { name: "Arcing Slice",           slot: "Profession_1", type: "Profession", weapon_type: "Greatsword",  professions: ["Warrior"] }),
  30682: makeSkill(30682, { name: "Flaming Flurry",         slot: "Profession_1", type: "Profession", weapon_type: "Sword",       professions: ["Warrior"], specialization: 18 }),
  29852: makeSkill(29852, { name: "Arc Divider",            slot: "Profession_1", type: "Profession", weapon_type: "Greatsword",  professions: ["Warrior"], specialization: 18 }),
  30185: makeSkill(30185, { name: "Berserk",                slot: "Profession_2", type: "Profession",                             professions: ["Warrior"], specialization: 18 }),
  42494: makeSkill(42494, { name: "Flurry",                 slot: "Profession_1", type: "Profession", weapon_type: "Sword",       professions: ["Warrior"], specialization: 61 }),

  // ---- Engineer ----
  5802:  makeSkill(5802,  { name: "Healing Turret", slot: "Heal", type: "Heal", professions: ["Engineer"] }),
  5811:  makeSkill(5811,  { name: "Hip Shot", slot: "Weapon_1", type: "Weapon", weapon_type: "Rifle" }),
  5805:  makeSkill(5805,  { name: "Fragmentation Shot", slot: "Weapon_1", type: "Weapon", weapon_type: "Pistol" }),
  6161:  makeSkill(6161,  { name: "Supply Drop", slot: "Elite", type: "Elite", professions: ["Engineer"] }),

  // Elixir utilities — toolbelt_skill points to Detonate variant (wrong; should be Toss)
  5834:  makeSkill(5834,  { name: "Elixir H",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6119, categories: ["Elixir"] }),
  5821:  makeSkill(5821,  { name: "Elixir B",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6082, categories: ["Elixir"] }),
  5860:  makeSkill(5860,  { name: "Elixir C",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6078, categories: ["Elixir"] }),
  5968:  makeSkill(5968,  { name: "Elixir R",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6086, categories: ["Elixir"] }),
  5861:  makeSkill(5861,  { name: "Elixir S",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6084, categories: ["Elixir"] }),
  5862:  makeSkill(5862,  { name: "Elixir U",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 6088, categories: ["Elixir"] }),
  5832:  makeSkill(5832,  { name: "Elixir X",    slot: "Utility", type: "Utility", professions: ["Engineer"], toolbelt_skill: 29722, categories: ["Elixir"] }), // No Toss variant

  // Detonate variants (wrong; API gives these but game uses Toss)
  6119:  makeSkill(6119,  { name: "Detonate Elixir H", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6082:  makeSkill(6082,  { name: "Detonate Elixir B", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6078:  makeSkill(6078,  { name: "Detonate Elixir C", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6086:  makeSkill(6086,  { name: "Detonate Elixir R", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6084:  makeSkill(6084,  { name: "Detonate Elixir S", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6088:  makeSkill(6088,  { name: "Detonate Elixir U", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  29722: makeSkill(29722, { name: "Detonate Elixir X", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),

  // Toss variants (correct; gw2Data.js ELIXIR_TOOLBELT_OVERRIDES maps to these)
  6118:  makeSkill(6118,  { name: "Toss Elixir H", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6092:  makeSkill(6092,  { name: "Toss Elixir B", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6077:  makeSkill(6077,  { name: "Toss Elixir C", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6091:  makeSkill(6091,  { name: "Toss Elixir R", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6090:  makeSkill(6090,  { name: "Toss Elixir S", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),
  6089:  makeSkill(6089,  { name: "Toss Elixir U", slot: "Profession_1", type: "Profession", professions: ["Engineer"] }),

  // Photon Forge — no bundle_skills in API; gw2Data hardcodes the bundle
  42938: makeSkill(42938, { name: "Photon Forge", slot: "Profession_5", type: "Profession", specialization: 57, professions: ["Engineer"], bundle_skills: [], flip_skill: 41123 }),

  // Photon Forge weapon skills (must exist in MOCK_SKILLS so fetch resolves them)
  44588: makeSkill(44588, { name: "Light Strike",             slot: "Weapon_1", type: "Weapon", specialization: 57 }),
  42965: makeSkill(42965, { name: "Holo Leap",                slot: "Weapon_2", type: "Weapon", specialization: 57 }),
  44530: makeSkill(44530, { name: "Corona Burst",             slot: "Weapon_3", type: "Weapon", specialization: 57 }),
  45783: makeSkill(45783, { name: "Photon Blitz",             slot: "Weapon_4", type: "Weapon", specialization: 57 }),
  42521: makeSkill(42521, { name: "Holographic Shockwave",    slot: "Weapon_5", type: "Weapon", specialization: 57 }),
  41123: makeSkill(41123, { name: "Deactivate Photon Forge",  slot: "Profession_5", type: "Profession", specialization: 57, flip_skill: 42938 }),

  // Scrapper Function Gyro variants — API says spec=57 (Holosmith), but correct is spec=43 (Scrapper)
  72103: makeSkill(72103, { name: "Function Gyro",            slot: "Profession_5", type: "Profession", specialization: 57 }),
  72114: makeSkill(72114, { name: "Function Gyro (variant)",  slot: "Profession_5", type: "Profession", specialization: 57 }),

  // Mechanist underwater skill — Depth Charges (replaces all mech F-slots when underwater)
  63210: makeSkill(63210, { name: "Depth Charges", slot: "Profession_4", type: "Profession", specialization: 70, professions: ["Engineer"] }),

  // Radiant Forge (Luminary, Guardian)
  77073: makeSkill(77073, { name: "Enter Radiant Forge", slot: "Profession_1", type: "Profession", specialization: 81, professions: ["Guardian"], bundle_skills: [] }),
  76950: makeSkill(76950, { name: "Glaring Burst",    slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  76982: makeSkill(76982, { name: "Glaring Burst 2",  slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  77339: makeSkill(77339, { name: "Radiant Arc",      slot: "Weapon_2", type: "Weapon", specialization: 81 }),
  76708: makeSkill(76708, { name: "Radiant Ray",      slot: "Weapon_3", type: "Weapon", specialization: 81 }),
  76924: makeSkill(76924, { name: "Radiant Sweep",    slot: "Weapon_4", type: "Weapon", specialization: 81 }),
  76978: makeSkill(76978, { name: "Radiant Storm",    slot: "Weapon_5", type: "Weapon", specialization: 81 }),
  77058: makeSkill(77058, { name: "Glaring Burst 3",  slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  78674: makeSkill(78674, { name: "Glaring Burst 4",  slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  78730: makeSkill(78730, { name: "Glaring Burst 5",  slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  76910: makeSkill(76910, { name: "Radiant Forge Exit F1", slot: "Weapon_1", type: "Weapon", specialization: 81 }),
  77136: makeSkill(77136, { name: "Radiant Forge Exit F2", slot: "Weapon_2", type: "Weapon", specialization: 81 }),
  77366: makeSkill(77366, { name: "Radiant Forge Exit F3", slot: "Weapon_3", type: "Weapon", specialization: 81 }),

  // ---- Guardian ----
  9083:  makeSkill(9083,  { name: "Shelter",          slot: "Heal",    type: "Heal",    professions: ["Guardian"] }),
  9168:  makeSkill(9168,  { name: "Stand Your Ground", slot: "Utility", type: "Utility", professions: ["Guardian"] }),
  9:     makeSkill(9,     { name: "Renewed Focus",    slot: "Elite",   type: "Elite",   professions: ["Guardian"] }),
  9104:  makeSkill(9104,  { name: "Symbol of Blades", slot: "Weapon_1", type: "Weapon", weapon_type: "Sword", professions: ["Guardian"] }),

  // Dragonhunter F skills (discovered via minor trait 1848)
  29887: makeSkill(29887, { name: "Hunter's Ward",     slot: "Profession_1", type: "Profession", specialization: 27, professions: ["Guardian"] }),
  30783: makeSkill(30783, { name: "Test of Faith",     slot: "Profession_2", type: "Profession", specialization: 27, professions: ["Guardian"] }),
  30029: makeSkill(30029, { name: "Fragments of Faith", slot: "Profession_3", type: "Profession", specialization: 27, professions: ["Guardian"] }),

  // Firebrand tomes — no bundle_skills in API; gw2Data uses FIREBRAND_TOME_CHAPTERS
  44364: makeSkill(44364, { name: "Tome of Justice",  slot: "Profession_1", type: "Profession", specialization: 62, professions: ["Guardian"], bundle_skills: [] }),
  41780: makeSkill(41780, { name: "Tome of Resolve",  slot: "Profession_2", type: "Profession", specialization: 62, professions: ["Guardian"], bundle_skills: [] }),
  42259: makeSkill(42259, { name: "Tome of Courage",  slot: "Profession_3", type: "Profession", specialization: 62, professions: ["Guardian"], bundle_skills: [] }),
  42371: makeSkill(42371, { name: "Tome of Courage (alt)", slot: "Profession_3", type: "Profession", specialization: 62, professions: ["Guardian"], bundle_skills: [] }),

  // Firebrand tome chapters (Tome of Justice — 5 chapters)
  41258: makeSkill(41258, { name: "Chapter 1: Searing Spell",      slot: "Weapon_1", type: "Weapon", specialization: 62, professions: ["Guardian"] }),
  40635: makeSkill(40635, { name: "Chapter 2: Igniting Burst",     slot: "Weapon_2", type: "Weapon", specialization: 62, professions: ["Guardian"] }),
  42449: makeSkill(42449, { name: "Chapter 3: Heated Rebuke",      slot: "Weapon_3", type: "Weapon", specialization: 62, professions: ["Guardian"] }),
  40015: makeSkill(40015, { name: "Chapter 4: Scorched Aftermath", slot: "Weapon_4", type: "Weapon", specialization: 62, professions: ["Guardian"] }),
  42898: makeSkill(42898, { name: "Epilogue: Ashes of the Just",   slot: "Weapon_5", type: "Weapon", specialization: 62, professions: ["Guardian"] }),

  // Tome of Resolve chapters
  45022: makeSkill(45022, { name: "Chapter 1: Desert Bloom",       slot: "Weapon_1", type: "Weapon", specialization: 62 }),
  40679: makeSkill(40679, { name: "Chapter 2: Radiant Recovery",   slot: "Weapon_2", type: "Weapon", specialization: 62 }),
  45128: makeSkill(45128, { name: "Chapter 3: Azure Sun",          slot: "Weapon_3", type: "Weapon", specialization: 62 }),
  42008: makeSkill(42008, { name: "Chapter 4: Shining River",      slot: "Weapon_4", type: "Weapon", specialization: 62 }),
  42925: makeSkill(42925, { name: "Epilogue: Eternal Oasis",       slot: "Weapon_5", type: "Weapon", specialization: 62 }),

  // Tome of Courage chapters
  42986: makeSkill(42986, { name: "Chapter 1: Unflinching Charge", slot: "Weapon_1", type: "Weapon", specialization: 62 }),
  41968: makeSkill(41968, { name: "Chapter 2: Daring Challenge",   slot: "Weapon_2", type: "Weapon", specialization: 62 }),
  41836: makeSkill(41836, { name: "Chapter 3: Valiant Bulwark",    slot: "Weapon_3", type: "Weapon", specialization: 62 }),
  40988: makeSkill(40988, { name: "Chapter 4: Stalwart Stand",     slot: "Weapon_4", type: "Weapon", specialization: 62 }),
  44455: makeSkill(44455, { name: "Epilogue: Unbroken Lines",      slot: "Weapon_5", type: "Weapon", specialization: 62 }),

  // ---- Ranger ----
  5503:  makeSkill(5503,  { name: "Troll Unguent", slot: "Heal",    type: "Heal",    professions: ["Ranger"] }),
  12489: makeSkill(12489, { name: "Muddy Terrain", slot: "Utility", type: "Utility", professions: ["Ranger"] }),
  12540: makeSkill(12540, { name: "Entangle",      slot: "Elite",   type: "Elite",   professions: ["Ranger"] }),
  12466: makeSkill(12466, { name: "Long Range Shot", slot: "Weapon_1", type: "Weapon", weapon_type: "Longbow" }),
  // Untamed profession skills — empowered pet commands (F1-F3 when Unleash Pet active)
  63209: makeSkill(63209, { name: "Venomous Outburst", slot: "Profession_1", type: "Profession", specialization: 72, professions: ["Ranger"] }),
  63258: makeSkill(63258, { name: "Rending Vines",     slot: "Profession_2", type: "Profession", specialization: 72, professions: ["Ranger"] }),
  63094: makeSkill(63094, { name: "Enveloping Haze",   slot: "Profession_3", type: "Profession", specialization: 72, professions: ["Ranger"] }),
  // Untamed F5 toggle
  63147: makeSkill(63147, { name: "Unleash Ranger", slot: "Profession_5", type: "Profession", specialization: 72, professions: ["Ranger"] }),
  63344: makeSkill(63344, { name: "Unleash Pet",    slot: "Profession_5", type: "Profession", specialization: 72, professions: ["Ranger"] }),
  // Untamed Unleashed Ambush skills (trait-granted from Unleashed Power, trait 2268)
  63438: makeSkill(63438, { name: "Relentless Whirl",    slot: "Weapon_1", type: "Weapon", weapon_type: "Hammer",   specialization: 72, professions: ["Ranger"] }),
  63129: makeSkill(63129, { name: "Sundering Volley",    slot: "Weapon_1", type: "Weapon", weapon_type: "Axe",      specialization: 72, professions: ["Ranger"] }),
  69223: makeSkill(69223, { name: "Neurotoxin Burst",    slot: "Weapon_1", type: "Weapon", weapon_type: "Dagger",   specialization: 72, professions: ["Ranger"] }),
  63350: makeSkill(63350, { name: "Savage Slash",        slot: "Weapon_1", type: "Weapon", weapon_type: "Greatsword", specialization: 72, professions: ["Ranger"] }),
  72079: makeSkill(72079, { name: "Rampant Growth",      slot: "Weapon_1", type: "Weapon", weapon_type: "Mace",     specialization: 72, professions: ["Ranger"] }),
  63336: makeSkill(63336, { name: "Deft Strike",         slot: "Weapon_1", type: "Weapon", weapon_type: "Sword",    specialization: 72, professions: ["Ranger"] }),
  63225: makeSkill(63225, { name: "Multishot",           slot: "Weapon_1", type: "Weapon", weapon_type: "Longbow",  specialization: 72, professions: ["Ranger"] }),
  63326: makeSkill(63326, { name: "Toxic Shot",          slot: "Weapon_1", type: "Weapon", weapon_type: "Shortbow", specialization: 72, professions: ["Ranger"] }),
  69175: makeSkill(69175, { name: "Solar Brilliance",    slot: "Weapon_1", type: "Weapon", weapon_type: "Staff",    specialization: 72, professions: ["Ranger"] }),
  72932: makeSkill(72932, { name: "Ravager's Abandon",   slot: "Weapon_1", type: "Weapon", weapon_type: "Spear",    specialization: 72, professions: ["Ranger"] }),
  63065: makeSkill(63065, { name: "Vicious Pike",        slot: "Weapon_1", type: "Weapon", weapon_type: "Spear",    specialization: 72, professions: ["Ranger"] }),
  63301: makeSkill(63301, { name: "Jagged Fan",          slot: "Weapon_1", type: "Weapon", weapon_type: "Speargun", specialization: 72, professions: ["Ranger"] }),

  // ---- Thief ----
  13050: makeSkill(13050, { name: "Channeled Vigor", slot: "Heal", type: "Heal", professions: ["Thief"] }),
  13076: makeSkill(13076, { name: "Dagger Storm",    slot: "Elite", type: "Elite", professions: ["Thief"] }),
  13082: makeSkill(13082, { name: "Shadow Step",     slot: "Utility", type: "Utility", professions: ["Thief"] }),
  13132: makeSkill(13132, { name: "Steal",           slot: "Profession_1", type: "Profession", specialization: 0,  professions: ["Thief"] }),
  30423: makeSkill(30423, { name: "Bound",           slot: "Profession_1", type: "Profession", specialization: 44, professions: ["Thief"] }),
  43390: makeSkill(43390, { name: "Deadeye's Mark",  slot: "Profession_1", type: "Profession", specialization: 58, professions: ["Thief"] }),
  41372: makeSkill(41372, { name: "Mercy",           slot: "Utility",      type: "Utility",    specialization: 58, professions: ["Thief"] }),
  13010: makeSkill(13010, { name: "Dual Strike",     slot: "Weapon_1", type: "Weapon", weapon_type: "Dagger" }),
  13026: makeSkill(13026, { name: "Body Shot",       slot: "Weapon_4", type: "Weapon", weapon_type: "Pistol" }),

  // Specter Siphon (Profession_1 in API? actually comes from extraSkillIds)
  63067: makeSkill(63067, { name: "Siphon",          slot: "Profession_1", type: "Profession", specialization: 71, professions: ["Thief"] }),

  // Shadow Shroud Enter/Exit
  63155: makeSkill(63155, { name: "Enter Shadow Shroud", slot: "Profession_2", type: "Profession", specialization: 71, professions: ["Thief"], bundle_skills: [], flip_skill: 63251 }),
  63251: makeSkill(63251, { name: "Exit Shadow Shroud",  slot: "Profession_2", type: "Profession", specialization: 71, professions: ["Thief"] }),

  // Antiquary (spec=77) F1 — spec=77 correct in API, no override needed
  77397: makeSkill(77397, { name: "Skritt Swipe",         slot: "Profession_1", type: "Profession", specialization: 77, professions: ["Thief"] }),
  // Antiquary (spec=77) profession mechanic skills — specialization=0 in API, overridden to 77
  77277: makeSkill(77277, { name: "Mistburn Mortar",         slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  77288: makeSkill(77288, { name: "Mistburn Mortar",         slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76733: makeSkill(76733, { name: "Zephyrite Sun Crystal",   slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  78309: makeSkill(78309, { name: "Zephyrite Sun Crystal",   slot: "Profession_3", type: "Profession", specialization: 0, professions: ["Thief"] }),
  77192: makeSkill(77192, { name: "Summon Kryptis Turret",   slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76900: makeSkill(76900, { name: "Summon Kryptis Turret",   slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76550: makeSkill(76550, { name: "Forged Surfer Dash",      slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76582: makeSkill(76582, { name: "Metal Legion Guitar",     slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76601: makeSkill(76601, { name: "Exalted Hammer",          slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76702: makeSkill(76702, { name: "Exalted Hammer",          slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76800: makeSkill(76800, { name: "Holo-Dancer Decoy",       slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76816: makeSkill(76816, { name: "Chak Shield",             slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),
  76909: makeSkill(76909, { name: "Unstable Skritt Bomb",    slot: "Profession_2", type: "Profession", specialization: 0, professions: ["Thief"] }),

  // Shadow Shroud weapon skills (current 5-slot bundle)
  63362: makeSkill(63362, { name: "Haunt Shot",        slot: "Weapon_1", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63107: makeSkill(63107, { name: "Grasping Shadows",  slot: "Weapon_2", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63167: makeSkill(63167, { name: "Grasping Shadows",  slot: "Weapon_2", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63220: makeSkill(63220, { name: "Dawn's Repose",     slot: "Weapon_3", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63227: makeSkill(63227, { name: "Dawn's Repose",     slot: "Weapon_3", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63160: makeSkill(63160, { name: "Eternal Night",     slot: "Weapon_4", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),
  63249: makeSkill(63249, { name: "Mind Shock",        slot: "Weapon_5", type: "Weapon", weapon_type: "Staff", specialization: 0, professions: ["Thief"] }),

  // ---- Elementalist ----
  5504:  makeSkill(5504,  { name: "Glyph of Elemental Harmony", slot: "Heal",    type: "Heal",    professions: ["Elementalist"] }),
  5505:  makeSkill(5505,  { name: "Tornado",        slot: "Elite",   type: "Elite",   professions: ["Elementalist"] }),
  5507:  makeSkill(5507,  { name: "Fire Attunement (Staff)",  slot: "Weapon_1", type: "Weapon", weapon_type: "Staff",  attunement: "Fire"  }),
  5508:  makeSkill(5508,  { name: "Water Attunement (Staff)", slot: "Weapon_1", type: "Weapon", weapon_type: "Staff",  attunement: "Water" }),
  5509:  makeSkill(5509,  { name: "Air Attunement (Staff)",   slot: "Weapon_1", type: "Weapon", weapon_type: "Staff",  attunement: "Air"   }),
  5510:  makeSkill(5510,  { name: "Earth Attunement (Staff)", slot: "Weapon_1", type: "Weapon", weapon_type: "Staff",  attunement: "Earth" }),
  5470:  makeSkill(5470,  { name: "Dragon's Tooth",           slot: "Weapon_1", type: "Weapon", weapon_type: "Scepter", attunement: "Fire"  }),

  // Weaver attunement buttons (API assigns wrong slots; gw2Data overrides them)
  76703: makeSkill(76703, { name: "Fire Attunement",   slot: "Profession_2", type: "Profession", specialization: 56, professions: ["Elementalist"], weapon_type: "None", attunement: "None" }),
  76988: makeSkill(76988, { name: "Water Attunement",  slot: "Profession_1", type: "Profession", specialization: 56, professions: ["Elementalist"], weapon_type: "None", attunement: "None" }),
  76580: makeSkill(76580, { name: "Air Attunement",    slot: "Profession_1", type: "Profession", specialization: 56, professions: ["Elementalist"], weapon_type: "None", attunement: "None" }),
  77082: makeSkill(77082, { name: "Earth Attunement",  slot: "Profession_1", type: "Profession", specialization: 56, professions: ["Elementalist"], weapon_type: "None", attunement: "None" }),

  // Weaver dual attack skills (spec=56 via override, dual_attunement used for dualWield)
  // weapon_type must be set so getEquippedWeaponSkills can match by mainhand key
  76585: makeSkill(76585, { name: "Aqua Surge",        slot: "Weapon_3", type: "Weapon", specialization: 56, weapon_type: "Staff", attunement: "Water", dual_attunement: "Fire" }),
  76811: makeSkill(76811, { name: "Earthen Vortex",    slot: "Weapon_3", type: "Weapon", specialization: 56, weapon_type: "Staff", attunement: "Earth", dual_attunement: "Air" }),
  77089: makeSkill(77089, { name: "Plasma Burst",      slot: "Weapon_3", type: "Weapon", specialization: 56, weapon_type: "Staff", attunement: "Fire",  dual_attunement: "Air" }),
  76707: makeSkill(76707, { name: "Seismic Impact",    slot: "Weapon_3", type: "Weapon", specialization: 56, weapon_type: "Staff", attunement: "Earth", dual_attunement: "Water" }),

  // Twin Strike (Sword/Fire+Water, id 42271) — used in dual-attack tests
  42271: makeSkill(42271, { name: "Twin Strike",       slot: "Weapon_3", type: "Weapon", specialization: 56, weapon_type: "Sword", attunement: "Fire", dual_attunement: "Water" }),

  // ---- Mesmer ----
  10213: makeSkill(10213, { name: "Ether Feast",       slot: "Heal",       type: "Heal",      professions: ["Mesmer"] }),
  10220: makeSkill(10220, { name: "Decoy",             slot: "Utility",    type: "Utility",   professions: ["Mesmer"] }),
  10192: makeSkill(10192, { name: "Mind Wrack",        slot: "Profession_1", type: "Profession", professions: ["Mesmer"] }),
  10267: makeSkill(10267, { name: "Cry of Frustration", slot: "Profession_2", type: "Profession", professions: ["Mesmer"] }),
  10191: makeSkill(10191, { name: "Diversion",         slot: "Profession_3", type: "Profession", professions: ["Mesmer"] }),
  10197: makeSkill(10197, { name: "Distortion",        slot: "Profession_4", type: "Profession", professions: ["Mesmer"] }),
  10211: makeSkill(10211, { name: "Moa Morph",         slot: "Elite",      type: "Elite",     professions: ["Mesmer"] }),
  10173: makeSkill(10173, { name: "Spatial Surge",     slot: "Weapon_1",   type: "Weapon",    weapon_type: "Sword", professions: ["Mesmer"] }),

  // ---- Necromancer ----
  10533: makeSkill(10533, { name: "Well of Blood",     slot: "Heal",       type: "Heal",      professions: ["Necromancer"] }),
  10544: makeSkill(10544, { name: "Spectral Walk",     slot: "Utility",    type: "Utility",   professions: ["Necromancer"] }),
  10556: makeSkill(10556, { name: "Axe 1",             slot: "Weapon_1",   type: "Weapon",    weapon_type: "Axe" }),

  // Death Shroud (F1, core) — no bundle_skills; gw2Data hardcodes DEATH_SHROUD_BUNDLE
  10574: makeSkill(10574, { name: "Death Shroud",      slot: "Profession_1", type: "Profession", specialization: 0, professions: ["Necromancer"],
    transform_skills: [10554, 10604, 10588, 10594, 19504, 10585], bundle_skills: [] }),

  // Death Shroud weapon skills (Downed_N slots from API)
  10554: makeSkill(10554, { name: "Life Blast",        slot: "Downed_1", type: "Weapon", specialization: 0, flip_skill: 18504 }),
  10604: makeSkill(10604, { name: "Dark Path",         slot: "Downed_2", type: "Weapon", specialization: 0, flip_skill: 56916 }),
  10588: makeSkill(10588, { name: "Doom",              slot: "Downed_3", type: "Weapon", specialization: 0 }),
  10594: makeSkill(10594, { name: "Life Transfer",     slot: "Downed_4", type: "Weapon", specialization: 0 }),
  19504: makeSkill(19504, { name: "Tainted Shackles",  slot: "Downed_5", type: "Weapon", specialization: 0 }),
  10585: makeSkill(10585, { name: "End Death Shroud",  slot: "Downed_6", type: "Weapon", specialization: 0 }), // excluded from bundle

  // Death Shroud flip_skills
  18504: makeSkill(18504, { name: "Dhuumfire",         slot: "Downed_1", type: "Weapon", specialization: 0 }),
  56916: makeSkill(56916, { name: "Dark Pursuit",      slot: "Downed_2", type: "Weapon", specialization: 0 }),

  // Reaper's Shroud (spec=34 via override)
  30792: makeSkill(30792, { name: "Reaper's Shroud",   slot: "Profession_1", type: "Profession", specialization: 34, professions: ["Necromancer"],
    transform_skills: [29533, 29584, 29719, 30225, 29395], bundle_skills: [] }),

  // Reaper's Shroud weapon skills (Downed_N slots)
  29533: makeSkill(29533, { name: "Grasping Darkness", slot: "Downed_1", type: "Weapon", specialization: 34 }),
  29584: makeSkill(29584, { name: "Death's Charge",    slot: "Downed_2", type: "Weapon", specialization: 34 }),
  29719: makeSkill(29719, { name: "Executioner's Scythe", slot: "Weapon_5", type: "Weapon", specialization: 34 }),
  30225: makeSkill(30225, { name: "Infusing Terror",   slot: "Downed_4", type: "Weapon", specialization: 34 }),
  29395: makeSkill(29395, { name: "Terrifying Descent", slot: "Downed_5", type: "Weapon", specialization: 34 }),

  // Harbinger's Shroud (spec=64 via override)
  62567: makeSkill(62567, { name: "Harbinger's Shroud", slot: "Profession_1", type: "Profession", specialization: 64, professions: ["Necromancer"],
    transform_skills: [62569, 62591, 62567, 62603, 62618], bundle_skills: [] }),
  62569: makeSkill(62569, { name: "Calamitous Bolt",   slot: "Downed_1", type: "Weapon", specialization: 64 }),
  62591: makeSkill(62591, { name: "Devouring Cut",     slot: "Downed_2", type: "Weapon", specialization: 64 }),
  62603: makeSkill(62603, { name: "Void Embrace",      slot: "Downed_3", type: "Weapon", specialization: 64 }),
  62618: makeSkill(62618, { name: "Wicked Corruption", slot: "Downed_4", type: "Weapon", specialization: 64 }),

  // Ritualist's Shroud (spec=76 via override; API returns spec=0)
  77238: makeSkill(77238, { name: "Ritualist's Shroud", slot: "Profession_1", type: "Profession", specialization: 0, professions: ["Necromancer"],
    transform_skills: [77241, 77244, 77247], bundle_skills: [] }),
  77241: makeSkill(77241, { name: "Rift Bolt",         slot: "Downed_1", type: "Weapon", specialization: 76 }),
  77244: makeSkill(77244, { name: "Cascade of Sorrow", slot: "Downed_2", type: "Weapon", specialization: 76 }),
  77247: makeSkill(77247, { name: "Rend Existence",    slot: "Downed_3", type: "Weapon", specialization: 76 }),

  // Lich Form (elite) — no bundle_skills; gw2Data hardcodes LICH_FORM_BUNDLE
  10550: makeSkill(10550, { name: "Lich Form",         slot: "Elite", type: "Elite", specialization: 0, professions: ["Necromancer"],
    transform_skills: [10634, 10635, 10633, 10636, 10632, 14350], bundle_skills: [] }),

  // Lich Form weapon skills
  10634: makeSkill(10634, { name: "Deathly Claws",     slot: "Weapon_1", type: "Weapon", specialization: 0 }),
  10635: makeSkill(10635, { name: "Lich's Gaze",       slot: "Weapon_2", type: "Weapon", specialization: 0 }),
  10633: makeSkill(10633, { name: "Ripple of Horror",  slot: "Weapon_3", type: "Weapon", specialization: 0, flip_skill: 45780 }),
  10636: makeSkill(10636, { name: "Summon Madness",    slot: "Weapon_4", type: "Weapon", specialization: 0 }),
  10632: makeSkill(10632, { name: "Grim Specter",      slot: "Weapon_5", type: "Weapon", specialization: 0 }),
  14350: makeSkill(14350, { name: "Return",            slot: "Weapon_6", type: "Weapon", specialization: 0 }), // excluded
  45780: makeSkill(45780, { name: "March of Undeath",  slot: "Weapon_3", type: "Weapon", specialization: 0 }),

  // ---- Revenant ----
  27356: makeSkill(27356, { name: "Enchanted Daggers", slot: "Heal",    type: "Heal",    professions: ["Revenant"] }),
  26557: makeSkill(26557, { name: "Unyielding Anguish", slot: "Utility", type: "Utility", professions: ["Revenant"] }),
  26821: makeSkill(26821, { name: "Jade Winds",        slot: "Elite",   type: "Elite",   professions: ["Revenant"] }),
  28134: makeSkill(28134, { name: "Legendary Dwarf Stance", slot: "Profession_1", type: "Profession", professions: ["Revenant"] }),
  26679: makeSkill(26679, { name: "Unrelenting Assault", slot: "Weapon_1", type: "Weapon", weapon_type: "Sword" }),

  // Alliance Tactics (Vindicator F3) — in extraSkillIds; slot override to Profession_3
  62729: makeSkill(62729, { name: "Alliance Tactics",  slot: "Profession_2", type: "Profession", specialization: 69, professions: ["Revenant"] }),

  // Conduit Release Potential variants (spec=79)
  78845: makeSkill(78845, { name: "Release Potential (Mallyx)",   slot: "Profession_2", type: "Profession", specialization: 79 }),
  78501: makeSkill(78501, { name: "Release Potential (Glint)",    slot: "Profession_2", type: "Profession", specialization: 79 }),
  78615: makeSkill(78615, { name: "Release Potential (Jalis)",    slot: "Profession_2", type: "Profession", specialization: 79 }),
  78661: makeSkill(78661, { name: "Release Potential (Shiro)",    slot: "Profession_2", type: "Profession", specialization: 0,  description: "" }), // API returns spec=0; override to 79
  78895: makeSkill(78895, { name: "Release Potential (Ventari)",  slot: "Profession_2", type: "Profession", specialization: 79 }),

  // Conduit Cosmic Wisdom (F3, spec=79)
  77371: makeSkill(77371, { name: "Cosmic Wisdom",     slot: "Profession_3", type: "Profession", specialization: 79 }),

  // Herald Facet of Elements (missing flip_skill in API)
  27014: makeSkill(27014, { name: "Facet of Elements", slot: "Utility", type: "Utility", specialization: 52, flip_skill: 0 }), // flip hardcoded to 27162
  27162: makeSkill(27162, { name: "Elemental Blast",   slot: "Utility", type: "Utility", specialization: 52 }),

  // Legend swap stances
  62749: makeSkill(62749, { name: "Legendary Alliance",       slot: "Profession_1", type: "Profession", specialization: 69 }),
  62891: makeSkill(62891, { name: "Legendary Alliance Stance", slot: "Profession_1", type: "Profession", specialization: 69 }),
};

// ---------------------------------------------------------------------------
// LEGENDS (Revenant — /v2/legends IDs endpoint + /v2/legends?ids=... data)
// ---------------------------------------------------------------------------

const MOCK_LEGEND_IDS = ["Legend1", "Legend2", "Legend3", "Legend4", "Legend5", "Legend6", "Legend7"];

const MOCK_LEGENDS_DATA = [
  { id: "Legend1", swap: 28134, heal: 27356, utilities: [26557, 27505, 28401], elite: 26821 },  // Mallyx
  { id: "Legend2", swap: 28195, heal: 27220, utilities: [27014, 26937, 26864], elite: 29965 },  // Glint (Herald)
  { id: "Legend3", swap: 28406, heal: 26521, utilities: [27917, 26854, 27372], elite: 26557 },  // Jalis
  { id: "Legend4", swap: 27356, heal: 26937, utilities: [28231, 29082, 27107], elite: 45773 },  // Shiro
  { id: "Legend5", swap: 28494, heal: 26462, utilities: [27052, 28029, 27025], elite: 28287 },  // Ventari
  { id: "Legend6", swap: 41858, heal: 45773, utilities: [42949, 41294, 44551], elite: 45686 },  // Kalla (Renegade)
  { id: "Legend7", swap: 62749, heal: 62749, utilities: [62832, 62667, 62711], elite: 62891 },  // Alliance (Vindicator)
];

// Minimal legend skill data needed for catalog construction
const MOCK_LEGEND_SKILLS = {
  28134: MOCK_SKILLS[28134], // Legendary Dwarf Stance swap
  27356: MOCK_SKILLS[27356], // Enchanted Daggers heal
  26557: MOCK_SKILLS[26557], // Unyielding Anguish utility
  26821: MOCK_SKILLS[26821], // Jade Winds elite
  28195: makeSkill(28195, { name: "Legendary Demon Stance", slot: "Profession_1", type: "Profession" }),
  27220: makeSkill(27220, { name: "Soothing Stone",  slot: "Heal",    type: "Heal" }),
  27014: MOCK_SKILLS[27014],
  26937: makeSkill(26937, { name: "Inspiring Reinforcement", slot: "Utility", type: "Utility" }),
  26864: makeSkill(26864, { name: "Surge of the Mists", slot: "Utility", type: "Utility" }),
  29965: makeSkill(29965, { name: "Embrace the Darkness", slot: "Elite", type: "Elite" }),
  27505: makeSkill(27505, { name: "Pain Absorption", slot: "Utility", type: "Utility" }),
  28401: makeSkill(28401, { name: "Banish Enchantment", slot: "Utility", type: "Utility" }),
  28406: makeSkill(28406, { name: "Legendary Centaur Stance", slot: "Profession_1", type: "Profession" }),
  26521: makeSkill(26521, { name: "Protective Solace", slot: "Heal", type: "Heal" }),
  27917: makeSkill(27917, { name: "Natural Harmony", slot: "Utility", type: "Utility" }),
  26854: makeSkill(26854, { name: "Purifying Essence", slot: "Utility", type: "Utility" }),
  27372: makeSkill(27372, { name: "Energy Expulsion", slot: "Utility", type: "Utility" }),
  28231: makeSkill(28231, { name: "Sword of Wrath",  slot: "Utility", type: "Utility" }),
  29082: makeSkill(29082, { name: "Jade Winds (utility)", slot: "Utility", type: "Utility" }),
  27107: makeSkill(27107, { name: "Phase Traversal", slot: "Utility", type: "Utility" }),
  45773: makeSkill(45773, { name: "Imperial Impact",  slot: "Elite", type: "Elite" }),
  28494: makeSkill(28494, { name: "Legendary Assassin Stance", slot: "Profession_1", type: "Profession" }),
  26462: makeSkill(26462, { name: "Waters of Caladbolg", slot: "Heal", type: "Heal" }),
  27052: makeSkill(27052, { name: "Ventari's Will", slot: "Utility", type: "Utility" }),
  28029: makeSkill(28029, { name: "Protective Solace (Ventari)", slot: "Utility", type: "Utility" }),
  27025: makeSkill(27025, { name: "Natural Harmony (Ventari)", slot: "Utility", type: "Utility" }),
  28287: makeSkill(28287, { name: "Energy Expulsion (Ventari)", slot: "Elite", type: "Elite" }),
  41858: makeSkill(41858, { name: "Legendary Renegade Stance", slot: "Profession_1", type: "Profession" }),
  42949: makeSkill(42949, { name: "Darkrazor's Daring", slot: "Utility", type: "Utility" }),
  41294: makeSkill(41294, { name: "Icerazor's Ire", slot: "Utility", type: "Utility" }),
  44551: makeSkill(44551, { name: "Soulcleave's Summit", slot: "Utility", type: "Utility" }),
  45686: makeSkill(45686, { name: "Orders from Above", slot: "Elite", type: "Elite" }),
  62749: MOCK_SKILLS[62749],
  62832: makeSkill(62832, { name: "Phantom's Onslaught", slot: "Utility", type: "Utility", specialization: 69 }),
  62667: makeSkill(62667, { name: "Scavenger Burst",    slot: "Utility", type: "Utility", specialization: 69 }),
  62711: makeSkill(62711, { name: "Warding Rift",       slot: "Utility", type: "Utility", specialization: 69 }),
  62891: makeSkill(62891, { name: "Legendary Alliance Stance", slot: "Profession_1", type: "Profession", specialization: 69, flip_skill: 62687 }),
  62687: makeSkill(62687, { name: "Urn of Saint Viktor",       slot: "Elite",        type: "Elite",      specialization: 69, flip_skill: 62738 }),
  62738: makeSkill(62738, { name: "Drop Urn of Saint Viktor",  slot: "Elite",        type: "Elite",      specialization: 69 }),
  27162: MOCK_SKILLS[27162], // Elemental Blast (Facet of Elements flip)
};

// ---------------------------------------------------------------------------
// PETS (Ranger — /v2/pets?ids=all)
// ---------------------------------------------------------------------------

const MOCK_PETS_RAW = [
  {
    id: 1, name: "Black Bear", description: "Steadfast companion.", icon: "https://render.guildwars2.com/file/bear.png",
    type: "Ursine",
    skills: [
      { id: 12478 }, // skill 1
      { id: 12479 }, // skill 2
      { id: 12480 }, // skill 3
    ],
  },
  {
    id: 5, name: "Hyena",  description: "Fast and agile.", icon: "https://render.guildwars2.com/file/hyena.png",
    type: "Canine",
    skills: [
      { id: 12461 },
      { id: 12462 },
      { id: 12463 },
    ],
  },
  {
    id: 17, name: "Brown Bear", description: "Sturdy bear.", icon: "https://render.guildwars2.com/file/brownbear.png",
    type: "Ursine",
    skills: [
      { id: 12478 },
      { id: 12479 },
      { id: 12481 },
    ],
  },
  {
    id: 33, name: "Lashtail Devourer", description: "Aquatic pet.", icon: "https://render.guildwars2.com/file/devourer.png",
    type: "Amphibious",
    skills: [
      { id: 12523 },
      { id: 12524 },
      { id: 12525 },
    ],
  },
];

const MOCK_PET_SKILLS = {
  12478: makeSkill(12478, { name: "Maul",          slot: "Weapon_1", type: "Weapon" }),
  12479: makeSkill(12479, { name: "Brutal Charge",  slot: "Weapon_2", type: "Weapon" }),
  12480: makeSkill(12480, { name: "Forage",         slot: "Weapon_3", type: "Weapon" }),
  12481: makeSkill(12481, { name: "Bear Hug",       slot: "Weapon_3", type: "Weapon" }),
  12461: makeSkill(12461, { name: "Lunge",          slot: "Weapon_1", type: "Weapon" }),
  12462: makeSkill(12462, { name: "Savage Pounce",  slot: "Weapon_2", type: "Weapon" }),
  12463: makeSkill(12463, { name: "Infectious Howl", slot: "Weapon_3", type: "Weapon" }),
  12523: makeSkill(12523, { name: "Pierce",         slot: "Weapon_1", type: "Weapon" }),
  12524: makeSkill(12524, { name: "Tail Lash",      slot: "Weapon_2", type: "Weapon" }),
  12525: makeSkill(12525, { name: "Consume Plasma", slot: "Weapon_3", type: "Weapon" }),
  12466: makeSkill(12466, { name: "Long Range Shot", slot: "Weapon_1", type: "Weapon", weapon_type: "Longbow" }),
};

// ---------------------------------------------------------------------------
// Helper: lookup any skill from all mock sources
// ---------------------------------------------------------------------------

function getAllMockSkills() {
  return { ...MOCK_SKILLS, ...MOCK_LEGEND_SKILLS, ...MOCK_PET_SKILLS };
}

module.exports = {
  MOCK_PROFESSIONS,
  MOCK_SPECIALIZATIONS,
  MOCK_SKILLS,
  MOCK_TRAITS,
  MOCK_LEGEND_IDS,
  MOCK_LEGENDS_DATA,
  MOCK_LEGEND_SKILLS,
  MOCK_PETS_RAW,
  MOCK_PET_SKILLS,
  getAllMockSkills,
};
