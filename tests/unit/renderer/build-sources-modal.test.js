/** @jest-environment jsdom */
"use strict";

// The in-depth half of build sources. Two entry points into one modal:
//   showCompSourcesModal(comp)  -- the matrix, one row per build
//   showBuildSourcesModal(build) -- straight to one build's detail, from the library
// Rows expand in place rather than swapping views, so the matrix stays on screen
// as context while you drill into a row.

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { builds: [], comps: [], folders: [] },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const {
  initBuildSourcesModal,
  showCompSourcesModal,
  showBuildSourcesModal,
  closeBuildSourcesModal,
} = require("../../../src/renderer/modules/build-sources-modal.js");

const FOLDERS = [
  { id: "wvw", name: "WvW", parentId: null },
  { id: "zerg", name: "Zerg", parentId: "wvw" },
  { id: "support", name: "Support", parentId: "zerg" },
  { id: "guild", name: "Guild", parentId: null },
];

const BUILDS = [
  { id: "b1", title: "Firebrand — Support", profession: "Guardian", folderId: "support" },
  { id: "b2", title: "Scourge — Corrupt", profession: "Necromancer", folderId: "zerg" },
  { id: "b3", title: "Druid — Heal", profession: "Ranger", folderId: "guild" },
];

const COMP = { id: "c1", name: "Zerg Frontline", folderId: "zerg", buildIds: ["b1", "b2", "b3"] };

beforeEach(() => {
  document.body.innerHTML = "";
  state.folders = [...FOLDERS];
  state.builds = BUILDS.map((b) => ({ ...b }));
  state.comps = [
    { ...COMP },
    { id: "c2", name: "Guild Raid", folderId: "guild", buildIds: ["b1"] },
  ];
  initBuildSourcesModal();
});

afterEach(() => closeBuildSourcesModal());

const rows = () => [...document.querySelectorAll(".bsm-row")];
const visibleRows = () => rows().filter((r) => r.offsetParent !== null || !r.hidden);

describe("the matrix", () => {
  test("draws one row per build, in the comp's order", () => {
    showCompSourcesModal(state.comps[0]);
    expect(rows().map((r) => r.dataset.srcBuild)).toEqual(["b1", "b2", "b3"]);
  });

  test("names the comp and where it lives", () => {
    showCompSourcesModal(state.comps[0]);
    const header = document.querySelector(".bsm-header").textContent;
    expect(header).toContain("Zerg Frontline");
    expect(header).toContain("WvW / Zerg");
  });

  test("marks the builds that come from outside the comp's folder", () => {
    showCompSourcesModal(state.comps[0]);
    const external = rows().filter((r) => r.classList.contains("bsm-row--external"));
    expect(external.map((r) => r.dataset.srcBuild)).toEqual(["b1", "b3"]);
  });

  test("a build in the comp's own folder says so instead of repeating the path", () => {
    showCompSourcesModal(state.comps[0]);
    const own = rows().find((r) => r.dataset.srcBuild === "b2");
    expect(own.textContent).toContain("this comp's folder");
  });

  test("the 'also in comps' cell lists the other comps", () => {
    showCompSourcesModal(state.comps[0]);
    const shared = rows().find((r) => r.dataset.srcBuild === "b1");
    expect(shared.textContent).toContain("Guild Raid");
  });

  test("a comp whose builds all live at home still opens, with nothing flagged", () => {
    state.comps = [{ id: "c3", name: "Local", folderId: "zerg", buildIds: ["b2"] }];
    showCompSourcesModal(state.comps[0]);
    expect(rows()).toHaveLength(1);
    expect(document.querySelectorAll(".bsm-row--external")).toHaveLength(0);
  });

  test("an empty comp says so rather than showing a bare table", () => {
    showCompSourcesModal({ id: "c9", name: "Empty", folderId: "zerg", buildIds: [] });
    expect(document.querySelector(".bsm-empty")).not.toBeNull();
  });
});

describe("the 'only outside builds' filter", () => {
  test("hides the rows that live at home, and restores them", () => {
    showCompSourcesModal(state.comps[0]);
    const toggle = document.querySelector(".bsm-toggle input");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rows().map((r) => r.dataset.srcBuild)).toEqual(["b1", "b3"]);

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rows()).toHaveLength(3);
  });

  test("is not offered when there is nothing to filter down to", () => {
    state.comps = [{ id: "c3", name: "Local", folderId: "zerg", buildIds: ["b2"] }];
    showCompSourcesModal(state.comps[0]);
    expect(document.querySelector(".bsm-toggle")).toBeNull();
  });
});

describe("row expansion", () => {
  test("clicking a row opens its detail beneath it, and clicking again closes it", () => {
    showCompSourcesModal(state.comps[0]);
    const row = rows().find((r) => r.dataset.srcBuild === "b1");
    row.click();
    const detail = document.querySelector(".bsm-detail-row");
    expect(detail).not.toBeNull();
    expect(detail.previousElementSibling).toBe(row);
    row.click();
    expect(document.querySelector(".bsm-detail")).toBeNull();
  });

  test("only one row is expanded at a time", () => {
    showCompSourcesModal(state.comps[0]);
    rows().find((r) => r.dataset.srcBuild === "b1").click();
    rows().find((r) => r.dataset.srcBuild === "b3").click();
    expect(document.querySelectorAll(".bsm-detail-row")).toHaveLength(1);
    expect(document.querySelector(".bsm-detail-row").previousElementSibling.dataset.srcBuild).toBe("b3");
  });

  test("the detail lists every comp the build is in, including the one you came from", () => {
    showCompSourcesModal(state.comps[0]);
    rows().find((r) => r.dataset.srcBuild === "b1").click();
    const lines = [...document.querySelectorAll(".bsm-detail-comp")].map((n) => n.textContent);
    expect(lines.some((t) => t.includes("Zerg Frontline"))).toBe(true);
    expect(lines.some((t) => t.includes("Guild Raid") && t.includes("Guild"))).toBe(true);
  });

  test("the comp you opened the matrix from is marked as such", () => {
    showCompSourcesModal(state.comps[0]);
    rows().find((r) => r.dataset.srcBuild === "b1").click();
    expect(document.querySelector(".bsm-detail-comp--self").textContent).toContain("Zerg Frontline");
  });

  test("the detail shows the build's full home path", () => {
    showCompSourcesModal(state.comps[0]);
    rows().find((r) => r.dataset.srcBuild === "b1").click();
    expect(document.querySelector(".bsm-detail-home").textContent).toContain("WvW / Zerg / Support");
  });

  test("a build in no other comp still opens, saying only where it lives", () => {
    showCompSourcesModal(state.comps[0]);
    rows().find((r) => r.dataset.srcBuild === "b3").click();
    expect(document.querySelectorAll(".bsm-detail-comp")).toHaveLength(1);
  });
});

describe("the direct per-build entry, used from the library", () => {
  test("opens on the build's own detail with no matrix around it", () => {
    showBuildSourcesModal(state.builds[0]);
    expect(document.querySelector(".bsm-detail-home").textContent).toContain("WvW / Zerg / Support");
    expect(rows()).toHaveLength(0);
  });

  test("names the build in the header", () => {
    showBuildSourcesModal(state.builds[0]);
    expect(document.querySelector(".bsm-header").textContent).toContain("Firebrand — Support");
  });

  test("a build at the library root says so rather than showing a blank path", () => {
    showBuildSourcesModal({ id: "b9", title: "Loose", folderId: null });
    expect(document.querySelector(".bsm-detail-home").textContent).toContain("Library root");
  });

  test("a build in no comp says so", () => {
    showBuildSourcesModal({ id: "b9", title: "Loose", folderId: "zerg" });
    expect(document.querySelector(".bsm-detail").textContent).toMatch(/not in any comp/i);
  });
});

describe("dismissal", () => {
  test("Escape closes it", () => {
    showCompSourcesModal(state.comps[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".bsm-overlay--hidden")).not.toBeNull();
  });

  test("the close button closes it", () => {
    showCompSourcesModal(state.comps[0]);
    document.querySelector(".bsm-close").click();
    expect(document.querySelector(".bsm-overlay--hidden")).not.toBeNull();
  });

  test("clicking the backdrop closes it, clicking the panel does not", () => {
    showCompSourcesModal(state.comps[0]);
    document.querySelector(".bsm-panel").click();
    expect(document.querySelector(".bsm-overlay--hidden")).toBeNull();
    document.querySelector(".bsm-overlay").click();
    expect(document.querySelector(".bsm-overlay--hidden")).not.toBeNull();
  });

  // The library re-renders by replacing whole subtrees; a modal holding dead
  // nodes silently stops responding.
  test("re-initialising after the body is replaced rebuilds rather than pointing at dead nodes", () => {
    showCompSourcesModal(state.comps[0]);
    document.body.innerHTML = "";
    initBuildSourcesModal();
    showCompSourcesModal(state.comps[0]);
    expect(rows()).toHaveLength(3);
  });
});

describe("escaping", () => {
  test("comp and folder names are escaped", () => {
    state.folders = [{ id: "x", name: '<img src=x onerror="alert(1)">', parentId: null }];
    state.builds = [{ id: "b1", title: "<script>x</script>", folderId: "x" }];
    showCompSourcesModal({ id: "c1", name: "<b>bad</b>", folderId: "zerg", buildIds: ["b1"] });
    expect(document.querySelector(".bsm-panel").innerHTML).not.toContain("<img src=x");
    expect(document.querySelector(".bsm-panel").innerHTML).not.toContain("<script>");
  });
});
