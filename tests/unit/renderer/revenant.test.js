"use strict";

const { createMechanicsSuite, setupMechanicsHarness } = require("./mechanicsSuite");

describe("renderer Revenant mechanics — Alliance Tactics fallback", () => {
  test("injects Alliance Tactics (62729) at Profession_3 for Vindicator when Legendary Alliance is active", () => {
    const { buildRevenantEliteByProfSlot } = require("../../../src/renderer/modules/skills");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);
    const eliteFixedSkills = [
      { id: 12345, slot: "Profession_4", name: "Tree Song" },
    ];

    const bySlot = buildRevenantEliteByProfSlot(
      eliteFixedSkills,
      69,
      true,
      skillById
    );

    expect(bySlot.get("Profession_3")).toEqual(skill62729);
    expect(bySlot.get("Profession_4")).toEqual(eliteFixedSkills[0]);
  });

  test("does not inject Alliance Tactics when Legendary Alliance is not active", () => {
    const { buildRevenantEliteByProfSlot } = require("../../../src/renderer/modules/skills");
    const skill62729 = { id: 62729, name: "Alliance Tactics", slot: "Profession_3" };
    const skillById = new Map([[62729, skill62729]]);

    const bySlot = buildRevenantEliteByProfSlot([], 69, false, skillById);

    expect(bySlot.has("Profession_3")).toBe(false);
  });
});

createMechanicsSuite("Revenant", [
  { specId: 0, expected: [] },
  { specId: 52, expected: [] },
  { specId: 63, expected: [] },
  {
    specId: 69,
    legendSlots: ["Legend7", "Legend1"],
    activeLegendSlot: 0,
    expected: ["62729"],
  },
  {
    specId: 69,
    legendSlots: ["Legend1", "Legend7"],
    activeLegendSlot: 0,
    expected: [],
  },
  { specId: 79, expected: [] },
]);

describe("renderer mechanics selection — Revenant core vs elite F skills", () => {
  const resolve = setupMechanicsHarness("Revenant");

  test("core has no persistent elite F2+ slots in this fixture", async () => {
    const core = await resolve({ specId: 0 });
    expect(core.signatures).toEqual([]);
  });

  test("Herald, Renegade, and Conduit keep no persistent elite F2+ slots in this fixture", async () => {
    const herald = await resolve({ specId: 52 });
    const renegade = await resolve({ specId: 63 });
    const conduit = await resolve({ specId: 79 });
    expect(herald.signatures).toEqual([]);
    expect(renegade.signatures).toEqual([]);
    expect(conduit.signatures).toEqual([]);
  });

  test("Vindicator shows Alliance Tactics only when Legendary Alliance is active", async () => {
    const allianceActive = await resolve({
      specId: 69,
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
    });
    const allianceInactive = await resolve({
      specId: 69,
      legendSlots: ["Legend1", "Legend7"],
      activeLegendSlot: 0,
    });
    expect(allianceActive.signatures).toEqual(["62729"]);
    expect(allianceInactive.signatures).toEqual([]);
  });
});

describe("renderer mechanics selection — Revenant underwater blocked legends", () => {
  // Legend blocking happens in the UI rendering layer (renderLegendSlots), not in
  // buildMechanicSlotsForRender. These tests verify the UNDERWATER_BLOCKED_LEGENDS
  // constant encodes the correct blocked set and that the mechanic slots themselves
  // are unaffected by underwaterMode (since F-slot display logic for Revenant does
  // not change underwater — only legend picker availability is restricted).

  test("UNDERWATER_BLOCKED_LEGENDS blocks the correct legend IDs", () => {
    const { UNDERWATER_BLOCKED_LEGENDS } = require("../../../src/renderer/modules/constants");
    // Legend1 (Assassin / Mallyx) and Legend5 (Ventari) are land-only legends
    expect(UNDERWATER_BLOCKED_LEGENDS.has("Legend1")).toBe(true);
    expect(UNDERWATER_BLOCKED_LEGENDS.has("Legend5")).toBe(true);
  });

  test("UNDERWATER_BLOCKED_LEGENDS does not block non-restricted legends", () => {
    const { UNDERWATER_BLOCKED_LEGENDS } = require("../../../src/renderer/modules/constants");
    // Legend2 (Glint/Herald), Legend3 (Jalis), Legend4 (Shiro), Legend6, Legend7 are available underwater
    for (const id of ["Legend2", "Legend3", "Legend4", "Legend6", "Legend7"]) {
      expect(UNDERWATER_BLOCKED_LEGENDS.has(id)).toBe(false);
    }
  });

  const resolve = setupMechanicsHarness("Revenant");

  test("Revenant mechanic slots are unchanged by underwaterMode (blocking is UI-layer only)", async () => {
    const terrestrial = await resolve({ specId: 0 });
    const underwater = await resolve({ specId: 0, underwaterMode: true });
    expect(underwater.signatures).toEqual(terrestrial.signatures);
  });

  test("Vindicator Alliance Tactics mechanic slot is unaffected by underwaterMode", async () => {
    const terrestrialActive = await resolve({
      specId: 69,
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
    });
    const underwaterActive = await resolve({
      specId: 69,
      legendSlots: ["Legend7", "Legend1"],
      activeLegendSlot: 0,
      underwaterMode: true,
    });
    expect(underwaterActive.signatures).toEqual(terrestrialActive.signatures);
  });
});
