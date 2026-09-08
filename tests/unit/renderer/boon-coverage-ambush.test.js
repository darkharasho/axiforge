"use strict";

/**
 * Regression test for the Mirage ambush report — ambush skills never reach the
 * boon summary. Ambushes replace Weapon_1 only while Mirage Cloak is up, so they
 * never appear in the equipped weapon slots, and the GW2 API types them
 * inconsistently (rifle/staff/greatsword/dagger/trident are "Weapon", while
 * axe/scepter/sword/spear are "Profession"), so the bridge's profession-mechanic
 * pass picked up only half of them — and those half regardless of the weapon
 * actually equipped.
 */
const { computeBoons } = require("../../../src/renderer/modules/engine-bridge");

const MIRAGE_SPEC_ID = 59;

// Rifle ambush — grants Vigor to allies. Typed "Weapon" by the API.
const EFFERVESCENCE = {
  id: 71800,
  name: "Effervescence",
  type: "Weapon",
  slot: "Weapon_1",
  specialization: MIRAGE_SPEC_ID,
  weaponType: "Rifle",
  icon: "https://example.invalid/effervescence.png",
  description: "Ambush. Spray invigorating magic, damaging enemies and healing allies.",
  facts: [{ type: "Buff", text: "Vigor", status: "Vigor", duration: 1, apply_count: 4 }],
};

// Staff ambush — grants Might/Fury to allies. Must NOT count when staff is unequipped.
const CHAOS_VORTEX = {
  id: 40184,
  name: "Chaos Vortex",
  type: "Weapon",
  slot: "Weapon_1",
  specialization: MIRAGE_SPEC_ID,
  weaponType: "Staff",
  icon: "https://example.invalid/chaos-vortex.png",
  description: "Ambush. Release a vortex of chaos energy that inflicts damaging conditions on foes. Allies near you gain boons.",
  facts: [
    { type: "Buff", text: "Might", status: "Might", duration: 15, apply_count: 2 },
    { type: "Buff", text: "Fury", status: "Fury", duration: 1.5, apply_count: 1 },
  ],
};

// Axe ambush — same mechanic, but the API types it "Profession".
const IMAGINARY_AXES = {
  id: 44321,
  name: "Imaginary Axes",
  type: "Profession",
  slot: "Weapon_1",
  specialization: MIRAGE_SPEC_ID,
  weaponType: "Axe",
  icon: "https://example.invalid/imaginary-axes.png",
  description: "Ambush. Release phantasmal axes that seek out the nearest target after a short delay.",
  facts: [{ type: "Buff", text: "Torment", status: "Torment", duration: 4, apply_count: 1 }],
};

const AMBUSHES = [EFFERVESCENCE, CHAOS_VORTEX, IMAGINARY_AXES];

function makeState(mainhand, { specId = MIRAGE_SPEC_ID } = {}) {
  return {
    editor: {
      profession: "Mesmer",
      gameMode: "wvw",
      specializations: [{ specializationId: specId, majorChoices: {} }],
      skills: {},
      equipment: { weapons: { mainhand1: mainhand } },
    },
    activeCatalog: {
      skills: AMBUSHES,
      traitById: new Map(),
      skillById: new Map(AMBUSHES.map((s) => [s.id, s])),
      specializationById: new Map([[MIRAGE_SPEC_ID, { id: MIRAGE_SPEC_ID, minorTraits: [] }]]),
    },
    upgradeCatalog: {},
  };
}

describe("boon coverage — elite-spec ambush skills", () => {
  test("the equipped weapon's ambush contributes its boons", () => {
    const { boons } = computeBoons(makeState("rifle"));
    const vigor = boons.find((b) => b.name === "Vigor");
    expect(vigor).toBeDefined();
    expect(vigor.sources).toHaveLength(1);
    expect(vigor.sources[0]).toMatchObject({ name: "Effervescence", duration: 1 });
  });

  test("ambushes for weapons that aren't equipped are excluded", () => {
    const { boons } = computeBoons(makeState("rifle"));
    expect(boons.find((b) => b.name === "Might")).toBeUndefined();
    expect(boons.find((b) => b.name === "Fury")).toBeUndefined();
  });

  test("\"Profession\"-typed ambushes are weapon-gated too", () => {
    const withAxe = computeBoons(makeState("axe"));
    expect(withAxe.conditions.find((c) => c.name === "Torment")).toBeDefined();
    const withRifle = computeBoons(makeState("rifle"));
    expect(withRifle.conditions.find((c) => c.name === "Torment")).toBeUndefined();
  });

  test("ambushes need the elite spec selected", () => {
    const { boons } = computeBoons(makeState("rifle", { specId: 1 }));
    expect(boons.find((b) => b.name === "Vigor")).toBeUndefined();
  });
});

describe("boon coverage — ambush already on the bar", () => {
  test("an ambush occupying Weapon_1 is not counted twice", () => {
    const state = makeState("rifle");
    // Untamed's unleash toggle puts the ambush into the weapon slots; the
    // dedicated pass must not add it a second time.
    const { boons } = computeBoons(state, [EFFERVESCENCE]);
    const vigor = boons.find((b) => b.name === "Vigor");
    expect(vigor.sources).toHaveLength(1);
  });
});
