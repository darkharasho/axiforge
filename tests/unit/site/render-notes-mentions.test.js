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
// Additionally, mentions of non-equipped upgrade items (e.g. a relic
// referenced in notes but not currently equipped) were unresolvable because
// the SPA only had data for equipped items.

const fs = require("node:fs");
const path = require("node:path");

const RENDER_NOTES_PATH = path.join(__dirname, "../../../src/site/render-notes.js");
const RENDER_BUILD_PATH = path.join(__dirname, "../../../src/site/render-build.js");
const BUILD_PUBLISH_PATH = path.join(__dirname, "../../../src/main/buildPublish.js");

const renderNotesSrc = fs.readFileSync(RENDER_NOTES_PATH, "utf-8");
const renderBuildSrc = fs.readFileSync(RENDER_BUILD_PATH, "utf-8");

// All categories that the app's notes.js resolveReference handles
const ALL_CATEGORIES = ["skill", "trait", "rune", "sigil", "food", "utility", "infusion", "enrichment", "relic"];

describe("SPA render-notes.js — mention category coverage", () => {
  test.each(ALL_CATEGORIES)(
    'has case "%s" in the mention-resolve switch',
    (category) => {
      const pattern = new RegExp(`case\\s+"${category}"\\s*:`);
      expect(renderNotesSrc).toMatch(pattern);
    }
  );

  test.each(ALL_CATEGORIES)(
    'has case "%s" in the hover-binding switch',
    (category) => {
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
  const UPGRADE_CATEGORIES = ["rune", "sigil", "food", "utility", "infusion", "enrichment", "relic"];

  test.each(UPGRADE_CATEGORIES)(
    'builds a %sById lookup map',
    (category) => {
      const pattern = new RegExp(`${category}ById`, "i");
      expect(renderNotesSrc).toMatch(pattern);
    }
  );
});

describe("SPA render-notes.js — catalogNotesMentions integration", () => {
  test("merges catalogNotesMentions into lookup maps", () => {
    expect(renderNotesSrc).toMatch(/catalogNotesMentions/);
  });
});

describe("SPA render-build.js — catalogNotesMentions integration", () => {
  test("merges catalogNotesMentions into state.upgradeCatalog", () => {
    expect(renderBuildSrc).toMatch(/catalogNotesMentions/);
  });
});

describe("buildPublish — resolveNotesMentions", () => {
  const { serializeForPublish } = require(BUILD_PUBLISH_PATH);

  test("includes non-equipped relic mentioned in notes", () => {
    const build = {
      profession: "Warrior",
      equipment: { relic: "Relic of Fireworks", weapons: {} },
      notes: "@[relic:100144:Relic of the Warrior]",
    };
    const catalog = { traits: [], skills: [], weaponSkills: [], professionWeapons: {} };
    const upgradeCatalog = {
      runeById: new Map(),
      sigilById: new Map(),
      infusionById: new Map(),
      enrichmentById: new Map(),
      foodById: new Map(),
      utilityById: new Map(),
      relicByName: new Map([
        ["Relic of Fireworks", { id: 100947, name: "Relic of Fireworks", icon: "fw.png" }],
      ]),
      relics: [
        { id: 100947, name: "Relic of Fireworks", icon: "fw.png" },
        { id: 100144, name: "Relic of the Warrior", icon: "warrior.png", description: "Dmg" },
      ],
    };

    const result = serializeForPublish(build, catalog, upgradeCatalog);
    const mentions = result.catalogNotesMentions;
    expect(mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 100144, name: "Relic of the Warrior", category: "relic" }),
    ]));
  });

  test("does not duplicate items already in equipmentDisplay", () => {
    const build = {
      profession: "Warrior",
      equipment: { relic: "Relic of Fireworks", weapons: {} },
      notes: "@[relic:100947:Relic of Fireworks]",
    };
    const catalog = { traits: [], skills: [], weaponSkills: [], professionWeapons: {} };
    const upgradeCatalog = {
      runeById: new Map(),
      sigilById: new Map(),
      infusionById: new Map(),
      enrichmentById: new Map(),
      foodById: new Map(),
      utilityById: new Map(),
      relicByName: new Map([
        ["Relic of Fireworks", { id: 100947, name: "Relic of Fireworks", icon: "fw.png" }],
      ]),
      relics: [
        { id: 100947, name: "Relic of Fireworks", icon: "fw.png" },
      ],
    };

    const result = serializeForPublish(build, catalog, upgradeCatalog);
    expect(result.catalogNotesMentions).toEqual([]);
  });

  test("returns empty array when no notes", () => {
    const build = { profession: "Warrior", equipment: { weapons: {} } };
    const catalog = { traits: [], skills: [], weaponSkills: [], professionWeapons: {} };
    const upgradeCatalog = {
      runeById: new Map(), sigilById: new Map(), infusionById: new Map(),
      enrichmentById: new Map(), foodById: new Map(), utilityById: new Map(),
      relicByName: new Map(),
    };

    const result = serializeForPublish(build, catalog, upgradeCatalog);
    expect(result.catalogNotesMentions).toEqual([]);
  });
});
