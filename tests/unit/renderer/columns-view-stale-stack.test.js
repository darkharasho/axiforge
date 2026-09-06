/**
 * @jest-environment jsdom
 */
"use strict";

// The columns stack is a path RELATIVE to column 0, so it is only meaningful
// while column 0 stays put. Nothing used to enforce that, and the result was
// duplicated or ghost columns that survived until you switched view modes:
//
//   • Drill into "Raids", then click "Raids" in the sidebar. Column 0 becomes
//     Raids' contents while the stack still says "show Raids next" — the same
//     column, rendered twice.
//   • A selected id that stops resolving (deleted, trashed, archived, removed
//     by a teammate's sync) leaves an empty column with nothing to click that
//     would ever clear it.

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    libraryPrefs: { viewMode: "columns" },
    upgradeCatalog: {},
  },
}));
jest.mock("../../../src/renderer/modules/utils", () => ({
  escapeHtml: (s) => s,
  formatRelativeTime: () => "",
}));
jest.mock("../../../src/renderer/modules/roleEstimator", () => ({ roleBadgeHtml: () => "" }));
jest.mock("../../../src/renderer/modules/library/folder-store", () => ({
  getVisibleFolders: jest.fn(() => []),
  getVisibleBuilds: jest.fn(() => []),
  getVisibleComps: jest.fn(() => []),
  libraryFolders: jest.fn(() => []),
  libraryBuilds: jest.fn(() => []),
  libraryComps: jest.fn(() => []),
}));
jest.mock("../../../src/renderer/modules/profession-icons", () => ({ getProfessionSvg: () => "" }));
jest.mock("../../../src/renderer/modules/library/selection", () => ({
  clearSelection: jest.fn(),
  handleBuildClick: jest.fn(),
  handleCompClick: jest.fn(),
  updateSelectionVisuals: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/library/drag-drop", () => ({ wireDragDropEvents: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/heroicons", () => ({
  folderIcon: "", starIcon: "", chevronUpDownIcon: "", chevronUpIcon: "",
  chevronDownIcon: "", chevronRightIcon: "", compIcon: "", shareIcon: "",
}));

const { state } = require("../../../src/renderer/modules/state");
const store = require("../../../src/renderer/modules/library/folder-store");
const { initContent, renderContent } = require("../../../src/renderer/modules/library/content");

const FOLDERS = [
  { id: "raids", name: "Raids", parentId: null, sortOrder: 0 },
  { id: "wing1", name: "Wing 1", parentId: "raids", sortOrder: 0 },
];

const columnCount = () => document.querySelectorAll(".lib-col").length;
const columnNames = () =>
  [...document.querySelectorAll(".lib-col")].map((col) =>
    [...col.querySelectorAll(".lib-col__name")].map((n) => n.textContent).join(",")
  );

function drillInto(folderId) {
  document.querySelector(`.lib-col__item[data-folder-id="${folderId}"]`)
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="lib-content"></div>`;
  initContent({});
  state.folders = FOLDERS;
  state.builds = [];
  state.comps = [];
  state.currentFolder = null;
  state.libraryPrefs = { viewMode: "columns" };
  store.getVisibleFolders.mockReturnValue(FOLDERS.filter((f) => !f.parentId));
  store.getVisibleBuilds.mockReturnValue([]);
  store.getVisibleComps.mockReturnValue([]);
  store.libraryFolders.mockReturnValue(FOLDERS);
  store.libraryComps.mockReturnValue([]);
  store.libraryBuilds.mockReturnValue([]);
});

test("drilling in adds a column", () => {
  renderContent();
  expect(columnCount()).toBe(1);

  drillInto("raids");
  expect(columnCount()).toBe(2);
  expect(columnNames()[1]).toContain("Wing 1");
});

test("navigating into the folder you had drilled into does not show it twice", () => {
  renderContent();
  drillInto("raids");
  expect(columnCount()).toBe(2);

  // The sidebar/breadcrumb moves column 0 to Raids. The stack still says
  // "Raids next", which used to render Raids' contents in column 1 as well.
  state.currentFolder = { type: "custom", id: "raids" };
  store.getVisibleFolders.mockReturnValue(FOLDERS.filter((f) => f.parentId === "raids"));
  renderContent();

  expect(columnCount()).toBe(1);
  expect(columnNames()[0]).toContain("Wing 1");
});

test("a selection that stops resolving is dropped instead of leaving a ghost column", () => {
  renderContent();
  drillInto("raids");
  expect(columnCount()).toBe(2);

  // Raids is deleted / trashed / archived out from under us.
  store.libraryFolders.mockReturnValue([]);
  store.getVisibleFolders.mockReturnValue([]);
  renderContent();

  expect(columnCount()).toBe(1);
});

test("the stack survives a plain repaint in the same context", () => {
  renderContent();
  drillInto("raids");
  renderContent();
  renderContent();

  expect(columnCount()).toBe(2);
});
