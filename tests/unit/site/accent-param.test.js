"use strict";

const { accentFromParams } = require("../../../src/site/accent.js");

describe("accentFromParams", () => {
  // Review Focus 1: these URLs are already posted to Discord and cannot be
  // rewritten. Every legacy ?t= value has to keep theming the page forever.
  it.each([
    ["prof-guardian", "electric-blue"],
    ["prof-necromancer", "teal-ocean"],
    ["prof-revenant", "crimson-red"],
    ["molten-core", "amber-warm"],
    ["mithril", "slate-silver"],
  ])("themes a legacy ?t=%s link as %s", (legacy, accent) => {
    expect(accentFromParams(new URLSearchParams(`?t=${legacy}`))).toBe(accent);
  });

  it("passes through a current accent id", () => {
    expect(accentFromParams(new URLSearchParams("?t=violet-purple"))).toBe("violet-purple");
  });

  it("returns null when there is no t parameter, leaving the page default", () => {
    expect(accentFromParams(new URLSearchParams("?b=abc.def"))).toBeNull();
  });

  it("returns null for a junk value rather than setting a bogus attribute", () => {
    expect(accentFromParams(new URLSearchParams("?t=%3Cscript%3E"))).toBeNull();
  });
});
