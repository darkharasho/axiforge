/**
 * @jest-environment jsdom
 *
 * A --fixed .axi-picker's popover is measured once at open and doesn't move
 * with anything after that, so bindPicker() attaches window scroll/resize
 * listeners while it's open and tears them down on close. That teardown has
 * to run no matter which of five different paths closes the picker --
 * clicking its own trigger, Escape, choosing an option, an outside click, or
 * a sibling picker opening in the same group -- plus a render that discards
 * the picker's DOM outright while it's still open. Two of those six already
 * bypassed the teardown once (fix rounds 1 and 2 on this task), so this
 * pins the invariant from outside rather than trusting it stays fixed: every
 * add balances with a remove, observed by spying on window.addEventListener/
 * removeEventListener rather than reaching into toolbar.js's module state.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], currentFolder: { type: "all" }, folderAccess: {},
    buildSearch: "", libraryPrefs: { sortField: "updatedAt", viewMode: "list", activeFilters: {}, filters: {} },
    buildSyncStatus: {}, folderSyncStatus: {},
  },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  // Two professions and two game modes so renderFilters() draws at least two
  // filter dropdowns -- needed for the sibling-picker-in-a-group case.
  libraryBuilds: jest.fn(() => [
    { profession: "Guardian", gameMode: "pve", tags: [] },
    { profession: "Guardian", gameMode: "wvw", tags: [] },
  ]),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { renderToolbar, renderFilters, initToolbar } = require("../../../src/renderer/modules/library/toolbar.js");

const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

let counts;

function trackWindowListeners() {
  counts = { resizeAdd: 0, resizeRemove: 0, scrollAdd: 0, scrollRemove: 0 };
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  jest.spyOn(window, "addEventListener").mockImplementation((type, fn, opts) => {
    if (type === "resize") counts.resizeAdd++;
    if (type === "scroll") counts.scrollAdd++;
    return realAdd(type, fn, opts);
  });
  jest.spyOn(window, "removeEventListener").mockImplementation((type, fn, opts) => {
    if (type === "resize") counts.resizeRemove++;
    if (type === "scroll") counts.scrollRemove++;
    return realRemove(type, fn, opts);
  });
}

function expectBalanced() {
  expect(counts.resizeRemove).toBe(counts.resizeAdd);
  expect(counts.scrollRemove).toBe(counts.scrollAdd);
}

beforeEach(() => {
  document.body.innerHTML = `<div id="lib-toolbar"></div><div id="lib-filters"></div>`;
  state.currentFolder = { type: "all" };
  initToolbar({});
  renderToolbar();
  trackWindowListeners();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("trigger click open, then trigger click close: net zero window listeners", () => {
  const sortBtn = document.getElementById("lib-sort-trigger");
  click(sortBtn);
  // Sanity: opening a --fixed picker really did attach both.
  expect(counts.resizeAdd).toBe(1);
  expect(counts.scrollAdd).toBe(1);
  click(sortBtn);
  expectBalanced();
});

test("Escape: net zero window listeners", () => {
  const sortBtn = document.getElementById("lib-sort-trigger");
  click(sortBtn);
  document.getElementById("lib-sort-pop").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
  );
  expectBalanced();
});

test("choosing an option: net zero window listeners", () => {
  const sortBtn = document.getElementById("lib-sort-trigger");
  click(sortBtn);
  click(document.querySelector("#lib-sort-pop .axi-picker__opt"));
  expectBalanced();
});

test("outside click: net zero window listeners", () => {
  const sortBtn = document.getElementById("lib-sort-trigger");
  click(sortBtn);
  click(document.body);
  expectBalanced();
});

test("a sibling picker opening in the same group closes this one: net zero window listeners", () => {
  renderFilters();
  const [classTrigger, modeTrigger] = [...document.querySelectorAll("#lib-filters .lib-fd__trigger")];
  expect(classTrigger).toBeTruthy();
  expect(modeTrigger).toBeTruthy();

  click(classTrigger);
  expect(counts.resizeAdd).toBe(1);
  click(modeTrigger); // opens mode, which must close class's listeners first
  expect(counts.resizeAdd).toBe(2);
  expect(counts.resizeRemove).toBe(1);
  click(modeTrigger); // close the one left open
  expectBalanced();
});

test("re-rendering with a picker left open: net zero window listeners", () => {
  const sortBtn = document.getElementById("lib-sort-trigger");
  click(sortBtn);
  expect(counts.resizeAdd).toBe(1);
  renderToolbar();
  expectBalanced();
});
