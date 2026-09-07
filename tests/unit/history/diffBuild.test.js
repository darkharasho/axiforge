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
