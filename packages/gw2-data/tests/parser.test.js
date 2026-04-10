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

  test("returns no split for null/empty input", () => {
    expect(parseSplitGrouping("")).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
    expect(parseSplitGrouping(null)).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
  });

  test("pve, pvp → no WvW at all means no split", () => {
    const result = parseSplitGrouping("pve, pvp");
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

  test("recharge reduced preserves text", () => {
    const fact = mapWikiFactToApiFact("recharge reduced", ["15"], {}, true, false);
    expect(fact).toEqual({ type: "Percent", text: "Recharge Reduced", percent: 15 });
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

  test("attribute gain/conversion with positional params", () => {
    // {{skill fact|Gain|Ferocity|Precision|12}} → positional[0]=Ferocity (target),
    // positional[1]=Precision (source), positional[2]=12 (percent)
    const fact = mapWikiFactToApiFact(
      "gain",
      ["Ferocity", "Precision", "12"],
      {},
      false,
      false
    );
    expect(fact).toMatchObject({
      type: "BuffConversion",
      source: "Precision",
      target: "Ferocity",
      percent: 12,
    });
  });

  test("attribute gain/conversion normalizes wiki attribute names", () => {
    // {{skill fact|Gain|Condition Damage|Power|15}} — "Condition Damage" → "ConditionDamage"
    const fact = mapWikiFactToApiFact(
      "gain",
      ["Condition Damage", "Power", "15"],
      {},
      false,
      false
    );
    expect(fact).toMatchObject({
      type: "BuffConversion",
      source: "Power",
      target: "ConditionDamage",
      percent: 15,
    });
  });

  test("flat attribute bonus produces AttributeAdjust", () => {
    const fact = mapWikiFactToApiFact(
      "attribute",
      ["Concentration", "120"],
      {},
      true,
      false
    );
    expect(fact).toEqual({
      type: "AttributeAdjust",
      text: "Concentration",
      target: "Concentration",
      value: 120,
    });
  });

  test("flat attribute bonus normalizes multi-word attribute names", () => {
    // {{skill fact|attribute|Condition Damage|300}} — "Condition Damage" → "ConditionDamage"
    const fact = mapWikiFactToApiFact(
      "attribute",
      ["Condition Damage", "300"],
      {},
      true,
      false
    );
    expect(fact).toMatchObject({
      type: "AttributeAdjust",
      target: "ConditionDamage",
      value: 300,
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

  test("effect with desc captures description (signet passive)", () => {
    const fact = mapWikiFactToApiFact("effect", ["Signet of Fury (effect)"], { desc: "180 Precision" }, false, true);
    expect(fact).toEqual({
      type: "Buff",
      text: "Signet of Fury (effect)",
      status: "Signet of Fury (effect)",
      duration: 0,
      apply_count: 1,
      description: "180 Precision",
    });
  });

  test("effect with alt and desc (signet active)", () => {
    const fact = mapWikiFactToApiFact("effect", ["Signet of Fury (effect)", "4"], { alt: "Active Bonus", desc: "360 Precision, 360 Ferocity" }, false, true);
    expect(fact).toEqual({
      type: "Buff",
      text: "Active Bonus",
      status: "Signet of Fury (effect)",
      duration: 4,
      apply_count: 1,
      description: "360 Precision, 360 Ferocity",
    });
  });

  test("barrier with base and coefficient", () => {
    const fact = mapWikiFactToApiFact("barrier", [], { base: "200", coefficient: "0.3" }, true, false);
    expect(fact).toMatchObject({
      type: "AttributeAdjust",
      text: "Barrier",
      target: "Barrier",
      value: 200,
      coefficient: 0.3,
    });
  });

  test("defiance break with value", () => {
    const fact = mapWikiFactToApiFact("defiance break", ["300"], {}, true, false);
    expect(fact).toEqual({ type: "Number", text: "Defiance Break", value: 300 });
  });

  test("defiance bar variant", () => {
    const fact = mapWikiFactToApiFact("defiance bar", ["150"], {}, true, false);
    expect(fact).toEqual({ type: "Number", text: "Defiance Break", value: 150 });
  });

  test("combo field", () => {
    const fact = mapWikiFactToApiFact("combo", ["fire"], {}, true, false);
    expect(fact).toEqual({ type: "ComboField", text: "Combo Field", field_type: "Fire" });
  });

  test("unblockable", () => {
    const fact = mapWikiFactToApiFact("unblockable", [], {}, true, false);
    expect(fact).toEqual({ type: "Unblockable", text: "Unblockable", value: true });
  });

  test("condition (burning) with stacks", () => {
    const fact = mapWikiFactToApiFact("burning", ["3"], { stacks: "2" }, true, false);
    expect(fact).toEqual({
      type: "Buff",
      text: "Burning",
      status: "Burning",
      duration: 3,
      apply_count: 2,
    });
  });

  test("unknown fact type with numeric value produces generic Number fact", () => {
    const fact = mapWikiFactToApiFact("attack speed increase", ["15"], {}, true, false);
    expect(fact).toEqual({ type: "Number", text: "Attack Speed Increase", value: 15 });
  });

  test("unknown fact type with no numeric value returns null", () => {
    const fact = mapWikiFactToApiFact("nonexistent_type_xyz", [], {}, true, false);
    expect(fact).toBeNull();
  });

  test("returns null for known skip types", () => {
    expect(mapWikiFactToApiFact("text", [], {}, true, false)).toBeNull();
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

describe("parseAllTaggedFacts", () => {
  const { parseAllTaggedFacts } = require("../src/wiki/parser");

  test("universal facts have all three modes", () => {
    const wikitext = "{{skill fact|damage|0.8}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pve", "wvw", "pvp"]);
    expect(facts[0].type).toBe("Damage");
  });

  test("pve-only fact tagged with ['pve']", () => {
    const wikitext = "{{skill fact|damage|0.8|game mode=pve}}";
    const { facts, hasPveOnly } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pve"]);
    expect(hasPveOnly).toBe(true);
  });

  test("wvw-only fact tagged with ['wvw']", () => {
    const wikitext = "{{skill fact|damage|0.5|game mode=wvw}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["wvw"]);
  });

  test("pvp-only fact tagged with ['pvp']", () => {
    const wikitext = "{{skill fact|damage|0.5|game mode=pvp}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pvp"]);
  });

  test("compound mode 'pvp wvw' tagged with both", () => {
    const wikitext = "{{skill fact|damage|0.5|game mode=pvp wvw}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["wvw", "pvp"]);
  });

  test("mixed universal and mode-specific facts", () => {
    const wikitext = [
      "{{skill fact|damage|1.0}}",
      "{{skill fact|burning|3|game mode=pve}}",
      "{{skill fact|burning|2|game mode=wvw pvp}}",
    ].join("\n");
    const { facts, hasPveOnly } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(3);
    expect(facts[0]._modes).toEqual(["pve", "wvw", "pvp"]); // universal damage
    expect(facts[1]._modes).toEqual(["pve"]);     // pve burning
    expect(facts[2]._modes).toEqual(["wvw", "pvp"]); // wvw+pvp burning
    expect(hasPveOnly).toBe(true);
  });

  test("all three modes specified individually", () => {
    const wikitext = "{{skill fact|recharge|15|game mode=pve wvw pvp}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pve", "wvw", "pvp"]);
  });
});
