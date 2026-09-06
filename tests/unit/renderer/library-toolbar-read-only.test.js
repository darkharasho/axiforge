/**
 * @jest-environment jsdom
 *
 * The toolbar's New and Import both land in the folder you are standing in, so
 * in a read-only shared folder they were two buttons whose only outcome was an
 * error toast. Export is not gated — reading out what you can already see takes
 * nothing from the team — and that difference is the thing worth pinning.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], currentFolder: null, folderAccess: {},
    buildSearch: "", libraryPrefs: { sortField: "sortOrder", viewMode: "expanded", filters: {} },
    buildSyncStatus: {}, folderSyncStatus: {},
  },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  libraryBuilds: jest.fn(() => []),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { renderToolbar, initToolbar } = require("../../../src/renderer/modules/library/toolbar.js");

const FOLDER = (id, parentId = null) => ({ id, name: id, parentId, sortOrder: 0 });

beforeEach(() => {
  document.body.innerHTML = `<div id="lib-toolbar"></div>`;
  state.folders = [
    { ...FOLDER("t"), shared: true, teamId: "t", role: "member" },
    FOLDER("ro", "t"),
    FOLDER("rw", "t"),
    FOLDER("p"),
  ];
  state.folderAccess = { t: "read", ro: "read", rw: "write" };
  state.currentFolder = null;
  initToolbar({});
});

const btn = (id) => document.getElementById(id);

test("in a read-only folder, New and Import are disabled and say why", () => {
  state.currentFolder = { type: "custom", id: "ro" };
  renderToolbar();
  for (const id of ["lib-new-btn", "lib-import-btn"]) {
    expect([id, btn(id).disabled]).toEqual([id, true]);
    expect(btn(id).title).toMatch(/^Read-only/);
  }
});

test("Export stays live there — it only reads", () => {
  state.currentFolder = { type: "custom", id: "ro" };
  renderToolbar();
  expect(btn("lib-export-btn").disabled).toBe(false);
});

test("a folder you can write in, and the personal library, leave both alone", () => {
  for (const folder of [{ type: "custom", id: "rw" }, { type: "custom", id: "p" }, null]) {
    state.currentFolder = folder;
    renderToolbar();
    expect([folder?.id ?? "root", btn("lib-new-btn").disabled]).toEqual([folder?.id ?? "root", false]);
    expect(btn("lib-import-btn").disabled).toBe(false);
  }
});
