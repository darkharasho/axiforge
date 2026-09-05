"use strict";

/**
 * Major traits that replace a profession mechanic slot outright.
 *
 * The GW2 API models these as a flip: Scourge's F5 Desert Shroud (44663) lists
 * Sandstorm Shroud (54870) as its flipSkill, and the Herald of Sorrow trait
 * (2123) lists 54870 in its skills. Because 54870 is a flip target that isn't in
 * the profession endpoint, getSkillOptionsByType drops it from the candidate
 * pool — so without an explicit rule the slot can never resolve to it.
 */

// Fixtures, not the baked catalogs under src/web/public/catalogs — those are
// gitignored build artifacts, so requiring them passes locally and fails in CI.
// Trimmed from the real baked data (profession-mechanic skills, their flip
// targets, and the two traits under test) by scripts/gen-mechanics-fixtures.mjs.
const rawNecro = require("../../fixtures/catalogs/Necromancer-mechanics.json");
const rawEle = require("../../fixtures/catalogs/Elementalist-mechanics.json");
const {
  buildMechanicSlotsForRender,
  getSkillOptionsByType,
} = require("../../../src/renderer/modules/skills");

const SCOURGE = 60;
const HERALD_OF_SORROW = 2123;
const DESERT_SHROUD = 44663;
const SANDSTORM_SHROUD = 54870;

function normalizeCatalog(raw) {
  return {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((e) => [Number(e.id), e])),
    traitById: new Map((raw.traits || []).map((e) => [Number(e.id), e])),
    skillById: new Map((raw.skills || []).map((e) => [Number(e.id), e])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((e) => [Number(e.id), e])),
    legendById: new Map(),
    petById: new Map(),
  };
}

function resolveSlots(raw, specId, majorChoices, extraEditor = {}) {
  const catalog = normalizeCatalog(raw);
  const specializations = [{ specializationId: specId, majorChoices }];
  const editor = {
    profession: raw.profession?.id || "",
    specializations,
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    activeAttunement: "",
    activeKit: 0,
    equipment: { weapons: { mainhand1: "", offhand1: "" } },
    morphSkillIds: [0, 0, 0],
    ...extraEditor,
  };
  const { mechSlots } = buildMechanicSlotsForRender({
    catalog,
    options: getSkillOptionsByType(catalog, specializations),
    editor,
    utilitySelection: [0, 0, 0],
    equippedWeapons: editor.equipment.weapons,
    mhKey: "mainhand1",
    ohKey: "offhand1",
    activeAttunement: editor.activeAttunement,
    activeKit: editor.activeKit,
  });
  return mechSlots.map((slot) => Number(slot?.skill?.id) || 0);
}

describe("trait-replaced profession mechanics", () => {
  test("Scourge F5 is Desert Shroud without Herald of Sorrow", () => {
    const ids = resolveSlots(rawNecro, SCOURGE, { 1: 0, 2: 0, 3: 0 });
    expect(ids[4]).toBe(DESERT_SHROUD);
  });

  test("Herald of Sorrow replaces F5 with Sandstorm Shroud", () => {
    const ids = resolveSlots(rawNecro, SCOURGE, { 1: 0, 2: HERALD_OF_SORROW, 3: 0 });
    expect(ids[4]).toBe(SANDSTORM_SHROUD);
  });

  test("Herald of Sorrow leaves the F1-F4 shade skills alone", () => {
    const untraited = resolveSlots(rawNecro, SCOURGE, { 1: 0, 2: 0, 3: 0 });
    const traited = resolveSlots(rawNecro, SCOURGE, { 1: 0, 2: HERALD_OF_SORROW, 3: 0 });
    expect(traited.slice(0, 4)).toEqual(untraited.slice(0, 4));
  });

  test("minor traits that grant a flip target do not replace the slot", () => {
    // Tempest's Singularity (2025) is a minor granting the Overloads, which are
    // flip targets of the attunement skills. Overloads are a held flip state, not
    // a replacement — F1 must stay Fire Attunement.
    const TEMPEST = 48;
    const FIRE_ATTUNEMENT = 5492;
    const ids = resolveSlots(rawEle, TEMPEST, { 1: 0, 2: 0, 3: 0 });
    expect(ids[0]).toBe(FIRE_ATTUNEMENT);
  });
});

/**
 * The same replacement rule on the weapon bar.
 *
 * Glacial Heart (587) turns Guardian hammer 2 Mighty Blow (9194) into Glacial
 * Blow (53482); Lingering Curse (801) turns Necromancer scepter 3 Feast of
 * Corruption (10709) into Devouring Darkness (51647). Both replacements exist in
 * weaponSkillById but are only reachable as the base skill's flip target, so
 * nothing resolves a slot to them without an explicit pass.
 */
const {
  applyTraitWeaponReplacements,
  getSelectedMajorTraitSkillIds,
} = require("../../../src/renderer/modules/skills");
const {
  resolveEquippedWeaponSkills,
} = require("../../../src/renderer/modules/equipment-weapon-skills");
const rawGuardian = require("../../fixtures/catalogs/Guardian-mechanics.json");

const GLACIAL_HEART = 587;
const MIGHTY_BLOW = 9194;
const GLACIAL_BLOW = 53482;
const VIRTUES = 46;
const LINGERING_CURSE = 801;
const CURSES = 39;
const FEAST_OF_CORRUPTION = 10709;
const DEVOURING_DARKNESS = 51647;

function weaponIds(raw, weapons, specializations) {
  const catalog = normalizeCatalog(raw);
  const {
    getEquippedWeaponSkills,
  } = require("../../../src/renderer/modules/skills");
  const skills = getEquippedWeaponSkills(catalog, weapons);
  return applyTraitWeaponReplacements(catalog, skills, specializations)
    .map((s) => Number(s?.id) || 0);
}

describe("trait-replaced weapon skills", () => {
  test("hammer 2 is Mighty Blow without Glacial Heart", () => {
    const ids = weaponIds(rawGuardian, { mainhand: "hammer", offhand: "" },
      [{ specializationId: VIRTUES, majorChoices: { 1: 0, 2: 0, 3: 0 } }]);
    expect(ids[1]).toBe(MIGHTY_BLOW);
  });

  test("Glacial Heart replaces hammer 2 with Glacial Blow", () => {
    const ids = weaponIds(rawGuardian, { mainhand: "hammer", offhand: "" },
      [{ specializationId: VIRTUES, majorChoices: { 1: 0, 2: GLACIAL_HEART, 3: 0 } }]);
    expect(ids[1]).toBe(GLACIAL_BLOW);
  });

  test("Glacial Heart leaves the rest of the hammer bar alone", () => {
    const weapons = { mainhand: "hammer", offhand: "" };
    const untraited = weaponIds(rawGuardian, weapons,
      [{ specializationId: VIRTUES, majorChoices: {} }]);
    const traited = weaponIds(rawGuardian, weapons,
      [{ specializationId: VIRTUES, majorChoices: { 2: GLACIAL_HEART } }]);
    expect(traited.filter((_, i) => i !== 1)).toEqual(untraited.filter((_, i) => i !== 1));
  });

  test("auto-attack chains are not treated as replacements", () => {
    // Hammer Swing (9159) flips to Hammer Bash — that is the auto-attack chain, and no
    // trait grants it, so slot 1 must stay on the chain's first step.
    const ids = weaponIds(rawGuardian, { mainhand: "hammer", offhand: "" },
      [{ specializationId: VIRTUES, majorChoices: { 2: GLACIAL_HEART } }]);
    expect(ids[0]).toBe(9159);
  });

  test("Lingering Curse replaces scepter 3 with Devouring Darkness", () => {
    const weapons = { mainhand: "scepter", offhand: "" };
    const untraited = weaponIds(rawNecro, weapons,
      [{ specializationId: CURSES, majorChoices: {} }]);
    const traited = weaponIds(rawNecro, weapons,
      [{ specializationId: CURSES, majorChoices: { 3: LINGERING_CURSE } }]);
    expect(untraited[2]).toBe(FEAST_OF_CORRUPTION);
    expect(traited[2]).toBe(DEVOURING_DARKNESS);
  });

  test("a major trait counted under the wrong spec line does not replace", () => {
    // majorChoices left behind after a line is swapped would otherwise apply a trait the
    // build no longer has. Glacial Heart belongs to Virtues (46), not Scourge (60).
    const ids = weaponIds(rawGuardian, { mainhand: "hammer", offhand: "" },
      [{ specializationId: 60, majorChoices: { 2: GLACIAL_HEART } }]);
    expect(ids[1]).toBe(MIGHTY_BLOW);
  });

  test("the equipment panel resolves the replacement too", () => {
    // Same slots are rendered by equipment.js via a different entry point.
    const catalog = normalizeCatalog(rawGuardian);
    catalog.professionWeapons = rawGuardian.professionWeapons;
    const editor = {
      equipment: { weapons: { mainhand1: "hammer", offhand1: "" } },
      activeWeaponSet: 1,
      specializations: [{ specializationId: VIRTUES, majorChoices: { 2: GLACIAL_HEART } }],
    };
    const ids = resolveEquippedWeaponSkills(catalog, editor).map((s) => Number(s?.id) || 0);
    expect(ids[1]).toBe(GLACIAL_BLOW);
  });

  test("minor traits never count as replacements", () => {
    // Singularity (2025) is a minor granting the Overloads; its skills must not appear.
    const catalog = normalizeCatalog(rawEle);
    const ids = getSelectedMajorTraitSkillIds(catalog,
      [{ specializationId: 48, majorChoices: { 1: 2025 } }]);
    expect(ids.size).toBe(0);
  });
});
