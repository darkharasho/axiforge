/**
 * @jest-environment jsdom
 *
 * Task 4 (Team Sync UI): the folder context menu must gate the team actions on
 * the *item's* team root and the user's role in it:
 *   - team folder            → "Pull now"
 *   - team ROOT + owner      → "Stop sharing" and a disabled "Delete Folder"
 *   - team sub-folder        → no "Stop sharing" (root only)
 *   - team folder as member  → no "Stop sharing"
 *   - personal folder        → "Share to team…" (only with a team session)
 *   - no team session        → none of the above
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
jest.mock("../../../src/renderer/modules/choice-modal.js", () => ({
  showChoiceModal: jest.fn(async () => null),
}));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");
const { showChoiceModal } = require("../../../src/renderer/modules/choice-modal.js");
const { showConfirmModal } = require("../../../src/renderer/modules/confirm-modal.js");
const { wireContextMenuEvents, closeMenu, initContextMenu } =
  require("../../../src/renderer/modules/library/context-menu.js");

const OWNED_ROOT = { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" };
const OWNED_SUB = { id: "a", name: "Sub", parentId: "t" };
const MEMBER_ROOT = { id: "m", name: "Guild", parentId: null, shared: true, teamId: "m", role: "member" };
const PERSONAL = { id: "p", name: "Personal", parentId: null };

let toasts;

beforeEach(() => {
  jest.clearAllMocks();
  const selection = require("../../../src/renderer/modules/library/selection.js");
  selection.isSelected.mockReturnValue(false);
  selection.getSelection.mockReturnValue([]);
  closeMenu();
  toasts = [];
  state.folders = [OWNED_ROOT, OWNED_SUB, MEMBER_ROOT, PERSONAL];
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
  expect(l).toContain("Pull now");
  expect(l).toContain("Stop sharing");
  expect(l).not.toContain("Share to team…");

  const del = itemFor(menu, "Delete Folder");
  expect(del.className).toContain("lib-ctx-item--disabled");
  expect(del.title).toBe("Leave or delete the team in Settings → Teams");
});

test("owner on a team SUB-folder gets Pull now but not Stop sharing, and can delete it", () => {
  const menu = openFolderMenu("a");
  const l = labels(menu);
  expect(l).toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
  expect(l).not.toContain("Share to team…");
  expect(itemFor(menu, "Delete Folder").className).not.toContain("lib-ctx-item--disabled");
});

test("a member gets Pull now but never Stop sharing", () => {
  const menu = openFolderMenu("m");
  const l = labels(menu);
  expect(l).toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});

test("a personal folder offers Share to team… when signed in", () => {
  expect(labels(openFolderMenu("p"))).toContain("Share to team…");
});

test("with no team session none of the team actions appear", () => {
  state.teamSession = null;
  state.teams = [];
  const l = labels(openFolderMenu("p"));
  expect(l).not.toContain("Share to team…");
  expect(l).not.toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});

test("signed in with no teams: Share to team… points the user at Settings → Teams", async () => {
  state.teams = [];
  const menu = openFolderMenu("p");
  itemFor(menu, "Share to team…").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await Promise.resolve();
  expect(folderStore.shareFolderToTeam).not.toHaveBeenCalled();
  expect(toasts[0].m).toContain("Settings → Teams");
});

test("one team: Share to team… confirms and shares to that team", async () => {
  const menu = openFolderMenu("p");
  itemFor(menu, "Share to team…").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(showConfirmModal).toHaveBeenCalled();
  expect(showChoiceModal).not.toHaveBeenCalled();
  expect(folderStore.shareFolderToTeam).toHaveBeenCalledWith("p", "t");
});

test("several teams: Share to team… asks which team, and a dismissed picker shares nothing", async () => {
  state.teams = [
    { team: { id: "t", name: "EWW" }, role: "owner" },
    { team: { id: "m", name: "Guild" }, role: "member" },
  ];
  showChoiceModal.mockResolvedValueOnce("m");
  let menu = openFolderMenu("p");
  itemFor(menu, "Share to team…").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(showChoiceModal.mock.calls[0][0].choices).toEqual([
    { id: "t", label: "EWW" },
    { id: "m", label: "Guild" },
  ]);
  expect(folderStore.shareFolderToTeam).toHaveBeenCalledWith("p", "m");

  showChoiceModal.mockResolvedValueOnce(null);
  menu = openFolderMenu("p");
  itemFor(menu, "Share to team…").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(folderStore.shareFolderToTeam).toHaveBeenCalledTimes(1);
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
  expect(l).not.toContain("Share to team…");
  expect(l).not.toContain("Pull now");
  expect(l).not.toContain("Stop sharing");
});
