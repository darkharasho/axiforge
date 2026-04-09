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

  test("Heightened Focus (trait 1317) has correct WvW split with Quickness 2.5s", () => {
    const entry = splits.traits["1317"];
    expect(entry).toBeDefined();
    expect(entry.name).toBe("Heightened Focus");
    const wvw = entry.modes?.wvw;
    expect(wvw).toBeDefined();
    expect(wvw.complete).toBe(true);
    // Quickness duration must be 2.5s, not 0 (was a parser bug)
    const quickness = wvw.facts.find((f) => f.status === "Quickness");
    expect(quickness).toBeDefined();
    expect(quickness.duration).toBe(2.5);
    // Must include Adrenaline Stage buff facts with correct stacks
    const stages = wvw.facts.filter((f) => f.status === "Heightened Focus");
    expect(stages).toHaveLength(3);
    expect(stages.map((f) => f.apply_count)).toEqual([2, 3, 4]);
  });
});
