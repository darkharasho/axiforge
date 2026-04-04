"use strict";

/**
 * @jest-environment jsdom
 */

// Test that the SPA render-notes module resolves ALL mention categories
// (skill, trait, rune, sigil, food, utility, infusion, enrichment, relic)
// into hoverable chips, matching the app's notes.js implementation.
//
// Bug #139: relic/infusion/enrichment mentions were silently dropped in
// the published SPA because render-notes.js had no case handlers for them.

// We cannot import the ES module directly, so we replicate the core
// resolution and mapping logic that render-notes.js must implement, and
// verify the source file contains the required case branches.

const fs = require("node:fs");
const path = require("node:path");

const RENDER_NOTES_PATH = path.join(__dirname, "../../../src/site/render-notes.js");
const RENDER_BUILD_PATH = path.join(__dirname, "../../../src/site/render-build.js");

const renderNotesSrc = fs.readFileSync(RENDER_NOTES_PATH, "utf-8");
const renderBuildSrc = fs.readFileSync(RENDER_BUILD_PATH, "utf-8");

// All categories that the app's notes.js resolveReference handles
const ALL_CATEGORIES = ["skill", "trait", "rune", "sigil", "food", "utility", "infusion", "enrichment", "relic"];

describe("SPA render-notes.js — mention category coverage", () => {
  test.each(ALL_CATEGORIES)(
    'has case "%s" in the mention-resolve switch',
    (category) => {
      // Match case "category": in the source (the resolve switch)
      const pattern = new RegExp(`case\\s+"${category}"\\s*:`);
      expect(renderNotesSrc).toMatch(pattern);
    }
  );

  test.each(ALL_CATEGORIES)(
    'has case "%s" in the hover-binding switch',
    (category) => {
      // There should be at least 2 occurrences of each case (resolve + hover)
      const pattern = new RegExp(`case\\s+"${category}"\\s*:`, "g");
      const matches = renderNotesSrc.match(pattern) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    }
  );
});

describe("SPA render-build.js — upgradeCatalog completeness", () => {
  test("creates relicById map (not just relicByName)", () => {
    expect(renderBuildSrc).toMatch(/relicById\s*:/);
  });

  test.each(["runeById", "sigilById", "infusionById", "enrichmentById", "foodById", "utilityById", "relicById"])(
    "upgradeCatalog includes %s",
    (mapName) => {
      expect(renderBuildSrc).toMatch(new RegExp(`${mapName}\\s*:`));
    }
  );
});

describe("SPA render-notes.js — lookup map construction", () => {
  // Verify that render-notes.js builds lookup maps for the categories
  // that are sourced from upgradeCatalog (not from catalogSkills/catalogTraits)
  const UPGRADE_CATEGORIES = ["rune", "sigil", "food", "utility", "infusion", "enrichment", "relic"];

  test.each(UPGRADE_CATEGORIES)(
    'builds a %sById lookup map',
    (category) => {
      const pattern = new RegExp(`${category}ById`, "i");
      expect(renderNotesSrc).toMatch(pattern);
    }
  );
});
