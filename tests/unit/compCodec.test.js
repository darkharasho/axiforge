const { isValidCompCode, encodeComp, decodeComp } = require("../../src/main/compCodec");

describe("isValidCompCode", () => {
  test("returns true for valid comp code format", () => {
    expect(isValidCompCode("<AxiForge:Comp:somePayload>")).toBe(true);
  });

  test("returns false for empty payload", () => {
    expect(isValidCompCode("<AxiForge:Comp:>")).toBe(false);
  });

  test("returns false for build share code", () => {
    expect(isValidCompCode("<AxiForge:Berserker:abc123>")).toBe(false);
  });

  test("returns false for random text", () => {
    expect(isValidCompCode("hello world")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isValidCompCode("")).toBe(false);
  });
});

// Build fixture matching the axicode.encodeShareCode contract (same shape as buildShareCode.test.js)
const mockBuild = {
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
  selectedUnderwaterLegends: ["", ""],
  selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  activeAttunement: "",
  activeAttunement2: "",
  activeKit: 0,
  activeWeaponSet: 1,
  allianceTacticsForm: 0,
  antiquaryArtifacts: { f2: 0, f3: 0, f4: 0 },
};

describe("encodeComp", () => {
  test("produces a valid comp code string", () => {
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    expect(code.startsWith("<AxiForge:Comp:")).toBe(true);
    expect(code.endsWith(">")).toBe(true);
    expect(isValidCompCode(code)).toBe(true);
  });

  test("returns null when a build is missing from the map", () => {
    const comp = {
      name: "Test Comp",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["missing-id"] }],
      buildIds: ["missing-id"],
    };
    const result = encodeComp(comp, {});
    expect(result).toBeNull();
  });

  test("handles empty comp with no party lines", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    expect(isValidCompCode(code)).toBe(true);
  });
});

describe("decodeComp", () => {
  test("round-trips a comp with one build", () => {
    const comp = {
      name: "Round Trip",
      gameMode: "pve",
      partyLines: [{ id: "line1", capacity: 5, slots: ["b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded).not.toBeNull();
    expect(decoded.name).toBe("Round Trip");
    expect(decoded.gameMode).toBe("pve");
    expect(decoded.builds).toHaveLength(1);
    expect(decoded.builds[0].profession).toBe("Warrior");
    expect(decoded.partyLines).toHaveLength(1);
    expect(decoded.partyLines[0].capacity).toBe(5);
    expect(decoded.partyLines[0].slots).toHaveLength(1); // trailing empties stripped
    expect(decoded.partyLines[0].slots[0].profession).toBe("Warrior");
  });

  test("deduplicates builds — same build in multiple slots shares reference", () => {
    const comp = {
      name: "Dedup Test",
      gameMode: "wvw",
      partyLines: [{ id: "line1", capacity: 3, slots: ["b1", "b1", "b1"] }],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded.builds).toHaveLength(1);
    expect(decoded.partyLines[0].slots).toHaveLength(3);
    // All slots reference the same decoded build object
    expect(decoded.partyLines[0].slots[0]).toBe(decoded.partyLines[0].slots[1]);
    expect(decoded.partyLines[0].slots[1]).toBe(decoded.partyLines[0].slots[2]);
  });

  test("handles multiple party lines", () => {
    const comp = {
      name: "Multi Line",
      gameMode: "pve",
      partyLines: [
        { id: "p1", capacity: 5, slots: ["b1"] },
        { id: "p2", capacity: 5, slots: ["b1"] },
      ],
      buildIds: ["b1"],
    };
    const builds = { b1: mockBuild };

    const code = encodeComp(comp, builds);
    const decoded = decodeComp(code);

    expect(decoded.partyLines).toHaveLength(2);
    expect(decoded.partyLines[0].slots).toHaveLength(1);
    expect(decoded.partyLines[1].slots).toHaveLength(1);
  });

  test("returns null for invalid code", () => {
    expect(decodeComp("garbage")).toBeNull();
    expect(decodeComp("<AxiForge:Berserker:abc>")).toBeNull();
    expect(decodeComp("<AxiForge:Comp:>")).toBeNull();
  });

  test("returns null for corrupt payload", () => {
    expect(decodeComp("<AxiForge:Comp:not-valid-base64url!!!>")).toBeNull();
  });

  test("handles empty comp", () => {
    const comp = { name: "Empty", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);

    expect(decoded.name).toBe("Empty");
    expect(decoded.gameMode).toBeNull();
    expect(decoded.builds).toHaveLength(0);
    expect(decoded.partyLines).toHaveLength(0);
  });

  test("defaults missing name to Untitled Comp", () => {
    const comp = { name: "", gameMode: null, partyLines: [], buildIds: [] };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);
    expect(decoded.name).toBe("Untitled Comp");
  });

  test("clamps capacity to [1, 50]", () => {
    const comp = {
      name: "Clamp Test",
      gameMode: null,
      partyLines: [{ id: "l1", capacity: 100, slots: [] }],
      buildIds: [],
    };
    const code = encodeComp(comp, {});
    const decoded = decodeComp(code);
    expect(decoded.partyLines[0].capacity).toBe(50);
  });
});
