"use strict";

const { computeEquipmentStats, computeStatBreakdown, computeTraitConversions, computeFuryCritModifier } = require("../../../src/renderer/modules/stats");
const { state } = require("../../../src/renderer/modules/state");

function makeEditor(slots = {}, food = "", utility = "") {
  return {
    profession: "Warrior",
    equipment: { slots, food, utility, weapons: {} },
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
  };
}

beforeEach(() => {
  state.editor = makeEditor();
  state.upgradeCatalog = null;
});

describe("computeEquipmentStats — assumed boons", () => {
  test("null assumedBoons matches baseline (no change)", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats(null);
    expect(result.Power).toBe(baseline.Power);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });

  test("zero Might matches baseline (no change)", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 0, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });

  test("25 Might adds +750 Power and +750 ConditionDamage", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 25, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 750);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 750);
  });

  test("10 Might adds +300 Power and +300 ConditionDamage", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 10, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 300);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 300);
  });

  test("Might stacks on top of equipment stats", () => {
    state.editor = makeEditor({ chest: "Berserker's" });
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 25, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 750);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 750);
  });

  test("Fury and Alacrity do not affect flat stats", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 0, fury: true, alacrity: true });
    expect(result.Power).toBe(baseline.Power);
    expect(result.Precision).toBe(baseline.Precision);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });
});

describe("computeStatBreakdown — assumed boons", () => {
  test("Might appears as source in Power breakdown", () => {
    const entries = computeStatBreakdown("Power", { might: 10, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeDefined();
    expect(boonEntry.source).toBe("Boon (Might ×10)");
    expect(boonEntry.value).toBe(300);
  });

  test("Might appears as source in ConditionDamage breakdown", () => {
    const entries = computeStatBreakdown("ConditionDamage", { might: 5, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeDefined();
    expect(boonEntry.value).toBe(150);
  });

  test("no boon entry when Might is 0", () => {
    const entries = computeStatBreakdown("Power", { might: 0, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });

  test("no boon entry when assumedBoons is null", () => {
    const entries = computeStatBreakdown("Power", null);
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });

  test("Might does not appear in Precision breakdown", () => {
    const entries = computeStatBreakdown("Precision", { might: 25, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });
});

describe("computeEquipmentStats — extended boons", () => {
  test("toggling non-stat boons does not change any attribute", () => {
    const baseline = computeEquipmentStats();
    const extended = computeEquipmentStats({
      might: 0, fury: false, alacrity: false,
      quickness: false, protection: false, regeneration: false,
      resolution: false, resistance: false, stability: 0,
      swiftness: false, vigor: false, aegis: false,
    });
    for (const key of Object.keys(baseline)) {
      expect(extended[key]).toBe(baseline[key]);
    }
  });
});

describe("computeEquipmentStats — trait conversions integrated", () => {
  test("trait conversion adds to stat totals", () => {
    state.editor = makeEditor({ chest: "Berserker's" }); // Adds Power
    const fakeTrait = {
      id: 9999,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[9999, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 9999 } },
    ];
    const withTrait = computeEquipmentStats();
    // Remove trait to get baseline
    state.editor.specializations = [];
    const baseline = computeEquipmentStats();
    // Vitality should be higher with the trait
    expect(withTrait.Vitality).toBeGreaterThan(baseline.Vitality);
    // Power should be the same (source is not increased by conversion)
    expect(withTrait.Power).toBe(baseline.Power);
  });
});

describe("computeEquipmentStats — stacking sigils", () => {
  test("stacking sigil at max stacks adds to stat total", () => {
    state.editor = makeEditor();
    state.editor.equipment.weapons = { mainhand1: 1234 };
    state.editor.equipment.sigils = { mainhand1: ["24575", ""] }; // Bloodlust
    state.upgradeCatalog = null;
    state.activeCatalog = { traitById: new Map() };

    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilBloodlust: 25 });
    expect(withSigil.Power).toBe(baseline.Power + 250); // 25 * 10
  });

  test("stacking sigil at 0 stacks has no effect", () => {
    state.editor = makeEditor();
    state.activeCatalog = { traitById: new Map() };
    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilBloodlust: 0 });
    expect(withSigil.Power).toBe(baseline.Power);
  });

  test("Perception sigil adds to Precision", () => {
    state.editor = makeEditor();
    state.activeCatalog = { traitById: new Map() };
    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilPerception: 15 });
    expect(withSigil.Precision).toBe(baseline.Precision + 150);
  });
});

describe("computeTraitConversions", () => {
  beforeEach(() => {
    state.editor = makeEditor({ chest: "Berserker's" });
    state.upgradeCatalog = null;
  });

  test("returns empty object when no specializations selected", () => {
    state.editor.specializations = [];
    state.activeCatalog = { traitById: new Map() };
    const result = computeTraitConversions({});
    expect(result).toEqual({});
  });

  test("applies a simple Power → Vitality 10% conversion", () => {
    const fakeTrait = {
      id: 9999,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[9999, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 9999 } },
    ];
    const baseStats = { Power: 1000, Vitality: 500 };
    const result = computeTraitConversions(baseStats);
    expect(result.Vitality).toBe(100);
  });

  test("maps BoonDuration target to Concentration", () => {
    const fakeTrait = {
      id: 8888,
      facts: [{ type: "AttributeConversion", source: "Power", target: "BoonDuration", percent: 13 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[8888, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 2: 8888 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result.Concentration).toBe(130);
  });

  test("maps CritDamage target to Ferocity", () => {
    const fakeTrait = {
      id: 7777,
      facts: [{ type: "AttributeConversion", source: "Precision", target: "CritDamage", percent: 10 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[7777, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 7777 } },
    ];
    const result = computeTraitConversions({ Precision: 2000 });
    expect(result.Ferocity).toBe(200);
  });

  test("maps ConditionDuration target to Expertise", () => {
    const fakeTrait = {
      id: 6666,
      facts: [{ type: "AttributeConversion", source: "Precision", target: "ConditionDuration", percent: 7 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[6666, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 6666 } },
    ];
    const result = computeTraitConversions({ Precision: 1000 });
    expect(result.Expertise).toBe(70);
  });

  test("maps Healing target to HealingPower", () => {
    const fakeTrait = {
      id: 5555,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Healing", percent: 7 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[5555, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 5555 } },
    ];
    const result = computeTraitConversions({ Power: 2000 });
    expect(result.HealingPower).toBe(140);
  });

  test("ignores traits not selected in majorChoices", () => {
    const fakeTrait = {
      id: 4444,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[4444, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 1111 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result).toEqual({});
  });

  test("multiple conversions from same trait stack additively", () => {
    const fakeTrait = {
      id: 3333,
      facts: [
        { type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 },
        { type: "AttributeConversion", source: "Power", target: "CritDamage", percent: 10 },
      ],
      traitedFacts: [],
    };
    state.activeCatalog = { traitById: new Map([[3333, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 3333 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result.Vitality).toBe(100);
    expect(result.Ferocity).toBe(100);
  });
});

describe("computeFuryCritModifier — trait-based fury crit bonus", () => {
  beforeEach(() => {
    state.editor = makeEditor();
    state.upgradeCatalog = null;
  });

  test("returns 0 when no specializations are selected", () => {
    state.editor.specializations = [];
    state.activeCatalog = { traitById: new Map(), specializationById: new Map() };
    expect(computeFuryCritModifier()).toBe(0);
  });

  test("returns 0 when active traits have no fury crit modifier", () => {
    const fakeTrait = {
      id: 9999,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
    };
    state.activeCatalog = {
      traitById: new Map([[9999, fakeTrait]]),
      specializationById: new Map(),
    };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 9999 } },
    ];
    expect(computeFuryCritModifier()).toBe(0);
  });

  test("returns modifier from a minor trait with Fury buff + Percent fact", () => {
    // Simulates Furious Burst: minor trait that grants Fury and adds 5% crit
    const furiousBurst = {
      id: 1342,
      facts: [
        { text: "Recharge", type: "Recharge", value: 4 },
        { text: "Apply Buff/Condition", type: "Buff", status: "Fury", duration: 3, apply_count: 1 },
        { text: "Critical Chance Increase", type: "Percent", percent: 5 },
        { text: "Combat Only", type: "NoData" },
      ],
    };
    state.activeCatalog = {
      traitById: new Map([[1342, furiousBurst]]),
      specializationById: new Map([[36, { id: 36, minorTraits: [1342] }]]),
    };
    state.editor.specializations = [
      { specializationId: 36, majorChoices: {} },
    ];
    expect(computeFuryCritModifier()).toBe(5);
  });

  test("returns modifier from a major trait with Fury buff + Percent fact", () => {
    const fakeTrait = {
      id: 5000,
      facts: [
        { text: "Apply Buff/Condition", type: "Buff", status: "Fury", duration: 5, apply_count: 1 },
        { text: "Critical Chance Increase", type: "Percent", percent: 7 },
      ],
    };
    state.activeCatalog = {
      traitById: new Map([[5000, fakeTrait]]),
      specializationById: new Map(),
    };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 5000 } },
    ];
    expect(computeFuryCritModifier()).toBe(7);
  });

  test("ignores Percent facts on traits without a Fury Buff fact", () => {
    const nonFuryTrait = {
      id: 6000,
      facts: [
        { text: "Apply Buff/Condition", type: "Buff", status: "Might", duration: 5, apply_count: 1 },
        { text: "Critical Chance Increase", type: "Percent", percent: 10 },
      ],
    };
    state.activeCatalog = {
      traitById: new Map([[6000, nonFuryTrait]]),
      specializationById: new Map(),
    };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 6000 } },
    ];
    expect(computeFuryCritModifier()).toBe(0);
  });
});
