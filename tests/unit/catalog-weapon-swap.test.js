"use strict";

/**
 * Test that the Weapon Swap synthetic skill is injected into the catalog
 * for professions that support weapon swap, and omitted for those that don't.
 */

jest.mock("../../lib/gw2-balance-splits", () => ({
  getSkillSplit: () => null,
  getTraitSplit: () => null,
  getSkillPveFacts: () => null,
  getTraitPveFacts: () => null,
}));

jest.mock("../../src/main/gw2Data/fetch", () => ({
  GW2_API_ROOT: "https://api.guildwars2.com/v2",
  fetchCachedJson: jest.fn(),
  fetchGw2ByIds: jest.fn().mockResolvedValue([]),
  dedupeNumbers: (arr) => [...new Set(arr)],
}));

jest.mock("../../src/main/gw2Data/overrides", () => ({
  KNOWN_SKILL_DESCRIPTION_OVERRIDES: new Map(),
  KNOWN_SKILL_FACTS_OVERRIDES: new Map(),
  KNOWN_TRAIT_FACTS_OVERRIDES: new Map(),
  KNOWN_SKILL_SPEC_OVERRIDES: new Map(),
  KNOWN_SKILL_SLOT_OVERRIDES: new Map(),
  PHOTON_FORGE_SKILL_ID: 0, PHOTON_FORGE_BUNDLE: [],
  RADIANT_FORGE_SKILL_ID: 0, RADIANT_FORGE_BUNDLE: [], RADIANT_FORGE_FLIP_SKILLS: [],
  DEATH_SHROUD_SKILL_ID: 0, DEATH_SHROUD_BUNDLE: [], DEATH_SHROUD_FLIP_SKILLS: [],
  LICH_FORM_SKILL_ID: 0, LICH_FORM_BUNDLE: [], LICH_FORM_FLIP_SKILLS: [],
  SHADOW_SHROUD_SKILL_ID: 0, SHADOW_SHROUD_BUNDLE: [],
  FIREBRAND_TOME_CHAPTERS: new Map(),
  GUNSABER_SKILL_ID: 0, GUNSABER_BUNDLE: [], GUNSABER_BUNDLE_SKILLS: [],
  DRAGON_TRIGGER_SKILL_ID: 0, DRAGON_TRIGGER_BUNDLE: [], DRAGON_TRIGGER_BUNDLE_SKILLS: [],
  ELIXIR_TOOLBELT_OVERRIDES: new Map(),
  LEGEND_FLIP_OVERRIDES: new Map(),
  KNOWN_SKILL_ATTUNEMENT_OVERRIDES: new Map(),
  EVOKER_F5_EXTRA_VARIANTS: [],
  UNTAMED_UNLEASHED_AMBUSH: [],
}));

const { getProfessionCatalog, _setStaticData } = require("../../src/main/gw2Data/catalog");

const WEAPON_SWAP_ID = 999999;

function makeProfession(id, name, { noWeaponSwap = false } = {}) {
  return {
    id,
    name,
    icon: "",
    icon_big: "",
    specializations: [1],
    weapons: {},
    flags: noWeaponSwap ? ["NoWeaponSwap"] : [],
    skills: [],
    training: [],
  };
}

describe("Weapon Swap synthetic skill", () => {
  beforeEach(() => {
    // Reset static data before each test
    _setStaticData({
      professions: [
        makeProfession("Warrior", "Warrior"),
        makeProfession("Engineer", "Engineer", { noWeaponSwap: true }),
        makeProfession("Elementalist", "Elementalist", { noWeaponSwap: true }),
      ],
      specializations: [{ id: 1, name: "Test", elite: false, minor_traits: [], major_traits: [] }],
      legends: [],
    });
  });

  test("includes Weapon Swap for professions that support it", async () => {
    const catalog = await getProfessionCatalog("Warrior");
    const weaponSwap = catalog.skills.find((s) => s.id === WEAPON_SWAP_ID);
    expect(weaponSwap).toBeDefined();
    expect(weaponSwap.name).toBe("Weapon Swap");
    expect(weaponSwap.icon).toBeTruthy();
    expect(weaponSwap.description).toBeTruthy();
  });

  test("omits Weapon Swap for Engineer (NoWeaponSwap flag)", async () => {
    const catalog = await getProfessionCatalog("Engineer");
    const weaponSwap = catalog.skills.find((s) => s.id === WEAPON_SWAP_ID);
    expect(weaponSwap).toBeUndefined();
  });

  test("omits Weapon Swap for Elementalist (NoWeaponSwap flag)", async () => {
    const catalog = await getProfessionCatalog("Elementalist");
    const weaponSwap = catalog.skills.find((s) => s.id === WEAPON_SWAP_ID);
    expect(weaponSwap).toBeUndefined();
  });
});
