"use strict";

// The published viewer scales boon/condition durations with values main bakes
// into each build. They must equal what the desktop's comp coverage computes,
// or the same comp shows different durations in the app and on its link.
const { computeDurationStats } = require("../../src/main/statsCompute");
const { computeBuildConcentration, computeBuildExpertise } = require("../../src/renderer/modules/engine-bridge.js");

const SLOTS = ["head", "shoulders", "chest", "hands", "legs", "feet", "back", "amulet", "ring1", "ring2", "accessory1", "accessory2", "mainhand1", "offhand1"];
const gear = (prefix) => Object.fromEntries(SLOTS.map((s) => [s, prefix]));
const scholarCatalog = {
  runeById: new Map([[24836, { id: 24836, name: "Superior Rune of the Scholar",
    bonuses: ["+25 Power", "+35 Ferocity", "+50 Power", "+65 Ferocity", "+100 Power", "+10% damage"] }]]),
  infusionById: new Map(), enrichmentById: new Map(), foodById: new Map(), utilityById: new Map(),
};

const CASES = [
  ["Minstrel's", { profession: "Guardian", equipment: { slots: gear("Minstrel's"), weapons: {}, runes: {}, infusions: {} } }, null],
  ["Viper's", { profession: "Necromancer", equipment: { slots: gear("Viper's"), weapons: {}, runes: {}, infusions: {} } }, null],
  ["Ritualist's + Scholar runes", {
    profession: "Mesmer",
    equipment: { slots: gear("Ritualist's"), weapons: {}, infusions: {},
      runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" } },
  }, scholarCatalog],
  ["no equipment", { profession: "Warrior" }, null],
];

describe("computeDurationStats matches the desktop comp coverage", () => {
  test.each(CASES)("%s", (_name, build, upgradeCatalog) => {
    const main = computeDurationStats({ specializations: [], ...build }, upgradeCatalog);
    expect(main).toEqual({
      concentration: computeBuildConcentration({ specializations: [], ...build }, upgradeCatalog),
      expertise: computeBuildExpertise({ specializations: [], ...build }, upgradeCatalog),
    });
  });

  test("a concentration set actually yields concentration", () => {
    expect(computeDurationStats({ profession: "Guardian", equipment: { slots: gear("Minstrel's"), weapons: {}, runes: {}, infusions: {} } }, null).concentration)
      .toBeGreaterThan(0);
  });
});
