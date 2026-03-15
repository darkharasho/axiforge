"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Path to gw2-class-icons SVG files
const ICONS_SVG_DIR = path.join(__dirname, "../../node_modules/gw2-class-icons/wiki/svg");

/**
 * Read the SVG string for a given profession or elite spec name.
 * Tries elite spec name first, then falls back to profession name.
 * Returns empty string if neither is found.
 *
 * @param {string} professionName - Base profession name (e.g. "Necromancer")
 * @param {string|undefined} eliteSpecName - Elite spec name (e.g. "Reaper"), if active
 * @returns {string}
 */
function readProfessionIcon(professionName, eliteSpecName) {
  const candidates = [];
  if (eliteSpecName) candidates.push(eliteSpecName);
  if (professionName) candidates.push(professionName);

  for (const name of candidates) {
    const svgPath = path.join(ICONS_SVG_DIR, `${name}.svg`);
    try {
      return fs.readFileSync(svgPath, "utf8");
    } catch {
      // try next candidate
    }
  }
  return "";
}

/**
 * Resolve the full set of weapon skills for a weapon set (mainhand + offhand).
 * Two-handed weapons produce 5 skills from the mainhand alone.
 * One-handed mainhand produces skills 1-3, offhand produces skills 4-5.
 *
 * @param {string} mainhandName
 * @param {string} offhandName
 * @param {object} professionWeapons - { [weaponName]: { flags, skills } }
 * @param {Array} weaponSkillsArray - flat array of skill objects with { id, name, icon, ... }
 * @returns {Array}
 */
function resolveWeaponSet(mainhandName, offhandName, professionWeapons, weaponSkillsArray) {
  if (!professionWeapons || !weaponSkillsArray) return [];
  if (!mainhandName && !offhandName) return [];

  const skillById = new Map();
  for (const skill of weaponSkillsArray) {
    skillById.set(skill.id, skill);
  }

  // Slots array: indices 0-4 map to Weapon_1 through Weapon_5
  const slots = [null, null, null, null, null];

  // Mainhand skills
  const mhDef = mainhandName ? professionWeapons[mainhandName] : null;
  if (mhDef) {
    const isTwoHand = (mhDef.flags || []).includes("TwoHand");
    const maxSlot = isTwoHand ? 5 : 3;
    for (const ref of (mhDef.skills || [])) {
      const slotNum = parseSlotNum(ref.slot);
      if (slotNum >= 1 && slotNum <= maxSlot) {
        const full = skillById.get(ref.id);
        if (full) slots[slotNum - 1] = full;
      }
    }
  }

  // Offhand skills (slots 4-5)
  const ohDef = offhandName ? professionWeapons[offhandName] : null;
  if (ohDef) {
    for (const ref of (ohDef.skills || [])) {
      const slotNum = parseSlotNum(ref.slot);
      if (slotNum >= 4 && slotNum <= 5) {
        const full = skillById.get(ref.id);
        if (full) slots[slotNum - 1] = full;
      }
    }
  }

  return slots.filter(Boolean);
}

/**
 * Resolve weapon skills for a weapon set, filtered to a specific attunement.
 * Skill refs with no attunement (or "None") are included regardless of the filter.
 *
 * @param {string} mainhandName
 * @param {string} offhandName
 * @param {object} professionWeapons
 * @param {Array} weaponSkillsArray
 * @param {string} attunement - e.g. "Fire", "Water", "Air", "Earth"
 * @returns {Array}
 */
function resolveWeaponSetByAttunement(mainhandName, offhandName, professionWeapons, weaponSkillsArray, attunement) {
  if (!professionWeapons || !weaponSkillsArray) return [];
  if (!mainhandName && !offhandName) return [];

  const skillById = new Map();
  for (const skill of weaponSkillsArray) {
    skillById.set(skill.id, skill);
  }

  const slots = [null, null, null, null, null];

  function refMatchesAttunement(ref) {
    const refAtt = ref.attunement || "";
    // Include refs with no attunement or "None" (non-attunement skills)
    if (!refAtt || refAtt === "None") return true;
    return refAtt.toLowerCase() === attunement.toLowerCase();
  }

  // Mainhand skills
  const mhDef = mainhandName ? professionWeapons[mainhandName] : null;
  if (mhDef) {
    const isTwoHand = (mhDef.flags || []).includes("TwoHand");
    const maxSlot = isTwoHand ? 5 : 3;
    for (const ref of (mhDef.skills || [])) {
      if (!refMatchesAttunement(ref)) continue;
      const slotNum = parseSlotNum(ref.slot);
      if (slotNum >= 1 && slotNum <= maxSlot) {
        const full = skillById.get(ref.id);
        if (full) slots[slotNum - 1] = full;
      }
    }
  }

  // Offhand skills (slots 4-5)
  const ohDef = offhandName ? professionWeapons[offhandName] : null;
  if (ohDef) {
    for (const ref of (ohDef.skills || [])) {
      if (!refMatchesAttunement(ref)) continue;
      const slotNum = parseSlotNum(ref.slot);
      if (slotNum >= 4 && slotNum <= 5) {
        const full = skillById.get(ref.id);
        if (full) slots[slotNum - 1] = full;
      }
    }
  }

  return slots.filter(Boolean);
}

function parseSlotNum(slot) {
  const match = /Weapon_(\d)/.exec(slot || "");
  return match ? Number(match[1]) : 0;
}

/**
 * Resolve equipment upgrade IDs (runes, sigils, infusions, consumables) to display objects.
 *
 * @param {object|null} equipment - build.equipment
 * @param {object|null} upgradeCatalog - Catalog returned by getUpgradeCatalog(), or null
 * @returns {object}
 */
function resolveEquipmentDisplay(equipment, upgradeCatalog) {
  if (!equipment || !upgradeCatalog) return {};

  function resolveId(idStr, byIdMap) {
    if (!idStr || !byIdMap) return null;
    const id = Number(idStr);
    if (!id) return null;
    const item = byIdMap.get(id);
    return item ? { id: item.id, name: item.name, icon: item.icon } : null;
  }

  const runes = equipment.runes || {};
  const sigils = equipment.sigils || {};
  const infusions = equipment.infusions || {};

  const resolvedRunes = {};
  for (const [slot, idStr] of Object.entries(runes)) {
    resolvedRunes[slot] = resolveId(idStr, upgradeCatalog.runeById);
  }

  const resolvedSigils = {};
  for (const [slot, value] of Object.entries(sigils)) {
    if (Array.isArray(value)) {
      resolvedSigils[slot] = value.map(id => resolveId(id, upgradeCatalog.sigilById));
    } else {
      resolvedSigils[slot] = [resolveId(value, upgradeCatalog.sigilById)];
    }
  }

  const resolvedInfusions = {};
  for (const [slot, value] of Object.entries(infusions)) {
    if (Array.isArray(value)) {
      resolvedInfusions[slot] = value.map(id => resolveId(id, upgradeCatalog.infusionById));
    } else {
      resolvedInfusions[slot] = resolveId(value, upgradeCatalog.infusionById);
    }
  }

  return {
    runes: resolvedRunes,
    sigils: resolvedSigils,
    infusions: resolvedInfusions,
    food: resolveId(equipment.food, upgradeCatalog.foodById),
    utility: resolveId(equipment.utility, upgradeCatalog.utilityById),
    relic: resolveId(equipment.relic, upgradeCatalog.sigilById),
    enrichment: resolveId(equipment.enrichment, upgradeCatalog.enrichmentById),
  };
}

/**
 * Enrich a serialized build with all data the SPA needs to render without API calls.
 *
 * Adds:
 *   - weaponSkills: { set1, set2, aquatic1, aquatic2 } — resolved weapon skill arrays (backward compat)
 *   - professionMechanics: Array — F1-F5 profession skills filtered by selected specs (backward compat)
 *   - landSkills: { weaponSkills, professionMechanics, skills, attunementSkills } — land skill data
 *   - waterSkills: { weaponSkills, professionMechanics, skills, attunementSkills } — water skill data
 *   - activeAttunement: string — active attunement name (Elementalist only), or ""
 *   - professionIcon: string — SVG for the active elite spec or base profession
 *   - petDisplay: Array — pet name/icon for Ranger
 *   - legendDisplay: Array — legend name/icon for Revenant
 *   - equipmentDisplay: object — resolved runes, sigils, infusions, consumables
 *
 * All enrichment is best-effort; failures fall back to empty arrays/strings.
 *
 * @param {object} build - Serialized build object from the store
 * @param {object|null} catalog - Catalog returned by getProfessionCatalog(), or null
 * @param {object|null} upgradeCatalog - Catalog returned by getUpgradeCatalog(), or null
 * @returns {object} - New object with all build fields plus enrichment fields
 */
function serializeForPublish(build, catalog, upgradeCatalog) {
  const weapons = build.equipment?.weapons || {};
  const professionWeapons = catalog?.professionWeapons || {};
  const weaponSkillsArray = catalog?.weaponSkills || [];
  const skillsArray = catalog?.skills || [];

  // Resolve weapon skills for each set (mainhand + offhand merged) — backward compat flat arrays
  const weaponSkills = {
    set1: resolveWeaponSet(weapons.mainhand1, weapons.offhand1, professionWeapons, weaponSkillsArray),
    set2: resolveWeaponSet(weapons.mainhand2, weapons.offhand2, professionWeapons, weaponSkillsArray),
    aquatic1: resolveWeaponSet(weapons.aquatic1, "", professionWeapons, weaponSkillsArray),
    aquatic2: resolveWeaponSet(weapons.aquatic2, "", professionWeapons, weaponSkillsArray),
  };

  // Detect if this profession uses attunements (Elementalist)
  const hasAttunements = weaponSkillsArray.some(s => s.attunement && s.attunement !== "None");

  // Collect selected spec IDs for F-skill filtering
  const selectedSpecIds = new Set(
    (build.specializations || []).map(s => Number(s?.id) || 0).filter(Boolean)
  );

  // Build flip-skill ID set: skills that are the "flipped" version of another skill
  const flipSkillIds = new Set(skillsArray.flatMap(s => s.flipSkill ? [s.flipSkill] : []));
  const exitLeavePattern = /^(Exit|Leave)\b/i;

  // Filter profession mechanics (F-skills) by slot, endpoint flag, spec lock, and exit/leave names
  const filteredMechanics = skillsArray
    .filter(s => typeof s.slot === "string" && s.slot.startsWith("Profession_") && s.inProfessionEndpoint)
    .filter(s => !exitLeavePattern.test(s.name || ""))
    .filter(s => !flipSkillIds.has(s.id) || s.inProfessionEndpoint || (s.specialization > 0 && s.flipSkill > 0))
    .filter(s => {
      const lockSpec = Number(s.specialization) || 0;
      return !lockSpec || selectedSpecIds.has(lockSpec);
    })
    .sort((a, b) => {
      const na = parseInt((a.slot || "").replace("Profession_", ""), 10) || 0;
      const nb = parseInt((b.slot || "").replace("Profession_", ""), 10) || 0;
      return na - nb;
    });

  // Build attunement-grouped skills (Elementalist only)
  let attunementSkills = null;
  if (hasAttunements) {
    attunementSkills = {};
    for (const att of ["Fire", "Water", "Air", "Earth"]) {
      attunementSkills[att] = {
        set1: resolveWeaponSetByAttunement(weapons.mainhand1, weapons.offhand1, professionWeapons, weaponSkillsArray, att),
        set2: resolveWeaponSetByAttunement(weapons.mainhand2, weapons.offhand2, professionWeapons, weaponSkillsArray, att),
      };
    }
    // Group F-skills by attunement
    for (const att of ["Fire", "Water", "Air", "Earth"]) {
      attunementSkills[att].professionMechanics = filteredMechanics.filter(
        s => s.attunement && s.attunement.toLowerCase() === att.toLowerCase()
      );
    }
  }

  // Determine active attunement
  const activeAttunement = build.activeAttunement || (hasAttunements ? "Fire" : "");

  // Default weapon skills and mechanics for the active attunement (or flat for non-attunement professions)
  const defaultWeaponSkills = hasAttunements
    ? (attunementSkills[activeAttunement] || attunementSkills.Fire)
    : { set1: weaponSkills.set1, set2: weaponSkills.set2 };

  const defaultMechanics = hasAttunements
    ? (attunementSkills[activeAttunement]?.professionMechanics || filteredMechanics)
    : filteredMechanics;

  // Structured land and water skill datasets
  const result_landSkills = {
    weaponSkills: defaultWeaponSkills,
    professionMechanics: defaultMechanics,
    skills: build.skills,
    attunementSkills: hasAttunements ? attunementSkills : null,
  };

  const result_waterSkills = {
    weaponSkills: { aquatic1: weaponSkills.aquatic1, aquatic2: weaponSkills.aquatic2 },
    professionMechanics: filteredMechanics.filter(s => !(s.flags || []).includes("NoUnderwater")),
    skills: build.underwaterSkills || build.skills,
    attunementSkills: null,
  };

  // Determine active elite spec name (last spec with elite: true)
  const eliteSpec = (build.specializations || []).find((s) => s.elite);
  const eliteSpecName = eliteSpec?.name;

  // Read profession icon SVG
  const professionIcon = readProfessionIcon(build.profession, eliteSpecName);

  // Pet display for Ranger
  const petsArray = catalog?.pets || [];
  const selectedPets = build.selectedPets || {};
  const petIds = [
    selectedPets.terrestrial1,
    selectedPets.terrestrial2,
    selectedPets.aquatic1,
    selectedPets.aquatic2,
  ].filter(Boolean);
  const petById = new Map(petsArray.map((p) => [p.id, p]));
  const petDisplay = petIds.map((id) => {
    const pet = petById.get(id);
    return pet ? { id: pet.id, name: pet.name, icon: pet.icon } : { id, name: "", icon: "" };
  });

  // Legend display for Revenant
  const legendsArray = catalog?.legends || [];
  const selectedLegends = build.selectedLegends || [];
  const legendDisplay = selectedLegends
    .filter(Boolean)
    .map((legendId) => {
      const legend = legendsArray.find((l) => l.id === legendId);
      if (!legend) return { id: legendId, name: "", icon: "" };
      // Get the swap skill icon from skills array
      const swapSkill = skillsArray.find((s) => s.id === legend.swap);
      return {
        id: legend.id,
        name: legend.name || "",
        icon: swapSkill?.icon || "",
      };
    });

  const equipmentDisplay = resolveEquipmentDisplay(build.equipment, upgradeCatalog);

  return {
    ...build,
    // Backward-compatible flat fields
    weaponSkills,
    professionMechanics: filteredMechanics,
    // New structured fields
    landSkills: result_landSkills,
    waterSkills: result_waterSkills,
    activeAttunement,
    // Other enriched fields
    professionIcon,
    petDisplay,
    legendDisplay,
    equipmentDisplay,
  };
}

module.exports = { serializeForPublish };
