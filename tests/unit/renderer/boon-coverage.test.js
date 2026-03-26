"use strict";

const { computeBoonCoverage } = require("../../../src/renderer/modules/boon-coverage");

function makeCatalog(overrides = {}) {
  return {
    skillById: overrides.skillById || new Map(),
    traitById: overrides.traitById || new Map(),
    weaponSkillById: overrides.weaponSkillById || new Map(),
    professionWeapons: overrides.professionWeapons || {},
    ...overrides,
  };
}

function makeEditor(overrides = {}) {
  return {
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
    specializations: [],
    equipment: { weapons: {} },
    underwaterMode: false,
    ...overrides,
  };
}

function makeSkill(id, name, facts = [], extra = {}) {
  return { id, name, description: "", facts, type: "Utility", ...extra };
}

function makeTrait(id, name, facts = [], extra = {}) {
  return { id, name, description: "", facts, ...extra };
}

function buffFact(status, duration = 0, applyCount = 0) {
  return { type: "Buff", status, duration, apply_count: applyCount };
}

describe("computeBoonCoverage", () => {
  test("returns empty arrays when no skills or traits have buff facts", () => {
    const catalog = makeCatalog();
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
    expect(result.conditions).toEqual([]);
  });

  test("extracts boon from a heal skill", () => {
    const skill = makeSkill(100, "Healing Breeze", [buffFact("Regeneration", 5)]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Regeneration");
    expect(result.boons[0].sources).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "Healing Breeze" });
  });

  test("extracts condition from a utility skill", () => {
    const skill = makeSkill(200, "Torch Throw", [buffFact("Burning", 3, 2)]);
    const catalog = makeCatalog({ skillById: new Map([[200, skill]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("Burning");
    expect(result.conditions[0].sources[0]).toMatchObject({ stacks: 2, duration: 3 });
  });

  test("normalizes condition name variants", () => {
    const skill = makeSkill(300, "Blind Throw", [buffFact("Blind", 4)]);
    const catalog = makeCatalog({ skillById: new Map([[300, skill]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [300, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].name).toBe("Blinded");
  });

  test("groups multiple sources for the same boon", () => {
    const s1 = makeSkill(100, "Skill A", [buffFact("Might", 6, 3)]);
    const s2 = makeSkill(200, "Skill B", [buffFact("Might", 8, 1)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
    expect(result.boons[0].sources).toHaveLength(2);
  });

  test("extracts boons from weapon skills passed as third argument", () => {
    const ws = makeSkill(400, "Sword Strike", [buffFact("Might", 4, 1)]);
    const catalog = makeCatalog();
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor, [ws, null, null, null, null]);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "Sword Strike" });
  });

  test("extracts boons from selected traits", () => {
    const trait = makeTrait(500, "Radiant Power", [buffFact("Fury", 3)]);
    const catalog = makeCatalog({ traitById: new Map([[500, trait]]) });
    const editor = makeEditor({
      specializations: [{ specializationId: 42, majorChoices: { 1: 500, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ type: "trait", name: "Radiant Power" });
  });

  test("extracts boons from minor traits (always active on equipped spec)", () => {
    const minorTrait = makeTrait(600, "Protector's Restoration", [buffFact("Protection", 3)]);
    const catalog = makeCatalog({
      traitById: new Map([[600, minorTrait]]),
      specializationById: new Map([[42, { minorTraits: [600] }]]),
    });
    const editor = makeEditor({
      specializations: [{ specializationId: 42, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Protection");
    expect(result.boons[0].sources[0]).toMatchObject({ type: "trait", name: "Protector's Restoration" });
  });

  test("follows flipSkill one level deep", () => {
    const flip = makeSkill(101, "Flip Skill", [buffFact("Might", 5, 2)]);
    const base = makeSkill(100, "Base Skill", [], { flipSkill: 101 });
    const catalog = makeCatalog({ skillById: new Map([[100, base], [101, flip]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0].name).toBe("Flip Skill");
  });

  test("does not follow flipSkill beyond one level", () => {
    const flip2 = makeSkill(102, "Double Flip", [buffFact("Fury", 3)]);
    const flip1 = makeSkill(101, "Flip Skill", [buffFact("Might", 5)], { flipSkill: 102 });
    const base = makeSkill(100, "Base Skill", [], { flipSkill: 101 });
    const catalog = makeCatalog({ skillById: new Map([[100, base], [101, flip1], [102, flip2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
  });

  test("marks ally-only boons when all sources have ally description", () => {
    const skill = makeSkill(100, "Grant Allies Might", [buffFact("Might", 5, 3)], {
      description: "Grant nearby allies might.",
    });
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].hasAllySource).toBe(true);
  });

  test("marks as ally when description mentions allies but not the specific boon name", () => {
    // Generic: "Grant boons to nearby allies." without naming Protection
    const trait = makeTrait(500, "Protective Ward", [buffFact("Protection", 3)], {
      description: "Grant boons to nearby allies.",
    });
    const catalog = makeCatalog({ traitById: new Map([[500, trait]]) });
    const editor = makeEditor({
      specializations: [{ specializationId: 42, majorChoices: { 1: 500, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].hasAllySource).toBe(true);
  });

  test("shows ally badge when any source targets allies, even if others are self", () => {
    const s1 = makeSkill(100, "Self Might", [buffFact("Might", 5)], { description: "Gain might." });
    const s2 = makeSkill(200, "Ally Might", [buffFact("Might", 5)], { description: "Grant allies might." });
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [200, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].hasAllySource).toBe(true);
  });

  test("per-fact ally detection: only marks the specific boon mentioned with allies", () => {
    // Simulates Tempestuous Aria: "Using a shout grants allies might. Granting an aura..."
    // Might should be ally, but Stability from same trait should NOT be ally
    const trait = makeTrait(500, "Tempestuous Aria", [
      buffFact("Might", 6, 3),
      buffFact("Stability", 3, 1),
    ], {
      description: "Using a shout grants allies might. Granting an aura to an ally increases your outgoing damage.",
    });
    const catalog = makeCatalog({ traitById: new Map([[500, trait]]) });
    const editor = makeEditor({
      specializations: [{ specializationId: 42, majorChoices: { 1: 500, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    const might = result.boons.find((b) => b.name === "Might");
    const stab = result.boons.find((b) => b.name === "Stability");
    expect(might).toBeDefined();
    expect(stab).toBeDefined();
    expect(might.hasAllySource).toBe(true);
    expect(stab.hasAllySource).toBe(false);
  });

  test("boons are sorted in GW2 display order", () => {
    const s1 = makeSkill(100, "S1", [buffFact("Vigor", 3)]);
    const s2 = makeSkill(200, "S2", [buffFact("Aegis", 3)]);
    const s3 = makeSkill(300, "S3", [buffFact("Might", 3)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2], [300, s3]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [100, 200, 300], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.map((b) => b.name)).toEqual(["Aegis", "Might", "Vigor"]);
  });

  test("conditions are sorted alphabetically", () => {
    const s1 = makeSkill(100, "S1", [buffFact("Vulnerability", 3)]);
    const s2 = makeSkill(200, "S2", [buffFact("Bleeding", 3)]);
    const catalog = makeCatalog({ skillById: new Map([[100, s1], [200, s2]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [100, 200, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.conditions.map((c) => c.name)).toEqual(["Bleeding", "Vulnerability"]);
  });

  test("includes icon URL from BOON_CONDITION_ICONS", () => {
    const skill = makeSkill(100, "Might Skill", [buffFact("Might", 5)]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons[0].icon).toContain("render.guildwars2.com");
  });

  test("ignores non-buff fact types", () => {
    const skill = makeSkill(100, "Damage Skill", [
      { type: "Damage", value: 500 },
      { type: "Duration", value: 10 },
    ]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
    expect(result.conditions).toEqual([]);
  });

  test("handles ApplyBuffCondition and PrefixedBuff fact types", () => {
    const skill = makeSkill(100, "Multi", [
      { type: "ApplyBuffCondition", status: "Burning", duration: 3, apply_count: 1 },
      { type: "PrefixedBuff", status: "Might", duration: 5, apply_count: 2 },
    ]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.conditions).toHaveLength(1);
  });

  test("extracts boons from profession mechanic skills (F1-F5)", () => {
    const mechSkill = makeSkill(600, "F1 Virtue", [buffFact("Aegis", 3)], {
      type: "Profession", slot: "Profession_1", specialization: 0,
    });
    const catalog = makeCatalog({
      skillById: new Map([[600, mechSkill]]),
      skills: [mechSkill],
    });
    const editor = makeEditor();
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Aegis");
    expect(result.boons[0].sources[0]).toMatchObject({ type: "skill", name: "F1 Virtue" });
  });

  test("skips profession mechanics requiring unselected elite spec", () => {
    const mechSkill = makeSkill(700, "Elite F1", [buffFact("Quickness", 5)], {
      type: "Profession", slot: "Profession_1", specialization: 27,
    });
    const catalog = makeCatalog({
      skillById: new Map([[700, mechSkill]]),
      skills: [mechSkill],
    });
    const editor = makeEditor({ specializations: [] });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toEqual([]);
  });

  test("handles missing or zero apply_count and duration gracefully", () => {
    const skill = makeSkill(100, "Passive Skill", [{ type: "Buff", status: "Might" }]);
    const catalog = makeCatalog({ skillById: new Map([[100, skill]]) });
    const editor = makeEditor({ skills: { healId: 100, utilityIds: [0, 0, 0], eliteId: 0 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].sources[0]).toMatchObject({ stacks: 0, duration: 0 });
  });

  test("extracts boons from serialized build format (skills.heal/utility/elite objects, spec.id)", () => {
    // Serialized builds use skills.heal/utility[]/elite (objects with .id) not healId/utilityIds/eliteId.
    // Specializations use .id not .specializationId.
    const swiftnessSkill = makeSkill(29965, "\"Advance!\"", [buffFact("Swiftness", 20)], {
      description: "Shout. Grant aegis and swiftness to up to five nearby allies.",
    });
    const catalog = makeCatalog({ skillById: new Map([[29965, swiftnessSkill]]) });
    const editor = {
      skills: {
        heal: null,
        utility: [{ id: 29965, name: "\"Advance!\"" }, null, null],
        elite: null,
      },
      specializations: [{ id: 62, name: "Firebrand", elite: true, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
      equipment: { weapons: {} },
      underwaterMode: false,
    };
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.some((b) => b.name === "Swiftness")).toBe(true);
  });

  test("extracts all 12 boons from Elixir of Ambition (skill 62655) via overridden facts", () => {
    // Elixir of Ambition grants all boons to self, but the GW2 API returns no buff facts.
    // The KNOWN_SKILL_FACTS_OVERRIDES override injects them at catalog build time.
    // Simulate the catalog already having the overridden facts applied.
    const { KNOWN_SKILL_FACTS_OVERRIDES } = require("../../../src/main/gw2Data/overrides");
    const overriddenFacts = KNOWN_SKILL_FACTS_OVERRIDES.get(62655);
    expect(overriddenFacts).toBeDefined();
    // The override must contain Buff facts for all 12 boons
    const buffFacts = overriddenFacts.filter((f) => f.type === "Buff" && f.status);
    const boonStatuses = buffFacts.map((f) => f.status);
    for (const boon of [
      "Might", "Fury", "Alacrity", "Aegis", "Quickness", "Protection",
      "Regeneration", "Resolution", "Resistance", "Stability", "Swiftness", "Vigor",
    ]) {
      expect(boonStatuses).toContain(boon);
    }
    // Might should have 25 stacks
    const mightFact = buffFacts.find((f) => f.status === "Might");
    expect(mightFact.apply_count).toBe(25);

    // Now verify computeBoonCoverage extracts them when the skill has those facts
    const elixir = makeSkill(62655, "Elixir of Ambition", overriddenFacts, {
      type: "Elite", slot: "Elite", specialization: 64,
      description: "Elixir. Infuse your boundless ambition into an elixir, gaining every possible boon.",
    });
    const catalog = makeCatalog({ skillById: new Map([[62655, elixir]]) });
    const editor = makeEditor({ skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 62655 } });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons).toHaveLength(12);
    const resultBoonNames = result.boons.map((b) => b.name);
    expect(resultBoonNames).toContain("Might");
    expect(resultBoonNames).toContain("Quickness");
    expect(resultBoonNames).toContain("Alacrity");
  });

  test("Twisted Medicine trait marks Elixir skill boons as ally-targeted", () => {
    const elixir = makeSkill(62655, "Elixir of Ambition", [
      buffFact("Might", 5, 25), buffFact("Fury", 5),
    ], { type: "Elite", slot: "Elite", specialization: 64, categories: ["Elixir"] });
    const catalog = makeCatalog({
      skillById: new Map([[62655, elixir]]),
      specializationById: new Map([[64, { minorTraits: [] }]]),
    });
    // Twisted Medicine = trait 2220, Harbinger tier 2
    const editor = makeEditor({
      skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 62655 },
      specializations: [{ specializationId: 64, majorChoices: { 1: 0, 2: 2220, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.find((b) => b.name === "Might").hasAllySource).toBe(true);
    expect(result.boons.find((b) => b.name === "Fury").hasAllySource).toBe(true);
  });

  test("without Twisted Medicine, Elixir boons are self-only", () => {
    const elixir = makeSkill(62655, "Elixir of Ambition", [
      buffFact("Might", 5, 25),
    ], { type: "Elite", slot: "Elite", specialization: 64, categories: ["Elixir"] });
    const catalog = makeCatalog({
      skillById: new Map([[62655, elixir]]),
      specializationById: new Map([[64, { minorTraits: [] }]]),
    });
    // No Twisted Medicine selected
    const editor = makeEditor({
      skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 62655 },
      specializations: [{ specializationId: 64, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.find((b) => b.name === "Might").hasAllySource).toBe(false);
  });

  test("Twisted Medicine does not affect non-Elixir skills", () => {
    const nonElixir = makeSkill(100, "Regular Skill", [buffFact("Might", 5)], {
      type: "Utility", categories: [],
    });
    const catalog = makeCatalog({
      skillById: new Map([[100, nonElixir]]),
      specializationById: new Map([[64, { minorTraits: [] }]]),
    });
    const editor = makeEditor({
      skills: { healId: 0, utilityIds: [100, 0, 0], eliteId: 0 },
      specializations: [{ specializationId: 64, majorChoices: { 1: 0, 2: 2220, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.find((b) => b.name === "Might").hasAllySource).toBe(false);
  });

  test("extracts boons from bundle skills of a profession mechanic (e.g. Firebrand tomes)", () => {
    const chapterSkill = makeSkill(201, "Chapter 3: Azure Sun", [buffFact("Swiftness", 5)], {
      type: "Weapon", slot: "Weapon_3", specialization: 62,
      description: "Grant boons to allies.",
    });
    const tomeSkill = makeSkill(200, "Tome of Resolve", [], {
      type: "Profession", slot: "Profession_2", specialization: 62,
      bundleSkills: [201],
    });
    const catalog = makeCatalog({
      skillById: new Map([[200, tomeSkill], [201, chapterSkill]]),
      skills: [tomeSkill],
    });
    const editor = makeEditor({
      specializations: [{ specializationId: 62, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    });
    const result = computeBoonCoverage(catalog, editor);
    expect(result.boons.some((b) => b.name === "Swiftness")).toBe(true);
    expect(result.boons.find((b) => b.name === "Swiftness").sources[0]).toMatchObject({
      type: "skill", name: "Chapter 3: Azure Sun",
    });
  });
});
