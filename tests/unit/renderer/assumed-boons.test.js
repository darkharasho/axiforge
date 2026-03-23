"use strict";

const { computeEquipmentStats, computeStatBreakdown } = require("../../../src/renderer/modules/stats");
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
