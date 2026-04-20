"use strict";

/**
 * Snapshot regression tests for collectModifiers output.
 *
 * For every trait in the broad fixture set, computes modifier output in both
 * PvE and WvW modes and matches against a stored snapshot. Any change to the
 * engine, overrides, or trait data that alters modifier output will fail here.
 *
 * To update snapshots after an intentional change:
 *   npx jest --rootDir packages/gw2-data modifiers-snapshot --updateSnapshot
 *
 * Run:  npx jest --rootDir packages/gw2-data modifiers-snapshot
 */

const path = require("path");
const { collectModifiers } = require("../../src/engine/modifiers");
const { loadOverrides } = require("../../src/engine/overrides");

const BROAD = require(path.join(__dirname, "../fixtures/fixtures-broad.json"));
const OVERRIDES = loadOverrides();

const DUMMY_SPEC_ID = 9999;

function getMods(fixture, gameMode) {
  const traitId = fixture.id;
  const specId = fixture.specId || DUMMY_SPEC_ID;
  const ctx = {
    specializations: [{ specializationId: specId, majorChoices: { 1: traitId } }],
    gameMode,
    equipment: { weapons: {} },
    activeWeaponSet: 1,
    underwaterMode: false,
  };
  const catalogs = {
    traitById: new Map([[traitId, fixture.api]]),
    specializationById: new Map([[specId, { id: specId, minorTraits: [] }]]),
  };
  return collectModifiers(ctx, catalogs, OVERRIDES);
}

describe("Modifier output snapshots — all stat-affecting traits", () => {
  for (const fixture of BROAD.traits) {
    const label = `${fixture.id} ${fixture.api.name} [${fixture.profession || "core"}]`;
    test(label, () => {
      const result = {
        pve: getMods(fixture, "pve"),
        wvw: getMods(fixture, "wvw"),
      };
      expect(result).toMatchSnapshot();
    });
  }
});
