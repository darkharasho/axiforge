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

function makeMockUpgradeCatalog() {
  return {
    runeById: new Map([[24836, { id: 24836, name: "Superior Rune of the Scholar", icon: "scholar.png" }]]),
    sigilById: new Map([[24615, { id: 24615, name: "Superior Sigil of Force", icon: "force.png" }]]),
    infusionById: new Map([[43254, { id: 43254, name: "+9 Agony Infusion", icon: "agony.png" }]]),
    enrichmentById: new Map([[87417, { id: 87417, name: "Mist Attunement Enrichment", icon: "mist.png" }]]),
    foodById: new Map([[91805, { id: 91805, name: "Bowl of Soup", icon: "soup.png" }]]),
    utilityById: new Map([[67528, { id: 67528, name: "Superior Sharpening Stone", icon: "stone.png" }]]),
  };
}

describe("serializeForPublish", () => {
  test("includes all base build fields", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.title).toBe("Power Reaper");
    expect(result.profession).toBe("Necromancer");
    expect(result.skills.heal.name).toBe("Well of Blood");
  });

  test("adds weaponSkills for equipped weapons", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.weaponSkills).toBeDefined();
    expect(result.weaponSkills.set1).toHaveLength(5);
    expect(result.weaponSkills.set1[0].name).toBe("Dusk Strike");
  });

  test("adds professionMechanics (F-skills)", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.professionMechanics).toBeDefined();
    expect(Array.isArray(result.professionMechanics)).toBe(true);
  });

  test("adds professionIcon SVG string", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(typeof result.professionIcon).toBe("string");
  });

  test("handles missing weapons gracefully", () => {
    const build = makeMockBuild();
    build.equipment.weapons = {};
    const result = serializeForPublish(build, makeMockCatalog(), null);
    expect(result.weaponSkills.set1).toEqual([]);
    expect(result.weaponSkills.set2).toEqual([]);
  });

  test("handles null catalog gracefully", () => {
    const result = serializeForPublish(makeMockBuild(), null, null);
    expect(result.weaponSkills).toBeDefined();
    expect(result.professionMechanics).toBeDefined();
  });

  test("resolves rune IDs to names and icons", () => {
    const build = makeMockBuild();
    build.equipment.runes = { head: "24836" };
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.runes.head).toEqual({
      id: 24836,
      name: "Superior Rune of the Scholar",
      icon: "scholar.png",
    });
  });

  test("resolves sigil IDs in arrays", () => {
    const build = makeMockBuild();
    build.equipment.sigils = { mainhand1: ["24615"] };
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.sigils.mainhand1).toEqual([
      { id: 24615, name: "Superior Sigil of Force", icon: "force.png" },
    ]);
  });

  test("resolves infusion IDs", () => {
    const build = makeMockBuild();
    build.equipment.infusions = { head: "43254" };
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.infusions.head).toEqual({
      id: 43254,
      name: "+9 Agony Infusion",
      icon: "agony.png",
    });
  });

  test("resolves consumable IDs (food, utility, enrichment)", () => {
    const build = makeMockBuild();
    build.equipment.food = "91805";
    build.equipment.utility = "67528";
    build.equipment.enrichment = "87417";
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.food).toEqual({ id: 91805, name: "Bowl of Soup", icon: "soup.png" });
    expect(result.equipmentDisplay.utility).toEqual({ id: 67528, name: "Superior Sharpening Stone", icon: "stone.png" });
    expect(result.equipmentDisplay.enrichment).toEqual({ id: 87417, name: "Mist Attunement Enrichment", icon: "mist.png" });
  });

  test("handles missing upgrade catalog gracefully", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.equipmentDisplay).toEqual({});
  });

  test("handles unknown IDs gracefully", () => {
    const build = makeMockBuild();
    build.equipment.runes = { head: "99999" };
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.runes.head).toBeNull();
  });
});
