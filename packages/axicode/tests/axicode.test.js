"use strict";
const { encodeShareCode, decodeShareCode, isValidShareCode } = require("../src/index");

// Minimal Warrior/Berserker build fixture
const BERSERKER_BUILD = {
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
  skills: {
    heal: { id: 14402 }, utility: [{ id: 14404 }, { id: 14410 }, { id: 14405 }], elite: { id: 14355 },
  },
  underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
  equipment: {
    statPackage: "Berserker's",
    relic: "Relic of the Thief",
    food: "Bowl of Sweet and Spicy Butternut Squash Soup",
    utility: "Superior Sharpening Stone",
    enrichment: "",
    weapons: { mainhand1: "greatsword", offhand1: "", mainhand2: "axe", offhand2: "", aquatic1: "", aquatic2: "" },
    runes: { head: "24836", shoulders: "24836", chest: "24836", hands: "24836", legs: "24836", feet: "24836" },
    sigils: { mainhand1: ["24615", "24868"], offhand1: [], mainhand2: ["24615", ""], offhand2: [], aquatic1: [], aquatic2: [] },
    infusions: { head: "49432", shoulders: "49432", chest: "49432", hands: "49432", legs: "49432", feet: "49432",
      back: ["49432", "49432"], ring1: ["49432", "49432", "49432"], ring2: ["49432", "49432", "49432"],
      accessory1: "49432", accessory2: "49432",
      mainhand1: ["49432", "49432"], offhand1: [], mainhand2: ["49432", "49432"], offhand2: [] },
  },
  selectedLegends: ["", ""],
  selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  activeAttunement: "",
  activeAttunement2: "",
  activeKit: 0,
  activeWeaponSet: 1,
  allianceTacticsForm: 0,
  antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
  selectedUnderwaterLegends: ["", ""],
};

describe("encodeShareCode", () => {
  test("produces valid wrapper format", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(code).toMatch(/^<AxiForge:[A-Za-z]+:.+>$/);
  });

  test("label is elite spec name", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(code.startsWith("<AxiForge:Berserker:")).toBe(true);
  });

  test("label is profession name for core build", () => {
    const coreBuild = {
      ...BERSERKER_BUILD,
      specializations: BERSERKER_BUILD.specializations.map(s => ({ ...s, elite: false, name: s.elite ? "Arms" : s.name })),
    };
    const code = encodeShareCode(coreBuild);
    expect(code.startsWith("<AxiForge:Warrior:")).toBe(true);
  });
});

describe("isValidShareCode", () => {
  test("returns true for valid code", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    expect(isValidShareCode(code)).toBe(true);
  });
  test("returns false for random text", () => {
    expect(isValidShareCode("not a share code")).toBe(false);
  });
  test("returns false for GW2 chat link", () => {
    expect(isValidShareCode("[&DQYlPSkvMBc=]")).toBe(false);
  });
});

describe("decodeShareCode", () => {
  test("round-trip: preserves profession", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.profession).toBe("Warrior");
  });

  test("round-trip: preserves game mode", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.gameMode).toBe("pve");
  });

  test("round-trip: preserves specialization IDs", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.specializations[0].id).toBe(4);
    expect(decoded.specializations[1].id).toBe(36);
    expect(decoded.specializations[2].id).toBe(18);
  });

  test("round-trip: preserves trait choices", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.specializations[0].traitChoices).toEqual([1, 1, 1]);
    expect(decoded.specializations[2].traitChoices).toEqual([1, 1, 1]);
  });

  test("round-trip: preserves skill IDs", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.skills.healId).toBe(14402);
    expect(decoded.skills.utilityIds).toEqual([14404, 14410, 14405]);
    expect(decoded.skills.eliteId).toBe(14355);
  });

  test("round-trip: preserves stat package", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.statPackage).toBe("Berserker's");
  });

  test("round-trip: preserves weapon types", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.weapons.mainhand1).toBe("greatsword");
    expect(decoded.equipment.weapons.mainhand2).toBe("axe");
  });

  test("round-trip: preserves relic", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.relic).toBe("Relic of the Thief");
  });

  test("round-trip: preserves food", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.food).toBe("Bowl of Sweet and Spicy Butternut Squash Soup");
  });

  test("round-trip: preserves rune IDs", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.runes.head).toBe("24836");
  });

  test("round-trip: preserves sigils", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.sigils.mainhand1).toEqual(["24615", "24868"]);
    expect(decoded.equipment.sigils.mainhand2[0]).toBe("24615");
  });

  test("round-trip: preserves infusions (uniform)", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.infusions.head).toBe("49432");
  });

  test("throws on invalid format", () => {
    expect(() => decodeShareCode("not valid")).toThrow("Invalid build code format");
  });

  test("throws on unknown version", () => {
    expect(() => decodeShareCode("<AxiForge:Test:00000>")).toThrow();
  });
});

// ── Profession-Specific Encoding Tests ───────────────────────────────────────

describe("profession-specific round-trips", () => {
  function makeBuild(overrides) {
    const base = JSON.parse(JSON.stringify(BERSERKER_BUILD));
    return Object.assign(base, overrides);
  }

  test("Revenant (Vindicator) round-trip", () => {
    const build = makeBuild({
      profession: "Revenant",
      specializations: [
        BERSERKER_BUILD.specializations[0],
        BERSERKER_BUILD.specializations[1],
        { id: 62, name: "Vindicator", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
          majorTraitsByTier: BERSERKER_BUILD.specializations[2].majorTraitsByTier },
      ],
      selectedLegends: ["Legend2", "Legend7"],
      selectedUnderwaterLegends: ["Legend3", "Legend4"],
      allianceTacticsForm: 1,
    });
    const code = encodeShareCode(build);
    expect(code.startsWith("<AxiForge:Vindicator:")).toBe(true);

    const decoded = decodeShareCode(code);
    expect(decoded.profession).toBe("Revenant");
    expect(decoded.selectedLegends).toEqual(["Legend2", "Legend7"]);
    expect(decoded.allianceTacticsForm).toBe(1);
  });

  test("Ranger (Druid) round-trip", () => {
    const build = makeBuild({
      profession: "Ranger",
      specializations: [
        BERSERKER_BUILD.specializations[0],
        BERSERKER_BUILD.specializations[1],
        { id: 5, name: "Druid", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
          majorTraitsByTier: BERSERKER_BUILD.specializations[2].majorTraitsByTier },
      ],
      selectedPets: { terrestrial1: 46, terrestrial2: 59, aquatic1: 21, aquatic2: 40 },
    });
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.selectedPets.terrestrial1).toBe(46);
    expect(decoded.selectedPets.terrestrial2).toBe(59);
  });

  test("Elementalist (Weaver) round-trip", () => {
    const build = makeBuild({
      profession: "Elementalist",
      specializations: [
        BERSERKER_BUILD.specializations[0],
        BERSERKER_BUILD.specializations[1],
        { id: 56, name: "Weaver", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
          majorTraitsByTier: BERSERKER_BUILD.specializations[2].majorTraitsByTier },
      ],
      activeAttunement: "Fire",
      activeAttunement2: "Water",
    });
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.activeAttunement).toBe("Fire");
    expect(decoded.activeAttunement2).toBe("Water");
  });

  test("Thief (Antiquary) round-trip", () => {
    const build = makeBuild({
      profession: "Thief",
      specializations: [
        BERSERKER_BUILD.specializations[0],
        BERSERKER_BUILD.specializations[1],
        { id: 77, name: "Antiquary", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
          majorTraitsByTier: BERSERKER_BUILD.specializations[2].majorTraitsByTier },
      ],
      antiquaryArtifacts: { f2: 76582, f3: 76702, f4: 77288 },
    });
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.antiquaryArtifacts).toEqual({ f2: 76582, f3: 76702, f4: 77288 });
  });

  test("Engineer (Scrapper) round-trip", () => {
    const build = makeBuild({
      profession: "Engineer",
      specializations: [
        BERSERKER_BUILD.specializations[0],
        BERSERKER_BUILD.specializations[1],
        { id: 43, name: "Scrapper", elite: true, majorChoices: { 1: 2049, 2: 2039, 3: 2043 },
          majorTraitsByTier: BERSERKER_BUILD.specializations[2].majorTraitsByTier },
      ],
      activeKit: 5812,
    });
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.activeKit).toBe(5812);
  });

  test("Warrior active weapon set round-trip", () => {
    const build = makeBuild({ activeWeaponSet: 2 });
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.activeWeaponSet).toBe(2);
  });
});

// ── Per-Slot Mode Tests ──────────────────────────────────────────────────────

describe("per-slot mode round-trips", () => {
  function makeBuild(overrides) {
    const base = JSON.parse(JSON.stringify(BERSERKER_BUILD));
    return Object.assign(base, overrides);
  }

  test("uniform runes round-trip", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    for (const slot of ["head", "shoulders", "chest", "hands", "legs", "feet"]) {
      expect(decoded.equipment.runes[slot]).toBe("24836");
    }
  });

  test("per-slot runes (mixed) round-trip", () => {
    const build = makeBuild({});
    build.equipment.runes = {
      head: "24836", shoulders: "24836", chest: "24836",
      hands: "24836", legs: "24836", feet: "24691",
    };
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.runes.head).toBe("24836");
    expect(decoded.equipment.runes.feet).toBe("24691");
  });

  test("uniform infusions round-trip", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.infusions.head).toBe("49432");
    expect(decoded.equipment.infusions.accessory1).toBe("49432");
  });

  test("per-slot infusions (mixed) round-trip", () => {
    const build = makeBuild({});
    build.equipment.infusions.shoulders = "37131";
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.equipment.infusions.head).toBe("49432");
    expect(decoded.equipment.infusions.shoulders).toBe("37131");
  });

  test("underwater skills and weapons round-trip", () => {
    const build = makeBuild({
      underwaterSkills: {
        heal: { id: 14402 },
        utility: [{ id: 14404 }, { id: 14410 }, { id: 14405 }],
        elite: { id: 14355 },
      },
    });
    build.equipment.weapons.aquatic1 = "spear";
    build.equipment.sigils.aquatic1 = ["24615", "24868"];
    const code = encodeShareCode(build);
    const decoded = decodeShareCode(code);
    expect(decoded.underwaterSkills.healId).toBe(14402);
    expect(decoded.underwaterSkills.utilityIds).toEqual([14404, 14410, 14405]);
    expect(decoded.underwaterSkills.eliteId).toBe(14355);
    expect(decoded.equipment.weapons.aquatic1).toBe("spear");
    expect(decoded.equipment.sigils.aquatic1).toEqual(["24615", "24868"]);
  });
});

// ── Error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  test("truncated payload throws", () => {
    const code = encodeShareCode(BERSERKER_BUILD);
    const truncated = code.slice(0, code.length - 10) + ">";
    expect(() => decodeShareCode(truncated)).toThrow();
  });

  test("invalid Z85 characters throws", () => {
    expect(() => decodeShareCode("<AxiForge:Test:!!!invalid z85 chars!!!>")).toThrow();
  });
});
