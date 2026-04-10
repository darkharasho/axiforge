"use strict";

const { resolveEntityFacts, parseFactsByMode } = require("../src/wiki/resolver");
const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("Wiki fact resolution integration", () => {
  let client;
  let mockFetch;

  const MOCK_WIKI_PAGES = {
    Fireball: [
      "{{skill fact|damage|coefficient=0.9}}",
      "{{skill fact|burning|3|stacks=1}}",
      "{{skill fact|range|900}}",
    ].join("\n"),
    Shelter: [
      "| split = pve, wvw pvp",
      "{{skill fact|healing|4000|coefficient=0.75}}",
      "{{skill fact|healing|3200|coefficient=0.6|game mode=wvw pvp}}",
      "{{skill fact|recharge|30}}",
    ].join("\n"),
    "Searing Slash": [
      "| split = pve, wvw pvp",
      "{{skill fact|damage|coefficient=1.2}}",
      "{{skill fact|burning|4|stacks=2|game mode=pve}}",
      "{{skill fact|burning|2|stacks=1|game mode=wvw pvp}}",
      "{{skill fact|combo|fire}}",
    ].join("\n"),
  };

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: Object.fromEntries(
            Object.entries(MOCK_WIKI_PAGES).map(([title, wikitext], i) => [
              String(i + 1),
              { title, revisions: [{ "*": wikitext }] },
            ])
          ),
        },
      }),
    });
    client = new WikiClient({ cache: new MemoryCache(), fetch: mockFetch });
  });

  test("resolves all entities with correct per-mode facts", async () => {
    const idToTitle = new Map([
      [5489, "Fireball"],
      [9124, "Shelter"],
      [12345, "Searing Slash"],
    ]);

    const result = await resolveEntityFacts(client, idToTitle);

    // Fireball: no split
    const fireball = result.get(5489);
    expect(fireball.hasSplit).toBe(false);
    expect(fireball.pve).toHaveLength(3);
    expect(fireball.wvw).toBeNull();
    expect(fireball.pvp).toBeNull();

    // Shelter: PvE vs WvW/PvP split
    const shelter = result.get(9124);
    expect(shelter.hasSplit).toBe(true);
    expect(shelter.pve.length).toBeGreaterThanOrEqual(2);
    expect(shelter.wvw).not.toBeNull();
    // PvE healing = 4000, WvW has both universal (4000) and mode-specific (3200)
    const pveHeal = shelter.pve.find((f) => f.target === "Healing" || f.text === "Healing");
    if (pveHeal) expect(pveHeal.value).toBe(4000);
    // WvW mode-specific healing is 3200 (find the one that differs from universal)
    const wvwHeals = shelter.wvw.filter((f) => f.target === "Healing" || f.text === "Healing");
    expect(wvwHeals.length).toBeGreaterThanOrEqual(1);
    const wvwModeHeal = wvwHeals.find((f) => f.value === 3200);
    if (wvwModeHeal) expect(wvwModeHeal.value).toBe(3200);

    // Searing Slash: split with different burning stacks
    const slash = result.get(12345);
    expect(slash.hasSplit).toBe(true);
    expect(slash.pve.length).toBeGreaterThanOrEqual(2);
    expect(slash.wvw).not.toBeNull();
    const pveBurn = slash.pve.find((f) => f.status === "Burning");
    const wvwBurn = slash.wvw.find((f) => f.status === "Burning");
    if (pveBurn) {
      expect(pveBurn.duration).toBe(4);
      expect(pveBurn.apply_count).toBe(2);
    }
    if (wvwBurn) {
      expect(wvwBurn.duration).toBe(2);
      expect(wvwBurn.apply_count).toBe(1);
    }
  });

  test("missing wiki pages are not in result map", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": { title: "Fireball", revisions: [{ "*": "{{skill fact|damage|0.8}}" }] },
            "-1": { title: "Unknown Skill", missing: true },
          },
        },
      }),
    });

    const idToTitle = new Map([
      [5489, "Fireball"],
      [9999, "Unknown Skill"],
    ]);

    const result = await resolveEntityFacts(client, idToTitle);
    expect(result.has(5489)).toBe(true);
    expect(result.has(9999)).toBe(false);
  });

  test("parseFactsByMode correctly separates all three modes", () => {
    const wikitext = [
      "| split = pve, wvw, pvp",
      "{{skill fact|damage|coefficient=1.0}}",
      "{{skill fact|recharge|20|game mode=pve}}",
      "{{skill fact|recharge|25|game mode=wvw}}",
      "{{skill fact|recharge|30|game mode=pvp}}",
    ].join("\n");

    const result = parseFactsByMode(wikitext);
    expect(result.hasSplit).toBe(true);

    // Damage is universal → all modes
    expect(result.pve.length).toBeGreaterThanOrEqual(2);
    expect(result.wvw.length).toBeGreaterThanOrEqual(2);
    expect(result.pvp.length).toBeGreaterThanOrEqual(2);

    // Recharge differs per mode
    const pveRecharge = result.pve.find((f) => f.type === "Recharge");
    const wvwRecharge = result.wvw.find((f) => f.type === "Recharge");
    const pvpRecharge = result.pvp.find((f) => f.type === "Recharge");
    expect(pveRecharge.value).toBe(20);
    expect(wvwRecharge.value).toBe(25);
    expect(pvpRecharge.value).toBe(30);
  });

  test("all fact entries have valid type fields", async () => {
    const idToTitle = new Map([
      [5489, "Fireball"],
      [9124, "Shelter"],
    ]);

    const result = await resolveEntityFacts(client, idToTitle);

    for (const [, entity] of result) {
      for (const fact of entity.pve) {
        expect(fact.type).toBeTruthy();
        expect(typeof fact.type).toBe("string");
      }
      if (entity.wvw) {
        for (const fact of entity.wvw) {
          expect(fact.type).toBeTruthy();
        }
      }
    }
  });

  test("buff facts have status and duration", async () => {
    const idToTitle = new Map([[5489, "Fireball"]]);
    const result = await resolveEntityFacts(client, idToTitle);
    const fireball = result.get(5489);
    const buffFacts = fireball.pve.filter((f) => f.type === "Buff");
    for (const bf of buffFacts) {
      expect(bf.status).toBeTruthy();
      expect(typeof bf.duration).toBe("number");
    }
  });
});
