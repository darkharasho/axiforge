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

// Relic data — keyed by label since relics are stored by label string, not numeric ID.
const RELIC_BY_LABEL = new Map([
  ["Relic of Akeem",               `${_R}/594C437E9606A167F4F372BCEB0C2B7C7828037B/3122330.png`],
  ["Relic of Antitoxin",           `${_R}/61C74AAFED48CF9AD4BBCAD89F902654EA02B2AE/3122331.png`],
  ["Relic of Cerus",               `${_R}/656FCA9408A0FFDB35A3CE20311E0F66423F026B/3122337.png`],
  ["Relic of Dagda",               `${_R}/CA28F7BFEA1B695DD19204E455BA270D334EE307/3122340.png`],
  ["Relic of Durability",          `${_R}/A8F61493030863CAB537780398D64D80554D959D/3122345.png`],
  ["Relic of Dwayna",              `${_R}/CBBD4FAFCC3568ACA04F9901162FE7C0747C1E9B/3122346.png`],
  ["Relic of Evasion",             `${_R}/19296379D120EF9FF10EE0B0CDD7711DA5E7A9AF/3122347.png`],
  ["Relic of Febe",                `${_R}/3B063D0B0BA20A0530086595F367F0149D9679F2/3187628.png`],
  ["Relic of Fireworks",           `${_R}/2999CCF7C94267B2EE3DDA7459050864622927C9/3122349.png`],
  ["Relic of Isgarren",            `${_R}/5FB808F04E427650A84031E46B632DC292A3583F/3122354.png`],
  ["Relic of Karakosa",            `${_R}/DD034A0B53355503350F07CCFFE5CC06A90F41D9/3187629.png`],
  ["Relic of Leadership",          `${_R}/077C30D957D30B0D282BB21199A193A2D74971DF/3122356.png`],
  ["Relic of Lyhr",                `${_R}/FE580A90C9E4513D062A148045F933C7F3C557E3/3122357.png`],
  ["Relic of Mabon",               `${_R}/49481C31650D384B68A1BFB53DC1A39F2AE4AD56/3122358.png`],
  ["Relic of Mercy",               `${_R}/1AA33B5654D3E7F91B9065BA6D0F1EB6AA755AFF/3122359.png`],
  ["Relic of Nayos",               `${_R}/EA382BAFD541080F71D5530893CC7E069165EA0C/3187631.png`],
  ["Relic of Nourys",              `${_R}/9B47CEBB551B7C5E7A961AB45361E292074E0823/3187632.png`],
  ["Relic of Peitha",              `${_R}/949A6A4179F514FCDEF3AC3D9C292B38D5E0047D/3122365.png`],
  ["Relic of Resistance",          `${_R}/C3A39C916063067E190EE5D42D6CAC2018385F44/3122367.png`],
  ["Relic of Speed",               `${_R}/15B07C1813B63DFD27A6A8A5E36CF1BC50DB0562/3122369.png`],
  ["Relic of Surging",             `${_R}/755D9F3BA1C2C42CDAEBF59BBF4564B77ADC105D/3592840.png`],
  ["Relic of Vampirism",           `${_R}/349D3B9098A1EB445E00C45E70B892E8CFE3762C/3592842.png`],
  ["Relic of Vass",                `${_R}/21D7FDF1DD4EAD33DBC01F11D80E48AD3370FDE6/3122374.png`],
  ["Relic of the Adventurer",      `${_R}/9A76D8C27FCAB8F66D0DC531906808B134D80EAD/3122328.png`],
  ["Relic of the Afflicted",       `${_R}/3B1DA625E3DF0591087E62F12E5301C1D8D6EDC0/3122329.png`],
  ["Relic of the Aristocracy",     `${_R}/BCC01F0B6616FE26ED4BE159532A6A6FBD0EA2D8/3122332.png`],
  ["Relic of the Astral Ward",     `${_R}/57A961A8ADFE279BC4F124A40CC4B5646BC8035F/3161446.png`],
  ["Relic of the Brawler",         `${_R}/2B5297A932F55DA3BDDD0A39C9CB0D9CF70244A1/3122334.png`],
  ["Relic of the Cavalier",        `${_R}/C3AFC50F654E2749ADD9033CE007033F6F9B0D7A/3122335.png`],
  ["Relic of the Centaur",         `${_R}/59551CFA6F4AB3D678370651ABF20D5F69B949D5/3122336.png`],
  ["Relic of the Chronomancer",    `${_R}/C209ABF01D7429EC09354E2E0BBF9DB14EBDD613/3122338.png`],
  ["Relic of the Citadel",         `${_R}/B21C5A6DFCDB0A729358A22CA76547150E7C541E/3122339.png`],
  ["Relic of the Daredevil",       `${_R}/29FE690460A037C7FAC3C71903BA1EBECB204012/3122341.png`],
  ["Relic of the Deadeye",         `${_R}/060151B961CE56CB9546E7B6AF33B0A318426372/3122342.png`],
  ["Relic of the Defender",        `${_R}/E854AFDE03F40ED335C0A30DE90BD9973612BD75/3122343.png`],
  ["Relic of the Demon Queen",     `${_R}/D0C6F322473F2A0F6C65FBD3B21733777BB14015/3187627.png`],
  ["Relic of the Dragonhunter",    `${_R}/F61EEC535059F1FA027049AB4DEFCD5465405DB7/3122344.png`],
  ["Relic of the Earth",           `${_R}/EBB3060FF2E9A10CECC3F1B2CAC0213AE9D93337/3592833.png`],
  ["Relic of the Firebrand",       `${_R}/4E4F4AA81DB63D9D9BB4BF3757D0750E935701F7/3122348.png`],
  ["Relic of the Flock",           `${_R}/2F7AE267BA29B35DEC7F2C0FCE5C30D806E31E0D/3122350.png`],
  ["Relic of the Fractal",         `${_R}/B2D409644147BF18935A95A52505ABCB9EECE142/3122351.png`],
  ["Relic of the Golemancer",      `${_R}/13412697BB6AD89F2E6ED97A750873C0BB35AA9A/3592835.png`],
  ["Relic of the Herald",          `${_R}/DE62250A48F802DD09A1FAFF0D2BA804EA29A3B9/3122352.png`],
  ["Relic of the Holosmith",       `${_R}/0976F60805023D2F14DA6CC72F55F3D64407C7AF/3592836.png`],
  ["Relic of the Ice",             `${_R}/5E0E012F921D3D5D364BFEFC04D7BEF1DC5B52F7/3122353.png`],
  ["Relic of the Krait",           `${_R}/645EFCBFFBB7B1C6630CBB7C0FB268CA27B703AC/3122355.png`],
  ["Relic of the Lich",            `${_R}/045D16259918EFA90A76B4D1B1400AA8D9CC0D4B/3592837.png`],
  ["Relic of the Midnight King",   `${_R}/C0602C3D27B10AC815D4B9F0DF0E4C3D23D12E9F/3187630.png`],
  ["Relic of the Mirage",          `${_R}/5FCA620E77D3D5022ADC70C1191F0B154AB13827/3122360.png`],
  ["Relic of the Monk",            `${_R}/6C340014C525FEF8089AC6DAD03662637A5B07CA/3122361.png`],
  ["Relic of the Necromancer",     `${_R}/B20C589B0915915F5AB55BDA6EC52670B29706F2/3122362.png`],
  ["Relic of the Nightmare",       `${_R}/74940C36779745CBA9DDD56CDF6CBAC1CEA8179F/3122363.png`],
  ["Relic of the Ogre",            `${_R}/633231B05DC3D1D44003DAA891400C4624180D17/3592838.png`],
  ["Relic of the Pack",            `${_R}/26503D1FF7BA354058789E371992A7500B3AA89B/3122364.png`],
  ["Relic of the Privateer",       `${_R}/9CE01CF33B943BCC3FABD8491073DE0AD63F340C/3592839.png`],
  ["Relic of the Reaper",          `${_R}/AFDAA23D3C61F202225DDFA7C17F420C5368BBB8/3122366.png`],
  ["Relic of the Scourge",         `${_R}/0802B36898A6EB0C77D20FD4F3DFD0A2270A3ECD/3122368.png`],
  ["Relic of the Sunless",         `${_R}/CEF1E6DA2DBF143661DF26E668034A621812B61A/3122370.png`],
  ["Relic of the Thief",           `${_R}/3523AC08EB04347CF371E9A91F4B985D12FB4ED3/3122371.png`],
  ["Relic of the Trooper",         `${_R}/500CB9B12FED6948EB74FAF299726007002BDFBA/3122372.png`],
  ["Relic of the Unseen Invasion", `${_R}/0CAF5ACE9D4ABEFF3EF2DE0DB47D57A8AB3CABB3/3122373.png`],
  ["Relic of the Warrior",         `${_R}/1D3CF82C05450A605921F6EB9D0AC23421C9CFA5/3122375.png`],
  ["Relic of the Water",           `${_R}/A202CF0CF4314C049B16A89A595CCC9534B0A90E/3122376.png`],
  ["Relic of the Weaver",          `${_R}/12997110B0509463DD9F1364A92493B2C4309BE1/3122377.png`],
  ["Relic of the Wizard's Tower",  `${_R}/0C0EE407B9DAA44438ED6C2DCDA4EEB30953DF1B/3122378.png`],
  ["Relic of the Zephyrite",       `${_R}/070E32046C250E32DA76F2CBDFC504D6C0AB0344/3122379.png`],
]);

/**
 * Resolve a relic label to a display object { name, icon }.
 * Relics are stored by label string (not numeric ID), so they need a label-based lookup.
 *
 * @param {string} label - Relic label, e.g. "Relic of the Mists"
 * @returns {object|null}
 */
function resolveRelicByLabel(label) {
  if (!label) return null;
  const icon = RELIC_BY_LABEL.get(label);
  return icon ? { name: label, icon } : { name: label, icon: "" };
}

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
    relic: resolveRelicByLabel(equipment.relic),
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
    build.equipment, upgradeCatalog, build.profession
  );

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
    equipmentIcons,
    computedStats,
    statModifiers,
    professionWeapons,
  };
}

module.exports = { serializeForPublish };
