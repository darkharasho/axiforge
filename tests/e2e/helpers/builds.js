const crypto = require("crypto");

function uuid() {
  return crypto.randomUUID();
}

function makeTestBuild(overrides = {}) {
  return {
    id: uuid(),
    version: 2,
    title: "Test Build",
    profession: "Necromancer",
    specializations: [],
    skills: { heal: null, utility: [null, null, null], elite: null },
    underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
    equipment: {
      statPackage: "",
      relic: "",
      food: "",
      utility: "",
      slots: {},
      weapons: {},
      runes: {},
      sigils: {},
      infusions: {},
      enrichment: "",
    },
    tags: [],
    notes: "",
    images: {},
    folderId: null,
    compIds: [],
    pinned: false,
    sortOrder: 0,
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    activeLegendSlot: 0,
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    morphSkillIds: [0, 0, 0],
    gameMode: "pve",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTestComp(overrides = {}) {
  return {
    id: uuid(),
    name: "Test Comp",
    notes: "",
    tags: [],
    folderId: null,
    sortOrder: 0,
    buildIds: [],
    gameMode: null,
    partyLines: [
      { id: uuid(), capacity: 5, slots: [] },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTestFolder(overrides = {}) {
  return {
    id: uuid(),
    name: "Test Folder",
    parentId: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

module.exports = { makeTestBuild, makeTestComp, makeTestFolder, uuid };
