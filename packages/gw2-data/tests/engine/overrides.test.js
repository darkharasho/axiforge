"use strict";

const { loadOverrides, getOverride } = require("../../src/engine/overrides");

describe("overrides module", () => {
  let overrides;

  beforeAll(() => {
    overrides = loadOverrides();
  });

  describe("loadOverrides()", () => {
    it("returns a Map", () => {
      expect(overrides).toBeInstanceOf(Map);
    });

    it("contains exactly 7 entries", () => {
      expect(overrides.size).toBe(7);
    });

    it("trait:1719 has implicitFury: true", () => {
      const entry = overrides.get("trait:1719");
      expect(entry).toBeDefined();
      expect(entry.implicitFury).toBe(true);
    });

    it("trait:1016 has petStatOnly: true", () => {
      const entry = overrides.get("trait:1016");
      expect(entry).toBeDefined();
      expect(entry.petStatOnly).toBe(true);
    });

    it("trait:1765 has mightOverride with power and condi", () => {
      const entry = overrides.get("trait:1765");
      expect(entry).toBeDefined();
      expect(entry.mightOverride).toEqual({ power: 40, condi: 20 });
    });

    it("trait:2220 has allyTargeted array containing 'elixir'", () => {
      const entry = overrides.get("trait:2220");
      expect(entry).toBeDefined();
      expect(Array.isArray(entry.allyTargeted)).toBe(true);
      expect(entry.allyTargeted).toContain("elixir");
    });

    it("trait:1831 has no burstRechargeReduction (Primal Rage only grants Primal Bursts)", () => {
      const entry = overrides.get("trait:1831");
      expect(entry).toBeDefined();
      expect(entry.burstRechargeReduction).toBeUndefined();
    });
  });

  describe("getOverride()", () => {
    it("returns the entry for a known trait key", () => {
      const result = getOverride(overrides, "trait:1719");
      expect(result).not.toBeNull();
      expect(result.implicitFury).toBe(true);
    });

    it("returns null for an unknown key", () => {
      const result = getOverride(overrides, "trait:9999");
      expect(result).toBeNull();
    });

    it("returns null for an empty string key", () => {
      const result = getOverride(overrides, "");
      expect(result).toBeNull();
    });
  });
});
