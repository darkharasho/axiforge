"use strict";

const {
  buildMatchTables,
  splitGroupKey,
  valueChanged,
  VALUE_KEYS,
} = require("../src/facts/match");

describe("splitGroupKey", () => {
  test("uses normalized type and target for AttributeAdjust", () => {
    expect(splitGroupKey({ type: "AttributeAdjust", target: "Power" })).toBe(
      "AttributeAdjust:Power"
    );
  });

  test("uses normalized type and status for Buff", () => {
    expect(splitGroupKey({ type: "Buff", status: "Might" })).toBe("Buff:Might");
  });

  test("normalizes Distance to Radius", () => {
    expect(splitGroupKey({ type: "Distance", distance: 240 })).toBe("Radius:");
  });

  test("uses empty string when no target/status", () => {
    expect(splitGroupKey({ type: "Damage" })).toBe("Damage:");
  });
});

describe("valueChanged", () => {
  test("returns false when values are identical", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    const b = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    expect(valueChanged(a, b)).toBe(false);
  });

  test("returns true when dmg_multiplier differs", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0 };
    const b = { type: "Damage", dmg_multiplier: 0.5 };
    expect(valueChanged(a, b)).toBe(true);
  });

  test("returns true when duration differs", () => {
    const a = { type: "Buff", status: "Might", duration: 5 };
    const b = { type: "Buff", status: "Might", duration: 3 };
    expect(valueChanged(a, b)).toBe(true);
  });

  test("ignores hit_count if base does not have it", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0 };
    const b = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    expect(valueChanged(a, b)).toBe(false);
  });
});

describe("buildMatchTables", () => {
  test("pass 1: matches by exact text and type", () => {
    const base = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const split = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
      { type: "Buff", text: "Might", status: "Might", duration: 3 },
    ];
    const { baseToSplit, splitToBase } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
    expect(baseToSplit.get(1)).toBe(1);
    expect(splitToBase.get(0)).toBe(0);
    expect(splitToBase.get(1)).toBe(1);
  });

  test("pass 1.5: matches by exact text across different types", () => {
    const base = [{ type: "Number", text: "Maximum Count", value: 3 }];
    const split = [{ type: "Buff", text: "Maximum Count", value: 2 }];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
  });

  test("pass 2: positional match within same type group", () => {
    const base = [
      { type: "AttributeAdjust", text: "Healing", target: "Healing", value: 500 },
      { type: "AttributeAdjust", text: "Barrier", target: "Healing", value: 300 },
    ];
    const split = [
      { type: "AttributeAdjust", text: "Healing", target: "Healing", value: 400 },
      { type: "AttributeAdjust", text: "Barrier Strength", target: "Healing", value: 200 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
    expect(baseToSplit.get(1)).toBe(1);
  });

  test("pass 3: keyword overlap match", () => {
    const base = [
      { type: "Buff", text: "Conditions Removed", status: "Conditions Removed", value: 3 },
    ];
    const split = [
      { type: "Number", text: "Conditions Successfully Removed", value: 2 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
  });

  test("returns empty maps when no matches", () => {
    const base = [{ type: "Damage", text: "Damage", dmg_multiplier: 1.0 }];
    const split = [{ type: "Buff", text: "Fury", status: "Fury", duration: 5 }];
    const { baseToSplit, splitToBase } = buildMatchTables(base, split);
    expect(baseToSplit.size).toBe(0);
    expect(splitToBase.size).toBe(0);
  });

  test("prevents double-matching", () => {
    const base = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8 },
    ];
    const split = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.size).toBe(1);
    expect(baseToSplit.get(0)).toBe(0);
  });
});
