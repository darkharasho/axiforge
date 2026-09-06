/**
 * @jest-environment jsdom
 *
 * Regression: a phantom build row left floating over every library view.
 *
 * We drive SortableJS with forceFallback + fallbackOnBody, so a live drag parks
 * a full clone of the row (`ghostEl`) on <body>, positioned fixed. Sortable only
 * removes that clone inside `if (evt)` in _onDrop — and `destroy()` calls
 * `_onDrop()` with NO event, then nulls the reference. So any render that lands
 * mid-drag destroys the instances, strands the clone, and throws away the only
 * handle to it. It is not inside #lib-content, so no later render can clear it:
 * the user gets a build row pinned at its old screen coordinates, sitting on top
 * of the Archive, the Trash and every folder they open until they restart.
 *
 * The fix is a sweep at the one place we call destroy().
 */
"use strict";

const sortableMock = jest.fn().mockImplementation(function () {
  // Faithful to the bug: destroy() does NOT take the body clone with it.
  this.destroy = jest.fn();
});
sortableMock.create = (el, options) => new sortableMock(el, options);
jest.mock("sortablejs", () => ({ __esModule: true, default: sortableMock }));

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [],
    builds: [],
    comps: [],
    currentFolder: null,
    teams: [],
    teamSession: null,
    libraryPrefs: { sortField: "title", sortDirection: "asc" },
  },
}));

const dragDrop = require("../../../src/renderer/modules/library/drag-drop.js");

/** What Sortable._appendGhost leaves on <body>: a clone wearing fallbackClass. */
function strandGhost(className = "lib-drag-fallback") {
  const ghost = document.createElement("div");
  ghost.className = `lib-list-row lib-list-row--build ${className}`;
  ghost.dataset.buildId = "b1";
  ghost.style.position = "fixed";
  ghost.textContent = "Berserker Main Build GS-D/A";
  document.body.appendChild(ghost);
  return ghost;
}

beforeEach(() => {
  document.body.innerHTML = `<div id="lib-content"><div class="lib-list"></div></div>`;
  dragDrop.initDragDrop({});
});

test("a ghost stranded by a mid-drag render is swept on the next wiring", () => {
  strandGhost();
  expect(document.querySelectorAll("body > .lib-drag-fallback")).toHaveLength(1);

  dragDrop.wireDragDropEvents();

  expect(document.querySelectorAll("body > .lib-drag-fallback")).toHaveLength(0);
});

test("the dragClass clone is swept too — Sortable puts both classes on the ghost", () => {
  strandGhost("lib-drag-active");
  dragDrop.wireDragDropEvents();
  expect(document.querySelectorAll("body > .lib-drag-active")).toHaveLength(0);
});

test("navigating to a view that renders no rows still clears it", () => {
  // The Archive and Trash bypass the list renderers entirely and just replace
  // #lib-content's innerHTML, which is exactly why the stranded clone used to
  // survive the trip and show a build row on a page that has no builds.
  strandGhost();

  document.getElementById("lib-content").innerHTML = `<div class="lib-archive"></div>`;
  dragDrop.wireDragDropEvents();

  expect(document.querySelector("body > .lib-drag-fallback")).toBeNull();
  expect(document.querySelectorAll("[data-build-id]")).toHaveLength(0);
});

test("rows inside the library are never mistaken for a stranded ghost", () => {
  // The sweep is scoped to direct children of <body>. A real row carrying the
  // drag classes mid-drag lives inside #lib-content and must survive.
  const list = document.querySelector(".lib-list");
  const row = document.createElement("div");
  row.className = "lib-list-row lib-drag-active";
  row.dataset.buildId = "keep-me";
  list.appendChild(row);

  dragDrop.wireDragDropEvents();

  expect(document.querySelector('[data-build-id="keep-me"]')).not.toBeNull();
});

test("the sweep is idempotent and harmless when nothing was stranded", () => {
  expect(() => {
    dragDrop.wireDragDropEvents();
    dragDrop.wireDragDropEvents();
  }).not.toThrow();
  expect(document.querySelectorAll("body > .lib-drag-fallback")).toHaveLength(0);
});
