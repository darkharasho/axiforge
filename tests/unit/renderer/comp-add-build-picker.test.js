/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { builds: [], folders: [], comps: [], teams: [], teamSession: null, upgradeCatalog: null },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { openAddBuildModal } = require("../../../src/renderer/modules/comps/comp-detail.js");

const SHARED_ROOT = { id: "eww", name: "EWW Shared", parentId: null, shared: true, teamId: "t1", role: "owner" };
const ZERG = { id: "zerg", name: "Zerg", parentId: "eww" };
const FRONT = { id: "front", name: "Frontline", parentId: "zerg" };
const PERSONAL = { id: "drafts", name: "Drafts", parentId: null };

function makeBuild(over = {}) {
  return {
    id: "b1", title: "Celestial Firebrand", profession: "Guardian", gameMode: "wvw",
    folderId: null, compIds: [], tags: [], specializations: [], ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  state.folders = [SHARED_ROOT, ZERG, FRONT, PERSONAL];
  state.builds = [];
  state.comps = [];
});

const open = (comp) => {
  openAddBuildModal(comp);
  return document.querySelector(".comp-picker-overlay");
};
const rows = (o) => [...o.querySelectorAll(".comp-picker-row")];
const rowFor = (o, id) => o.querySelector(`.comp-picker-row[data-build-id="${id}"]`);
const textOf = (el, sel) => el.querySelector(sel)?.textContent.trim();

describe("Add Builds to Comp — row detail", () => {
  test("shows where the build lives, down the full folder path", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "front" })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    expect(textOf(rowFor(o, "b1"), ".comp-picker-row__where")).toBe("EWW Shared / Zerg / Frontline");
  });

  test("a build at the root says so rather than showing nothing", () => {
    state.builds = [makeBuild({ id: "b1", folderId: null })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    expect(textOf(rowFor(o, "b1"), ".comp-picker-row__where")).toBe("Library root");
  });

  test("a build in a team folder is badged with the team name", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "zerg" })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    const badge = rowFor(o, "b1").querySelector(".comp-picker-row__badge--shared");
    expect(badge.textContent).toContain("EWW Shared");
    expect(badge.title).toContain("owner");
  });

  test("a personal build gets no shared badge", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "drafts" })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    expect(rowFor(o, "b1").querySelector(".comp-picker-row__badge--shared")).toBeNull();
  });

  test("the meta line names the elite spec and gear", () => {
    state.builds = [makeBuild({
      id: "b1", folderId: "drafts",
      specializations: [{ name: "Firebrand", elite: true }],
    })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    const meta = rowFor(o, "b1").querySelector(".comp-picker-row__meta").textContent;
    expect(meta).toContain("Firebrand");
    expect(meta).toContain("WVW");
  });
});

// The bug: build.compIds is stripped by team sync (BUILD_LOCAL_FIELDS), so a
// pulled shared build has no idea it is in a comp. comp.buildIds does survive.
describe("Add Builds to Comp — comp count on shared builds", () => {
  test("counts a build the comp claims even when the build carries no compIds", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "zerg", compIds: [] })];
    state.comps = [
      { id: "main", name: "Main Zerg", buildIds: ["b1"], folderId: "eww" },
      { id: "target", name: "New Comp", buildIds: [], folderId: null },
    ];
    const badge = rowFor(open(state.comps[1]), "b1").querySelector(".comp-picker-row__badge--comps");
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("1 comp");
    expect(badge.title).toBe("Already in: Main Zerg");
  });

  test("counts every comp claiming the build, and names them all", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "zerg", compIds: [] })];
    state.comps = [
      { id: "a", name: "Main Zerg", buildIds: ["b1"] },
      { id: "b", name: "Havoc", buildIds: ["b1"] },
      { id: "target", name: "New Comp", buildIds: [] },
    ];
    const badge = rowFor(open(state.comps[2]), "b1").querySelector(".comp-picker-row__badge--comps");
    expect(badge.textContent).toBe("2 comps");
    expect(badge.title).toBe("Already in: Main Zerg, Havoc");
  });

  test("a stale compIds entry pointing at no comp does not inflate the count", () => {
    state.builds = [makeBuild({ id: "b1", compIds: ["deleted-comp"] })];
    state.comps = [{ id: "target", name: "New Comp", buildIds: [] }];
    expect(rowFor(open(state.comps[0]), "b1").querySelector(".comp-picker-row__badge--comps")).toBeNull();
  });
});

describe("Add Builds to Comp — scope", () => {
  test("says which builds it is showing and how many", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "zerg" }), makeBuild({ id: "b2", folderId: "zerg" })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: "eww", gameMode: "wvw" });
    const note = o.querySelector(".comp-picker-modal__scope").textContent;
    expect(note).toContain("WVW");
    expect(note).toContain("EWW Shared");
    expect(note).toContain("2 available");
  });

  test("an empty list says which rule emptied it", () => {
    state.builds = [makeBuild({ id: "b1", folderId: "drafts", gameMode: "pve" })];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: "eww", gameMode: "wvw" });
    const empty = o.querySelector(".comp-picker-empty").textContent;
    expect(empty).toContain("WVW");
    expect(empty).toContain("EWW Shared");
  });

  test("search matches on folder as well as name", () => {
    state.builds = [
      makeBuild({ id: "b1", title: "Firebrand", folderId: "front" }),
      makeBuild({ id: "b2", title: "Firebrand", folderId: "drafts" }),
    ];
    const o = open({ id: "c1", name: "Comp", buildIds: [], folderId: null });
    const input = o.querySelector(".comp-picker-modal__search");
    input.value = "frontline";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(rows(document.querySelector(".comp-picker-overlay")).map((r) => r.dataset.buildId)).toEqual(["b1"]);
  });

  test("builds already in this comp are not offered", () => {
    state.builds = [makeBuild({ id: "b1" }), makeBuild({ id: "b2" })];
    const o = open({ id: "c1", name: "Comp", buildIds: ["b1"], folderId: null });
    expect(rows(o).map((r) => r.dataset.buildId)).toEqual(["b2"]);
  });
});
