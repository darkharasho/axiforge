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

/** Elementalist-style catalog with attunement weapon skills */
function makeMockElementalistCatalog() {
  return {
    professionWeapons: {
      Scepter: {
        flags: ["Mainhand"],
        skills: [
          // Fire attunement skills
          { id: 101, slot: "Weapon_1", attunement: "Fire" },
          { id: 102, slot: "Weapon_2", attunement: "Fire" },
          { id: 103, slot: "Weapon_3", attunement: "Fire" },
          // Water attunement skills
          { id: 201, slot: "Weapon_1", attunement: "Water" },
          { id: 202, slot: "Weapon_2", attunement: "Water" },
          { id: 203, slot: "Weapon_3", attunement: "Water" },
          // Air attunement skills
          { id: 301, slot: "Weapon_1", attunement: "Air" },
          { id: 302, slot: "Weapon_2", attunement: "Air" },
          { id: 303, slot: "Weapon_3", attunement: "Air" },
          // Earth attunement skills
          { id: 401, slot: "Weapon_1", attunement: "Earth" },
          { id: 402, slot: "Weapon_2", attunement: "Earth" },
          { id: 403, slot: "Weapon_3", attunement: "Earth" },
        ],
      },
    },
    weaponSkills: [
      { id: 101, name: "Fire Auto", icon: "f1.png", slot: "Weapon_1", attunement: "Fire" },
      { id: 102, name: "Fire 2", icon: "f2.png", slot: "Weapon_2", attunement: "Fire" },
      { id: 103, name: "Fire 3", icon: "f3.png", slot: "Weapon_3", attunement: "Fire" },
      { id: 201, name: "Water Auto", icon: "w1.png", slot: "Weapon_1", attunement: "Water" },
      { id: 202, name: "Water 2", icon: "w2.png", slot: "Weapon_2", attunement: "Water" },
      { id: 203, name: "Water 3", icon: "w3.png", slot: "Weapon_3", attunement: "Water" },
      { id: 301, name: "Air Auto", icon: "a1.png", slot: "Weapon_1", attunement: "Air" },
      { id: 302, name: "Air 2", icon: "a2.png", slot: "Weapon_2", attunement: "Air" },
      { id: 303, name: "Air 3", icon: "a3.png", slot: "Weapon_3", attunement: "Air" },
      { id: 401, name: "Earth Auto", icon: "e1.png", slot: "Weapon_1", attunement: "Earth" },
      { id: 402, name: "Earth 2", icon: "e2.png", slot: "Weapon_2", attunement: "Earth" },
      { id: 403, name: "Earth 3", icon: "e3.png", slot: "Weapon_3", attunement: "Earth" },
    ],
    skills: [
      // F-skill for Fire (no spec lock)
      { id: 501, name: "Conjure Flame Axe", icon: "cfa.png", slot: "Profession_1", inProfessionEndpoint: true, attunement: "Fire", specialization: 0 },
      // F-skill for Water (no spec lock)
      { id: 502, name: "Cleansing Wave", icon: "cw.png", slot: "Profession_1", inProfessionEndpoint: true, attunement: "Water", specialization: 0 },
      // F-skill locked to Weaver (spec 68) — only included when Weaver is selected
      { id: 601, name: "Weaver Fire", icon: "wf.png", slot: "Profession_2", inProfessionEndpoint: true, attunement: "Fire", specialization: 68 },
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

  // --- New structured output shape tests ---

  test("non-Elementalist: landSkills and waterSkills are present, attunementSkills is null", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);

    expect(result.landSkills).toBeDefined();
    expect(result.waterSkills).toBeDefined();
    expect(result.activeAttunement).toBe("");

    // attunementSkills null for non-attunement professions
    expect(result.landSkills.attunementSkills).toBeNull();
    expect(result.waterSkills.attunementSkills).toBeNull();

    // landSkills.weaponSkills should match the flat set1/set2
    expect(result.landSkills.weaponSkills.set1).toEqual(result.weaponSkills.set1);
    expect(result.landSkills.weaponSkills.set2).toEqual(result.weaponSkills.set2);

    // landSkills.professionMechanics should match the flat array
    expect(result.landSkills.professionMechanics).toEqual(result.professionMechanics);
  });

  test("Elementalist: landSkills.attunementSkills groups weapon skills by attunement", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Elementalist",
      specializations: [{ id: 31, name: "Fire", elite: false }],
      equipment: {
        ...makeMockBuild().equipment,
        weapons: { mainhand1: "Scepter", offhand1: "" },
      },
    };
    const result = serializeForPublish(build, makeMockElementalistCatalog(), null);

    expect(result.activeAttunement).toBe("Fire");
    expect(result.landSkills.attunementSkills).not.toBeNull();

    const fireSkills = result.landSkills.attunementSkills.Fire.set1;
    expect(fireSkills).toHaveLength(3);
    expect(fireSkills.map(s => s.name)).toEqual(["Fire Auto", "Fire 2", "Fire 3"]);

    const waterSkills = result.landSkills.attunementSkills.Water.set1;
    expect(waterSkills).toHaveLength(3);
    expect(waterSkills.map(s => s.name)).toEqual(["Water Auto", "Water 2", "Water 3"]);

    const airSkills = result.landSkills.attunementSkills.Air.set1;
    expect(airSkills).toHaveLength(3);
    expect(airSkills[0].name).toBe("Air Auto");

    const earthSkills = result.landSkills.attunementSkills.Earth.set1;
    expect(earthSkills).toHaveLength(3);
    expect(earthSkills[0].name).toBe("Earth Auto");
  });

  test("Elementalist: activeAttunement can be overridden by build.activeAttunement", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Elementalist",
      specializations: [{ id: 31, name: "Fire", elite: false }],
      equipment: {
        ...makeMockBuild().equipment,
        weapons: { mainhand1: "Scepter", offhand1: "" },
      },
      activeAttunement: "Water",
    };
    const result = serializeForPublish(build, makeMockElementalistCatalog(), null);

    expect(result.activeAttunement).toBe("Water");
    // landSkills.weaponSkills should reflect Water attunement
    expect(result.landSkills.weaponSkills.set1.map(s => s.name)).toEqual(["Water Auto", "Water 2", "Water 3"]);
  });

  test("F-skill filtering: excludes skills locked to an unselected specialization", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Elementalist",
      // spec 31 is selected, spec 68 (Weaver) is NOT
      specializations: [{ id: 31, name: "Fire", elite: false }],
      equipment: {
        ...makeMockBuild().equipment,
        weapons: { mainhand1: "Scepter", offhand1: "" },
      },
    };
    const result = serializeForPublish(build, makeMockElementalistCatalog(), null);

    // filteredMechanics (backward compat) should not include the Weaver skill
    const mechIds = result.professionMechanics.map(s => s.id);
    expect(mechIds).not.toContain(601); // Weaver-locked skill excluded
    expect(mechIds).toContain(501); // Fire mechanic included
    expect(mechIds).toContain(502); // Water mechanic included
  });

  test("F-skill filtering: includes skills locked to a selected specialization", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Elementalist",
      // Weaver (68) IS selected
      specializations: [{ id: 31, name: "Fire", elite: false }, { id: 68, name: "Weaver", elite: true }],
      equipment: {
        ...makeMockBuild().equipment,
        weapons: { mainhand1: "Scepter", offhand1: "" },
      },
    };
    const result = serializeForPublish(build, makeMockElementalistCatalog(), null);

    const mechIds = result.professionMechanics.map(s => s.id);
    expect(mechIds).toContain(601); // Weaver-locked skill now included
    expect(mechIds).toContain(501);
  });

  test("Elementalist: F-skills grouped by attunement in attunementSkills", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Elementalist",
      specializations: [{ id: 31, name: "Fire", elite: false }],
      equipment: {
        ...makeMockBuild().equipment,
        weapons: { mainhand1: "Scepter", offhand1: "" },
      },
    };
    const result = serializeForPublish(build, makeMockElementalistCatalog(), null);

    const fireMechanics = result.landSkills.attunementSkills.Fire.professionMechanics;
    expect(fireMechanics.map(s => s.id)).toContain(501);
    expect(fireMechanics.map(s => s.id)).not.toContain(502); // Water mechanic not in Fire

    const waterMechanics = result.landSkills.attunementSkills.Water.professionMechanics;
    expect(waterMechanics.map(s => s.id)).toContain(502);
    expect(waterMechanics.map(s => s.id)).not.toContain(501); // Fire mechanic not in Water
  });

  // --- Equipment icons ---

  test("equipmentIcons: armor slots use profession weight (Necromancer = light)", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.equipmentIcons).toBeDefined();
    // Necromancer is light armor
    expect(result.equipmentIcons.head).toContain("1634576");
    expect(result.equipmentIcons.chest).toContain("1634574");
  });

  test("equipmentIcons: weapon slots resolve from weapon name", () => {
    const build = makeMockBuild();
    build.equipment.weapons = { mainhand1: "Greatsword", offhand1: "", mainhand2: "Dagger", offhand2: "Focus" };
    const result = serializeForPublish(build, makeMockCatalog(), null);
    expect(result.equipmentIcons.mainhand1).toContain("Bandit_Sunderer");
    expect(result.equipmentIcons.mainhand2).toContain("Bandit_Shiv");
    expect(result.equipmentIcons.offhand2).toContain("Bandit_Focus");
  });

  test("equipmentIcons: empty weapon slot returns empty string", () => {
    const build = makeMockBuild();
    build.equipment.weapons = {};
    const result = serializeForPublish(build, makeMockCatalog(), null);
    expect(result.equipmentIcons.mainhand1).toBe("");
  });

  test("equipmentIcons: trinket slots are always present", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.equipmentIcons.amulet).toContain("render.guildwars2.com");
    expect(result.equipmentIcons.ring1).toContain("render.guildwars2.com");
    expect(result.equipmentIcons.back).toContain("render.guildwars2.com");
  });

  test("equipmentIcons: unknown profession falls back to medium armor icons", () => {
    const build = makeMockBuild();
    build.profession = "UnknownProf";
    const result = serializeForPublish(build, makeMockCatalog(), null);
    // medium head icon contains 1634588
    expect(result.equipmentIcons.head).toContain("1634588");
  });

  // --- Computed stats ---

  test("computedStats is present on serialized build", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.computedStats).toBeDefined();
    expect(typeof result.computedStats).toBe("object");
  });

  test("statModifiers is an array", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(Array.isArray(result.statModifiers)).toBe(true);
  });

  test("computedStats includes derived fields (CritChance, Health, etc.)", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog(), null);
    expect(result.computedStats).toHaveProperty("CritChance");
    expect(result.computedStats).toHaveProperty("Health");
    expect(result.computedStats).toHaveProperty("CritDamage");
    expect(result.computedStats).toHaveProperty("BoonDuration");
    expect(result.computedStats).toHaveProperty("ConditionDuration");
  });

  test("waterSkills contains aquatic weapon sets and excludes NoUnderwater mechanics", () => {
    const catalog = makeMockCatalog();
    // Add a NoUnderwater mechanic
    catalog.skills.push({
      id: 20000, name: "Shroud Skill", icon: "sh.png", slot: "Profession_2",
      inProfessionEndpoint: true, flags: ["NoUnderwater"],
    });
    const result = serializeForPublish(makeMockBuild(), catalog, null);

    expect(result.waterSkills.weaponSkills.aquatic1).toBeDefined();
    expect(result.waterSkills.weaponSkills.aquatic2).toBeDefined();
    // NoUnderwater skill should be excluded from waterSkills mechanics
    const waterMechIds = result.waterSkills.professionMechanics.map(s => s.id);
    expect(waterMechIds).not.toContain(20000);
  });
});
