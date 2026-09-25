"use strict";

const {
  ACCENTS,
  DEFAULT_ACCENT_ID,
  PROFESSION_ACCENTS,
  resolveAccentId,
} = require("../../../src/renderer/modules/accents.js");
const { PROFESSION_WEIGHT } = require("../../../src/renderer/modules/constants.js");

describe("ACCENTS", () => {
  it("comes from the package, not a local copy", () => {
    const fromPackage = require("@axiapps/axi-design/accents.json");
    expect(ACCENTS).toEqual(fromPackage);
  });

  it("contains the default", () => {
    expect(ACCENTS.some((a) => a.id === DEFAULT_ACCENT_ID)).toBe(true);
  });
});

describe("resolveAccentId", () => {
  it("passes through a valid accent id", () => {
    expect(resolveAccentId("violet-purple")).toBe("violet-purple");
  });

  // Review Focus 2: appearance.theme === "" is how "Golden Amber" (the old
  // default) is stored, and it is falsy.
  it.each([["", "empty string"], [undefined, "undefined"], [null, "null"]])(
    "resolves %s (%s) to the default",
    (input) => {
      expect(resolveAccentId(input)).toBe(DEFAULT_ACCENT_ID);
    },
  );

  // Review Focus 3: never return something that is not an accent. Extended
  // (controller ruling) with prototype-chain keys: on a plain object literal
  // these resolve to inherited values (e.g. "constructor" -> Object) unless
  // the lookup is own-property-only.
  it.each([
    "not-a-theme",
    "prof-necromancy",
    "AXI-GOLD",
    "../../etc/passwd",
    "constructor",
    "toString",
    "valueOf",
    "__proto__",
  ])(
    "resolves the unknown id %s to the default",
    (input) => {
      const resolved = resolveAccentId(input);
      expect(ACCENTS.some((a) => a.id === resolved)).toBe(true);
      expect(resolved).toBe(DEFAULT_ACCENT_ID);
    },
  );

  it.each([
    ["", "axi-gold"],
    ["molten-core", "amber-warm"],
    ["cinderfall", "crimson-red"],
    ["frostforge", "refined-cyan"],
    ["verdant-crucible", "emerald-mint"],
    ["copper", "gold-bronze"],
    ["rose-gold", "rose-pink"],
    ["cobalt", "electric-blue"],
    ["mithril", "slate-silver"],
    ["prof-guardian", "electric-blue"],
    ["prof-warrior", "amber-warm"],
    ["prof-engineer", "gold-bronze"],
    ["prof-ranger", "emerald-mint"],
    ["prof-necromancer", "teal-ocean"],
    ["prof-thief", "rose-pink"],
    ["prof-mesmer", "violet-purple"],
    ["prof-elementalist", "crimson-red"],
    ["prof-revenant", "crimson-red"],
  ])("maps the legacy id %s to %s", (legacy, accent) => {
    expect(resolveAccentId(legacy)).toBe(accent);
  });

  it("resolves every legacy id to an id that exists in the package", () => {
    const legacy = [
      "", "molten-core", "cinderfall", "frostforge", "verdant-crucible",
      "copper", "cobalt", "mithril", "rose-gold",
      "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
      "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
      "prof-revenant",
    ];
    for (const id of legacy) {
      expect(ACCENTS.some((a) => a.id === resolveAccentId(id))).toBe(true);
    }
  });
});

describe("PROFESSION_ACCENTS", () => {
  it("covers every profession in PROFESSION_WEIGHT", () => {
    for (const profession of Object.keys(PROFESSION_WEIGHT)) {
      expect(PROFESSION_ACCENTS).toHaveProperty(profession);
    }
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(PROFESSION_ACCENTS)).toHaveLength(9);
  });

  it("maps every profession to a real package accent", () => {
    for (const id of Object.values(PROFESSION_ACCENTS)) {
      expect(ACCENTS.some((a) => a.id === id)).toBe(true);
    }
  });

  // Review Focus 5: the old test asserted uniqueness. Elementalist and
  // Revenant deliberately share crimson-red - their pre-conversion colours
  // were #d06050 and #b05050, and the palette has one red at that hue. This
  // assertion replaces the uniqueness one so the sharing stays deliberate: if
  // a third profession joins them, this fails and someone has to decide.
  it("shares an accent only between Elementalist and Revenant", () => {
    const counts = {};
    for (const id of Object.values(PROFESSION_ACCENTS)) counts[id] = (counts[id] || 0) + 1;
    const shared = Object.entries(counts).filter(([, n]) => n > 1);
    expect(shared).toEqual([["crimson-red", 2]]);
    expect(PROFESSION_ACCENTS.Elementalist).toBe("crimson-red");
    expect(PROFESSION_ACCENTS.Revenant).toBe("crimson-red");
  });
});
