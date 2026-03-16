"use strict";

const { resolveEquippedWeaponSkills } = require("../../../src/renderer/modules/equipment-weapon-skills");

function makeCatalog() {
  const weaponSkills = [
    { id: 101, name: "Slash", slot: "Weapon_1", attunement: "", weaponType: "Sword", dualWield: "", flags: [] },
    { id: 102, name: "Savage Leap", slot: "Weapon_2", attunement: "", weaponType: "Sword", dualWield: "", flags: [] },
    { id: 103, name: "Hamstring", slot: "Weapon_3", attunement: "", weaponType: "Sword", dualWield: "", flags: [] },
    { id: 201, name: "Shield Bash", slot: "Weapon_4", attunement: "", weaponType: "Shield", dualWield: "", flags: [] },
    { id: 202, name: "Shield Stance", slot: "Weapon_5", attunement: "", weaponType: "Shield", dualWield: "", flags: [] },
    { id: 301, name: "Axe Throw", slot: "Weapon_1", attunement: "", weaponType: "Axe", dualWield: "", flags: [] },
    { id: 302, name: "Cyclone Axe", slot: "Weapon_2", attunement: "", weaponType: "Axe", dualWield: "", flags: [] },
    { id: 303, name: "Throw Axe", slot: "Weapon_3", attunement: "", weaponType: "Axe", dualWield: "", flags: [] },
  ];

  return {
    professionWeapons: {
      sword: {
        flags: ["Mainhand", "Offhand"],
        specialization: 0,
        skills: [
          { id: 101, slot: "Weapon_1", offhand: "", attunement: "" },
          { id: 102, slot: "Weapon_2", offhand: "", attunement: "" },
          { id: 103, slot: "Weapon_3", offhand: "", attunement: "" },
        ],
      },
      shield: {
        flags: ["Offhand"],
        specialization: 0,
        skills: [
          { id: 201, slot: "Weapon_4", offhand: "", attunement: "" },
          { id: 202, slot: "Weapon_5", offhand: "", attunement: "" },
        ],
      },
      axe: {
        flags: ["Mainhand"],
        specialization: 0,
        skills: [
          { id: 301, slot: "Weapon_1", offhand: "", attunement: "" },
          { id: 302, slot: "Weapon_2", offhand: "", attunement: "" },
          { id: 303, slot: "Weapon_3", offhand: "", attunement: "" },
        ],
      },
    },
    weaponSkillById: new Map(weaponSkills.map((s) => [s.id, s])),
    skillById: new Map(),
    specializationById: new Map(),
  };
}

function makeEditor(overrides = {}) {
  return {
    profession: "Warrior",
    equipment: { weapons: { mainhand1: "sword", offhand1: "shield", mainhand2: "axe", offhand2: "" } },
    activeWeaponSet: 1,
    activeAttunement: "",
    activeAttunement2: "",
    activeKit: 0,
    underwaterMode: false,
    specializations: [],
    ...overrides,
  };
}

describe("resolveEquippedWeaponSkills", () => {
  test("returns 5 weapon skills for active weapon set 1", () => {
    const catalog = makeCatalog();
    const editor = makeEditor();
    const result = resolveEquippedWeaponSkills(catalog, editor);
    expect(result).toHaveLength(5);
    expect(result[0]?.name).toBe("Slash");
    expect(result[1]?.name).toBe("Savage Leap");
    expect(result[2]?.name).toBe("Hamstring");
    expect(result[3]?.name).toBe("Shield Bash");
    expect(result[4]?.name).toBe("Shield Stance");
  });

  test("returns weapon skills for active weapon set 2", () => {
    const catalog = makeCatalog();
    const editor = makeEditor({ activeWeaponSet: 2 });
    const result = resolveEquippedWeaponSkills(catalog, editor);
    expect(result).toHaveLength(5);
    expect(result[0]?.name).toBe("Axe Throw");
    expect(result[1]?.name).toBe("Cyclone Axe");
    expect(result[2]?.name).toBe("Throw Axe");
    // offhand2 is empty so slots 4-5 should be null
    expect(result[3]).toBeNull();
    expect(result[4]).toBeNull();
  });

  test("returns array of 5 nulls when no weapons equipped", () => {
    const catalog = makeCatalog();
    const editor = makeEditor({
      equipment: { weapons: {} },
    });
    const result = resolveEquippedWeaponSkills(catalog, editor);
    expect(result).toHaveLength(5);
    expect(result.every((s) => s === null)).toBe(true);
  });

  test("returns empty array when catalog is null", () => {
    const editor = makeEditor();
    const result = resolveEquippedWeaponSkills(null, editor);
    expect(result).toEqual([]);
  });
});
