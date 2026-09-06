/**
 * @jest-environment jsdom
 *
 * Regression: in the columns (Miller) view every column is its own sortable
 * container, but none of them sits inside a [data-folder-id], so
 * _containerFolderId() fell through to state.currentFolder for ALL of them.
 * Column 0 is the current folder -- columns 1..n are not. Dragging a build from
 * a deep column onto an ancestor column therefore moved it to whatever column 0
 * happened to be, not where it was dropped, so the build turned up in a folder
 * the user never targeted while still looking present in the one they dragged
 * from.
 *
 * Fix: each column carries data-col-folder-id / data-col-comp-id and the drop
 * resolves against that.
 */
"use strict";

const sortableMock = jest.fn().mockImplementation(function () {
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
  },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const dragDrop = require("../../../src/renderer/modules/library/drag-drop.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");

let onDropBuildsOnComp;

beforeEach(() => {
  jest.spyOn(folderStore, "moveBuilds").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderBuilds").mockResolvedValue(undefined);
  onDropBuildsOnComp = jest.fn().mockResolvedValue(undefined);
  dragDrop.initDragDrop({ onDropBuildsOnComp, onRefresh: jest.fn() });

  // X ─┬─ A ─── B
  state.folders = [
    { id: "X", name: "Shared", parentId: null, shared: true },
    { id: "A", name: "A", parentId: "X" },
    { id: "B", name: "B", parentId: "A" },
  ];
  state.builds = [{ id: "b-1", title: "Foo", folderId: "B" }];
  state.comps = [];
  state.currentFolder = { type: "custom", id: "X" };
});

afterEach(() => jest.restoreAllMocks());

// Lay out the three columns the way renderColumnsView does, then run onEnd.
function mountColumns() {
  document.body.innerHTML = `
    <div class="lib-columns">
      <div class="lib-col" data-col="0" data-col-folder-id="X"></div>
      <div class="lib-col" data-col="1" data-col-folder-id="A"></div>
      <div class="lib-col" data-col="2" data-col-folder-id="B">
        <div class="lib-col__item lib-col__item--build" data-build-id="b-1"></div>
      </div>
    </div>`;
  sortableMock.mockClear();
  dragDrop.wireDragDropEvents();
  return [...document.querySelectorAll(".lib-col")];
}

async function fireOnEnd(evt) {
  const opts = sortableMock.mock.calls[0][1];
  await opts.onEnd(evt);
}

describe("columns view — drop resolves to the column dropped on", () => {
  test("dropping onto the middle column moves the build into that column's folder", async () => {
    const [, colA, colB] = mountColumns();
    await fireOnEnd({ from: colB, to: colA, item: { dataset: { buildId: "b-1" } } });
    expect(folderStore.moveBuilds).toHaveBeenCalledWith(["b-1"], "A");
  });

  test("dropping onto column 0 moves the build into the current folder", async () => {
    const [colX, , colB] = mountColumns();
    await fireOnEnd({ from: colB, to: colX, item: { dataset: { buildId: "b-1" } } });
    expect(folderStore.moveBuilds).toHaveBeenCalledWith(["b-1"], "X");
  });

  test("dropping back into its own column reorders instead of moving", async () => {
    const [, , colB] = mountColumns();
    await fireOnEnd({ from: colB, to: colB, item: { dataset: { buildId: "b-1" } } });
    expect(folderStore.moveBuilds).not.toHaveBeenCalled();
    expect(folderStore.reorderBuilds).toHaveBeenCalled();
  });

  test("a root column resolves to root, not to the current folder", async () => {
    state.currentFolder = null;
    // Plain (unshared) tree — moving out of a shared root is refused by design.
    state.folders = [{ id: "A", name: "A", parentId: null }];
    document.body.innerHTML = `
      <div class="lib-columns">
        <div class="lib-col" data-col="0" data-col-folder-id=""></div>
        <div class="lib-col" data-col="1" data-col-folder-id="A">
          <div class="lib-col__item lib-col__item--build" data-build-id="b-1"></div>
        </div>
      </div>`;
    state.builds = [{ id: "b-1", title: "Foo", folderId: "A" }];
    sortableMock.mockClear();
    dragDrop.wireDragDropEvents();
    const [colRoot, colA] = [...document.querySelectorAll(".lib-col")];
    await fireOnEnd({ from: colA, to: colRoot, item: { dataset: { buildId: "b-1" } } });
    expect(folderStore.moveBuilds).toHaveBeenCalledWith(["b-1"], null);
  });

  test("dropping a build into a comp column adds it to the comp, never moves it", async () => {
    state.comps = [{ id: "c-1", name: "Squad", folderId: "X", buildIds: [] }];
    document.body.innerHTML = `
      <div class="lib-columns">
        <div class="lib-col" data-col="0" data-col-folder-id="X"></div>
        <div class="lib-col" data-col="1" data-col-comp-id="c-1">
          <div class="lib-col__item lib-col__item--build" data-build-id="b-1"></div>
        </div>
      </div>`;
    sortableMock.mockClear();
    dragDrop.wireDragDropEvents();
    const [, colComp] = [...document.querySelectorAll(".lib-col")];
    await fireOnEnd({ from: colComp, to: colComp, item: { dataset: { buildId: "b-1" } } });
    expect(folderStore.moveBuilds).not.toHaveBeenCalled();
    expect(onDropBuildsOnComp).toHaveBeenCalledWith(["b-1"], "c-1");
  });
});
