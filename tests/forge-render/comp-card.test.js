"use strict";

const { renderCompCard } = require("../../packages/forge-render/src/index.js");

const buildA = {
  id: "a", title: "Power Reaper", profession: "Necromancer",
  specializations: [{ name: "Reaper", elite: true }],
};
const buildB = {
  id: "b", title: "Heal Firebrand", profession: "Guardian",
  specializations: [{ name: "Firebrand", elite: true }],
};
const buildsById = { a: buildA, b: buildB };

const comp = {
  title: "Tagged Comp",
  buildColors: {},
  categories: [
    { id: "cat-dps", name: "DPS", icon: "img/tags/might.png", buildIds: ["a", "b"] },
  ],
  partyLines: [
    { id: "p1", capacity: 5, slots: ["a", "tag:cat-dps", "b"] },
  ],
};

describe("renderCompCard — tag slots", () => {
  test("renders a tag slot with the category icon image", () => {
    const html = renderCompCard(comp, buildsById);
    expect(html).toContain("comp-slot--tag");
    expect(html).toContain('src="img/tags/might.png"');
  });

  test("tag-slot tooltip lists the member builds (hover shows options)", () => {
    const html = renderCompCard(comp, buildsById);
    expect(html).toMatch(/title="DPS: Power Reaper, Heal Firebrand"/);
  });

  test("does not render the tag token as a missing build in the pool", () => {
    const html = renderCompCard(comp, buildsById);
    // The pool should show the two real builds, never a card for "tag:cat-dps"
    expect(html).not.toContain("tag:cat-dps</"); // no stray token text
    expect(html).not.toContain("comp-mini-card--missing"); // no missing-build card
  });

  test("falls back to short text when the category has no icon", () => {
    const noIcon = {
      ...comp,
      categories: [{ id: "c", name: "Strips", icon: "", buildIds: ["a"] }],
      partyLines: [{ id: "p1", capacity: 5, slots: ["tag:c"] }],
    };
    const html = renderCompCard(noIcon, buildsById);
    expect(html).toContain("comp-slot__tag-text");
    expect(html).toContain("Str"); // first 3 chars of the name
  });

  test("renders Lucide-style numbered party badges instead of 'P1' text", () => {
    const html = renderCompCard(comp, buildsById);
    expect(html).toContain('class="comp-line__num"');
    expect(html).toContain(">1</text>");
    expect(html).not.toMatch(/comp-line__label">P1</);
  });
});
