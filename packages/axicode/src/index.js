"use strict";

const { BitWriter, BitReader } = require("./bitBuffer");
const { z85Encode, z85Decode } = require("./z85");
const {
  professionToIndex, indexToProfession,
  weaponToIndex, indexToWeapon, isWeaponTwoHanded,
  statToIndex, indexToStat,
  relicToIndex, indexToRelic,
  foodToIndex, indexToFood,
  utilityToIndex, indexToUtility,
  legendStringToIndex, indexToLegendString,
} = require("./tables");

const SHARE_CODE_PREFIX = "<AxiForge:";
const CURRENT_VERSION = 1;

const GAME_MODES = ["pve", "pvp", "wvw"];
const ATTUNEMENTS = ["Fire", "Water", "Air", "Earth"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function skillId(skill) {
  return (skill && skill.id) ? skill.id : 0;
}

function parseIntOrZero(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Determine trait position (1=top, 2=mid, 3=bottom, 0=none) */
function traitPosition(spec, tier) {
  const chosen = spec.majorChoices && spec.majorChoices[tier];
  if (!chosen) return 0;
  const tierTraits = spec.majorTraitsByTier && spec.majorTraitsByTier[tier];
  if (!tierTraits) return 0;
  const idx = tierTraits.findIndex(t => t.id === chosen);
  return idx >= 0 ? idx + 1 : 0;
}

/** Check if all values in an array of strings are the same */
function allSame(arr) {
  if (arr.length === 0) return true;
  return arr.every(v => v === arr[0]);
}

/** Collect all infusion values into a flat array for uniformity check */
function collectInfusionValues(infusions) {
  const vals = [];
  for (const key of ["head", "shoulders", "chest", "hands", "legs", "feet", "accessory1", "accessory2"]) {
    if (infusions[key]) vals.push(String(infusions[key]));
  }
  for (const key of ["back", "ring1", "ring2", "mainhand1", "offhand1", "mainhand2", "offhand2"]) {
    const v = infusions[key];
    if (Array.isArray(v)) {
      v.forEach(x => { if (x) vals.push(String(x)); });
    } else if (v) {
      vals.push(String(v));
    }
  }
  return vals;
}

/** Determine if profession has non-default specific data */
function hasProfessionData(build) {
  const prof = build.profession;
  if (prof === "Revenant") {
    return (build.selectedLegends && (build.selectedLegends[0] || build.selectedLegends[1]));
  }
  if (prof === "Ranger") {
    const p = build.selectedPets;
    return p && (p.terrestrial1 || p.terrestrial2);
  }
  if (prof === "Elementalist") {
    return !!build.activeAttunement;
  }
  if (prof === "Engineer") {
    return !!build.activeKit;
  }
  if (prof === "Warrior") {
    return build.activeWeaponSet && build.activeWeaponSet !== 1;
  }
  if (prof === "Thief") {
    const a = build.antiquaryArtifacts;
    return a && (a.f2 || a.f3 || a.f4);
  }
  return false;
}

// ── Encoder ──────────────────────────────────────────────────────────────────

function encodeShareCode(build) {
  const w = new BitWriter();

  const weapons = build.equipment.weapons;
  const runes = build.equipment.runes;
  const infusions = build.equipment.infusions;

  // Determine flags
  const hasUnderwater = !!(
    skillId(build.underwaterSkills && build.underwaterSkills.heal) ||
    (build.underwaterSkills && build.underwaterSkills.utility &&
      build.underwaterSkills.utility.some(s => skillId(s))) ||
    skillId(build.underwaterSkills && build.underwaterSkills.elite) ||
    weapons.aquatic1 || weapons.aquatic2
  );
  const hasOffhand1 = !!weapons.offhand1;
  const hasOffhand2 = !!weapons.offhand2;
  const hasWeaponSet2 = !!weapons.mainhand2;
  const hasProfData = hasProfessionData(build);

  // Per-slot stats: always 0 for v1 (uniform statPackage)
  const perSlotStats = false;

  // Per-slot runes: check if all 6 armor rune slots are the same
  const runeSlots = [runes.head, runes.shoulders, runes.chest, runes.hands, runes.legs, runes.feet];
  const perSlotRunes = !allSame(runeSlots.map(String));

  // Per-slot infusions
  const infValues = collectInfusionValues(infusions);
  const perSlotInfusions = infValues.length > 0 && !allSame(infValues);

  const flags =
    (hasUnderwater ? 1 : 0) |
    (hasOffhand1 ? 2 : 0) |
    (hasOffhand2 ? 4 : 0) |
    (hasWeaponSet2 ? 8 : 0) |
    (hasProfData ? 16 : 0) |
    (perSlotStats ? 32 : 0) |
    (perSlotRunes ? 64 : 0) |
    (perSlotInfusions ? 128 : 0);

  // Header
  w.write(CURRENT_VERSION, 4);
  w.write(flags, 8);

  // Core build
  w.write(professionToIndex(build.profession), 4);
  w.write(GAME_MODES.indexOf(build.gameMode), 2);

  for (let i = 0; i < 3; i++) {
    const spec = build.specializations[i];
    if (spec && spec.id) {
      w.write(spec.id, 7);
      for (let tier = 1; tier <= 3; tier++) {
        w.write(traitPosition(spec, tier), 2);
      }
    } else {
      w.write(0, 7);
      w.write(0, 6);
    }
  }

  // Skills
  w.write(skillId(build.skills.heal), 17);
  for (let i = 0; i < 3; i++) {
    w.write(skillId(build.skills.utility[i]), 17);
  }
  w.write(skillId(build.skills.elite), 17);

  // Equipment - Weapons
  const mh1Idx = weaponToIndex(weapons.mainhand1);
  w.write(mh1Idx, 5);
  if (hasOffhand1) w.write(weaponToIndex(weapons.offhand1), 5);
  if (hasWeaponSet2) {
    const mh2Idx = weaponToIndex(weapons.mainhand2);
    w.write(mh2Idx, 5);
    if (hasOffhand2) w.write(weaponToIndex(weapons.offhand2), 5);
  }

  // Equipment - Stats
  if (!perSlotStats) {
    w.write(statToIndex(build.equipment.statPackage), 5);
  }

  // Equipment - Runes
  if (!perSlotRunes) {
    w.write(parseIntOrZero(runes.head), 17);
  } else {
    for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
      w.write(parseIntOrZero(runes[slot]), 17);
    }
  }

  // Equipment - Sigils
  const mh1TwoHanded = isWeaponTwoHanded(mh1Idx);
  const mh1Sigils = build.equipment.sigils.mainhand1 || [];
  if (mh1TwoHanded) {
    w.write(parseIntOrZero(mh1Sigils[0]), 17);
    w.write(parseIntOrZero(mh1Sigils[1]), 17);
  } else {
    w.write(parseIntOrZero(mh1Sigils[0]), 17);
  }
  if (hasOffhand1) {
    const oh1Sigils = build.equipment.sigils.offhand1 || [];
    w.write(parseIntOrZero(oh1Sigils[0]), 17);
  }
  if (hasWeaponSet2) {
    const mh2Idx = weaponToIndex(weapons.mainhand2);
    const mh2TwoHanded = isWeaponTwoHanded(mh2Idx);
    const mh2Sigils = build.equipment.sigils.mainhand2 || [];
    if (mh2TwoHanded) {
      w.write(parseIntOrZero(mh2Sigils[0]), 17);
      w.write(parseIntOrZero(mh2Sigils[1]), 17);
    } else {
      w.write(parseIntOrZero(mh2Sigils[0]), 17);
    }
    if (hasOffhand2) {
      const oh2Sigils = build.equipment.sigils.offhand2 || [];
      w.write(parseIntOrZero(oh2Sigils[0]), 17);
    }
  }

  // Relic, Food, Utility, Enrichment
  w.write(relicToIndex(build.equipment.relic), 7);
  w.write(foodToIndex(build.equipment.food), 4);
  w.write(utilityToIndex(build.equipment.utility), 3);
  w.write(parseIntOrZero(build.equipment.enrichment), 17);

  // Infusions
  if (!perSlotInfusions) {
    const uniformVal = infValues.length > 0 ? parseIntOrZero(infValues[0]) : 0;
    w.write(uniformVal, 17);
  } else {
    const writeInfSlot = (val) => w.write(parseIntOrZero(val), 17);
    const writeArraySlots = (arr, count) => {
      for (let i = 0; i < count; i++) writeInfSlot(Array.isArray(arr) ? arr[i] : arr);
    };

    for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
      writeInfSlot(infusions[slot]);
    }
    writeArraySlots(infusions.back, 2);
    writeArraySlots(infusions.ring1, 3);
    writeArraySlots(infusions.ring2, 3);
    writeInfSlot(infusions.accessory1);
    writeInfSlot(infusions.accessory2);
    writeArraySlots(infusions.mainhand1, 2);
    if (hasOffhand1) {
      const oh1Inf = infusions.offhand1;
      writeInfSlot(Array.isArray(oh1Inf) ? oh1Inf[0] : oh1Inf);
    }
    if (hasWeaponSet2) {
      writeArraySlots(infusions.mainhand2, 2);
      if (hasOffhand2) {
        const oh2Inf = infusions.offhand2;
        writeInfSlot(Array.isArray(oh2Inf) ? oh2Inf[0] : oh2Inf);
      }
    }
    if (hasUnderwater) {
      writeInfSlot(infusions.breather || 0);
      writeArraySlots(infusions.aquatic1 || [0, 0], 2);
      writeArraySlots(infusions.aquatic2 || [0, 0], 2);
    }
  }

  // Underwater section
  if (hasUnderwater) {
    const uw = build.underwaterSkills || {};
    w.write(skillId(uw.heal), 17);
    const uwUtil = uw.utility || [null, null, null];
    for (let i = 0; i < 3; i++) w.write(skillId(uwUtil[i]), 17);
    w.write(skillId(uw.elite), 17);

    const aq1Idx = weaponToIndex(weapons.aquatic1);
    const aq2Idx = weaponToIndex(weapons.aquatic2);
    w.write(aq1Idx, 5);
    w.write(aq2Idx, 5);

    const aq1Sigils = build.equipment.sigils.aquatic1 || [];
    w.write(parseIntOrZero(aq1Sigils[0]), 17);
    w.write(parseIntOrZero(aq1Sigils[1]), 17);

    if (aq2Idx) {
      const aq2Sigils = build.equipment.sigils.aquatic2 || [];
      w.write(parseIntOrZero(aq2Sigils[0]), 17);
      w.write(parseIntOrZero(aq2Sigils[1]), 17);
    }
  }

  // Profession-specific section
  if (hasProfData) {
    const prof = build.profession;
    if (prof === "Revenant") {
      const legs = build.selectedLegends || ["", ""];
      w.write(legendStringToIndex(legs[0]), 3);
      w.write(legendStringToIndex(legs[1]), 3);
      w.write(0, 1);
      w.write(build.allianceTacticsForm || 0, 1);
      if (hasUnderwater) {
        const uwLegs = build.selectedUnderwaterLegends || ["", ""];
        w.write(legendStringToIndex(uwLegs[0]), 3);
        w.write(legendStringToIndex(uwLegs[1]), 3);
      }
    } else if (prof === "Ranger") {
      const pets = build.selectedPets || {};
      w.write(pets.terrestrial1 || 0, 7);
      w.write(pets.terrestrial2 || 0, 7);
      if (hasUnderwater) {
        w.write(pets.aquatic1 || 0, 7);
        w.write(pets.aquatic2 || 0, 7);
      }
    } else if (prof === "Elementalist") {
      const att1 = ATTUNEMENTS.indexOf(build.activeAttunement);
      w.write(att1 >= 0 ? att1 : 0, 2);
      const att2 = ATTUNEMENTS.indexOf(build.activeAttunement2);
      w.write(att2 >= 0 ? att2 : 0, 2);
    } else if (prof === "Engineer") {
      w.write(build.activeKit || 0, 17);
    } else if (prof === "Warrior") {
      w.write(build.activeWeaponSet === 2 ? 1 : 0, 1);
    } else if (prof === "Thief") {
      const art = build.antiquaryArtifacts || {};
      w.write(art.f2 || 0, 17);
      w.write(art.f3 || 0, 17);
      w.write(art.f4 || 0, 17);
    }
  }

  // Pad to 4-byte boundary for Z85, encode
  const bytes = w.toPaddedBytes(4);
  const payload = z85Encode(bytes);

  // Label: elite spec name or profession name
  let label = build.profession;
  const eliteSpec = build.specializations.find(s => s && s.elite);
  if (eliteSpec) label = eliteSpec.name;

  return `<AxiForge:${label}:${payload}>`;
}

// ── Decoder ──────────────────────────────────────────────────────────────────

function parseShareCodeWrapper(code) {
  if (!code.startsWith(SHARE_CODE_PREFIX) || !code.endsWith(">")) return null;
  const inner = code.slice(SHARE_CODE_PREFIX.length, -1);
  const colonIdx = inner.indexOf(":");
  if (colonIdx < 1) return null;
  const label = inner.slice(0, colonIdx);
  const payload = inner.slice(colonIdx + 1);
  if (!payload) return null;
  return { label, payload };
}

function decodeShareCode(code) {
  const parsed = parseShareCodeWrapper(code);
  if (!parsed) throw new Error("Invalid build code format");

  const payload = parsed.payload;
  let bytes;
  try {
    bytes = z85Decode(payload);
  } catch (e) {
    throw new Error("Corrupted build code");
  }

  const r = new BitReader(bytes);

  const version = r.read(4);
  if (version !== 1) {
    throw new Error("This build code requires a newer version of AxiForge");
  }

  const flags = r.read(8);
  const hasUnderwater = !!(flags & 1);
  const hasOffhand1 = !!(flags & 2);
  const hasOffhand2 = !!(flags & 4);
  const hasWeaponSet2 = !!(flags & 8);
  const hasProfData = !!(flags & 16);
  const perSlotStats = !!(flags & 32);
  const perSlotRunes = !!(flags & 64);
  const perSlotInfusions = !!(flags & 128);

  // Core build
  const profIdx = r.read(4);
  const profession = indexToProfession(profIdx);
  const gameModeIdx = r.read(2);
  const gameMode = GAME_MODES[gameModeIdx] || "pve";

  const specializations = [];
  for (let i = 0; i < 3; i++) {
    const id = r.read(7);
    const t1 = r.read(2);
    const t2 = r.read(2);
    const t3 = r.read(2);
    specializations.push({ id, traitChoices: [t1, t2, t3] });
  }

  // Skills
  const healId = r.read(17);
  const utilityIds = [r.read(17), r.read(17), r.read(17)];
  const eliteId = r.read(17);

  // Weapons
  const mh1Idx = r.read(5);
  const weaponsOut = {
    mainhand1: indexToWeapon(mh1Idx),
    offhand1: "",
    mainhand2: "",
    offhand2: "",
    aquatic1: "",
    aquatic2: "",
  };
  let oh1Idx = 0;
  if (hasOffhand1) {
    oh1Idx = r.read(5);
    weaponsOut.offhand1 = indexToWeapon(oh1Idx);
  }
  let mh2Idx = 0;
  let oh2Idx = 0;
  if (hasWeaponSet2) {
    mh2Idx = r.read(5);
    weaponsOut.mainhand2 = indexToWeapon(mh2Idx);
    if (hasOffhand2) {
      oh2Idx = r.read(5);
      weaponsOut.offhand2 = indexToWeapon(oh2Idx);
    }
  }

  // Stats
  let statPackage = "";
  if (!perSlotStats) {
    statPackage = indexToStat(r.read(5));
  }

  // Runes
  const runesOut = {};
  const RUNE_SLOTS = ["head", "shoulders", "chest", "hands", "legs", "feet"];
  if (!perSlotRunes) {
    const runeId = String(r.read(17));
    for (const slot of RUNE_SLOTS) runesOut[slot] = runeId;
  } else {
    for (const slot of RUNE_SLOTS) runesOut[slot] = String(r.read(17));
  }

  // Sigils
  const sigilsOut = { mainhand1: [], offhand1: [], mainhand2: [], offhand2: [], aquatic1: [], aquatic2: [] };
  const mh1TwoHanded = isWeaponTwoHanded(mh1Idx);
  if (mh1TwoHanded) {
    sigilsOut.mainhand1 = [String(r.read(17)), String(r.read(17))];
  } else {
    sigilsOut.mainhand1 = [String(r.read(17))];
  }
  if (hasOffhand1) {
    sigilsOut.offhand1 = [String(r.read(17))];
  }
  if (hasWeaponSet2) {
    const mh2TwoHanded = isWeaponTwoHanded(mh2Idx);
    if (mh2TwoHanded) {
      sigilsOut.mainhand2 = [String(r.read(17)), String(r.read(17))];
    } else {
      sigilsOut.mainhand2 = [String(r.read(17))];
    }
    if (hasOffhand2) {
      sigilsOut.offhand2 = [String(r.read(17))];
    }
  }

  // Relic, Food, Utility, Enrichment
  const relic = indexToRelic(r.read(7));
  const foodEntry = indexToFood(r.read(4));
  const food = foodEntry.label;
  const utilEntry = indexToUtility(r.read(3));
  const utility = utilEntry.label;
  const enrichment = String(r.read(17));

  // Infusions
  const infusionsOut = {};
  if (!perSlotInfusions) {
    const infId = String(r.read(17));
    for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
      infusionsOut[slot] = infId;
    }
    infusionsOut.back = [infId, infId];
    infusionsOut.ring1 = [infId, infId, infId];
    infusionsOut.ring2 = [infId, infId, infId];
    infusionsOut.accessory1 = infId;
    infusionsOut.accessory2 = infId;
    infusionsOut.mainhand1 = [infId, infId];
    infusionsOut.offhand1 = hasOffhand1 ? [infId] : [];
    infusionsOut.mainhand2 = hasWeaponSet2 ? [infId, infId] : [];
    infusionsOut.offhand2 = (hasWeaponSet2 && hasOffhand2) ? [infId] : [];
  } else {
    for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
      infusionsOut[slot] = String(r.read(17));
    }
    infusionsOut.back = [String(r.read(17)), String(r.read(17))];
    infusionsOut.ring1 = [String(r.read(17)), String(r.read(17)), String(r.read(17))];
    infusionsOut.ring2 = [String(r.read(17)), String(r.read(17)), String(r.read(17))];
    infusionsOut.accessory1 = String(r.read(17));
    infusionsOut.accessory2 = String(r.read(17));
    infusionsOut.mainhand1 = [String(r.read(17)), String(r.read(17))];
    if (hasOffhand1) infusionsOut.offhand1 = [String(r.read(17))];
    else infusionsOut.offhand1 = [];
    if (hasWeaponSet2) {
      infusionsOut.mainhand2 = [String(r.read(17)), String(r.read(17))];
      if (hasOffhand2) infusionsOut.offhand2 = [String(r.read(17))];
      else infusionsOut.offhand2 = [];
    } else {
      infusionsOut.mainhand2 = [];
      infusionsOut.offhand2 = [];
    }
    if (hasUnderwater) {
      infusionsOut.breather = String(r.read(17));
      infusionsOut.aquatic1 = [String(r.read(17)), String(r.read(17))];
      infusionsOut.aquatic2 = [String(r.read(17)), String(r.read(17))];
    }
  }

  // Underwater section
  let underwaterSkills = { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 };
  if (hasUnderwater) {
    const uwHealId = r.read(17);
    const uwUtilIds = [r.read(17), r.read(17), r.read(17)];
    const uwEliteId = r.read(17);
    underwaterSkills = { healId: uwHealId, utilityIds: uwUtilIds, eliteId: uwEliteId };

    const aq1Idx = r.read(5);
    const aq2Idx = r.read(5);
    weaponsOut.aquatic1 = indexToWeapon(aq1Idx);
    weaponsOut.aquatic2 = indexToWeapon(aq2Idx);

    sigilsOut.aquatic1 = [String(r.read(17)), String(r.read(17))];
    if (aq2Idx) {
      sigilsOut.aquatic2 = [String(r.read(17)), String(r.read(17))];
    }
  }

  // Profession-specific
  let selectedLegends = ["", ""];
  let selectedUnderwaterLegends = ["", ""];
  let selectedPets = { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 };
  let activeAttunement = "";
  let activeAttunement2 = "";
  let activeKit = 0;
  let activeWeaponSet = 1;
  let allianceTacticsForm = 0;
  let antiquaryArtifacts = { f2: 0, f3: 0, f4: 0 };

  if (hasProfData) {
    if (profession === "Revenant") {
      selectedLegends = [indexToLegendString(r.read(3)), indexToLegendString(r.read(3))];
      r.read(1);
      allianceTacticsForm = r.read(1);
      if (hasUnderwater) {
        selectedUnderwaterLegends = [indexToLegendString(r.read(3)), indexToLegendString(r.read(3))];
      }
    } else if (profession === "Ranger") {
      selectedPets = {
        terrestrial1: r.read(7),
        terrestrial2: r.read(7),
        aquatic1: hasUnderwater ? r.read(7) : 0,
        aquatic2: hasUnderwater ? r.read(7) : 0,
      };
    } else if (profession === "Elementalist") {
      const att1Idx = r.read(2);
      activeAttunement = ATTUNEMENTS[att1Idx] || "";
      const att2Idx = r.read(2);
      activeAttunement2 = ATTUNEMENTS[att2Idx] || "";
    } else if (profession === "Engineer") {
      activeKit = r.read(17);
    } else if (profession === "Warrior") {
      activeWeaponSet = r.read(1) === 1 ? 2 : 1;
    } else if (profession === "Thief") {
      antiquaryArtifacts = {
        f2: r.read(17),
        f3: r.read(17),
        f4: r.read(17),
      };
    }
  }

  return {
    profession,
    gameMode,
    specializations,
    skills: { healId, utilityIds, eliteId },
    underwaterSkills,
    equipment: {
      statPackage,
      relic,
      food,
      utility,
      enrichment: enrichment === "0" ? "" : enrichment,
      weapons: weaponsOut,
      runes: runesOut,
      sigils: sigilsOut,
      infusions: infusionsOut,
    },
    selectedLegends,
    selectedUnderwaterLegends,
    selectedPets,
    activeAttunement,
    activeAttunement2,
    activeKit,
    activeWeaponSet,
    allianceTacticsForm,
    antiquaryArtifacts,
  };
}

// ── Validator ────────────────────────────────────────────────────────────────

function isValidShareCode(text) {
  return parseShareCodeWrapper(text) !== null;
}

module.exports = { encodeShareCode, decodeShareCode, isValidShareCode };

// Comp codec — loaded after build codec exports are set (avoids circular require)
const { isValidCompCode, encodeCompCode, decodeCompCode } = require("./compCodec");
module.exports.isValidCompCode = isValidCompCode;
module.exports.encodeCompCode = encodeCompCode;
module.exports.decodeCompCode = decodeCompCode;

// File codec — bulk .axicode file encode/decode
const { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile } = require("./fileCodec");
module.exports.encodeAxicodeFile = encodeAxicodeFile;
module.exports.decodeAxicodeFile = decodeAxicodeFile;
module.exports.isValidAxicodeFile = isValidAxicodeFile;
