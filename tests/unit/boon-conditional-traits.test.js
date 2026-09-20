"use strict";

/**
 * Boon-conditional trait stat bonuses.
 *
 * Some traits only grant their attributes while you have a specific boon
 * (Imbued Haste needs Quickness, Chaotic Persistence needs Regeneration,
 * Righteous Instincts needs Resolution, ...). Before this was modelled, those
 * bonuses counted unconditionally and inflated the baseline stat panel.
 *
 * Fury already had its own gating; these tests cover the general mechanism.
 */

const { computeAttributes } = require("@axiapps/gw2-data/engine");

function makeCtx(overrides = {}) {
  return {
    profession: "Guardian",
    specializations: [],
    equipment: { slots: {}, weapons: {}, runes: {}, infusions: {}, enrichment: null, food: null, utility: null },
    gameMode: "pve",
    underwaterMode: false,
    activeWeaponSet: 1,
    skills: {},
    assumedBoons: null,
    sigilStacks: null,
    ...overrides,
  };
}

function makeCatalogs(traits = []) {
  return {
    traitById: new Map(traits.map((t) => [t.id, t])),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    sigilById: new Map(),
    relicById: new Map(),
  };
}

const IMBUED_HASTE = {
  id: 2148, name: "Imbued Haste", slot: "Major",
  description: "Gain increased attributes while affected by quickness.",
  facts: [
    { type: "AttributeAdjust", value: 250, target: "ConditionDamage" },
    { type: "AttributeAdjust", value: 250, target: "Healing" },
    { type: "AttributeAdjust", value: 250, target: "Vitality" },
  ],
};

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
  description: "Resolution increases your chances to critically strike and grants might each interval.",
  facts: [{ type: "Percent", text: "Critical Chance Increase", percent: 25 }],
};

const FLOW_OF_TIME = {
  id: 1927, name: "Flow of Time", slot: "Minor",
  description: "Gain increased critical-strike chance when you have alacrity.",
  facts: [{ type: "Percent", text: "Critical Chance Increase", percent: 15 }],
};

const POWER_OVERWHELMING = {
  id: 334, name: "Power Overwhelming", slot: "Major",
  description: "While at or above the might threshold, gain increased power.",
  facts: [
    { type: "Number", text: "Stack Threshold", value: 10 },
    { type: "AttributeAdjust", value: 150, target: "Power" },
  ],
};

function withTrait(trait, ctxOverrides = {}) {
  const ctx = makeCtx({
    specializations: [{ specializationId: 1, id: 1, majorChoices: { 1: trait.id } }],
    ...ctxOverrides,
  });
  return computeAttributes(ctx, makeCatalogs([trait]));
}

describe("boon-conditional trait attributes", () => {
  test("Imbued Haste grants nothing without quickness", () => {
    const r = withTrait(IMBUED_HASTE);
    expect(r.traits.ConditionDamage).toBe(0);
    expect(r.traits.HealingPower).toBe(0);
    expect(r.traits.Vitality).toBe(0);
  });

  test("Imbued Haste grants its attributes when quickness is assumed", () => {
    const r = withTrait(IMBUED_HASTE, { assumedBoons: { quickness: true } });
    expect(r.traits.ConditionDamage).toBe(250);
    expect(r.traits.HealingPower).toBe(250);
    expect(r.traits.Vitality).toBe(250);
  });

  test("Chaotic Persistence needs regeneration, not just any boon", () => {
    expect(withTrait(CHAOTIC_PERSISTENCE, { assumedBoons: { quickness: true } }).traits.Concentration).toBe(0);
    const r = withTrait(CHAOTIC_PERSISTENCE, { assumedBoons: { regeneration: true } });
    expect(r.traits.Concentration).toBe(250);
    expect(r.traits.Expertise).toBe(100);
  });

  test("Righteous Instincts crit chance only counts with resolution", () => {
    const off = withTrait(RIGHTEOUS_INSTINCTS);
    const on = withTrait(RIGHTEOUS_INSTINCTS, { assumedBoons: { resolution: true } });
    expect(on.derived.critChance - off.derived.critChance).toBeCloseTo(25, 5);
  });

  test("Flow of Time crit chance only counts with alacrity", () => {
    const off = withTrait(FLOW_OF_TIME, { profession: "Mesmer" });
    const on = withTrait(FLOW_OF_TIME, { profession: "Mesmer", assumedBoons: { alacrity: true } });
    expect(off.derived.critChance).toBeCloseTo(5, 5);
    expect(on.derived.critChance - off.derived.critChance).toBeCloseTo(15, 5);
  });

  test("Power Overwhelming needs the might stack threshold, not a single stack", () => {
    const prof = "Elementalist";
    expect(withTrait(POWER_OVERWHELMING, { profession: prof, assumedBoons: { might: 9 } }).traits.Power).toBe(0);
    expect(withTrait(POWER_OVERWHELMING, { profession: prof, assumedBoons: { might: 10 } }).traits.Power).toBe(150);
  });

  test("Power Overwhelming doubles while attuned to fire", () => {
    const r = withTrait(POWER_OVERWHELMING, {
      profession: "Elementalist",
      assumedBoons: { might: 10 },
      activeAttunement: "Fire",
    });
    expect(r.traits.Power).toBe(300);
  });

  test("traitDetails records the boon a bonus depends on", () => {
    const r = withTrait(IMBUED_HASTE, { assumedBoons: { quickness: true } });
    const entry = r.traitDetails.find((d) => d.traitId === 2148);
    expect(entry.conditionBoon).toBe("quickness");
  });

  test("unconditional trait bonuses still apply with no boons", () => {
    const plain = {
      id: 999901, name: "Plain Bonus", slot: "Major",
      description: "Gain power.",
      facts: [{ type: "AttributeAdjust", value: 120, target: "Power" }],
    };
    expect(withTrait(plain).traits.Power).toBe(120);
  });
});
