"use strict";

const fs = require("fs");
const path = require("path");
const { computeAttributes } = require("../src/engine/attributes");
const { hydrateCatalogs } = require("../tests/engine/test-utils");

const FIXTURE_DIR = path.join(__dirname, "../tests/engine/fixtures");

const fixtures = [
  {
    name: "Berserker Warrior",
    description: "Heavy armor, 3-stat, full ascended, signets, Might+Fury assumed",
    ctx: {
      profession: "Warrior",
      specializations: [
        { id: 4, majorChoices: { 1: 1444, 2: 1449, 3: 1437 } },
      ],
      equipment: {
        slots: {
          head: "Berserker's", shoulders: "Berserker's", chest: "Berserker's",
          gloves: "Berserker's", legs: "Berserker's", boots: "Berserker's",
          mainhand1: "Berserker's", offhand1: "Berserker's",
          back: "Berserker's", accessory1: "Berserker's", accessory2: "Berserker's",
          amulet: "Berserker's", ring1: "Berserker's", ring2: "Berserker's",
        },
        weapons: { mainhand1: "greatsword" },
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      assumedBoons: { might: 25, fury: true },
      sigilStacks: null,
    },
    catalogs: {
      traits: [
        { id: 1444, facts: [{ type: "AttributeAdjust", target: "Power", value: 120 }] },
        { id: 1449, facts: [] },
        { id: 1437, facts: [] },
      ],
      specializations: [{ id: 4, minorTraits: [] }],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Viper Mirage",
    description: "Medium armor, 4-stat, trait conversions, food + utility",
    ctx: {
      profession: "Mesmer",
      specializations: [
        { id: 24, majorChoices: { 1: 700 } },
      ],
      equipment: {
        slots: {
          head: "Viper's", shoulders: "Viper's", chest: "Viper's",
          gloves: "Viper's", legs: "Viper's", boots: "Viper's",
          mainhand1: "Viper's",
          back: "Viper's", accessory1: "Viper's", accessory2: "Viper's",
          amulet: "Viper's", ring1: "Viper's", ring2: "Viper's",
        },
        weapons: { mainhand1: "axe" },
        runes: {},
        infusions: {},
        enrichment: null,
        food: 91805,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [
        { id: 700, facts: [{ type: "BuffConversion", source: "Vitality", target: "ConditionDamage", percent: 10 }] },
      ],
      specializations: [{ id: 24, minorTraits: [] }],
      skills: [],
      runes: [],
      foods: [{ id: 91805, name: "Plate of Beef Rendang", buff: "+100 Expertise\n+70 Condition Damage" }],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Celestial Firebrand WvW",
    description: "Heavy armor, 9-stat, WvW Celestial exclusion, rune bonuses",
    ctx: {
      profession: "Guardian",
      specializations: [],
      equipment: {
        slots: {
          head: "Celestial", shoulders: "Celestial", chest: "Celestial",
          gloves: "Celestial", legs: "Celestial", boots: "Celestial",
          mainhand1: "Celestial",
          back: "Celestial", accessory1: "Celestial", accessory2: "Celestial",
          amulet: "Celestial", ring1: "Celestial", ring2: "Celestial",
        },
        weapons: { mainhand1: "axe" },
        runes: {
          head: 24836, shoulders: 24836, chest: 24836,
          gloves: 24836, legs: 24836, boots: 24836,
        },
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "wvw",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [{ id: 24836, name: "Superior Rune of the Scholar", bonuses: ["+25 Power", "+35 Ferocity", "+50 Power", "+65 Ferocity", "+100 Power", "+125 Ferocity"] }],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Harrier Druid",
    description: "Medium armor, 3-stat healing, enrichment, infusions",
    ctx: {
      profession: "Ranger",
      specializations: [],
      equipment: {
        slots: {
          head: "Harrier's", shoulders: "Harrier's", chest: "Harrier's",
          gloves: "Harrier's", legs: "Harrier's", boots: "Harrier's",
          mainhand1: "Harrier's",
          back: "Harrier's", accessory1: "Harrier's", accessory2: "Harrier's",
          amulet: "Harrier's", ring1: "Harrier's", ring2: "Harrier's",
        },
        weapons: { mainhand1: "staff" },
        runes: {},
        infusions: {
          head: [49432], shoulders: [49432], chest: [49432],
          gloves: [49432], legs: [49432], boots: [49432],
        },
        enrichment: 78061,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [{ id: 49432, name: "+5 Healing Power Infusion", infixUpgrade: { attributes: [{ attribute: "Healing", modifier: 5 }] } }],
      enrichments: [{ id: 78061, name: "+10 Concentration Enrichment", infixUpgrade: { attributes: [{ attribute: "BoonDuration", modifier: 10 }] } }],
    },
  },
  {
    name: "Berserker Thief",
    description: "Medium armor, sparse gear (testing empty slots gracefully)",
    ctx: {
      profession: "Thief",
      specializations: [],
      equipment: {
        slots: { chest: "Berserker's", legs: "Berserker's" },
        weapons: {},
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
];

// Generate fixtures
if (!fs.existsSync(FIXTURE_DIR)) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
}

for (const fixture of fixtures) {
  const catalogs = hydrateCatalogs(fixture.catalogs);
  const result = computeAttributes(fixture.ctx, catalogs);
  const output = {
    name: fixture.name,
    description: fixture.description,
    ctx: fixture.ctx,
    catalogs: fixture.catalogs,
    expected: {
      total: result.total,
      derived: result.derived,
    },
  };
  const filename = fixture.name.toLowerCase().replace(/\s+/g, "-") + ".json";
  const filepath = path.join(FIXTURE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Generated: ${filename}`);
}

console.log("Done!");
