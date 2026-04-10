"use strict";

const { setupHarness } = require("./harness");

describe("Warrior — end-to-end profession mechanics", () => {
  const h = setupHarness("Warrior");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Warrior profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Warrior");
    expect(catalog.skills.length).toBeGreaterThan(0);
    expect(catalog.specializationById.has(18)).toBe(true); // Berserker
    expect(catalog.specializationById.has(61)).toBe(true); // Spellbreaker
  });

  test("catalog contains core Warrior specializations", async () => {
    const catalog = await h.loadCatalog();
    // Core specs: Strength(4), Tactics(22), Discipline(51)
    expect(catalog.specializationById.has(4)).toBe(true);
    expect(catalog.specializationById.has(22)).toBe(true);
    expect(catalog.specializationById.has(51)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Skill options per spec
  // ---------------------------------------------------------------------------

  test("core Warrior has heal and elite options available", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal.length).toBeGreaterThan(0);
    expect(opts.elite.length).toBeGreaterThan(0);
    expect(opts.heal[0].id).toBe(14402); // Mending
  });

  test("Berserker spec does not expose spec-locked skills from Spellbreaker", async () => {
    const catalog = await h.loadCatalog();
    const berserkerOpts = h.skillOptions(catalog, 18);
    const spellbreakerOpts = h.skillOptions(catalog, 61);
    expect(berserkerOpts.heal).toEqual(spellbreakerOpts.heal);
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — core and Spellbreaker
  // ---------------------------------------------------------------------------

  test("core Warrior F1 burst matches equipped mainhand weapon", async () => {
    const catalog = await h.loadCatalog();
    // Sword equipped → Sword core burst (14367 Flurry)
    const swordSlots = h.resolveMechSlots(catalog, 0, { weapon: "Sword" });
    expect(swordSlots).toEqual(["14367"]);
    // Greatsword equipped → Greatsword core burst (14375 Arcing Slice)
    const gsSlots = h.resolveMechSlots(catalog, 0, { weapon: "Greatsword" });
    expect(gsSlots).toEqual(["14375"]);
  });

  test("core Warrior F1 is blank when no weapon is equipped", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveMechSlots(catalog, 0, { weapon: "" });
    expect(slots).toEqual(["empty"]);
  });

  test("Spellbreaker F1 shows Spellbreaker Sword burst", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveMechSlots(catalog, 61, { weapon: "Sword" });
    expect(slots).toEqual(["42494"]);
  });

  // ---------------------------------------------------------------------------
  // Berserker — Berserk toggle
  // ---------------------------------------------------------------------------

  test("Berserker shows F1 core burst + F2 Berserk toggle when Berserk is off", async () => {
    const catalog = await h.loadCatalog();
    // Sword equipped, Berserk not toggled (activeKit: 0)
    const slots = h.resolveMechSlots(catalog, 18, { weapon: "Sword", activeKit: 0 });
    // F1 = core sword burst (14367 Flurry), F2 = Berserk toggle (30185)
    expect(slots).toEqual(["14367", "30185"]);
  });

  test("Berserker shows F1 primal burst when Berserk is active", async () => {
    const catalog = await h.loadCatalog();
    // Sword equipped, Berserk toggled on (activeKit: 30185)
    const slots = h.resolveMechSlots(catalog, 18, { weapon: "Sword", activeKit: 30185 });
    // F1 = primal sword burst (30682 Flaming Flurry), F2 = Berserk toggle (30185)
    expect(slots).toEqual(["30682", "30185"]);
  });

  test("Berserker F1 is blank when no weapon is equipped (Berserk off)", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveMechSlots(catalog, 18, { weapon: "", activeKit: 0 });
    // F1 blank, F2 Berserk toggle still present
    expect(slots).toEqual(["empty", "30185"]);
  });

  test("Berserker F1 is blank when no weapon is equipped (Berserk on)", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveMechSlots(catalog, 18, { weapon: "", activeKit: 30185 });
    expect(slots).toEqual(["empty", "30185"]);
  });

  test("Berserker Greatsword primal burst shown when Berserk active", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveMechSlots(catalog, 18, { weapon: "Greatsword", activeKit: 30185 });
    expect(slots).toEqual(["29852", "30185"]);
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Sword Weapon_1 resolves correctly", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(14360);
  });

  test("Greatsword (TwoHand) Weapon_1 resolves correctly", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "greatsword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(14447);
  });

  test("Shield offhand Weapon_4 resolves correctly", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "shield", "");
    expect(slots[3]).not.toBeNull();
    expect(slots[3].id).toBe(14521);
  });

  test("Greatsword (TwoHand) ignores offhand slot", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "greatsword", "shield", "");
    // TwoHand weapon: offhand slots (4-5) should be null
    expect(slots[3]).toBeNull();
    expect(slots[4]).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Weapon skill traited_facts (#171)
  // ---------------------------------------------------------------------------

  test("weapon skills in catalog include traitedFacts from API data", async () => {
    const catalog = await h.loadCatalog();
    const swordW1 = catalog.weaponSkillById.get(14360); // Sever Artery
    expect(swordW1).toBeDefined();
    expect(swordW1.traitedFacts).toBeDefined();
    expect(swordW1.traitedFacts.length).toBeGreaterThan(0);
    expect(swordW1.traitedFacts[0].requires_trait).toBe(1444);
  });

  test("weapon skill base facts exclude requires_trait entries", async () => {
    const catalog = await h.loadCatalog();
    const swordW1 = catalog.weaponSkillById.get(14360); // Sever Artery
    // Base facts should not contain any entries with requires_trait
    const conditional = swordW1.facts.filter((f) => f.requires_trait);
    expect(conditional).toHaveLength(0);
  });
});
