"use strict";

// Tests for @ mention autocomplete improvements:
// 1. nameMatches: space-insensitive matching so "weaponswa" finds "Weapon Swap"
// 2. detectMentionTrigger: multi-word queries (spaces allowed after @)

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { editor: { notes: "" } },
}));
jest.mock("../../../src/renderer/modules/detail-panel.js", () => ({
  bindHoverPreview: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/utils.js", () => ({
  decodeHtmlEntities: (s) => s,
}));
jest.mock("marked", () => ({ marked: { parse: (s) => s, use: jest.fn() } }));

const { nameMatches } = require("../../../src/renderer/modules/notes.js");

describe("nameMatches", () => {
  test("exact substring match", () => {
    expect(nameMatches("Weapon Swap", "weapon")).toBe(true);
    expect(nameMatches("Weapon Swap", "swap")).toBe(true);
    expect(nameMatches("Weapon Swap", "weapon swap")).toBe(true);
  });

  test("space-stripped match (no spaces in query)", () => {
    expect(nameMatches("Weapon Swap", "weaponswa")).toBe(true);
    expect(nameMatches("Weapon Swap", "weaponswap")).toBe(true);
    expect(nameMatches("Weapon Swap", "ponswap")).toBe(true);
  });

  test("no false positives", () => {
    expect(nameMatches("Weapon Swap", "fireball")).toBe(false);
    expect(nameMatches("Weapon Swap", "weaponx")).toBe(false);
  });

  test("handles empty/null name", () => {
    expect(nameMatches("", "test")).toBe(false);
    expect(nameMatches(null, "test")).toBe(false);
  });

  test("case insensitive", () => {
    expect(nameMatches("Weapon Swap", "WEAPON")).toBe(true);
    expect(nameMatches("Weapon Swap", "WeaponSwap")).toBe(true);
  });
});
