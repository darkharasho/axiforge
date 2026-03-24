"use strict";

/**
 * Tests for getEquippedWeaponSkills — weapon skill slot resolution.
 *
 * Verifies that mainhand weapons only fill slots 1-3 and offhand weapons
 * fill slots 4-5, unless the mainhand is two-handed (fills all 5).
 */

const { getEquippedWeaponSkills, applyUnleashWeaponFlip } = require("../../../src/renderer/modules/skills");

// Minimal mock catalog for Elementalist with dagger (main+off) and focus (off)
function makeCatalog() {
  const weaponSkills = [
    // Dagger mainhand Fire skills (slots 1-3)
    { id: 15718, name: "Drake's Breath",    slot: "Weapon_1", attunement: "Fire", weaponType: "Dagger", dualWield: "", flags: [] },
    { id: 5496,  name: "Ring of Fire",      slot: "Weapon_2", attunement: "Fire", weaponType: "Dagger", dualWield: "", flags: [] },
    { id: 5644,  name: "Burning Speed",     slot: "Weapon_3", attunement: "Fire", weaponType: "Dagger", dualWield: "", flags: [] },
    // Dagger offhand Fire skills (slots 4-5) — should NOT appear when dagger is mainhand only
    { id: 5691,  name: "Ring of Earth",     slot: "Weapon_4", attunement: "Fire", weaponType: "Dagger", dualWield: "", flags: [] },
    { id: 5557,  name: "Fire Grab",         slot: "Weapon_5", attunement: "Fire", weaponType: "Dagger", dualWield: "", flags: [] },
    // Focus offhand Fire skills (slots 4-5) — should appear when focus is offhand
    { id: 5497,  name: "Flamewall",         slot: "Weapon_4", attunement: "Fire", weaponType: "Focus",  dualWield: "", flags: [] },
    { id: 5678,  name: "Fire Shield",       slot: "Weapon_5", attunement: "Fire", weaponType: "Focus",  dualWield: "", flags: [] },
  ];

  return {
    professionWeapons: {
      dagger: {
        flags: ["Mainhand", "Offhand"],
        specialization: 0,
        skills: [
          { id: 15718, slot: "Weapon_1", offhand: "", attunement: "Fire" },
          { id: 5496,  slot: "Weapon_2", offhand: "", attunement: "Fire" },
          { id: 5644,  slot: "Weapon_3", offhand: "", attunement: "Fire" },
          { id: 5691,  slot: "Weapon_4", offhand: "", attunement: "Fire" },
          { id: 5557,  slot: "Weapon_5", offhand: "", attunement: "Fire" },
        ],
      },
      focus: {
        flags: ["Offhand"],
        specialization: 0,
        skills: [
          { id: 5497, slot: "Weapon_4", offhand: "", attunement: "Fire" },
          { id: 5678, slot: "Weapon_5", offhand: "", attunement: "Fire" },
        ],
      },
      greatsword: {
        flags: ["TwoHand"],
        specialization: 0,
        skills: [
          { id: 9001, slot: "Weapon_1", offhand: "", attunement: "" },
          { id: 9002, slot: "Weapon_2", offhand: "", attunement: "" },
          { id: 9003, slot: "Weapon_3", offhand: "", attunement: "" },
          { id: 9004, slot: "Weapon_4", offhand: "", attunement: "" },
          { id: 9005, slot: "Weapon_5", offhand: "", attunement: "" },
        ],
      },
    },
    weaponSkillById: new Map([
      ...weaponSkills.map((s) => [s.id, s]),
      // Two-handed greatsword skills
      [9001, { id: 9001, name: "GS1", slot: "Weapon_1", attunement: "", weaponType: "Greatsword", dualWield: "", flags: [] }],
      [9002, { id: 9002, name: "GS2", slot: "Weapon_2", attunement: "", weaponType: "Greatsword", dualWield: "", flags: [] }],
      [9003, { id: 9003, name: "GS3", slot: "Weapon_3", attunement: "", weaponType: "Greatsword", dualWield: "", flags: [] }],
      [9004, { id: 9004, name: "GS4", slot: "Weapon_4", attunement: "", weaponType: "Greatsword", dualWield: "", flags: [] }],
      [9005, { id: 9005, name: "GS5", slot: "Weapon_5", attunement: "", weaponType: "Greatsword", dualWield: "", flags: [] }],
    ]),
  };
}

describe("getEquippedWeaponSkills — mainhand vs offhand slot restriction", () => {
  const catalog = makeCatalog();

  test("dagger mainhand + focus offhand: slots 4-5 show focus skills, not dagger", () => {
    const result = getEquippedWeaponSkills(catalog, { mainhand: "dagger", offhand: "focus" }, "Fire");
    expect(result[0]?.id).toBe(15718); // Dagger slot 1
    expect(result[1]?.id).toBe(5496);  // Dagger slot 2
    expect(result[2]?.id).toBe(5644);  // Dagger slot 3
    expect(result[3]?.id).toBe(5497);  // Focus slot 4 (NOT dagger 5691)
    expect(result[4]?.id).toBe(5678);  // Focus slot 5 (NOT dagger 5557)
  });

  test("dagger mainhand + no offhand: slots 4-5 are empty", () => {
    const result = getEquippedWeaponSkills(catalog, { mainhand: "dagger", offhand: "" }, "Fire");
    expect(result[0]?.id).toBe(15718); // Dagger slot 1
    expect(result[1]?.id).toBe(5496);  // Dagger slot 2
    expect(result[2]?.id).toBe(5644);  // Dagger slot 3
    expect(result[3]).toBeNull();       // No offhand = empty slot 4
    expect(result[4]).toBeNull();       // No offhand = empty slot 5
  });

  test("dagger mainhand + dagger offhand: all 5 slots filled with dagger skills", () => {
    const result = getEquippedWeaponSkills(catalog, { mainhand: "dagger", offhand: "dagger" }, "Fire");
    expect(result[0]?.id).toBe(15718); // Dagger MH slot 1
    expect(result[1]?.id).toBe(5496);  // Dagger MH slot 2
    expect(result[2]?.id).toBe(5644);  // Dagger MH slot 3
    expect(result[3]?.id).toBe(5691);  // Dagger OH slot 4
    expect(result[4]?.id).toBe(5557);  // Dagger OH slot 5
  });

  test("two-handed greatsword fills all 5 slots from mainhand", () => {
    const result = getEquippedWeaponSkills(catalog, { mainhand: "greatsword", offhand: "" });
    expect(result[0]?.id).toBe(9001);
    expect(result[1]?.id).toBe(9002);
    expect(result[2]?.id).toBe(9003);
    expect(result[3]?.id).toBe(9004);
    expect(result[4]?.id).toBe(9005);
  });
});

describe("applyUnleashWeaponFlip — Untamed unleashed weapon skill swap", () => {
  // Simulate Ranger Hammer: 5 base skills + unleashed variants in weaponSkillById,
  // plus the Unleashed Ambush skill (Relentless Whirl) in skillById.
  function makeUnleashCatalog() {
    const baseSkills = [
      { id: 63118, name: "Hammer Strike",       slot: "Weapon_1", flipSkill: 63222, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 69167, name: "Wild Swing",           slot: "Weapon_2", flipSkill: 63335, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 69262, name: "Overbearing Smash",    slot: "Weapon_3", flipSkill: 63197, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 69340, name: "Savage Shock Wave",     slot: "Weapon_4", flipSkill: 63131, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 69212, name: "Thump",                slot: "Weapon_5", flipSkill: 63208, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
    ];
    const unleashSkills = [
      // 63222 is the auto-attack chain continuation, NOT the unleashed replacement for slot 1
      { id: 63222, name: "Hammer Slam",                   slot: "Weapon_1", flipSkill: 0, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 63335, name: "Unleashed Wild Swing",           slot: "Weapon_2", flipSkill: 0, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 63197, name: "Unleashed Overbearing Smash",    slot: "Weapon_3", flipSkill: 0, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 63131, name: "Unleashed Savage Shock Wave",     slot: "Weapon_4", flipSkill: 0, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
      { id: 63208, name: "Unleashed Thump",                slot: "Weapon_5", flipSkill: 0, weaponType: "Hammer", attunement: "", dualWield: "", flags: [] },
    ];
    // Unleashed Ambush skill from Unleashed Power trait (specialization=72)
    const ambushSkill = { id: 63438, name: "Relentless Whirl", slot: "Weapon_1", specialization: 72, weaponType: "Hammer", flipSkill: 0 };
    return {
      weaponSkillById: new Map([...baseSkills, ...unleashSkills].map((s) => [s.id, s])),
      skillById: new Map([[ambushSkill.id, ambushSkill]]),
    };
  }

  test("Weapon_1 shows Unleashed Ambush, slots 2-5 show unleashed flip variants", () => {
    const catalog = makeUnleashCatalog();
    const baseSkills = [63118, 69167, 69262, 69340, 69212].map((id) => catalog.weaponSkillById.get(id));
    const result = applyUnleashWeaponFlip(catalog, baseSkills);
    // Weapon_1: Unleashed Ambush (Relentless Whirl), NOT auto-attack chain (Hammer Slam)
    expect(result[0]?.id).toBe(63438);
    expect(result[0]?.name).toBe("Relentless Whirl");
    // Weapons 2-5: unleashed flip variants
    expect(result.slice(1).map((s) => s.id)).toEqual([63335, 63197, 63131, 63208]);
    expect(result.slice(1).map((s) => s.name)).toEqual([
      "Unleashed Wild Swing",
      "Unleashed Overbearing Smash",
      "Unleashed Savage Shock Wave",
      "Unleashed Thump",
    ]);
  });

  test("keeps Weapon_1 unchanged when no ambush skill exists in catalog", () => {
    const catalog = makeUnleashCatalog();
    catalog.skillById = new Map(); // empty — no ambush skills
    const baseSkills = [63118, 69167, 69262, 69340, 69212].map((id) => catalog.weaponSkillById.get(id));
    const result = applyUnleashWeaponFlip(catalog, baseSkills);
    expect(result[0]?.id).toBe(63118); // original Hammer Strike kept
    expect(result[1]?.id).toBe(63335); // slots 2-5 still flip
  });

  test("returns original skills for slots 2-5 when none have flipSkill", () => {
    const catalog = makeUnleashCatalog();
    const noFlipSkills = [
      { id: 1, name: "Skill 1", weaponType: "Hammer", flipSkill: 0 },
      { id: 2, name: "Skill 2", flipSkill: 0 },
    ];
    const result = applyUnleashWeaponFlip(catalog, noFlipSkills);
    expect(result[0]?.id).toBe(63438); // ambush still applies to Weapon_1
    expect(result[1]?.id).toBe(2);     // no flip for slot 2
  });

  test("preserves null entries in the weapon skill array", () => {
    const catalog = makeUnleashCatalog();
    const withNulls = [null, catalog.weaponSkillById.get(69167), null, null, null];
    const result = applyUnleashWeaponFlip(catalog, withNulls);
    expect(result[0]).toBeNull();
    expect(result[1]?.id).toBe(63335); // swapped
    expect(result[2]).toBeNull();
  });
});
