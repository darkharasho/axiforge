"use strict";

/**
 * Shared harness for per-profession end-to-end integration tests.
 *
 * Provides:
 *   loadCatalog(profession)      — fetch + normalize catalog via mock API
 *   resolveMechSlots(catalog, specId, opts) — run full pipeline, return slot signatures
 *   resolveWeaponSlots(catalog, mainhand, offhand, att1, att2, isWeaver) — weapon skill array
 *   skillOptions(catalog, specId) — getSkillOptionsByType result
 *   setupHarness(profession)     — call inside describe(); returns { loadCatalog, ... }
 */

const { createGw2MockFetch } = require("../../helpers/mockFetch");
const { MOCK_PROFESSIONS, MOCK_SPECIALIZATIONS, MOCK_LEGENDS_DATA } = require("../../fixtures/gw2Api");
const { buildMechanicSlotsForRender, getSkillOptionsByType, getEquippedWeaponSkills } = require("../../../src/renderer/modules/skills");

function normalizeCatalog(raw) {
  return {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((e) => [Number(e.id), e])),
    traitById: new Map((raw.traits || []).map((e) => [Number(e.id), e])),
    skillById: new Map((raw.skills || []).map((e) => [Number(e.id), e])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((e) => [Number(e.id), e])),
    legendById: new Map((raw.legends || []).map((e) => [String(e.id), e])),
    petById: new Map((raw.pets || []).map((e) => [Number(e.id), e])),
  };
}

function slotSig(slot) {
  if (slot?.fakeCommand) return `fake:${slot.fakeCommand}`;
  if (slot?.skill?.id) return String(slot.skill.id);
  return "empty";
}

function setupHarness(defaultProfession = "") {
  const ctx = { gw2Data: null };

  beforeAll(() => {
    ctx.gw2Data = require("../../../src/main/gw2Data");
  });

  beforeEach(() => {
    global.fetch = createGw2MockFetch();
    ctx.gw2Data._setStaticData({
      professions: Object.values(MOCK_PROFESSIONS),
      specializations: Object.values(MOCK_SPECIALIZATIONS),
      legends: MOCK_LEGENDS_DATA,
    });
  });
  afterEach(() => {
    delete global.fetch;
    ctx.gw2Data._setStaticData();
  });

  async function loadCatalog(profession = defaultProfession) {
    return normalizeCatalog(await ctx.gw2Data.getProfessionCatalog(profession));
  }

  function makeSpecSelections(specId) {
    if (!specId) return [];
    return [{ specializationId: Number(specId), majorChoices: { 1: 0, 2: 0, 3: 0 } }];
  }

  function skillOptions(catalog, specId) {
    return getSkillOptionsByType(catalog, makeSpecSelections(specId));
  }

  function buildEditor(catalog, specId, opts = {}) {
    const specSelections = makeSpecSelections(specId);
    if (opts.majorChoices && specSelections.length > 0) {
      specSelections[specSelections.length - 1].majorChoices = opts.majorChoices;
    }
    const options = getSkillOptionsByType(catalog, specSelections);
    const utilities = [0, 1, 2].map((i) => Number(options.utility?.[i]?.id || 0));
    const weaponKey = Object.keys(catalog.professionWeapons || {})[0] || "";

    return {
      profession: defaultProfession,
      specializations: specSelections,
      skills: {
        healId: Number(options.heal?.[0]?.id || 0),
        utilityIds: utilities,
        eliteId: Number(options.elite?.[0]?.id || 0),
      },
      activeAttunement: opts.activeAttunement || "Fire",
      activeAttunement2: opts.activeAttunement2 || "",
      activeKit: Number(opts.activeKit || 0),
      activeWeaponSet: 1,
      equipment: {
        weapons: {
          mainhand1: opts.weapon !== undefined ? opts.weapon : weaponKey,
          offhand1: opts.offhand || "",
          mainhand2: "",
          offhand2: "",
        },
      },
      selectedLegends: opts.legendSlots || ["Legend1", "Legend2"],
      activeLegendSlot: Number(opts.activeLegendSlot || 0),
      allianceTacticsForm: Number(opts.allianceTacticsForm || 0),
      selectedPets: opts.pets || { terrestrial1: 1, terrestrial2: 5, aquatic1: 0, aquatic2: 0 },
      activePetSlot: "terrestrial1",
      morphSkillIds: opts.morphSkillIds || [0, 0, 0],
      antiquaryArtifacts: opts.antiquaryArtifacts || { f2: 0, f3: 0 },
    };
  }

  function resolveMechSlots(catalog, specId, opts = {}) {
    const editor = buildEditor(catalog, specId, opts);
    const options = getSkillOptionsByType(catalog, editor.specializations);
    const result = buildMechanicSlotsForRender({
      catalog,
      options,
      editor,
      utilitySelection: editor.skills.utilityIds,
      equippedWeapons: editor.equipment.weapons,
      mhKey: "mainhand1",
      ohKey: "offhand1",
      activeAttunement: editor.activeAttunement,
      activeKit: editor.activeKit,
    });
    return (result.mechSlots || []).map(slotSig);
  }

  function resolveWeaponSlots(catalog, mainhand, offhand, att1, att2, isWeaver = false) {
    return getEquippedWeaponSkills(
      catalog,
      { mainhand: mainhand || "", offhand: offhand || "" },
      att1 || "",
      att2 || "",
      isWeaver
    );
  }

  return { loadCatalog, skillOptions, buildEditor, resolveMechSlots, resolveWeaponSlots };
}

module.exports = { setupHarness, normalizeCatalog, slotSig };
