"use strict";
const {
  buildFingerprint,
  indexByFingerprint,
  planBuildReuse,
  applyBuildReuse,
} = require("../../src/main/buildDedupe.js");

// Same minimal Warrior/Berserker fixture the share-code tests use — identity
// here IS the share code, so anything that round-trips there is a valid build.
const BASE = {
  profession: "Warrior",
  gameMode: "pve",
  specializations: [
    { id: 4, name: "Strength", elite: false, majorChoices: { 1: 1444, 2: 1449, 3: 1437 },
      majorTraitsByTier: { 1: [{ id: 1444 }, { id: 1447 }, { id: 2000 }], 2: [{ id: 1449 }, { id: 1448 }, { id: 1453 }], 3: [{ id: 1437 }, { id: 1440 }, { id: 1454 }] } },
    { id: 36, name: "Discipline", elite: false, majorChoices: { 1: 1413, 2: 1489, 3: 1369 },
      majorTraitsByTier: { 1: [{ id: 1413 }, { id: 1381 }, { id: 1415 }], 2: [{ id: 1489 }, { id: 1484 }, { id: 1709 }], 3: [{ id: 1369 }, { id: 1317 }, { id: 1657 }] } },
    { id: 18, name: "Berserker", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
      majorTraitsByTier: { 1: [{ id: 2049 }, { id: 2042 }, { id: 1928 }], 2: [{ id: 2039 }, { id: 2011 }, { id: 1977 }], 3: [{ id: 2043 }, { id: 2038 }, { id: 2060 }] } },
  ],
  skills: { heal: { id: 14402 }, utility: [{ id: 14404 }, { id: 14410 }, { id: 14405 }], elite: { id: 14355 } },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {
    statPackage: "Berserker's",
    relic: "Relic of the Thief",
    weapons: { mainhand1: "greatsword", offhand1: "", mainhand2: "axe", offhand2: "", aquatic1: "", aquatic2: "" },
    runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" },
    sigils: { mainhand1: ["24615", "24868"], offhand1: [], mainhand2: ["24615", ""], offhand2: [], aquatic1: [], aquatic2: [] },
    infusions: {},
  },
  selectedLegends: ["", ""],
  selectedUnderwaterLegends: ["", ""],
  selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
};

const build = (over = {}) => ({ ...BASE, id: "b-x", title: "A Build", ...over });

describe("buildFingerprint", () => {
  test("two builds with the same mechanics share a fingerprint", () => {
    expect(buildFingerprint(build({ id: "a" }))).toBe(buildFingerprint(build({ id: "b" })));
  });

  test("the things two people reasonably differ on are not identity", () => {
    const mine = build({
      id: "a", title: "My Firebrand", notes: "swap for CC", tags: ["raid"],
      folderId: "f1", createdAt: "2020-01-01T00:00:00.000Z", pinned: true, images: [],
    });
    expect(buildFingerprint(mine)).toBe(buildFingerprint(build({ id: "b" })));
  });

  test("a changed trait is a different build", () => {
    const other = build({
      specializations: BASE.specializations.map((s, i) =>
        i === 0 ? { ...s, majorChoices: { ...s.majorChoices, 1: 1447 } } : s
      ),
    });
    expect(buildFingerprint(other)).not.toBe(buildFingerprint(build()));
  });

  test("a changed weapon is a different build", () => {
    const other = build({
      equipment: { ...BASE.equipment, weapons: { ...BASE.equipment.weapons, mainhand1: "hammer" } },
    });
    expect(buildFingerprint(other)).not.toBe(buildFingerprint(build()));
  });

  test("the same build in a different game mode is a different build", () => {
    expect(buildFingerprint(build({ gameMode: "wvw" }))).not.toBe(buildFingerprint(build()));
  });

  test("a record with no profession has no identity", () => {
    expect(buildFingerprint({ id: "a", title: "empty" })).toBeNull();
    expect(buildFingerprint(null)).toBeNull();
  });

  test("a build the codec chokes on has no identity rather than throwing", () => {
    expect(buildFingerprint({ profession: "Warrior" })).toBeNull();
  });
});

describe("indexByFingerprint", () => {
  test("the longest-standing copy is the one everything points at", () => {
    const index = indexByFingerprint([build({ id: "old" }), build({ id: "new" })]);
    expect(index.get(buildFingerprint(build())).id).toBe("old");
  });

  test("trashed and archived builds are never offered", () => {
    const index = indexByFingerprint([
      build({ id: "trashed", deletedAt: "2026-01-01T00:00:00.000Z" }),
      build({ id: "archived", archivedAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(index.size).toBe(0);
  });

  test("builds with no identity are skipped, not collapsed together", () => {
    const index = indexByFingerprint([{ id: "a" }, { id: "b" }]);
    expect(index.size).toBe(0);
  });
});

describe("planBuildReuse", () => {
  test("matches an incoming build against the library and names both copies", () => {
    const incoming = [build({ id: "in-1", title: "Imported FB" })];
    const existing = [build({ id: "mine", title: "My FB" })];
    const { reuse, duplicates } = planBuildReuse(incoming, existing);
    expect(reuse.get("in-1").id).toBe("mine");
    expect(duplicates).toEqual([
      { index: 0, incomingTitle: "Imported FB", existingId: "mine", existingTitle: "My FB" },
    ]);
  });

  test("a build you do not have is not a duplicate", () => {
    const incoming = [build({ id: "in-1", gameMode: "wvw" })];
    const { reuse, duplicates } = planBuildReuse(incoming, [build({ id: "mine" })]);
    expect(reuse.size).toBe(0);
    expect(duplicates).toEqual([]);
  });

  test("an eligibility filter keeps out-of-team builds out of the match", () => {
    const incoming = [build({ id: "in-1" })];
    const existing = [build({ id: "elsewhere", folderId: "personal" })];
    const { reuse } = planBuildReuse(incoming, existing, {
      eligible: (b) => b.folderId === "team-root",
    });
    expect(reuse.size).toBe(0);
  });

  test("plans nothing when the library is empty", () => {
    expect(planBuildReuse([build({ id: "in-1" })], []).reuse.size).toBe(0);
  });

  test("keys by whatever the caller uses to identify an incoming build", () => {
    // A share code decodes to records with no id, so the object IS the key.
    const decoded = build({ id: undefined });
    const { reuse } = planBuildReuse([decoded], [build({ id: "mine" })], { keyOf: (b) => b });
    expect(reuse.get(decoded).id).toBe("mine");
  });
});

describe("applyBuildReuse", () => {
  const imported = () => ({
    comp: {
      id: "c1",
      buildIds: ["in-1", "in-2"],
      partyLines: [{ slots: ["in-1", "tag:cat-1", "in-2"] }],
      buildColors: { "in-1": "red", "in-2": "blue" },
      categories: [{ id: "cat-1", buildIds: ["in-1", "in-2"] }],
    },
    builds: [build({ id: "in-1" }), build({ id: "in-2", gameMode: "wvw" })],
  });

  test("every reference to a reused build moves together", () => {
    const reuse = new Map([["in-1", build({ id: "mine" })]]);
    const { comp, builds, reused } = applyBuildReuse(imported(), reuse);
    expect(comp.buildIds).toEqual(["mine", "in-2"]);
    expect(comp.partyLines[0].slots).toEqual(["mine", "tag:cat-1", "in-2"]);
    expect(comp.buildColors).toEqual({ mine: "red", "in-2": "blue" });
    expect(comp.categories[0].buildIds).toEqual(["mine", "in-2"]);
    expect(builds.map((b) => b.id)).toEqual(["in-2"]);
    expect(reused.map((b) => b.id)).toEqual(["mine"]);
  });

  test("an empty plan leaves the import exactly as it arrived", () => {
    const original = imported();
    const { comp, builds, reused } = applyBuildReuse(original, new Map());
    expect(comp).toBe(original.comp);
    expect(builds).toBe(original.builds);
    expect(reused).toEqual([]);
  });

  test("two incoming builds matching one record collapse the roster, not the slots", () => {
    const mine = build({ id: "mine" });
    const reuse = new Map([["in-1", mine], ["in-2", mine]]);
    const { comp, builds, reused } = applyBuildReuse(imported(), reuse);
    expect(comp.buildIds).toEqual(["mine"]);
    expect(comp.partyLines[0].slots).toEqual(["mine", "tag:cat-1", "mine"]);
    expect(comp.categories[0].buildIds).toEqual(["mine"]);
    expect(builds).toEqual([]);
    // Wired into the comp once, however many incoming builds matched it.
    expect(reused.map((b) => b.id)).toEqual(["mine"]);
  });

  test("a tag slot is never mistaken for a build id", () => {
    const reuse = new Map([["in-1", build({ id: "mine" })]]);
    const { comp } = applyBuildReuse(imported(), reuse);
    expect(comp.partyLines[0].slots[1]).toBe("tag:cat-1");
  });
});
