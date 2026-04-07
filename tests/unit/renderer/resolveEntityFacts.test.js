"use strict";

/**
 * Tests for resolveEntityFacts — the function that filters, deduplicates, and applies
 * traited_facts overrides to a trait or skill's fact list.
 *
 * Covers the three sources of "conditional fact" noise seen in tooltips:
 *   1. requires_trait entries already filtered in gw2Data.js before reaching here
 *   2. Duplicate facts with same status but different durations (e.g. Quickness 5s / 2s)
 *   3. Duplicate facts with same text but different values (e.g. Stack Threshold 10 / 8)
 */

const { resolveEntityFacts } = require("../../../src/renderer/modules/detail-panel");
const { state } = require("../../../src/renderer/modules/state");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuff(status, duration, type = "Buff") {
  return { type, status, duration, text: "", icon: "" };
}

function makeNumber(text, value) {
  return { type: "Number", text, value, icon: "" };
}

function makeAttrConv(source, target, percent) {
  return { type: "AttributeConversion", text: "Attribute Conversion", source, target, percent };
}

function makeTraited(requiresTrait, overrides, fact) {
  return { requires_trait: requiresTrait, overrides, ...fact };
}

// ---------------------------------------------------------------------------
// Buff deduplication (status-based)
// ---------------------------------------------------------------------------

describe("resolveEntityFacts — buff deduplication", () => {
  test("removes duplicate Quickness facts keeping first (longest base duration)", () => {
    const entity = {
      facts: [makeBuff("Quickness", 5), makeBuff("Quickness", 2)],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBe(5);
    expect(result[0].status).toBe("Quickness");
  });

  test("removes duplicate Quickness across different buff types (Buff vs PrefixedBuff)", () => {
    const entity = {
      facts: [
        makeBuff("Quickness", 5, "Buff"),
        makeBuff("Quickness", 2, "PrefixedBuff"),
      ],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBe(5);
  });

  test("preserves distinct boons (Quickness, Might, Fury)", () => {
    const entity = {
      facts: [
        makeBuff("Quickness", 5),
        makeBuff("Might", 8),
        makeBuff("Fury", 5),
      ],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(3);
    expect(result.map((f) => f.status)).toEqual(["Quickness", "Might", "Fury"]);
  });

  test("Heat the Soul pattern: Quickness(5s)+Quickness(2s)+Might+Fury → 3 facts", () => {
    const entity = {
      facts: [
        makeBuff("Quickness", 5),
        makeBuff("Quickness", 2),
        makeBuff("Might", 8),
        makeBuff("Fury", 5),
      ],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(3);
    const statuses = result.map((f) => f.status);
    expect(statuses).toEqual(["Quickness", "Might", "Fury"]);
    expect(result[0].duration).toBe(5); // first (base) Quickness kept
  });
});

// ---------------------------------------------------------------------------
// Text-based deduplication (Stack Threshold, generic numeric facts)
// ---------------------------------------------------------------------------

describe("resolveEntityFacts — text deduplication", () => {
  test("removes duplicate Stack Threshold keeping first value", () => {
    const entity = {
      facts: [makeNumber("Stack Threshold", 10), makeNumber("Stack Threshold", 8)],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(10);
  });

  test("preserves distinct text facts", () => {
    const entity = {
      facts: [makeNumber("Stack Threshold", 10), makeNumber("Radius", 240)],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// AttributeConversion: distinct target/source → both preserved
// ---------------------------------------------------------------------------

describe("resolveEntityFacts — AttributeConversion deduplication", () => {
  test("Blood Reaction pattern: two distinct conversions are both kept", () => {
    const entity = {
      facts: [
        makeAttrConv("Precision", "Ferocity", 12),
        makeAttrConv("Power", "ConditionDamage", 10),
      ],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("Precision");
    expect(result[1].source).toBe("Power");
  });
});

// ---------------------------------------------------------------------------
// traited_facts overrides
// ---------------------------------------------------------------------------

describe("resolveEntityFacts — traited_facts overrides", () => {
  test("replaces base fact when required trait is active", () => {
    state.editor = {
      specializations: [{ specializationId: 51, majorChoices: { 1: 1855, 2: 0, 3: 0 } }],
    };

    const entity = {
      facts: [makeNumber("Stack Threshold", 10)],
      traitedFacts: [makeTraited(1855, 0, makeNumber("Stack Threshold", 8))],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(8); // overridden value replaces base
  });

  test("cleans up state after trait test", () => {
    // Reset state so other tests are not affected
    state.editor = { specializations: [] };
  });

  test("does not replace when required trait is not active", () => {
    const entity = {
      facts: [makeNumber("Stack Threshold", 10)],
      traitedFacts: [makeTraited(9999, 0, makeNumber("Stack Threshold", 8))],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(10); // base value unchanged
  });

  test("appends traited facts without overrides index when trait is active", () => {
    state.editor = {
      specializations: [{ specializationId: 51, majorChoices: { 1: 1855, 2: 0, 3: 0 } }],
    };

    const entity = {
      facts: [makeNumber("Radius", 240)],
      traitedFacts: [{ requires_trait: 1855, type: "Number", text: "Bonus Range", value: 100 }],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Radius");
    expect(result[1].text).toBe("Bonus Range");
    expect(result[1].value).toBe(100);

    state.editor = { specializations: [] };
  });

  test("does not append traited facts without overrides when trait is inactive", () => {
    const entity = {
      facts: [makeNumber("Radius", 240)],
      traitedFacts: [{ requires_trait: 9999, type: "Number", text: "Bonus Range", value: 100 }],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Radius");
  });

  test("marks replaced traited facts with _traitedFact flag", () => {
    state.editor = {
      specializations: [{ specializationId: 51, majorChoices: { 1: 1855, 2: 0, 3: 0 } }],
    };

    const entity = {
      facts: [makeNumber("Stack Threshold", 10)],
      traitedFacts: [makeTraited(1855, 0, makeNumber("Stack Threshold", 8))],
    };
    const result = resolveEntityFacts(entity);
    expect(result[0]._traitedFact).toBe(true);

    state.editor = { specializations: [] };
  });

  test("marks appended traited facts with _traitedFact flag", () => {
    state.editor = {
      specializations: [{ specializationId: 51, majorChoices: { 1: 1855, 2: 0, 3: 0 } }],
    };

    const entity = {
      facts: [makeNumber("Radius", 240)],
      traitedFacts: [{ requires_trait: 1855, type: "Number", text: "Bonus Range", value: 100 }],
    };
    const result = resolveEntityFacts(entity);
    expect(result[1]._traitedFact).toBe(true);
    expect(result[0]._traitedFact).toBeUndefined();

    state.editor = { specializations: [] };
  });

  test("activates traited facts from minor traits", () => {
    // Minor trait 2020 belongs to specialization 51
    state.activeCatalog = {
      specializationById: new Map([
        [51, { minorTraits: [2020, 2021, 2022] }],
      ]),
    };
    state.editor = {
      specializations: [{ specializationId: 51, majorChoices: { 1: 0, 2: 0, 3: 0 } }],
    };

    const entity = {
      facts: [makeNumber("Endurance", 0)],
      traitedFacts: [makeTraited(2020, 0, makeNumber("Endurance", 15))],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(15);
    expect(result[0]._traitedFact).toBe(true);

    state.activeCatalog = null;
    state.editor = { specializations: [] };
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("resolveEntityFacts — edge cases", () => {
  test("returns empty array for entity with no facts", () => {
    expect(resolveEntityFacts({})).toEqual([]);
    expect(resolveEntityFacts({ facts: [], traitedFacts: [] })).toEqual([]);
  });

  test("NoData section separator facts are always kept even if duplicated", () => {
    const entity = {
      facts: [
        { type: "NoData", text: "While in Berserk" },
        { type: "NoData", text: "While in Berserk" },
      ],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(2);
  });

  test("facts with no text and no status are always kept", () => {
    const entity = {
      facts: [{ type: "Unknown", value: 42 }, { type: "Unknown", value: 99 }],
      traitedFacts: [],
    };
    const result = resolveEntityFacts(entity);
    expect(result).toHaveLength(2);
  });
});
