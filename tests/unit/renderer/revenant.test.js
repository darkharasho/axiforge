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

describe("renderer Revenant skill options — published-build legend fallback (#283)", () => {
  const { buildMechanicSlotsForRender } = require("../../../src/renderer/modules/skills");

  // A published build shared before the publish serializer carried legend
  // heal/utilities/elite stores only { id, swap } per legend. Without a fallback
  // to the saved skill IDs, the Revenant skill bar renders no heal/utility/elite.
  const healSkill = { id: 26937, name: "Enchanted Daggers", icon: "ed.png", slot: "Heal" };
  const util1 = { id: 29209, name: "Riposting Shadows", icon: "rs.png", slot: "Utility" };
  const util2 = { id: 28231, name: "Phase Traversal", icon: "pt.png", slot: "Utility" };
  const util3 = { id: 27107, name: "Impossible Odds", icon: "io.png", slot: "Utility" };
  const eliteSkill = { id: 28406, name: "Jade Winds", icon: "jw.png", slot: "Elite" };
  const swapSkill = { id: 28134, name: "Legendary Assassin Stance", icon: "shiro.png" };
  const allSkills = [healSkill, util1, util2, util3, eliteSkill, swapSkill];

  function makeCatalog(legend) {
    return {
      skills: allSkills,
      legends: [legend],
      legendById: new Map([[legend.id, legend]]),
      skillById: new Map(allSkills.map((s) => [s.id, s])),
      specializationById: new Map(),
    };
  }

  function makeEditor() {
    return {
      profession: "Revenant",
      specializations: [],
      skills: { healId: 26937, utilityIds: [29209, 28231, 27107], eliteId: 28406 },
      selectedLegends: ["Legend2", "Legend3"],
      activeLegendSlot: 0,
      allianceTacticsForm: 0,
      equipment: { weapons: {} },
    };
  }

  function resolveOptions(legend) {
    const catalog = makeCatalog(legend);
    const editor = makeEditor();
    return buildMechanicSlotsForRender({
      catalog,
      options: { heal: [], utility: [], elite: [], profession: [] },
      editor,
      utilitySelection: editor.skills.utilityIds,
      equippedWeapons: {},
      mhKey: "mainhand1",
      ohKey: "offhand1",
      activeAttunement: "Fire",
      activeKit: 0,
      underwaterMode: false,
    }).options;
  }

  test("falls back to saved skill IDs when the legend lacks heal/utilities/elite", () => {
    // Old published build: legend only has id + swap.
    const opts = resolveOptions({ id: "Legend2", swap: 28134 });
    expect(opts.heal.map((s) => s.id)).toEqual([26937]);
    expect(opts.utility.map((s) => s.id)).toEqual([29209, 28231, 27107]);
    expect(opts.elite.map((s) => s.id)).toEqual([28406]);
  });

  test("uses the legend's own skills when present (newly published builds)", () => {
    const opts = resolveOptions({
      id: "Legend2", swap: 28134,
      heal: 26937, utilities: [29209, 28231, 27107], elite: 28406,
    });
    expect(opts.heal.map((s) => s.id)).toEqual([26937]);
    expect(opts.utility.map((s) => s.id)).toEqual([29209, 28231, 27107]);
    expect(opts.elite.map((s) => s.id)).toEqual([28406]);
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
