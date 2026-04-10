"use strict";
const { parseFactsByMode } = require("../src/wiki/resolver");

const SNAPSHOTS = [
  {
    name: "Fireball — simple damage + burning, no split",
    wikitext: [
      "{{skill fact|damage|coefficient=0.9|hits=1}}",
      "{{skill fact|burning|3|stacks=1}}",
      "{{skill fact|targets|5}}",
      "{{skill fact|range|900}}",
      "{{skill fact|combo|projectile}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 5,
      pveTypes: ["Damage", "Buff", "Number", "Range", "ComboFinisher"],
    },
  },
  {
    name: "Shelter — healing + block with WvW split",
    wikitext: [
      "{{skill fact|healing|4000|coefficient=0.75|game mode=pve}}",
      "{{skill fact|healing|3200|coefficient=0.75|game mode=wvw pvp}}",
      "| split = pve, wvw pvp",
    ].join("\n"),
    expected: {
      hasSplit: true,
      pveCount: 1,
      wvwCount: 1,
      pvpCount: 1,
      pveHealingValue: 4000,
      wvwHealingValue: 3200,
    },
  },
  {
    name: "Signet of Inspiration — boon application",
    wikitext: [
      "{{skill fact|quickness|2|stacks=1}}",
      "{{skill fact|fury|5|stacks=1}}",
      "{{skill fact|might|8|stacks=3}}",
      "{{skill fact|recharge|30}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 4,
      pveTypes: ["Buff", "Buff", "Buff", "Recharge"],
    },
  },
  {
    name: "All three mode variants — pve/wvw/pvp burning durations",
    wikitext: [
      "{{skill fact|damage|coefficient=1.0|hits=1}}",
      "{{skill fact|burning|4|stacks=1|game mode=pve}}",
      "{{skill fact|burning|2|stacks=1|game mode=wvw}}",
      "{{skill fact|burning|1|stacks=1|game mode=pvp}}",
      "| split = pve, wvw, pvp",
    ].join("\n"),
    expected: {
      hasSplit: true,
      pveCount: 2,
      wvwCount: 2,
      pvpCount: 2,
      pveBurningDuration: 4,
      wvwBurningDuration: 2,
      pvpBurningDuration: 1,
    },
  },
  {
    name: "Combo field skill — Damage, ComboField (fire), Radius",
    wikitext: [
      "{{skill fact|damage|coefficient=0.5|hits=1}}",
      "{{skill fact|combo|fire}}",
      "{{skill fact|radius|240}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 3,
      pveTypes: ["Damage", "ComboField", "Radius"],
    },
  },
  {
    name: "Attribute conversion — BuffConversion + Time",
    wikitext: [
      "{{skill fact|gain|source=Power|target=Condition Damage|percent=10}}",
      "{{skill fact|duration|8}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 2,
      pveTypes: ["BuffConversion", "Time"],
    },
  },
  {
    name: "Defiance break + conditions removed",
    wikitext: [
      "{{skill fact|defiance break|200}}",
      "{{skill fact|conditions removed|3}}",
      "{{skill fact|range|900}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 3,
      pveTypes: ["Number", "Number", "Range"],
    },
  },
];

describe("Wiki fact parsing snapshots", () => {
  for (const snapshot of SNAPSHOTS) {
    test(snapshot.name, () => {
      const result = parseFactsByMode(snapshot.wikitext);
      const { expected } = snapshot;

      if ("hasSplit" in expected) {
        expect(result.hasSplit).toBe(expected.hasSplit);
      }

      if ("pveCount" in expected) {
        expect(result.pve).toHaveLength(expected.pveCount);
      }

      if ("wvwCount" in expected) {
        expect(result.wvw).toHaveLength(expected.wvwCount);
      }

      if ("pvpCount" in expected) {
        expect(result.pvp).toHaveLength(expected.pvpCount);
      }

      if ("pveTypes" in expected) {
        expect(result.pve.map((f) => f.type)).toEqual(expected.pveTypes);
      }

      if ("pveHealingValue" in expected) {
        const healingFact = result.pve.find((f) => f.target === "Healing");
        expect(healingFact).toBeDefined();
        expect(healingFact.value).toBe(expected.pveHealingValue);
      }

      if ("wvwHealingValue" in expected) {
        const healingFact = result.wvw.find((f) => f.target === "Healing");
        expect(healingFact).toBeDefined();
        expect(healingFact.value).toBe(expected.wvwHealingValue);
      }

      if ("pveBurningDuration" in expected) {
        const burningFact = result.pve.find((f) => f.status === "Burning");
        expect(burningFact).toBeDefined();
        expect(burningFact.duration).toBe(expected.pveBurningDuration);
      }

      if ("wvwBurningDuration" in expected) {
        const burningFact = result.wvw.find((f) => f.status === "Burning");
        expect(burningFact).toBeDefined();
        expect(burningFact.duration).toBe(expected.wvwBurningDuration);
      }

      if ("pvpBurningDuration" in expected) {
        const burningFact = result.pvp.find((f) => f.status === "Burning");
        expect(burningFact).toBeDefined();
        expect(burningFact.duration).toBe(expected.pvpBurningDuration);
      }
    });
  }
});
