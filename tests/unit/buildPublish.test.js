"use strict";

const { serializeForPublish } = require("../../src/main/buildPublish");

function makeMockBuild() {
  return {
    title: "Power Reaper",
    profession: "Necromancer",
    specializations: [
      { id: 39, name: "Soul Reaping", elite: false, icon: "sr.png", background: "sr-bg.png",
        minorTraits: [{ id: 1, name: "Minor 1", icon: "m1.png", description: "desc" }],
        majorChoices: { 1: 100, 2: 200, 3: 300 },
        majorTraitsByTier: { 1: [{ id: 100, name: "T1", icon: "t1.png" }], 2: [], 3: [] } },
      { id: 34, name: "Spite", elite: false, icon: "sp.png", background: "sp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 34, name: "Reaper", elite: true, icon: "rp.png", background: "rp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    skills: {
      heal: { id: 10527, name: "Well of Blood", icon: "wob.png", description: "Heal" },
      utility: [{ id: 10532, name: "Well of Suffering", icon: "wos.png", description: "Utility" }],
      elite: { id: 10549, name: "Lich Form", icon: "lf.png", description: "Elite" },
    },
    equipment: {
      statPackage: "Berserker",
      weapons: { mainhand1: "Greatsword", offhand1: "", mainhand2: "Dagger", offhand2: "Focus" },
      runes: { head: "Scholar" }, sigils: { mainhand1: ["Force", "Impact"] },
      slots: {}, infusions: {}, relic: "Thief", food: "Soup", utility: "Stone", enrichment: "",
    },
    gameMode: "pve",
    tags: ["dps"],
    notes: "A test build",
    selectedLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };
}

function makeMockCatalog() {
  return {
    professionWeapons: {
      Greatsword: {
        flags: ["TwoHand", "Mainhand"],
        skills: [
          { id: 1, slot: "Weapon_1" }, { id: 2, slot: "Weapon_2" },
          { id: 3, slot: "Weapon_3" }, { id: 4, slot: "Weapon_4" }, { id: 5, slot: "Weapon_5" },
        ],
      },
    },
    weaponSkills: [
      { id: 1, name: "Dusk Strike", icon: "ds.png", description: "Auto", slot: "Weapon_1" },
      { id: 2, name: "Infusing Terror", icon: "it.png", description: "Skill 2", slot: "Weapon_2" },
      { id: 3, name: "Death Spiral", icon: "dsp.png", description: "Skill 3", slot: "Weapon_3" },
      { id: 4, name: "Nightfall", icon: "nf.png", description: "Skill 4", slot: "Weapon_4" },
      { id: 5, name: "Grasping Darkness", icon: "gd.png", description: "Skill 5", slot: "Weapon_5" },
    ],
    skills: [
      { id: 10574, name: "Death Shroud", icon: "ds-icon.png", description: "Enter DS", slot: "Profession_1", professions: ["Necromancer"], inProfessionEndpoint: true },
    ],
    legends: [],
    pets: [],
    specializations: [],
  };
}

describe("serializeForPublish", () => {
  test("includes all base build fields", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.title).toBe("Power Reaper");
    expect(result.profession).toBe("Necromancer");
    expect(result.skills.heal.name).toBe("Well of Blood");
  });

  test("adds weaponSkills for equipped weapons", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.weaponSkills).toBeDefined();
    expect(result.weaponSkills.set1).toHaveLength(5);
    expect(result.weaponSkills.set1[0].name).toBe("Dusk Strike");
  });

  test("adds professionMechanics (F-skills)", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.professionMechanics).toBeDefined();
    expect(Array.isArray(result.professionMechanics)).toBe(true);
  });

  test("adds professionIcon SVG string", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(typeof result.professionIcon).toBe("string");
  });

  test("handles missing weapons gracefully", () => {
    const build = makeMockBuild();
    build.equipment.weapons = {};
    const result = serializeForPublish(build, makeMockCatalog());
    expect(result.weaponSkills.set1).toEqual([]);
    expect(result.weaponSkills.set2).toEqual([]);
  });

  test("handles null catalog gracefully", () => {
    const result = serializeForPublish(makeMockBuild(), null);
    expect(result.weaponSkills).toBeDefined();
    expect(result.professionMechanics).toBeDefined();
  });
});
