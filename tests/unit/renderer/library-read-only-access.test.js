/**
 * @jest-environment jsdom
 *
 * A read-only member used to find out what they could not do by doing it: the
 * control looked live, the write went in locally, and a refusal arrived from the
 * server seconds later. `teams:access` already resolved the answer per folder;
 * nothing in the library asked it.
 *
 * These pin both halves — the lookup (access.js), and that the surfaces which
 * mutate a folder actually consult it.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], teams: [], teamSession: null, outbox: {},
    folderSyncStatus: {}, buildSyncStatus: {}, compSyncStatus: {}, conflicts: {},
    currentFolder: null, folderAccess: {},
  },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  shareFolderToTeam: jest.fn(),
  stopSharingFolder: jest.fn(),
  pullTeamFor: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/share-modal.js", () => ({ openShareModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const access = require("../../../src/renderer/modules/library/access.js");
const { wireContextMenuEvents, closeMenu, initContextMenu } =
  require("../../../src/renderer/modules/library/context-menu.js");

// The tooltip leads with the one-line reason and then spells out what read
// still allows; tests match the lead so the explainer can be reworded freely.
const READ_ONLY = expect.stringMatching(
  /^Read-only — the team owner controls who can change this folder\n/,
);

// A team the user is only allowed to read, and a personal folder beside it.
const TEAM_ROOT = { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "member" };
const TEAM_SUB = { id: "ro", name: "Raids", parentId: "t" };
const TEAM_MINE = { id: "rw", name: "Mine", parentId: "t" };
const PERSONAL = { id: "p", name: "Personal", parentId: null };

beforeEach(() => {
  jest.clearAllMocks();
  closeMenu();
  state.folders = [TEAM_ROOT, TEAM_SUB, TEAM_MINE, PERSONAL];
  state.builds = [];
  state.comps = [];
  state.currentFolder = null;
  state.teamSession = { userId: "u", login: "me" };
  state.teams = [{ team: { id: "t", name: "EWW" }, role: "member" }];
  state.folderAccess = { t: "read", ro: "read", rw: "write" };
  initContextMenu({});
});

describe("access lookup", () => {
  test("a folder with no entry is personal, and personal work is never restricted", () => {
    expect(access.accessTo("p")).toBe("delete");
    expect(access.canWrite("p")).toBe(true);
    expect(access.writeDeniedReason("p")).toBeNull();
  });

  test("the library root (no folder at all) is writable", () => {
    expect(access.canWrite(null)).toBe(true);
    expect(access.canWrite(undefined)).toBe(true);
  });

  test("read refuses a write and says why; write allows it", () => {
    expect(access.canWrite("ro")).toBe(false);
    expect(access.writeDeniedReason("ro")).toEqual(READ_ONLY);
    expect(access.canWrite("rw")).toBe(true);
    expect(access.writeDeniedReason("rw")).toBeNull();
  });

  test("none is at least as restrictive as read", () => {
    state.folderAccess = { x: "none" };
    expect(access.canWrite("x")).toBe(false);
  });

  test("a failed fetch leaves the library usable rather than locking it down", async () => {
    window.desktopApi = { teamAccessMap: jest.fn(async () => { throw new Error("offline"); }) };
    await access.loadAccessMap();
    expect(state.folderAccess).toEqual({});
    expect(access.canWrite("ro")).toBe(true); // the server still refuses; the UI does not pre-empt it
  });

  test("a successful fetch replaces the map wholesale, so a revoked grant goes away", async () => {
    window.desktopApi = { teamAccessMap: jest.fn(async () => ({ ro: "write" })) };
    await access.loadAccessMap();
    expect(state.folderAccess).toEqual({ ro: "write" });
  });
});

describe("currentFolderId", () => {
  test("names the folder for a folder view and nothing for the root", () => {
    expect(access.currentFolderId()).toBeNull();
    state.currentFolder = { type: "custom", id: "ro" };
    expect(access.currentFolderId()).toBe("ro");
  });

  test("a smart folder or the Trash spans folders, so there is no single answer", () => {
    state.currentFolder = { type: "smart", id: "recent" };
    expect(access.currentFolderId()).toBeNull();
    state.currentFolder = { type: "trash", id: "trash" };
    expect(access.currentFolderId()).toBeNull();
  });

  test("inside a comp it is the comp's folder — that is where a new build lands", () => {
    state.comps = [{ id: "c1", name: "Zerg", folderId: "ro" }];
    state.currentFolder = { type: "comp", id: "c1" };
    expect(access.currentFolderId()).toBe("ro");
  });
});

describe("the context menu greys what the folder refuses", () => {
  const open = (attr, id) => {
    document.body.innerHTML = `<div id="lib-content"><div data-${attr}="${id}">row</div></div>`;
    wireContextMenuEvents();
    document.querySelector(`[data-${attr}="${id}"]`)
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return document.querySelector(".lib-ctx-menu");
  };
  const itemFor = (menu, label) =>
    [...menu.querySelectorAll(".lib-ctx-item")]
      .find((el) => el.querySelector(".lib-ctx-item__label")?.textContent === label);
  const disabled = (menu, label) => {
    const el = itemFor(menu, label);
    expect(el).toBeTruthy();
    return el.className.includes("lib-ctx-item--disabled");
  };

  test("a read-only folder refuses everything that would change it, and says why", () => {
    const menu = open("folder-id", "ro");
    for (const label of ["Rename", "New Sub-folder", "New Build in Folder", "Paste", "Delete Folder"]) {
      expect([label, disabled(menu, label)]).toEqual([label, true]);
      expect(itemFor(menu, label).title).toEqual(READ_ONLY);
    }
  });

  test("...but not what only reads it — the point is the difference", () => {
    const menu = open("folder-id", "ro");
    for (const label of ["Open Folder", "Export (.axicode)", "View History", "Pull now"]) {
      expect([label, disabled(menu, label)]).toEqual([label, false]);
    }
  });

  test("a folder you can write in keeps every one of those live", () => {
    const menu = open("folder-id", "rw");
    for (const label of ["Rename", "New Sub-folder", "Paste", "Delete Folder"]) {
      expect([label, disabled(menu, label)]).toEqual([label, false]);
    }
  });

  test("clicking a greyed item does nothing at all", () => {
    const onRenameFolder = jest.fn();
    initContextMenu({ onRenameFolder });
    const menu = open("folder-id", "ro");
    itemFor(menu, "Rename").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRenameFolder).not.toHaveBeenCalled();
  });

  test("the team-root reason wins over the access one — it is the more specific", () => {
    const menu = open("folder-id", "t");
    expect(itemFor(menu, "Delete Folder").title).toBe("Leave or delete the team in Settings → Teams");
  });

  test("a build in a read-only folder cannot be renamed, cut or deleted", () => {
    state.builds = [{ id: "b1", title: "Scourge", folderId: "ro", compIds: [] }];
    const menu = open("build-id", "b1");
    for (const label of ["Rename", "Duplicate", "Edit Tags", "Cut", "Delete"]) {
      expect([label, disabled(menu, label)]).toEqual([label, true]);
    }
    // Local-only stamps: pinning and archiving never leave this machine, so the
    // team has no say in them (@see BUILD_LOCAL_FIELDS in main/teamSync.js).
    for (const label of ["Load", "Copy", "Pin", "Archive", "Build Info"]) {
      expect([label, disabled(menu, label)]).toEqual([label, false]);
    }
  });

  test("a comp in a read-only folder is the same story", () => {
    state.comps = [{ id: "c1", name: "Zerg", folderId: "ro" }];
    const menu = open("comp-id", "c1");
    for (const label of ["Rename", "Duplicate", "Cut", "Paste", "Delete"]) {
      expect([label, disabled(menu, label)]).toEqual([label, true]);
    }
    expect(disabled(menu, "Open")).toBe(false);
  });

  test("Import in Folder becomes a greyed row, not a submenu of dead entries", () => {
    const menu = open("folder-id", "ro");
    const el = itemFor(menu, "Import in Folder");
    expect(el.className).toContain("lib-ctx-item--disabled");
    expect(el.className).not.toContain("lib-ctx-item--submenu");
    expect(el.title).toEqual(READ_ONLY);
  });

  test("the empty-area menu asks about the folder you are standing in", () => {
    state.currentFolder = { type: "custom", id: "ro" };
    document.body.innerHTML = `<div id="lib-content">empty</div>`;
    wireContextMenuEvents();
    document.getElementById("lib-content")
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const menu = document.querySelector(".lib-ctx-menu");
    for (const label of ["New Build", "New Comp", "New Folder", "Paste", "Import"]) {
      expect([label, disabled(menu, label)]).toEqual([label, true]);
    }
  });
});
