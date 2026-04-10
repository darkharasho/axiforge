"use strict";

const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");
const { parseFactsByMode } = require("../src/wiki/resolver");

const RUN_LIVE = process.env.GW2_LIVE_TESTS === "1";

const REPRESENTATIVE_SKILLS = [
  { title: "Fireball", expectedFactTypes: ["Damage"] },
  { title: "Shelter", expectedModes: ["pve", "pvp", "wvw"] },
  { title: "Signet of Inspiration", minFacts: 1 },
  { title: "Shattering Blow", minFacts: 1 },
  { title: "Moa Stance", minFacts: 1 },
];

(RUN_LIVE ? describe : describe.skip)("Live wiki fact validation", () => {
  let client;

  beforeAll(() => {
    client = new WikiClient({ cache: new MemoryCache() });
  });

  for (const skill of REPRESENTATIVE_SKILLS) {
    test(`${skill.title} — parses valid facts from live wiki`, async () => {
      const wikitext = await client.getWikitext(skill.title);
      expect(wikitext).not.toBeNull();

      const result = parseFactsByMode(wikitext);
      expect(result.pve.length).toBeGreaterThanOrEqual(skill.minFacts || 1);

      // Every fact should have a type and text
      for (const fact of result.pve) {
        expect(fact.type).toBeTruthy();
        expect(fact.text).toBeTruthy();
      }

      if (skill.expectedFactTypes) {
        for (const expectedType of skill.expectedFactTypes) {
          expect(result.pve.some((f) => f.type === expectedType)).toBe(true);
        }
      }

      if (skill.expectedModes) {
        for (const mode of skill.expectedModes) {
          expect(result[mode].length).toBeGreaterThanOrEqual(1);
        }
      }
    }, 15000);
  }

  test("batch fetch works with live wiki", async () => {
    const titles = REPRESENTATIVE_SKILLS.map((s) => s.title);
    const result = await client.getWikitextBatch(titles);
    expect(result.size).toBe(titles.length);
    for (const title of titles) {
      expect(result.has(title)).toBe(true);
      expect(result.get(title)).not.toBeNull();
    }
  }, 30000);
});
