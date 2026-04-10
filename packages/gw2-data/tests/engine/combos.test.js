"use strict";

const { analyzeCombos } = require("../../src/engine/combos");

describe("analyzeCombos", () => {
  test("extracts combo field from skill facts", () => {
    const skills = [{
      name: "Flame Wall", icon: "", description: "", facts: [
        { type: "ComboField", field_type: "Fire" },
        { type: "Time", duration: 5 },
        { type: "Radius", distance: 240 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      fieldType: "Fire", sourceName: "Flame Wall", duration: 5, radius: 240,
    });
  });

  test("extracts combo finisher from skill facts", () => {
    const skills = [{
      name: "Mighty Blow", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Blast", percent: 100 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers).toHaveLength(1);
    expect(result.finishers[0]).toMatchObject({
      finisherType: "Blast", sourceName: "Mighty Blow", hitCount: 1, percent: 100,
    });
  });

  test("groups multiple finishers of same type on one skill", () => {
    const skills = [{
      name: "Whirling Strike", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Whirl" },
        { type: "ComboFinisher", finisher_type: "Whirl" },
        { type: "ComboFinisher", finisher_type: "Whirl" },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers).toHaveLength(1);
    expect(result.finishers[0].hitCount).toBe(3);
  });

  test("deduplicates fields by (type, sourceName)", () => {
    const skills = [
      { name: "Flame Wall", icon: "", description: "", facts: [{ type: "ComboField", field_type: "Fire" }] },
      { name: "Flame Wall", icon: "", description: "", facts: [{ type: "ComboField", field_type: "Fire" }] },
    ];
    const result = analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
  });

  test("extracts fields from traits too", () => {
    const traits = [{
      name: "Healing Trait", icon: "", description: "", facts: [
        { type: "ComboField", field_type: "Water" },
      ],
    }];
    const result = analyzeCombos([], traits);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldType).toBe("Water");
  });

  test("tracks finisher percent below 100", () => {
    const skills = [{
      name: "Leap", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Leap", percent: 50 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers[0].percent).toBe(50);
  });
});
