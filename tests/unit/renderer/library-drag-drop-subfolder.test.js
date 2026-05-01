/**
 * @jest-environment jsdom
 *
 * Regression: shift+click selection inside a subfolder (custom or shared)
 * was kicking the build/folder/comp back to root. SortableJS in forceFallback
 * mode can fire onEnd from a near-stationary click. The onEnd handler resolved
 * the destination folder from `dropContainer.closest('[data-folder-id]')`,
 * which is null in flat views (list/grid/icon), so any in-place sortable end
 * resolved to root and silently moved the item out.
 *
 * Fix: derive the destination folder from state.currentFolder when the
 * container has no [data-folder-id] ancestor.
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
    sharedLibraryConfig: { isOwner: true },
  },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const dragDrop = require("../../../src/renderer/modules/library/drag-drop.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");

beforeEach(() => {
  jest.spyOn(folderStore, "moveBuilds").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderBuilds").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderComps").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderFolders").mockResolvedValue(undefined);
  state.folders = [];
  state.builds = [];
  state.comps = [];
  state.currentFolder = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Run the onEnd handler captured by the Sortable mock.
async function fireOnEnd(evt) {
  // Trigger wireDragDropEvents to register callbacks; we need a sortable container
  // for Sortable.create to be called.
  document.body.innerHTML = `<div class="lib-list"></div>`;
  sortableMock.mockClear();
  dragDrop.wireDragDropEvents();
  expect(sortableMock).toHaveBeenCalled();
  const opts = sortableMock.mock.calls[0][1];
  await opts.onEnd(evt);
}

function makeBuild(id, folderId) {
  return { id, title: id, folderId };
}

describe("drag-drop onEnd in flat-view subfolder context", () => {
  test("in-place build sortable end inside custom subfolder does NOT move build to root", async () => {
    const subfolder = { id: "sub-1", name: "Sub", parentId: null };
    state.folders = [subfolder];
    state.builds = [makeBuild("b-1", "sub-1")];
    state.currentFolder = { type: "custom", id: "sub-1" };

    const list = document.body; // any container without [data-folder-id]
    const evt = {
      from: list,
      to: list,
      item: { dataset: { buildId: "b-1" } },
    };

    await fireOnEnd(evt);

    expect(folderStore.moveBuilds).not.toHaveBeenCalled();
  });

  test("in-place build sortable end inside shared subfolder does NOT move build to root", async () => {
    state.folders = [{ id: "shared-1", name: "Shared", parentId: null, shared: true, orgName: "org" }];
    state.builds = [makeBuild("b-1", "shared-1")];
    state.currentFolder = { type: "custom", id: "shared-1" };

    const list = document.body;
    const evt = {
      from: list,
      to: list,
      item: { dataset: { buildId: "b-1" } },
    };

    await fireOnEnd(evt);

    expect(folderStore.moveBuilds).not.toHaveBeenCalled();
  });

  test("in-place folder sortable end inside shared folder does NOT change parentId", async () => {
    const onMoveFolder = jest.fn();
    dragDrop.initDragDrop({ onMoveFolder, onRefresh: jest.fn() });
    state.folders = [
      { id: "shared-1", name: "Shared", parentId: null, shared: true },
      { id: "child-1", name: "Child", parentId: "shared-1" },
    ];
    state.currentFolder = { type: "custom", id: "shared-1" };

    const list = document.body;
    const evt = {
      from: list,
      to: list,
      item: { dataset: { folderId: "child-1" } },
    };

    await fireOnEnd(evt);

    expect(onMoveFolder).not.toHaveBeenCalled();
  });

  test("in-place comp sortable end inside subfolder does NOT change folderId", async () => {
    const onMoveComps = jest.fn();
    dragDrop.initDragDrop({ onMoveComps, onRefresh: jest.fn() });
    state.folders = [{ id: "sub-1", name: "Sub", parentId: null }];
    state.comps = [{ id: "c-1", name: "Comp", folderId: "sub-1" }];
    state.currentFolder = { type: "custom", id: "sub-1" };

    const list = document.body;
    const evt = {
      from: list,
      to: list,
      item: { dataset: { compId: "c-1" } },
    };

    await fireOnEnd(evt);

    expect(onMoveComps).not.toHaveBeenCalled();
  });
});
