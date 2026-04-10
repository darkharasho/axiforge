"use strict";

const {
  groupFactsByMode,
  parseFactsByMode,
  resolveEntityFacts,
  isDisambiguation,
} = require("../src/wiki/resolver");
const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("groupFactsByMode", () => {
  test("universal facts go to all three arrays", () => {
    const facts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1, _modes: ["pve", "wvw", "pvp"] },
    ];
    const result = groupFactsByMode(facts);

    expect(result.pve).toHaveLength(1);
    expect(result.wvw).toHaveLength(1);
    expect(result.pvp).toHaveLength(1);
    expect(result.pve[0]).toEqual({ type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1 });
    expect(result.wvw[0]).toEqual({ type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1 });
    expect(result.pvp[0]).toEqual({ type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1 });
  });

  test("pve-only fact goes only to pve", () => {
    const facts = [
      { type: "Recharge", text: "Recharge", value: 10, _modes: ["pve"] },
    ];
    const result = groupFactsByMode(facts);

    expect(result.pve).toHaveLength(1);
    expect(result.wvw).toHaveLength(0);
    expect(result.pvp).toHaveLength(0);
  });

  test("wvw+pvp fact goes to both but not pve", () => {
    const facts = [
      { type: "Recharge", text: "Recharge", value: 15, _modes: ["wvw", "pvp"] },
    ];
    const result = groupFactsByMode(facts);

    expect(result.pve).toHaveLength(0);
    expect(result.wvw).toHaveLength(1);
    expect(result.pvp).toHaveLength(1);
  });

  test("mixed universal and mode-specific facts", () => {
    const facts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1, _modes: ["pve", "wvw", "pvp"] },
      { type: "Recharge", text: "Recharge", value: 10, _modes: ["pve"] },
      { type: "Recharge", text: "Recharge", value: 15, _modes: ["wvw", "pvp"] },
    ];
    const result = groupFactsByMode(facts);

    expect(result.pve).toHaveLength(2); // damage + pve recharge
    expect(result.wvw).toHaveLength(2); // damage + wvw/pvp recharge
    expect(result.pvp).toHaveLength(2); // damage + wvw/pvp recharge
  });

  test("_modes is stripped from output facts", () => {
    const facts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, hit_count: 1, _modes: ["pve", "wvw", "pvp"] },
    ];
    const result = groupFactsByMode(facts);

    expect(result.pve[0]._modes).toBeUndefined();
    expect(result.wvw[0]._modes).toBeUndefined();
    expect(result.pvp[0]._modes).toBeUndefined();
  });
});

describe("parseFactsByMode", () => {
  test("simple skill with no split returns pve facts, null-able wvw/pvp", () => {
    const wikitext = "{{skill fact|damage|0.8}}\n{{skill fact|recharge|10}}";
    const result = parseFactsByMode(wikitext);

    expect(result.pve.length).toBeGreaterThan(0);
    expect(result.hasSplit).toBe(false);
    // wvw/pvp get facts too (universal), but hasSplit is false
    // so the caller (resolveEntityFacts) would set them to null
  });

  test("skill with pve/wvw split separates correctly", () => {
    const wikitext = [
      "| split = pve, wvw, pvp",
      "{{skill fact|damage|0.8}}",
      "{{skill fact|recharge|10|game mode = pve}}",
      "{{skill fact|recharge|15|game mode = wvw pvp}}",
    ].join("\n");
    const result = parseFactsByMode(wikitext);

    expect(result.hasSplit).toBe(true);
    // PvE should have damage + pve recharge
    const pveRecharge = result.pve.find((f) => f.type === "Recharge");
    expect(pveRecharge.value).toBe(10);
    // WvW should have damage + wvw/pvp recharge
    const wvwRecharge = result.wvw.find((f) => f.type === "Recharge");
    expect(wvwRecharge.value).toBe(15);
  });

  test("skill with only universal facts but split marker still returns hasSplit", () => {
    const wikitext = [
      "| split = pve, wvw pvp",
      "{{skill fact|damage|0.8}}",
      "| recharge pvp = 25",
    ].join("\n");
    const result = parseFactsByMode(wikitext);

    // splitGrouping.wvwHasSplit is true (wvw grouped with pvp => wvwHasSplit true)
    expect(result.hasSplit).toBe(true);
    // wvw/pvp should have the universal damage fact
    expect(result.wvw.length).toBeGreaterThan(0);
    expect(result.pvp.length).toBeGreaterThan(0);
  });
});

describe("resolveEntityFacts", () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new WikiClient({ cache: new MemoryCache(), fetch: mockFetch });
  });

  test("resolves facts for multiple entities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "Fireball",
              revisions: [{ "*": "{{skill fact|damage|0.8}}" }],
            },
            "2": {
              title: "Heal",
              revisions: [{ "*": "{{skill fact|healing|372|coefficient=0.25}}" }],
            },
          },
        },
      }),
    });

    const titleToId = new Map([
      ["Fireball", 5489],
      ["Heal", 5503],
    ]);

    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(2);
    expect(result.get(5489).pve.length).toBeGreaterThan(0);
    expect(result.get(5489).pve[0].type).toBe("Damage");
    expect(result.get(5503).pve.length).toBeGreaterThan(0);
    expect(result.get(5503).pve[0].type).toBe("AttributeAdjust");
    // No split, so wvw/pvp should be null
    expect(result.get(5489).wvw).toBeNull();
    expect(result.get(5489).pvp).toBeNull();
  });

  test("skips missing wiki pages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "Fireball",
              revisions: [{ "*": "{{skill fact|damage|0.8}}" }],
            },
            "-1": {
              title: "Nonexistent Skill",
              missing: true,
            },
          },
        },
      }),
    });

    const titleToId = new Map([
      ["Fireball", 5489],
      ["Nonexistent Skill", 9999],
    ]);

    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(1);
    expect(result.has(5489)).toBe(true);
    expect(result.has(9999)).toBe(false);
  });

  test("returns empty map for empty input", async () => {
    const titleToId = new Map();
    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("retries disambiguation pages with profession-specific suffix", async () => {
    const disambigWikitext = "'''Charge''' may refer to:\n{{disambig}}\n* [[Charge (warrior skill)]]\n* [[Charge (ranger skill)]]";
    const realWikitext = "{{skill fact|damage|0.8}}\n| recharge = 10";

    // First fetch: returns the disambig page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "100": { title: "Charge", revisions: [{ "*": disambigWikitext }] },
          },
        },
      }),
    });
    // Second fetch: retry with "Charge (warrior skill)"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "200": { title: "Charge (warrior skill)", revisions: [{ "*": realWikitext }] },
          },
        },
      }),
    });

    const titleToId = new Map([["Charge", 14401]]);
    const result = await resolveEntityFacts(client, titleToId, { profession: "Warrior" });

    expect(result.size).toBe(1);
    expect(result.has(14401)).toBe(true);
    expect(result.get(14401).pve[0].type).toBe("Damage");
    expect(result.get(14401).recharge.pve).toBe(10);
    // Should have made 2 fetch calls: original batch + retry batch
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("skips disambiguation pages when no profession provided", async () => {
    const disambigWikitext = "'''Charge''' may refer to:\n{{disambig}}";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "100": { title: "Charge", revisions: [{ "*": disambigWikitext }] },
          },
        },
      }),
    });

    const titleToId = new Map([["Charge", 14401]]);
    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("skips pages with no fact templates (keeps API facts)", async () => {
    // A wiki page exists but has no {{skill fact|...}} or {{trait fact|...}} templates
    const noFactsWikitext = "'''Piercing Shards''' is a trait for Elementalist that makes ice shards pierce.";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "42": { title: "Piercing Shards", revisions: [{ slots: { main: { "*": noFactsWikitext } } }] },
          },
        },
      }),
    });

    const titleToId = new Map([["Piercing Shards", 1234]]);
    const result = await resolveEntityFacts(client, titleToId);

    // Should NOT have an entry — empty facts would wipe valid API facts
    expect(result.size).toBe(0);
    expect(result.has(1234)).toBe(false);
  });
});

describe("isDisambiguation", () => {
  test("detects {{disambig}} template", () => {
    expect(isDisambiguation("Some text\n{{disambig}}\n* [[Link]]")).toBe(true);
  });

  test("detects {{disambiguation}} template", () => {
    expect(isDisambiguation("{{disambiguation}}\n* [[Link]]")).toBe(true);
  });

  test("detects {{disambig|...}} with parameters", () => {
    expect(isDisambiguation("{{disambig|skill}}\n* [[Link]]")).toBe(true);
  });

  test("returns false for normal skill pages", () => {
    expect(isDisambiguation("{{skill fact|damage|0.8}}\n| recharge = 10")).toBe(false);
  });

  test("returns false for pages mentioning disambig in prose", () => {
    expect(isDisambiguation("This page is not a disambiguation page")).toBe(false);
  });
});
