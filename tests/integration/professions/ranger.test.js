"use strict";

const { setupHarness } = require("./harness");

describe("Ranger — end-to-end profession mechanics", () => {
  const h = setupHarness("Ranger");

  // ---------------------------------------------------------------------------
  // Catalog loading
  // ---------------------------------------------------------------------------

  test("catalog loads with Ranger profession data including pets", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.profession.id).toBe("Ranger");
    expect(Array.isArray(catalog.pets)).toBe(true);
    expect(catalog.pets.length).toBeGreaterThan(0);
  });

  test("catalog includes all Ranger elite specs", async () => {
    const catalog = await h.loadCatalog();
    expect(catalog.specializationById.has(55)).toBe(true); // Soulbeast
    expect(catalog.specializationById.has(72)).toBe(true); // Untamed
  });

  // ---------------------------------------------------------------------------
  // Skill options
  // ---------------------------------------------------------------------------

  test("core Ranger has heal, utility, and elite skill options", async () => {
    const catalog = await h.loadCatalog();
    const opts = h.skillOptions(catalog, 0);
    expect(opts.heal[0].id).toBe(5503);  // Troll Unguent
    expect(opts.elite.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Pet mechanic slots — F1 attack / F2 pet skill / F3 return
  // ---------------------------------------------------------------------------

  test("core Ranger mechanic slots: Attack command, pet F2, Return command", async () => {
    const catalog = await h.loadCatalog();
    // Default pets: terrestrial1=1 (Black Bear), terrestrial2=5 (Hyena)
    const sigs = h.resolveMechSlots(catalog, 0, { pets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 0, aquatic2: 0 } });
    expect(sigs).toEqual(["fake:attack", "12478", "fake:return"]);
  });

  test("Black Bear (pet id=1) provides skill 12478 as the pet F2 slot", async () => {
    const catalog = await h.loadCatalog();
    const sigs = h.resolveMechSlots(catalog, 0, { pets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 0, aquatic2: 0 } });
    expect(sigs[1]).toBe("12478"); // Black Bear Maul
  });

  test("Hyena (pet id=5) in slot 2 — switching active pet changes pet F2 skill", async () => {
    const catalog = await h.loadCatalog();
    // petById from catalog maps raw pet data; pet 5 (Hyena) has skill 12461 at index 0
    const hyena = catalog.petById.get(5);
    expect(hyena).toBeTruthy();
    expect(hyena.skills[0]?.id).toBe(12461);
  });

  test("Soulbeast (spec 55) keeps the same F1-F3 pet command footprint as core", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    const soulbeast = h.resolveMechSlots(catalog, 55);
    expect(soulbeast).toEqual(core);
  });

  test("Untamed (spec 72) default shows empowered pet commands at F1-F3", async () => {
    const catalog = await h.loadCatalog();
    const untamed = h.resolveMechSlots(catalog, 72);
    // Default Untamed: Unleash Pet active → empowered pet commands F1-F3 + F5 toggle
    expect(untamed).toEqual(["63209", "63258", "63094", "63344"]);
  });

  test("Untamed default (Unleash Pet) shows empowered commands, not normal pet bar", async () => {
    const catalog = await h.loadCatalog();
    const core = h.resolveMechSlots(catalog, 0);
    const untamed = h.resolveMechSlots(catalog, 72);
    // Unleash Pet gives empowered commands, different from core's normal pet bar
    expect(untamed.slice(0, 3)).not.toEqual(core);
    expect(untamed[3]).toBe("63344"); // F5 toggle (current state: Unleash Pet)
  });

  // ---------------------------------------------------------------------------
  // Weapon skill resolution
  // ---------------------------------------------------------------------------

  test("Longbow (TwoHand) Weapon_1 resolves to Long Range Shot", async () => {
    const catalog = await h.loadCatalog();
    const slots = h.resolveWeaponSlots(catalog, "longbow", "", "");
    expect(slots[0]).not.toBeNull();
    expect(slots[0].id).toBe(12466); // Long Range Shot
  });
});
