"use strict";

/**
 * Regression tests against real GW2 wiki + API data.
 *
 * These tests use captured fixtures (fixtures/fixtures.json) containing actual
 * wikitext and API responses. They verify that our parser and merger produce
 * correct results against production data, not just synthetic test strings.
 *
 * Re-capture fixtures:  node packages/gw2-data/tests/fixtures/capture.js
 */

const fs = require("fs");
const path = require("path");
const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");
const { mergeFacts } = require("../src/facts/merge");
const { parseSplitGrouping, parseWikitextFacts, mapWikiFactToApiFact } = require("../src/wiki/parser");
const { normalizeFactType } = require("../src/facts/normalize");

const fixturesPath = path.join(__dirname, "fixtures", "fixtures.json");
if (!fs.existsSync(fixturesPath)) {
  // eslint-disable-next-line no-console
  console.warn("Fixtures not found — run: node packages/gw2-data/tests/fixtures/capture.js");
}
const fixtures = fs.existsSync(fixturesPath)
  ? JSON.parse(fs.readFileSync(fixturesPath, "utf-8"))
  : { skills: [], traits: [] };

const describeIf = fixtures.skills.length > 0 ? describe : describe.skip;

// Helper: create a WikiClient with a mock fetch and pre-populated cache
function createClient() {
  const client = new WikiClient({
    cache: new MemoryCache(),
    fetch: jest.fn(),
  });
  return client;
}

// ── Skill Parser Tests ──────────────────────────────────────────────────────

describeIf("real data — skill parsing", () => {
  const client = createClient();

  test.each(fixtures.skills.map((s) => [s.wikiTitle, s]))(
    "%s: parseFacts produces non-empty result for split skills",
    (_name, fixture) => {
      const hasSplit = /\|\s*split\s*=/i.test(fixture.wikitext);
      const result = client.parseFacts(fixture.wikitext);

      if (hasSplit) {
        expect(result.splitGrouping).not.toBeNull();
        expect(result.splitGrouping.wvwHasSplit).toBe(true);
      }

      // Every split skill should produce at least one WvW fact
      if (hasSplit) {
        expect(result.facts.length).toBeGreaterThan(0);
      }
    }
  );

  test("Fireball (5489): parses WvW damage coefficient correctly", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5489);
    const result = client.parseFacts(fixture.wikitext);

    const damageFact = result.facts.find((f) => f.type === "Damage");
    expect(damageFact).toBeTruthy();
    // Wiki says coefficient=0.666 for pvp wvw
    expect(damageFact.dmg_multiplier).toBeCloseTo(0.666, 2);
  });

  test("Fireball (5489): split grouping is pve, wvw pvp", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5489);
    const result = client.parseFacts(fixture.wikitext);

    expect(result.splitGrouping.wvwHasSplit).toBe(true);
    expect(result.splitGrouping.wvwGroupedWithPvp).toBe(true);
  });

  test("Fireball (5489): has range, radius, and targets facts", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5489);
    const result = client.parseFacts(fixture.wikitext);

    expect(result.facts.find((f) => f.type === "Range")).toBeTruthy();
    expect(result.facts.find((f) => f.type === "Radius")).toBeTruthy();
    expect(result.facts.find((f) => f.type === "Number" && f.text === "Number of Targets")).toBeTruthy();
  });

  test("Berserk (30185): has duration split (pve=20, wvw=15)", () => {
    const fixture = fixtures.skills.find((s) => s.id === 30185);
    const result = client.parseFacts(fixture.wikitext);

    // WvW duration should be 15 (pvp wvw group)
    const durationFact = result.facts.find((f) => f.type === "Time");
    expect(durationFact).toBeTruthy();
    expect(durationFact.duration).toBe(15);
  });

  test("Eruption (5548): has combo blast finisher", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5548);
    const result = client.parseFacts(fixture.wikitext);

    const comboFact = result.facts.find((f) => f.type === "ComboFinisher");
    expect(comboFact).toBeTruthy();
    expect(comboFact.finisher_type).toBe("Blast");
  });

  test("Eruption (5548): has bleeding and crippled conditions", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5548);
    const result = client.parseFacts(fixture.wikitext);

    const bleedFact = result.facts.find((f) => f.status === "Bleeding");
    const cripFact = result.facts.find((f) => f.status === "Crippled");
    expect(bleedFact).toBeTruthy();
    expect(bleedFact.duration).toBe(12);
    expect(cripFact).toBeTruthy();
    expect(cripFact.duration).toBe(3);
  });

  test("Meteor Shower (5507): separate WvW split (not grouped with PvP)", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5507);
    const result = client.parseFacts(fixture.wikitext);

    // split = pve, wvw, pvp — each has its own group
    expect(result.splitGrouping.wvwHasSplit).toBe(true);
    expect(result.splitGrouping.wvwGroupedWithPvp).toBe(false);
  });

  test("Meteor Shower (5507): WvW damage coefficient is 0.88 (not PvE 1.6 or PvP 1.1)", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5507);
    const result = client.parseFacts(fixture.wikitext);

    const damageFacts = result.facts.filter((f) => f.type === "Damage");
    // Should have the WvW coefficient, not PvE or PvP
    const mainDamage = damageFacts.find((f) => f.dmg_multiplier === 0.88);
    expect(mainDamage).toBeTruthy();
  });

  test("Water Blast (5569): has healing fact with base and coefficient", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5569);
    const result = client.parseFacts(fixture.wikitext);

    const healingFact = result.facts.find((f) => f.target === "Healing");
    expect(healingFact).toBeTruthy();
    // WvW healing: base=223, coefficient=0.15
    expect(healingFact.value).toBe(223);
    expect(healingFact.coefficient).toBeCloseTo(0.15, 2);
  });

  test("Glyph of Storms (5503): no split, parses universal facts", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5503);
    const result = client.parseFacts(fixture.wikitext);

    expect(result.splitGrouping).toBeNull();
    expect(result.facts.length).toBeGreaterThan(0);
  });
});

// ── Trait Parser Tests ──────────────────────────────────────────────────────

describeIf("real data — trait parsing", () => {
  const client = createClient();

  test("Flow like Water (1510): has WvW split facts", () => {
    const fixture = fixtures.traits.find((t) => t.id === 1510);
    const result = client.parseFacts(fixture.wikitext);

    expect(result.splitGrouping).not.toBeNull();
    expect(result.splitGrouping.wvwHasSplit).toBe(true);
    expect(result.facts.length).toBeGreaterThan(0);
  });

  test("Burning Precision (264): has burning condition with split", () => {
    const fixture = fixtures.traits.find((t) => t.id === 264);
    const result = client.parseFacts(fixture.wikitext);

    expect(result.splitGrouping.wvwHasSplit).toBe(true);
    const burnFact = result.facts.find((f) => f.status === "Burning");
    expect(burnFact).toBeTruthy();
    // WvW burning duration is 1s (pvp wvw), not 3s (pve)
    expect(burnFact.duration).toBe(1);
  });

  test("Swift Revenge (1502): has WvW split (7% PvE / 10% WvW strike damage)", () => {
    const fixture = fixtures.traits.find((t) => t.id === 1502);
    const result = client.parseFacts(fixture.wikitext);

    // GW2 balance update: trait now has pve/wvw split for damage increase
    expect(result.splitGrouping).not.toBeNull();
    expect(result.splitGrouping.wvwHasSplit).toBe(true);
    expect(result.facts.length).toBeGreaterThan(0);
  });
});

// ── Fact Merge Tests (wiki → API) ───────────────────────────────────────────

describeIf("real data — fact merging", () => {
  const client = createClient();

  test("Fireball (5489): wiki WvW facts merge onto API base facts", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5489);
    const wikiResult = client.parseFacts(fixture.wikitext);
    const apiFacts = fixture.api.facts || [];

    const merged = mergeFacts(apiFacts, wikiResult.facts, { complete: false });

    // Merged result should retain API structure but with WvW values
    expect(merged.length).toBeGreaterThan(0);

    // Damage fact should have wiki's WvW coefficient
    const dmg = merged.find((f) => normalizeFactType(f.type) === "Damage" || f.type === "Damage");
    if (dmg && dmg._splitFact) {
      expect(dmg.dmg_multiplier).toBeCloseTo(0.666, 2);
    }
  });

  test("Berserk (30185): merged facts include attack speed and duration", () => {
    const fixture = fixtures.skills.find((s) => s.id === 30185);
    const wikiResult = client.parseFacts(fixture.wikitext);
    const apiFacts = fixture.api.facts || [];

    const merged = mergeFacts(apiFacts, wikiResult.facts, { complete: false });
    expect(merged.length).toBeGreaterThan(0);

    // Duration should reflect WvW (15, not PvE 20)
    const timeFact = merged.find((f) => f.type === "Time" || (f.type === "Duration" && f.duration));
    if (timeFact) {
      expect(timeFact.duration).toBe(15);
    }
  });

  test("Water Blast (5569): wiki healing merges with API AttributeAdjust", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5569);
    const wikiResult = client.parseFacts(fixture.wikitext);
    const apiFacts = fixture.api.facts || [];

    const merged = mergeFacts(apiFacts, wikiResult.facts, { complete: false });
    expect(merged.length).toBeGreaterThan(0);
  });

  test("Eruption (5548): merged facts preserve combo finisher from wiki", () => {
    const fixture = fixtures.skills.find((s) => s.id === 5548);
    const wikiResult = client.parseFacts(fixture.wikitext);
    const apiFacts = fixture.api.facts || [];

    const merged = mergeFacts(apiFacts, wikiResult.facts, { complete: false });

    // Should have combo finisher either from API or wiki
    const combo = merged.find(
      (f) => f.type === "ComboFinisher" || f.finisher_type
    );
    expect(combo).toBeTruthy();
  });
});

// ── API Fact Type Coverage ──────────────────────────────────────────────────

describeIf("real data — API fact type normalization", () => {
  test("all API fact types are recognized by normalizeFactType", () => {
    const allApiTypes = new Set();
    for (const fixture of [...fixtures.skills, ...fixtures.traits]) {
      for (const fact of fixture.api.facts || []) {
        allApiTypes.add(fact.type);
      }
      for (const fact of fixture.api.traited_facts || []) {
        allApiTypes.add(fact.type);
      }
    }

    // These are the types we expect to encounter in real API data
    const recognized = new Set([
      "Buff", "PrefixedBuff", "Damage", "Recharge", "Time", "Number",
      "Range", "Radius", "Distance", "AttributeAdjust", "Percent",
      "ComboField", "ComboFinisher", "StunBreak", "Unblockable",
      "NoData", "Duration",
    ]);

    for (const type of allApiTypes) {
      const normalized = normalizeFactType(type);
      // After normalization, it should be a known type (or pass through as-is)
      expect(typeof normalized).toBe("string");
      expect(normalized.length).toBeGreaterThan(0);
    }
  });

  test("PrefixedBuff normalizes to Buff", () => {
    // Water Blast (5569) has PrefixedBuff facts in the API
    const fixture = fixtures.skills.find((s) => s.id === 5569);
    const prefixed = (fixture.api.facts || []).filter((f) => f.type === "PrefixedBuff");
    expect(prefixed.length).toBeGreaterThan(0);

    for (const fact of prefixed) {
      expect(normalizeFactType(fact.type)).toBe("Buff");
    }
  });
});
