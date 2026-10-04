"use strict";

const { mapBuildToTemplateInput, generateChatLink } = require("../../src/main/buildChatLink");

describe("mapBuildToTemplateInput", () => {
  const baseBuild = {
    profession: "Guardian",
    specializations: [
      { id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } },
      { id: 16, majorChoices: { 1: 600, 2: 601, 3: 602 } },
      { id: 27, majorChoices: { 1: 1896, 2: 1898, 3: 1955 } },
    ],
    skills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, { id: 9150 }, { id: 9153 }],
      elite: { id: 30461 },
    },
    underwaterSkills: {
      heal: { id: 9083 },
      utility: [{ id: 9093 }, null, null],
      elite: null,
    },
    equipment: {
      weapons: { mainhand1: "Greatsword", offhand1: "", mainhand2: "Sword", offhand2: "Focus" },
    },
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };

  it("maps profession as-is", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.profession).toBe("Guardian");
  });

  it("maps specializations with trait IDs", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.specializations).toEqual([
      { id: 42, traits: [566, 567, 568] },
      { id: 16, traits: [600, 601, 602] },
      { id: 27, traits: [1896, 1898, 1955] },
    ]);
  });

  it("preserves trait ID 0 as a valid trait", () => {
    const build = {
      ...baseBuild,
      specializations: [
        { id: 42, majorChoices: { 1: 0, 2: 567, 3: 568 } },
      ],
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations[0].traits[0]).toBe(0);
  });

  it("pads specializations to 3 when fewer exist", () => {
    const build = { ...baseBuild, specializations: [{ id: 42, majorChoices: { 1: 566, 2: 567, 3: 568 } }] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.specializations[1]).toEqual({ id: null });
    expect(input.specializations[2]).toEqual({ id: null });
  });

  it("pads specializations when array is empty", () => {
    const build = { ...baseBuild, specializations: [] };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
  });

  it("maps terrestrial skills", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.terrestrial).toEqual({
      heal: 9083,
      utilities: [9093, 9150, 9153],
      elite: 30461,
    });
  });

  it("maps aquatic skills with undefined for missing", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.aquatic).toEqual({
      heal: 9083,
      utilities: [9093, undefined, undefined],
      elite: undefined,
    });
  });

  it("maps weapons, filtering empties", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.weapons).toEqual(["greatsword", "sword", "focus"]);
  });

  it("maps revenant legends from Legend strings", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", "Legend5"],
      selectedUnderwaterLegends: ["Legend3", "Legend6"],
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.revenantLegends).toEqual([2, 5, 3, 6]);
  });

  it("omits revenantLegends for non-Revenant", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.revenantLegends).toBeUndefined();
  });

  // Revenant skill slots use a FIXED set of palette IDs; the active legend
  // resolves the concrete skill in-game. The legend's actual skill IDs (e.g.
  // 26937) are NOT in the profession's skills_by_palette, so passing them made
  // gw2buildlink throw and produce no link; leaving them empty dropped the
  // skills from the imported build — both were issue #283.
  it("uses fixed legend palette IDs for Revenant terrestrial skills", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", "Legend3"],
      selectedUnderwaterLegends: ["", ""],
      // Legend skill IDs synced into the selection — must NOT reach the encoder.
      skills: {
        heal: { id: 26937 },
        utility: [{ id: 29209 }, { id: 28231 }, { id: 27107 }],
        elite: { id: 28406 },
      },
      underwaterSkills: { heal: { id: 26937 }, utility: [], elite: null },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.revenantLegends).toEqual([2, 3, undefined, undefined]);
    // Fixed Revenant palettes (heal 4572, utilities 4564/4614/4651, elite 4554).
    expect(input.skills.terrestrial).toEqual({
      heal: 4572,
      utilities: [4564, 4614, 4651],
      elite: 4554,
    });
    // No aquatic legend → aquatic slots stay empty.
    expect(input.skills.aquatic).toEqual({
      heal: undefined,
      utilities: [undefined, undefined, undefined],
      elite: undefined,
    });
    // Second terrestrial legend present → its inactive utility palettes are set;
    // no aquatic legends → aquatic inactive slots stay empty.
    expect(input.revenantInactiveSkills).toEqual([4564, 4614, 4651, undefined, undefined, undefined]);
  });

  it("fills aquatic Revenant palettes when an underwater legend is slotted", () => {
    const build = {
      ...baseBuild,
      profession: "Revenant",
      selectedLegends: ["Legend2", ""],
      selectedUnderwaterLegends: ["Legend3", ""],
      skills: { heal: { id: 26937 }, utility: [], elite: null },
      underwaterSkills: { heal: { id: 26974 }, utility: [], elite: null },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.skills.aquatic).toEqual({
      heal: 4572,
      utilities: [4564, 4614, 4651],
      elite: 4554,
    });
    expect(input.revenantInactiveSkills).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("still maps heal/utility/elite skills for non-Revenant professions", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.skills.terrestrial.heal).toBe(9083);
    expect(input.skills.terrestrial.utilities).toEqual([9093, 9150, 9153]);
    expect(input.skills.terrestrial.elite).toBe(30461);
  });

  it("maps ranger pets", () => {
    const build = {
      ...baseBuild,
      profession: "Ranger",
      selectedPets: { terrestrial1: 1, terrestrial2: 5, aquatic1: 12, aquatic2: 3 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.rangerPets).toEqual([1, 5, 12, 3]);
  });

  it("omits rangerPets for non-Ranger", () => {
    const input = mapBuildToTemplateInput(baseBuild);
    expect(input.rangerPets).toBeUndefined();
  });

  it("handles completely empty build gracefully", () => {
    const build = {
      profession: "",
      specializations: [],
      skills: { heal: null, utility: [], elite: null },
      underwaterSkills: { heal: null, utility: [], elite: null },
      equipment: { weapons: {} },
      selectedLegends: ["", ""],
      selectedUnderwaterLegends: ["", ""],
      selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    };
    const input = mapBuildToTemplateInput(build);
    expect(input.specializations).toHaveLength(3);
    expect(input.skills.terrestrial.heal).toBeUndefined();
    expect(input.weapons).toBeUndefined();
    expect(input.skills.aquatic.heal).toBeUndefined();
    expect(input.revenantLegends).toBeUndefined();
    expect(input.rangerPets).toBeUndefined();
  });
});

// An unselected trait line reaches here as `id: 0` — that is what
// serializeEditorToBuild() emits (`Number(spec?.id || entry.specializationId || 0)`),
// and an imported build can carry `id: ""`. Only `id == null` was treated as an
// empty line, so 0 was passed through as a real specialization and gw2buildlink
// asked the GW2 API for /v2/specializations/0 — a 404 that rejected the whole
// encode. The user got "Failed" on every build with a trait line left open, on
// both the Share menu and the title bar's Chat Link button, because both call
// the same generator.
describe("mapBuildToTemplateInput — an unfilled trait line is not specialization 0", () => {
  const skeleton = {
    profession: "Necromancer",
    skills: { heal: null, utility: [], elite: null },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: { weapons: {} },
  };

  for (const [label, emptyId] of [["0", 0], ['""', ""], ["null", null], ["undefined", undefined]]) {
    it(`treats a specialization id of ${label} as an empty line`, () => {
      const input = mapBuildToTemplateInput({ ...skeleton, specializations: [{ id: emptyId, majorChoices: {} }] });
      expect(input.specializations[0]).toEqual({ id: null });
    });
  }

  it("keeps the filled lines when only some are open", () => {
    const input = mapBuildToTemplateInput({
      ...skeleton,
      specializations: [
        { id: 53, majorChoices: { 1: 914, 2: 899, 3: 919 } },
        { id: 0, majorChoices: {} },
        { id: 0, majorChoices: {} },
      ],
    });
    expect(input.specializations).toEqual([
      { id: 53, traits: [914, 899, 919] },
      { id: null },
      { id: null },
    ]);
  });

  it("never emits a zero specialization id for any shape of empty line", () => {
    const input = mapBuildToTemplateInput({
      ...skeleton,
      specializations: [{ id: "0" }, { id: 0 }, { id: "" }],
    });
    for (const spec of input.specializations) expect(spec.id).not.toBe(0);
  });
});

// The result cache is keyed by build id and invalidated on updatedAt. The editor's
// serializeEditorToBuild() emits neither a stamp nor a bumped one while you type —
// `updatedAt` is simply absent — so `cached.updatedAt === build.updatedAt` compared
// undefined to undefined and matched forever: after the first generation every
// later copy handed back the FIRST link, whatever the build looked like by then.
describe("generateChatLink caching", () => {
  function countingEncoder() {
    const calls = [];
    return {
      calls,
      encode: async (input) => {
        calls.push(input);
        return `[&link-${calls.length}-${input.specializations.map((s) => s.id).join(":")}]`;
      },
    };
  }

  // The cache lives at module scope, so each test needs its own build id or it
  // inherits the previous test's entry.
  let seq = 0;
  const freshId = () => `build-${++seq}`;

  const build = (specId, extra = {}) => ({
    id: extra.id || CURRENT_ID,
    profession: "Necromancer",
    specializations: [{ id: specId, majorChoices: {} }],
    skills: { heal: null, utility: [], elite: null },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: { weapons: {} },
    ...extra,
  });

  let CURRENT_ID;
  beforeEach(() => { CURRENT_ID = freshId(); });

  it("reuses the link for a saved build that has not changed", async () => {
    const { calls, encode } = countingEncoder();
    const saved = build(53, { updatedAt: "2026-10-04T00:00:00.000Z" });
    const first = await generateChatLink(saved, { encode });
    const second = await generateChatLink(saved, { encode });
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("regenerates when the saved build's updatedAt moves", async () => {
    const { calls, encode } = countingEncoder();
    await generateChatLink(build(53, { updatedAt: "2026-10-04T00:00:00.000Z" }), { encode });
    await generateChatLink(build(50, { updatedAt: "2026-10-04T00:05:00.000Z" }), { encode });
    expect(calls).toHaveLength(2);
  });

  it("does not serve a stale link to an unsaved editor build with no updatedAt", async () => {
    const { calls, encode } = countingEncoder();
    const before = await generateChatLink(build(53), { encode });
    const after = await generateChatLink(build(50), { encode });
    expect(calls).toHaveLength(2);
    expect(after).not.toBe(before);
    expect(after).toContain("50");
  });
});
