/** @jest-environment jsdom */
"use strict";

// The single-build coverage strip (issue #302 follow-up): the editor lists the
// conditions a build applies exactly the way it lists boons — icons for what's
// present, with a hover tooltip naming the skill/trait each one comes from.
// Self-inflicted conditions are marked so they don't read as offensive pressure.
const {
  buildConditionList,
  renderCoverageStrip,
} = require("../../../src/renderer/modules/boon-coverage");

const FOE_POISON = { type: "skill", name: "Signet of Spite", stacks: 2, duration: 10, target: "foe" };
const SELF_POISON = { type: "skill", name: "Corrupt Boon", stacks: 1, duration: 6, target: "self" };
const MIXED_BLEED = { type: "skill", name: "Blood Is Power", stacks: 1, duration: 8, target: "mixed" };

describe("buildConditionList", () => {
  it("lists only the conditions the build applies, like boons", () => {
    const list = buildConditionList([{ name: "Poisoned", icon: "p.png", sources: [FOE_POISON] }]);
    expect(list.map((c) => c.name)).toEqual(["Poisoned"]);
  });

  it("does not count a self-inflicted-only condition as covered", () => {
    const [poison] = buildConditionList([{ name: "Poisoned", sources: [SELF_POISON] }]);
    expect(poison.covered).toBe(false);
    expect(poison.selfOnly).toBe(true);
  });

  it("counts a condition as covered when any source reaches foes", () => {
    const list = buildConditionList([
      { name: "Poisoned", sources: [SELF_POISON, FOE_POISON] },
      { name: "Bleeding", sources: [MIXED_BLEED] },
    ]);
    expect(list.map((c) => c.covered)).toEqual([true, true]);
    expect(list.some((c) => c.selfOnly)).toBe(false);
  });

  it("treats a source with no target as foe-facing", () => {
    const [burning] = buildConditionList([
      { name: "Burning", sources: [{ type: "trait", name: "X", duration: 3 }] },
    ]);
    expect(burning.covered).toBe(true);
  });
});

describe("renderCoverageStrip", () => {
  const coverage = {
    boons: [{ name: "Might", icon: "m.png", sources: [{ type: "skill", name: "S", stacks: 3, duration: 10 }] }],
    conditions: [{ name: "Poisoned", icon: "p.png", sources: [SELF_POISON, FOE_POISON] }],
  };

  const hover = (el, name) => {
    const icon = [...el.querySelectorAll(".boon-coverage__icon")]
      .find((n) => n.querySelector("img").alt === name);
    icon.dispatchEvent(new window.MouseEvent("mouseenter"));
    return icon;
  };

  it("returns null when the build applies nothing", () => {
    expect(renderCoverageStrip({ boons: [], conditions: [] })).toBeNull();
  });

  it("renders one icon per applied condition and no gaps", () => {
    const el = renderCoverageStrip(coverage);
    expect(el.querySelectorAll(".boon-coverage__conditions .boon-coverage__icon")).toHaveLength(1);
    expect(el.querySelectorAll(".boon-coverage__icon--uncovered")).toHaveLength(0);
  });

  it("names the source skill/trait of a condition, same as a boon", () => {
    const el = renderCoverageStrip(coverage);
    const read = (icon) => [...icon.querySelectorAll(".boon-coverage__tooltip-row")].map((row) => [
      row.querySelector(".boon-coverage__tooltip-tag").textContent,
      row.querySelector(".boon-coverage__tooltip-name").textContent,
      row.querySelector(".boon-coverage__tooltip-detail").textContent,
    ]);
    expect(read(hover(el, "Might"))).toEqual([["Skill", "S", "3× 10s"]]);
    expect(read(hover(el, "Poisoned"))).toEqual([
      ["Skill", "Corrupt Boon", "1× 6s"],
      ["Skill", "Signet of Spite", "2× 10s"],
    ]);
  });

  it("marks a self-only condition distinctly", () => {
    const el = renderCoverageStrip({
      boons: [],
      conditions: [{ name: "Poisoned", icon: "p.png", sources: [SELF_POISON] }],
    });
    expect(el.querySelectorAll(".boon-coverage__icon--self-condi")).toHaveLength(1);
  });

  it("tags each condition source with its target on hover", () => {
    const poison = hover(renderCoverageStrip(coverage), "Poisoned");
    const targets = [...poison.querySelectorAll(".boon-coverage__tooltip-target")].map((n) => n.textContent);
    expect(targets).toEqual(["SELF", "FOE"]);
    expect(poison.querySelectorAll(".boon-coverage__tooltip-row--self-condi")).toHaveLength(1);
  });

  it("notes when a condition is self-inflicted only", () => {
    const el = renderCoverageStrip({
      boons: [],
      conditions: [{ name: "Poisoned", icon: "p.png", sources: [SELF_POISON] }],
    });
    expect(hover(el, "Poisoned").querySelector(".boon-coverage__tooltip-note").textContent)
      .toMatch(/Self-inflicted only/);
  });

  it("keeps the ally badge on boons only", () => {
    const el = renderCoverageStrip({
      boons: [{ name: "Might", icon: "m.png", hasAllySource: true, sources: [] }],
      conditions: [{ name: "Poisoned", icon: "p.png", hasAllySource: true, sources: [FOE_POISON] }],
    });
    expect(el.querySelectorAll(".boon-coverage__ally-badge")).toHaveLength(1);
  });
});
