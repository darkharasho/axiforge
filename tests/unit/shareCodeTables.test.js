"use strict";

// Guards for the share codec's positional lookup tables.
//
// Share codes store a table INDEX, not a label. Reordering or removing an entry
// silently changes what every already-published code decodes to, and an index
// that overflows its bit field silently wraps to a different, structurally
// valid value. These tests make both failure modes loud.

const crypto = require("crypto");
const path = require("path");

const relics = require("../../packages/axicode/src/relics");
const {
  PROFESSIONS,
  WEAPONS,
  STAT_COMBOS_ORDERED,
  FOOD_ORDERED,
  UTILITY_ORDERED,
  LEGEND_STRINGS,
  relicToIndex,
} = require("../../packages/axicode/src/tables");
const { BitWriter } = require("../../packages/axicode/src/bitBuffer");

const sha256 = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("relic table is append-only", () => {
  // Covers indices 1..FROZEN_COUNT of RELICS_SORTED (index 0 is the empty slot).
  // Appending is fine — it leaves this prefix untouched. Reordering, renaming or
  // removing is not, and breaks this hash.
  const FROZEN_COUNT = 112;
  const FROZEN_SHA256 = "b4d55f7f34787df41a9ac31f7a273bad46ddb454b509985c8316f61e7b3de6ba";

  test("frozen prefix has not been reordered, renamed or removed", () => {
    expect(relics.length).toBeGreaterThanOrEqual(FROZEN_COUNT);
    expect(sha256(relics.slice(0, FROZEN_COUNT))).toBe(FROZEN_SHA256);
  });

  test("every relic the app knows about is encodable", () => {
    const facts = require(path.join(__dirname, "../../src/main/gw2Data/relicFacts.json"));
    const known = Object.values(facts.relics).map((entry) => entry.name).filter(Boolean);
    expect(known.length).toBeGreaterThan(0);

    // relicToIndex falls back to 0 (= no relic) for anything missing from the
    // table, so an un-encodable relic is dropped from the share code silently.
    const unencodable = known.filter((name) => relicToIndex(name) === 0);
    expect(unencodable).toEqual([]);
  });
});

describe("positional tables fit their bit fields", () => {
  // width = bits the codec writes the index into; see encodeShareCode in index.js.
  // Professions and game modes reserve their all-ones value as the "unknown"
  // sentinel, so their usable capacity is one less than the raw bit width.
  const TABLES = [
    { name: "PROFESSIONS", entries: PROFESSIONS, bits: 4, reservesSentinel: true },
    { name: "WEAPONS", entries: WEAPONS, bits: 5 },
    { name: "STAT_COMBOS_ORDERED", entries: STAT_COMBOS_ORDERED, bits: 6 },
    { name: "RELICS_SORTED", entries: ["", ...relics], bits: 7 },
    { name: "FOOD_ORDERED", entries: FOOD_ORDERED, bits: 4 },
    { name: "UTILITY_ORDERED", entries: UTILITY_ORDERED, bits: 3 },
    { name: "LEGEND_STRINGS", entries: LEGEND_STRINGS, bits: 3 },
  ];

  test.each(TABLES)("$name has room for its entries", ({ entries, bits, reservesSentinel }) => {
    const capacity = 2 ** bits - (reservesSentinel ? 1 : 0);
    expect(entries.length).toBeLessThanOrEqual(capacity);
  });
});

describe("BitWriter rejects values that do not fit", () => {
  test("throws instead of truncating an over-range value", () => {
    const w = new BitWriter();
    expect(() => w.write(16, 4)).toThrow(/does not fit in 4 bits/);
  });

  test("throws on a negative value", () => {
    const w = new BitWriter();
    expect(() => w.write(-1, 4)).toThrow(/does not fit in 4 bits/);
  });

  test("still accepts the largest value the field can hold", () => {
    const w = new BitWriter();
    expect(() => w.write(15, 4)).not.toThrow();
  });
});
