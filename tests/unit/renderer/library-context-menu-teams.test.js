/**
 * @jest-environment jsdom
 *
 * Task 4 (Team Sync UI): the folder context menu must gate the team actions on
 * the *item's* team root and the user's role in it:
 *   - team folder            → "Share…" + "Pull now"
 *   - team ROOT + owner      → "Stop sharing" and a disabled "Delete Folder"
 *   - team sub-folder        → no "Stop sharing" (root only)
 *   - team folder as member  → no "Stop sharing"
 *   - top-level personal     → "Share…", signed in or not (the modal handles sign-in)
 *   - nested personal folder → no team actions (only a top-level folder can be a root)
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
  shareFolderToTeam: jest.fn(async () => ({ uploaded: 3, failed: [] })),
  stopSharingFolder: jest.fn(async () => {}),
  pullTeamFor: jest.fn(async () => {}),
}));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({
  showConfirmModal: jest.fn(async () => true),
}));
jest.mock("../../../src/renderer/modules/library/share-modal.js", () => ({
  openShareModal: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");
const { openShareModal } = require("../../../src/renderer/modules/library/share-modal.js");
const { showConfirmModal } = require("../../../src/renderer/modules/confirm-modal.js");
const { wireContextMenuEvents, closeMenu, initContextMenu } =
  require("../../../src/renderer/modules/library/context-menu.js");

const OWNED_ROOT = { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" };
const OWNED_SUB = { id: "a", name: "Sub", parentId: "t" };
const MEMBER_ROOT = { id: "m", name: "Guild", parentId: null, shared: true, teamId: "m", role: "member" };
const PERSONAL = { id: "p", name: "Personal", parentId: null };
const PERSONAL_SUB = { id: "ps", name: "Nested", parentId: "p" };

let toasts;

beforeEach(() => {
  jest.clearAllMocks();
  const selection = require("../../../src/renderer/modules/library/selection.js");
  selection.isSelected.mockReturnValue(false);
  selection.getSelection.mockReturnValue([]);
  closeMenu();
  toasts = [];
  state.folders = [OWNED_ROOT, OWNED_SUB, MEMBER_ROOT, PERSONAL, PERSONAL_SUB];
  state.builds = [];
  state.comps = [];
  state.currentFolder = null;
  state.teamSession = { userId: "u", login: "me" };
  state.teams = [{ team: { id: "t", name: "EWW" }, role: "owner" }];
  initContextMenu({ onToast: (m, type) => toasts.push({ m, type }) });
});

/** Right-click a folder row and return the rendered menu element. */
function openFolderMenu(folderId) {
  document.body.innerHTML = `<div id="lib-content"><div data-folder-id="${folderId}">row</div></div>`;
  wireContextMenuEvents();
  document
    .querySelector(`[data-folder-id="${folderId}"]`)
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.querySelector(".lib-ctx-menu");
  expect(menu).toBeTruthy();
  return menu;
}

function labels(menu) {
  return [...menu.querySelectorAll(".lib-ctx-item__label")].map((el) => el.textContent);
}

function itemFor(menu, label) {
  return [...menu.querySelectorAll(".lib-ctx-item")]
    .find((el) => el.querySelector(".lib-ctx-item__label")?.textContent === label);
}

test("owner on the team root gets Pull now + Stop sharing, and Delete Folder is disabled", () => {
  const menu = openFolderMenu("t");
  const l = labels(menu);
  expect(l).toContain("Share…");
  expect(l).toContain("Pull now");
  expect(l).toContain("Stop sharing");

  const del = itemFor(menu, "Delete Folder");
  expect(del.className).toContain("lib-ctx-item--disabled");
  expect(del.title).toBe("Leave or delete the team in Settings → Teams");
});

test("owner on a team SUB-folder gets Pull now but not Stop sharing, and can delete it", () => {
  const menu = openFolderMenu("a");
  const l = labels(menu);
  expect(l).toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
  expect(itemFor(menu, "Delete Folder").className).not.toContain("lib-ctx-item--disabled");
});

test("a member gets Pull now but never Stop sharing", () => {
  const menu = openFolderMenu("m");
  const l = labels(menu);
  expect(l).toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});

test("a top-level personal folder offers Share…, signed in or not", () => {
  expect(labels(openFolderMenu("p"))).toContain("Share…");

  // The old menu hid the item without a session, which made the action a dead
  // end that sent the user to Settings. The modal signs them in itself now.
  state.teamSession = null;
  state.teams = [];
  const l = labels(openFolderMenu("p"));
  expect(l).toContain("Share…");
  expect(l).not.toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});

test("a nested personal folder offers no team actions — only a top-level folder can be a team root", () => {
  const l = labels(openFolderMenu("ps"));
  expect(l).not.toContain("Share…");
  expect(l).not.toContain("Pull now");
});

test("Share… hands off to the share modal with the folder and a refresh callback", () => {
  let refreshed = 0;
  initContextMenu({ onToast: () => {}, onRefresh: () => { refreshed++; } });
  const menu = openFolderMenu("p");
  itemFor(menu, "Share…").dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(openShareModal).toHaveBeenCalledTimes(1);
  const [folderId, opts] = openShareModal.mock.calls[0];
  expect(folderId).toBe("p");
  opts.onRefresh();
  expect(refreshed).toBe(1);
  // The menu no longer shares anything itself — that lives in the modal.
  expect(folderStore.shareFolderToTeam).not.toHaveBeenCalled();
});

test("Share… on a team folder opens the same modal (invite code + members)", () => {
  const menu = openFolderMenu("t");
  itemFor(menu, "Share…").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(openShareModal).toHaveBeenCalledWith("t", expect.objectContaining({ onRefresh: expect.any(Function) }));
});

test("Stop sharing only calls through once confirmed", async () => {
  showConfirmModal.mockResolvedValueOnce(false);
  let menu = openFolderMenu("t");
  itemFor(menu, "Stop sharing").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(folderStore.stopSharingFolder).not.toHaveBeenCalled();

  menu = openFolderMenu("t");
  itemFor(menu, "Stop sharing").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(folderStore.stopSharingFolder).toHaveBeenCalledWith("t");
});

test("multi-select move is allowed when only personal + owned-team items are selected (R3a)", () => {
  state.builds = [
    { id: "b1", title: "Owned", folderId: "a" },
    { id: "b2", title: "Personal", folderId: "p" },
  ];
  const selection = require("../../../src/renderer/modules/library/selection.js");
  selection.isSelected.mockReturnValue(true);
  selection.getSelection.mockReturnValue(["b1", "b2"]);
  document.body.innerHTML = `<div id="lib-content"><div data-build-id="b1">row</div></div>`;
  wireContextMenuEvents();
  document.querySelector("[data-build-id]")
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  expect(labels(document.querySelector(".lib-ctx-menu"))).toContain("Move to Folder");

  // A member-team item in the mix vetoes the move.
  state.builds.push({ id: "b3", title: "Theirs", folderId: "m" });
  selection.getSelection.mockReturnValue(["b1", "b2", "b3"]);
  document.querySelector("[data-build-id]")
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  expect(labels(document.querySelector(".lib-ctx-menu"))).not.toContain("Move to Folder");
});

test("Pull now toasts and still refreshes when the pull fails, with no unhandled rejection", async () => {
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);

  let refreshed = 0;
  initContextMenu({ onToast: (m, type) => toasts.push({ m, type }), onRefresh: () => { refreshed++; } });
  folderStore.pullTeamFor.mockRejectedValueOnce(new Error("SYNC_OFFLINE"));

  const menu = openFolderMenu("t");
  itemFor(menu, "Pull now").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  expect(toasts).toEqual([{ m: "SYNC_OFFLINE", type: "error" }]);
  expect(refreshed).toBe(1);
  expect(unhandled).toEqual([]);
  process.off("unhandledRejection", onUnhandled);
});

test("a right-click on an unknown folder id offers no team actions", () => {
  const l = labels(openFolderMenu("does-not-exist"));
  expect(l).not.toContain("Share…");
  expect(l).not.toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});
