/**
 * @jest-environment jsdom
 *
 * Regression: SortableJS has already moved the DOM node by the time onEnd runs,
 * so any exit path that skipped `onRefresh` left the item painted in a place the
 * data never agreed to — the "drag freezes halfway / didn't copy" reports. Main
 * process guards (team ownership, FOLDER_TOO_DEEP) reject by throwing, which
 * used to escape the async handler entirely: no repaint and no explanation.
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
    libraryPrefs: { sortField: "title", sortDirection: "asc" },
  },
}));

const { state } = require("../../../src/renderer/modules/state.js");
const dragDrop = require("../../../src/renderer/modules/library/drag-drop.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");
const selection = require("../../../src/renderer/modules/library/selection.js");
const toast = require("../../../src/renderer/modules/library/toast.js");

let onRefresh;
let onMoveFolder;
let onMoveComps;
let toastSpy;

beforeEach(() => {
  jest.spyOn(folderStore, "moveBuilds").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderBuilds").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderComps").mockResolvedValue(undefined);
  jest.spyOn(folderStore, "reorderFolders").mockResolvedValue(undefined);
  toastSpy = jest.spyOn(toast, "showToast").mockImplementation(() => {});
  state.folders = [];
  state.builds = [];
  state.comps = [];
  state.currentFolder = null;
  onRefresh = jest.fn();
  onMoveFolder = jest.fn().mockResolvedValue(undefined);
  onMoveComps = jest.fn().mockResolvedValue(undefined);
  dragDrop.initDragDrop({ onRefresh, onMoveFolder, onMoveComps });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function fireOnEnd(evt) {
  document.body.innerHTML = `<div class="lib-list"></div>`;
  sortableMock.mockClear();
  dragDrop.wireDragDropEvents();
  const opts = sortableMock.mock.calls[0][1];
  await opts.onEnd(evt);
}

describe("drag-drop onEnd always repaints", () => {
  test("a rejected folder move repaints and surfaces the reason", async () => {
    state.folders = [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: null },
    ];
    state.currentFolder = { id: "b", type: "custom" };
    onMoveFolder.mockRejectedValue(new Error(
      "Error invoking remote method 'folders:save': Error: FOLDER_TOO_DEEP",
    ));

    const item = document.createElement("li");
    item.dataset.folderId = "a";
    const to = document.createElement("ul");
    await fireOnEnd({ item, to });

    expect(onMoveFolder).toHaveBeenCalledWith("a", "b");
    expect(onRefresh).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining("3 levels deep"),
      "error",
    );
  });

  test("a comp move blocked by shared ownership repaints and explains itself", async () => {
    state.folders = [
      { id: "shared", name: "Team", parentId: null, shared: true, teamId: "t1" },
      { id: "mine", name: "Mine", parentId: null },
    ];
    state.comps = [{ id: "c1", name: "Comp", folderId: "shared" }];
    state.currentFolder = { id: "mine", type: "custom" };

    const item = document.createElement("li");
    item.dataset.compId = "c1";
    const to = document.createElement("ul");
    await fireOnEnd({ item, to });

    expect(onMoveComps).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringContaining("shared folder"),
      "error",
    );
  });

  test("dropping a folder into its own descendant refuses without renumbering", async () => {
    state.folders = [
      { id: "parent", name: "Parent", parentId: null },
      { id: "child", name: "Child", parentId: "parent" },
    ];
    state.currentFolder = { id: "child", type: "custom" };

    const item = document.createElement("li");
    item.dataset.folderId = "parent";
    const to = document.createElement("ul");
    await fireOnEnd({ item, to });

    expect(onMoveFolder).not.toHaveBeenCalled();
    // The old code fell through to the reorder branch and renumbered a
    // container the dragged folder does not belong to.
    expect(folderStore.reorderFolders).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe("a container-to-container drop carries the whole selection", () => {
  // Every drop path that goes through a hover target already honoured the
  // multi-selection. The plain SortableJS branch — reached when the drop had no
  // hover target at all — moved only the dragged build and silently left the
  // rest behind. The COLUMNS view hits that branch for every move, because a
  // .lib-col is neither inside a [data-folder-id] nor a nav target, so
  // shift-selecting several builds and dragging them out of a folder moved
  // exactly one of them.
  beforeEach(() => {
    state.folders = [{ id: "src", name: "Source", parentId: null }];
    state.builds = [
      { id: "b1", title: "One", folderId: "src" },
      { id: "b2", title: "Two", folderId: "src" },
      { id: "b3", title: "Three", folderId: "src" },
    ];
    state.currentFolder = null; // columns view browses from the root
    selection.clearSelection();
  });

  test("moves every selected build, not just the one under the cursor", async () => {
    selection.handleBuildClick("b1", {});
    selection.handleBuildClick("b2", { ctrlKey: true });
    expect(selection.getSelection().sort()).toEqual(["b1", "b2"]);

    const item = document.createElement("li");
    item.dataset.buildId = "b1";
    const to = document.createElement("ul"); // a bare .lib-col — no folder id
    await fireOnEnd({ item, to });

    expect(folderStore.moveBuilds).toHaveBeenCalledTimes(1);
    const [ids, dest] = folderStore.moveBuilds.mock.calls[0];
    expect([...ids].sort()).toEqual(["b1", "b2"]);
    expect(dest).toBeNull();
  });

  test("a build dragged on its own still moves alone, even with others selected", async () => {
    selection.handleBuildClick("b2", {});
    selection.handleBuildClick("b3", { ctrlKey: true });

    const item = document.createElement("li");
    item.dataset.buildId = "b1"; // not part of the selection
    const to = document.createElement("ul");
    await fireOnEnd({ item, to });

    expect(folderStore.moveBuilds).toHaveBeenCalledWith(["b1"], null);
  });
});
