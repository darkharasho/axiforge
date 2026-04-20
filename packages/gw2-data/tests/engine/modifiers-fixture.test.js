"use strict";

/**
 * Fixture-backed modifier tests.
 *
 * Each test uses real GW2 API data (packages/gw2-data/tests/fixtures/fixtures.json)
 * and wiki-verified expected values. One trait per override/modifier category,
 * covering PvE and WvW mode splits where applicable.
 *
 * To refresh fixture data:  node packages/gw2-data/tests/fixtures/capture.js
 */

const path = require("path");
const { collectModifiers } = require("../../src/engine/modifiers");
const { loadOverrides } = require("../../src/engine/overrides");

const FIXTURES = require(path.join(__dirname, "../fixtures/fixtures.json"));
const OVERRIDES = loadOverrides();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTrait(id) {
  const entry = FIXTURES.traits.find((t) => t.id === id);
  if (!entry) throw new Error(`Trait ${id} not in fixtures — run capture.js`);
  return entry.api;
}

function makeCtx(traitId, specId, gameMode = "pve", weaponTypes = []) {
  const weapons = {};
  if (weaponTypes.length) weapons["mainhand1"] = weaponTypes[0];
  return {
    specializations: [{ specializationId: specId, majorChoices: { 1: traitId } }],
    gameMode,
    equipment: { weapons },
    activeWeaponSet: 1,
    underwaterMode: false,
  };
}

function makeCatalogs(traitId, specId, trait) {
  return {
    traitById: new Map([[traitId, trait]]),
    specializationById: new Map([[specId, { id: specId, minorTraits: [] }]]),
  };
}

function getMods(traitId, specId, gameMode = "pve", weaponTypes = []) {
  const trait = getTrait(traitId);
  const ctx = makeCtx(traitId, specId, gameMode, weaponTypes);
  const catalogs = makeCatalogs(traitId, specId, trait);
  return collectModifiers(ctx, catalogs, OVERRIDES);
}

// ---------------------------------------------------------------------------
// Roiling Mists (1719) — implicitFury: critChance(fury) with PvE/WvW split
// Wiki: "+25% Critical Chance from Fury in PvE, +20% in WvW/PvP"
// ---------------------------------------------------------------------------

describe("Roiling Mists (1719) — implicitFury critChance", () => {
  const TRAIT_ID = 1719;
  const SPEC_ID = 3; // Herald

  test("PvE: emits critChance(fury) = 25% (wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "pve");
    const crit = mods.filter((m) => m.type === "critChance" && m.condition === "fury");
    expect(crit).toHaveLength(1);
    expect(crit[0].value).toBe(25);
  });

  test("WvW: emits critChance(fury) = 20% (wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "wvw");
    const crit = mods.filter((m) => m.type === "critChance" && m.condition === "fury");
    expect(crit).toHaveLength(1);
    expect(crit[0].value).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Notoriety (1765) — mightOverride: custom power+condi per Might stack
// Wiki: "+40 Power, +20 Condition Damage per Might stack (instead of +30/+30)"
// ---------------------------------------------------------------------------

describe("Notoriety (1765) — mightOverride (power+condi)", () => {
  const TRAIT_ID = 1765;
  const SPEC_ID = 15; // Curses

  test("emits mightModifier with power=40, condi=20", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    const might = mods.filter((m) => m.type === "mightModifier");
    expect(might).toHaveLength(1);
    expect(might[0].power).toBe(40);
    expect(might[0].condi).toBe(20);
  });

  test("does not emit flatBonus for player stats (mightOverride suppresses AttributeAdjust)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pinnacle of Strength (1453) — mightOverride (power only) + passive critChance
// Wiki: "+40 Power per Might stack (instead of +30), +5% Critical Chance"
// ---------------------------------------------------------------------------

describe("Pinnacle of Strength (1453) — mightOverride + passive critChance", () => {
  const TRAIT_ID = 1453;
  const SPEC_ID = 4; // Strength

  test("emits mightModifier with power=40", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    const might = mods.filter((m) => m.type === "mightModifier");
    expect(might).toHaveLength(1);
    expect(might[0].power).toBe(40);
  });

  test("emits passive critChance = 5% (wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    const crit = mods.filter((m) => m.type === "critChance" && m.condition === null);
    expect(crit).toHaveLength(1);
    expect(crit[0].value).toBe(5);
  });

  test("does not emit flatBonus for Power (AttributeAdjust suppressed by mightOverride)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods.filter((m) => m.type === "flatBonus")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Forceful Greatsword (1338) — weaponConditional: double Power on greatsword
// Wiki: "+120 Power, doubled to +240 while wielding greatsword or underwater spear"
// ---------------------------------------------------------------------------

describe("Forceful Greatsword (1338) — weaponConditional flatBonus", () => {
  const TRAIT_ID = 1338;
  const SPEC_ID = 4; // Strength

  test("without greatsword equipped: emits Power +120", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "pve", []);
    const power = mods.filter((m) => m.type === "flatBonus" && m.target === "Power");
    expect(power).toHaveLength(1);
    expect(power[0].value).toBe(120);
  });

  test("with greatsword equipped: emits Power +240 (doubled, wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "pve", ["greatsword"]);
    const power = mods.filter((m) => m.type === "flatBonus" && m.target === "Power");
    expect(power).toHaveLength(1);
    expect(power[0].value).toBe(240);
  });

  test("WvW + greatsword: still doubles (weaponConditional is mode-agnostic)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "wvw", ["greatsword"]);
    const power = mods.filter((m) => m.type === "flatBonus" && m.target === "Power");
    expect(power[0].value).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// Fatal Frenzy (2046) — berserkConditional flatBonus with WvW split
// Wiki: "+300 Power (berserk), +150 Condition Damage PvE / +300 WvW (berserk)"
// ---------------------------------------------------------------------------

describe("Fatal Frenzy (2046) — berserkConditional flatBonus with WvW split", () => {
  const TRAIT_ID = 2046;
  const SPEC_ID = 18; // Berserker

  test("PvE: Power +300 and ConditionDamage +150, both berserk-conditional (wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "pve");
    const berserkMods = mods.filter((m) => m.type === "flatBonus" && m.condition === "berserk");
    const power = berserkMods.find((m) => m.target === "Power");
    const condi = berserkMods.find((m) => m.target === "ConditionDamage");
    expect(power?.value).toBe(300);
    expect(condi?.value).toBe(150);
  });

  test("WvW: ConditionDamage +300 (split from PvE 150), wiki-verified", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID, "wvw");
    const condi = mods.find((m) => m.type === "flatBonus" && m.target === "ConditionDamage" && m.condition === "berserk");
    expect(condi?.value).toBe(300);
  });

  test("condition is 'berserk' for all flatBonus modifiers", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    for (const m of mods.filter((m) => m.type === "flatBonus")) {
      expect(m.condition).toBe("berserk");
    }
  });
});

// ---------------------------------------------------------------------------
// Great Fortitude (1449) — BuffConversion: Power → Vitality and Power → Ferocity
// Wiki: "10% of Power is converted to Vitality and Ferocity"
// ---------------------------------------------------------------------------

describe("Great Fortitude (1449) — BuffConversion (Power → Vitality, Power → Ferocity)", () => {
  const TRAIT_ID = 1449;
  const SPEC_ID = 4; // Strength

  test("emits two conversion modifiers", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods.filter((m) => m.type === "conversion")).toHaveLength(2);
  });

  test("Power → Vitality at 10% (wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    const conv = mods.find((m) => m.type === "conversion" && m.sourceAttr === "Power" && m.target === "Vitality");
    expect(conv).toBeDefined();
    expect(conv.percent).toBe(10);
  });

  test("Power → Ferocity at 10% (CritDamage → Ferocity via CONVERSION_TARGET_MAP, wiki-verified)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    const conv = mods.find((m) => m.type === "conversion" && m.sourceAttr === "Power" && m.target === "Ferocity");
    expect(conv).toBeDefined();
    expect(conv.percent).toBe(10);
  });

  test("conversion condition is null (passive, not fury/berserk)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    for (const m of mods.filter((m) => m.type === "conversion")) {
      expect(m.condition).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Fang and Claw (1016) — petStatOnly: no player modifiers emitted
// Wiki: "+420 Precision / +450 Ferocity — but these apply to pets only"
// ---------------------------------------------------------------------------

describe("Fang and Claw (1016) — petStatOnly exclusion", () => {
  const TRAIT_ID = 1016;
  const SPEC_ID = 30; // Beastmastery

  test("emits no modifiers at all (petStatOnly skips entire trait)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Precise Strike (1011) — ignoreCritChance: 100% crit fact is suppressed
// Wiki: "100% Critical Chance on Opening Strike (not a passive bonus)"
// ---------------------------------------------------------------------------

describe("Precise Strike (1011) — ignoreCritChance suppression", () => {
  const TRAIT_ID = 1011;
  const SPEC_ID = 8; // Discipline

  test("emits no critChance modifier (ignoreCritChance override suppresses the 100% fact)", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods.filter((m) => m.type === "critChance")).toHaveLength(0);
  });

  test("emits no modifiers at all for this trait", () => {
    const mods = getMods(TRAIT_ID, SPEC_ID);
    expect(mods).toHaveLength(0);
  });
});
