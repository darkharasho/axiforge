"use strict";

// Attacker's Insight (Spellbreaker minor, trait 2130) — opt-in assumed stacks (#343).
const { computeStatBreakdown } = require("../../../src/renderer/modules/stats");
const { computeStats, getActiveTraitBuffDefs } = require("../../../src/renderer/modules/engine-bridge");
const { state } = require("../../../src/renderer/modules/state");

const SPELLBREAKER = 61;

function setBuild({ spellbreaker = true, gameMode = "pve" } = {}) {
  state.editor = {
    profession: "Warrior",
    gameMode,
    equipment: { slots: {}, weapons: {} },
    specializations: spellbreaker ? [{ specializationId: SPELLBREAKER, majorChoices: {} }] : [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
  };
  state.activeCatalog = {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map([[SPELLBREAKER, { minorTraits: [2130] }]]),
  };
  state.upgradeCatalog = null;
}

afterEach(() => { state.activeCatalog = null; });

test("getActiveTraitBuffDefs lists Attacker's Insight only for Spellbreaker builds", () => {
  setBuild();
  expect(getActiveTraitBuffDefs(state).map((d) => d.key)).toEqual(["attackersInsight"]);
  setBuild({ spellbreaker: false });
  expect(getActiveTraitBuffDefs(state)).toEqual([]);
});

test("baseline is unchanged; assumed stacks add Power/Precision/Ferocity", () => {
  setBuild();
  const base = computeStats(state).total;
  const buffed = computeStats(state, null, null, null, { attackersInsight: 5 }).total;
  expect(buffed.Power - base.Power).toBe(250);
  expect(buffed.Precision - base.Precision).toBe(250);
  expect(buffed.Ferocity - base.Ferocity).toBe(250);
});

test("breakdown shows the Attacker's Insight source with mode-specific values", () => {
  setBuild({ gameMode: "wvw" });
  const entries = computeStatBreakdown("Ferocity", null, null, null, { attackersInsight: 3 });
  const entry = entries.find((e) => e.source.includes("Attacker's Insight"));
  expect(entry).toMatchObject({ source: "Trait (Attacker's Insight ×3)", value: 90 });
});

test("breakdown omits it when the build lacks the trait", () => {
  setBuild({ spellbreaker: false });
  const entries = computeStatBreakdown("Power", null, null, null, { attackersInsight: 5 });
  expect(entries.find((e) => e.source.includes("Attacker's Insight"))).toBeUndefined();
});

// Deadly Strength (Necromancer Death Magic major, trait 855) — +10 Power and
// +10 Condition Damage per Death's Carapace stack, max 30 (#345).
describe("Deadly Strength", () => {
  const DEATH_MAGIC = 2;

  function setNecro({ withTrait = true } = {}) {
    state.editor = {
      profession: "Necromancer",
      gameMode: "pve",
      equipment: { slots: {}, weapons: {} },
      specializations: [{ specializationId: DEATH_MAGIC, majorChoices: withTrait ? { 2: 855 } : {} }],
      skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    };
    state.activeCatalog = {
      traitById: new Map([[855, {
        id: 855, name: "Deadly Strength", specialization: DEATH_MAGIC, slot: "Major",
        facts: [
          { type: "AttributeAdjust", value: 10, target: "Power" },
          { type: "AttributeAdjust", value: 10, target: "ConditionDamage" },
        ],
      }]]),
      skillById: new Map(),
      specializationById: new Map([[DEATH_MAGIC, { minorTraits: [] }]]),
    };
    state.upgradeCatalog = null;
  }

  test("its per-stack facts are not counted as a passive baseline bonus", () => {
    setNecro();
    const total = computeStats(state).total;
    expect(total.Power).toBe(1000);
    expect(total.ConditionDamage).toBe(0);
  });

  test("is offered as a trait stack and adds +10 per Carapace stack, capped at 30", () => {
    setNecro();
    expect(getActiveTraitBuffDefs(state).map((d) => d.key)).toEqual(["deadlyStrength"]);
    const buffed = computeStats(state, null, null, null, { deadlyStrength: 99 }).total;
    expect(buffed.Power).toBe(1300);
    expect(buffed.ConditionDamage).toBe(300);
    setNecro({ withTrait: false });
    expect(getActiveTraitBuffDefs(state)).toEqual([]);
  });
});
