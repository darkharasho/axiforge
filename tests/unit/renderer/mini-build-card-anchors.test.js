/** @jest-environment jsdom */
"use strict";
const { renderMiniBuildCard } = require("../../../packages/forge-render/src/mini-build-card.js");

function fixture() {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior", gameMode: "pve",
    specializations: [{ id: 45, name: "Chaos", elite: false, majorChoices: { 1: 675, 2: 668, 3: 1687 }, majorTraitsByTier: {}, minorTraits: [] }],
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }], elite: { id: 4, name: "D" } },
    equipment: {
      statPackage: "Berserker",
      slots: { head: "Zojja's Visage" },
      runes: { head: "Superior Rune of the Scholar" },
      weapons: { mainhand1: "Greatsword" },
      sigils: { mainhand1: ["74326", "82876"] },
      infusions: { head: "" },
    },
    tags: [],
  };
}

function parse(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("mini-build-card highlight anchors", () => {
  test("gear slots carry slot and part anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    expect(el.querySelector('[data-hist-slot="head"][data-hist-part="rune"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-slot="head"][data-hist-part="item"]')).not.toBeNull();
  });

  test("skills carry slot anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    for (const slot of ["heal", "utility1", "utility2", "utility3", "elite"]) {
      expect(el.querySelector(`[data-hist-skill="${slot}"]`)).not.toBeNull();
    }
  });

  test("trait choices carry line:tier anchors", () => {
    const el = parse(renderMiniBuildCard(fixture(), null, { showActions: false }));
    expect(el.querySelector('[data-hist-trait="0:2"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-spec="0"]')).not.toBeNull();
  });

  test("spec/trait anchors use the raw specializations index, not the filtered one", () => {
    // An unnamed spec line ahead of a named one must not shift the named
    // line's anchor down to 0 — diffBuild.js's `line` on trait/spec ops is
    // the raw array index, so a filtered index here would silently point
    // Task 8's compare modal at the wrong spec line.
    const build = fixture();
    build.specializations = [
      { id: 0, name: "", elite: false, majorChoices: {}, majorTraitsByTier: {}, minorTraits: [] },
      { id: 45, name: "Chaos", elite: false, majorChoices: { 1: 675, 2: 668, 3: 1687 }, majorTraitsByTier: {}, minorTraits: [] },
    ];
    const el = parse(renderMiniBuildCard(build, null, { showActions: false }));
    expect(el.querySelector('[data-hist-spec="1"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-trait="1:2"]')).not.toBeNull();
    expect(el.querySelector('[data-hist-spec="0"]')).toBeNull();
    expect(el.querySelector('[data-hist-trait="0:2"]')).toBeNull();
  });

  test("existing markup is unchanged apart from the new attributes", () => {
    const html = renderMiniBuildCard(fixture(), null, { showActions: false });
    expect(html).toContain("mini-card");
    expect(parse(html).querySelectorAll("[class]").length).toBeGreaterThan(3);
  });
});
