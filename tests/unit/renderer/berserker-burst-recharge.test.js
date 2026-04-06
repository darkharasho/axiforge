"use strict";

const detailPanel = require("../../../src/renderer/modules/detail-panel");
const { state } = require("../../../src/renderer/modules/state");

/**
 * Berserker burst skill recharge (#154)
 *
 * Warrior burst skills display the API's raw Recharge fact value (8s for core,
 * 5s for primal bursts). When Berserker (spec 18) is the active elite spec,
 * the tooltip should show the Berserker burst recharge values instead:
 *   - Outside Berserk mode: 6s
 *   - In Berserk mode: 3.75s
 */
describe("Berserker burst skill recharge (#154)", () => {
  function makeBurstSkill(overrides = {}) {
    return {
      id: 14367,
      name: "Flurry",
      icon: "",
      description: "Burst.",
      slot: "Profession_1",
      type: "Profession",
      facts: [{ type: "Recharge", text: "Recharge", value: 8 }],
      ...overrides,
    };
  }

  function setupWarriorState({ specId = 0, activeKit = 0 } = {}) {
    state.editor = {
      profession: "Warrior",
      specializations: specId ? [{ id: specId, majorChoices: {} }] : [],
      activeKit,
      equipment: {
        runes: {}, sigils: {}, infusions: {}, slots: {},
        weapons: { mainhand1: "Sword" },
      },
    };
    state.activeCatalog = { traitById: new Map() };
  }

  afterEach(() => {
    state.editor = {};
    state.activeCatalog = null;
  });

  test("core warrior shows API recharge (8s) for burst skill", () => {
    setupWarriorState({ specId: 0 });
    const skill = makeBurstSkill();
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("8s");
    expect(html).not.toContain("6s");
    expect(html).not.toContain("3.75s");
  });

  test("Berserker outside berserk shows 6s recharge for core burst", () => {
    setupWarriorState({ specId: 18, activeKit: 0 });
    const skill = makeBurstSkill({ facts: [{ type: "Recharge", text: "Recharge", value: 8 }] });
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("6s");
    expect(html).not.toContain("8s");
  });

  test("Berserker in berserk mode shows 3.75s recharge for primal burst", () => {
    setupWarriorState({ specId: 18, activeKit: 30185 });
    const skill = makeBurstSkill({
      id: 30682,
      name: "Flaming Flurry",
      specialization: 18,
      facts: [{ type: "Recharge", text: "Recharge", value: 5 }],
    });
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("3.75s");
    expect(html).not.toMatch(/Recharge: 5s/);
  });

  test("non-Profession_1 skill is not affected by Berserker recharge override", () => {
    setupWarriorState({ specId: 18, activeKit: 0 });
    const skill = {
      id: 14402,
      name: "Mending",
      icon: "",
      description: "Heal.",
      slot: "Heal",
      type: "Heal",
      facts: [{ type: "Recharge", text: "Recharge", value: 20 }],
    };
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("20s");
  });

  test("non-Warrior profession is not affected", () => {
    state.editor = {
      profession: "Guardian",
      specializations: [{ id: 18, majorChoices: {} }],
      activeKit: 0,
      equipment: {
        runes: {}, sigils: {}, infusions: {}, slots: {},
        weapons: { mainhand1: "Sword" },
      },
    };
    state.activeCatalog = { traitById: new Map() };
    const skill = makeBurstSkill();
    const html = detailPanel.buildSkillCard(skill, "skill");
    expect(html).toContain("8s");
  });
});
