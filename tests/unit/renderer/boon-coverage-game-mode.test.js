"use strict";

/**
 * Regression test for #307 — Feverish Pulse (Paragon grandmaster) never showed
 * up as a Quickness source in Party Coverage for WvW builds.
 *
 * The trait is mode-split: PvE grants Alacrity, WvW grants Quickness. The wiki
 * pipeline separates those into `facts` (PvE) and `wvwFacts`, and the boon
 * analyzer only ever read `facts` — so every WvW-split boon was reported with
 * its PvE values regardless of the build's game mode.
 */
const { computeBoons, computeCombos } = require("../../../src/renderer/modules/engine-bridge");

const PARAGON_SPEC_ID = 74;

// Shape mirrors a catalog-built trait: `facts` = PvE, `wvwFacts`/`pvpFacts` = splits.
const FEVERISH_PULSE = {
  id: 2369,
  name: "Feverish Pulse",
  description: "Using a chant reduces the recharge of your other chants and grants boons to affected allies.",
  specialization: PARAGON_SPEC_ID,
  hasSplit: true,
  facts: [
    { type: "Time", text: "Recharge Time Reduced", duration: 2 },
    { type: "Buff", text: "Apply Buff/Condition", status: "Alacrity", duration: 6, apply_count: 1 },
  ],
  wvwFacts: [
    { type: "Buff", text: "Apply Buff/Condition", status: "Quickness", duration: 1, apply_count: 1 },
    { type: "Time", text: "Recharge Time Reduced", duration: 2 },
  ],
  pvpFacts: [
    { type: "Buff", text: "Apply Buff/Condition", status: "Quickness", duration: 2, apply_count: 1 },
    { type: "Time", text: "Recharge Time Reduced", duration: 2 },
  ],
};

// A mode-split skill: its combo field only exists in PvE.
const SPLIT_FIELD_SKILL = {
  id: 999001,
  name: "Split Field",
  type: "Utility",
  slot: "Utility",
  description: "Drop a field.",
  facts: [{ type: "ComboField", text: "Combo Field", field_type: "Fire" }],
  wvwFacts: [{ type: "ComboField", text: "Combo Field", field_type: "Water" }],
};

function makeState(gameMode) {
  return {
    editor: {
      profession: "Warrior",
      gameMode,
      specializations: [{ specializationId: PARAGON_SPEC_ID, majorChoices: { 3: FEVERISH_PULSE.id } }],
      skills: { utilityIds: [SPLIT_FIELD_SKILL.id] },
      equipment: { weapons: {} },
    },
    activeCatalog: {
      skills: [SPLIT_FIELD_SKILL],
      skillById: new Map([[SPLIT_FIELD_SKILL.id, SPLIT_FIELD_SKILL]]),
      traitById: new Map([[FEVERISH_PULSE.id, FEVERISH_PULSE]]),
      specializationById: new Map([[PARAGON_SPEC_ID, { id: PARAGON_SPEC_ID, minorTraits: [] }]]),
    },
    upgradeCatalog: {},
  };
}

describe("boon coverage — game-mode fact splits", () => {
  test("a WvW build reports the WvW-split boon", () => {
    const { boons } = computeBoons(makeState("wvw"));
    const quickness = boons.find((b) => b.name === "Quickness");
    expect(quickness).toBeDefined();
    expect(quickness.sources).toHaveLength(1);
    expect(quickness.sources[0]).toMatchObject({
      name: "Feverish Pulse",
      type: "trait",
      duration: 1,
      isAlly: true,
    });
    expect(quickness.hasAllySource).toBe(true);
  });

  test("a WvW build does not report the PvE-only boon", () => {
    const { boons } = computeBoons(makeState("wvw"));
    expect(boons.find((b) => b.name === "Alacrity")).toBeUndefined();
  });

  test("a PvE build still reports the PvE boon and not the WvW one", () => {
    const { boons } = computeBoons(makeState("pve"));
    expect(boons.find((b) => b.name === "Alacrity")).toBeDefined();
    expect(boons.find((b) => b.name === "Quickness")).toBeUndefined();
  });

  test("a PvP build reports the PvP-split boon", () => {
    const { boons } = computeBoons(makeState("pvp"));
    const quickness = boons.find((b) => b.name === "Quickness");
    expect(quickness).toBeDefined();
    expect(quickness.sources[0].duration).toBe(2);
  });
});

describe("combo coverage — game-mode fact splits", () => {
  test("combo fields follow the build's game mode", () => {
    expect(computeCombos(makeState("pve")).fields.map((f) => f.fieldType)).toEqual(["Fire"]);
    expect(computeCombos(makeState("wvw")).fields.map((f) => f.fieldType)).toEqual(["Water"]);
  });
});
