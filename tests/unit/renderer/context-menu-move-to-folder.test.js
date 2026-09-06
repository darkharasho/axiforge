/**
 * @jest-environment jsdom
 *
 * "Move to Folder" listed top-level folders only, so a nested folder was not a
 * destination you could pick from the menu at all -- drag was the only way in.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], teams: [], teamSession: null, outbox: {},
    folderSyncStatus: {}, buildSyncStatus: {}, compSyncStatus: {}, conflicts: {},
    currentFolder: null,
  },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  shareFolderToTeam: jest.fn(),
  stopSharingFolder: jest.fn(),
  pullTeamFor: jest.fn(),
  libraryFolders: () =>
    require("../../../src/renderer/modules/state.js").state.folders.filter((f) => !f.archivedAt),
}));
jest.mock("../../../src/renderer/modules/library/access.js", () => ({
  writeDeniedReason: jest.fn(() => null),
  currentFolderId: jest.fn(() => null),
}));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));
jest.mock("../../../src/renderer/modules/library/share-modal.js", () => ({ openShareModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn() }));

const { state } = require("../../../src/renderer/modules/state.js");
const access = require("../../../src/renderer/modules/library/access.js");
const { wireContextMenuEvents, closeMenu, initContextMenu } =
  require("../../../src/renderer/modules/library/context-menu.js");

const onMoveTo = jest.fn();
const onMoveComps = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  access.writeDeniedReason.mockReturnValue(null);
  closeMenu();
  // WvW ─┬─ Zerg ─── Frontline
  //      └─ Havoc
  // Raids
  state.folders = [
    { id: "wvw", name: "WvW", parentId: null, sortOrder: 0 },
    { id: "zerg", name: "Zerg", parentId: "wvw", sortOrder: 0 },
    { id: "front", name: "Frontline", parentId: "zerg", sortOrder: 0 },
    { id: "havoc", name: "Havoc", parentId: "wvw", sortOrder: 1 },
    { id: "raids", name: "Raids", parentId: null, sortOrder: 1 },
  ];
  state.builds = [{ id: "b-1", title: "Foo", folderId: null }];
  state.comps = [{ id: "c-1", name: "Squad", folderId: null }];
  state.teams = [];
  state.teamSession = null;
  initContextMenu({ onMoveTo, onMoveComps, onToast: jest.fn() });
});

/** Right-click a row, hover "Move to Folder", and return the submenu's items. */
function moveMenuRows(attr, id) {
  document.body.innerHTML = `<div id="lib-content"><div ${attr}="${id}">row</div></div>`;
  wireContextMenuEvents();
  document
    .querySelector(`[${attr}="${id}"]`)
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const parent = [...document.querySelectorAll(".lib-ctx-menu .lib-ctx-item")].find(
    (el) => el.querySelector(".lib-ctx-item__label")?.textContent === "Move to Folder"
  );
  expect(parent).toBeTruthy();
  parent.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  const sub = document.querySelector(".lib-ctx-menu--sub");
  expect(sub).toBeTruthy();
  return [...sub.querySelectorAll(".lib-ctx-item")];
}

const buildRows = () => moveMenuRows("data-build-id", "b-1");
const labels = (rows) => rows.map((el) => el.querySelector(".lib-ctx-item__label")?.textContent);
const rowFor = (rows, name) =>
  rows.find((el) => el.querySelector(".lib-ctx-item__label")?.textContent === name);

describe("Move to Folder — nested folders", () => {
  test("lists the whole tree depth-first, parents above their children", () => {
    expect(labels(buildRows())).toEqual([
      "New Folder...",
      "Root (no folder)",
      "WvW",
      "Zerg",
      "Frontline",
      "Havoc",
      "Raids",
    ]);
  });

  test("indents each row by its depth", () => {
    const rows = buildRows();
    const indentOf = (name) => rowFor(rows, name).querySelector(".lib-ctx-item__icon").style.marginLeft;
    expect(indentOf("WvW")).toBe("");
    expect(indentOf("Zerg")).toBe("14px");
    expect(indentOf("Frontline")).toBe("28px");
    expect(indentOf("Havoc")).toBe("14px");
    expect(indentOf("Raids")).toBe("");
  });

  test("picking a nested folder moves the build into that folder", () => {
    rowFor(buildRows(), "Frontline").click();
    expect(onMoveTo).toHaveBeenCalledWith(["b-1"], "front");
  });

  test("Root is still reachable", () => {
    rowFor(buildRows(), "Root (no folder)").click();
    expect(onMoveTo).toHaveBeenCalledWith(["b-1"], null);
  });

  test("a read-only folder is shown disabled with the reason, not omitted", () => {
    access.writeDeniedReason.mockImplementation((id) => (id === "zerg" ? "Read-only folder" : null));
    const zerg = rowFor(buildRows(), "Zerg");
    expect(zerg.classList.contains("lib-ctx-item--disabled")).toBe(true);
    expect(zerg.title).toBe("Read-only folder");
    zerg.click();
    expect(onMoveTo).not.toHaveBeenCalled();
  });

  test("archived folders are not offered as destinations", () => {
    state.folders.find((f) => f.id === "havoc").archivedAt = "2026-01-01T00:00:00Z";
    expect(labels(buildRows())).not.toContain("Havoc");
  });

  test("comps get the same nested tree", () => {
    const rows = moveMenuRows("data-comp-id", "c-1");
    expect(labels(rows)).toEqual(["Root (no folder)", "WvW", "Zerg", "Frontline", "Havoc", "Raids"]);
    rowFor(rows, "Zerg").click();
    expect(onMoveComps).toHaveBeenCalledWith(["c-1"], "zerg");
  });
});
