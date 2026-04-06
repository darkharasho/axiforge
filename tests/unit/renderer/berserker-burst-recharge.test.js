"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");
const { computeUpgradeModifiers } = require("../../../src/renderer/modules/stats");
const { state } = require("../../../src/renderer/modules/state");

/**
 * Berserker burst skill recharge (#154)
 *
 * Berserker's minor trait Primal Rage (1831) grants 10% burst recharge reduction
 * that the GW2 API omits from its facts. Combined with Discipline's Versatile Power
 * (15%), burst skills should show 25% total reduction:
 *   - Core burst (8s base) → 6s
 *   - Primal burst (5s base) → 3.75s
 */
describe("Berserker burst skill recharge (#154)", () => {
  // Berserker spec 18, minor traits include 1831 (Primal Rage)
  const BERSERKER_SPEC_DATA = {
    id: 18, name: "Berserker", elite: true,
    minorTraits: [1831, 1993, 2046], majorTraits: [],
  };
  // Discipline spec 51, minor traits include 1417 (Versatile Power)
  const DISCIPLINE_SPEC_DATA = {
    id: 51, name: "Discipline", elite: false,
    minorTraits: [1415, 1416, 1417], majorTraits: [],
  };

  function setupState({ specs = [], traitOverrides = [] } = {}) {
    const traitMap = new Map([
      // Primal Rage — API has no burst recharge fact (that's the bug)
      [1831, { id: 1831, slot: "Minor", description: "Gain access to berserk mode and primal bursts.", facts: [] }],
      // Versatile Power — 15% burst recharge reduction
      [1417, { id: 1417, slot: "Minor", description: "Burst skills gain reduced recharge.", facts: [{ type: "Percent", text: "Recharge Reduced", percent: 15 }] }],
      // Filler minor traits (no burst effects)
      [1415, { id: 1415, slot: "Minor", description: "Gain adrenaline on weapon swap.", facts: [] }],
      [1416, { id: 1416, slot: "Minor", description: "Gain swiftness on weapon swap.", facts: [] }],
      [1993, { id: 1993, slot: "Minor", description: "Gain speed on berserk.", facts: [] }],
      [2046, { id: 2046, slot: "Minor", description: "Berserk increases power.", facts: [] }],
      ...traitOverrides,
    ]);
    const specMap = new Map([
      [18, BERSERKER_SPEC_DATA],
      [51, DISCIPLINE_SPEC_DATA],
    ]);
    state.editor = {
      profession: "Warrior",
      specializations: specs.map((id) => ({ specializationId: id, majorChoices: {} })),
      activeKit: 0,
      equipment: { runes: {}, sigils: {}, infusions: {}, slots: {}, weapons: { mainhand1: "Sword" } },
    };
    state.activeCatalog = { traitById: traitMap, specializationById: specMap };
    state.upgradeCatalog = { runes: [], sigils: [], infusions: [], enrichments: [], runeById: new Map(), sigilById: new Map(), infusionById: new Map(), enrichmentById: new Map() };
  }

  afterEach(() => {
    state.editor = {};
    state.activeCatalog = null;
    state.upgradeCatalog = null;
  });

  // --- computeUpgradeModifiers tests ---

  test("Berserker alone contributes 10% Burst Recharge", () => {
    setupState({ specs: [18] });
    const mods = computeUpgradeModifiers();
    expect(mods.get("Burst Recharge")).toBe(10);
  });

  test("Discipline alone contributes 15% Burst Recharge", () => {
    setupState({ specs: [51] });
    const mods = computeUpgradeModifiers();
    expect(mods.get("Burst Recharge")).toBe(15);
  });

  test("Berserker + Discipline gives 25% total Burst Recharge", () => {
    setupState({ specs: [18, 51] });
    const mods = computeUpgradeModifiers();
    expect(mods.get("Burst Recharge")).toBe(25);
  });

  test("no warrior specs gives 0% Burst Recharge", () => {
    setupState({ specs: [] });
    const mods = computeUpgradeModifiers();
    expect(mods.get("Burst Recharge") || 0).toBe(0);
  });

  // --- tooltip rendering tests ---

  test("Berserker + Discipline: core burst (8s) renders as 6s", () => {
    setupState({ specs: [18, 51] });
    const skill = {
      id: 14367, name: "Flurry", icon: "", description: "Burst.",
      slot: "Profession_1", type: "Profession",
      facts: [{ type: "Recharge", text: "Recharge", value: 8 }],
    };
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("6s");
  });

  test("Berserker + Discipline: primal burst (5s) renders as 3.75s", () => {
    setupState({ specs: [18, 51] });
    const skill = {
      id: 30682, name: "Flaming Flurry", icon: "", description: "Primal Burst.",
      slot: "Profession_1", type: "Profession",
      facts: [{ type: "Recharge", text: "Recharge", value: 5 }],
    };
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("3.75s");
  });

  test("non-Profession_1 skill is not affected", () => {
    setupState({ specs: [18, 51] });
    const skill = {
      id: 14402, name: "Mending", icon: "", description: "Heal.",
      slot: "Heal", type: "Heal",
      facts: [{ type: "Recharge", text: "Recharge", value: 20 }],
    };
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("20s");
  });
});
