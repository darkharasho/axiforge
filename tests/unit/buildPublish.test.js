"use strict";

const { serializeForPublish, loadCrossProfessionCatalogs } = require("../../src/main/buildPublish");

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
    infusionById: new Map([[43254, {
      id: 43254, name: "+9 Agony Infusion", icon: "agony.png",
      infixUpgrade: { attributes: [{ attribute: "Precision", modifier: 5 }] },
    }]]),
    enrichmentById: new Map([[87417, {
      id: 87417, name: "Mist Attunement Enrichment", icon: "mist.png",
      infixUpgrade: { attributes: [{ attribute: "Vitality", modifier: 15 }] },
    }]]),
    foodById: new Map([[91805, { id: 91805, name: "Bowl of Soup", icon: "soup.png" }]]),
    utilityById: new Map([[67528, { id: 67528, name: "Superior Sharpening Stone", icon: "stone.png" }]]),
    relicByName: new Map([["Relic of the Thief", {
      name: "Relic of the Thief", icon: "thief-relic.png",
      description: "Steal health on hit.",
      facts: [{ type: "Recharge", text: "Cooldown", value: 10 }],
    }]]),
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
      infixUpgrade: { attributes: [{ attribute: "Precision", modifier: 5 }] },
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
    expect(result.equipmentDisplay.enrichment).toEqual({
      id: 87417, name: "Mist Attunement Enrichment", icon: "mist.png",
      infixUpgrade: { attributes: [{ attribute: "Vitality", modifier: 15 }] },
    });
  });

  test("resolveEquipmentDisplay preserves infixUpgrade for infusions", () => {
    const build = makeMockBuild();
    build.equipment.infusions = { head: "43254" };
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.infusions.head.infixUpgrade).toEqual({
      attributes: [{ attribute: "Precision", modifier: 5 }],
    });
  });

  test("resolveEquipmentDisplay preserves infixUpgrade for enrichments", () => {
    const build = makeMockBuild();
    build.equipment.enrichment = "87417";
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.enrichment.infixUpgrade).toEqual({
      attributes: [{ attribute: "Vitality", modifier: 15 }],
    });
  });

  test("resolves relic name to display object with description and facts", () => {
    const build = makeMockBuild();
    build.equipment.relic = "Relic of the Thief";
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.relic).toEqual({
      name: "Relic of the Thief",
      icon: "thief-relic.png",
      description: "Steal health on hit.",
      facts: [{ type: "Recharge", text: "Cooldown", value: 10 }],
    });
  });

  test("resolves unknown relic name to minimal display object", () => {
    const build = makeMockBuild();
    build.equipment.relic = "Relic of the Unknown";
    const result = serializeForPublish(build, makeMockCatalog(), makeMockUpgradeCatalog());
    expect(result.equipmentDisplay.relic).toEqual({ name: "Relic of the Unknown", icon: "" });
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

  test("petDisplay includes pet skills array for Ranger builds", () => {
    const build = {
      ...makeMockBuild(),
      profession: "Ranger",
      selectedPets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 0, aquatic2: 0 },
    };
    const catalog = {
      ...makeMockCatalog(),
      pets: [
        { id: 1, name: "Juvenile Black Bear", icon: "bear.png", type: "terrestrial",
          skills: [{ id: 12478, name: "Bite", description: "Bite foe", icon: "bite.png" }] },
        { id: 5, name: "Juvenile Hyena", icon: "hyena.png", type: "terrestrial",
          skills: [{ id: 12461, name: "Howl", description: "Howl at foe", icon: "howl.png" }] },
      ],
    };
    const result = serializeForPublish(build, catalog, null);
    expect(result.petDisplay).toHaveLength(2);
    // Each pet in petDisplay must include its skills array
    expect(result.petDisplay[0].skills).toBeDefined();
    expect(result.petDisplay[0].skills).toHaveLength(1);
    expect(result.petDisplay[0].skills[0].id).toBe(12478);
    expect(result.petDisplay[1].skills).toBeDefined();
    expect(result.petDisplay[1].skills[0].id).toBe(12461);
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

// ── _traitChoices resolution and spec enrichment ────────────────────────────

describe("serializeForPublish — axicode _traitChoices resolution", () => {
  function makeAxicodeImportBuild() {
    return {
      ...makeMockBuild(),
      specializations: [
        { id: 42, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 2] },
        { id: 46, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [1, 1, 3] },
        { id: 62, name: "Firebrand", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 1] },
      ],
    };
  }

  function makeGuardianCatalog() {
    const catalog = makeMockCatalog();
    catalog.specializations = [
      { id: 42, name: "Zeal", elite: false, icon: "zeal.png", background: "zeal-bg.png",
        majorTraits: [634, 628, 653, 637, 643, 2017, 635, 648, 1925],
        minorTraits: [640, 641, 642] },
      { id: 46, name: "Virtues", elite: false, icon: "virtues.png", background: "virtues-bg.png",
        majorTraits: [624, 625, 617, 610, 621, 603, 622, 554, 612],
        minorTraits: [613, 614, 615] },
      { id: 62, name: "Firebrand", elite: true, icon: "fb.png", background: "fb-bg.png",
        majorTraits: [2075, 2101, 2086, 2063, 2076, 2116, 2105, 2179, 2159],
        minorTraits: [2070, 2071, 2072] },
    ];
    // Traits with tier info
    const traits = [
      // Zeal traits
      { id: 634, tier: 1 }, { id: 628, tier: 1 }, { id: 653, tier: 1 },
      { id: 637, tier: 2 }, { id: 643, tier: 2 }, { id: 2017, tier: 2 },
      { id: 635, tier: 3 }, { id: 648, tier: 3 }, { id: 1925, tier: 3 },
      // Virtues traits
      { id: 624, tier: 1 }, { id: 625, tier: 1 }, { id: 617, tier: 1 },
      { id: 610, tier: 2 }, { id: 621, tier: 2 }, { id: 603, tier: 2 },
      { id: 622, tier: 3 }, { id: 554, tier: 3 }, { id: 612, tier: 3 },
      // Firebrand traits
      { id: 2075, tier: 1 }, { id: 2101, tier: 1 }, { id: 2086, tier: 1 },
      { id: 2063, tier: 2 }, { id: 2076, tier: 2 }, { id: 2116, tier: 2 },
      { id: 2105, tier: 3 }, { id: 2179, tier: 3 }, { id: 2159, tier: 3 },
      // Minor traits
      { id: 640, tier: 1 }, { id: 641, tier: 2 }, { id: 642, tier: 3 },
      { id: 613, tier: 1 }, { id: 614, tier: 2 }, { id: 615, tier: 3 },
      { id: 2070, tier: 1 }, { id: 2071, tier: 2 }, { id: 2072, tier: 3 },
    ];
    catalog.traits = traits;
    return catalog;
  }

  test("resolves _traitChoices to actual majorChoices trait IDs", () => {
    const build = makeAxicodeImportBuild();
    const catalog = makeGuardianCatalog();
    const result = serializeForPublish(build, catalog, null);

    // Zeal: [2,2,2] → 2nd trait per tier
    expect(result.specializations[0].majorChoices[1]).toBe(628);
    expect(result.specializations[0].majorChoices[2]).toBe(643);
    expect(result.specializations[0].majorChoices[3]).toBe(648);

    // Virtues: [1,1,3] → 1st, 1st, 3rd
    expect(result.specializations[1].majorChoices[1]).toBe(624);
    expect(result.specializations[1].majorChoices[2]).toBe(610);
    expect(result.specializations[1].majorChoices[3]).toBe(612);

    // Firebrand: [2,2,1] → 2nd, 2nd, 1st
    expect(result.specializations[2].majorChoices[1]).toBe(2101);
    expect(result.specializations[2].majorChoices[2]).toBe(2076);
    expect(result.specializations[2].majorChoices[3]).toBe(2105);
  });

  test("enriches spec name, elite, icon, background from catalog", () => {
    const build = makeAxicodeImportBuild();
    // Remove name/elite from non-elite specs to simulate raw axicode
    build.specializations[0] = { id: 42, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 2] };
    build.specializations[1] = { id: 46, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [1, 1, 3] };

    const catalog = makeGuardianCatalog();
    const result = serializeForPublish(build, catalog, null);

    expect(result.specializations[0].name).toBe("Zeal");
    expect(result.specializations[0].elite).toBe(false);
    expect(result.specializations[0].icon).toBe("zeal.png");
    expect(result.specializations[0].background).toBe("zeal-bg.png");

    expect(result.specializations[2].name).toBe("Firebrand");
    expect(result.specializations[2].elite).toBe(true);
  });

  test("does not override existing majorChoices with _traitChoices", () => {
    const build = makeAxicodeImportBuild();
    // Give the first spec real majorChoices
    build.specializations[0].majorChoices = { 1: 653, 2: 637, 3: 1925 };

    const catalog = makeGuardianCatalog();
    const result = serializeForPublish(build, catalog, null);

    // Real majorChoices should be preserved
    expect(result.specializations[0].majorChoices[1]).toBe(653);
    expect(result.specializations[0].majorChoices[2]).toBe(637);
    expect(result.specializations[0].majorChoices[3]).toBe(1925);
  });

  test("resolves raw traitChoices (without underscore) from old axicode saves", () => {
    const build = {
      ...makeMockBuild(),
      specializations: [
        { id: 42, traitChoices: [2, 2, 2] },
        { id: 46, traitChoices: [1, 1, 3] },
        { id: 62, traitChoices: [2, 2, 1] },
      ],
    };

    const catalog = makeGuardianCatalog();
    const result = serializeForPublish(build, catalog, null);

    // Should resolve traitChoices just like _traitChoices
    expect(result.specializations[0].majorChoices[1]).toBe(628);
    expect(result.specializations[0].majorChoices[2]).toBe(643);
    expect(result.specializations[0].majorChoices[3]).toBe(648);

    expect(result.specializations[2].majorChoices[1]).toBe(2101);
    expect(result.specializations[2].majorChoices[2]).toBe(2076);
    expect(result.specializations[2].majorChoices[3]).toBe(2105);
  });
});

describe("serializeForPublish — cross-profession notes mentions", () => {
  // A Guardian trait (Shattered Aegis = 637) referenced from a Reaper build's
  // notes. Without extra catalogs, the SPA can't resolve the icon/tooltip.
  const guardianCatalog = {
    professionWeapons: {},
    weaponSkills: [],
    skills: [{ id: 9145, name: "Shield of Wrath", icon: "sow.png" }],
    traits: [{ id: 637, name: "Shattered Aegis", icon: "sa.png" }],
    legends: [],
    pets: [],
    specializations: [],
  };

  test("emits empty catalogNotesTraits/Skills when notes have no cross-profession mentions", () => {
    const build = { ...makeMockBuild(), notes: "no mentions here" };
    const result = serializeForPublish(build, makeMockCatalog(), null, [guardianCatalog]);
    expect(result.catalogNotesTraits).toEqual([]);
    expect(result.catalogNotesSkills).toEqual([]);
  });

  test("does not duplicate a trait already present in own catalog", () => {
    const ownCatalog = { ...makeMockCatalog(), traits: [{ id: 637, name: "Already Here", icon: "x.png" }] };
    const build = { ...makeMockBuild(), notes: "see @[trait:637:Shattered Aegis] for details" };
    const result = serializeForPublish(build, ownCatalog, null, [guardianCatalog]);
    expect(result.catalogNotesTraits).toEqual([]);
  });

  test("resolves a foreign trait id from extraCatalogs into catalogNotesTraits", () => {
    const build = { ...makeMockBuild(), notes: "watch out for @[trait:637:Shattered Aegis]" };
    const result = serializeForPublish(build, makeMockCatalog(), null, [guardianCatalog]);
    expect(result.catalogNotesTraits).toEqual([
      { id: 637, name: "Shattered Aegis", icon: "sa.png" },
    ]);
  });

  test("resolves a foreign skill id from extraCatalogs into catalogNotesSkills", () => {
    const build = { ...makeMockBuild(), notes: "they may use @[skill:9145:Shield of Wrath] here" };
    const result = serializeForPublish(build, makeMockCatalog(), null, [guardianCatalog]);
    expect(result.catalogNotesSkills).toEqual([
      { id: 9145, name: "Shield of Wrath", icon: "sow.png" },
    ]);
  });

  test("ignores trait ids that aren't found in any catalog", () => {
    const build = { ...makeMockBuild(), notes: "what is @[trait:999999:Unknown]" };
    const result = serializeForPublish(build, makeMockCatalog(), null, [guardianCatalog]);
    expect(result.catalogNotesTraits).toEqual([]);
  });
});

describe("loadCrossProfessionCatalogs", () => {
  test("returns [] for notes with no trait/skill mentions (skips fetches)", async () => {
    const fetcher = jest.fn();
    const result = await loadCrossProfessionCatalogs("just text", "Necromancer", fetcher);
    expect(result).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("loads the 8 other profession catalogs when notes contain @[trait:]", async () => {
    const fetcher = jest.fn().mockImplementation((p) => Promise.resolve({ profession: p }));
    const result = await loadCrossProfessionCatalogs(
      "see @[trait:637:Shattered Aegis]",
      "Necromancer",
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(fetcher.mock.calls.map((c) => c[0])).not.toContain("Necromancer");
    expect(result).toHaveLength(8);
  });

  test("tolerates failed catalog loads and returns the rest", async () => {
    const fetcher = jest.fn().mockImplementation((p) =>
      p === "Guardian" ? Promise.reject(new Error("network")) : Promise.resolve({ profession: p })
    );
    const result = await loadCrossProfessionCatalogs(
      "see @[skill:9145:Shield of Wrath]",
      "Necromancer",
      fetcher,
    );
    expect(result).toHaveLength(7);
    expect(result.map((c) => c.profession)).not.toContain("Guardian");
  });
});
