"use strict";

const {
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,
  splitRespectingTemplates,
} = require("../src/wiki/parser");

describe("splitRespectingTemplates", () => {
  test("splits simple pipe-delimited string", () => {
    expect(splitRespectingTemplates("damage|0.8")).toEqual(["damage", "0.8"]);
  });

  test("preserves nested templates", () => {
    expect(splitRespectingTemplates("healing|{{fraction|7.5}}")).toEqual([
      "healing",
      "{{fraction|7.5}}",
    ]);
  });

  test("handles multiple nested templates", () => {
    const result = splitRespectingTemplates("damage|{{fraction|0.5}}|hits={{fraction|3}}");
    expect(result).toEqual(["damage", "{{fraction|0.5}}", "hits={{fraction|3}}"]);
  });
});

describe("parseSplitGrouping", () => {
  test("pve, wvw, pvp → WvW has its own split", () => {
    const result = parseSplitGrouping("pve, wvw, pvp");
    expect(result).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: false });
  });

  test("pve, wvw pvp → WvW grouped with PvP", () => {
    const result = parseSplitGrouping("pve, wvw pvp");
    expect(result).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: true });
  });

  test("pve wvw, pvp → WvW grouped with PvE (no actual WvW split)", () => {
    const result = parseSplitGrouping("pve wvw, pvp");
    expect(result).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
  });
});

describe("mapWikiFactToApiFact", () => {
  test("damage with coefficient", () => {
    const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.8" }, true, false);
    expect(fact).toEqual({
      type: "Damage",
      text: "Damage",
      dmg_multiplier: 0.8,
      hit_count: 1,
    });
  });

  test("damage with coefficient and hits", () => {
    const fact = mapWikiFactToApiFact(
      "damage",
      [],
      { coefficient: "0.5", hits: "3" },
      true,
      false
    );
    expect(fact).toEqual({
      type: "Damage",
      text: "Damage",
      dmg_multiplier: 0.5,
      hit_count: 3,
    });
  });

  test("recharge with positional value", () => {
    const fact = mapWikiFactToApiFact("recharge", ["25"], {}, true, false);
    expect(fact).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
  });

  test("buff with status, duration, and stacks", () => {
    const fact = mapWikiFactToApiFact(
      "might",
      ["5"],
      { stacks: "3" },
      true,
      false
    );
    expect(fact).toEqual({
      type: "Buff",
      text: "Might",
      status: "Might",
      duration: 5,
      apply_count: 3,
    });
  });

  test("buff defaults to 1 stack", () => {
    const fact = mapWikiFactToApiFact("fury", ["8"], {}, true, false);
    expect(fact).toEqual({
      type: "Buff",
      text: "Fury",
      status: "Fury",
      duration: 8,
      apply_count: 1,
    });
  });

  test("range with valid value", () => {
    const fact = mapWikiFactToApiFact("range", ["900"], {}, true, false);
    expect(fact).toEqual({ type: "Range", text: "Range", value: 900 });
  });

  test("range rejects value <= 1 (boolean flag artifact)", () => {
    const fact = mapWikiFactToApiFact("range", ["1"], {}, true, false);
    expect(fact).toBeNull();
  });

  test("targets with value", () => {
    const fact = mapWikiFactToApiFact("targets", ["5"], {}, true, false);
    expect(fact).toEqual({ type: "Number", text: "Number of Targets", value: 5 });
  });

  test("radius with distance value", () => {
    const fact = mapWikiFactToApiFact("radius", ["240"], {}, true, false);
    expect(fact).toEqual({ type: "Radius", text: "Radius", distance: 240 });
  });

  test("duration with seconds value", () => {
    const fact = mapWikiFactToApiFact("duration", ["5"], {}, true, false);
    expect(fact).toEqual({ type: "Time", text: "Duration", duration: 5 });
  });

  test("healing with base and coefficient", () => {
    const fact = mapWikiFactToApiFact(
      "healing",
      [],
      { base: "352", coefficient: "0.5" },
      true,
      false
    );
    expect(fact).toMatchObject({
      type: "AttributeAdjust",
      target: "Healing",
      value: 352,
      coefficient: 0.5,
    });
  });

  test("conditions removed", () => {
    const fact = mapWikiFactToApiFact("conditions removed", ["2"], {}, true, false);
    expect(fact).toEqual({
      type: "Number",
      text: "Conditions Removed",
      value: 2,
    });
  });

  test("combo finisher", () => {
    const fact = mapWikiFactToApiFact("combo", ["blast"], {}, true, false);
    expect(fact).toEqual({
      type: "ComboFinisher",
      text: "Combo Finisher",
      finisher_type: "Blast",
    });
  });

  test("stun break", () => {
    const fact = mapWikiFactToApiFact("stun break", [], {}, true, false);
    expect(fact).toEqual({ type: "StunBreak", text: "Stun Break", value: true });
  });

  test("percent with value", () => {
    const fact = mapWikiFactToApiFact("percent", ["20"], {}, true, false);
    expect(fact).toEqual({ type: "Percent", text: "Percent", percent: 20 });
  });

  test("attribute gain/conversion", () => {
    const fact = mapWikiFactToApiFact(
      "gain",
      [],
      { source: "Vitality", target: "Power", percent: "13" },
      true,
      false
    );
    expect(fact).toMatchObject({
      type: "BuffConversion",
      source: "Vitality",
      target: "Power",
      percent: 13,
    });
  });

  test("effect produces Buff with status from positional[0] and duration from positional[1]", () => {
    const fact = mapWikiFactToApiFact("effect", ["Superspeed", "5"], { stacks: "2" }, true, false);
    expect(fact).toEqual({
      type: "Buff",
      text: "Superspeed",
      status: "Superspeed",
      duration: 5,
      apply_count: 2,
    });
  });

  test("effect with no positionals returns empty status and zero duration", () => {
    const fact = mapWikiFactToApiFact("effect", [], {}, false, true);
    expect(fact).toEqual({
      type: "Buff",
      text: "",
      status: "",
      duration: 0,
      apply_count: 1,
    });
  });

  test("returns null for unknown fact type", () => {
    const fact = mapWikiFactToApiFact("text", [], {}, true, false);
    expect(fact).toBeNull();
  });

  test("returns null for combat-only/misc fact types", () => {
    expect(mapWikiFactToApiFact("combat", [], {}, true, false)).toBeNull();
    expect(mapWikiFactToApiFact("misc", [], {}, true, false)).toBeNull();
    expect(mapWikiFactToApiFact("pierces", [], {}, true, false)).toBeNull();
  });
});

describe("parseInfoboxParams", () => {
  test("extracts recharge wvw param", () => {
    const wikitext = "| recharge wvw = 25\n| recharge = 20";
    const result = parseInfoboxParams(wikitext, false);
    expect(result).toEqual([{ type: "Recharge", text: "Recharge", value: 25 }]);
  });

  test("extracts pvp params when WvW grouped with PvP", () => {
    const wikitext = "| recharge pvp = 30\n| recharge = 20";
    const result = parseInfoboxParams(wikitext, true);
    expect(result).toEqual([{ type: "Recharge", text: "Recharge", value: 30 }]);
  });

  test("returns empty array when no WvW params", () => {
    const wikitext = "| recharge = 20\n| activation = 0.5";
    const result = parseInfoboxParams(wikitext, false);
    expect(result).toEqual([]);
  });
});

describe("parseWikitextFacts", () => {
  test("extracts WvW-specific skill facts", () => {
    const wikitext = [
      "{{skill fact|damage|0.8|game mode=wvw}}",
      "{{skill fact|damage|1.2|game mode=pve}}",
    ].join("\n");
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.8);
  });

  test("extracts universal facts (no game mode)", () => {
    const wikitext = "{{skill fact|recharge|25}}";
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].value).toBe(25);
  });

  test("extracts PvP facts when WvW grouped with PvP", () => {
    const wikitext = "{{skill fact|damage|0.6|game mode=pvp}}";
    const result = parseWikitextFacts(wikitext, true);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.6);
  });

  test("detects PvE-only facts", () => {
    const wikitext = [
      "{{skill fact|damage|1.5|game mode=pve}}",
      "{{skill fact|recharge|20}}",
    ].join("\n");
    const result = parseWikitextFacts(wikitext, false);
    expect(result.hasPveOnly).toBe(true);
  });

  test("handles trait fact templates", () => {
    const wikitext = "{{trait fact|damage|0.5|game mode=wvw}}";
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.5);
  });
});
