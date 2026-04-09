/**
 * Tests for the wiki fact parser in seed.js — covers nested template handling
 * and effect fact parsing with stacks/alt params.
 */
const {
  parseWikitextFacts,
  mapWikiFactToApiFact,
} = require("../../lib/gw2-balance-splits/scripts/seed");

describe("seed.js wiki fact parser", () => {
  describe("nested template handling in factPattern regex", () => {
    test("parses facts containing {{fraction|N}} templates", () => {
      const wikitext = `{{skill fact|effect|Heightened Focus (effect)|alt=Adrenaline Stage 1|15|desc=+{{fraction|7.5}}% Healing Increase to Others|stacks=2|game mode = pvp wvw}}`;
      const { facts } = parseWikitextFacts(wikitext, true);
      expect(facts).toHaveLength(1);
      expect(facts[0].type).toBe("Buff");
      expect(facts[0].duration).toBe(15);
      expect(facts[0].apply_count).toBe(2);
      expect(facts[0].text).toBe("Adrenaline Stage 1");
    });

    test("preserves game mode param after nested template", () => {
      // The old regex [^}]+ would stop at the first } inside {{fraction|7.5}},
      // losing the game mode param and treating the fact as universal
      const wikitext = [
        `{{skill fact|effect|Buff (effect)|15|desc=+{{fraction|3.5}}% bonus|stacks=3|game mode = pve}}`,
        `{{skill fact|effect|Buff (effect)|15|desc=+{{fraction|2.5}}% bonus|stacks=3|game mode = wvw}}`,
      ].join("");
      const { facts, hasPveOnly } = parseWikitextFacts(wikitext, false);
      // Only the WvW fact should be in the results
      expect(hasPveOnly).toBe(true);
      const wvwFacts = facts.filter((f) => f._wvwSpecific);
      expect(wvwFacts).toHaveLength(1);
      expect(wvwFacts[0].text).toBe("+2.5% bonus");
    });

    test("still parses simple facts without nested templates", () => {
      const wikitext = `{{skill fact|quickness|2.5|game mode = wvw}}`;
      const { facts } = parseWikitextFacts(wikitext, false);
      expect(facts).toHaveLength(1);
      expect(facts[0].status).toBe("Quickness");
      expect(facts[0].duration).toBe(2.5);
    });

    test("parses multiple facts including mixed nested/simple", () => {
      const wikitext = [
        `{{skill fact|health threshold|50}}`,
        `{{skill fact|quickness|2.5|game mode = wvw}}`,
        `{{skill fact|effect|Buff (effect)|10|desc=+{{fraction|5}}% bonus|stacks=2|game mode = wvw}}`,
      ].join("");
      const { facts } = parseWikitextFacts(wikitext, false);
      // Health threshold (universal) + quickness (wvw) + effect (wvw) = 3
      expect(facts).toHaveLength(3);
    });
  });

  describe("effect fact type parsing", () => {
    test("reads stacks param for apply_count", () => {
      const fact = mapWikiFactToApiFact(
        "effect",
        ["effect", "My Buff (effect)", "10"],
        { desc: "Some description", stacks: "3" },
        true,
        false,
      );
      expect(fact).not.toBeNull();
      expect(fact.apply_count).toBe(3);
    });

    test("uses alt param for text when provided", () => {
      const fact = mapWikiFactToApiFact(
        "effect",
        ["effect", "Internal Name (effect)", "8"],
        { desc: "Effect description", alt: "Display Name", stacks: "2" },
        true,
        false,
      );
      expect(fact.text).toBe("Display Name");
      expect(fact.status).toBe("Internal Name (effect)");
    });

    test("falls back to desc for text when alt is absent", () => {
      const fact = mapWikiFactToApiFact(
        "effect",
        ["effect", "Buff (effect)", "5"],
        { desc: "Heal over time" },
        true,
        false,
      );
      expect(fact.text).toBe("Heal over time");
    });

    test("defaults apply_count to 1 when stacks not provided", () => {
      const fact = mapWikiFactToApiFact(
        "effect",
        ["effect", "Buff", "5"],
        { desc: "Some effect" },
        true,
        false,
      );
      expect(fact.apply_count).toBe(1);
    });
  });
});
