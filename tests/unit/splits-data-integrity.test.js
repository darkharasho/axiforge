/**
 * Data integrity tests for splits.json — catches known classes of bad data.
 */
const splits = require("../../lib/gw2-balance-splits/data/splits.json");

describe("splits.json data integrity", () => {
  const allFacts = [];
  for (const category of ["skills", "traits"]) {
    for (const [id, entry] of Object.entries(splits[category] || {})) {
      for (const [mode, modeData] of Object.entries(entry.modes || {})) {
        for (const fact of modeData.facts || []) {
          allFacts.push({ category, id, name: entry.name, mode, fact });
        }
      }
    }
  }

  test("no Range facts with value <= 1 (bogus boolean flags)", () => {
    const bad = allFacts.filter(
      (f) => f.fact.type === "Range" && f.fact.value <= 1
    );
    expect(bad).toEqual([]);
  });

  test("no Barrier-like facts with value === 1 (bogus boolean flags)", () => {
    const bad = allFacts.filter(
      (f) =>
        f.fact.text &&
        /barrier/i.test(f.fact.text) &&
        f.fact.type === "Number" &&
        f.fact.value === 1
    );
    expect(bad).toEqual([]);
  });
});
