"use strict";

const { PROFESSION_THEMES, PROFESSION_WEIGHT } = require("../../../src/renderer/modules/constants.js");

describe("PROFESSION_THEMES", () => {
  it("maps every profession in PROFESSION_WEIGHT to a prof-* theme ID", () => {
    for (const profession of Object.keys(PROFESSION_WEIGHT)) {
      expect(PROFESSION_THEMES).toHaveProperty(profession);
      expect(PROFESSION_THEMES[profession]).toMatch(/^prof-/);
    }
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(PROFESSION_THEMES)).toHaveLength(9);
  });

  it("has unique theme IDs", () => {
    const ids = Object.values(PROFESSION_THEMES);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
