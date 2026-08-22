"use strict";

/**
 * Tests for _resolveSkillSpecialization — which elite spec (if any) a profession
 * skill is locked behind.
 *
 * The renderer's F-slot filter drops any skill whose specialization isn't in the
 * build's selected specs, so getting this wrong silently removes a profession
 * button from the bar. The subtle case is a curated override of 0, which means
 * "this skill is core" and must beat the trait-tag fallback rather than being
 * treated as a missing value.
 */

const {
  _resolveSkillSpecialization,
} = require("../../src/main/gw2Data/catalog");
const {
  KNOWN_SKILL_SPEC_OVERRIDES,
} = require("../../src/main/gw2Data/overrides");

describe("_resolveSkillSpecialization", () => {
  test("core skill with no signal anywhere resolves to 0", () => {
    expect(_resolveSkillSpecialization({ id: 1 }, undefined, undefined)).toBe(0);
  });

  test("the profession reference wins over the skill's own value", () => {
    expect(
      _resolveSkillSpecialization({ id: 1, specialization: 12 }, { specialization: 34 }, undefined),
    ).toBe(34);
  });

  test("a trait tag fills in an elite skill the profession API leaves unset", () => {
    expect(
      _resolveSkillSpecialization({ id: 1 }, { specialization: 0 }, { specialization: 43 }),
    ).toBe(43);
  });

  test("an override beats every other source", () => {
    expect(
      _resolveSkillSpecialization({ id: 30792, specialization: 0 }, { specialization: 0 }, { specialization: 99 }),
    ).toBe(34);
  });

  test("an override of 0 pins a skill to core instead of falling through to the trait tag", () => {
    // Regression: `||` treated the authoritative 0 as absent, so Distortion
    // inherited Chronomancer (40) from the trait that references it.
    expect(
      _resolveSkillSpecialization({ id: 10192 }, { specialization: 0 }, { specialization: 40 }),
    ).toBe(0);
  });
});

describe("KNOWN_SKILL_SPEC_OVERRIDES", () => {
  test("Distortion is pinned to core so every Mesmer keeps an F4 shatter", () => {
    expect(KNOWN_SKILL_SPEC_OVERRIDES.get(10192)).toBe(0);
  });
});
