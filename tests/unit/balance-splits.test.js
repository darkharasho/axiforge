// Mock splits.json BEFORE requiring the module
jest.mock("../../lib/gw2-balance-splits/data/splits.json", () => ({
  version: 1,
  updatedAt: "2026-03-11T00:00:00Z",
  skills: {
    "1234": {
      name: "Test Skill",
      modes: {
        wvw: {
          facts: [
            { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }
          ]
        }
      }
    }
  },
  traits: {
    "5678": {
      name: "Test Trait",
      modes: {
        wvw: {
          facts: [
            { type: "Buff", text: "Might", status: "Might", duration: 5, apply_count: 2 }
          ]
        }
      }
    }
  }
}));

const { getSkillSplit, getTraitSplit, hasSplit } = require("../../lib/gw2-balance-splits");

describe("gw2-balance-splits", () => {
  describe("getSkillSplit", () => {
    test("returns null for pve mode", () => {
      expect(getSkillSplit(1234, "pve")).toBeNull();
    });

    test("returns split entry for known wvw skill", () => {
      const result = getSkillSplit(1234, "wvw");
      expect(result).not.toBeNull();
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].type).toBe("Damage");
      expect(result.facts[0].dmg_multiplier).toBe(0.5);
    });

    test("returns null for skill with no split", () => {
      expect(getSkillSplit(9999, "wvw")).toBeNull();
    });

    test("accepts numeric or string skill ID", () => {
      expect(getSkillSplit("1234", "wvw")).not.toBeNull();
      expect(getSkillSplit(1234, "wvw")).not.toBeNull();
    });
  });

  describe("getTraitSplit", () => {
    test("returns null for pve mode", () => {
      expect(getTraitSplit(5678, "pve")).toBeNull();
    });

    test("returns split entry for known wvw trait", () => {
      const result = getTraitSplit(5678, "wvw");
      expect(result).not.toBeNull();
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0].type).toBe("Buff");
    });

    test("returns null for trait with no split", () => {
      expect(getTraitSplit(9999, "wvw")).toBeNull();
    });
  });

  describe("hasSplit", () => {
    test("returns true for skill with split", () => {
      expect(hasSplit("skill", 1234)).toBe(true);
    });

    test("returns false for skill without split", () => {
      expect(hasSplit("skill", 9999)).toBe(false);
    });

    test("returns true for trait with split", () => {
      expect(hasSplit("trait", 5678)).toBe(true);
    });

    test("returns false for trait without split", () => {
      expect(hasSplit("trait", 9999)).toBe(false);
    });
  });
});

// Schema validation for splits.json (uses the real file, not the mock)
describe("splits.json schema validation", () => {
  const realSplits = JSON.parse(
    require("fs").readFileSync(
      require("path").join(__dirname, "../../lib/gw2-balance-splits/data/splits.json"),
      "utf-8"
    )
  );

  test("has required top-level fields", () => {
    expect(realSplits).toHaveProperty("version");
    expect(realSplits).toHaveProperty("updatedAt");
    expect(realSplits).toHaveProperty("skills");
    expect(realSplits).toHaveProperty("traits");
    expect(typeof realSplits.version).toBe("number");
    expect(typeof realSplits.updatedAt).toBe("string");
    expect(typeof realSplits.skills).toBe("object");
    expect(typeof realSplits.traits).toBe("object");
  });

  test("skill entries have valid structure", () => {
    for (const [id, entry] of Object.entries(realSplits.skills)) {
      expect(id).toMatch(/^\d+$/);
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("modes");
      expect(entry.modes).toHaveProperty("wvw");
      expect(Array.isArray(entry.modes.wvw.facts)).toBe(true);
      expect(entry.modes.wvw.facts.length).toBeGreaterThan(0);
      for (const fact of entry.modes.wvw.facts) {
        expect(fact).toHaveProperty("type");
        expect(typeof fact.type).toBe("string");
      }
    }
  });

  test("Carnivore trait skill (72369) WvW split uses value field matching API AttributeAdjust type (issue #121)", () => {
    const entry = realSplits.skills["72369"];
    expect(entry).toBeDefined();
    expect(entry.name).toBe("Carnivore (trait skill)");
    expect(entry.modes.wvw.complete).toBe(true);
    // Facts must use "value" field (not "duration") to correctly merge with
    // the GW2 API's AttributeAdjust facts — otherwise the PvE value persists.
    for (const fact of entry.modes.wvw.facts) {
      expect(fact.type).toBe("AttributeAdjust");
      expect(fact).toHaveProperty("value");
      expect(fact).not.toHaveProperty("duration");
      expect(fact.value).toBeLessThan(1000); // WvW values are 586/581, not PvE 3205
    }
  });

  test("trait entries have valid structure", () => {
    for (const [id, entry] of Object.entries(realSplits.traits)) {
      expect(id).toMatch(/^\d+$/);
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("modes");
      expect(entry.modes).toHaveProperty("wvw");
      expect(Array.isArray(entry.modes.wvw.facts)).toBe(true);
      expect(entry.modes.wvw.facts.length).toBeGreaterThan(0);
      for (const fact of entry.modes.wvw.facts) {
        expect(fact).toHaveProperty("type");
        expect(typeof fact.type).toBe("string");
      }
    }
  });
});
