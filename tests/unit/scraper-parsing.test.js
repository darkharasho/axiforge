const { parseSplitGrouping, parseWikitextFacts, mapWikiFactToApiFact, parseInfoboxParams, validateSplitEntry } = require("../../lib/gw2-balance-splits/scripts/seed");

describe("seed.js parsing functions", () => {
  describe("mapWikiFactToApiFact", () => {
    test("extracts damage coefficient", () => {
      const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.8" }, true, false);
      expect(fact).toEqual({
        type: "Damage",
        text: "Damage",
        dmg_multiplier: 0.8,
        hit_count: 1,
      });
    });

    test("extracts damage with hit count", () => {
      const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.5", "hit count": "3" }, true, false);
      expect(fact.hit_count).toBe(3);
      expect(fact.dmg_multiplier).toBe(0.5);
    });

    test("extracts duration", () => {
      const fact = mapWikiFactToApiFact("duration", ["duration", "10"], {}, true, false);
      expect(fact).toEqual({ type: "Time", text: "Duration", duration: 10 });
    });

    test("extracts recharge", () => {
      const fact = mapWikiFactToApiFact("recharge", ["recharge", "25"], {}, true, false);
      expect(fact).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
    });

    test("extracts healing with base value", () => {
      const fact = mapWikiFactToApiFact("healing", ["healing", "300"], {}, true, false);
      expect(fact).toEqual({ type: "AttributeAdjust", text: "Healing", value: 300, target: "Healing", hit_count: 1 });
    });

    test("extracts targets", () => {
      const fact = mapWikiFactToApiFact("targets", ["targets", "5"], {}, true, false);
      expect(fact).toEqual({ type: "Number", text: "Number of Targets", value: 5 });
    });

    test("extracts buff/condition with duration and stacks", () => {
      const fact = mapWikiFactToApiFact("bleeding", ["bleeding", "3"], { stacks: "2" }, true, false);
      expect(fact).toEqual({
        type: "Buff",
        text: "Bleeding",
        status: "Bleeding",
        duration: 3,
        apply_count: 2,
      });
    });

    test("unknown type with no duration or stacks returns null", () => {
      const fact = mapWikiFactToApiFact("unknown", ["unknown"], {}, true, false);
      expect(fact).toBeNull();
    });

    test("extracts barrier as AttributeAdjust with value and coefficient", () => {
      const fact = mapWikiFactToApiFact("barrier", ["barrier", "1753"], { coefficient: "0.4" }, true, false);
      expect(fact).toEqual({
        type: "AttributeAdjust",
        text: "Barrier",
        value: 1753,
        target: "Healing",
        hit_count: 1,
        coefficient: 0.4,
        icon: "https://render.guildwars2.com/file/357922487919E8E84B914EAC13D5796DDDC42D14/1770209.png",
      });
    });

    test("extracts barrier with alt label", () => {
      const fact = mapWikiFactToApiFact("barrier", ["barrier", "500"], { alt: "Ally Barrier" }, true, false);
      expect(fact.text).toBe("Ally Barrier");
      expect(fact.type).toBe("AttributeAdjust");
      expect(fact.value).toBe(500);
    });

    test("rejects range with value <= 1", () => {
      const fact = mapWikiFactToApiFact("range", ["range", "1"], {}, true, false);
      expect(fact).toBeNull();
    });

    test("accepts range with valid value", () => {
      const fact = mapWikiFactToApiFact("range", ["range", "1200"], {}, true, false);
      expect(fact).toEqual({ type: "Range", text: "Range", value: 1200 });
    });

    test("maps gain to AttributeConversion", () => {
      const fact = mapWikiFactToApiFact("gain", ["gain", "Precision", "Vitality", "13"], {}, true, false);
      expect(fact).toEqual({
        type: "AttributeConversion",
        text: "Gain Precision Based on a Percentage of Vitality",
        source: "Vitality",
        target: "Precision",
        percent: 13,
      });
    });

    test("maps effect to Buff with description and duration", () => {
      const fact = mapWikiFactToApiFact("effect", ["effect", "Elements of Rage (effect)", "8"], { desc: "+5% Damage" }, true, false);
      expect(fact).toEqual({
        type: "Buff",
        text: "+5% Damage",
        status: "Elements of Rage (effect)",
        duration: 8,
        apply_count: 1,
      });
    });

    test("skips wiki-only fact types", () => {
      expect(mapWikiFactToApiFact("pierces", ["pierces"], {}, true, false)).toBeNull();
      expect(mapWikiFactToApiFact("text", ["text"], {}, true, false)).toBeNull();
      expect(mapWikiFactToApiFact("blocks missiles", ["blocks missiles"], {}, true, false)).toBeNull();
    });
  });

  describe("parseWikitextFacts", () => {
    test("extracts WvW-specific skill facts from wikitext", () => {
      const wikitext = `{{skill fact|damage|coefficient=1.35|game mode=wvw}}`;
      const { facts } = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Damage");
      expect(facts[0].dmg_multiplier).toBe(1.35);
    });

    test("skips PvE-only facts and sets hasPveOnly", () => {
      const wikitext = `{{skill fact|damage|coefficient=1.81|game mode=pve}}`;
      const { facts, hasPveOnly } = parseWikitextFacts(wikitext);
      expect(facts).toEqual([]);
      expect(hasPveOnly).toBe(true);
    });

    test("includes universal facts (no game mode)", () => {
      const wikitext = `{{skill fact|targets|5}}`;
      const { facts } = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Number");
    });

    test("handles pvp wvw combined mode", () => {
      const wikitext = `{{skill fact|blindness|3|game mode=pvp wvw}}`;
      const { facts } = parseWikitextFacts(wikitext);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Buff");
      expect(facts[0].status).toBe("Blindness");
    });

    test("returns empty facts and hasPveOnly=false for no skill facts", () => {
      const { facts, hasPveOnly } = parseWikitextFacts("just some regular wikitext");
      expect(facts).toEqual([]);
      expect(hasPveOnly).toBe(false);
    });
  });

  describe("parseSplitGrouping", () => {
    test("pve, wvw pvp → wvw split, grouped with pvp", () => {
      expect(parseSplitGrouping("pve, wvw pvp")).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: true });
    });

    test("pve, pvp wvw → wvw split, grouped with pvp", () => {
      expect(parseSplitGrouping("pve, pvp wvw")).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: true });
    });

    test("pve wvw, pvp → no wvw split (wvw shares pve values)", () => {
      expect(parseSplitGrouping("pve wvw, pvp")).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
    });

    test("pve, wvw, pvp → wvw has own group, not grouped with pvp", () => {
      expect(parseSplitGrouping("pve, wvw, pvp")).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: false });
    });

    test("pve, wvw → wvw split, not grouped with pvp", () => {
      expect(parseSplitGrouping("pve, wvw")).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: false });
    });

    test("no wvw at all → no split", () => {
      expect(parseSplitGrouping("pve, pvp")).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
    });
  });

  describe("parseWikitextFacts with wvwGroupedWithPvp", () => {
    test("treats pvp-only facts as wvw when grouped", () => {
      const wikitext = `{{skill fact|Endurance gained|8|game mode = pve}}{{skill fact|Endurance gained|5|game mode = pvp}}`;
      const { facts } = parseWikitextFacts(wikitext, true);
      expect(facts).toHaveLength(1);
      expect(facts[0]._wvwSpecific).toBe(true);
      expect(facts[0].type).toBe("Buff");
    });

    test("skips pvp-only facts when NOT grouped", () => {
      const wikitext = `{{skill fact|Endurance gained|8|game mode = pve}}{{skill fact|Endurance gained|5|game mode = pvp}}`;
      const { facts } = parseWikitextFacts(wikitext, false);
      expect(facts).toEqual([]);
    });
  });

  describe("parseInfoboxParams", () => {
    test("extracts recharge wvw param", () => {
      const wikitext = "| recharge = 10\n| recharge wvw = 25\n| id = 5648";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Recharge", text: "Recharge", value: 25 }]);
    });

    test("extracts energy wvw param", () => {
      const wikitext = "| energy = 20\n| energy wvw = 30";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Energy Cost", value: 30 }]);
    });

    test("extracts initiative wvw param", () => {
      const wikitext = "| initiative = 5\n| initiative wvw = 7";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Initiative Cost", value: 7 }]);
    });

    test("extracts upkeep wvw param", () => {
      const wikitext = "| upkeep = -1\n| upkeep wvw = -2";
      const facts = parseInfoboxParams(wikitext);
      expect(facts).toEqual([{ type: "Number", text: "Upkeep Cost", value: -2 }]);
    });

    test("returns empty for no wvw params", () => {
      const wikitext = "| recharge = 10\n| id = 1234";
      expect(parseInfoboxParams(wikitext)).toEqual([]);
    });

    test("ignores non-numeric values", () => {
      const wikitext = "| recharge wvw = varies";
      expect(parseInfoboxParams(wikitext)).toEqual([]);
    });

    test("reads pvp params when wvwGroupedWithPvp is true", () => {
      const wikitext = "| recharge = 20\n| recharge pvp = 35";
      const facts = parseInfoboxParams(wikitext, true);
      expect(facts).toEqual([{ type: "Recharge", text: "Recharge", value: 35 }]);
    });

    test("ignores pvp params when wvwGroupedWithPvp is false", () => {
      const wikitext = "| recharge = 20\n| recharge pvp = 35";
      expect(parseInfoboxParams(wikitext, false)).toEqual([]);
    });
  });

  describe("validateSplitEntry", () => {
    test("valid entry with known fact types", () => {
      expect(validateSplitEntry({
        facts: [{ type: "Damage" }, { type: "Buff" }]
      })).toBe(true);
    });

    test("rejects null entry", () => {
      expect(validateSplitEntry(null)).toBe(false);
    });

    test("rejects empty facts array", () => {
      expect(validateSplitEntry({ facts: [] })).toBe(false);
    });

    test("rejects entry with unknown fact type", () => {
      expect(validateSplitEntry({ facts: [{ type: "FakeType" }] })).toBe(false);
    });

    test("rejects entry with missing type", () => {
      expect(validateSplitEntry({ facts: [{ text: "Damage" }] })).toBe(false);
    });
  });
});
