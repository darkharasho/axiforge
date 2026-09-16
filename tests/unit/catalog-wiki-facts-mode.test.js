"use strict";

/**
 * Tests for _applyWikiFacts — how wiki-parsed, per-game-mode facts are folded
 * onto an API entity.
 *
 * Related to #307: consumers read `wvwFacts`/`pvpFacts` in preference to the
 * PvE `facts`, so an empty per-mode array is a claim that the entity does
 * nothing in that mode. That claim is only true when the wiki page actually had
 * fact templates to split.
 */

const { _applyWikiFacts } = require("../../src/main/gw2Data/catalog");

function wiki({ pve = [], wvw = [], pvp = [], hasSplit = false } = {}) {
  return { pve, wvw, pvp, hasSplit };
}

function buff(status, duration) {
  return { type: "Buff", text: "Apply Buff/Condition", status, duration, apply_count: 1 };
}

describe("_applyWikiFacts — per-game-mode facts", () => {
  test("records the WvW split alongside the PvE facts", () => {
    // Feverish Pulse: alacrity in PvE, quickness in WvW.
    const entity = { id: 2369, facts: [buff("Alacrity", 5)] };
    _applyWikiFacts(entity, new Map([[2369, wiki({
      pve: [buff("Alacrity", 6)],
      wvw: [buff("Quickness", 1)],
      pvp: [buff("Quickness", 2)],
      hasSplit: true,
    })]]), new Map(), new Map());

    expect(entity.facts).toEqual([buff("Alacrity", 6)]);
    expect(entity.wvwFacts).toEqual([buff("Quickness", 1)]);
    expect(entity.pvpFacts).toEqual([buff("Quickness", 2)]);
    expect(entity.hasSplit).toBe(true);
  });

  test("an empty per-mode array is kept when the wiki did parse facts", () => {
    // A PvE-only effect: the fact exists, but is tagged `game mode=pve`.
    const entity = { id: 10, facts: [buff("Alacrity", 5)] };
    _applyWikiFacts(entity, new Map([[10, wiki({
      pve: [buff("Alacrity", 6)],
      wvw: [],
      pvp: [],
      hasSplit: true,
    })]]), new Map(), new Map());

    expect(entity.wvwFacts).toEqual([]);
    expect(entity.pvpFacts).toEqual([]);
  });

  test("a page with no parseable facts leaves the API facts in place for every mode", () => {
    const entity = { id: 11, facts: [buff("Might", 10)] };
    _applyWikiFacts(entity, new Map([[11, wiki()]]), new Map(), new Map());

    expect(entity.facts).toEqual([buff("Might", 10)]);
    expect(entity.wvwFacts).toBeUndefined();
    expect(entity.pvpFacts).toBeUndefined();
  });

  test("infobox-only WvW facts are still recorded when PvE has no templates", () => {
    const entity = { id: 12, facts: [buff("Might", 10)] };
    _applyWikiFacts(entity, new Map([[12, wiki({
      wvw: [buff("Might", 5)],
      hasSplit: true,
    })]]), new Map(), new Map());

    expect(entity.facts).toEqual([buff("Might", 10)]);
    expect(entity.wvwFacts).toEqual([buff("Might", 5)]);
  });

  test("entities with no wiki page are untouched", () => {
    const entity = { id: 13, facts: [buff("Fury", 3)] };
    _applyWikiFacts(entity, new Map(), new Map(), new Map());

    expect(entity.facts).toEqual([buff("Fury", 3)]);
    expect(entity.wvwFacts).toBeUndefined();
  });
});
