"use strict";

const esm = require("../../../src/renderer/modules/trait-choices.js");
const cjs = require("../../../src/shared/traitChoices");

const TIERS = {
  1: [{ id: 401 }, { id: 402 }, { id: 403 }],
  2: [{ id: 501 }, { id: 502 }, { id: 503 }],
  3: [601, 602, 603],
};

describe("resolveMajorChoices", () => {
  test("resolves 1-based traitChoices positions to trait ids", () => {
    const spec = { id: 16, majorChoices: { 1: 0, 2: 0, 3: 0 }, traitChoices: [1, 2, 3] };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toEqual({ 1: 401, 2: 502, 3: 603 });
  });

  test("reads _traitChoices (normalized imports) as well", () => {
    const spec = { id: 16, _traitChoices: [3, 3, 1] };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toEqual({ 1: 403, 2: 503, 3: 601 });
  });

  test("prefers the spec's stored majorTraitsByTier over the catalog tiers", () => {
    const spec = {
      id: 16, majorChoices: { 1: 0, 2: 0, 3: 0 }, traitChoices: [2, 2, 2],
      majorTraitsByTier: { 1: [{ id: 11 }, { id: 12 }], 2: [{ id: 21 }, { id: 22 }], 3: [{ id: 31 }, { id: 32 }] },
    };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toEqual({ 1: 12, 2: 22, 3: 32 });
  });

  test("falls back to the catalog tiers when the stored tiers are empty", () => {
    const spec = { majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] }, traitChoices: [2, 1, 2] };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toEqual({ 1: 402, 2: 501, 3: 602 });
  });

  test("an out-of-range or zero position picks the tier's first trait", () => {
    const spec = { traitChoices: [0, 9, null] };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toEqual({ 1: 401, 2: 501, 3: 601 });
  });

  test("any chosen major trait wins: majorChoices are returned untouched", () => {
    const majorChoices = { 1: 402, 2: 0, 3: 0 };
    const spec = { majorChoices, traitChoices: [3, 3, 3] };
    expect(cjs.resolveMajorChoices(spec, TIERS)).toBe(majorChoices);
  });

  test("no traitChoices: majorChoices unchanged, defaulting to blanks", () => {
    expect(cjs.resolveMajorChoices({}, TIERS)).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(cjs.resolveMajorChoices(null, TIERS)).toEqual({ 1: 0, 2: 0, 3: 0 });
  });

  test("no tiers at all resolves to blanks", () => {
    expect(cjs.resolveMajorChoices({ traitChoices: [1, 1, 1] })).toEqual({ 1: 0, 2: 0, 3: 0 });
  });
});

describe("trait-choices ESM mirror matches src/shared/traitChoices", () => {
  const cases = [
    [{ traitChoices: [1, 2, 3] }, TIERS],
    [{ _traitChoices: [3, 3, 1], majorChoices: { 1: 0, 2: 0, 3: 0 } }, TIERS],
    [{ traitChoices: [2, 2, 2], majorTraitsByTier: { 1: [{ id: 11 }, { id: 12 }], 2: [], 3: [] } }, TIERS],
    [{ traitChoices: [0, 9, null] }, TIERS],
    [{ majorChoices: { 1: 402, 2: 0, 3: 0 }, traitChoices: [3, 3, 3] }, TIERS],
    [{}, TIERS],
    [null, undefined],
    [{ traitChoices: [1, 1, 1] }, undefined],
  ];
  test.each(cases)("agrees for %j", (spec, tiers) => {
    expect(esm.resolveMajorChoices(spec, tiers)).toEqual(cjs.resolveMajorChoices(spec, tiers));
  });
});
