"use strict";

const { diff, applyOps, invert, classify } = require("../../../src/main/history/diffBuild");

function baseBuild() {
  return {
    id: "b1",
    version: 3,
    title: "Power Berserker",
    profession: "Warrior",
    gameMode: "pve",
    updatedAt: "2026-09-01T10:00:00.000Z",
    specializations: [
      {
        id: 45, name: "Chaos", elite: false,
        majorChoices: { 1: 675, 2: 668, 3: 1687 },
        majorTraitsByTier: { 1: [{ id: 670, name: "Method of Madness", description: "old text" }] },
        minorTraits: [{ id: 666, name: "Metaphysical Rejuvenation", description: "old text" }],
      },
    ],
    skills: {
      heal: { id: 9093, name: "Healing Signet", description: "old text" },
      utility: [
        { id: 14405, name: "Endure Pain" },
        { id: 14512, name: "Signet of Might" },
        { id: 14404, name: "Bull's Charge" },
      ],
      elite: { id: 14415, name: "Signet of Rage" },
    },
    underwaterSkills: { heal: null, utility: [], elite: null },
    equipment: {
      statPackage: "Berserker",
      relic: "Relic of Fireworks",
      food: "", utility: "", enrichment: "",
      slots: { head: "Zojja's Visage", chest: "Zojja's Breastplate" },
      weapons: { mainhand1: "Greatsword", offhand1: "" },
      runes: { head: "Superior Rune of the Scholar", chest: "Superior Rune of the Scholar" },
      sigils: { mainhand1: ["74326", "82876"], offhand1: [""] },
      infusions: { head: "", mainhand1: [] },
    },
    tags: ["raid"],
    notes: "opener: F1",
    folderId: "f1",
    compIds: [],
  };
}

describe("diffBuild — round-trip invariant", () => {
  const mutations = {
    "swap a rune": (b) => { b.equipment.runes.head = "Superior Rune of Durability"; },
    "swap a skill": (b) => { b.skills.utility[1] = { id: 14509, name: "Frenzy" }; },
    "empty the utility bar": (b) => { b.skills.utility = []; },
    "change a trait choice": (b) => { b.specializations[0].majorChoices[2] = 999; },
    "swap a whole spec line": (b) => { b.specializations[0] = { id: 51, name: "Defense", majorChoices: { 1: 1, 2: 2, 3: 3 } }; },
    "drop the spec line": (b) => { b.specializations = []; },
    "change stats": (b) => { b.equipment.statPackage = "Dragon"; },
    "swap a sigil": (b) => { b.equipment.sigils.mainhand1 = ["74326", "24615"]; },
    "clear a weapon": (b) => { b.equipment.weapons.mainhand1 = ""; },
    "edit notes": (b) => { b.notes = "opener: F1, then F2"; },
    "retag": (b) => { b.tags = ["raid", "strike"]; },
    "move folder": (b) => { b.folderId = "f2"; },
    "null out equipment": (b) => { b.equipment = null; },
    "add an unknown top-level key": (b) => { b.somethingNobodyPlanned = { a: [1, 2] }; },
    "remove a known key": (b) => { delete b.notes; },
    "derived catalog text changes": (b) => {
      b.specializations[0].majorTraitsByTier[1][0].description = "new text";
      b.skills.heal.description = "new text";
    },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    test(`${name} round-trips`, () => {
      const before = baseBuild();
      const after = baseBuild();
      mutate(after);
      const ops = diff(before, after);
      const rebuilt = applyOps(before, ops);
      expect(rebuilt).toEqual(after);
    });

    test(`${name} inverts`, () => {
      const before = baseBuild();
      const after = baseBuild();
      mutate(after);
      const ops = diff(before, after);
      expect(applyOps(after, invert(ops))).toEqual(before);
    });
  }

  test("identical documents produce no ops", () => {
    expect(diff(baseBuild(), baseBuild())).toEqual([]);
  });

  test("updatedAt and version alone produce no ops", () => {
    const after = baseBuild();
    after.updatedAt = "2026-09-02T11:00:00.000Z";
    after.version = 4;
    expect(diff(baseBuild(), after)).toEqual([]);
  });

  test("a first version diffs from null", () => {
    const ops = diff(null, baseBuild());
    expect(applyOps({}, ops)).toEqual(baseBuild());
  });
});

describe("diffBuild — op shapes", () => {
  test("a rune swap is a gear op naming the slot and part", () => {
    const after = baseBuild();
    after.equipment.runes.head = "Superior Rune of Durability";
    expect(diff(baseBuild(), after)).toEqual([
      { t: "gear", slot: "head", part: "rune",
        before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
    ]);
  });

  test("a utility swap names the numbered slot", () => {
    const after = baseBuild();
    after.skills.utility[1] = { id: 14509, name: "Frenzy" };
    const ops = diff(baseBuild(), after);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ t: "skill", slot: "utility2", uw: false });
    expect(ops[0].after).toEqual({ id: 14509, name: "Frenzy" });
  });

  test("a trait choice is a trait op with line and tier", () => {
    const after = baseBuild();
    after.specializations[0].majorChoices[2] = 999;
    expect(diff(baseBuild(), after)).toEqual([
      { t: "trait", line: 0, tier: 2, before: 668, after: 999 },
    ]);
  });

  test("an unknown key produces a raw op rather than being dropped", () => {
    const after = baseBuild();
    after.somethingNobodyPlanned = { a: [1, 2] };
    expect(diff(baseBuild(), after)).toEqual([
      { t: "raw", path: "somethingNobodyPlanned", before: undefined, after: { a: [1, 2] } },
    ]);
  });
});

describe("diffBuild — identity comparison", () => {
  test("a description rewrite on an otherwise identical skill is derived, not substantive", () => {
    const after = baseBuild();
    after.skills.heal.description = "new text";
    const ops = diff(baseBuild(), after);
    expect(ops.every((o) => o.t === "derived")).toBe(true);
    expect(classify(ops).substantive).toHaveLength(0);
  });

  test("a trait option catalog change is derived", () => {
    const after = baseBuild();
    after.specializations[0].majorTraitsByTier[1][0].description = "new text";
    expect(classify(diff(baseBuild(), after)).substantive).toHaveLength(0);
  });

  test("skills compare on id, not object identity", () => {
    const after = baseBuild();
    after.skills.elite = { id: 14415, name: "Signet of Rage", icon: "http://new.png" };
    expect(classify(diff(baseBuild(), after)).substantive).toHaveLength(0);
  });
});

describe("diffBuild — classify", () => {
  test("splits substantive, incidental and derived", () => {
    const after = baseBuild();
    after.equipment.runes.head = "Superior Rune of Durability";  // substantive
    after.folderId = "f2";                                       // incidental
    after.skills.heal.description = "new text";                  // derived
    const { substantive, incidental, derived } = classify(diff(baseBuild(), after));
    expect(substantive).toHaveLength(1);
    expect(incidental).toHaveLength(1);
    expect(derived).toHaveLength(1);
  });
});

// Cases the fixture above does not reach, taken from the real profile shape:
// multi-infusion slots (back/rings/two-handers hold 2-3), sigil arrays that
// change length, and containers that appear or disappear wholesale.
describe("diffBuild — real equipment shapes", () => {
  function gearedBuild() {
    return {
      id: "b2",
      equipment: {
        statPackage: "Berserker",
        slots: { head: "Zojja's Visage" },
        runes: {},
        weapons: { mainhand1: "Greatsword" },
        sigils: { mainhand1: ["74326", "82876"] },
        infusions: { head: "", ring1: ["a", "b", "c"], mainhand1: [] },
      },
      specializations: [
        { id: 1, name: "Strength", majorChoices: { 1: 1, 2: 2, 3: 3 } },
        { id: 2, name: "Discipline", majorChoices: { 1: 4, 2: 5, 3: 6 } },
      ],
      skills: { heal: null, utility: [null, null, null], elite: null },
    };
  }

  const cases = {
    "an infusion in a multi-infusion slot": (b) => { b.equipment.infusions.ring1[2] = "Q"; },
    "a sigil array that loses an entry": (b) => { b.equipment.sigils.mainhand1 = ["74326"]; },
    "an infusion array that gains an entry": (b) => { b.equipment.infusions.mainhand1 = ["n"]; },
    "a container that disappears": (b) => { delete b.equipment.sigils; },
    "a container that appears": (b) => { b.equipment.runes = { head: "Superior Rune of the Scholar" }; },
    "a spec line removed from the middle": (b) => { b.specializations = [b.specializations[1]]; },
    "a spec line appended": (b) => { b.specializations.push({ id: 3, name: "Berserker", majorChoices: { 1: 9 } }); },
    "a utility slot filled in": (b) => { b.skills.utility[1] = { id: 14509, name: "Frenzy" }; },
  };

  for (const [name, mutate] of Object.entries(cases)) {
    test(`${name} round-trips and inverts`, () => {
      const before = gearedBuild();
      const after = gearedBuild();
      mutate(after);
      const ops = diff(before, after);
      expect(applyOps(before, ops)).toEqual(after);
      expect(applyOps(after, invert(ops))).toEqual(before);
    });
  }

  test("a multi-infusion slot names the index in the slot, not the part", () => {
    const after = gearedBuild();
    after.equipment.infusions.ring1[2] = "Q";
    expect(diff(gearedBuild(), after)).toEqual([
      { t: "gear", slot: "ring1[2]", part: "infusion", before: "c", after: "Q" },
    ]);
  });

  test("a disappearing container travels as one raw op, not a deletion per key", () => {
    const after = gearedBuild();
    delete after.equipment.sigils;
    const ops = diff(gearedBuild(), after);
    expect(ops).toEqual([
      { t: "raw", path: "equipment.sigils", before: { mainhand1: ["74326", "82876"] }, after: undefined },
    ]);
  });

  test("diff does not mutate its inputs", () => {
    const before = gearedBuild();
    const after = gearedBuild();
    after.equipment.statPackage = "Dragon";
    diff(before, after);
    applyOps(before, diff(before, after));
    expect(before).toEqual(gearedBuild());
  });
});

describe("diffBuild — exhaustive walks", () => {
  test("an unnamed skills key changing alongside a named slot is not dropped", () => {
    const before = {
      skills: { heal: { id: 1, name: "A" }, utility: [], elite: null, toolbelt: ["x"] },
    };
    const after = {
      skills: { heal: { id: 2, name: "B" }, utility: [], elite: null, toolbelt: ["y"] },
    };
    const ops = diff(before, after);
    expect(ops).toEqual([
      { t: "skill", slot: "heal", uw: false, before: { id: 1, name: "A" }, after: { id: 2, name: "B" } },
      { t: "raw", path: "skills.toolbelt", before: ["x"], after: ["y"] },
    ]);
    expect(applyOps(before, ops)).toEqual(after);
    expect(applyOps(after, invert(ops))).toEqual(before);
  });

  // A sigil op has to carry an index in its part; the container name alone has
  // nowhere to write on apply. Both sides non-array is the case that reached it.
  test.each([
    ["both sides bare strings", "74326", "82876"],
    ["one side bare, one an array", "74326", ["74326", "82876"]],
  ])("a malformed sigil slot (%s) travels as a raw op", (_name, bv, av) => {
    const before = { equipment: { sigils: { mainhand1: bv } } };
    const after = { equipment: { sigils: { mainhand1: av } } };
    const ops = diff(before, after);
    expect(ops).toEqual([{ t: "raw", path: "equipment.sigils.mainhand1", before: bv, after: av }]);
    expect(applyOps(before, ops)).toEqual(after);
    expect(applyOps(after, invert(ops))).toEqual(before);
  });

  test("a gear op whose part names no container is ignored rather than misplaced", () => {
    const doc = { equipment: { slots: { head: "Zojja's Visage" } } };
    const bogus = [
      { t: "gear", slot: "mainhand1", part: "sigil", before: null, after: "74326" },
      { t: "gear", slot: "head", part: "nonsense", before: null, after: "x" },
    ];
    expect(applyOps(doc, bogus)).toEqual(doc);
  });

  test("a non-numeric trait tier does not become NaN", () => {
    const before = { specializations: [{ id: 45, majorChoices: { 1: 675, weird: 1 } }] };
    const after = { specializations: [{ id: 45, majorChoices: { 1: 675, weird: 2 } }] };
    const ops = diff(before, after);
    expect(ops).toEqual([
      { t: "raw", path: "specializations.0.majorChoices.weird", before: 1, after: 2 },
    ]);
    expect(applyOps(before, ops)).toEqual(after);
    expect(applyOps(after, invert(ops))).toEqual(before);
  });
});

describe("diffBuild — bookkeeping does not read as an edit", () => {
  test("publish receipts and library position never justify a version", () => {
    const before = { title: "T", sortOrder: 1, publishedAt: null, pinned: false, buildUrl: "" };
    const after = { title: "T", sortOrder: 7, publishedAt: "2026-09-06T00:00:00.000Z", pinned: true, buildUrl: "u" };
    const ops = diff(before, after);
    expect(ops.every((op) => op.t === "derived")).toBe(true);
    expect(classify(ops).substantive).toHaveLength(0);
    expect(applyOps(before, ops)).toEqual(after);
    expect(applyOps(after, invert(ops))).toEqual(before);
  });

  test("only sortOrder and publishedAt changing is not substantive", () => {
    const before = { title: "T", sortOrder: 1, publishedAt: null };
    const after = { title: "T", sortOrder: 2, publishedAt: "2026-09-06T00:00:00.000Z" };
    expect(classify(diff(before, after)).substantive).toHaveLength(0);
  });

  test("trash and archive stamps are incidental, alongside folderId", () => {
    const before = { deletedAt: null, trashBatchId: "", trashRoot: false, archiveRoot: false };
    const after = { deletedAt: "2026-09-06T00:00:00.000Z", trashBatchId: "batch-1", trashRoot: true, archiveRoot: false };
    const ops = diff(before, after);
    expect(ops.every((op) => op.t === "meta")).toBe(true);
    const { substantive, incidental, derived } = classify(ops);
    expect(substantive).toHaveLength(0);
    expect(derived).toHaveLength(0);
    expect(incidental).toHaveLength(3);
    expect(applyOps(before, ops)).toEqual(after);
  });

  test("legends, pets and images are build content, not bookkeeping", () => {
    const before = { selectedLegends: ["Shiro"], selectedPets: { land1: 1 }, morphSkillIds: [], images: [] };
    const after = {
      selectedLegends: ["Shiro", "Mallyx"],
      selectedPets: { land1: 2 },
      morphSkillIds: [7],
      images: [{ id: "i1", data: "base64" }],
    };
    const ops = diff(before, after);
    expect(ops.map((op) => [op.t, op.path])).toEqual([
      ["field", "images"],
      ["field", "selectedLegends"],
      ["field", "selectedPets"],
      ["field", "morphSkillIds"],
    ]);
    expect(classify(ops).substantive).toHaveLength(4);
    expect(applyOps(before, ops)).toEqual(after);
    expect(applyOps(after, invert(ops))).toEqual(before);
  });

  test("an image payload is carried whole, not digested", () => {
    const after = { images: [{ id: "i1", data: "AAAABBBB" }] };
    const [op] = diff({ images: [] }, after);
    expect(op).toEqual({ t: "field", path: "images", before: [], after: [{ id: "i1", data: "AAAABBBB" }] });
  });

  test("all three classes split apart in one patch", () => {
    const before = { title: "T", folderId: "f1", sortOrder: 1 };
    const after = { title: "U", folderId: "f2", sortOrder: 2 };
    const { substantive, incidental, derived } = classify(diff(before, after));
    expect(substantive.map((op) => op.path)).toEqual(["title"]);
    expect(incidental.map((op) => op.path)).toEqual(["folderId"]);
    expect(derived.map((op) => op.path)).toEqual(["sortOrder"]);
  });
});

describe("diffBuild — ops are snapshots, not references", () => {
  test("mutating the after document does not rewrite an op already recorded", () => {
    const before = { skills: { heal: { id: 1, name: "A" }, utility: [], elite: null } };
    const after = { skills: { heal: { id: 2, name: "B" }, utility: [], elite: null } };
    const ops = diff(before, after);
    after.skills.heal.name = "mutated";
    expect(ops[0].after).toEqual({ id: 2, name: "B" });
  });

  test("mutating the before document does not rewrite an op already recorded", () => {
    const before = { skills: { heal: { id: 1, name: "A" }, utility: [], elite: null } };
    const after = { skills: { heal: { id: 2, name: "B" }, utility: [], elite: null } };
    const ops = diff(before, after);
    before.skills.heal.name = "mutated";
    expect(ops[0].before).toEqual({ id: 1, name: "A" });
  });

  test("a nested value in a raw op is a copy", () => {
    const before = { somethingNobodyPlanned: { a: [1, 2] } };
    const after = { somethingNobodyPlanned: { a: [1, 3] } };
    const ops = diff(before, after);
    after.somethingNobodyPlanned.a.push(4);
    expect(ops[0].after).toEqual({ a: [1, 3] });
  });
});
