/**
 * Resolves the active equipped weapon skills for use in the equipment panel.
 * Extracts weapon resolution logic so both the skills bar and equipment panel
 * can display weapon skills without duplication.
 */
import { getEquippedWeaponSkills } from "./skills.js";

/**
 * Given a catalog and editor state, resolve the 5 weapon skills for the
 * currently active weapon set (without kit/bundle overrides).
 * Returns an array of 5 skill objects (or nulls for empty slots).
 */
export function resolveEquippedWeaponSkills(catalog, editor) {
  if (!catalog) return [];

  const equippedWeapons = editor.equipment?.weapons || {};
  const activeWeaponSet = Number(editor.activeWeaponSet) || 1;
  const isUnderwater = Boolean(editor.underwaterMode);
  const activeAttunement = editor.activeAttunement || "";
  const activeAttunement2 = editor.activeAttunement2 || "";

  // Determine if Weaver (dual-attunement Elementalist elite spec)
  const isWeaver = (editor.specializations || []).some((s) => {
    const specId = Number(s?.specializationId) || 0;
    const spec = catalog.specializationById?.get(specId);
    return spec?.elite && spec?.name === "Weaver";
  });

  if (isUnderwater) {
    const activeAquatic = activeWeaponSet === 2 ? "aquatic2" : "aquatic1";
    return getEquippedWeaponSkills(catalog, {
      mainhand: equippedWeapons[activeAquatic] || "",
      offhand: "",
    }, activeAttunement, "", false, true);
  }

  const mhKey = activeWeaponSet === 2 ? "mainhand2" : "mainhand1";
  const ohKey = activeWeaponSet === 2 ? "offhand2" : "offhand1";

  return getEquippedWeaponSkills(catalog, {
    mainhand: equippedWeapons[mhKey] || "",
    offhand: equippedWeapons[ohKey] || "",
  }, activeAttunement, activeAttunement2, isWeaver, false);
}

/**
 * Returns the list of available attunement names for the current weapon set.
 * Empty array if the profession doesn't use attunements.
 */
export function getAvailableAttunements(catalog, editor) {
  if (!catalog) return [];
  const profWeapons = catalog.professionWeapons || {};
  const equippedWeapons = editor.equipment?.weapons || {};
  const activeWeaponSet = Number(editor.activeWeaponSet) || 1;
  const isUnderwater = Boolean(editor.underwaterMode);

  let mhId, ohId;
  if (isUnderwater) {
    mhId = (equippedWeapons[activeWeaponSet === 2 ? "aquatic2" : "aquatic1"] || "").toLowerCase();
    ohId = "";
  } else {
    mhId = (equippedWeapons[activeWeaponSet === 2 ? "mainhand2" : "mainhand1"] || "").toLowerCase();
    ohId = (equippedWeapons[activeWeaponSet === 2 ? "offhand2" : "offhand1"] || "").toLowerCase();
  }

  const mhData = profWeapons[mhId];
  const isTwoHanded = mhData?.flags?.includes("TwoHand") ?? false;
  const allRefs = [
    ...(mhData?.skills || []),
    ...(!isTwoHanded && ohId ? (profWeapons[ohId]?.skills || []) : []),
  ];
  return [...new Set(allRefs.map((r) => r.attunement).filter(Boolean))];
}

/**
 * For Warrior: resolve the F1 burst skill for the current mainhand weapon.
 * Returns the skill object or null if not Warrior or no burst available.
 * When Berserker berserk mode is active, returns the primal burst variant.
 *
 * @param {object} catalog - active catalog
 * @param {object} editor - editor state
 * @param {Array} professionMechanics - options.profession from getSkillOptionsByType
 */
export function resolveWarriorBurst(catalog, editor, professionMechanics) {
  if (!catalog) return null;
  const profId = catalog.profession?.id || editor.profession || "";
  if (profId !== "Warrior") return null;

  const equippedWeapons = editor.equipment?.weapons || {};
  const activeWeaponSet = Number(editor.activeWeaponSet) || 1;
  const isUnderwater = Boolean(editor.underwaterMode);

  const mhKey = isUnderwater
    ? (activeWeaponSet === 2 ? "aquatic2" : "aquatic1")
    : (activeWeaponSet === 2 ? "mainhand2" : "mainhand1");
  const activeMainhand = (equippedWeapons[mhKey] || "").toLowerCase();
  if (!activeMainhand) return null;

  // Determine elite spec
  const eliteSpecId = (editor.specializations || [])
    .map((s) => Number(s?.specializationId) || 0)
    .filter((id) => id > 0)
    .map((id) => catalog.specializationById?.get(id))
    .find((s) => s?.elite)?.id || 0;

  const isBerserker = eliteSpecId === 18;
  const berserkActive = isBerserker && (Number(editor.activeKit) || 0) > 0;

  const candidates = (professionMechanics || []).filter((s) => s.slot === "Profession_1");
  if (candidates.length === 0) return null;

  const wt = (s) => (s.weaponType || "").toLowerCase();

  let pool;
  if (isBerserker) {
    // Berserker spec id is 18, primal bursts have specialization=51 (the Berserker line internal id)
    const primalPool = candidates.filter((s) => Number(s.specialization) === 51);
    const corePool = candidates.filter((s) => !Number(s.specialization));
    pool = (berserkActive ? primalPool : corePool);
    if (pool.length === 0) pool = candidates;
    pool = [...pool].sort((a, b) => b.id - a.id);
  } else {
    const eliteCandidates = eliteSpecId
      ? candidates.filter((s) => Number(s.specialization) === eliteSpecId)
      : [];
    pool = [...(eliteCandidates.length > 0 ? eliteCandidates : candidates)]
      .sort((a, b) => b.id - a.id);
  }

  return pool.find((s) => wt(s) === activeMainhand)
    || pool.find((s) => !s.weaponType)
    || pool[0]
    || null;
}
