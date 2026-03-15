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
 * Resolve weapon skills for a single weapon name from catalog arrays.
 * Returns an array of skill objects (up to 5 for two-handed, 3 for mainhand, 2 for offhand).
 *
 * @param {string} weaponName
 * @param {object} professionWeapons - { [weaponName]: { flags, skills } }
 * @param {Array} weaponSkillsArray - flat array of skill objects with { id, name, icon, ... }
 * @returns {Array}
 */
function resolveWeaponSkills(weaponName, professionWeapons, weaponSkillsArray) {
  if (!weaponName || !professionWeapons || !weaponSkillsArray) return [];

  const weaponDef = professionWeapons[weaponName];
  if (!weaponDef) return [];

  // Build a lookup map from id to full skill data
  const skillById = new Map();
  for (const skill of weaponSkillsArray) {
    skillById.set(skill.id, skill);
  }

  // Map skill references to full skill objects, preserving order
  const resolved = [];
  for (const ref of (weaponDef.skills || [])) {
    const fullSkill = skillById.get(ref.id);
    if (fullSkill) resolved.push(fullSkill);
  }
  return resolved;
}

/**
 * Enrich a serialized build with all data the SPA needs to render without API calls.
 *
 * Adds:
 *   - weaponSkills: { set1, set2, aquatic1, aquatic2 } — resolved weapon skill arrays
 *   - professionMechanics: Array — F1-F5 profession skills (slot starts with "Profession_")
 *   - professionIcon: string — SVG for the active elite spec or base profession
 *   - petDisplay: Array — pet name/icon for Ranger
 *   - legendDisplay: Array — legend name/icon for Revenant
 *
 * All enrichment is best-effort; failures fall back to empty arrays/strings.
 *
 * @param {object} build - Serialized build object from the store
 * @param {object|null} catalog - Catalog returned by getProfessionCatalog(), or null
 * @returns {object} - New object with all build fields plus enrichment fields
 */
function serializeForPublish(build, catalog) {
  const weapons = build.equipment?.weapons || {};
  const professionWeapons = catalog?.professionWeapons || {};
  const weaponSkillsArray = catalog?.weaponSkills || [];
  const skillsArray = catalog?.skills || [];

  // Resolve weapon skills for each set
  const weaponSkills = {
    set1: resolveWeaponSkills(weapons.mainhand1, professionWeapons, weaponSkillsArray),
    set2: resolveWeaponSkills(weapons.mainhand2, professionWeapons, weaponSkillsArray),
    aquatic1: resolveWeaponSkills(weapons.aquatic1, professionWeapons, weaponSkillsArray),
    aquatic2: resolveWeaponSkills(weapons.aquatic2, professionWeapons, weaponSkillsArray),
  };

  // For two-handed weapons, the full set of 5 is already in set1/set2.
  // For one-handed + offhand combos, merge offhand skills (slots 4-5) into the set.
  // The catalog already provides all skills for the mainhand weapon via professionWeapons,
  // so offhand skills would come from a separate offhand weapon lookup if needed.
  // For now the primary resolution covers all slots present in professionWeapons.

  // Profession mechanics: F1-F5 skills (slot starts with "Profession_", inProfessionEndpoint true)
  const professionMechanics = skillsArray.filter(
    (s) => typeof s.slot === "string" && s.slot.startsWith("Profession_") && s.inProfessionEndpoint
  );

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

  return {
    ...build,
    weaponSkills,
    professionMechanics,
    professionIcon,
    petDisplay,
    legendDisplay,
  };
}

module.exports = { serializeForPublish };
