"use strict";

const { createGw2MockFetch } = require("../../helpers/mockFetch");
const { MOCK_PROFESSIONS, MOCK_SPECIALIZATIONS, MOCK_LEGENDS_DATA } = require("../../fixtures/gw2Api");
const { buildMechanicSlotsForRender, getSkillOptionsByType } = require("../../../src/renderer/modules/skills");

function normalizeCatalog(raw) {
  return {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((entry) => [Number(entry.id), entry])),
    traitById: new Map((raw.traits || []).map((entry) => [Number(entry.id), entry])),
    skillById: new Map((raw.skills || []).map((entry) => [Number(entry.id), entry])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((entry) => [Number(entry.id), entry])),
    legendById: new Map((raw.legends || []).map((entry) => [String(entry.id), entry])),
    petById: new Map((raw.pets || []).map((entry) => [Number(entry.id), entry])),
  };
}

function slotSignature(slot) {
  if (slot?.fakeCommand) return `fake:${slot.fakeCommand}`;
  if (slot?.skill?.id) return String(slot.skill.id);
  return "empty";
}

function buildEditor(caseData, catalog) {
  const specSelections = caseData.specId
    ? [{ specializationId: Number(caseData.specId), majorChoices: caseData.majorChoices || { 1: 0, 2: 0, 3: 0 } }]
    : [];
  const options = getSkillOptionsByType(catalog, specSelections);
  const utilities = [0, 1, 2].map((index) => Number(options.utility?.[index]?.id || 0));
  const weaponKey = Object.keys(catalog.professionWeapons || {})[0] || "";

  const defaultPets = { terrestrial1: 1, terrestrial2: 5, aquatic1: 0, aquatic2: 0 };
  const selectedPets = caseData.selectedPets ? { ...defaultPets, ...caseData.selectedPets } : defaultPets;

  return {
    profession: caseData.profession,
    specializations: specSelections,
    skills: {
      healId: Number(options.heal?.[0]?.id || 0),
      utilityIds: utilities,
      eliteId: Number(options.elite?.[0]?.id || 0),
    },
    activeAttunement: "Fire",
    activeAttunement2: "",
    activeKit: Number(caseData.activeKit || 0),
    activeWeaponSet: 1,
    equipment: {
      weapons: {
        mainhand1: weaponKey,
        offhand1: "",
        mainhand2: "",
        offhand2: "",
      },
    },
    selectedLegends: caseData.legendSlots || ["Legend1", "Legend2"],
    activeLegendSlot: Number(caseData.activeLegendSlot || 0),
    allianceTacticsForm: Number(caseData.allianceTacticsForm || 0),
    selectedPets,
    activePetSlot: caseData.activePetSlot || "terrestrial1",
    morphSkillIds: [0, 0, 0],
    antiquaryArtifacts: caseData.antiquaryArtifacts || { f2: 0, f3: 0 },
  };
}

function setupMechanicsHarness(defaultProfession = "") {
  const context = {
    gw2Data: null,
  };

  beforeAll(() => {
    context.gw2Data = require("../../../src/main/gw2Data");
  });

  beforeEach(() => {
    global.fetch = createGw2MockFetch();
    context.gw2Data._setStaticData({
      professions: Object.values(MOCK_PROFESSIONS),
      specializations: Object.values(MOCK_SPECIALIZATIONS),
      legends: MOCK_LEGENDS_DATA,
    });
  });

  afterEach(() => {
    delete global.fetch;
    context.gw2Data._setStaticData();
  });

  return async function resolve(entry) {
    const caseData = { profession: defaultProfession, ...(entry || {}) };
    const rawCatalog = await context.gw2Data.getProfessionCatalog(caseData.profession);
    const catalog = normalizeCatalog(rawCatalog);
    const editor = buildEditor(caseData, catalog);
    const options = getSkillOptionsByType(catalog, editor.specializations);

    const result = buildMechanicSlotsForRender({
      catalog,
      options: { ...options },
      editor,
      utilitySelection: editor.skills.utilityIds,
      equippedWeapons: editor.equipment.weapons,
      mhKey: "mainhand1",
      ohKey: "offhand1",
      activeAttunement: editor.activeAttunement,
      activeKit: editor.activeKit,
      underwaterMode: Boolean(caseData.underwaterMode),
    });

    const signatures = (result.mechSlots || []).map(slotSignature);
    const skillIds = (result.mechSlots || [])
      .map((slot) => Number(slot?.skill?.id) || 0)
      .filter(Boolean);

    return {
      caseData,
      catalog,
      editor,
      options,
      result,
      signatures,
      skillIds,
    };
  };
}

function createMechanicsSuite(profession, cases) {
  describe(`renderer mechanics selection — ${profession}`, () => {
    const resolve = setupMechanicsHarness(profession);

    test.each(cases)("spec $specId mechanics slots", async (entry) => {
      const { signatures } = await resolve(entry);
      expect(signatures).toEqual(entry.expected);
    });
  });
}

module.exports = {
  createMechanicsSuite,
  setupMechanicsHarness,
};
