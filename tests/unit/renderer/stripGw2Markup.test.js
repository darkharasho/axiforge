"use strict";

const { stripGw2Markup, simplifyTrait, simplifySkill } = require("../../../src/renderer/modules/utils");

describe("stripGw2Markup", () => {
  test("strips <c=@...>text</c> tags, keeping inner text", () => {
    expect(stripGw2Markup("Gain <c=@reminder>5</c> stacks of <c=@abilitytype>Might</c>."))
      .toBe("Gain 5 stacks of Might.");
  });

  test("converts <br> to newline", () => {
    expect(stripGw2Markup("Line one.<br>Line two."))
      .toBe("Line one.\nLine two.");
  });

  test("handles self-closing <br />", () => {
    expect(stripGw2Markup("Line one.<br />Line two."))
      .toBe("Line one.\nLine two.");
  });

  test("strips unknown HTML-like tags", () => {
    expect(stripGw2Markup("Apply <b>Burning</b> for 3s."))
      .toBe("Apply Burning for 3s.");
  });

  test("returns empty string for null/undefined", () => {
    expect(stripGw2Markup(null)).toBe("");
    expect(stripGw2Markup(undefined)).toBe("");
    expect(stripGw2Markup("")).toBe("");
  });

  test("returns plain text unchanged", () => {
    expect(stripGw2Markup("No markup here.")).toBe("No markup here.");
  });

  test("handles nested or multiple markup tags", () => {
    expect(stripGw2Markup("<c=@reminder>10</c>% chance to gain <c=@abilitytype>Fury</c>"))
      .toBe("10% chance to gain Fury");
  });
});

describe("simplifyTrait strips GW2 markup from description", () => {
  test("strips <c=@...> markup from trait description", () => {
    const trait = {
      id: 123,
      name: "Battle Presence",
      icon: "http://example.com/icon.png",
      description: "Grant nearby allies <c=@abilitytype>Retaliation</c>. <c=@reminder>Duration: 5s</c>",
      tier: 2,
    };
    const result = simplifyTrait(trait);
    expect(result.description).toBe("Grant nearby allies Retaliation. Duration: 5s");
    expect(result.description).not.toMatch(/<c=/);
  });
});

describe("simplifySkill strips GW2 markup from description", () => {
  test("strips <c=@...> markup from skill description", () => {
    const skill = {
      id: 456,
      name: "Fireball",
      icon: "http://example.com/icon.png",
      description: "Hurl a fireball that <c=@abilitytype>burns</c> foes.",
      slot: "Weapon_1",
      type: "Weapon",
      specialization: 0,
    };
    const result = simplifySkill(skill);
    expect(result.description).toBe("Hurl a fireball that burns foes.");
    expect(result.description).not.toMatch(/<c=/);
  });
});
