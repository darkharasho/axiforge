/**
 * @jest-environment jsdom
 */
"use strict";

// Configurable table columns, end to end through the DOM: the table draws only
// the columns the user picked, in their order, and the header's column menu
// changes that pick (Discord "More Columns").

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    teams: [],
    teamSession: null,
    syncAuthors: {},
    teamMemberNames: {},
    currentFolder: null,
    libraryPrefs: { viewMode: "table", sortField: "sortOrder", sortDirection: "asc", tableColumns: null },
    upgradeCatalog: {},
    folderSyncStatus: {}, buildSyncStatus: {}, compSyncStatus: {},
  },
}));
jest.mock("../../../src/renderer/modules/roleEstimator", () => ({ roleBadgeHtml: () => "" }));
jest.mock("../../../src/renderer/modules/library/folder-store", () => ({
  getVisibleFolders: jest.fn(() => []),
  getVisibleBuilds: jest.fn(() => require("../../../src/renderer/modules/state").state.builds),
  getVisibleComps: jest.fn(() => []),
  libraryFolders: jest.fn(() => []),
  libraryBuilds: jest.fn(() => []),
  libraryComps: jest.fn(() => []),
  searchQuery: jest.fn(() => ""),
  hasSearchQuery: jest.fn(() => false),
  buildMatchesQuery: jest.fn(() => true),
  compMatchesQuery: jest.fn(() => true),
  stopSharingFolder: jest.fn(),
  pullTeamFor: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/profession-icons", () => ({ getProfessionSvg: () => "" }));
jest.mock("../../../src/renderer/modules/library/selection", () => ({
  clearSelection: jest.fn(),
  handleBuildClick: jest.fn(),
  handleCompClick: jest.fn(),
  updateSelectionVisuals: jest.fn(),
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));
jest.mock("../../../src/renderer/modules/library/drag-drop", () => ({ wireDragDropEvents: jest.fn() }));

const { state } = require("../../../src/renderer/modules/state");
const { initContent, renderContent } = require("../../../src/renderer/modules/library/content");
const { initContextMenu, wireContextMenuEvents, closeMenu, showTableColumnsMenu } =
  require("../../../src/renderer/modules/library/context-menu");
const { normalizeColumnPrefs } = require("../../../src/renderer/modules/library/table-columns");

const headerCols = () =>
  [...document.querySelectorAll(".lib-tv__header > span")].map((s) => s.className.replace("lib-tv__", ""));
const rowCols = () =>
  [...document.querySelectorAll(".lib-tv__row--build > span")].map((s) => s.className.replace("lib-tv__", ""));
const menuRows = () => [...document.querySelectorAll(".lib-ctx-menu .lib-ctx-item--column")];
const menuRow = (label) => menuRows().find((r) => r.textContent.trim() === label);

let onChange;

beforeEach(() => {
  closeMenu();
  document.body.innerHTML = `<div id="lib-content"></div>`;
  state.folders = [{ id: "team", name: "Raid Team", parentId: null, teamId: "t1", role: "member" }];
  state.builds = [{ id: "b1", title: "Heal FB", profession: "Guardian", folderId: "team", tags: [] }];
  state.teamSession = { userId: "me" };
  state.syncAuthors = { b1: "u2" };
  state.teamMemberNames = { u2: "Vette" };
  state.libraryPrefs.tableColumns = null;
  // Stand in for library.js: store the pick and redraw.
  onChange = jest.fn((cols) => { state.libraryPrefs.tableColumns = cols; renderContent(); });
  initContent({ onTableColumnsChange: onChange, onTableColumnsMenu: showTableColumnsMenu });
  initContextMenu({ onTableColumnsChange: onChange });
  wireContextMenuEvents();
  renderContent();
});

test("default table draws today's columns, header and rows aligned", () => {
  expect(headerCols()).toEqual([
    "action", "icon", "name", "profession", "spec", "mode", "role", "tags", "created", "modified",
  ]);
  expect(rowCols()).toEqual(headerCols());
});

test("a saved pick shows its columns in its order and sets the grid to match", () => {
  state.libraryPrefs.tableColumns = normalizeColumnPrefs([
    { id: "owner", visible: true },
    { id: "path", visible: true },
    { id: "profession", visible: false },
  ]);
  renderContent();
  expect(headerCols().slice(0, 5)).toEqual(["action", "icon", "name", "owner", "path"]);
  expect(headerCols()).not.toContain("profession");
  expect(rowCols()).toEqual(headerCols());
  expect(document.querySelector(".lib-tv__row--build .lib-tv__owner").textContent).toBe("Vette");
  expect(document.querySelector(".lib-tv__row--build .lib-tv__path").textContent).toBe("Raid Team");
  const grid = document.querySelector(".lib-tv").style.getPropertyValue("--lib-tv-cols").trim();
  expect(grid.split(" ")).toHaveLength(headerCols().length);
});

test("right-clicking the header opens the column menu; Name is locked on", () => {
  document.querySelector(".lib-tv__header .lib-tv__mode")
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  const name = menuRow("Name");
  expect(name).toBeTruthy();
  expect(name.getAttribute("aria-checked")).toBe("true");
  name.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onChange).not.toHaveBeenCalled();
});

test("the header button opens the same menu; ticking a column shows it and keeps the menu open", () => {
  document.querySelector("[data-table-columns-menu]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  menuRow("Owner").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(headerCols()).toContain("owner");
  expect(document.querySelector(".lib-ctx-menu")).toBeTruthy();
  expect(menuRow("Owner").getAttribute("aria-checked")).toBe("true");
});

test("dropping a column on another reorders it", () => {
  showTableColumnsMenu(0, 0);
  const data = new Map();
  const dt = {
    types: [], effectAllowed: "",
    setData(k, v) { data.set(k, v); this.types = [...data.keys()]; },
    getData: (k) => data.get(k) || "",
  };
  const fire = (el, type, clientY = 0) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer: dt, clientY });
    el.dispatchEvent(e);
  };
  // jsdom rows have zero-size rects, so clientY 0 is "bottom half": drop after.
  fire(menuRow("Modified"), "dragstart");
  fire(menuRow("Profession"), "drop", 1);
  const order = normalizeColumnPrefs(state.libraryPrefs.tableColumns).map((p) => p.id);
  expect(order.slice(0, 2)).toEqual(["profession", "modified"]);
  expect(headerCols().slice(3, 5)).toEqual(["profession", "modified"]);
});

test("Reset to default restores the default pick", () => {
  state.libraryPrefs.tableColumns = normalizeColumnPrefs([{ id: "tags", visible: false }, { id: "path", visible: true }]);
  renderContent();
  showTableColumnsMenu(0, 0);
  const reset = [...document.querySelectorAll(".lib-ctx-menu .lib-ctx-item")]
    .find((el) => el.textContent.trim() === "Reset to default");
  reset.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(state.libraryPrefs.tableColumns).toEqual(normalizeColumnPrefs(null));
  expect(headerCols()).toContain("tags");
  expect(headerCols()).not.toContain("path");
});
