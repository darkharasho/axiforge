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

  test("parses recharge", () => {
    expect(parseFactText("Recharge", "10")).toEqual({
      type: "Recharge", text: "Recharge", value: 10,
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
});
