"use strict";

const {
  _parsePreloadFromHtml,
  _buildStatLookup,
  _normalizeStatName,
  _lookupUpgradeName,
  _lookupBuffName,
  _mapEquipment,
} = require("../../src/main/gw2skillsImport");

// ── _parsePreloadFromHtml ─────────────────────────────────────────────────────

describe("_parsePreloadFromHtml", () => {
  function makeHtml(preloadJs) {
    return `
      <script>
      window.onload = function() {
        var SI = null;
        E = new BuildEditor({
          version: "9.1.2",
          balance: "2026/02/24 rev. 1",
          dbid: 1772970067,
          showinfo: SI || undefined,
          preload: ${preloadJs}
        });
        E.init();
      };
      </script>
    `;
  }

  it("extracts dbid from HTML", () => {
    const html = makeHtml(`{ chatlink: "AAAA", mode: "pve", equipment: {} }`);
    const result = _parsePreloadFromHtml(html);
    expect(result.dbid).toBe("1772970067");
  });

  it("extracts chatlink from preload", () => {
    const html = makeHtml(`{ chatlink: "DQYfHSkb", mode: "pve", equipment: {} }`);
    const result = _parsePreloadFromHtml(html);
    expect(result.preload.chatlink).toBe("DQYfHSkb");
  });

  it("extracts mode from preload", () => {
    const html = makeHtml(`{ chatlink: "DQYfHSkb", mode: "wvw", equipment: {} }`);
    const result = _parsePreloadFromHtml(html);
    expect(result.preload.mode).toBe("wvw");
  });

  it("extracts equipment.buff.food from preload", () => {
    const html = makeHtml(`{
      chatlink: "DQYfHSkb",
      mode: "pve",
      equipment: {
        weapon: {},
        armor: {},
        trinket: {},
        buff: { food: 534, utility: 40 },
        relic: 267
      }
    }`);
    const result = _parsePreloadFromHtml(html);
    expect(result.preload.equipment.buff.food).toBe(534);
    expect(result.preload.equipment.buff.utility).toBe(40);
  });

  it("throws if BuildEditor is not found", () => {
    expect(() => _parsePreloadFromHtml("<html>no editor here</html>")).toThrow();
  });

  it("throws if no preload in BuildEditor", () => {
    const html = `<script>new BuildEditor({ version: "1", dbid: 123 });</script>`;
    expect(() => _parsePreloadFromHtml(html)).toThrow();
  });
});

// ── _buildStatLookup ──────────────────────────────────────────────────────────

describe("_buildStatLookup", () => {
  const mockDb = {
    profile: {
      desc: ["id", "img", "profile", "name"],
      rows: [
        [191, "G/x", 1, "Berserker's Sword"],
        [273, "G/y", 1, "Berserker's Helm"],
        [356, "G/z", 36, "Viper's Ring"],
      ],
    },
    prfltype: {
      desc: ["id", "key", "name"],
      rows: [
        [1, "berserker", "Berserker"],
        [36, "viper", "Viper"],
      ],
    },
  };

  it("maps profile id → prfltype name", () => {
    const lookup = _buildStatLookup(mockDb);
    expect(lookup.get(191)).toBe("Berserker");
    expect(lookup.get(273)).toBe("Berserker");
    expect(lookup.get(356)).toBe("Viper");
  });

  it("returns undefined for unknown profile id", () => {
    const lookup = _buildStatLookup(mockDb);
    expect(lookup.get(999)).toBeUndefined();
  });
});

// ── _normalizeStatName ────────────────────────────────────────────────────────

describe("_normalizeStatName", () => {
  it("maps Berserker → Berserker's", () => {
    expect(_normalizeStatName("Berserker")).toBe("Berserker's");
  });
  it("maps Viper → Viper's", () => {
    expect(_normalizeStatName("Viper")).toBe("Viper's");
  });
  it("maps Celestial → Celestial (no apostrophe)", () => {
    expect(_normalizeStatName("Celestial")).toBe("Celestial");
  });
  it("maps Grieving → Grieving (no apostrophe)", () => {
    expect(_normalizeStatName("Grieving")).toBe("Grieving");
  });
  it("strips WvW suffix from stat names", () => {
    expect(_normalizeStatName("Berserker (WvW)")).toBe("Berserker's");
  });
  it("returns empty string for empty input", () => {
    expect(_normalizeStatName("")).toBe("");
    expect(_normalizeStatName(null)).toBe("");
    expect(_normalizeStatName(undefined)).toBe("");
  });
  it("passes through unknown stat names unchanged", () => {
    expect(_normalizeStatName("SomeNewStat")).toBe("SomeNewStat");
  });
});

// ── _lookupUpgradeName ────────────────────────────────────────────────────────

describe("_lookupUpgradeName", () => {
  const upgradeMap = new Map([
    [5,   [5,  "P/x", 5, 2, "Superior Sigil of Force",  "Superior Sigil of Force"]],
    [134, [134, "P/y", 5, 1, "Superior Rune of the Scholar", "Superior Rune of the Scholar"]],
    [344, [344, "P/z", 6, 7, "+5 Agony Infusion", "+5 Agony Infusion"]],
  ]);
  const nameIdx = 4;

  it("returns the upgrade name by id", () => {
    expect(_lookupUpgradeName(upgradeMap, nameIdx, 5)).toBe("Superior Sigil of Force");
    expect(_lookupUpgradeName(upgradeMap, nameIdx, 134)).toBe("Superior Rune of the Scholar");
    expect(_lookupUpgradeName(upgradeMap, nameIdx, 344)).toBe("+5 Agony Infusion");
  });

  it("returns empty string for id 0", () => {
    expect(_lookupUpgradeName(upgradeMap, nameIdx, 0)).toBe("");
  });

  it("returns empty string for unknown id", () => {
    expect(_lookupUpgradeName(upgradeMap, nameIdx, 999)).toBe("");
  });
});

// ── _lookupBuffName ────────────────────────────────────────────────────────────

describe("_lookupBuffName", () => {
  const buffMap = new Map([
    [534, [534, "j/x", 5, 80, 1, "Cilantro Lime Sous-Vide Steak"]],
    [40,  [40,  "b/x", 5, 80, 2, "Toxic Focusing Crystal"]],
  ]);
  const nameIdx = 5;

  it("returns food name", () => {
    expect(_lookupBuffName(buffMap, nameIdx, 534)).toBe("Cilantro Lime Sous-Vide Steak");
  });

  it("returns utility name", () => {
    expect(_lookupBuffName(buffMap, nameIdx, 40)).toBe("Toxic Focusing Crystal");
  });

  it("returns empty string for id 0", () => {
    expect(_lookupBuffName(buffMap, nameIdx, 0)).toBe("");
  });
});

// ── _mapEquipment ─────────────────────────────────────────────────────────────

describe("_mapEquipment", () => {
  // Minimal mock tables
  const statLookup = new Map([
    [191, "Berserker"],  // weapon
    [273, "Berserker"],  // armor
    [356, "Viper"],      // ring
    [377, "Berserker"],  // amulet
    [425, "Marauder"],   // back
  ]);
  const upgradeMap = new Map([
    [5,   [5,   "P", 5, 2, "Superior Sigil of Force"]],
    [29,  [29,  "P", 5, 2, "Superior Sigil of Accuracy"]],
    [48,  [48,  "P", 5, 2, "Superior Sigil of Air"]],
    [134, [134, "P", 5, 1, "Superior Rune of the Scholar"]],
    [344, [344, "P", 6, 7, "+5 Agony Infusion"]],
    [345, [345, "P", 6, 7, "Mystical +9 Agony Infusion"]],
  ]);
  const upgradeNameIdx = 4;
  const buffMap = new Map([
    [534, [534, "j", 5, 80, 1, "Cilantro Lime Sous-Vide Steak"]],
    [40,  [40,  "b", 5, 80, 2, "Toxic Focusing Crystal"]],
  ]);
  const buffNameIdx = 5;

  const mockEq = {
    weapon: {
      w11: { item: [191, 1], up: [[5, 0], [29, 0]], inf: [344, 344] },
      w12: { item: [191, 1], up: [[29, 0]],          inf: [344, 0]  },
    },
    armor: {
      helm:      { item: [273, 1], up: [[134, 0]], inf: [344] },
      shoulders: { item: [273, 1], up: [[134, 0]], inf: [344] },
      coat:      { item: [273, 1], up: [[134, 0]], inf: [344] },
      gloves:    { item: [273, 1], up: [[134, 0]], inf: [344] },
      leggings:  { item: [273, 1], up: [[134, 0]], inf: [344] },
      boots:     { item: [273, 1], up: [[134, 0]], inf: [344] },
    },
    trinket: {
      amulet:   { item: [377, 1], up: [[0, 0]],  inf: [0]         },
      ring1:    { item: [356, 1], up: [[0, 0]],  inf: [344, 344, 344] },
      ring2:    { item: [356, 1], up: [[0, 0]],  inf: [344, 344, 344] },
      earring1: { item: [356, 1], up: [[0, 0]],  inf: [344, 0, 0] },
      earring2: { item: [377, 1], up: [[0, 0]],  inf: [344, 0, 0] },
      back:     { item: [425, 1], up: [[0, 0]],  inf: [344, 345]  },
    },
    buff:  { food: 534, utility: 40 },
    relic: 0,
  };

  let result;
  beforeEach(() => {
    result = _mapEquipment(mockEq, statLookup, upgradeMap, upgradeNameIdx, buffMap, buffNameIdx);
  });

  it("maps armor stat slots", () => {
    expect(result.slots.head).toBe("Berserker's");
    expect(result.slots.shoulders).toBe("Berserker's");
    expect(result.slots.chest).toBe("Berserker's");
    expect(result.slots.hands).toBe("Berserker's");
    expect(result.slots.legs).toBe("Berserker's");
    expect(result.slots.feet).toBe("Berserker's");
  });

  it("maps weapon stat slots", () => {
    expect(result.slots.mainhand1).toBe("Berserker's");
    expect(result.slots.offhand1).toBe("Berserker's");
  });

  it("maps trinket stat slots", () => {
    expect(result.slots.ring1).toBe("Viper's");
    expect(result.slots.ring2).toBe("Viper's");
    expect(result.slots.amulet).toBe("Berserker's");
    expect(result.slots.accessory1).toBe("Viper's");
    expect(result.slots.accessory2).toBe("Berserker's");
    expect(result.slots.back).toBe("Marauder's");
  });

  it("maps armor runes", () => {
    expect(result.runes.head).toBe("Superior Rune of the Scholar");
    expect(result.runes.chest).toBe("Superior Rune of the Scholar");
    expect(result.runes.feet).toBe("Superior Rune of the Scholar");
  });

  it("maps weapon sigils (mainhand = 2 slots)", () => {
    expect(result.sigils.mainhand1).toEqual(["Superior Sigil of Force", "Superior Sigil of Accuracy"]);
  });

  it("maps weapon sigils (offhand = 1 slot)", () => {
    expect(result.sigils.offhand1).toEqual(["Superior Sigil of Accuracy"]);
  });

  it("maps food and utility", () => {
    expect(result.food).toBe("Cilantro Lime Sous-Vide Steak");
    expect(result.utility).toBe("Toxic Focusing Crystal");
  });

  it("maps armor infusions (single string)", () => {
    expect(result.infusions.head).toBe("+5 Agony Infusion");
    expect(result.infusions.shoulders).toBe("+5 Agony Infusion");
  });

  it("maps ring infusions (array of 3)", () => {
    expect(result.infusions.ring1).toEqual(["+5 Agony Infusion", "+5 Agony Infusion", "+5 Agony Infusion"]);
  });

  it("maps back infusions (array of 2)", () => {
    expect(result.infusions.back).toEqual(["+5 Agony Infusion", "Mystical +9 Agony Infusion"]);
  });

  it("maps accessory infusions (single string, uses first slot)", () => {
    expect(result.infusions.accessory1).toBe("+5 Agony Infusion");
  });

  it("maps weapon infusions (array)", () => {
    expect(result.infusions.mainhand1).toEqual(["+5 Agony Infusion", "+5 Agony Infusion"]);
    expect(result.infusions.offhand1).toEqual(["+5 Agony Infusion"]);
  });

  it("sets statPackage when all slots agree", () => {
    // All armor + mainhand slots are Berserker's in this mock except rings/back
    // So statPackage should be empty (mixed)
    expect(result.statPackage).toBe("");
  });

  it("sets statPackage when all slots are the same stat", () => {
    const allBerserker = {
      weapon: { w11: { item: [191, 1], up: [[5, 0]], inf: [344, 344] } },
      armor:  { helm: { item: [273, 1], up: [[134, 0]], inf: [344] } },
      trinket: { amulet: { item: [377, 1], up: [[0, 0]], inf: [0] } },
      buff: { food: 0, utility: 0 },
      relic: 0,
    };
    const r = _mapEquipment(allBerserker, statLookup, upgradeMap, upgradeNameIdx, buffMap, buffNameIdx);
    expect(r.statPackage).toBe("Berserker's");
  });
});
