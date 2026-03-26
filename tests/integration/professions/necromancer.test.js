"use strict";

/**
 * Necromancer integration tests — covers all four shroud variants:
 *   Core:       Death Shroud (10574)
 *   Reaper:     Reaper's Shroud (30792)
 *   Harbinger:  Harbinger's Shroud (62567)
 *   Ritualist:  Ritualist's Shroud (77238)
 *
 * GW2 wiki reference:
 *   Each elite spec replaces Death Shroud with a spec-specific variant that
 *   has unique weapon skills within the shroud.
 */

const { setupHarness } = require("./harness");

describe("Necromancer — end-to-end profession mechanics", () => {
  const h = setupHarness("Necromancer");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Necromancer profession data", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Necromancer");
    expect(catalog.skills.length).toBeGreaterThan(0);
  });

  test("catalog includes all Necromancer elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(34)).toBe(true); // Reaper
    expect(catalog.specializationById.has(64)).toBe(true); // Harbinger
    expect(catalog.specializationById.has(76)).toBe(true); // Ritualist
  });

  // ---------------------------------------------------------------------------
  // Skill options per spec
  // ---------------------------------------------------------------------------

  test("core Necromancer skill options include heal (Well of Blood) and elite (Lich Form)", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    const healIds = opts.heal.map((s) => s.id);
    const eliteIds = opts.elite.map((s) => s.id);
    expect(healIds).toContain(10533); // Well of Blood
    expect(eliteIds).toContain(10550); // Lich Form
  });

  test("Reaper-gated skills appear in options only when Reaper spec is active", async () => {
    const catalog = await h.loadCatalog();
    const reaperOpts = h.skillOptions(catalog, 34);
    const coreOpts   = h.skillOptions(catalog, 0);
    const reaperProfIds = reaperOpts.profession.map((s) => s.id);
    const coreProfIds   = coreOpts.profession.map((s) => s.id);
    expect(reaperProfIds).toContain(30792);    // Reaper's Shroud
    expect(coreProfIds).not.toContain(30792);  // Not visible without Reaper
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — all four shroud variants
  // ---------------------------------------------------------------------------

  test("core Necromancer F1 is Death Shroud (10574)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual(["10574"]);
  });

  test("Reaper (spec 34) F1 is Reaper's Shroud (30792), replacing Death Shroud", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 34)).toEqual(["30792"]);
  });

  test("Harbinger (spec 64) F1 is Harbinger's Shroud (62567)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 64)).toEqual(["62567"]);
  });

  test("Ritualist (spec 76) F1 is Ritualist's Shroud (77238)", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 76)).toEqual(["77238"]);
  });

  test("each elite shroud replaces core Death Shroud — all four are distinct", async () => {
    const catalog = await h.loadCatalog();
    const core      = h.resolveMechSlots(catalog, 0);
    const reaper    = h.resolveMechSlots(catalog, 34);
    const harbinger = h.resolveMechSlots(catalog, 64);
    const ritualist = h.resolveMechSlots(catalog, 76);
    expect(reaper).not.toEqual(core);
    expect(harbinger).not.toEqual(core);
    expect(ritualist).not.toEqual(core);
    expect(reaper).not.toEqual(harbinger);
    expect(reaper).not.toEqual(ritualist);
    expect(harbinger).not.toEqual(ritualist);
  });

  // ---------------------------------------------------------------------------
  // Shroud bundle skills — each shroud has its own weapon bar
  // ---------------------------------------------------------------------------

  test("Death Shroud (10574) bundle contains Life Blast, Dark Path, Doom, Life Transfer, Tainted Shackles", async () => {
    const catalog = await h.loadCatalog();
    const ds = catalog.skillById.get(10574);
    expect(ds).toBeTruthy();
    expect(ds.bundleSkills).toEqual([10554, 10604, 10588, 10594, 19504]);
  });

  test("Death Shroud bundle does not contain Exit skill End Death Shroud (10585)", async () => {
    const catalog = await h.loadCatalog();
    const ds = catalog.skillById.get(10574);
    expect(ds.bundleSkills).not.toContain(10585);
  });

  test("Reaper's Shroud (30792) bundle contains its unique weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const rs = catalog.skillById.get(30792);
    expect(rs).toBeTruthy();
    expect(Array.isArray(rs.bundleSkills)).toBe(true);
    expect(rs.bundleSkills.length).toBeGreaterThan(0);
    expect(rs.bundleSkills).toContain(29533); // Grasping Darkness
    expect(rs.bundleSkills).toContain(29719); // Executioner's Scythe
  });

  test("Reaper's Shroud bundle differs from Death Shroud bundle", async () => {
    const catalog = await h.loadCatalog();
    const ds = catalog.skillById.get(10574);
    const rs = catalog.skillById.get(30792);
    expect(rs.bundleSkills).not.toEqual(ds.bundleSkills);
  });

  test("Harbinger's Shroud (62567) has a bundle of its own weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const hs = catalog.skillById.get(62567);
    expect(hs).toBeTruthy();
    expect(Array.isArray(hs.bundleSkills)).toBe(true);
    expect(hs.bundleSkills.length).toBeGreaterThan(0);
    expect(hs.bundleSkills).toContain(62569); // Calamitous Bolt
  });

  test("Ritualist's Shroud (77238) has a bundle of its own weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const rs = catalog.skillById.get(77238);
    expect(rs).toBeTruthy();
    expect(Array.isArray(rs.bundleSkills)).toBe(true);
    expect(rs.bundleSkills.length).toBeGreaterThan(0);
    expect(rs.bundleSkills).toContain(77241); // Rift Bolt
  });

  test("Lich Form (10550) has a bundle of transform weapon skills", async () => {
    const catalog = await h.loadCatalog();
    const lf = catalog.skillById.get(10550);
    expect(lf).toBeTruthy();
    expect(lf.bundleSkills).toEqual([10634, 10635, 10633, 10636, 10632]);
    expect(lf.bundleSkills).not.toContain(14350); // Exit "Return" skill excluded
  });

  // ---------------------------------------------------------------------------
  // Elixir of Ambition — facts override (GW2 API returns no buff facts)
  // ---------------------------------------------------------------------------

  test("Elixir of Ambition (62655) has overridden facts with all 12 boons", async () => {
    const catalog = await h.loadCatalog();
    const skill = catalog.skillById.get(62655);
    expect(skill).toBeTruthy();
    expect(skill.facts.length).toBeGreaterThan(0);
    const buffFacts = skill.facts.filter((f) => f.type === "Buff" && f.status);
    expect(buffFacts).toHaveLength(12);
    expect(buffFacts.find((f) => f.status === "Might").apply_count).toBe(25);
  });

  // ---------------------------------------------------------------------------
  // Spec override — Ritualist's Shroud spec correction
  // ---------------------------------------------------------------------------

  test("Ritualist's Shroud (77238) has specialization overridden to Ritualist (76)", async () => {
    const catalog = await h.loadCatalog();
    const rs = catalog.skillById.get(77238);
    // gw2Data KNOWN_SKILL_SPEC_OVERRIDES maps 77238 → 76 (API returns spec=0)
    expect(rs.specialization).toBe(76);
  });

  test("Reaper's Shroud (30792) has specialization overridden to Reaper (34)", async () => {
    const catalog = await h.loadCatalog();
    const rs = catalog.skillById.get(30792);
    expect(rs.specialization).toBe(34);
  });

  // ---------------------------------------------------------------------------
  // Flip skills — Death Shroud and Lich Form weapon skill chains
  // ---------------------------------------------------------------------------

  test("Life Blast (10554) in Death Shroud has flip skill Dhuumfire (18504)", async () => {
    const catalog = await h.loadCatalog();
    const lifeBlast = catalog.skillById.get(10554);
    expect(lifeBlast).toBeTruthy();
    expect(lifeBlast.flipSkill).toBe(18504);
  });

  test("Dhuumfire (18504) is present in the catalog as a flip target", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(18504)).toBe(true);
  });

  test("Dark Path (10604) in Death Shroud has flip skill Dark Pursuit (56916)", async () => {
    const catalog = await h.loadCatalog();
    const darkPath = catalog.skillById.get(10604);
    expect(darkPath).toBeTruthy();
    expect(darkPath.flipSkill).toBe(56916);
  });

  test("Dark Pursuit (56916) is present in the catalog as a flip target", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(56916)).toBe(true);
  });

  test("Ripple of Horror (10633) in Lich Form has flip skill March of Undeath (45780)", async () => {
    const catalog = await h.loadCatalog();
    const ripple = catalog.skillById.get(10633);
    expect(ripple).toBeTruthy();
    expect(ripple.flipSkill).toBe(45780);
  });

  test("March of Undeath (45780) is present in the catalog as a flip target", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.skillById.has(45780)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Axe Weapon_1 resolves to the axe auto-attack", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "axe", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(10556);
  });
});
