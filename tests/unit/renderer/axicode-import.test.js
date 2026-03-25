"use strict";

const { state, createEmptyEditor } = require("../../../src/renderer/modules/state");
const {
  loadBuildIntoEditor,
  enforceEditorConsistency,
  normalizeImportedSkills,
} = require("../../../src/renderer/modules/editor");

// Ensure a minimal editor exists before each test
beforeEach(() => {
  state.editor = createEmptyEditor("Guardian");
  state.activeCatalog = null;
  state.professions = [{ id: "Guardian", name: "Guardian" }];
});

// ── normalizeImportedSkills handles axicode flat format ──────────────────────

describe("normalizeImportedSkills — axicode flat format", () => {
  test("converts healId/utilityIds/eliteId to nested format", () => {
    const decoded = {
      skills: {
        healId: 9083,
        utilityIds: [9084, 9152, 9085],
        eliteId: 29965,
      },
    };
    const result = normalizeImportedSkills(decoded);
    expect(result.heal).toEqual({ id: 9083 });
    expect(result.utility).toEqual([{ id: 9084 }, { id: 9152 }, { id: 9085 }]);
    expect(result.elite).toEqual({ id: 29965 });
  });

  test("handles already-nested format (build store format)", () => {
    const source = {
      skills: {
        heal: { id: 14402 },
        utility: [{ id: 14404 }, { id: 14410 }],
        elite: { id: 14355 },
      },
    };
    const result = normalizeImportedSkills(source);
    expect(result.heal).toEqual({ id: 14402 });
    expect(result.utility).toEqual([{ id: 14404 }, { id: 14410 }]);
    expect(result.elite).toEqual({ id: 14355 });
  });
});

// ── loadBuildIntoEditor — axicode skill format ──────────────────────────────

describe("loadBuildIntoEditor — axicode-normalized skills", () => {
  test("loads normalized axicode skills into editor state", async () => {
    // Simulate what renderer.js does: normalize then load
    const decoded = {
      profession: "Guardian",
      skills: { healId: 9083, utilityIds: [9084, 9152, 9085], eliteId: 29965 },
    };
    const skills = normalizeImportedSkills(decoded);
    await loadBuildIntoEditor({ ...decoded, skills }, { captureBaseline: false });

    expect(state.editor.skills.healId).toBe(9083);
    expect(state.editor.skills.utilityIds).toEqual([9084, 9152, 9085]);
    expect(state.editor.skills.eliteId).toBe(29965);
  });

  test("loads normalized underwater skills", async () => {
    const decoded = {
      profession: "Guardian",
      underwaterSkills: { healId: 41714, utilityIds: [9153, 9084, 9150], eliteId: 43357 },
    };
    const underwaterSkills = normalizeImportedSkills({ skills: decoded.underwaterSkills });
    await loadBuildIntoEditor({ ...decoded, underwaterSkills }, { captureBaseline: false });

    expect(state.editor.underwaterSkills.healId).toBe(41714);
    expect(state.editor.underwaterSkills.utilityIds).toEqual([9153, 9084, 9150]);
    expect(state.editor.underwaterSkills.eliteId).toBe(43357);
  });
});

// ── loadBuildIntoEditor — preserves _traitChoices ───────────────────────────

describe("loadBuildIntoEditor — _traitChoices passthrough", () => {
  test("preserves _traitChoices on specialization entries", async () => {
    const build = {
      profession: "Guardian",
      specializations: [
        { id: 42, _traitChoices: [2, 2, 2] },
        { id: 46, _traitChoices: [1, 1, 3] },
        { id: 62, _traitChoices: [2, 2, 1] },
      ],
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });

    expect(state.editor.specializations[0]._traitChoices).toEqual([2, 2, 2]);
    expect(state.editor.specializations[1]._traitChoices).toEqual([1, 1, 3]);
    expect(state.editor.specializations[2]._traitChoices).toEqual([2, 2, 1]);
  });

  test("omits _traitChoices when not present", async () => {
    const build = {
      profession: "Guardian",
      specializations: [
        { id: 42, majorChoices: { 1: 100, 2: 200, 3: 300 } },
      ],
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });

    expect(state.editor.specializations[0]._traitChoices).toBeUndefined();
    expect(state.editor.specializations[0].majorChoices).toEqual({ 1: 100, 2: 200, 3: 300 });
  });
});

// ── enforceEditorConsistency — resolves _traitChoices ───────────────────────

describe("enforceEditorConsistency — _traitChoices resolution", () => {
  // Build a minimal catalog with 3 specs, each having 3 major traits per tier
  function buildCatalog() {
    const traitMap = new Map();
    const specEntries = [];

    // Spec 42 (Zeal) — non-elite
    const spec42Traits = {
      1: [{ id: 634, tier: 1 }, { id: 628, tier: 1 }, { id: 653, tier: 1 }],
      2: [{ id: 637, tier: 2 }, { id: 643, tier: 2 }, { id: 2017, tier: 2 }],
      3: [{ id: 635, tier: 3 }, { id: 648, tier: 3 }, { id: 1925, tier: 3 }],
    };
    const spec42 = {
      id: 42, name: "Zeal", elite: false,
      majorTraits: Object.values(spec42Traits).flat().map(t => t.id),
    };
    for (const traits of Object.values(spec42Traits)) {
      for (const t of traits) traitMap.set(t.id, t);
    }
    specEntries.push(spec42);

    // Spec 46 (Virtues) — non-elite
    const spec46Traits = {
      1: [{ id: 624, tier: 1 }, { id: 625, tier: 1 }, { id: 617, tier: 1 }],
      2: [{ id: 610, tier: 2 }, { id: 621, tier: 2 }, { id: 603, tier: 2 }],
      3: [{ id: 622, tier: 3 }, { id: 554, tier: 3 }, { id: 612, tier: 3 }],
    };
    const spec46 = {
      id: 46, name: "Virtues", elite: false,
      majorTraits: Object.values(spec46Traits).flat().map(t => t.id),
    };
    for (const traits of Object.values(spec46Traits)) {
      for (const t of traits) traitMap.set(t.id, t);
    }
    specEntries.push(spec46);

    // Spec 62 (Firebrand) — elite
    const spec62Traits = {
      1: [{ id: 2075, tier: 1 }, { id: 2116, tier: 1 }, { id: 2101, tier: 1 }],
      2: [{ id: 2063, tier: 2 }, { id: 2105, tier: 2 }, { id: 2086, tier: 2 }],
      3: [{ id: 2179, tier: 3 }, { id: 2159, tier: 3 }, { id: 2076, tier: 3 }],
    };
    const spec62 = {
      id: 62, name: "Firebrand", elite: true,
      majorTraits: Object.values(spec62Traits).flat().map(t => t.id),
    };
    for (const traits of Object.values(spec62Traits)) {
      for (const t of traits) traitMap.set(t.id, t);
    }
    specEntries.push(spec62);

    return {
      specializations: specEntries,
      specializationById: new Map(specEntries.map(s => [s.id, s])),
      traits: [...traitMap.values()],
      traitById: traitMap,
      skills: [],
      skillById: new Map(),
      legends: [],
      legendById: new Map(),
      professionWeapons: {},
    };
  }

  test("resolves traitChoices [2, 2, 2] to second trait in each tier", () => {
    const catalog = buildCatalog();
    state.activeCatalog = catalog;
    state.editor.specializations = [
      { specializationId: 42, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 2] },
      { specializationId: 46, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [1, 1, 3] },
      { specializationId: 62, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 1] },
    ];

    enforceEditorConsistency();

    // Spec 42 (Zeal): traitChoices [2,2,2] → 2nd trait per tier
    expect(state.editor.specializations[0].majorChoices[1]).toBe(628);
    expect(state.editor.specializations[0].majorChoices[2]).toBe(643);
    expect(state.editor.specializations[0].majorChoices[3]).toBe(648);

    // Spec 46 (Virtues): traitChoices [1,1,3] → 1st, 1st, 3rd
    expect(state.editor.specializations[1].majorChoices[1]).toBe(624);
    expect(state.editor.specializations[1].majorChoices[2]).toBe(610);
    expect(state.editor.specializations[1].majorChoices[3]).toBe(612);

    // Spec 62 (Firebrand): traitChoices [2,2,1] → 2nd, 2nd, 1st
    expect(state.editor.specializations[2].majorChoices[1]).toBe(2116);
    expect(state.editor.specializations[2].majorChoices[2]).toBe(2105);
    expect(state.editor.specializations[2].majorChoices[3]).toBe(2179);
  });

  test("existing majorChoices take precedence over _traitChoices", () => {
    const catalog = buildCatalog();
    state.activeCatalog = catalog;
    state.editor.specializations = [
      { specializationId: 42, majorChoices: { 1: 653, 2: 637, 3: 1925 }, _traitChoices: [1, 1, 1] },
    ];

    enforceEditorConsistency();

    // majorChoices had valid IDs, so they should be preserved (not overridden by traitChoices)
    expect(state.editor.specializations[0].majorChoices[1]).toBe(653);
    expect(state.editor.specializations[0].majorChoices[2]).toBe(637);
    expect(state.editor.specializations[0].majorChoices[3]).toBe(1925);
  });

  test("_traitChoices are consumed and not persisted after enforcement", () => {
    const catalog = buildCatalog();
    state.activeCatalog = catalog;
    state.editor.specializations = [
      { specializationId: 42, majorChoices: { 1: 0, 2: 0, 3: 0 }, _traitChoices: [2, 2, 2] },
    ];

    enforceEditorConsistency();

    // _traitChoices should not be present on the enforced spec (clean state)
    expect(state.editor.specializations[0]._traitChoices).toBeUndefined();
  });

  test("resolves raw traitChoices (without underscore) from axicode saves", () => {
    const catalog = buildCatalog();
    state.activeCatalog = catalog;
    state.editor.specializations = [
      { specializationId: 42, majorChoices: { 1: 0, 2: 0, 3: 0 }, traitChoices: [2, 2, 2] },
    ];

    enforceEditorConsistency();

    // Should resolve using traitChoices just like _traitChoices
    expect(state.editor.specializations[0].majorChoices[1]).toBe(628);
    expect(state.editor.specializations[0].majorChoices[2]).toBe(643);
    expect(state.editor.specializations[0].majorChoices[3]).toBe(648);
  });

  test("without _traitChoices, defaults to first trait (existing behavior)", () => {
    const catalog = buildCatalog();
    state.activeCatalog = catalog;
    state.editor.specializations = [
      { specializationId: 42, majorChoices: { 1: 0, 2: 0, 3: 0 } },
    ];

    enforceEditorConsistency();

    // Should pick first trait in each tier
    expect(state.editor.specializations[0].majorChoices[1]).toBe(634);
    expect(state.editor.specializations[0].majorChoices[2]).toBe(637);
    expect(state.editor.specializations[0].majorChoices[3]).toBe(635);
  });
});
