"use strict";

const mainAccents = require("../../../src/main/accents.js");
const rendererAccents = require("../../../src/renderer/modules/accents.js");

describe("src/main/accents.js", () => {
  // The two copies exist because jest (and node, in the main process) cannot
  // load the renderer's ESM module from CommonJS. They must not drift: a
  // mismatch would publish share links carrying the wrong accent.
  it("agrees with the renderer's profession map", () => {
    expect(mainAccents.PROFESSION_ACCENTS).toEqual(rendererAccents.PROFESSION_ACCENTS);
  });

  it("agrees with the renderer's resolver on every legacy id", () => {
    const ids = [
      "", undefined, null, "nonsense",
      "molten-core", "cinderfall", "frostforge", "verdant-crucible",
      "copper", "cobalt", "mithril", "rose-gold",
      "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
      "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
      "prof-revenant",
      "axi-gold", "violet-purple",
      // Prototype-chain property names: a plain object literal would resolve
      // these to inherited Object.prototype functions instead of falling
      // through to the default, which is exactly the bug this test exists
      // to catch.
      "constructor", "toString", "valueOf", "hasOwnProperty",
    ];
    for (const id of ids) {
      expect(mainAccents.resolveAccentId(id)).toBe(rendererAccents.resolveAccentId(id));
    }
  });

  it("maps a profession to an accent id for the ?t= parameter", () => {
    expect(mainAccents.PROFESSION_ACCENTS.Guardian).toBe("electric-blue");
  });
});
