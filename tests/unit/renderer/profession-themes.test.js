"use strict";

// The profession map's contract now lives in accents.test.js, which owns both
// the map and the legacy ids it has to stay consistent with. This file keeps
// only the one thing it uniquely covered: that constants.js - where the app's
// callers look - exposes the same map, so the re-export cannot silently rot.
const constants = require("../../../src/renderer/modules/constants.js");
const accents = require("../../../src/renderer/modules/accents.js");

describe("constants re-exports the profession accent map", () => {
  it("exposes PROFESSION_ACCENTS", () => {
    expect(constants.PROFESSION_ACCENTS).toBe(accents.PROFESSION_ACCENTS);
  });

  it("no longer exposes the removed PROFESSION_THEMES", () => {
    expect(constants.PROFESSION_THEMES).toBeUndefined();
  });
});
