"use strict";

const fs = require("fs");
const path = require("path");
const { computeAttributes } = require("../../src/engine/attributes");

const FIXTURE_DIR = path.join(__dirname, "fixtures");

function hydrateCatalogs(raw) {
  return {
    traitById: new Map((raw.traits || []).map((t) => [t.id, t])),
    skillById: new Map((raw.skills || []).map((s) => [s.id, s])),
    specializationById: new Map((raw.specializations || []).map((s) => [s.id, s])),
    runeById: new Map((raw.runes || []).map((r) => [r.id, r])),
    foodById: new Map((raw.foods || []).map((f) => [f.id, f])),
    utilityById: new Map((raw.utilities || []).map((u) => [u.id, u])),
    infusionById: new Map((raw.infusions || []).map((i) => [i.id, i])),
    enrichmentById: new Map((raw.enrichments || []).map((e) => [e.id, e])),
  };
}

const fixtureFiles = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

describe("snapshot fixtures", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf-8"));

    describe(fixture.name, () => {
      let result;

      beforeAll(() => {
        const catalogs = hydrateCatalogs(fixture.catalogs);
        result = computeAttributes(fixture.ctx, catalogs);
      });

      test("total stats match expected", () => {
        expect(result.total).toEqual(fixture.expected.total);
      });

      test("derived health matches", () => {
        expect(result.derived.health).toBe(fixture.expected.derived.health);
      });

      test("derived critChance matches", () => {
        expect(result.derived.critChance).toBeCloseTo(fixture.expected.derived.critChance, 1);
      });

      test("derived critDamage matches", () => {
        expect(result.derived.critDamage).toBeCloseTo(fixture.expected.derived.critDamage, 1);
      });

      test("derived armor matches", () => {
        expect(result.derived.armor).toBe(fixture.expected.derived.armor);
      });

      test("derived conditionDuration matches", () => {
        expect(result.derived.conditionDuration).toBeCloseTo(fixture.expected.derived.conditionDuration, 1);
      });

      test("derived boonDuration matches", () => {
        expect(result.derived.boonDuration).toBeCloseTo(fixture.expected.derived.boonDuration, 1);
      });
    });
  }
});
