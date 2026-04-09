"use strict";

const { mergeFacts } = require("../src/facts/merge");

describe("mergeFacts", () => {
  test("replaces base fact values with split values (complete mode)", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 20 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 25 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(2);
    expect(result[0].dmg_multiplier).toBe(0.5);
    expect(result[0]._splitFact).toBe(true);
    expect(result[1].value).toBe(25);
    expect(result[1]._splitFact).toBe(true);
  });

  test("preserves base fact labels when merging split values", () => {
    const baseFacts = [
      { type: "Damage", text: "Base Damage Label", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Wiki Damage Label", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result[0].text).toBe("Base Damage Label");
    expect(result[0].dmg_multiplier).toBe(0.5);
  });

  test("drops unmatched base facts in complete mode", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("Damage");
  });

  test("keeps unmatched base facts in partial mode", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: false });
    expect(result).toHaveLength(2);
    expect(result[0].dmg_multiplier).toBe(0.5);
    expect(result[0]._splitFact).toBe(true);
    expect(result[1].status).toBe("Might");
    expect(result[1]._splitFact).toBeUndefined();
  });

  test("adds unmatched split facts as new facts", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 3 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(2);
    const newFact = result.find((f) => f.status === "Fury");
    expect(newFact._newFact).toBe(true);
  });

  test("marks facts with changed values as split facts", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result[0]._splitFact).toBeUndefined();
  });

  test("returns base facts unchanged when split facts is empty", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];

    const result = mergeFacts(baseFacts, [], { complete: false });
    expect(result).toEqual(baseFacts);
  });

  test("returns base facts unchanged when split facts is null", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];

    const result = mergeFacts(baseFacts, null, { complete: false });
    expect(result).toEqual(baseFacts);
  });

  test("defaults complete to false when options omitted", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];

    // No options arg — should behave like complete: false (keep unmatched base)
    const result = mergeFacts(baseFacts, splitFacts);
    expect(result).toHaveLength(2);
    expect(result[0].dmg_multiplier).toBe(0.5);
    expect(result[1].status).toBe("Might");
  });
});
