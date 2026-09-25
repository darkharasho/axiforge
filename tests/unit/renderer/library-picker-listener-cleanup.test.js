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

// The scroll listener is on window with { capture: true } so that a scroll
// inside .lib-main -- which does not bubble -- still closes the popover. A
// capture listener on window also receives a scroll from any *descendant*,
// including .axi-picker__pop's own overflow-y scroll, so it has to check the
// target before closing.
describe("scrolling the popover's own list does not close it", () => {
  test("a scroll inside the popover is ignored, one outside it closes", () => {
    const sortBtn = document.getElementById("lib-sort-trigger");
    click(sortBtn);
    const pop = document.getElementById("lib-sort-pop");
    expect(pop.hidden).toBe(false);

    // Wheeling down the option list: the scroll originates inside the popover.
    pop.dispatchEvent(new Event("scroll"));
    expect(pop.hidden).toBe(false);
    expect(sortBtn.getAttribute("aria-expanded")).toBe("true");

    // A scroll from an option inside the popover is equally the popover's own.
    pop.querySelector(".axi-picker__opt").dispatchEvent(new Event("scroll"));
    expect(pop.hidden).toBe(false);

    // A scroll from anywhere else still closes it, and tears the listeners down.
    document.body.dispatchEvent(new Event("scroll"));
    expect(pop.hidden).toBe(true);
    expect(sortBtn.getAttribute("aria-expanded")).toBe("false");
    expectBalanced();
  });
});

// The native <select> the picker replaced opened on ArrowDown/ArrowUp, and the
// listbox pattern expects it. Enter/Space already work via the <button>.
describe("ArrowDown/ArrowUp on the closed trigger", () => {
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

  test("ArrowDown opens the popover and lands focus on the current choice", () => {
    const sortBtn = document.getElementById("lib-sort-trigger");
    const pop = document.getElementById("lib-sort-pop");
    expect(pop.hidden).toBe(true);
    key(sortBtn, "ArrowDown");
    expect(pop.hidden).toBe(false);
    expect(sortBtn.getAttribute("aria-expanded")).toBe("true");
    expect(pop.contains(document.activeElement)).toBe(true);
    click(sortBtn);
    expectBalanced();
  });

  test("ArrowUp opens it too", () => {
    const sortBtn = document.getElementById("lib-sort-trigger");
    key(sortBtn, "ArrowUp");
    expect(document.getElementById("lib-sort-pop").hidden).toBe(false);
    click(sortBtn);
    expectBalanced();
  });

  test("ArrowDown on an already-open trigger does not re-open (no duplicate listeners)", () => {
    const sortBtn = document.getElementById("lib-sort-trigger");
    key(sortBtn, "ArrowDown");
    expect(counts.scrollAdd).toBe(1);
    key(sortBtn, "ArrowDown");
    expect(counts.scrollAdd).toBe(1);
    click(sortBtn);
    expectBalanced();
  });

  test("the filter dropdowns get it from the same binding", () => {
    renderFilters();
    const classTrigger = document.querySelector("#lib-filters .lib-fd__trigger");
    key(classTrigger, "ArrowDown");
    expect(classTrigger.getAttribute("aria-expanded")).toBe("true");
    click(classTrigger);
    expectBalanced();
  });
});
