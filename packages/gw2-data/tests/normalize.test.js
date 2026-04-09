"use strict";

const {
  normalizeFactType,
  stripGw2Markup,
  stripWikiMarkup,
} = require("../src/facts/normalize");

describe("normalizeFactType", () => {
  test("normalizes Distance to Radius", () => {
    expect(normalizeFactType("Distance")).toBe("Radius");
  });

  test("normalizes PrefixedBuff to Buff", () => {
    expect(normalizeFactType("PrefixedBuff")).toBe("Buff");
  });

  test("normalizes ApplyBuffCondition to Buff", () => {
    expect(normalizeFactType("ApplyBuffCondition")).toBe("Buff");
  });

  test("passes through standard types unchanged", () => {
    expect(normalizeFactType("Damage")).toBe("Damage");
    expect(normalizeFactType("Buff")).toBe("Buff");
    expect(normalizeFactType("Recharge")).toBe("Recharge");
    expect(normalizeFactType("AttributeAdjust")).toBe("AttributeAdjust");
  });
});

describe("stripGw2Markup", () => {
  test("strips color tags", () => {
    expect(stripGw2Markup("<c=@abilitytype>Fireball</c>")).toBe("Fireball");
  });

  test("strips nested color tags", () => {
    expect(stripGw2Markup("Deals <c=@abilitytype>damage</c> to foes")).toBe(
      "Deals damage to foes"
    );
  });

  test("returns plain text unchanged", () => {
    expect(stripGw2Markup("No markup here")).toBe("No markup here");
  });
});

describe("stripWikiMarkup", () => {
  test("strips wiki links with display text", () => {
    expect(stripWikiMarkup("[[Burning|burning]]")).toBe("burning");
  });

  test("strips wiki links without display text", () => {
    expect(stripWikiMarkup("[[Burning]]")).toBe("Burning");
  });

  test("strips wiki links with anchors", () => {
    expect(stripWikiMarkup("[[Might#Effect|Might]]")).toBe("Might");
  });

  test("converts fraction templates to numbers", () => {
    expect(stripWikiMarkup("{{fraction|7.5}}")).toBe("7.5");
  });

  test("strips other templates", () => {
    expect(stripWikiMarkup("{{some template}}")).toBe("");
  });

  test("handles combined markup", () => {
    expect(
      stripWikiMarkup("Inflicts [[Bleeding|bleeding]] for {{fraction|2.5}}s")
    ).toBe("Inflicts bleeding for 2.5s");
  });
});
