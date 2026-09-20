"use strict";

/**
 * computeBoonConditionalTraitBonuses — powers the boon picker's "this boon
 * matters for your build" marker and tooltip lines. Traits whose attributes are
 * gated on a boon (Imbued Haste → Quickness, Chaotic Persistence → Regeneration)
 * must be reported under that boon's key.
 */

const { computeBoonConditionalTraitBonuses } = require("../../../src/renderer/modules/stats");
const { state } = require("../../../src/renderer/modules/state");

const CHAOTIC_PERSISTENCE = {
  id: 1865, name: "Chaotic Persistence", slot: "Major",
  description: "Gain concentration and expertise while affected by regeneration.",
  facts: [
    { type: "AttributeAdjust", value: 250, target: "BoonDuration" },
    { type: "AttributeAdjust", value: 100, target: "ConditionDuration" },
  ],
};

const RIGHTEOUS_INSTINCTS = {
  id: 1683, name: "Righteous Instincts", slot: "Major",
  description: "Resolution increases your chances to critically strike.",
  facts: [{ type: "Percent", text: "Critical Chance Increase", percent: 25 }],
};

const PLAIN_TRAIT = {
  id: 999902, name: "Plain Trait", slot: "Major",
  description: "Gain power.",
  facts: [{ type: "AttributeAdjust", value: 120, target: "Power" }],
};

function setBuild(traits) {
  state.activeCatalog = {
    traitById: new Map(traits.map((t) => [t.id, t])),
    specializationById: new Map([[1, { minorTraits: [] }]]),
  };
  state.editor = {
    profession: "Mesmer",
    equipment: { slots: {}, weapons: {} },
    specializations: [{ specializationId: 1, id: 1, majorChoices: Object.fromEntries(traits.map((t, i) => [i + 1, t.id])) }],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    gameMode: "pve",
  };
}

let savedEditor;
let savedCatalog;

beforeEach(() => {
  savedEditor = state.editor;
  savedCatalog = state.activeCatalog;
});

afterEach(() => {
  state.editor = savedEditor;
  state.activeCatalog = savedCatalog;
});

describe("computeBoonConditionalTraitBonuses", () => {
  test("reports a stat trait under the boon it depends on", () => {
    setBuild([CHAOTIC_PERSISTENCE]);
    const byBoon = computeBoonConditionalTraitBonuses(state);
    expect(byBoon.regeneration).toEqual([
      expect.objectContaining({ traitId: 1865, name: "Chaotic Persistence", target: "Concentration", value: 250 }),
      expect.objectContaining({ traitId: 1865, target: "Expertise", value: 100 }),
    ]);
  });

  test("reports crit-chance traits under their boon", () => {
    setBuild([RIGHTEOUS_INSTINCTS]);
    const byBoon = computeBoonConditionalTraitBonuses(state);
    expect(byBoon.resolution).toEqual([
      expect.objectContaining({ traitId: 1683, critChance: 25 }),
    ]);
  });

  test("returns nothing for a build with no boon-gated traits", () => {
    setBuild([PLAIN_TRAIT]);
    expect(computeBoonConditionalTraitBonuses(state)).toEqual({});
  });
});
