/**
 * @jest-environment jsdom
 */
"use strict";

// Test: double-clicking a comp in columns view must NOT call onOpenComp
// (which would navigate into the comp and duplicate the build list).

// ── Mock all imports consumed by content.js ──────────────────────────────────
jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    libraryPrefs: { viewMode: "columns" },
    upgradeCatalog: {},
  },
}));
jest.mock("../../../src/renderer/modules/utils", () => ({
  escapeHtml: (s) => s,
  formatRelativeTime: () => "",
}));
jest.mock("../../../src/renderer/modules/roleEstimator", () => ({
  roleBadgeHtml: () => "",
}));
jest.mock("../../../src/renderer/modules/library/folder-store", () => ({
  getVisibleFolders: () => [],
  getVisibleBuilds: () => [],
  getVisibleComps: jest.fn(() => []),
  // The child-column path and the stale-stack prune both reach for these; the
  // mock only ever covered the three above because no test had drilled in yet.
  libraryFolders: jest.fn(() => []),
  libraryBuilds: jest.fn(() => []),
  libraryComps: jest.fn(() => []),
  searchQuery: jest.fn(() => ""),
  hasSearchQuery: jest.fn(() => false),
  buildMatchesQuery: jest.fn(() => true),
  compMatchesQuery: jest.fn(() => true),
}));
jest.mock("../../../src/renderer/modules/profession-icons", () => ({
  getProfessionSvg: () => "",
}));
jest.mock("../../../src/renderer/modules/library/selection", () => ({
  clearSelection: jest.fn(),
  handleBuildClick: jest.fn(),
  handleCompClick: jest.fn(),
  updateSelectionVisuals: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/library/drag-drop", () => ({
  wireDragDropEvents: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/library/heroicons", () => ({
  folderIcon: "",
  starIcon: "",
  chevronUpDownIcon: "",
  chevronUpIcon: "",
  chevronDownIcon: "",
  chevronRightIcon: "",
  compIcon: "",
}));

const { state } = require("../../../src/renderer/modules/state");
const { getVisibleComps, libraryComps, libraryFolders } = require("../../../src/renderer/modules/library/folder-store");
const { initContent, renderContent } = require("../../../src/renderer/modules/library/content");

describe("Columns view — comp double-click", () => {
  let onOpenComp;

  beforeEach(() => {
    // Set up DOM container
    document.body.innerHTML = `<div id="lib-content"></div>`;

    onOpenComp = jest.fn();
    initContent({ onOpenComp });

    // Set up state: one comp with one build
    state.comps = [{ id: "comp-1", name: "Test Comp", folderId: null, sortOrder: 0, buildIds: ["build-1"] }];
    state.builds = [
      { id: "build-1", title: "Build A", compIds: ["comp-1"], profession: "Guardian" },
    ];
    state.folders = [];
    state.libraryPrefs = { viewMode: "columns" };

    getVisibleComps.mockReturnValue(state.comps);
    // These have to agree with state, or the stale-stack prune in
    // renderColumnsView correctly decides the selected comp no longer exists.
    libraryComps.mockReturnValue(state.comps);
    libraryFolders.mockReturnValue(state.folders);
  });

  test("double-clicking a comp in columns view should NOT call onOpenComp", () => {
    renderContent();

    const container = document.getElementById("lib-content");
    const compEl = container.querySelector("[data-comp-id='comp-1']");
    expect(compEl).not.toBeNull();
    expect(compEl.closest(".lib-columns")).not.toBeNull();

    // Simulate double-click
    compEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(onOpenComp).not.toHaveBeenCalled();
  });

  test("single-clicking a comp in columns view shows its builds in next column", () => {
    renderContent();

    const container = document.getElementById("lib-content");
    const compEl = container.querySelector("[data-comp-id='comp-1']");

    // Single click the comp to drill down
    compEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // After re-render, the comp's builds should appear in a second column
    const columns = container.querySelectorAll(".lib-col");
    expect(columns.length).toBe(2);

    const buildEl = container.querySelector("[data-build-id='build-1']");
    expect(buildEl).not.toBeNull();
  });
});
