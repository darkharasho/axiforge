"use strict";

const { WikiClient } = require("../src/wiki/client");
const { mergeFacts } = require("../src/facts/merge");
const { MemoryCache } = require("../src/wiki/cache");

describe("End-to-end fact resolution", () => {
  test("resolves WvW facts for a skill with balance split", () => {
    // Simulate: Fireball has different damage in WvW
    const wikitext = [
      "{{skill infobox",
      "| id = 5489",
      "| name = Fireball",
      "| split = pve, wvw, pvp",
      "}}",
      "{{skill fact|damage|1.2|game mode=pve}}",
      "{{skill fact|damage|0.8|game mode=wvw}}",
      "{{skill fact|recharge|10}}",
      "{{skill fact|burning|3|stacks=2|game mode=wvw}}",
    ].join("\n");

    // API base facts (PvE values)
    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.2, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 10 },
    ];

    // Parse wiki facts
    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping.wvwHasSplit).toBe(true);

    // Merge API + wiki
    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });

    // Damage should use WvW value
    const damageFact = resolved.find((f) => f.type === "Damage");
    expect(damageFact.dmg_multiplier).toBe(0.8);
    expect(damageFact._splitFact).toBe(true);
    expect(damageFact.text).toBe("Damage"); // Preserves API label

    // Recharge should be unchanged (universal fact)
    const rechargeFact = resolved.find((f) => f.type === "Recharge");
    expect(rechargeFact.value).toBe(10);

    // Burning is a new WvW-only fact
    const burnFact = resolved.find((f) => f.status === "Burning");
    expect(burnFact).toBeTruthy();
    expect(burnFact._newFact).toBe(true);
    expect(burnFact.duration).toBe(3);
    expect(burnFact.apply_count).toBe(2);
  });

  test("resolves facts for skill with WvW grouped with PvP", () => {
    const wikitext = [
      "{{skill infobox",
      "| split = pve, wvw pvp",
      "}}",
      "{{skill fact|damage|0.6|game mode=pvp}}",
      "{{skill fact|damage|1.0|game mode=pve}}",
    ].join("\n");

    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, hit_count: 1 },
    ];

    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping.wvwGroupedWithPvp).toBe(true);

    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });
    const damageFact = resolved.find((f) => f.type === "Damage");
    expect(damageFact.dmg_multiplier).toBe(0.6); // Uses PvP value for WvW
  });

  test("handles skill with no balance split (PvE only)", () => {
    const wikitext = [
      "{{skill infobox",
      "| id = 9999",
      "}}",
      "{{skill fact|damage|1.5}}",
    ].join("\n");

    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.5, hit_count: 1 },
    ];

    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping).toBeNull();

    // No split — merge with universal facts
    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].dmg_multiplier).toBe(1.5);
  });
});
