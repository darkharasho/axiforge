"use strict";

const path = require("path");
const fs = require("fs");
const { serializeForPublish } = require("../../../src/main/buildPublish");
const {
  encryptBuild,
  generateFileId,
  generateEncryptionKey,
} = require("../../../src/main/buildEncryption");
const { makeTestBuild, makeTestComp } = require("../../e2e/helpers/builds");

const FIXTURES = path.join(__dirname, "../../e2e/fixtures");

const _catalogCache = new Map();

function normalizeWeaponKey(apiKey) {
  if (apiKey === "HarpoonGun" || apiKey === "Speargun") return "harpoon";
  return apiKey.toLowerCase();
}

function loadCatalog(professionName) {
  const key = professionName.toLowerCase();
  if (_catalogCache.has(key)) return _catalogCache.get(key);

  const filePath = path.join(FIXTURES, `${key}-catalog.json`);
  if (!fs.existsSync(filePath)) {
    return { specializations: [], traits: [], skills: [], professionWeapons: {}, weaponSkills: [], pets: [], legends: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const profession = raw.profession;

  const professionWeapons = Object.fromEntries(
    Object.entries(profession.weapons || {}).map(([apiKey, wData]) => [
      normalizeWeaponKey(apiKey),
      {
        flags: Array.isArray(wData.flags) ? wData.flags : [],
        specialization: Number(wData.specialization) || 0,
        skills: (wData.skills || []).map((s) => ({
          id: Number(s.id) || 0,
          slot: s.slot || "",
          attunement: s.attunement || "",
        })),
      },
    ])
  );

  const weaponSkillIds = new Set();
  for (const wData of Object.values(profession.weapons || {})) {
    for (const s of wData.skills || []) {
      weaponSkillIds.add(Number(s.id));
    }
  }

  const weaponSkills = raw.skills.filter((s) => weaponSkillIds.has(s.id));

  let pets = [];
  const petsPath = path.join(FIXTURES, "pets.json");
  if (fs.existsSync(petsPath)) pets = JSON.parse(fs.readFileSync(petsPath, "utf-8"));

  let legends = [];
  const legendsPath = path.join(FIXTURES, "legends.json");
  if (fs.existsSync(legendsPath)) legends = JSON.parse(fs.readFileSync(legendsPath, "utf-8"));

  const catalog = {
    specializations: raw.specializations,
    traits: raw.traits,
    skills: raw.skills,
    professionWeapons,
    weaponSkills,
    pets,
    legends,
  };

  _catalogCache.set(key, catalog);
  return catalog;
}

function generateBuildPayload(build, catalog) {
  if (!catalog) catalog = loadCatalog(build.profession || "Necromancer");
  const enriched = serializeForPublish(build, catalog, null);
  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  const base64Payload = encryptBuild(enriched, encKey);
  return { fileId, encKey, base64Payload };
}

function generateCompPayload(comp, builds) {
  const enrichedBuilds = builds.map((b) => {
    const catalog = loadCatalog(b.profession || "Necromancer");
    return serializeForPublish(b, catalog, null);
  });
  const enrichedComp = { ...comp, builds: enrichedBuilds };
  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  const base64Payload = encryptBuild(enrichedComp, encKey);
  return { fileId, encKey, base64Payload };
}

function makeRealisticNecromancerBuild(overrides = {}) {
  return makeTestBuild({
    profession: "Necromancer",
    title: "Power Reaper",
    specializations: [
      {
        id: 53, name: "Spite", elite: false,
        icon: "", background: "",
        minorTraits: [913, 915, 917],
        majorChoices: { 1: 914, 2: 829, 3: 853 },
        majorTraitsByTier: {},
      },
      {
        id: 39, name: "Curses", elite: false,
        icon: "", background: "",
        minorTraits: [802, 803, 810],
        majorChoices: { 1: 801, 2: 1693, 3: 812 },
        majorTraitsByTier: {},
      },
      {
        id: 34, name: "Reaper", elite: true,
        icon: "", background: "",
        minorTraits: [1905, 1879, 2018],
        majorChoices: { 1: 2020, 2: 2031, 3: 2021 },
        majorTraitsByTier: {},
      },
    ],
    skills: {
      heal: { id: 10548, name: "Consume Conditions", icon: "", slot: "Heal" },
      utility: [
        { id: 10546, name: "Well of Suffering", icon: "", slot: "Utility" },
        { id: 10545, name: "Well of Corruption", icon: "", slot: "Utility" },
        { id: 10609, name: "Well of Power", icon: "", slot: "Utility" },
      ],
      elite: { id: 10646, name: "Summon Flesh Golem", icon: "", slot: "Elite" },
    },
    equipment: {
      statPackage: "Berserker",
      relic: "",
      food: "",
      utility: "",
      slots: {},
      weapons: { mainhand1: "Greatsword" },
      runes: {},
      sigils: {},
      infusions: {},
      enrichment: "",
    },
    ...overrides,
  });
}

module.exports = {
  loadCatalog,
  generateBuildPayload,
  generateCompPayload,
  makeTestBuild,
  makeTestComp,
  makeRealisticNecromancerBuild,
};
