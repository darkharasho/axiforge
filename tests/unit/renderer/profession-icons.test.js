"use strict";

// profession-icons.js uses ES module ?raw imports which are transformed by babel-jest.
// In Node test env, Vite ?raw imports resolve to empty strings via jest moduleNameMapper.
// We test the module's lookup logic, not the SVG content itself.
// The jest config already transforms src/renderer/**/*.js via babel-jest.
// Add moduleNameMapper for ?raw imports (see Step 3).

const profIcons = require("../../../src/renderer/modules/profession-icons");

describe("getProfessionSvg", () => {
  test("returns a string for a known profession", () => {
    const result = profIcons.getProfessionSvg("Guardian");
    expect(typeof result).toBe("string");
  });

  test("returns null for an unknown name", () => {
    expect(profIcons.getProfessionSvg("Unknown")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(profIcons.getProfessionSvg("")).toBeNull();
  });

  test("is case-sensitive (Guardian != guardian)", () => {
    expect(profIcons.getProfessionSvg("guardian")).toBeNull();
  });
});

describe("PROFESSION_ICON_NAMES", () => {
  test("lists every name getProfessionSvg can resolve", () => {
    const names = profIcons.PROFESSION_ICON_NAMES;
    expect(Array.isArray(names)).toBe(true);
    for (const name of names) {
      expect(profIcons.getProfessionSvg(name)).not.toBeNull();
    }
  });

  test("includes base professions and elite specs", () => {
    const names = profIcons.PROFESSION_ICON_NAMES;
    expect(names).toContain("Guardian");
    expect(names).toContain("Firebrand");
    expect(names).toContain("Necromancer");
    expect(names).toContain("Harbinger");
  });

  test("is sorted alphabetically so the mention list is predictable", () => {
    const names = profIcons.PROFESSION_ICON_NAMES;
    expect(names).toEqual([...names].sort());
  });
});
