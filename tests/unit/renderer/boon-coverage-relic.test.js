"use strict";

/**
 * Regression test for #296 — relic-granted boons were missing from boon coverage.
 * The bridge only ever fed skills + traits into the engine, so the equipped
 * relic's Buff facts were silently dropped.
 */
const { computeBoons } = require("../../../src/renderer/modules/engine-bridge");

const ASTRAL_WARD = {
  id: 100388,
  name: "Relic of the Astral Ward",
  icon: "https://example.invalid/astral.png",
  description:
    "Gain a Signet of the Astral Ward after using a signet skill. Using a signet skill while this signet is active consumes it to remove conditions from nearby allies and grant them resistance.",
  facts: [
    { type: "Buff", text: "Resistance", status: "Resistance", duration: 2, apply_count: 1 },
    { type: "Number", text: "Conditions Removed", value: 2 },
  ],
};

function makeState(relicName) {
  return {
    editor: {
      profession: "Guardian",
      gameMode: "pve",
      specializations: [],
      skills: {},
      equipment: { relic: relicName },
    },
    activeCatalog: {
      skills: [],
      traitById: new Map(),
      skillById: new Map(),
      specializationById: new Map(),
    },
    upgradeCatalog: { relicByName: new Map([[ASTRAL_WARD.name, ASTRAL_WARD]]) },
  };
}

describe("boon coverage — relics", () => {
  test("equipped relic contributes its boons", () => {
    const { boons } = computeBoons(makeState("Relic of the Astral Ward"));
    const resistance = boons.find((b) => b.name === "Resistance");
    expect(resistance).toBeDefined();
    expect(resistance.sources).toHaveLength(1);
    expect(resistance.sources[0]).toMatchObject({
      type: "relic",
      name: "Relic of the Astral Ward",
      duration: 2,
      isAlly: true,
    });
    expect(resistance.hasAllySource).toBe(true);
  });

  test("desktop catalog shape (flavour text on `buff`) also resolves", () => {
    const state = makeState("Relic of the Astral Ward");
    const { description, ...rest } = ASTRAL_WARD;
    state.upgradeCatalog.relicByName = new Map([
      [ASTRAL_WARD.name, { ...rest, buff: description }],
    ]);
    const { boons } = computeBoons(state);
    expect(boons.find((b) => b.name === "Resistance")?.sources[0].isAlly).toBe(true);
  });

  test("no relic equipped contributes nothing", () => {
    const { boons } = computeBoons(makeState(""));
    expect(boons.find((b) => b.name === "Resistance")).toBeUndefined();
  });

  test("unknown relic name is ignored", () => {
    const { boons } = computeBoons(makeState("Relic of Nonexistence"));
    expect(boons).toHaveLength(0);
  });
});
