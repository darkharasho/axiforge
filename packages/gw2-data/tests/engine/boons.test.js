"use strict";

const { analyzeBoons, isAllyTargeted, normalizeName } = require("../../src/engine/boons");

describe("normalizeName", () => {
  test("normalizes Blind to Blinded", () => {
    expect(normalizeName("Blind")).toBe("Blinded");
  });

  test("normalizes Cripple to Crippled", () => {
    expect(normalizeName("Cripple")).toBe("Crippled");
  });

  test("returns unknown names unchanged", () => {
    expect(normalizeName("Might")).toBe("Might");
  });
});

describe("isAllyTargeted", () => {
  test("returns true when boon name appears in ally sentence", () => {
    expect(isAllyTargeted("Grant Might to nearby allies.", "Might", [])).toBe(true);
  });

  test("returns false when boon is in description but not with ally word", () => {
    expect(isAllyTargeted("Gain Might. Attack enemies.", "Might", [])).toBe(false);
  });

  test("returns false with no description", () => {
    expect(isAllyTargeted(null, "Might", [])).toBe(false);
  });

  test("returns true for generic ally mention when boon not named", () => {
    expect(isAllyTargeted("Grant boons to allies.", "Fury", [])).toBe(true);
  });

  test("returns false for unnamed boon when specific boons named with allies", () => {
    expect(isAllyTargeted("Grant might to allies.", "Fury", ["Might"])).toBe(false);
  });
});

describe("analyzeBoons", () => {
  test("extracts boon from skill with Buff fact", () => {
    const skills = [{
      name: "For Great Justice!",
      description: "Grant Might and Fury to yourself and allies.",
      icon: "",
      facts: [
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
        { type: "Buff", status: "Fury", apply_count: 1, duration: 8 },
      ],
    }];
    const result = analyzeBoons(skills, [], new Map());
    expect(result.boons.length).toBe(2);
    expect(result.boons.find((b) => b.name === "Might")).toBeDefined();
    expect(result.boons.find((b) => b.name === "Fury")).toBeDefined();
  });

  test("extracts condition from skill", () => {
    const skills = [{
      name: "Sword of Justice",
      description: "Create a Sword of Justice.",
      icon: "",
      facts: [{ type: "Buff", status: "Burning", apply_count: 2, duration: 3 }],
    }];
    const result = analyzeBoons(skills, [], new Map());
    expect(result.conditions.length).toBe(1);
    expect(result.conditions[0].name).toBe("Burning");
  });

  test("deduplicates by source + stacks + duration + context", () => {
    const skill = {
      name: "Skill A", description: "", icon: "",
      facts: [
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
      ],
    };
    const result = analyzeBoons([skill], [], new Map());
    const might = result.boons.find((b) => b.name === "Might");
    expect(might.sources).toHaveLength(1);
  });

  test("handles NoData section context for conditional facts", () => {
    const skill = {
      name: "Skill B", description: "", icon: "",
      facts: [
        { type: "NoData", text: "On Critical Hit" },
        { type: "Buff", status: "Fury", apply_count: 1, duration: 4 },
      ],
    };
    const result = analyzeBoons([skill], [], new Map());
    const fury = result.boons.find((b) => b.name === "Fury");
    expect(fury.sources[0].context).toBe("On Critical Hit");
  });

  test("applies Twisted Medicine ally override for Elixir skills", () => {
    const overrides = new Map([
      ["trait:2220", { allyTargeted: ["elixir"] }],
    ]);
    const skills = [{
      name: "Elixir B", description: "Drink Elixir B.", icon: "",
      categories: ["Elixir"],
      facts: [{ type: "Buff", status: "Fury", apply_count: 1, duration: 5 }],
    }];
    const traits = [{ id: 2220, name: "Twisted Medicine", facts: [] }];
    const result = analyzeBoons(skills, traits, overrides, new Set([2220]));
    const fury = result.boons.find((b) => b.name === "Fury");
    expect(fury.sources[0].isAlly).toBe(true);
  });

  test("includes traited_facts boons when required trait is active", () => {
    const skills = [{
      name: "Well of Gloom",
      description: "Well. Shadowstep to your target location and drop a well that cripples foes and heals allies.",
      icon: "",
      facts: [
        { type: "Buff", status: "Crippled", apply_count: 1, duration: 2 },
      ],
      traitedFacts: [
        { type: "Buff", status: "Resistance", apply_count: 1, duration: 3, requires_trait: 2285 },
      ],
    }];
    // Trait 2285 is active
    const result = analyzeBoons(skills, [], new Map(), new Set([2285]));
    const resistance = result.boons.find((b) => b.name === "Resistance");
    expect(resistance).toBeDefined();
    expect(resistance.sources).toHaveLength(1);
    expect(resistance.sources[0].name).toBe("Well of Gloom");
  });

  test("excludes traited_facts boons when required trait is NOT active", () => {
    const skills = [{
      name: "Well of Gloom",
      description: "Well. Shadowstep to your target location and drop a well that cripples foes and heals allies.",
      icon: "",
      facts: [
        { type: "Buff", status: "Crippled", apply_count: 1, duration: 2 },
      ],
      traitedFacts: [
        { type: "Buff", status: "Resistance", apply_count: 1, duration: 3, requires_trait: 2285 },
      ],
    }];
    // Trait 2285 is NOT active
    const result = analyzeBoons(skills, [], new Map(), new Set([1234]));
    const resistance = result.boons.find((b) => b.name === "Resistance");
    expect(resistance).toBeUndefined();
  });

  test("traited_facts with overrides index replaces base fact", () => {
    const skills = [{
      name: "Test Skill",
      description: "Grant Might to allies.",
      icon: "",
      facts: [
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
      ],
      traitedFacts: [
        { type: "Buff", status: "Might", apply_count: 5, duration: 10, requires_trait: 100, overrides: 0 },
      ],
    }];
    const result = analyzeBoons(skills, [], new Map(), new Set([100]));
    const might = result.boons.find((b) => b.name === "Might");
    expect(might).toBeDefined();
    expect(might.sources).toHaveLength(1);
    expect(might.sources[0].stacks).toBe(5);
    expect(might.sources[0].duration).toBe(10);
  });

  test("sorts boons by display order, conditions alphabetically", () => {
    const skills = [{
      name: "Multi", description: "", icon: "",
      facts: [
        { type: "Buff", status: "Vigor", apply_count: 1, duration: 5 },
        { type: "Buff", status: "Aegis", apply_count: 1, duration: 3 },
        { type: "Buff", status: "Weakness", apply_count: 1, duration: 3 },
        { type: "Buff", status: "Burning", apply_count: 1, duration: 3 },
      ],
    }];
    const result = analyzeBoons(skills, [], new Map());
    // Aegis comes before Vigor in GW2 display order
    const boonNames = result.boons.map((b) => b.name);
    expect(boonNames.indexOf("Aegis")).toBeLessThan(boonNames.indexOf("Vigor"));
    // Conditions sorted alphabetically
    const condNames = result.conditions.map((c) => c.name);
    expect(condNames).toEqual([...condNames].sort());
  });
});
