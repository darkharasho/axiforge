"use strict";

const fs = require("fs");
const path = require("path");
const { computeAttributes } = require("../../src/engine/attributes");
const { hydrateCatalogs } = require("./test-utils");

const FIXTURE_DIR = path.join(__dirname, "fixtures");

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
