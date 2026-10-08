/**
 * @jest-environment jsdom
 */
"use strict";

const { renderCompPage } = require("../../../src/site/render-comp.js");
const { computeViewerCoverageHtml } = require("../../../src/site/comp-coverage.js");

const MIGHT = { id: 100, name: "Healing Surge", slot: "Heal", type: "Heal", description: "",
  facts: [{ type: "Buff", status: "Might", duration: 10, apply_count: 5 }] };

function publishedBuild(id, extra = {}) {
  return { id, title: id, profession: "Guardian", gameMode: "pve", specializations: [],
    skills: { heal: MIGHT, utility: [], elite: null }, equipment: { slots: {}, weapons: {} },
    catalogSkills: [MIGHT], catalogWeaponSkills: [], catalogTraits: [], spaUrl: `https://x/?b=${id}.k`, ...extra };
}

const baseComp = {
  name: "Linked", gameMode: "pve", tags: [], notes: "", categories: [], buildColors: {},
  partyLines: [{ id: "l1", capacity: 5, slots: ["a", "gone"] }],
};

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });

describe("v2 comp in the viewer", () => {
  test("an unavailable member renders as a marked slot and is left out of the pool", () => {
    const app = document.getElementById("app");
    renderCompPage(app, { ...baseComp, builds: { a: publishedBuild("a"), gone: { id: "gone", unavailable: true } } });
    expect(app.querySelectorAll(".comp-slot--unavailable")).toHaveLength(1);
    expect(app.querySelector(".comp-slot--unavailable").getAttribute("title")).toBe("Build unavailable");
    expect(app.querySelector(".comp-pool-count").textContent).toBe("1");
  });

  test("an unavailable member is left out of a tag popover's data", () => {
    const app = document.getElementById("app");
    renderCompPage(app, { ...baseComp,
      partyLines: [{ id: "l1", capacity: 5, slots: ["tag:c1", "gone"] }],
      categories: [{ id: "c1", name: "Heal", buildIds: ["a", "gone"] }],
      builds: { a: publishedBuild("a", { title: "Heal FB" }), gone: { id: "gone", unavailable: true } } });
    expect(app.querySelector(".comp-slot--unavailable")).not.toBeNull();

    app.querySelector(".comp-slot--tag").dispatchEvent(new Event("mouseenter"));
    const pop = document.querySelector(".comp-tag-pop");
    expect(pop).not.toBeNull();
    expect([...pop.querySelectorAll(".comp-tag-pop__name")].map((n) => n.textContent)).toEqual(["Heal FB"]);
  });

  test("coverage computed in the viewer skips the unavailable member and tolerates a v1 member with no bonus", async () => {
    const html = await computeViewerCoverageHtml(baseComp, {
      a: publishedBuild("a"), // no boonDurationBonus: a teammate's v1 file
      gone: { id: "gone", unavailable: true },
    });
    expect(html).toContain("party-cov__line");
    expect(html).toContain("Might");
  });

  test("a v1 comp still renders its embedded coverage snapshot", () => {
    const app = document.getElementById("app");
    renderCompPage(app, { ...baseComp, partyLines: [{ id: "l1", capacity: 5, slots: ["a"] }],
      builds: { a: publishedBuild("a") }, boonCoverageHtml: '<div class="party-cov__line">snapshot</div>' });
    expect(app.querySelector(".comp-boon-cov__body").textContent).toContain("snapshot");
  });
});
