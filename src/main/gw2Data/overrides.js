// Skill description patches for skills the GW2 API returns with missing/empty description.
const KNOWN_SKILL_DESCRIPTION_OVERRIDES = new Map([
  [78661, "Slam your scythe down, creating a shock wave that damages enemies in front of you. This skill gains bonus effects based on the other legend equipped in your other slot. For each point of affinity, deal additional damage and gain another bonus effect from a legend you don't have equipped (gain all effects at three affinity or higher)."],
]);

// Render CDN icon URLs for standard GW2 skill fact types.
const _IC = "https://render.guildwars2.com/file";
const FACT_ICONS = {
  damage:   `${_IC}/61AA4919C4A7990903241B680A69530121E994C7/156657.png`,
  targets:  `${_IC}/BBE8191A494B0352259C10EADFDACCE177E6DA5B/1770208.png`,
  number:   `${_IC}/9352ED3244417304995F26CB01AE76BB7E547052/156661.png`,
  radius:   `${_IC}/B0CD8077991E4FB1622D2930337ED7F9B54211D5/156665.png`,
  percent:  `${_IC}/AAB7C5387A08367C2F023F19FEE70E1556AD4375/1770202.png`,
};

// Fact list patches for skills the GW2 API returns with missing or incomplete facts.
// Durations are in seconds (matching GW2 API fact format). Icons use render CDN URLs.
const KNOWN_SKILL_FACTS_OVERRIDES = new Map([
  // Harbinger elite: Elixir of Ambition (62655) — GW2 API returns no buff facts at all.
  // In-game the skill grants all 12 boons to self for 5 s (Might ×25).
  // Wiki: https://wiki.guildwars2.com/wiki/Elixir_of_Ambition
  [62655, [
    { type: "NoData",   text: "Self Effects on Cast" },
    { type: "Buff", text: "Might",        status: "Might",        duration: 5, apply_count: 25 },
    { type: "Buff", text: "Fury",         status: "Fury",         duration: 5, apply_count: 1 },
    { type: "Buff", text: "Alacrity",     status: "Alacrity",     duration: 5, apply_count: 1 },
    { type: "Buff", text: "Aegis",        status: "Aegis",        duration: 5, apply_count: 1 },
    { type: "Buff", text: "Quickness",    status: "Quickness",    duration: 5, apply_count: 1 },
    { type: "Buff", text: "Protection",   status: "Protection",   duration: 5, apply_count: 1 },
    { type: "Buff", text: "Regeneration", status: "Regeneration", duration: 5, apply_count: 1 },
    { type: "Buff", text: "Resolution",   status: "Resolution",   duration: 5, apply_count: 1 },
    { type: "Buff", text: "Resistance",   status: "Resistance",   duration: 5, apply_count: 1 },
    { type: "Buff", text: "Stability",    status: "Stability",    duration: 5, apply_count: 1 },
    { type: "Buff", text: "Swiftness",    status: "Swiftness",    duration: 5, apply_count: 1 },
    { type: "Buff", text: "Vigor",        status: "Vigor",        duration: 5, apply_count: 1 },
    { type: "NoData",   text: "Effects in Impact Area" },
    { type: "Number",   text: "Number of Targets",            icon: FACT_ICONS.targets, value: 5 },
    { type: "Distance", text: "Radius",                       icon: FACT_ICONS.radius,  distance: 240 },
  ]],
  [78661, [
    { type: "Damage",   text: "Damage",                       icon: FACT_ICONS.damage,  dmg_multiplier: 1.98, hit_count: 1 },
    { type: "Percent",  text: "Damage increase per Affinity", icon: FACT_ICONS.percent, percent: 10 },
    { type: "Number",   text: "Number of Targets",            icon: FACT_ICONS.targets, value: 5 },
    { type: "Distance", text: "Radius",                       icon: FACT_ICONS.radius,  distance: 240 },
    { type: "NoData",   text: "Legendary Assassin Stance: Remove boons from enemies struck." },
    { type: "Number",   text: "Boons Removed",                icon: FACT_ICONS.number,  value: 3 },
    { type: "NoData",   text: "Legendary Demon Stance: Apply conditions to enemies struck." },
    { type: "ApplyBuffCondition", text: "Bleeding", status: "Bleeding", apply_count: 3, duration: 6 },
    { type: "NoData",   text: "Legendary Centaur Stance: Apply boons to allies around you if an enemy is struck." },
    { type: "Buff",     text: "Might",                        status: "Might", apply_count: 10, duration: 8 },
    { type: "Buff",     text: "Fury",                         status: "Fury",  duration: 8 },
    { type: "Number",   text: "Number of allied targets",     icon: FACT_ICONS.targets, value: 5 },
    { type: "NoData",   text: "Legendary Dwarf Stance: Gain barrier if an enemy is struck." },
    { type: "Number",   text: "Barrier",                      icon: FACT_ICONS.number,  value: 1292 },
  ]],
]);

// Fact list patches for traits the GW2 API returns with incorrect values.
// Same pattern as KNOWN_SKILL_FACTS_OVERRIDES but keyed by trait ID.
const KNOWN_TRAIT_FACTS_OVERRIDES = new Map([
  // Versatile Rage (trait 1415, Discipline spec 51) — GW2 API returns Recharge: 4s,
  // but in-game the skill has a 5s recharge. Wiki: https://wiki.guildwars2.com/wiki/Versatile_Rage
  [1415, [
    { type: "Recharge", text: "Recharge", icon: `${_IC}/D767B963D120F077C3B163A05DC05A7317D7DB70/156651.png`, value: 5 },
    { type: "Number",   text: "Adrenaline", icon: `${_IC}/E1E7C4D3A6E62F3D5C9F627CE8175BFB0C614CBE/156652.png`, value: 5 },
    { type: "NoData",   text: "Combat Only", icon: `${_IC}/9352ED3244417304995F26CB01AE76BB7E547052/156661.png` },
  ]],
]);

// Some GW2 skills have specialization: null in /v2/skills despite belonging to an elite spec,
// or their spec is inconsistent between API endpoints. Override the specialization for known skills.
const KNOWN_SKILL_SPEC_OVERRIDES = new Map([
  // Warrior land spear burst (Harrier's Toss) — API tags as Paragon (74) or Spellbreaker (61)
  // but land spear is available to all Warriors. Override to spec 0 (core).
  [73024, 0], [72911, 0], [73042, 0], [73006, 0],  // Harrier's Toss (spec 74 → 0)
  [73014, 0],  // Harrier's Toss (spec 61 → 0)
  [30792, 34],  // Reaper's Shroud → Reaper
  [62567, 64],  // Harbinger Shroud → Harbinger
  [77238, 76],  // Ritualist's Shroud → Ritualist (API returns spec=0)
  [63067, 71],  // Specter Siphon → Specter (77397 is Antiquary spec=77, unrelated)
  // Weaver attunement button skills — /v2/skills returns spec=80 but Weaver spec is 56
  [76580, 56], [76988, 56], [76703, 56], [77082, 56],
  // Weaver Weapon_3 dual-attunement combo skills (Aqua Surge, Earthen Vortex, Plasma Burst, Seismic Impact)
  [76585, 56], [76811, 56], [77089, 56], [76707, 56],
  // Evoker (spec 80) F5 familiar passives — API returns no specialization for all four variants.
  [76643, 80], [77225, 80], [77370, 80], [77226, 80],
  // Evoker F5 familiar chain skills — API returns no specialization.
  [77074, 80], [77357, 80], [76618, 80], [76681, 80],
  // Scrapper Function Gyro variants — profession endpoint incorrectly tags these as Holosmith (57)
  // but /v2/skills correctly returns spec=43 (Scrapper). Without override, they could appear at
  // Holosmith's F5 slot instead of Photon Forge (42938).
  [72103, 43], [72114, 43],
  // Alliance Tactics (Vindicator F3) — API says Profession_2 but in-game it's F3; spec=69.
  [62729, 69],
  // Specter Enter/Exit Shadow Shroud — ensure spec=71.
  [63155, 71], [63251, 71],
  // Antiquary (spec 77) profession mechanic skills — API returns spec=0 or null for these.
  // Mistburn Mortar (F2): two variants (ground-targeted and non-targeted).
  [77277, 77], [77288, 77],
  // Zephyrite Sun Crystal (F2 and F3 variants).
  [76733, 77], [78309, 77],
  // Summon Kryptis Turret (F2): two variants (ground-targeted and non-targeted).
  [77192, 77], [76900, 77],
  // Additional Antiquary stolen skills (Profession_2) — API returns spec=null for all of these.
  [76550, 77],  // Forged Surfer Dash
  [76582, 77],  // Metal Legion Guitar
  [76601, 77],  // Exalted Hammer (variant 1)
  [76702, 77],  // Exalted Hammer (variant 2)
  [76800, 77],  // Holo-Dancer Decoy
  [76816, 77],  // Chak Shield
  [76909, 77],  // Unstable Skritt Bomb
  // Conduit (spec 79) Release Potential variants — one per legend (API may return spec=0 or wrong spec).
  [78845, 79], [78501, 79], [78615, 79], [78661, 79], [78895, 79],
  // Conduit F3 Cosmic Wisdom — ensure spec=79.
  [77371, 79],
  // Paragon (spec 74) burst skills — API returns spec=null for these weapon-specific variants.
  // Without overrides they pass the spec filter for all warrior builds (lockSpec=0 → !lockSpec=true).
  [71922, 74], [71932, 74], [71950, 74], [72029, 74],  // Path to Victory variants
  // Harrier's Toss variants moved to top of map (overridden to spec 0 for underwater mode)
]);

// The GW2 profession API assigns incorrect slot values to Weaver's 4 attunement button skills.
// All four are crammed into Profession_1/2 instead of the correct Profession_1 through 4.
// Override slots here so the renderer places each attunement at the right F-key position.
const KNOWN_SKILL_SLOT_OVERRIDES = new Map([
  [76703, "Profession_1"], // Weaver Fire Attunement  (API wrongly says Profession_2)
  [76988, "Profession_2"], // Weaver Water Attunement (API wrongly says Profession_1)
  [76580, "Profession_3"], // Weaver Air Attunement   (API wrongly says Profession_1)
  [77082, "Profession_4"], // Weaver Earth Attunement (API wrongly says Profession_1)
  [62729, "Profession_3"], // Alliance Tactics (Vindicator F3) — API says Profession_2, in-game is F3
  // Conduit Release Potential variants — all have Profession_2 slot; slot override ensures correct placement.
  [78845, "Profession_2"], [78501, "Profession_2"], [78615, "Profession_2"],
  [78661, "Profession_2"], [78895, "Profession_2"],
  // Conduit Cosmic Wisdom — Profession_3 slot.
  [77371, "Profession_3"],
  // Evoker (spec 80) F5 familiar passives — API returns no slot for all four variants.
  [76643, "Profession_5"], [77225, "Profession_5"], [77370, "Profession_5"], [77226, "Profession_5"],
]);

// Photon Forge (skill 42938) has no bundle_skills in the GW2 API, but in-game it grants
// 5 weapon skills when active. Hardcode them here so the toggle can display them.
// Skills: Light Strike (44588), Holo Leap (42965), Corona Burst (44530),
//         Photon Blitz (45783), Holographic Shockwave (42521).
// Also include the flip_skill (Deactivate Photon Forge: 41123) for the active icon.
const PHOTON_FORGE_SKILL_ID = 42938;
const PHOTON_FORGE_BUNDLE = [44588, 42965, 44530, 45783, 42521];

// Luminary (Guardian elite spec, spec 81) — Enter Radiant Forge (77073) replaces weapon skills.
// API does not expose bundle_skills; hardcoded from /v2/skills lookups.
// Multiple Glaring Burst variants exist (76982→77058→78674 chain); all listed so the slot-based
// dedup in the renderer picks 76950 (the standalone variant, lowest ID) for Weapon_1.
// Flip skills (76910, 77136, 77366) are fetched via RADIANT_FORGE_FLIP_SKILLS but kept OUT of
// the bundle so dedup doesn't pick them over the primary skills.
const RADIANT_FORGE_SKILL_ID = 77073;
const RADIANT_FORGE_BUNDLE      = [76950, 76982, 77058, 78674, 78730, 77339, 76708, 76924, 76978];
const RADIANT_FORGE_FLIP_SKILLS = [76910, 77136, 77366];

// Death Shroud (core Necromancer F1, id 10574) has no bundle_skills in the API. Its transform_skills
// children have specialization: null (spec=0), so the transformBundleBySpec logic skips them.
// Hardcode the 5 in-shroud weapon skills. Transform children are already fetched via transform_skills
// in extraSkillIds; only the flip_skills of those children need explicit addition.
// Skills: Life Blast (10554), Dark Path (10604), Doom (10588), Life Transfer (10594),
//         Tainted Shackles (19504). Exit skill "End Death Shroud" (10585) is excluded.
const DEATH_SHROUD_SKILL_ID = 10574;
const DEATH_SHROUD_BUNDLE = [10554, 10604, 10588, 10594, 19504];
const DEATH_SHROUD_FLIP_SKILLS = [18504, 56916]; // Dhuumfire (Life Blast flip), Dark Pursuit (Dark Path flip)

// Lich Form (Necromancer elite 10550) has no bundle_skills in the API; uses transform_skills.
// The transform children are already fetched via transform_skills in extraSkillIds, but March of
// Undeath (45780, flip_skill of Ripple of Horror 10633) must be added explicitly.
// Skills: Deathly Claws (10634), Lich's Gaze (10635), Ripple of Horror (10633),
//         Summon Madness (10636), Grim Specter (10632). "Return" (14350) is excluded (exit skill).
const LICH_FORM_SKILL_ID = 10550;
const LICH_FORM_BUNDLE = [10634, 10635, 10633, 10636, 10632];
const LICH_FORM_FLIP_SKILLS = [45780]; // March of Undeath (flip of Ripple of Horror)

// Shadow Shroud (Specter elite spec, spec 71) — Enter (63155) / Exit (63251) both sit at
// Profession_2. The GW2 API has no bundle_skills on the Enter skill; hardcode the in-shroud
// weapon skills so the active bundle shows full slots 1-5.
// Slots 2/3 include two API variants each; include both and let slot-based dedup choose one.
// Skills: Haunt Shot (63362), Grasping Shadows (63107/63167), Dawn's Repose (63220/63227),
//         Eternal Night (63160), Mind Shock (63249).
const SHADOW_SHROUD_SKILL_ID = 63155;
const SHADOW_SHROUD_BUNDLE = [63362, 63107, 63167, 63220, 63227, 63160, 63249];

// Firebrand tome chapter skills — the GW2 public API does not expose these via bundle_skills
// or any other field. Skill data sourced from community tools (GW2EI, discretize-ui).
const _WK = "https://wiki.guildwars2.com/images";
const FIREBRAND_TOME_CHAPTERS = new Map([
  [44364, [ // Tome of Justice
    { id: 41258, name: "Chapter 1: Searing Spell",      slot: "Weapon_1", icon: `${_WK}/d/d3/Chapter_1-_Searing_Spell.png`,
      description: "Fueled by tales of the desolation in Istan, incite a great swelling of heat before you.",
      facts: [
        { type: "Damage",              text: "Damage",             dmg_multiplier: 1.6006,  hit_count: 1 },
        { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 2.5, apply_count: 1 },
        { type: "ApplyBuffCondition",  text: "Vulnerability",      status: "Vulnerability", duration: 6 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Range",              value: 600 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 40635, name: "Chapter 2: Igniting Burst",     slot: "Weapon_2", icon: `${_WK}/5/53/Chapter_2-_Igniting_Burst.png`,
      description: "Ignite the air around you in an expanding burst.",
      facts: [
        { type: "Damage",              text: "Damage",             dmg_multiplier: 1.46055, hit_count: 1 },
        { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 5, apply_count: 1 },
        { type: "ApplyBuffCondition",  text: "Weakness",           status: "Weakness",      duration: 3 },
        { type: "ComboFinisher",       text: "Combo Finisher",     finisher_type: "Blast",  percent: 100 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Recharge",            text: "Recharge",           value: 8.5 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 42449, name: "Chapter 3: Heated Rebuke",      slot: "Weapon_3", icon: `${_WK}/e/e7/Chapter_3-_Heated_Rebuke.png`,
      description: "Call forth a heated vortex to collapse your enemies together.",
      facts: [
        { type: "Damage",              text: "Damage",             dmg_multiplier: 0.03001, hit_count: 1 },
        { type: "Distance",            text: "Pull",               value: 240 },
        { type: "Number",              text: "Defiance Break",     value: 150 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Distance",            text: "Range",              value: 900 },
        { type: "Recharge",            text: "Recharge",           value: 15 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 40015, name: "Chapter 4: Scorched Aftermath", slot: "Weapon_4", icon: `${_WK}/c/c9/Chapter_4-_Scorched_Aftermath.png`,
      description: "Detail the suffering in fire and blood inflicted during Vabbi's occupation.",
      facts: [
        { type: "Damage",              text: "Damage",             dmg_multiplier: 1.06008, hit_count: 5 },
        { type: "ApplyBuffCondition",  text: "Bleeding",           status: "Bleeding",      duration: 2, apply_count: 1 },
        { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 2, apply_count: 1 },
        { type: "ComboField",          text: "Combo Field",        field_type: "Fire" },
        { type: "Number",              text: "Pulses",             value: 5 },
        { type: "Duration",            text: "Duration",           duration: 4 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 360 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 42898, name: "Epilogue: Ashes of the Just",   slot: "Weapon_5", icon: `${_WK}/6/6d/Epilogue-_Ashes_of_the_Just.png`,
      description: "Recall the memory of fallen heroes, granting allies the searing blades of justice.",
      facts: [
        { type: "Buff",                text: "Ashes of the Just",  status: "Ashes of the Just", duration: 10 },
        { type: "ApplyBuffCondition",  text: "Burning",            status: "Burning",       duration: 3, apply_count: 1 },
        { type: "Buff",                text: "Might",              status: "Might",         duration: 8, apply_count: 1 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 600 },
        { type: "Recharge",            text: "Recharge",           value: 20 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
  ]],
  [41780, [ // Tome of Resolve
    { id: 45022, name: "Chapter 1: Desert Bloom",       slot: "Weapon_1", icon: `${_WK}/f/fd/Chapter_1-_Desert_Bloom.png`,
      description: "Tales of desert blooms create a wave of healing for your allies.",
      facts: [
        { type: "Heal",                text: "Healing",            value: 5640 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Range",              value: 600 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 40679, name: "Chapter 2: Radiant Recovery",   slot: "Weapon_2", icon: `${_WK}/9/95/Chapter_2-_Radiant_Recovery.png`,
      description: "Release magic from pages detailing the rebuilding of Vabbi, cleansing conditions on nearby allies. Allies are healed for each condition removed.",
      facts: [
        { type: "Heal",                text: "Healing per Condition Removed", value: 3881 },
        { type: "Number",              text: "Conditions Removed", value: 2 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Recharge",            text: "Recharge",           value: 8.75 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 45128, name: "Chapter 3: Azure Sun",          slot: "Weapon_3", icon: `${_WK}/b/bf/Chapter_3-_Azure_Sun.png`,
      description: "Inspired by countless poems describing the comforting powers of the water-reflected sun, grant boons to allies.",
      facts: [
        { type: "Buff",                text: "Vigor",              status: "Vigor",         duration: 5 },
        { type: "Buff",                text: "Regeneration",       status: "Regeneration",  duration: 6 },
        { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 5 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Distance",            text: "Range",              value: 900 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 42008, name: "Chapter 4: Shining River",      slot: "Weapon_4", icon: `${_WK}/1/16/Chapter_4-_Shining_River.png`,
      description: "Release a torrent of pages describing the water cycle of the Elon River. Heal allies and grant them swiftness.",
      facts: [
        { type: "Heal",                text: "Healing",            value: 4640 },
        { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 4 },
        { type: "ComboField",          text: "Combo Field",        field_type: "Water" },
        { type: "Number",              text: "Pulses",             value: 5 },
        { type: "Distance",            text: "Radius",             value: 360 },
        { type: "Recharge",            text: "Recharge",           value: 15.5 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 42925, name: "Epilogue: Eternal Oasis",       slot: "Weapon_5", icon: `${_WK}/5/5f/Epilogue-_Eternal_Oasis.png`,
      description: "Purify your allies with the waters of Amnoon and increase the healing they receive.",
      facts: [
        { type: "Duration",            text: "Duration",           duration: 8 },
        { type: "Number",              text: "Healing Effectiveness Increase", value: "20%" },
        { type: "Number",              text: "Conditions Converted to Boons", value: 5 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 600 },
        { type: "Number",              text: "Page Cost",          value: 2 },
      ] },
  ]],
  [42259, [ // Tome of Courage
    { id: 42986, name: "Chapter 1: Unflinching Charge", slot: "Weapon_1", icon: `${_WK}/3/30/Chapter_1-_Unflinching_Charge.png`,
      description: "Roused by tales of mythical Sunspear charges, ground and motivate allies before you.",
      facts: [
        { type: "Buff",                text: "Protection",         status: "Protection",    duration: 1.5 },
        { type: "Buff",                text: "Swiftness",          status: "Swiftness",     duration: 6 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Range",              value: 600 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 41968, name: "Chapter 2: Daring Challenge",   slot: "Weapon_2", icon: `${_WK}/7/79/Chapter_2-_Daring_Challenge.png`,
      description: "As the tales recount of Turai, taunt your enemies by issuing an insightfully inciting challenge.",
      facts: [
        { type: "ApplyBuffCondition",  text: "Taunt",              status: "Taunt",         duration: 1 },
        { type: "Buff",                text: "Resolution",         status: "Resolution",    duration: 3 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 41836, name: "Chapter 3: Valiant Bulwark",    slot: "Weapon_3", icon: `${_WK}/7/73/Chapter_3-_Valiant_Bulwark.png`,
      description: "Manifest the shimmering purity of the desert sun, reflecting enemy missiles.",
      facts: [
        { type: "Duration",            text: "Duration",           duration: 5 },
        { type: "Distance",            text: "Radius",             value: 240 },
        { type: "Distance",            text: "Range",              value: 900 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 40988, name: "Chapter 4: Stalwart Stand",     slot: "Weapon_4", icon: `${_WK}/8/89/Chapter_4-_Stalwart_Stand.png`,
      description: "Recount the stand of Elonian loyalists against Palawa Joko, granting resistance to your allies.",
      facts: [
        { type: "Buff",                text: "Resistance",         status: "Resistance",    duration: 1 },
        { type: "Number",              text: "Pulses",             value: 3 },
        { type: "ComboField",          text: "Combo Field",        field_type: "Light" },
        { type: "Distance",            text: "Radius",             value: 360 },
        { type: "Recharge",            text: "Recharge",           value: 20 },
        { type: "Number",              text: "Page Cost",          value: 1 },
      ] },
    { id: 44455, name: "Epilogue: Unbroken Lines",      slot: "Weapon_5", icon: `${_WK}/d/d8/Epilogue-_Unbroken_Lines.png`,
      description: "Recalling the memory of heroes past, enchant nearby allies with formidable defenses.",
      facts: [
        { type: "Buff",                text: "Protection",         status: "Protection",    duration: 5 },
        { type: "Buff",                text: "Stability",          status: "Stability",     duration: 5, apply_count: 2 },
        { type: "Buff",                text: "Aegis",              status: "Aegis",         duration: 4 },
        { type: "Number",              text: "Number of Targets",  value: 5 },
        { type: "Distance",            text: "Radius",             value: 600 },
        { type: "Recharge",            text: "Recharge",           value: 25 },
        { type: "Number",              text: "Page Cost",          value: 2 },
      ] },
  ]],
]);
// 42371 is a second GW2 API entry for Tome of Courage at the same slot.
// The ID-descending sort in the renderer prefers it over 42259, so it must share chapters.
FIREBRAND_TOME_CHAPTERS.set(42371, FIREBRAND_TOME_CHAPTERS.get(42259));

// The GW2 API's toolbelt_skill for elixirs points to "Detonate Elixir X" (secondary action),
// but the actual in-game F-slot skill is "Toss Elixir X" (the throw/primary action).
// Map each elixir utility/heal skill ID → correct Toss Elixir toolbelt skill ID.
const ELIXIR_TOOLBELT_OVERRIDES = new Map([
  [5834, 6118], // Elixir H   → Toss Elixir H  (API says 6119 Detonate Elixir H)
  [5821, 6092], // Elixir B   → Toss Elixir B  (API says 6082 Detonate Elixir B)
  [5860, 6077], // Elixir C   → Toss Elixir C  (API says 6078 Detonate Elixir C)
  [5968, 6091], // Elixir R   → Toss Elixir R  (API says 6086 Detonate Elixir R)
  [5861, 6090], // Elixir S   → Toss Elixir S  (API says 6084 Detonate Elixir S)
  [5862, 6089], // Elixir U   → Toss Elixir U  (API says 6088 Detonate Elixir U)
  // Elixir X (5832) keeps Detonate Elixir X (29722) — no Toss Elixir X exists.
]);

// Bladesworn (Warrior elite spec, spec 68) bundle skills — not in GW2 public API.
// Gunsaber bundle: activated by Unsheathe Gunsaber (F1, skill 62745).
const GUNSABER_SKILL_ID = 62745;
const GUNSABER_BUNDLE = [62966, 62930, 62732, 62789, 62885];
const GUNSABER_BUNDLE_SKILLS = [
  { id: 62966, name: "Swift Cut",       slot: "Weapon_1", icon: `${_WK}/e/e3/Swift_Cut.png` },
  { id: 62930, name: "Blooming Fire",   slot: "Weapon_2", icon: `${_WK}/d/d0/Blooming_Fire.png` },
  { id: 62732, name: "Artillery Slash", slot: "Weapon_3", icon: `${_WK}/6/68/Artillery_Slash.png` },
  { id: 62789, name: "Cyclone Trigger", slot: "Weapon_4", icon: `${_WK}/6/6c/Cyclone_Trigger.png` },
  { id: 62885, name: "Break Step",      slot: "Weapon_5", icon: `${_WK}/7/76/Break_Step.png` },
];
// Dragon Trigger bundle: activated by Dragon Trigger (F2, skill 62803).
const DRAGON_TRIGGER_SKILL_ID = 62803;
const DRAGON_TRIGGER_BUNDLE = [62797, 62980, 62951, 62893, 62926];
const DRAGON_TRIGGER_BUNDLE_SKILLS = [
  { id: 62797, name: "Dragon Slash\u2014Force", slot: "Weapon_1", icon: `${_WK}/b/b5/Dragon_Slash%E2%80%94Force.png` },
  { id: 62980, name: "Dragon Slash\u2014Boost", slot: "Weapon_2", icon: `${_WK}/7/75/Dragon_Slash%E2%80%94Boost.png` },
  { id: 62951, name: "Dragon Slash\u2014Reach", slot: "Weapon_3", icon: `${_WK}/e/eb/Dragon_Slash%E2%80%94Reach.png` },
  { id: 62893, name: "Triggerguard",              slot: "Weapon_4", icon: `${_WK}/4/4e/Triggerguard.png` },
  { id: 62926, name: "Flicker Step",              slot: "Weapon_5", icon: `${_WK}/d/de/Flicker_Step.png` },
];

// GW2 API omits flip_skill for some skills; hardcode missing links.
const LEGEND_FLIP_OVERRIDES = new Map([
  [27014, 27162], // Facet of Elements → Elemental Blast
  [63155, 63251], // Enter Shadow Shroud → Exit Shadow Shroud
  // Evoker (spec 80) F5 familiar passive → chain summon (API omits flip_skill entirely).
  [76643, 77074], // Ignite → Conflagration (Fire)
  [77225, 77357], // Splash → Buoyant Deluge (Water)
  [77370, 76618], // Zap → Lightning Blitz (Air)
  [77226, 76681], // Calcify → Seismic Impact (Earth)
]);

// GW2 API omits the attunement field for some Elementalist skills.
// Override so the renderer can match them to the active attunement.
const KNOWN_SKILL_ATTUNEMENT_OVERRIDES = new Map([
  // Evoker F5 familiar passives (each corresponds to one element).
  [76643, "Fire"],  // Ignite
  [77225, "Water"], // Splash
  [77370, "Air"],   // Zap
  [77226, "Earth"], // Calcify
]);

// Evoker (spec 80) F5 familiar passives that are NOT listed in the Elementalist
// profession endpoint. Only Ignite (76643/Fire) appears in the profession endpoint;
// the Water/Air/Earth variants must be explicitly fetched and registered as profession
// mechanics so the F5 slot switches correctly when attunement changes.
const EVOKER_F5_EXTRA_VARIANTS = [77225, 77370, 77226]; // Splash (Water), Zap (Air), Calcify (Earth)

// Untamed (spec 72) Unleashed Ambush skills — trait-granted by Unleashed Power (trait 2268).
// NOT listed in the Ranger profession endpoint; must be explicitly fetched so they appear
// in the Weapon_1 slot when Unleash Ranger is active.
const UNTAMED_UNLEASHED_AMBUSH = [
  63129,  // Sundering Volley (Axe)
  69223,  // Neurotoxin Burst (Dagger)
  63350,  // Savage Slash (Greatsword)
  63438,  // Relentless Whirl (Hammer)
  63301,  // Jagged Fan (Harpoon gun / Speargun)
  72079,  // Rampant Growth (Mace)
  63225,  // Multishot (Longbow)
  63326,  // Toxic Shot (Short bow)
  72932,  // Ravager's Abandon (Spear, land)
  63065,  // Vicious Pike (Spear, aquatic)
  69175,  // Solar Brilliance (Staff)
  63336,  // Deft Strike (Sword)
];

module.exports = {
  KNOWN_SKILL_DESCRIPTION_OVERRIDES,
  _IC,
  FACT_ICONS,
  KNOWN_SKILL_FACTS_OVERRIDES,
  KNOWN_TRAIT_FACTS_OVERRIDES,
  KNOWN_SKILL_SPEC_OVERRIDES,
  KNOWN_SKILL_SLOT_OVERRIDES,
  PHOTON_FORGE_SKILL_ID,
  PHOTON_FORGE_BUNDLE,
  RADIANT_FORGE_SKILL_ID,
  RADIANT_FORGE_BUNDLE,
  RADIANT_FORGE_FLIP_SKILLS,
  DEATH_SHROUD_SKILL_ID,
  DEATH_SHROUD_BUNDLE,
  DEATH_SHROUD_FLIP_SKILLS,
  LICH_FORM_SKILL_ID,
  LICH_FORM_BUNDLE,
  LICH_FORM_FLIP_SKILLS,
  SHADOW_SHROUD_SKILL_ID,
  SHADOW_SHROUD_BUNDLE,
  _WK,
  FIREBRAND_TOME_CHAPTERS,
  GUNSABER_SKILL_ID,
  GUNSABER_BUNDLE,
  GUNSABER_BUNDLE_SKILLS,
  DRAGON_TRIGGER_SKILL_ID,
  DRAGON_TRIGGER_BUNDLE,
  DRAGON_TRIGGER_BUNDLE_SKILLS,
  ELIXIR_TOOLBELT_OVERRIDES,
  LEGEND_FLIP_OVERRIDES,
  KNOWN_SKILL_ATTUNEMENT_OVERRIDES,
  EVOKER_F5_EXTRA_VARIANTS,
  UNTAMED_UNLEASHED_AMBUSH,
};
