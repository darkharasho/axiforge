"use strict";

const { state, createEmptyEditor } = require("../../../src/renderer/modules/state");
const { enforceEditorConsistency, loadBuildIntoEditor, serializeEditorToBuild } = require("../../../src/renderer/modules/editor");

function normalizeCatalog(raw) {
  return {
    ...raw,
    specializationById: new Map((raw.specializations || []).map((e) => [Number(e.id), e])),
    traitById: new Map((raw.traits || []).map((e) => [Number(e.id), e])),
    skillById: new Map((raw.skills || []).map((e) => [Number(e.id), e])),
    weaponSkillById: new Map((raw.weaponSkills || []).map((e) => [Number(e.id), e])),
    legendById: new Map((raw.legends || []).map((e) => [String(e.id), e])),
    petById: new Map((raw.pets || []).map((e) => [Number(e.id), e])),
  };
}

function makeWarriorCatalog() {
  return normalizeCatalog({
    specializations: [
      { id: 4, name: "Strength", elite: false },
      { id: 36, name: "Arms", elite: false },
      { id: 18, name: "Berserker", elite: true },
    ],
    traits: [],
    skills: [],
    weaponSkills: [],
    legends: [],
    pets: [],
    professionWeapons: {
      greatsword: { flags: ["TwoHand"], specialization: 0, skills: [] },
      axe: { flags: ["Mainhand", "Offhand"], specialization: 0, skills: [] },
      sword: { flags: ["Mainhand", "Offhand"], specialization: 0, skills: [] },
      mace: { flags: ["Mainhand", "Offhand"], specialization: 0, skills: [] },
      hammer: { flags: ["TwoHand"], specialization: 0, skills: [] },
      longbow: { flags: ["TwoHand"], specialization: 0, skills: [] },
      rifle: { flags: ["TwoHand"], specialization: 0, skills: [] },
      dagger: { flags: ["Mainhand", "Offhand"], specialization: 68, skills: [] },
      shield: { flags: ["Offhand"], specialization: 0, skills: [] },
      warhorn: { flags: ["Offhand"], specialization: 0, skills: [] },
    },
  });
}

beforeEach(() => {
  state.editor = createEmptyEditor("Warrior");
  state.professions = [{ id: "Warrior", name: "Warrior" }];
  state.activeCatalog = null;
});

describe("enforceEditorConsistency — weapon preservation", () => {
  test("preserves valid weapons for the profession", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.mainhand2 = "axe";
    state.editor.equipment.weapons.offhand2 = "shield";

    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
    expect(state.editor.equipment.weapons.mainhand2).toBe("axe");
    expect(state.editor.equipment.weapons.offhand2).toBe("shield");
  });

  test("clears weapons the profession cannot equip", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "scepter"; // Warrior can't use scepter

    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.mainhand1).toBe("");
  });

  test("clears mainhand weapon that only has Offhand flag", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "shield"; // Shield is offhand only

    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.mainhand1).toBe("");
  });

  test("clears offhand weapon that only has Mainhand/TwoHand flag", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.offhand1 = "greatsword"; // Two-handed, not valid offhand

    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.offhand1).toBe("");
  });

  test("does NOT clear weapons when professionWeapons is empty", () => {
    state.activeCatalog = normalizeCatalog({
      specializations: [],
      traits: [],
      skills: [],
      weaponSkills: [],
      legends: [],
      pets: [],
      professionWeapons: {},
    });
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.mainhand2 = "axe";

    enforceEditorConsistency();

    // Weapons should survive because we can't validate without weapon data
    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
    expect(state.editor.equipment.weapons.mainhand2).toBe("axe");
  });

  test("does NOT clear weapons when catalog has no professionWeapons key", () => {
    state.activeCatalog = normalizeCatalog({
      specializations: [],
      traits: [],
      skills: [],
      weaponSkills: [],
      legends: [],
      pets: [],
    });
    state.editor.equipment.weapons.mainhand1 = "greatsword";

    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
  });
});

describe("save round-trip — weapons survive", () => {
  test("weapons survive serialize → load → enforceConsistency", async () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.profession = "Warrior";
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.mainhand2 = "axe";
    state.editor.equipment.weapons.offhand2 = "warhorn";

    // Serialize (mimics what saveCurrentBuild does)
    const serialized = serializeEditorToBuild();

    expect(serialized.equipment.weapons.mainhand1).toBe("greatsword");
    expect(serialized.equipment.weapons.mainhand2).toBe("axe");
    expect(serialized.equipment.weapons.offhand2).toBe("warhorn");

    // Load back (mimics what loadBuildIntoEditor does, minus _setProfession)
    await loadBuildIntoEditor(serialized, { captureBaseline: false });

    // Manually set catalog and enforce (since _setProfession is a no-op in tests)
    state.activeCatalog = makeWarriorCatalog();
    enforceEditorConsistency();

    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
    expect(state.editor.equipment.weapons.mainhand2).toBe("axe");
    expect(state.editor.equipment.weapons.offhand2).toBe("warhorn");
  });

  test("weapons survive when catalog is missing during enforceConsistency", async () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.profession = "Warrior";
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.mainhand2 = "axe";

    const serialized = serializeEditorToBuild();
    await loadBuildIntoEditor(serialized, { captureBaseline: false });

    // Catalog is null (simulates race condition or load failure)
    state.activeCatalog = null;
    enforceEditorConsistency();

    // Weapons should survive because enforceEditorConsistency returns early
    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
    expect(state.editor.equipment.weapons.mainhand2).toBe("axe");
  });

  test("weapons survive when catalog has empty professionWeapons during enforceConsistency", async () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.profession = "Warrior";
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.mainhand2 = "axe";

    const serialized = serializeEditorToBuild();
    await loadBuildIntoEditor(serialized, { captureBaseline: false });

    // Catalog loaded but professionWeapons is empty (incomplete catalog)
    state.activeCatalog = normalizeCatalog({
      specializations: [{ id: 4, name: "Strength", elite: false }],
      traits: [],
      skills: [],
      weaponSkills: [],
      legends: [],
      pets: [],
      professionWeapons: {},
    });
    enforceEditorConsistency();

    // Weapons should NOT be cleared — we can't validate without weapon data
    expect(state.editor.equipment.weapons.mainhand1).toBe("greatsword");
    expect(state.editor.equipment.weapons.mainhand2).toBe("axe");
  });
});

describe("enforceEditorConsistency — offhand infusion cleared when mainhand is two-handed (issue #226)", () => {
  test("clears offhand1 infusion when mainhand1 has a TwoHand weapon", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.offhand1 = ""; // locked by TwoHand
    state.editor.equipment.infusions.mainhand1 = ["", ""];
    state.editor.equipment.infusions.offhand1 = ["49431"]; // ghost infusion

    enforceEditorConsistency();

    expect(state.editor.equipment.infusions.offhand1).toEqual([""]);
  });

  test("clears offhand2 infusion when mainhand2 has a TwoHand weapon", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand2 = "hammer";
    state.editor.equipment.weapons.offhand2 = ""; // locked by TwoHand
    state.editor.equipment.infusions.mainhand2 = ["", ""];
    state.editor.equipment.infusions.offhand2 = ["49431"]; // ghost infusion

    enforceEditorConsistency();

    expect(state.editor.equipment.infusions.offhand2).toEqual([""]);
  });

  test("preserves offhand1 infusion when mainhand1 is one-handed", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "sword";
    state.editor.equipment.weapons.offhand1 = "axe";
    state.editor.equipment.infusions.offhand1 = ["49431"];

    enforceEditorConsistency();

    expect(state.editor.equipment.infusions.offhand1).toEqual(["49431"]);
  });

  test("clears offhand sigil when mainhand has a TwoHand weapon", () => {
    state.activeCatalog = makeWarriorCatalog();
    state.editor.equipment.weapons.mainhand1 = "greatsword";
    state.editor.equipment.weapons.offhand1 = "";
    state.editor.equipment.sigils.offhand1 = ["12345"]; // ghost sigil

    enforceEditorConsistency();

    expect(state.editor.equipment.sigils.offhand1).toEqual([""]);
  });
});
