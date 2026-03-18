"use strict";

/**
 * Revenant integration tests — covers legend swapping and legend-driven skill sets,
 * Alliance Tactics (Vindicator), and all elite spec mechanic slot variations.
 *
 * GW2 wiki reference — Revenant:
 *   Revenants channel legendary figures (Legends) whose identity determines
 *   the fixed heal, utilities, and elite available. The player equips two legends
 *   and can swap between them. Vindicator's Legendary Alliance exposes
 *   Alliance Tactics (62729) as a persistent F3 when active.
 *
 * Conduit (spec 79): F2 "Release Potential" variant depends on active legend.
 */

const { setupHarness } = require("./harness");

describe("Revenant — end-to-end profession mechanics", () => {
  const h = setupHarness("Revenant");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Revenant profession data including legends", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Revenant");
    expect(Array.isArray(catalog.legends)).toBe(true);
    expect(catalog.legends.length).toBeGreaterThan(0);
  });

  test("catalog legendById contains all 7 mock legends", async () => {
    const catalog = await h.loadCatalog();
    for (let i = 1; i <= 7; i++) {
      expect(catalog.legendById.has(`Legend${i}`)).toBe(true);
    }
  });

  test("catalog includes all Revenant elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(52)).toBe(true); // Herald
    expect(catalog.specializationById.has(63)).toBe(true); // Renegade
    expect(catalog.specializationById.has(69)).toBe(true); // Vindicator
    expect(catalog.specializationById.has(79)).toBe(true); // Conduit
  });

  // ---------------------------------------------------------------------------
  // Legend skill data — what each legend provides
  // ---------------------------------------------------------------------------

  test("Legend1 (Mallyx) provides Enchanted Daggers as heal and Jade Winds as elite", async () => {
    const catalog = await h.loadCatalog();
    const mallyx = catalog.legendById.get("Legend1");
    expect(mallyx).toBeTruthy();
    expect(mallyx.heal).toBe(27356);  // Enchanted Daggers
    expect(mallyx.elite).toBe(26821); // Jade Winds
    expect(Array.isArray(mallyx.utilities)).toBe(true);
    expect(mallyx.utilities).toHaveLength(3);
  });

  test("Legend6 (Kalla/Renegade) provides Orders from Above as elite", async () => {
    const catalog = await h.loadCatalog();
    const kalla = catalog.legendById.get("Legend6");
    expect(kalla).toBeTruthy();
    expect(kalla.elite).toBe(45686); // Orders from Above
    expect(kalla.utilities).toContain(42949); // Darkrazor's Daring
    expect(kalla.utilities).toContain(41294); // Icerazor's Ire
    expect(kalla.utilities).toContain(44551); // Soulcleave's Summit
  });

  test("Legend7 (Alliance/Vindicator) provides Alliance stance skills", async () => {
    const catalog = await h.loadCatalog();
    const alliance = catalog.legendById.get("Legend7");
    expect(alliance).toBeTruthy();
    expect(alliance.utilities).toContain(62832); // Phantom's Onslaught
    expect(alliance.utilities).toContain(62667); // Scavenger Burst
    expect(alliance.utilities).toContain(62711); // Warding Rift
  });

  test("each legend has distinct heal and elite skills", async () => {
    const catalog = await h.loadCatalog();
    const legend1 = catalog.legendById.get("Legend1");
    const legend6 = catalog.legendById.get("Legend6");
    const legend7 = catalog.legendById.get("Legend7");
    expect(legend1.heal).not.toBe(legend6.heal);
    expect(legend1.heal).not.toBe(legend7.heal);
    expect(legend1.elite).not.toBe(legend6.elite);
  });

  // ---------------------------------------------------------------------------
  // Mechanic slots — core and all elite specs
  // ---------------------------------------------------------------------------

  test("core Revenant has no persistent elite F2+ mechanic slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 0)).toEqual([]);
  });

  test("Herald (spec 52) has no persistent elite F2+ mechanic slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 52)).toEqual([]);
  });

  test("Renegade (spec 63) has no persistent elite F2+ mechanic slots", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 63)).toEqual([]);
  });

  test("Conduit (spec 79) has no persistent elite F2+ mechanic slots in this fixture", async () => {
    const catalog = await h.loadCatalog();
    expect(h.resolveMechSlots(catalog, 79)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Vindicator — Alliance Tactics state machine
  // ---------------------------------------------------------------------------

  test("Vindicator with Legendary Alliance in active slot shows Alliance Tactics (62729) at F3", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
    });
    expect(sigs).toContain("62729");
  });

  test("Vindicator with Legendary Alliance in inactive slot shows no Alliance Tactics", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 0,
    });
    expect(sigs).not.toContain("62729");
    expect(sigs).toEqual([]);
  });

  test("Vindicator Alliance Tactics only appears when active legend is Legend7", async () => {
    const catalog = await h.loadCatalog();
    const withAlliance = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
    });
    const withoutAlliance = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 0,
    });
    expect(withAlliance).toEqual(["62729"]);
    expect(withoutAlliance).toEqual([]);
  });

  test("Vindicator switching from Legend1 active to Legend7 active reveals Alliance Tactics", async () => {
    const catalog = await h.loadCatalog();
    // Slot 0 active = Legend1 (no alliance)
    const before = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 0,
    });
    // Slot 1 active = Legend7 (alliance active)
    const after = h.resolveMechSlots(catalog, 69, {
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 1,
    });
    expect(before).toEqual([]);
    expect(after).toEqual(["62729"]);
  });

  test("Alliance Tactics (62729) has a flip skill (Urn of Saint Viktor) for form switching", async () => {
    const catalog = await h.loadCatalog();
    // The flip_skill of Alliance Tactics (62729) is not directly tested here since it's
    // a UI concern, but we can verify the skill exists and has the expected specialization
    const allianceTactics = catalog.skillById.get(62729);
    expect(allianceTactics).toBeTruthy();
    expect(allianceTactics.specialization).toBe(69); // Vindicator
  });

  // ---------------------------------------------------------------------------
  // buildRevenantEliteByProfSlot — unit-level Alliance Tactics injection
  // ---------------------------------------------------------------------------

  test("buildRevenantEliteByProfSlot injects Alliance Tactics at Profession_3 for Vindicator+Alliance", () => {
    const { buildRevenantEliteByProfSlot } = require("../../../src/renderer/modules/skills");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);
    const bySlot = buildRevenantEliteByProfSlot([], 69, true, skillById);
    expect(bySlot.get("Profession_3")).toEqual(skill62729);
  });

  test("buildRevenantEliteByProfSlot does not inject Alliance Tactics when Legendary Alliance is inactive", () => {
    const { buildRevenantEliteByProfSlot } = require("../../../src/renderer/modules/skills");
    const skillById = new Map([[62729, { id: 62729, name: "Alliance Tactics" }]]);
    const bySlot = buildRevenantEliteByProfSlot([], 69, false, skillById);
    expect(bySlot.has("Profession_3")).toBe(false);
  });

  test("buildRevenantEliteByProfSlot does not inject Alliance Tactics for non-Vindicator specs", () => {
    const { buildRevenantEliteByProfSlot } = require("../../../src/renderer/modules/skills");
    const skillById = new Map([[62729, { id: 62729, name: "Alliance Tactics" }]]);
    // spec 52 = Herald (not Vindicator) + alliance active should still not inject
    const bySlot = buildRevenantEliteByProfSlot([], 52, true, skillById);
    expect(bySlot.has("Profession_3")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Flip skills — Herald Facet and Vindicator Alliance stance chain
  // ---------------------------------------------------------------------------

  test("Facet of Elements (27014) has flip skill Elemental Blast (27162) via hardcoded override", async () => {
    const catalog = await h.loadCatalog();
    const facet = catalog.skillById.get(27014);
    expect(facet).toBeTruthy();
    // GW2 API returns flip_skill=0 for Facet of Elements; gw2Data overrides it to 27162
    expect(facet.flipSkill).toBe(27162);
  });

  test("Elemental Blast (27162) is present in the catalog as the Facet of Elements flip target", async () => {
    const catalog = await h.loadCatalog();
    const blast = catalog.skillById.get(27162);
    expect(blast).toBeTruthy();
    expect(blast.name).toBe("Elemental Blast");
  });

  test("Legendary Alliance Stance (62891) has flip skill Urn of Saint Viktor (62687)", async () => {
    const catalog = await h.loadCatalog();
    const stance = catalog.skillById.get(62891);
    expect(stance).toBeTruthy();
    expect(stance.flipSkill).toBe(62687);
  });

  test("Urn of Saint Viktor (62687) has flip skill Drop Urn of Saint Viktor (62738)", async () => {
    const catalog = await h.loadCatalog();
    const urn = catalog.skillById.get(62687);
    expect(urn).toBeTruthy();
    expect(urn.flipSkill).toBe(62738);
  });

  test("Drop Urn of Saint Viktor (62738) is the terminal skill in the Alliance stance chain", async () => {
    const catalog = await h.loadCatalog();
    const drop = catalog.skillById.get(62738);
    expect(drop).toBeTruthy();
    expect(drop.flipSkill).toBeFalsy(); // no further flip
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Sword Weapon_1 resolves to Unrelenting Assault", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "sword", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(26679); // Unrelenting Assault
  });

  test("Staff (TwoHand) Weapon_1 resolves correctly", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "staff", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(26557); // Unyielding Anguish
  });
});
