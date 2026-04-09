const { parseFactText } = require("../wiki-audit/parse-facts");

describe("parseFactText", () => {
  test("parses damage with coefficient", () => {
    expect(parseFactText("Damage", "269 (0.666)")).toEqual({
      type: "Damage", text: "Damage", dmg_multiplier: 0.666, hit_count: 1,
    });
  });

  test("parses damage with hit count", () => {
    expect(parseFactText("Damage", "269 (3×0.5)")).toEqual({
      type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 3,
    });
  });

  test("parses healing with coefficient", () => {
    expect(parseFactText("Healing", "1930 (0.5)")).toEqual({
      type: "AttributeAdjust", text: "Healing", target: "Healing",
      value: 1930, coefficient: 0.5, hit_count: 1,
    });
  });

  test("parses buff with duration", () => {
    expect(parseFactText("Fury", "4 s")).toEqual({
      type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1,
    });
  });

  test("parses buff with stacks and duration", () => {
    expect(parseFactText("Might", "3 stacks; 10 s")).toEqual({
      type: "Buff", text: "Might", status: "Might", duration: 10, apply_count: 3,
    });
  });

  test("parses condition with duration", () => {
    expect(parseFactText("Burning", "1 s")).toEqual({
      type: "Buff", text: "Burning", status: "Burning", duration: 1, apply_count: 1,
    });
  });

  test("parses number of targets", () => {
    expect(parseFactText("Number of Targets", "3")).toEqual({
      type: "Number", text: "Number of Targets", value: 3,
    });
  });

  test("parses radius", () => {
    expect(parseFactText("Radius", "180")).toEqual({
      type: "Radius", text: "Radius", distance: 180,
    });
  });

  test("parses range", () => {
    expect(parseFactText("Range", "1200")).toEqual({
      type: "Range", text: "Range", value: 1200,
    });
  });

  test("rejects range with value <= 1 (boolean flag artifact)", () => {
    expect(parseFactText("Range", "1")).toBeNull();
    expect(parseFactText("Range", "0")).toBeNull();
  });

  test("parses recharge", () => {
    expect(parseFactText("Recharge", "10")).toEqual({
      type: "Recharge", text: "Recharge", value: 10,
    });
  });

  test("parses activation time", () => {
    expect(parseFactText("Activation", "0.25")).toEqual({
      type: "Time", text: "Activation", duration: 0.25,
    });
  });

  test("parses activation time (alt label)", () => {
    expect(parseFactText("Activation time", "0.75")).toEqual({
      type: "Time", text: "Activation", duration: 0.75,
    });
  });

  test("parses conditions removed", () => {
    expect(parseFactText("Conditions Removed", "3")).toEqual({
      type: "Number", text: "Conditions Removed", value: 3,
    });
  });

  test("parses percent value", () => {
    expect(parseFactText("Damage Reduction", "33%")).toEqual({
      type: "Percent", text: "Damage Reduction", percent: 33,
    });
  });

  // ── Custom buff effect descriptions (Paragon chants, etc.) ──

  test("parses custom buff with positive percentage description", () => {
    expect(parseFactText("Chant of Action", "+10% Damage, +10% Condition Damage")).toEqual({
      type: "Buff", text: "+10% Damage, +10% Condition Damage",
      status: "Chant of Action", apply_count: 1,
    });
  });

  test("parses custom buff with negative percentage description", () => {
    expect(parseFactText("Chant of Recuperation", "-7% Incoming Damage, -7% Incoming Condition Damage")).toEqual({
      type: "Buff", text: "-7% Incoming Damage, -7% Incoming Condition Damage",
      status: "Chant of Recuperation", apply_count: 1,
    });
  });

  test("parses custom buff with movement speed description", () => {
    expect(parseFactText("Chant of Freedom", "+50% Movement Speed")).toEqual({
      type: "Buff", text: "+50% Movement Speed",
      status: "Chant of Freedom", apply_count: 1,
    });
  });

  test("does not treat bare percent as custom buff", () => {
    // "33%" has no descriptive text after — should remain a Percent fact
    expect(parseFactText("Damage Reduction", "33%")).toEqual({
      type: "Percent", text: "Damage Reduction", percent: 33,
    });
  });

  // ── Display text aliases for conditions ──

  test("normalizes Cripple display text to Crippled", () => {
    expect(parseFactText("Cripple", "(7s): -50% Movement Speed")).toEqual({
      type: "Buff", text: "Crippled", status: "Crippled", duration: 7, apply_count: 1,
    });
  });

  test("normalizes Immobilize display text to Immobile", () => {
    expect(parseFactText("Immobilize", "(2s): Unable to move.")).toEqual({
      type: "Buff", text: "Immobile", status: "Immobile", duration: 2, apply_count: 1,
    });
  });

  test("normalizes Blind display text to Blinded", () => {
    expect(parseFactText("Blind", "(3s): Next outgoing attack misses.")).toEqual({
      type: "Buff", text: "Blinded", status: "Blinded", duration: 3, apply_count: 1,
    });
  });

  test("falls back to title attribute for unrecognized display text", () => {
    expect(parseFactText("SomeWeirdText", "(5s)", "Crippled")).toEqual({
      type: "Buff", text: "Crippled", status: "Crippled", duration: 5, apply_count: 1,
    });
  });

  // ── Combo facts ──

  test("parses combo finisher", () => {
    expect(parseFactText("Combo Finisher", "Blast")).toEqual({
      type: "ComboFinisher", text: "Combo Finisher", finisher_type: "Blast", percent: 100,
    });
  });

  test("parses combo field", () => {
    expect(parseFactText("Combo Field", "Fire")).toEqual({
      type: "ComboField", text: "Combo Field", field_type: "Fire",
    });
  });
});
