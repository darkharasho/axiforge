/**
 * @jest-environment jsdom
 */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    buildSearch: "",
    archiveItems: [],
    trashItems: [],
    libraryPrefs: {
      viewMode: "list",
      sortField: "sortOrder",
      sortDirection: "asc",
      activeFilters: {},
      sidebarOpen: true,
      sidebarExpandedFolders: [],
    },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const { initSidebar, renderSidebar, countSmartFolder } = require("../../../src/renderer/modules/library/sidebar");
const { initToolbar, renderToolbar } = require("../../../src/renderer/modules/library/toolbar");
const { loadSmartFolders, saveSmartFolder, BUILTIN_SMART_FOLDERS } = require("../../../src/renderer/modules/library/smart-folders");

function makeBuild(o = {}) {
  return {
    id: "b1", title: "B", profession: "Guardian", gameMode: "pve",
    folderId: null, tags: [], specializations: [], pinned: false, sortOrder: 0,
    updatedAt: new Date().toISOString(), ...o,
  };
}

let settings;
let onNavigate;

beforeEach(async () => {
  settings = {};
  global.window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  await loadSmartFolders();

  document.body.innerHTML = `<div id="lib-sidebar"></div>`;
  state.builds = [];
  state.folders = [];
  state.comps = [];
  state.currentFolder = null;
  onNavigate = jest.fn();
  initSidebar({ onNavigate, onNewSmartFolder: jest.fn() });
});

function rowFor(id) {
  return document.querySelector(`[data-navigate-smart-folder="${id}"]`);
}

describe("built-in rows", () => {
  test("every visible built-in gets a row", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    for (const f of BUILTIN_SMART_FOLDERS) expect(rowFor(f.id)).toBeTruthy();
  });

  test("All Builds is renamed so it is distinguishable from Main Repository", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    const labels = [...document.querySelectorAll(".lib-nav-item__label")].map((e) => e.textContent);
    expect(labels).toContain("Main Repository");
    expect(labels).toContain("All Builds (by folder)");
    expect(labels).not.toContain("All Builds");
  });

  test("a hidden built-in is not rendered", async () => {
    settings["library.smartFolderOverrides"] = { hidden: ["__sf-untagged"] };
    await loadSmartFolders();
    state.builds = [makeBuild()];
    renderSidebar();
    expect(rowFor("__sf-untagged")).toBeNull();
  });
});

describe("counts", () => {
  test("Main Repository counts every build, filed or not", () => {
    state.builds = [makeBuild({ id: "b1" }), makeBuild({ id: "b2", folderId: "f1" })];
    state.folders = [{ id: "f1", name: "wvw", parentId: null, sortOrder: 0 }];
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(countSmartFolder(main)).toBe(2);
  });

  test("Untagged counts only builds with no tags", () => {
    state.builds = [makeBuild({ id: "b1", tags: [] }), makeBuild({ id: "b2", tags: ["wvw"] })];
    const untagged = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-untagged");
    expect(countSmartFolder(untagged)).toBe(1);
  });

  test("archived builds are not counted", () => {
    state.builds = [makeBuild({ id: "b1" }), makeBuild({ id: "b2", archivedAt: "2026-01-01T00:00:00Z" })];
    const main = BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main");
    expect(countSmartFolder(main)).toBe(1);
  });
});

describe("user smart folders", () => {
  test("render below the built-ins under their own label", async () => {
    await saveSmartFolder({
      name: "WvW Firebrands",
      rule: { type: "group", match: "all", children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: ["wvw"] }] },
    });
    state.builds = [makeBuild({ gameMode: "wvw" })];
    renderSidebar();

    const labels = [...document.querySelectorAll(".lib-nav-item__label")].map((e) => e.textContent);
    expect(labels).toContain("WvW Firebrands");
    expect(document.querySelector(".lib-sidebar__subsection-label")?.textContent).toBe("My Smart Folders");
  });

  test("the label is absent when the user has none", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    expect(document.querySelector(".lib-sidebar__subsection-label")).toBeNull();
  });
});

describe("navigation", () => {
  test("clicking a built-in navigates with the resolved rule", () => {
    state.builds = [makeBuild()];
    renderSidebar();
    rowFor("__sf-main").click();

    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "smart-rule", id: "__sf-main" }),
    );
    expect(onNavigate.mock.calls[0][0].smartFolder.rule.children).toEqual([]);
  });

  test("generated profession rows navigate as rules", () => {
    state.builds = [makeBuild({ profession: "Guardian" })];
    state.libraryPrefs.sidebarExpandedFolders = ["__smart-profession"];
    renderSidebar();

    document.querySelector('[data-navigate-smart-folder="__sf-prof:Guardian"]').click();
    const arg = onNavigate.mock.calls[0][0];
    expect(arg.type).toBe("smart-rule");
    expect(arg.smartFolder.rule.children).toEqual([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);
  });

  test("the active row is marked", () => {
    state.builds = [makeBuild()];
    state.currentFolder = { type: "smart-rule", id: "__sf-main", smartFolder: BUILTIN_SMART_FOLDERS[0] };
    renderSidebar();
    expect(rowFor("__sf-main").classList.contains("lib-nav-item--active")).toBe(true);
  });
});

describe("toolbar breadcrumb for a smart folder", () => {
  test("shows the smart folder's name, not a bare 'All Builds' crumb", () => {
    document.body.innerHTML += `<div id="lib-toolbar"></div>`;
    initToolbar({});
    state.builds = [makeBuild()];
    state.currentFolder = {
      type: "smart-rule",
      id: "__sf-main",
      smartFolder: BUILTIN_SMART_FOLDERS.find((f) => f.id === "__sf-main"),
    };
    renderToolbar();

    const breadcrumb = document.querySelector(".lib-toolbar__breadcrumb");
    expect(breadcrumb.textContent).toContain("Main Repository");
  });
});
