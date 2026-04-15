"use strict";

const { mapWikiFactToApiFact, parseAllTaggedFacts } = require("../../packages/gw2-data/src/wiki/parser");

describe("wiki parser condition variants (issue #207)", () => {
  test("'immobilized' produces Buff fact (Entangle wiki uses this form)", () => {
    const fact = mapWikiFactToApiFact("immobilized", ["2"], { stacks: "5" }, false, true);
    expect(fact).toEqual({
      type: "Buff",
      text: "Immobilized",
      status: "Immobilized",
      duration: 2,
      apply_count: 5,
    });
  });

  test("all condition name variants produce Buff facts", () => {
    const variants = ["cripple", "blinded", "poisoned", "immobilized"];
    for (const variant of variants) {
      const fact = mapWikiFactToApiFact(variant, ["3"], {}, false, true);
      expect(fact).not.toBeNull();
      expect(fact.type).toBe("Buff");
      expect(fact.status).toBeTruthy();
    }
  });

  test("Entangle-style wikitext extracts Immobilized as Buff fact", () => {
    const wikitext = [
      "{{skill fact|bleeding|8|stacks=5}}",
      "{{skill fact|immobilized|2|stacks=5}}",
      "{{skill fact|targets|5}}",
    ].join("\n");
    const { facts } = parseAllTaggedFacts(wikitext);
    const buffFacts = facts.filter((f) => f.type === "Buff");
    expect(buffFacts).toHaveLength(2);
    const immobFact = buffFacts.find((f) => f.status === "Immobilized");
    expect(immobFact).toBeDefined();
    expect(immobFact.duration).toBe(2);
    expect(immobFact.apply_count).toBe(5);
  });
});
