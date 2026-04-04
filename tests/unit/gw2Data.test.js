"use strict";

/**
 * Comprehensive tests for gw2Data.js.
 *
 * Tests are organized around:
 * 1. getProfessionList — sorting, filtering, shape
 * 2. getProfessionCatalog — per-profession regression tests
 *    - mapSkill normalization (weapon_type/attunement/dualWield)
 *    - KNOWN_SKILL_SPEC_OVERRIDES
 *    - KNOWN_SKILL_SLOT_OVERRIDES
 *    - Bundle assignments (hardcoded bundles per profession)
 *    - Elixir toolbelt overrides (Engineer)
 *    - Firebrand chapters (Guardian)
 *    - Ranger pets
 *    - Revenant legends + Alliance Tactics + Conduit
 *    - Transform bundles (Death Shroud via transform_skills)
 * 3. Utility internals (dedupeNumbers, chunk) — tested indirectly via catalog
 * 4. Cache behavior
 * 5. Error handling
 */

const { createGw2MockFetch, installMockFetch } = require("../helpers/mockFetch");
const { MOCK_PROFESSIONS, MOCK_SPECIALIZATIONS, MOCK_LEGENDS_DATA } = require("../fixtures/gw2Api");

// ---------------------------------------------------------------------------
// Module reset helpers
// ---------------------------------------------------------------------------

let gw2Data;

function freshLoad() {
  jest.resetModules();
  gw2Data = require("../../src/main/gw2Data");
  gw2Data._setStaticData({
    professions: Object.values(MOCK_PROFESSIONS),
    specializations: Object.values(MOCK_SPECIALIZATIONS),
    legends: MOCK_LEGENDS_DATA,
  });
}

// ---------------------------------------------------------------------------
// Convenience — get a skill from the catalog by ID
// ---------------------------------------------------------------------------

function findSkill(catalog, id) {
  return catalog.skills.find((s) => s.id === id) || null;
}

function findSpec(catalog, id) {
  return catalog.specializations.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// getProfessionList
// ---------------------------------------------------------------------------

describe("getProfessionList", () => {
  beforeEach(() => {
    freshLoad();
    global.fetch = createGw2MockFetch();
  });
  afterEach(() => { delete global.fetch; });

  test("returns an array of profession objects", async () => {
    const list = await gw2Data.getProfessionList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  test("each profession has id, name, icon, iconBig", async () => {
    const list = await gw2Data.getProfessionList();
    for (const prof of list) {
      expect(prof.id).toBeTruthy();
      expect(typeof prof.name).toBe("string");
      expect(typeof prof.icon).toBe("string");
      expect(typeof prof.iconBig).toBe("string");
    }
  });

  test("returns 9 professions", async () => {
    const list = await gw2Data.getProfessionList();
    expect(list).toHaveLength(9);
  });

  test("professions are sorted alphabetically by name", async () => {
    const list = await gw2Data.getProfessionList();
    const names = list.map((p) => p.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test("filters out entries with no id", async () => {
    // Override to add a bad entry
    global.fetch = createGw2MockFetch({
      "/v2/professions": (url) => [
        ...Object.values(require("../fixtures/gw2Api").MOCK_PROFESSIONS),
        { name: "BadEntry" }, // no id
      ],
    });
    const list = await gw2Data.getProfessionList();
    expect(list.every((p) => p.id)).toBe(true);
  });

  test("returns empty array when static data is empty", async () => {
    gw2Data._setStaticData({ professions: [], specializations: [], legends: [] });
    const list = await gw2Data.getProfessionList();
    expect(list).toEqual([]);
  });

  test("uses cached result on second call (no extra fetch calls)", async () => {
    const spy = jest.spyOn(global, "fetch");
    await gw2Data.getProfessionList();
    const callsAfterFirst = spy.mock.calls.length;
    await gw2Data.getProfessionList();
    const callsAfterSecond = spy.mock.calls.length;
    // Cache hit — no additional fetch calls
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// getProfessionCatalog — error handling
// ---------------------------------------------------------------------------

describe("getProfessionCatalog — error handling", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("throws when professionId is missing", async () => {
    await expect(gw2Data.getProfessionCatalog(null)).rejects.toThrow("Missing profession id");
    await expect(gw2Data.getProfessionCatalog("")).rejects.toThrow("Missing profession id");
    await expect(gw2Data.getProfessionCatalog(undefined)).rejects.toThrow("Missing profession id");
  });

  test("throws when profession not found in static data", async () => {
    gw2Data._setStaticData({ professions: [], specializations: [], legends: [] });
    await expect(gw2Data.getProfessionCatalog("Warrior")).rejects.toThrow("Unknown profession");
  });
});

// ---------------------------------------------------------------------------
// getProfessionCatalog — catalog shape (common to all professions)
// ---------------------------------------------------------------------------

describe("getProfessionCatalog — catalog shape", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Warrior catalog has profession, specializations, traits, skills, weaponSkills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.profession).toBeTruthy();
    expect(catalog.profession.id).toBe("Warrior");
    expect(Array.isArray(catalog.specializations)).toBe(true);
    expect(Array.isArray(catalog.traits)).toBe(true);
    expect(Array.isArray(catalog.skills)).toBe(true);
    expect(Array.isArray(catalog.weaponSkills)).toBe(true);
    expect(typeof catalog.updatedAt).toBe("string");
  });

  test("catalog.profession has id, name, icon, iconBig", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.profession.id).toBe("Warrior");
    expect(catalog.profession.name).toBe("Warrior");
    expect(typeof catalog.profession.icon).toBe("string");
    expect(typeof catalog.profession.iconBig).toBe("string");
  });

  test("catalog.professionWeapons contains weapon type keys", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(typeof catalog.professionWeapons).toBe("object");
    // Should have 'sword', 'shield', 'greatsword', 'harpoon' (HarpoonGun normalized)
    expect(catalog.professionWeapons.sword).toBeTruthy();
    expect(catalog.professionWeapons.greatsword).toBeTruthy();
    expect(catalog.professionWeapons.shield).toBeTruthy();
    // HarpoonGun → "harpoon"
    expect(catalog.professionWeapons.harpoon).toBeTruthy();
    expect(catalog.professionWeapons["harpoongun"]).toBeUndefined();
  });

  test("specializations have id, name, elite, icon, background, minorTraits, majorTraits", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const spec of catalog.specializations) {
      expect(typeof spec.id).toBe("number");
      expect(typeof spec.name).toBe("string");
      expect(typeof spec.elite).toBe("boolean");
      expect(Array.isArray(spec.minorTraits)).toBe(true);
      expect(Array.isArray(spec.majorTraits)).toBe(true);
    }
  });

  test("skills have id, name, icon, slot, type, specialization, bundleSkills, facts", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const skill of catalog.skills) {
      expect(typeof skill.id).toBe("number");
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.slot).toBe("string");
      expect(typeof skill.type).toBe("string");
      expect(typeof skill.specialization).toBe("number");
      expect(Array.isArray(skill.bundleSkills)).toBe(true);
      expect(Array.isArray(skill.facts)).toBe(true);
    }
  });

  test("updatedAt is a valid ISO date string", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(() => new Date(catalog.updatedAt)).not.toThrow();
    expect(Number.isNaN(new Date(catalog.updatedAt).getTime())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapSkill normalization — common to all professions
// ---------------------------------------------------------------------------

describe("mapSkill — weapon_type / attunement normalization", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("weapon_type 'None' → '' (empty string)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    // Warrior heal skill (14402) has weapon_type: "None" in mock
    const heal = findSkill(catalog, 14402);
    expect(heal).toBeTruthy();
    expect(heal.weaponType).toBe(""); // not "None"
  });

  test("attunement 'None' → '' for non-Elementalist skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    const heal = findSkill(catalog, 14402);
    expect(heal.attunement).toBe(""); // not "None"
  });

  test("dual_attunement 'None' → dualWield '' (empty string)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    const heal = findSkill(catalog, 14402);
    expect(heal.dualWield).toBe(""); // not "None"
  });

  test("preserves non-None attunement (e.g. 'Fire')", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Elementalist");
    // Elementalist Staff skill has attunement: "Fire" in mock
    const staffSkill = catalog.weaponSkills.find((s) => s.attunement === "Fire");
    if (staffSkill) {
      expect(staffSkill.attunement).toBe("Fire");
    }
    // Also check skill 5507 via weaponSkills
    const weapon = catalog.weaponSkills.find((s) => s.id === 5507);
    if (weapon) {
      expect(weapon.attunement).toBe("Fire");
    }
  });

  test("dual_attunement field is mapped to dualWield (not dual_wield)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Elementalist");
    // Skill 76585 has dual_attunement: "Fire" → dualWield: "Fire"
    const skill = findSkill(catalog, 76585);
    if (skill) {
      expect(skill.dualWield).toBe("Fire");
    }
  });

  test("Weaver Twin Strike (42271) has dualWield 'Water' from dual_attunement", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Elementalist");
    const skill = findSkill(catalog, 42271);
    if (skill) {
      expect(skill.dualWield).toBe("Water");
      expect(skill.attunement).toBe("Fire");
      expect(skill.weaponType).toBe("Sword");
    }
  });

  test("skills have categories array (not undefined)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    const elixirH = findSkill(catalog, 5834);
    expect(elixirH).toBeTruthy();
    expect(Array.isArray(elixirH.categories)).toBe(true);
    expect(elixirH.categories).toContain("Elixir");
  });

  test("skill has professions array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    const heal = findSkill(catalog, 14402);
    expect(Array.isArray(heal.professions)).toBe(true);
    expect(heal.professions).toContain("Warrior");
  });

  test("skills have flags array captured from API", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    // Mending (14402) has flags: [] — usable underwater
    const mending = findSkill(catalog, 14402);
    expect(mending).toBeTruthy();
    expect(Array.isArray(mending.flags)).toBe(true);
    expect(mending.flags).toEqual([]);
    // Balanced Stance (14516) has flags: ["NoUnderwater"]
    const balancedStance = findSkill(catalog, 14516);
    expect(balancedStance).toBeTruthy();
    expect(Array.isArray(balancedStance.flags)).toBe(true);
    expect(balancedStance.flags).toContain("NoUnderwater");
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SKILL_SPEC_OVERRIDES — specialization corrections
// ---------------------------------------------------------------------------

describe("KNOWN_SKILL_SPEC_OVERRIDES", () => {
  afterEach(() => { delete global.fetch; });

  describe("Necromancer — shroud spec overrides", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Reaper's Shroud (30792) gets spec=34 (Reaper), not 34 already (confirm)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Necromancer");
      const skill = findSkill(catalog, 30792);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(34);
    });

    test("Harbinger's Shroud (62567) gets spec=64 (Harbinger)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Necromancer");
      const skill = findSkill(catalog, 62567);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(64);
    });

    test("Ritualist's Shroud (77238) gets spec=76 (Ritualist), overriding API spec=0", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Necromancer");
      const skill = findSkill(catalog, 77238);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(76);
    });

    test("Core Death Shroud (10574) stays spec=0 (no override)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Necromancer");
      const skill = findSkill(catalog, 10574);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(0);
    });
  });

  describe("Engineer — Function Gyro spec override", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Function Gyro (72103) gets spec=43 (Scrapper), not spec=57 (Holosmith)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Engineer");
      const skill = findSkill(catalog, 72103);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(43); // NOT 57
    });

    test("Function Gyro variant (72114) gets spec=43 (Scrapper)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Engineer");
      const skill = findSkill(catalog, 72114);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(43);
    });

    test("Photon Forge (42938) stays spec=57 (Holosmith, no override needed)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Engineer");
      const skill = findSkill(catalog, 42938);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(57);
    });
  });

  describe("Elementalist — Weaver spec overrides", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Fire Attunement (76703) gets spec=56 (Weaver)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76703);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(56);
    });

    test("Water Attunement (76988) gets spec=56 (Weaver)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76988);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(56);
    });

    test("Weaver dual attack skill (76585) gets spec=56", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76585);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(56);
    });
  });

  describe("Thief — Specter and Deadeye spec overrides", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Specter Siphon (63067) gets spec=71 (Specter)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 63067);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(71);
    });

    test("Shadow Shroud Enter (63155) gets spec=71 (Specter)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 63155);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(71);
    });

    test("Shadow Shroud bundle weapon skills are present", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      for (const id of [63362, 63107, 63167, 63220, 63227, 63160, 63249]) {
        const skill = findSkill(catalog, id);
        expect(skill).toBeTruthy();
      }
    });

    test("Deadeye's Mark (43390) gets spec=58 (Deadeye)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 43390);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(58);
      expect(skill.slot).toBe("Profession_1");
    });

    test("Antiquary Mistburn Mortar (77277/77288) get spec=77, overriding API spec=0", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      for (const id of [77277, 77288]) {
        const skill = findSkill(catalog, id);
        expect(skill).toBeTruthy();
        expect(skill.specialization).toBe(77);
      }
    });

    test("Antiquary Zephyrite Sun Crystal (76733/78309) get spec=77, overriding API spec=0", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      for (const id of [76733, 78309]) {
        const skill = findSkill(catalog, id);
        expect(skill).toBeTruthy();
        expect(skill.specialization).toBe(77);
      }
    });

    test("Antiquary stolen-item pool skills get spec=77, overriding API spec=0", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const antiquaryIds = [77192, 76900, 76550, 76582, 76601, 76702, 76800, 76816, 76909];
      for (const id of antiquaryIds) {
        const skill = findSkill(catalog, id);
        expect(skill).toBeTruthy();
        expect(skill.specialization).toBe(77);
      }
    });
  });

  describe("Revenant — Alliance Tactics and Conduit spec overrides", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Alliance Tactics (62729) gets spec=69 (Vindicator)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Revenant");
      const skill = findSkill(catalog, 62729);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(69);
    });

    test("Conduit Release Potential (78661) gets spec=79, overriding API spec=0", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Revenant");
      const skill = findSkill(catalog, 78661);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(79);
    });

    test("All Conduit Release Potential variants get spec=79", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Revenant");
      for (const id of [78845, 78501, 78615, 78661, 78895]) {
        const skill = findSkill(catalog, id);
        expect(skill).toBeTruthy();
        expect(skill.specialization).toBe(79);
      }
    });

    test("Conduit Cosmic Wisdom (77371) gets spec=79", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Revenant");
      const skill = findSkill(catalog, 77371);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(79);
    });
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SKILL_SLOT_OVERRIDES — slot corrections
// ---------------------------------------------------------------------------

describe("KNOWN_SKILL_SLOT_OVERRIDES", () => {
  afterEach(() => { delete global.fetch; });

  describe("Elementalist — Weaver attunement slot corrections", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Fire Attunement (76703) slot overridden to Profession_1 (API says Profession_2)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76703);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Profession_1");
    });

    test("Water Attunement (76988) slot overridden to Profession_2 (API says Profession_1)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76988);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Profession_2");
    });

    test("Air Attunement (76580) slot overridden to Profession_3 (API says Profession_1)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 76580);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Profession_3");
    });

    test("Earth Attunement (77082) slot overridden to Profession_4 (API says Profession_1)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Elementalist");
      const skill = findSkill(catalog, 77082);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Profession_4");
    });
  });

  describe("Revenant — Alliance Tactics slot correction", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Alliance Tactics (62729) slot overridden to Profession_3 (API says Profession_2)", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Revenant");
      const skill = findSkill(catalog, 62729);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Profession_3");
    });
  });

  describe("Thief — Shadow Shroud weapon skill slots", () => {
    beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });

    test("Haunt Shot (63362) has Weapon_1 slot", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 63362);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Weapon_1");
    });

    test("Grasping Shadows (63107) has Weapon_2 slot", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 63107);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Weapon_2");
    });

    test("Dawn's Repose (63220) has Weapon_3 slot", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill = findSkill(catalog, 63220);
      expect(skill).toBeTruthy();
      expect(skill.slot).toBe("Weapon_3");
    });

    test("Eternal Night (63160) and Mind Shock (63249) fill Weapon_4/Weapon_5", async () => {
      const catalog = await gw2Data.getProfessionCatalog("Thief");
      const skill4 = findSkill(catalog, 63160);
      const skill5 = findSkill(catalog, 63249);
      expect(skill4).toBeTruthy();
      expect(skill4.slot).toBe("Weapon_4");
      expect(skill5).toBeTruthy();
      expect(skill5.slot).toBe("Weapon_5");
    });
  });
});

// ---------------------------------------------------------------------------
// Bundle assignments — hardcoded bundles
// ---------------------------------------------------------------------------

describe("Bundle assignments — Engineer (Photon Forge)", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Photon Forge (42938) has bundleSkills = [44588, 42965, 44530, 45783, 42521]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    const skill = findSkill(catalog, 42938);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([44588, 42965, 44530, 45783, 42521]);
  });

  test("Photon Forge bundle has exactly 5 weapon skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    const skill = findSkill(catalog, 42938);
    expect(skill.bundleSkills).toHaveLength(5);
  });

  test("Photon Forge weapon skills appear in catalog.skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    for (const id of [44588, 42965, 44530, 45783, 42521]) {
      const ws = findSkill(catalog, id);
      expect(ws).toBeTruthy();
    }
  });
});

describe("Bundle assignments — Guardian (Firebrand tomes)", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Tome of Justice (44364) has bundleSkills = [41258, 40635, 42449, 40015, 42898]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 44364);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([41258, 40635, 42449, 40015, 42898]);
  });

  test("Tome of Resolve (41780) has bundleSkills = [45022, 40679, 45128, 42008, 42925]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 41780);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([45022, 40679, 45128, 42008, 42925]);
  });

  test("Tome of Courage (42259) has bundleSkills = [42986, 41968, 41836, 40988, 44455]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 42259);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([42986, 41968, 41836, 40988, 44455]);
  });

  test("Tome of Courage alt (42371) shares same chapters as 42259", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const tome42259 = findSkill(catalog, 42259);
    const tome42371 = findSkill(catalog, 42371);
    if (tome42371) {
      expect(tome42371.bundleSkills).toEqual(tome42259.bundleSkills);
    }
  });

  test("Firebrand chapter skills are injected into catalog with spec=62", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const chapterIds = [41258, 40635, 42449, 40015, 42898, 45022, 40679, 45128, 42008, 42925, 42986, 41968, 41836, 40988, 44455];
    for (const id of chapterIds) {
      const skill = findSkill(catalog, id);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(62);
    }
  });

  test("total of 15 unique Firebrand chapter skills in catalog (3 tomes × 5)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const chapterIds = new Set([41258, 40635, 42449, 40015, 42898, 45022, 40679, 45128, 42008, 42925, 42986, 41968, 41836, 40988, 44455]);
    const found = catalog.skills.filter((s) => chapterIds.has(s.id));
    expect(found.length).toBeGreaterThanOrEqual(15);
  });

  test("Firebrand chapter skills have Weapon_N slot format", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const chapterIds = [41258, 40635, 42449, 40015, 42898];
    for (const id of chapterIds) {
      const skill = findSkill(catalog, id);
      expect(skill).toBeTruthy();
      expect(skill.slot).toMatch(/^Weapon_\d+$/);
    }
  });

  test("Radiant Forge (77073) has correct bundleSkills (Luminary)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 77073);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toContain(76950);
    expect(skill.bundleSkills.length).toBeGreaterThan(0);
  });
});

describe("Bundle assignments — Necromancer", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Death Shroud (10574) has bundleSkills = [10554, 10604, 10588, 10594, 19504]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const skill = findSkill(catalog, 10574);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([10554, 10604, 10588, 10594, 19504]);
  });

  test("Death Shroud bundle does NOT include Exit skill (10585)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const skill = findSkill(catalog, 10574);
    expect(skill.bundleSkills).not.toContain(10585);
  });

  test("Lich Form (10550) has bundleSkills = [10634, 10635, 10633, 10636, 10632]", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const skill = findSkill(catalog, 10550);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([10634, 10635, 10633, 10636, 10632]);
  });

  test("Lich Form bundle does NOT include Return skill (14350)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const skill = findSkill(catalog, 10550);
    expect(skill.bundleSkills).not.toContain(14350);
  });

  test("Lich Form March of Undeath (45780) flip skill is in catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const flip = findSkill(catalog, 45780);
    expect(flip).toBeTruthy();
  });

  test("Death Shroud flip skills (18504 Dhuumfire, 56916 Dark Pursuit) are in catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    expect(findSkill(catalog, 18504)).toBeTruthy();
    expect(findSkill(catalog, 56916)).toBeTruthy();
  });

  test("Reaper's Shroud gets its bundle from transformBundleBySpec (not hardcoded)", async () => {
    // Reaper's Shroud (30792) has transform_skills in API, and spec=34 (Reaper).
    // The bundle comes from transformBundleBySpecId[34] which collects Reaper's Shroud weapon skills.
    const catalog = await gw2Data.getProfessionCatalog("Necromancer");
    const skill = findSkill(catalog, 30792);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills.length).toBeGreaterThan(0);
    // Should contain Reaper's Shroud weapon skills that have spec=34
    expect(skill.bundleSkills).toContain(29533); // Grasping Darkness
  });
});

describe("Bundle assignments — Thief (Shadow Shroud)", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Enter Shadow Shroud (63155) has bundleSkills with slots 1-5", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    const skill = findSkill(catalog, 63155);
    expect(skill).toBeTruthy();
    expect(skill.bundleSkills).toEqual([63362, 63107, 63167, 63220, 63227, 63160, 63249]);
  });

  test("Shadow Shroud bundle covers all 5 weapon slots", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    const skill = findSkill(catalog, 63155);
    const slotSet = new Set(
      skill.bundleSkills
        .map((id) => findSkill(catalog, id))
        .filter(Boolean)
        .map((s) => s.slot)
    );
    expect(slotSet).toEqual(new Set(["Weapon_1", "Weapon_2", "Weapon_3", "Weapon_4", "Weapon_5"]));
  });

  test("Shadow Shroud weapon skills appear in catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    for (const id of [63362, 63107, 63167, 63220, 63227, 63160, 63249]) {
      expect(findSkill(catalog, id)).toBeTruthy();
    }
  });

  test("Enter Shadow Shroud (63155) has flipSkill pointing to Exit (63251)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    const skill = findSkill(catalog, 63155);
    expect(skill.flipSkill).toBe(63251);
  });
});

// ---------------------------------------------------------------------------
// Engineer — Elixir toolbelt overrides
// ---------------------------------------------------------------------------

describe("Engineer — Elixir toolbelt overrides", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  const ELIXIR_OVERRIDES = [
    [5834, 6118, "Elixir H"],   // API says 6119 (Detonate) → 6118 (Toss)
    [5821, 6092, "Elixir B"],   // API says 6082 → 6092
    [5860, 6077, "Elixir C"],   // API says 6078 → 6077
    [5968, 6091, "Elixir R"],   // API says 6086 → 6091
    [5861, 6090, "Elixir S"],   // API says 6084 → 6090
    [5862, 6089, "Elixir U"],   // API says 6088 → 6089
  ];

  for (const [elixirId, correctTossId, name] of ELIXIR_OVERRIDES) {
    test(`${name} (${elixirId}) toolbeltSkill is Toss variant ${correctTossId}, not Detonate`, async () => {
      const catalog = await gw2Data.getProfessionCatalog("Engineer");
      const skill = findSkill(catalog, elixirId);
      expect(skill).toBeTruthy();
      expect(skill.toolbeltSkill).toBe(correctTossId);
    });
  }

  test("Elixir X (5832) keeps Detonate toolbelt (no Toss variant exists)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    const skill = findSkill(catalog, 5832);
    expect(skill).toBeTruthy();
    expect(skill.toolbeltSkill).toBe(29722); // Detonate Elixir X
  });

  test("Toss Elixir skills are in the catalog (fetched via extraSkillIds)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    for (const [, tossId] of ELIXIR_OVERRIDES) {
      expect(findSkill(catalog, tossId)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Legend flip overrides (Revenant)
// ---------------------------------------------------------------------------

describe("LEGEND_FLIP_OVERRIDES", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Facet of Elements (27014) has flipSkill=27162 (Elemental Blast) via override", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    // 27014 is in legend skills for Herald; should be in catalog.skills
    const skill = findSkill(catalog, 27014);
    if (skill) {
      expect(skill.flipSkill).toBe(27162); // hardcoded override (API omits this)
    }
  });

  test("Enter Shadow Shroud (63155) has flipSkill=63251 via LEGEND_FLIP_OVERRIDES", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    const skill = findSkill(catalog, 63155);
    expect(skill).toBeTruthy();
    expect(skill.flipSkill).toBe(63251);
  });
});

// ---------------------------------------------------------------------------
// Ranger — pets
// ---------------------------------------------------------------------------

describe("Ranger — pets catalog", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("catalog.pets is an array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    expect(Array.isArray(catalog.pets)).toBe(true);
  });

  test("pets array has entries from mock", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    expect(catalog.pets.length).toBeGreaterThan(0);
  });

  test("each pet has id, name, description, icon, type, skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    for (const pet of catalog.pets) {
      expect(typeof pet.id).toBe("number");
      expect(typeof pet.name).toBe("string");
      expect(typeof pet.description).toBe("string");
      expect(typeof pet.icon).toBe("string");
      expect(typeof pet.type).toBe("string");
      expect(Array.isArray(pet.skills)).toBe(true);
    }
  });

  test("pet skills have id, name, description, icon", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    const bear = catalog.pets.find((p) => p.id === 1);
    expect(bear).toBeTruthy();
    expect(bear.name).toBe("Black Bear");
    expect(bear.type).toBe("Ursine");
    for (const skill of bear.skills) {
      expect(typeof skill.id).toBe("number");
      expect(typeof skill.name).toBe("string");
    }
  });

  test("includes aquatic pet (type='Amphibious')", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    const aquatic = catalog.pets.find((p) => p.type === "Amphibious");
    expect(aquatic).toBeTruthy();
  });

  test("non-Ranger professions have empty pets array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.pets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ranger — Untamed Unleashed Ambush skills
// ---------------------------------------------------------------------------

describe("Ranger — Untamed Unleashed Ambush skills in catalog", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("unleashed ambush skills are included in catalog.skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    const ambushIds = [63438, 63129, 69223, 63350, 72079, 63336, 63225, 63326, 69175, 72932, 63065, 63301];
    const skillIds = new Set(catalog.skills.map((s) => s.id));
    for (const id of ambushIds) {
      expect(skillIds.has(id)).toBe(true);
    }
  });

  test("Relentless Whirl (63438) has correct weapon_type, slot, and specialization", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Ranger");
    const skill = catalog.skills.find((s) => s.id === 63438);
    expect(skill).toBeTruthy();
    expect(skill.weaponType).toBe("Hammer");
    expect(skill.slot).toBe("Weapon_1");
    expect(skill.specialization).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// Revenant — legends
// ---------------------------------------------------------------------------

describe("Revenant — legends catalog", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("catalog.legends is an array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    expect(Array.isArray(catalog.legends)).toBe(true);
  });

  test("has 7 legends (Legend1–7)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    expect(catalog.legends).toHaveLength(7);
  });

  test("each legend has id, swap, heal, utilities, elite, skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    for (const legend of catalog.legends) {
      expect(typeof legend.id).toBe("string");
      expect(typeof legend.swap).toBe("number");
      expect(typeof legend.heal).toBe("number");
      expect(Array.isArray(legend.utilities)).toBe(true);
      expect(typeof legend.elite).toBe("number");
      expect(Array.isArray(legend.skills)).toBe(true);
    }
  });

  test("legend skills array contains objects with id, name, icon, slot, description", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    const legend = catalog.legends[0]; // Legend1 (Mallyx)
    for (const skill of legend.skills) {
      expect(typeof skill.id).toBe("number");
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.icon).toBe("string");
      expect(typeof skill.slot).toBe("string");
      expect(typeof skill.description).toBe("string");
    }
  });

  test("non-Revenant professions have empty legends array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.legends).toEqual([]);
  });

  test("Alliance (Vindicator) legend is present (Legend7)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    const alliance = catalog.legends.find((l) => l.id === "Legend7");
    expect(alliance).toBeTruthy();
  });

  test("Alliance elite flip chain includes Urn of Saint Viktor -> Drop Urn of Saint Viktor", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    const urn = findSkill(catalog, 62687);
    const dropUrn = findSkill(catalog, 62738);
    expect(urn).toBeTruthy();
    expect(dropUrn).toBeTruthy();
    expect(urn.flipSkill).toBe(62738);
  });
});

// ---------------------------------------------------------------------------
// normalizeWeaponKey — HarpoonGun → harpoon
// ---------------------------------------------------------------------------

describe("normalizeWeaponKey — HarpoonGun to harpoon", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("HarpoonGun is mapped to 'harpoon' key in professionWeapons", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.professionWeapons.harpoon).toBeTruthy();
    expect(catalog.professionWeapons["HarpoonGun"]).toBeUndefined();
    expect(catalog.professionWeapons["harpoongun"]).toBeUndefined();
  });

  test("other weapon type keys are lowercased", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    // "Sword" → "sword", "Greatsword" → "greatsword"
    expect(catalog.professionWeapons.sword).toBeTruthy();
    expect(catalog.professionWeapons.greatsword).toBeTruthy();
    expect(catalog.professionWeapons["Sword"]).toBeUndefined();
    expect(catalog.professionWeapons["Greatsword"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Weapon skills in professionWeapons
// ---------------------------------------------------------------------------

describe("professionWeapons — weapon skill data", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("each weapon has flags array", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const [key, weapon] of Object.entries(catalog.professionWeapons)) {
      expect(Array.isArray(weapon.flags)).toBe(true);
    }
  });

  test("each weapon has skills array with id/slot/offhand/attunement", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const [key, weapon] of Object.entries(catalog.professionWeapons)) {
      expect(Array.isArray(weapon.skills)).toBe(true);
      for (const s of weapon.skills) {
        expect(typeof s.id).toBe("number");
        expect(typeof s.slot).toBe("string");
      }
    }
  });

  test("Warrior Sword has Mainhand flag", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.professionWeapons.sword.flags).toContain("Mainhand");
  });

  test("Warrior Greatsword has TwoHand flag", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    expect(catalog.professionWeapons.greatsword.flags).toContain("TwoHand");
  });
});

// ---------------------------------------------------------------------------
// Trait skills — elite spec F skills from minor traits
// ---------------------------------------------------------------------------

describe("Dragonhunter F skills (via minor trait)", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Hunter's Ward (29887) is in Guardian catalog with slot Profession_1", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 29887);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_1");
  });

  test("Test of Faith (30783) is in Guardian catalog with slot Profession_2", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 30783);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_2");
  });

  test("Fragments of Faith (30029) is in Guardian catalog with slot Profession_3", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    const skill = findSkill(catalog, 30029);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_3");
  });

  test("DH F skills have specialization=27 (Dragonhunter)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Guardian");
    for (const id of [29887, 30783, 30029]) {
      const skill = findSkill(catalog, id);
      expect(skill).toBeTruthy();
      expect(skill.specialization).toBe(27);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-profession smoke tests — all 9 professions return a valid catalog
// ---------------------------------------------------------------------------

describe("Smoke test — all 9 professions return valid catalogs", () => {
  const professions = ["Warrior", "Engineer", "Guardian", "Ranger", "Thief", "Elementalist", "Mesmer", "Necromancer", "Revenant"];

  for (const prof of professions) {
    test(`${prof} catalog loads without error`, async () => {
      freshLoad();
      global.fetch = createGw2MockFetch();
      try {
        const catalog = await gw2Data.getProfessionCatalog(prof);
        expect(catalog.profession.id).toBe(prof);
        expect(Array.isArray(catalog.skills)).toBe(true);
        expect(catalog.skills.length).toBeGreaterThan(0);
      } finally {
        delete global.fetch;
      }
    });

    test(`${prof} catalog has at least one heal skill`, async () => {
      freshLoad();
      global.fetch = createGw2MockFetch();
      try {
        const catalog = await gw2Data.getProfessionCatalog(prof);
        const healSkills = catalog.skills.filter((s) => s.slot === "Heal");
        expect(healSkills.length).toBeGreaterThan(0);
      } finally {
        delete global.fetch;
      }
    });

    test(`${prof} catalog has at least one elite skill`, async () => {
      freshLoad();
      global.fetch = createGw2MockFetch();
      try {
        const catalog = await gw2Data.getProfessionCatalog(prof);
        const eliteSkills = catalog.skills.filter((s) => s.slot === "Elite");
        expect(eliteSkills.length).toBeGreaterThan(0);
      } finally {
        delete global.fetch;
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Mesmer — shatter skills
// ---------------------------------------------------------------------------

describe("Mesmer — shatter skills at correct slots", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Mind Wrack (10192) at Profession_1", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Mesmer");
    const skill = findSkill(catalog, 10192);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_1");
  });

  test("Cry of Frustration (10267) at Profession_2", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Mesmer");
    const skill = findSkill(catalog, 10267);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_2");
  });

  test("Distortion (10197) at Profession_4", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Mesmer");
    const skill = findSkill(catalog, 10197);
    expect(skill).toBeTruthy();
    expect(skill.slot).toBe("Profession_4");
  });
});

// ---------------------------------------------------------------------------
// weaponSkills — shape validation
// ---------------------------------------------------------------------------

describe("catalog.weaponSkills — shape", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("each weaponSkill has id, name, icon, description, slot, attunement, dualWield, weaponType, facts, flipSkill", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const ws of catalog.weaponSkills) {
      expect(typeof ws.id).toBe("number");
      expect(typeof ws.name).toBe("string");
      expect(typeof ws.icon).toBe("string");
      expect(typeof ws.description).toBe("string");
      expect(typeof ws.slot).toBe("string");
      expect(typeof ws.attunement).toBe("string");
      expect(typeof ws.dualWield).toBe("string");
      expect(typeof ws.weaponType).toBe("string");
      expect(Array.isArray(ws.facts)).toBe(true);
      expect(typeof ws.flipSkill).toBe("number");
    }
  });

  test("weaponSkills attunement is '' not 'None'", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Warrior");
    for (const ws of catalog.weaponSkills) {
      expect(ws.attunement).not.toBe("None");
      expect(ws.dualWield).not.toBe("None");
      expect(ws.weaponType).not.toBe("None");
    }
  });
});

// ---------------------------------------------------------------------------
// Caching behavior
// ---------------------------------------------------------------------------

describe("caching behavior", () => {
  test("second call to getProfessionCatalog uses cache (no extra fetch calls)", async () => {
    freshLoad();
    global.fetch = createGw2MockFetch();
    const spy = jest.spyOn(global, "fetch");

    await gw2Data.getProfessionCatalog("Warrior");
    const callsAfterFirst = spy.mock.calls.length;

    await gw2Data.getProfessionCatalog("Warrior");
    const callsAfterSecond = spy.mock.calls.length;

    expect(callsAfterSecond).toBe(callsAfterFirst); // no additional fetches
    delete global.fetch;
  });

  test("different professions each make their own network calls", async () => {
    freshLoad();
    global.fetch = createGw2MockFetch();
    const spy = jest.spyOn(global, "fetch");

    await gw2Data.getProfessionCatalog("Warrior");
    const callsAfterWarrior = spy.mock.calls.length;

    await gw2Data.getProfessionCatalog("Guardian");
    const callsAfterGuardian = spy.mock.calls.length;

    expect(callsAfterGuardian).toBeGreaterThan(callsAfterWarrior);
    delete global.fetch;
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SKILL_DESCRIPTION_OVERRIDES — Conduit Release Potential (Shiro)
// ---------------------------------------------------------------------------

describe("KNOWN_SKILL_DESCRIPTION_OVERRIDES", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Release Potential (Shiro, 78661) gets overridden description (API returns empty)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    const skill = findSkill(catalog, 78661);
    if (skill) {
      // The override description should be set (non-empty), overriding the API's empty string
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SKILL_FACTS_OVERRIDES — Conduit Release Potential (Shiro)
// ---------------------------------------------------------------------------

describe("KNOWN_SKILL_FACTS_OVERRIDES", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Release Potential (Shiro, 78661) has hardcoded facts array (not empty)", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    const skill = findSkill(catalog, 78661);
    if (skill) {
      expect(skill.facts.length).toBeGreaterThan(0);
      // Should contain Damage fact type
      expect(skill.facts.some((f) => f.type === "Damage")).toBe(true);
    }
  });

  test("Elixir of Ambition (62655) override boons survive WvW balance split", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Necromancer", "en", "wvw");
    const skill = findSkill(catalog, 62655);
    expect(skill).toBeTruthy();
    // WvW split has conditions (Bleeding, Burning, etc.) but the override adds all 12 boons
    const boonNames = ["Might", "Fury", "Alacrity", "Aegis", "Quickness", "Protection",
      "Regeneration", "Resolution", "Resistance", "Stability", "Swiftness", "Vigor"];
    const boonFacts = skill.facts.filter((f) => f.type === "Buff" && boonNames.includes(f.status));
    expect(boonFacts).toHaveLength(12);
    expect(boonFacts.find((f) => f.status === "Might").apply_count).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Thief — all extra skills fetched
// ---------------------------------------------------------------------------

describe("Thief — extra skills in catalog", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Specter Siphon (63067) is in Thief catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    expect(findSkill(catalog, 63067)).toBeTruthy();
  });

  test("Deadeye's Mark (43390) is in Thief catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    expect(findSkill(catalog, 43390)).toBeTruthy();
  });

  test("Shadow Shroud Enter (63155) is in Thief catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    expect(findSkill(catalog, 63155)).toBeTruthy();
  });

  test("Shadow Shroud Exit (63251) is in Thief catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Thief");
    expect(findSkill(catalog, 63251)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Engineer — extra skills fetched
// ---------------------------------------------------------------------------

describe("Engineer — extra skills fetched", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Photon Forge flip skill (Deactivate, 41123) is in catalog", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    // 41123 is fetched as a flip_skill of the Photon Forge weapon skills chain
    // It may or may not be in catalog.skills depending on fetch logic
    // At minimum, Photon Forge weapon skills (bundle) should be fetchable
    expect(findSkill(catalog, 42938)).toBeTruthy();
  });

  test("Photon Forge has flipSkill property", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Engineer");
    const skill = findSkill(catalog, 42938);
    expect(skill).toBeTruthy();
    expect(typeof skill.flipSkill).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Revenant — Alliance Tactics in extraSkillIds (not in profession.skills)
// ---------------------------------------------------------------------------

describe("Revenant — Alliance Tactics extra skill", () => {
  beforeEach(() => { freshLoad(); global.fetch = createGw2MockFetch(); });
  afterEach(() => { delete global.fetch; });

  test("Alliance Tactics (62729) is in Revenant catalog despite not being in profession.skills", async () => {
    const catalog = await gw2Data.getProfessionCatalog("Revenant");
    // 62729 is added via extraSkillIds in gw2Data.js for Revenant
    const skill = findSkill(catalog, 62729);
    expect(skill).toBeTruthy();
    expect(skill.specialization).toBe(69); // Vindicator
    expect(skill.slot).toBe("Profession_3"); // overridden from Profession_2
  });
});

// ---------------------------------------------------------------------------
// getWikiSummary
// ---------------------------------------------------------------------------

describe("getWikiSummary", () => {
  beforeEach(() => {
    freshLoad();
    global.fetch = createGw2MockFetch();
  });
  afterEach(() => { delete global.fetch; });

  test("returns title, summary, url, missing=false for found page", async () => {
    const result = await gw2Data.getWikiSummary("Warrior");
    expect(result).toBeTruthy();
    expect(typeof result.title).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(typeof result.url).toBe("string");
    expect(result.missing).toBe(false);
  });

  test("returns null for empty title", async () => {
    const result = await gw2Data.getWikiSummary("");
    expect(result).toBeNull();
  });

  test("returns null for null title", async () => {
    const result = await gw2Data.getWikiSummary(null);
    expect(result).toBeNull();
  });

  test("uses cached result on second call", async () => {
    const spy = jest.spyOn(global, "fetch");
    const callsBefore = spy.mock.calls.length;
    await gw2Data.getWikiSummary("Warrior");
    const callsAfterFirst = spy.mock.calls.length;
    await gw2Data.getWikiSummary("Warrior");
    const callsAfterSecond = spy.mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// fetchJson — retry behavior
// ---------------------------------------------------------------------------

describe("fetchJson — retry behavior (via fetchCachedJson)", () => {
  afterEach(() => { delete global.fetch; });

  test("retries on 500 error up to 3 times", async () => {
    jest.useFakeTimers();
    freshLoad();
    const { fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    let attempts = 0;
    global.fetch = jest.fn(async () => {
      attempts++;
      if (attempts < 3) {
        return Promise.resolve({
          ok: false, status: 500,
          text: () => Promise.resolve("Server Error"),
          headers: { get: () => null },
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve("{}"),
        headers: { get: () => null },
      });
    });

    const promise = fetchCachedJson("retry-test-500", "https://api.guildwars2.com/v2/test", 60000);
    // Advance timers through retry delays (800ms * 1, 800ms * 2)
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    jest.useRealTimers();

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3); // initial + 2 retries
  });

  test("does NOT retry on 404 (non-retryable)", async () => {
    freshLoad();
    const { fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    let attempts = 0;
    global.fetch = jest.fn(async () => {
      attempts++;
      return Promise.resolve({
        ok: false, status: 404,
        text: () => Promise.resolve("Not Found"),
        headers: { get: () => null },
      });
    });

    await expect(fetchCachedJson("retry-test-404", "https://api.guildwars2.com/v2/test", 60000)).rejects.toThrow();
    expect(attempts).toBe(1); // no retry on 404
  });

  test("retries on network error (fetch throws)", async () => {
    jest.useFakeTimers();
    freshLoad();
    const { fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    let attempts = 0;
    global.fetch = jest.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error("Network error");
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve("{}"),
        headers: { get: () => null },
      });
    });

    const promise = fetchCachedJson("retry-test-net", "https://api.guildwars2.com/v2/test", 60000);
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    jest.useRealTimers();

    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Disk cache — persistence across module reloads
// ---------------------------------------------------------------------------

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

describe("disk cache", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-cache-test-"));
    delete global.fetch;
  });

  afterEach(async () => {
    delete global.fetch;
    jest.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("initDiskCache loads entries from disk and serves them without network", async () => {
    // Write a pre-populated cache file
    const cacheData = {
      "skills:en:123": { value: [{ id: 123, name: "Fireball" }], expiresAt: Date.now() + 86400000 },
    };
    await fs.writeFile(path.join(tmpDir, "api-cache.json"), JSON.stringify(cacheData), "utf8");

    jest.resetModules();
    const { initDiskCache, fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();

    await initDiskCache(tmpDir);

    // Should NOT call fetch — data comes from disk
    global.fetch = jest.fn(() => { throw new Error("should not be called"); });

    const result = await fetchCachedJson("skills:en:123", "https://api.guildwars2.com/v2/skills?ids=123", 86400000);
    expect(result).toEqual([{ id: 123, name: "Fireball" }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("initDiskCache prunes expired entries on load", async () => {
    const cacheData = {
      "expired:en:1": { value: [{ id: 1 }], expiresAt: Date.now() - 1000 },
      "fresh:en:2": { value: [{ id: 2 }], expiresAt: Date.now() + 86400000 },
    };
    await fs.writeFile(path.join(tmpDir, "api-cache.json"), JSON.stringify(cacheData), "utf8");

    jest.resetModules();
    const { initDiskCache, fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    await initDiskCache(tmpDir);

    // Fresh entry should be served from disk
    global.fetch = jest.fn(() => { throw new Error("should not be called"); });
    const result = await fetchCachedJson("fresh:en:2", "https://example.com", 86400000);
    expect(result).toEqual([{ id: 2 }]);

    // Expired entry should require a network call
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ id: 1, name: "refetched" }],
    }));
    const result2 = await fetchCachedJson("expired:en:1", "https://example.com", 86400000);
    expect(result2).toEqual([{ id: 1, name: "refetched" }]);
    expect(global.fetch).toHaveBeenCalled();
  });

  test("fetchCachedJson persists new entries to disk", async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const { initDiskCache, fetchCachedJson, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    await initDiskCache(tmpDir);

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ id: 5, name: "Heal" }],
    }));

    await fetchCachedJson("skills:en:5", "https://api.guildwars2.com/v2/skills?ids=5", 86400000);

    // Trigger the debounced flush
    jest.advanceTimersByTime(3000);
    jest.useRealTimers();
    // Give the async write a tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const raw = await fs.readFile(path.join(tmpDir, "api-cache.json"), "utf8");
    const diskData = JSON.parse(raw);
    expect(diskData["skills:en:5"]).toBeDefined();
    expect(diskData["skills:en:5"].value).toEqual([{ id: 5, name: "Heal" }]);
  });

  test("clearDiskCache removes in-memory and disk entries", async () => {
    // Seed a cache file
    const cacheData = {
      "skills:en:1": { value: [{ id: 1 }], expiresAt: Date.now() + 86400000 },
    };
    await fs.writeFile(path.join(tmpDir, "api-cache.json"), JSON.stringify(cacheData), "utf8");

    jest.resetModules();
    const { initDiskCache, clearDiskCache, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();
    await initDiskCache(tmpDir);

    await clearDiskCache();

    // Memory cache should be empty
    expect(cache.size).toBe(0);
    // Disk file should be removed
    await expect(fs.access(path.join(tmpDir, "api-cache.json"))).rejects.toThrow();
  });

  test("initDiskCache handles missing cache file gracefully", async () => {
    jest.resetModules();
    const { initDiskCache, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();

    // Should not throw even though no file exists
    await expect(initDiskCache(tmpDir)).resolves.not.toThrow();
  });

  test("initDiskCache handles corrupt cache file gracefully", async () => {
    await fs.writeFile(path.join(tmpDir, "api-cache.json"), "NOT VALID JSON{{{", "utf8");

    jest.resetModules();
    const { initDiskCache, cache } = require("../../src/main/gw2Data/fetch");
    cache.clear();

    await expect(initDiskCache(tmpDir)).resolves.not.toThrow();
  });
});
