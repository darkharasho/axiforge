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

const rawNecro = require("../../../src/web/public/catalogs/Necromancer-pve.json");
const rawEle = require("../../../src/web/public/catalogs/Elementalist-pve.json");
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
