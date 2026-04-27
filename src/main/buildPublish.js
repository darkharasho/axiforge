"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { computePublishStats } = require("./statsCompute");

// ---------------------------------------------------------------------------
// Equipment icon constants
// ---------------------------------------------------------------------------

const PROFESSION_WEIGHT = {
  Elementalist: "light", Mesmer: "light", Necromancer: "light",
  Engineer: "medium", Ranger: "medium", Thief: "medium",
  Guardian: "heavy", Warrior: "heavy", Revenant: "heavy",
};

const _R = "https://render.guildwars2.com/file";
const _WK = "https://wiki.guildwars2.com/images";

const ARMOR_ICONS = {
  light: {
    head: `${_R}/06146C9BD029041178F50B5D9ACD0A76E7051408/1634576.png`,
    shoulders: `${_R}/A77403E5F0EB03E46E686B12297A04707AF50278/1634579.png`,
    chest: `${_R}/C8FB494379CC98171EFB0F13923CACFD047743B3/1634574.png`,
    hands: `${_R}/9703DBC0926F6BB4072032E6B55BE593F6B750CD/1634575.png`,
    legs: `${_R}/65A4D3A41592D10EEABD0BC0D611F13A383B0261/1634577.png`,
    feet: `${_R}/FD60D4E3986FA46F4FEBB8131B65159195260B19/1634578.png`,
  },
  medium: {
    head: `${_R}/49092A1358E528DEC67EFA1C090546ED034642E2/1634588.png`,
    shoulders: `${_R}/CF7609512FC6527D805F2B74F26AF4549FF4E808/1634591.png`,
    chest: `${_R}/57360F35D1210D12010F6AE772382450A07D08F6/1634586.png`,
    hands: `${_R}/C57E5E5FA69261A2503CBB50080A6C023A155C49/1634587.png`,
    legs: `${_R}/EBD907C061747927AE062D1B41BC13D0EAF14AD5/1634589.png`,
    feet: `${_R}/BF4C6A48BA02BD6D6AC32F1E9C3F32A50399E336/1634590.png`,
  },
  heavy: {
    head: `${_R}/2695A8E44B7F07EF15A20857790EFCA91513F5F0/1634565.png`,
    shoulders: `${_R}/0F0F4BE73C9316BAA4956A3AA622CB0AE84D9CEA/1634567.png`,
    chest: `${_R}/DACF9B1ACBE8687B6B31ABC0CF295301120D7A67/1634563.png`,
    hands: `${_R}/A5DD0D661970F02CC26D04B510C7C94259B99520/1634564.png`,
    legs: `${_R}/EA9294557C175A43567906721E43962EC4B12D34/1634566.png`,
    feet: `${_R}/E895D40AE0D1A500FFFDB955C27A98FF687AA4C1/1634562.png`,
  },
};

const WEAPON_ICONS = {
  axe: `${_WK}/b/b5/Bandit_Cleaver.png`, dagger: `${_WK}/a/ac/Bandit_Shiv.png`,
  mace: `${_WK}/b/b3/Bandit_Mallet.png`, pistol: `${_WK}/f/f3/Bandit_Revolver.png`,
  sword: `${_WK}/e/e1/Bandit_Slicer.png`, scepter: `${_WK}/9/95/Bandit_Baton.png`,
  focus: `${_WK}/d/da/Bandit_Focus.png`, shield: `${_WK}/7/7c/Bandit_Ward.png`,
  torch: `${_WK}/7/7e/Bandit_Torch.png`, warhorn: `${_WK}/3/31/Bandit_Bugle.png`,
  greatsword: `${_WK}/0/0b/Bandit_Sunderer.png`, hammer: `${_WK}/f/fb/Bandit_Demolisher.png`,
  longbow: `${_WK}/2/2d/Bandit_Longbow.png`, rifle: `${_WK}/3/37/Bandit_Musket.png`,
  shortbow: `${_WK}/2/2f/Bandit_Short_Bow.png`, staff: `${_WK}/9/98/Bandit_Spire.png`,
  harpoon: `${_WK}/2/20/Bandit_Harpoon_Gun.png`, spear: `${_WK}/c/c9/Bandit_Spear.png`,
  trident: `${_WK}/6/66/Bandit_Trident.png`,
};

const TRINKET_ICONS = {
  back: `${_R}/5EBEA1A467236237FCBACDC09969647956C4A371/1701118.png`,
  amulet: `${_R}/4944FD054FD80D805B0BFFB2DA60363A7DD31FDB/1614376.png`,
  ring1: `${_R}/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png`,
  ring2: `${_R}/EAA61AAF9BEF031104FD063C0A301A520EF5F5E6/1614682.png`,
  accessory1: `${_R}/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png`,
  accessory2: `${_R}/741D3F520D1DFD7BB9A35AD50FC75152D2B3CA6B/1614709.png`,
};

/**
 * Resolve icon URLs for every equipment slot based on profession weight and weapon types.
 *
 * @param {object} build - Serialized build object
 * @returns {object} - Map of slot name to icon URL
 */
function resolveEquipmentIcons(build) {
  const weight = PROFESSION_WEIGHT[build.profession] || "medium";
  const weapons = build.equipment?.weapons || {};
  const icons = {};
  for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
    icons[slot] = ARMOR_ICONS[weight]?.[slot] || "";
  }
  for (const slot of ["mainhand1", "offhand1", "mainhand2", "offhand2", "aquatic1", "aquatic2"]) {
    const weaponId = (weapons[slot] || "").toLowerCase();
    icons[slot] = WEAPON_ICONS[weaponId] || "";
  }
  Object.assign(icons, TRINKET_ICONS);
  return icons;
}

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
    if (!item) return null;
    // Include description/buff fields for hover previews in the SPA
    // Include infixUpgrade so infusion/enrichment stat contributions are available
    return {
      id: item.id, name: item.name, icon: item.icon,
      ...(item.description ? { description: item.description } : {}),
      ...(item.buffDescription ? { buffDescription: item.buffDescription } : {}),
      ...(item.bonuses ? { bonuses: item.bonuses } : {}),
      ...(item.buff ? { buff: item.buff } : {}),
      ...(item.infixUpgrade ? { infixUpgrade: item.infixUpgrade } : {}),
    };
  }

  function resolveByName(label) {
    if (!label) return null;
    return { name: label, icon: "" };
  }

  function resolveRelicByName(label, relicByNameMap) {
    if (!label) return null;
    const item = relicByNameMap?.get(label);
    if (!item) return { name: label, icon: "" };
    return {
      id: item.id, name: item.name, icon: item.icon || "",
      ...(item.description ? { description: item.description } : {}),
      ...(item.facts?.length ? { facts: item.facts } : {}),
    };
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
    relic: resolveRelicByName(equipment.relic, upgradeCatalog.relicByName),
    enrichment: resolveId(equipment.enrichment, upgradeCatalog.enrichmentById),
  };
}

/**
 * Extract upgrade items referenced in notes @[category:id:name] mentions that are
 * not already present in equipmentDisplay.  Returns a flat array of { id, name, icon,
 * category, description? } objects the SPA can use to build lookup maps.
 */
/**
 * Rewrite generic @[item:id:name] mentions in notes to their specific category
 * (e.g. @[rune:id:name], @[food:id:name]) so downstream renderers can resolve them.
 */
function normalizeNotesMentions(notes, upgradeCatalog) {
  if (!notes || !upgradeCatalog) return notes;

  const UPGRADE_MAPS = {
    rune:       upgradeCatalog.runeById,
    sigil:      upgradeCatalog.sigilById,
    food:       upgradeCatalog.foodById,
    utility:    upgradeCatalog.utilityById,
    infusion:   upgradeCatalog.infusionById,
    enrichment: upgradeCatalog.enrichmentById,
    relic:      upgradeCatalog.relicById || new Map(
      (upgradeCatalog.relics || []).map(r => [r.id, r])
    ),
  };

  return notes.replace(/@\[item:(\d+):([^\]]+)\]/g, (match, idStr, name) => {
    const id = Number(idStr);
    for (const [cat, map] of Object.entries(UPGRADE_MAPS)) {
      if (map.has(id)) return `@[${cat}:${idStr}:${name}]`;
    }
    return match; // leave unchanged if not found
  });
}

function resolveCrossProfessionMentions(notes, ownCatalog, extraCatalogs) {
  if (!notes || !Array.isArray(extraCatalogs) || !extraCatalogs.length) {
    return { traits: [], skills: [] };
  }

  const ownTraitIds = new Set((ownCatalog?.traits || []).map(t => t.id));
  const ownSkillIds = new Set([
    ...((ownCatalog?.skills || []).map(s => s.id)),
    ...((ownCatalog?.weaponSkills || []).map(s => s.id)),
  ]);

  const wantedTraits = new Set();
  const wantedSkills = new Set();
  const mentionRegex = /@\[(\w+):(\d+):[^\]]+\]/g;
  let m;
  while ((m = mentionRegex.exec(notes)) !== null) {
    const id = Number(m[2]);
    if (m[1] === "trait" && !ownTraitIds.has(id)) wantedTraits.add(id);
    else if (m[1] === "skill" && !ownSkillIds.has(id)) wantedSkills.add(id);
  }

  if (!wantedTraits.size && !wantedSkills.size) return { traits: [], skills: [] };

  const traits = [];
  const skills = [];
  const seenT = new Set();
  const seenS = new Set();
  for (const cat of extraCatalogs) {
    if (!cat) continue;
    for (const t of cat.traits || []) {
      if (wantedTraits.has(t.id) && !seenT.has(t.id)) {
        traits.push(t);
        seenT.add(t.id);
      }
    }
    for (const s of [...(cat.skills || []), ...(cat.weaponSkills || [])]) {
      if (wantedSkills.has(s.id) && !seenS.has(s.id)) {
        skills.push(s);
        seenS.add(s.id);
      }
    }
  }
  return { traits, skills };
}

function resolveNotesMentions(notes, upgradeCatalog, equipmentDisplay) {
  if (!notes || !upgradeCatalog) return [];

  const UPGRADE_MAPS = {
    rune:       upgradeCatalog.runeById,
    sigil:      upgradeCatalog.sigilById,
    food:       upgradeCatalog.foodById,
    utility:    upgradeCatalog.utilityById,
    infusion:   upgradeCatalog.infusionById,
    enrichment: upgradeCatalog.enrichmentById,
    relic:      upgradeCatalog.relicById || new Map(
      (upgradeCatalog.relics || []).map(r => [r.id, r])
    ),
  };

  // Collect IDs already in equipmentDisplay so we don't duplicate them
  const existing = new Set();
  const eqd = equipmentDisplay || {};
  for (const group of [eqd.runes, eqd.sigils, eqd.infusions]) {
    if (!group) continue;
    for (const val of Object.values(group)) {
      for (const item of [].concat(val).filter(Boolean)) {
        if (item.id) existing.add(item.id);
      }
    }
  }
  for (const item of [eqd.food, eqd.utility, eqd.enrichment, eqd.relic]) {
    if (item?.id) existing.add(item.id);
  }

  const result = [];
  const seen = new Set();
  const mentionRegex = /@\[(\w+):(\d+):[^\]]+\]/g;
  let match;
  while ((match = mentionRegex.exec(notes)) !== null) {
    const category = match[1];
    const id = Number(match[2]);
    if (existing.has(id) || seen.has(id)) continue;
    // "item" is a generic category — search all upgrade maps
    let map = UPGRADE_MAPS[category];
    let resolvedCategory = category;
    if (!map && category === "item") {
      for (const [cat, m] of Object.entries(UPGRADE_MAPS)) {
        if (m.has(id)) { map = m; resolvedCategory = cat; break; }
      }
    }
    if (!map) continue;
    seen.add(id);
    const item = map.get(id);
    if (!item) continue;
    result.push({
      id: item.id,
      name: item.name,
      icon: item.icon || "",
      category: resolvedCategory,
      ...(item.description ? { description: item.description } : {}),
      ...(item.facts?.length ? { facts: item.facts } : {}),
    });
  }
  return result;
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
function serializeForPublish(build, catalog, upgradeCatalog, extraCatalogs = []) {
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

  // Filter profession mechanics (F-skills) by slot, spec lock, and exit/leave names.
  // Accept skills with Profession_ slot that are either in the profession endpoint
  // or have no flip-skill parent (i.e. they are a base skill, not a flipped variant).
  const filteredMechanics = skillsArray
    .filter(s => typeof s.slot === "string" && s.slot.startsWith("Profession_"))
    .filter(s => s.inProfessionEndpoint || !flipSkillIds.has(s.id))
    .filter(s => !exitLeavePattern.test(s.name || ""))
    .filter(s => !flipSkillIds.has(s.id))
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

  // Enrich stored skill/trait objects with full API data (facts, traitedFacts, etc.)
  // The build store strips facts to save space; we restore them from the catalog here.
  const skillById = new Map(skillsArray.map(s => [s.id, s]));
  const traitById = new Map((catalog?.traits || []).map(t => [t.id, t]));

  function enrichSkillRef(stored) {
    if (!stored || !stored.id) return stored;
    const full = skillById.get(stored.id);
    return full ? { ...stored, facts: full.facts, traitedFacts: full.traitedFacts } : stored;
  }

  // Rebuild majorTraitsByTier from catalog when stored data is empty.
  // The build store saves majorChoices (selected trait ID per tier) but may have
  // empty majorTraitsByTier. The catalog has the full major trait ID list per spec.
  const catalogSpecs = catalog?.specializations || [];

  const enrichedSpecializations = (build.specializations || []).map(spec => {
    let mbt = spec.majorTraitsByTier || {};
    const hasStoredTraits = Object.values(mbt).some(arr => Array.isArray(arr) && arr.length > 0);

    if (!hasStoredTraits) {
      // Reconstruct from catalog: find spec's majorTraits, look up each in traitById, group by tier
      const catSpec = catalogSpecs.find(cs => cs.id === spec.id);
      if (catSpec?.majorTraits?.length) {
        const rebuilt = { 1: [], 2: [], 3: [] };
        for (const traitId of catSpec.majorTraits) {
          const trait = traitById.get(traitId);
          if (trait) {
            const tier = Number(trait.tier) || 0;
            if (rebuilt[tier]) rebuilt[tier].push(trait);
          }
        }
        mbt = rebuilt;
      }
    }

    // Enrich minor traits — reconstruct from catalog if empty
    let minorSource = spec.minorTraits || [];
    if (!minorSource.length) {
      const catSpec = catalogSpecs.find(cs => cs.id === spec.id);
      if (catSpec?.minorTraits?.length) {
        minorSource = catSpec.minorTraits;
      }
    }
    const minorTraits = minorSource.map(t => {
      if (typeof t === "number") {
        const full = traitById.get(t);
        return full || t;
      }
      const full = traitById.get(t.id);
      return full ? { ...t, facts: full.facts, traitedFacts: full.traitedFacts } : t;
    });

    // Enrich major traits by tier
    const majorTraitsByTier = Object.fromEntries(
      Object.entries(mbt).map(([tier, traits]) => [
        tier,
        (traits || []).map(t => {
          if (typeof t === "number") {
            const full = traitById.get(t);
            return full || { id: t };
          }
          const full = traitById.get(t.id);
          return full ? { ...t, facts: full.facts, traitedFacts: full.traitedFacts } : t;
        }),
      ])
    );

    // Resolve traitChoices (from axicode import) → majorChoices if needed.
    // traitChoices are 1-based position indices; majorChoices are actual trait IDs.
    // Check both _traitChoices (normalized imports) and traitChoices (raw axicode saves).
    const tc = Array.isArray(spec._traitChoices) ? spec._traitChoices
      : Array.isArray(spec.traitChoices) ? spec.traitChoices : null;
    let majorChoices = spec.majorChoices || { 1: 0, 2: 0, 3: 0 };
    const hasChoices = Object.values(majorChoices).some(v => v);
    if (tc && !hasChoices) {
      majorChoices = {};
      for (const tier of [1, 2, 3]) {
        const posIdx = (Number(tc[tier - 1]) || 1) - 1;
        const traitsInTier = majorTraitsByTier[tier] || [];
        majorChoices[tier] = Number(traitsInTier[posIdx]?.id) || Number(traitsInTier[0]?.id) || 0;
      }
    }

    // Enrich spec metadata (name, elite, icon, background) from catalog
    const catSpec = catalogSpecs.find(cs => cs.id === spec.id);
    const name = spec.name || catSpec?.name || "";
    const elite = spec.elite ?? catSpec?.elite ?? false;
    const icon = spec.icon || catSpec?.icon || "";
    const background = spec.background || catSpec?.background || "";

    return { ...spec, name, elite, icon, background, minorTraits, majorTraitsByTier, majorChoices };
  });

  // Enrich heal/utility/elite skill refs (build store format: { heal: obj, utility: [obj], elite: obj })
  function enrichSkillSelection(sel) {
    if (!sel) return sel;
    return {
      ...sel,
      ...(sel.heal ? { heal: enrichSkillRef(sel.heal) } : {}),
      ...(sel.utility ? { utility: sel.utility.map(s => enrichSkillRef(s)) } : {}),
      ...(sel.elite ? { elite: enrichSkillRef(sel.elite) } : {}),
    };
  }

  // Enriched skill selections with facts restored from catalog
  const enrichedSkills = enrichSkillSelection(build.skills);
  const enrichedUnderwaterSkills = enrichSkillSelection(build.underwaterSkills);

  // Structured land and water skill datasets
  const result_landSkills = {
    weaponSkills: defaultWeaponSkills,
    professionMechanics: defaultMechanics,
    skills: enrichedSkills,
    attunementSkills: hasAttunements ? attunementSkills : null,
  };

  const result_waterSkills = {
    weaponSkills: { aquatic1: weaponSkills.aquatic1, aquatic2: weaponSkills.aquatic2 },
    professionMechanics: filteredMechanics.filter(s => !(s.flags || []).includes("NoUnderwater")),
    skills: enrichedUnderwaterSkills || enrichedSkills,
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
    return pet
      ? { id: pet.id, name: pet.name, icon: pet.icon, skills: pet.skills || [] }
      : { id, name: "", icon: "", skills: [] };
  });

  // Legend display for Revenant
  const legendsArray = catalog?.legends || [];
  const selectedLegends = build.selectedLegends || [];
  const legendDisplay = selectedLegends
    .filter(Boolean)
    .map((legendId) => {
      const legend = legendsArray.find((l) => l.id === legendId);
      if (!legend) return { id: legendId, name: "", icon: "", swap: null };
      const swapSkill = skillsArray.find((s) => s.id === legend.swap);
      return {
        id: legend.id,
        name: legend.name || "",
        icon: swapSkill?.icon || "",
        swap: swapSkill ? { id: swapSkill.id, name: swapSkill.name, icon: swapSkill.icon } : null,
      };
    });

  const equipmentDisplay = resolveEquipmentDisplay(build.equipment, upgradeCatalog);
  const equipmentIcons = resolveEquipmentIcons(build);
  const { stats: computedStats, modifiers: statModifiers } = computePublishStats(
    build.equipment, upgradeCatalog, build.profession, build.gameMode
  );

  // Normalize generic @[item:id:name] → @[rune:id:name] etc. before publish
  const normalizedNotes = normalizeNotesMentions(build.notes, upgradeCatalog);

  return {
    ...build,
    notes: normalizedNotes,
    // Override stored specializations/skills with enriched versions (facts restored)
    specializations: enrichedSpecializations,
    skills: enrichedSkills,
    underwaterSkills: enrichedUnderwaterSkills,
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
    equipmentIcons,
    computedStats,
    statModifiers,
    professionWeapons,
    // Full profession skill + trait catalogs for the SPA renderer.
    // Includes bundle skills, flip-skill chains, toolbelt skills, etc.
    // that aren't part of weapon/utility/mechanic arrays but are referenced by ID.
    catalogSkills: skillsArray,
    catalogWeaponSkills: weaponSkillsArray,
    catalogTraits: catalog?.traits || [],
    // Upgrade items referenced in notes mentions that aren't already in equipmentDisplay.
    // Allows the SPA to resolve @[relic:id:name] etc. for items not currently equipped.
    catalogNotesMentions: resolveNotesMentions(normalizedNotes, upgradeCatalog, equipmentDisplay),
    // Cross-profession trait/skill mentions in notes — e.g. a Reaper build
    // referencing a Guardian trait. Merged into the SPA's id lookups at render time.
    ...(() => {
      const x = resolveCrossProfessionMentions(normalizedNotes, catalog, extraCatalogs);
      return {
        catalogNotesTraits: x.traits,
        catalogNotesSkills: x.skills,
      };
    })(),
  };
}

const PROFESSION_IDS = [
  "Warrior", "Engineer", "Guardian", "Ranger", "Thief",
  "Elementalist", "Mesmer", "Necromancer", "Revenant",
];

// Returns the foreign profession catalogs needed to resolve cross-profession
// trait/skill mentions in a build's notes. Returns [] if notes contain no such
// mentions, so the common case (no @[trait:]/@[skill:] in notes) avoids the
// extra catalog loads.
async function loadCrossProfessionCatalogs(notes, ownProfessionId, getProfessionCatalog, lang = "en") {
  if (!notes || !/@\[(?:trait|skill):\d+:/.test(notes)) return [];
  const others = PROFESSION_IDS.filter(p => p !== ownProfessionId);
  const results = await Promise.allSettled(others.map(p => getProfessionCatalog(p, lang)));
  return results.filter(r => r.status === "fulfilled").map(r => r.value);
}

module.exports = { serializeForPublish, loadCrossProfessionCatalogs };
