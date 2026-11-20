"use strict";

// Party Coverage counts every weapon skill a build can reach, so it has to read
// both weapon sets, not just whichever one the editor last had swapped in.
const { resolveAllWeaponSkills } = require("../../../src/renderer/modules/equipment-weapon-skills");

function skill(id, name, extra = {}) {
  return { id, name, facts: [], flags: [], ...extra };
}

function makeCatalog() {
  const weaponSkills = [
    skill(1, "Staff 1"), skill(2, "Staff 2"), skill(3, "Staff 3"), skill(4, "Staff 4"), skill(5, "Staff 5"),
    skill(11, "Mace 1"), skill(12, "Mace 2"), skill(13, "Mace 3"),
    skill(14, "Warhorn 4"),
    skill(15, "Warhorn 5", { facts: [{ type: "ComboFinisher", finisher_type: "Blast" }] }),
  ];
  const ref = (id, slot) => ({ id, slot: `Weapon_${slot}` });
  return {
    professionWeapons: {
      staff: { flags: ["TwoHand"], skills: [1, 2, 3, 4, 5].map((n) => ref(n, n)) },
      mace: { flags: ["Mainhand"], skills: [ref(11, 1), ref(12, 2), ref(13, 3)] },
      warhorn: { flags: ["Offhand"], skills: [ref(14, 4), ref(15, 5)] },
    },
    weaponSkillById: new Map(weaponSkills.map((s) => [s.id, s])),
    skillById: new Map(),
    specializationById: new Map(),
    traitById: new Map(),
  };
}

function makeEditor(profession, overrides = {}) {
  return {
    profession,
    specializations: [],
    activeWeaponSet: 1,
    equipment: { weapons: { mainhand1: "staff", mainhand2: "mace", offhand2: "warhorn" } },
    ...overrides,
  };
}

const names = (skills) => skills.filter(Boolean).map((s) => s.name).sort();

describe("resolveAllWeaponSkills — weapon sets", () => {
  test("includes the inactive weapon set's skills", () => {
    const result = names(resolveAllWeaponSkills(makeCatalog(), makeEditor("Ranger")));
    expect(result).toEqual(expect.arrayContaining(["Staff 1", "Staff 5", "Mace 1", "Warhorn 5"]));
    expect(result).toHaveLength(10);
  });

  test("includes set 1 when set 2 is the active one", () => {
    const result = names(resolveAllWeaponSkills(makeCatalog(), makeEditor("Ranger", { activeWeaponSet: 2 })));
    expect(result).toEqual(expect.arrayContaining(["Staff 1", "Mace 1", "Warhorn 5"]));
    expect(result).toHaveLength(10);
  });

  test("a build with no second set returns just set 1", () => {
    const editor = makeEditor("Ranger", { equipment: { weapons: { mainhand1: "staff" } } });
    expect(names(resolveAllWeaponSkills(makeCatalog(), editor))).toHaveLength(5);
  });

  test.each(["Elementalist", "Engineer"])("%s can't weapon swap, so only the active set counts", (profession) => {
    const result = names(resolveAllWeaponSkills(makeCatalog(), makeEditor(profession)));
    expect(result).toEqual(["Staff 1", "Staff 2", "Staff 3", "Staff 4", "Staff 5"]);
  });

  test("underwater reads both aquatic sets", () => {
    const editor = makeEditor("Ranger", {
      underwaterMode: true,
      equipment: { weapons: { aquatic1: "staff", aquatic2: "mace" } },
    });
    expect(names(resolveAllWeaponSkills(makeCatalog(), editor))).toHaveLength(8);
  });
});
