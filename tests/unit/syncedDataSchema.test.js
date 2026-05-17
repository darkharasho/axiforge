/**
 * Schema-invariant tests for the wiki/API-synced data files.
 *
 * These don't assert specific values — they assert *structural* invariants
 * that would catch a regressed sync script before bad data lands in main:
 *   - every relic entry has a name and a facts array
 *   - every fact has a recognized type
 *   - every override targets a real RELIC_ITEM_ID
 *   - every legend has all five required fields
 *   - profession/specialization snapshots have id + name on every entry
 *
 * Re-run after any `scripts/sync-*.mjs` invocation.
 */

const relicFacts = require("../../src/main/gw2Data/relicFacts.json");
const relicFactsOverrides = require("../../src/main/gw2Data/relicFactsOverrides.json");
const legends = require("../../src/main/gw2Data/legends.json");
const professions = require("../../src/main/gw2Data/professions.json");
const specializations = require("../../src/main/gw2Data/specializations.json");
const {
  RELIC_ITEM_IDS, RUNE_ITEM_IDS, SIGIL_ITEM_IDS,
  INFUSION_ITEM_IDS, ENRICHMENT_ITEM_IDS, FOOD_ITEM_IDS, UTILITY_ITEM_IDS,
  WVW_INFUSION_IDS,
} = require("../../src/main/gw2Data/upgradeIds");

// Fact types parse-facts.js produces today. Update this set if new types are
// added; failing this test signals a sync wrote a fact we don't understand.
const KNOWN_FACT_TYPES = new Set([
  "Buff", "Damage", "Time", "Number", "Percent", "Radius", "Range",
  "Recharge", "StunBreak", "ComboFinisher", "ComboField", "AttributeAdjust",
]);

describe("relicFacts.json", () => {
  test("has the expected envelope shape", () => {
    expect(typeof relicFacts.updatedAt).toBe("string");
    expect(new Date(relicFacts.updatedAt).toString()).not.toBe("Invalid Date");
    expect(typeof relicFacts.relics).toBe("object");
    expect(relicFacts.relics).not.toBeNull();
  });

  test("every relic id key is numeric", () => {
    for (const id of Object.keys(relicFacts.relics)) {
      expect(id).toMatch(/^\d+$/);
    }
  });

  test("every relic entry has name + facts array", () => {
    for (const [id, entry] of Object.entries(relicFacts.relics)) {
      expect(entry).toMatchObject({
        name: expect.any(String),
        facts: expect.any(Array),
      });
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test("every fact has a recognized type and a text label", () => {
    for (const [id, entry] of Object.entries(relicFacts.relics)) {
      for (const fact of entry.facts) {
        expect(fact).toHaveProperty("type");
        expect(KNOWN_FACT_TYPES.has(fact.type))
          .toBe(true, `relic ${id} ${entry.name}: unknown fact type "${fact.type}"`);
        expect(typeof fact.text === "string" && fact.text.length > 0).toBe(true);
      }
    }
  });

  test("every relicFacts id is present in RELIC_ITEM_IDS (no orphaned entries)", () => {
    const itemIdSet = new Set(RELIC_ITEM_IDS.map(String));
    const orphans = Object.keys(relicFacts.relics).filter((id) => !itemIdSet.has(id));
    expect(orphans).toEqual([]);
  });
});

describe("relicFactsOverrides.json", () => {
  test("each override targets a real RELIC_ITEM_ID and has the correct shape", () => {
    const itemIdSet = new Set(RELIC_ITEM_IDS.map(String));
    for (const [id, entry] of Object.entries(relicFactsOverrides)) {
      if (id.startsWith("_")) continue; // skip _comment etc.
      expect(itemIdSet.has(id)).toBe(true, `override id ${id} not in RELIC_ITEM_IDS`);
      expect(entry).toMatchObject({
        name: expect.any(String),
        facts: expect.any(Array),
      });
      for (const fact of entry.facts) {
        expect(KNOWN_FACT_TYPES.has(fact.type))
          .toBe(true, `override ${id}: unknown fact type "${fact.type}"`);
      }
    }
  });
});

describe("legends.json", () => {
  test("is a non-empty array of canonical-shape legend objects", () => {
    expect(Array.isArray(legends)).toBe(true);
    expect(legends.length).toBeGreaterThan(0);
    for (const legend of legends) {
      expect(legend).toMatchObject({
        id: expect.any(String),
        swap: expect.any(Number),
        heal: expect.any(Number),
        elite: expect.any(Number),
        utilities: expect.any(Array),
      });
      expect(legend.utilities.length).toBe(3);
      for (const u of legend.utilities) expect(typeof u).toBe("number");
    }
  });

  test("legend ids are unique", () => {
    const ids = legends.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("professions.json", () => {
  test("each profession has id + name + icon + specializations array", () => {
    expect(Array.isArray(professions)).toBe(true);
    expect(professions.length).toBeGreaterThan(0);
    for (const p of professions) {
      expect(p).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        icon: expect.stringMatching(/^https:\/\//),
        specializations: expect.any(Array),
      });
    }
  });

  test("profession ids are unique", () => {
    const ids = professions.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("specializations.json", () => {
  test("each spec has numeric id + name + profession", () => {
    expect(Array.isArray(specializations)).toBe(true);
    expect(specializations.length).toBeGreaterThan(0);
    for (const s of specializations) {
      expect(s).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        profession: expect.any(String),
      });
    }
  });

  test("specialization ids are unique", () => {
    const ids = specializations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every spec's profession field points to a real profession", () => {
    const profIds = new Set(professions.map((p) => p.id));
    for (const s of specializations) {
      expect(profIds.has(s.profession))
        .toBe(true, `spec ${s.id} ${s.name}: profession "${s.profession}" not in professions.json`);
    }
  });
});

describe("upgradeIds.js", () => {
  test("every ID list contains only positive integers and has no duplicates", () => {
    const cases = [
      ["RUNE_ITEM_IDS", RUNE_ITEM_IDS],
      ["SIGIL_ITEM_IDS", SIGIL_ITEM_IDS],
      ["INFUSION_ITEM_IDS", INFUSION_ITEM_IDS],
      ["ENRICHMENT_ITEM_IDS", ENRICHMENT_ITEM_IDS],
      ["FOOD_ITEM_IDS", FOOD_ITEM_IDS],
      ["UTILITY_ITEM_IDS", UTILITY_ITEM_IDS],
      ["RELIC_ITEM_IDS", RELIC_ITEM_IDS],
    ];
    for (const [name, list] of cases) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      for (const id of list) {
        expect(Number.isInteger(id) && id > 0)
          .toBe(true, `${name} contains non-positive-integer: ${id}`);
      }
      expect(new Set(list).size).toBe(list.length, `${name} has duplicates`);
    }
  });

  test("WVW_INFUSION_IDS is a Set whose every member is in INFUSION_ITEM_IDS", () => {
    expect(WVW_INFUSION_IDS).toBeInstanceOf(Set);
    const infusionSet = new Set(INFUSION_ITEM_IDS);
    for (const id of WVW_INFUSION_IDS) {
      expect(infusionSet.has(id))
        .toBe(true, `WvW infusion ${id} missing from INFUSION_ITEM_IDS`);
    }
  });
});
