/**
 * @jest-environment jsdom
 */
"use strict";

// Tests for smart folder filtering (By Profession / By Game Mode / smart-rule).
// Verifies that getVisibleBuilds() returns the correct builds when
// the user navigates to a profession or game mode smart folder,
// including builds that belong to comps. The profession and game-mode rows
// are generated rules (see professionFolder()/gameModeFolder() below) that
// flow through the same smart-rule engine as any other smart folder --
// they are no longer bespoke `smart-profession` / `smart-gamemode` types.

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    buildSearch: "",
    libraryPrefs: {
      viewMode: "list",
      sortField: "sortOrder",
      sortDirection: "asc",
      activeFilters: {},
    },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const {
  getVisibleBuilds,
  getVisibleComps,
  getVisibleFolders,
} = require("../../../src/renderer/modules/library/folder-store");

function makeBuild(overrides) {
  return {
    id: overrides.id || "b-" + Math.random().toString(36).slice(2, 8),
    title: overrides.title || "Test Build",
    profession: overrides.profession || "Guardian",
    gameMode: overrides.gameMode || "pve",
    folderId: overrides.folderId || null,
    compIds: overrides.compIds || [],
    pinned: overrides.pinned || false,
    sortOrder: overrides.sortOrder || 0,
    tags: overrides.tags || [],
    specializations: overrides.specializations || [],
    ...overrides,
  };
}

// Mirrors what sidebar.js now generates for a By Profession / By Game Mode row.
function professionFolder(prof) {
  return {
    type: "smart-rule",
    id: `__sf-prof:${prof}`,
    smartFolder: {
      id: `__sf-prof:${prof}`,
      name: prof,
      rule: {
        type: "group",
        match: "all",
        children: [{ type: "condition", field: "profession", op: "isAnyOf", value: [prof] }],
      },
    },
  };
}

function gameModeFolder(mode) {
  return {
    type: "smart-rule",
    id: `__sf-mode:${mode}`,
    smartFolder: {
      id: `__sf-mode:${mode}`,
      name: mode,
      rule: {
        type: "group",
        match: "all",
        children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: [mode] }],
      },
    },
  };
}

beforeEach(() => {
  state.builds = [];
  state.folders = [];
  state.comps = [];
  state.currentFolder = null;
  state.buildSearch = "";
  state.libraryPrefs = {
    viewMode: "list",
    sortField: "sortOrder",
    sortDirection: "asc",
    activeFilters: {},
  };
});

describe("getVisibleBuilds — smart-profession folder", () => {
  test("shows non-comp builds matching profession", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "g2", profession: "Guardian" }),
      makeBuild({ id: "w1", profession: "Warrior" }),
    ];
    state.currentFolder = professionFolder("Guardian");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("shows builds that are inside comps", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "g2", profession: "Guardian" }),
    ];
    state.comps = [{ id: "comp-1", name: "Raid Comp", buildIds: ["g2"] }];
    state.currentFolder = professionFolder("Guardian");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("shows builds that are inside custom folders", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian", folderId: null }),
      makeBuild({ id: "g2", profession: "Guardian", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "Raid", parentId: null, sortOrder: 0 }];
    state.currentFolder = professionFolder("Guardian");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("does not show builds from other professions", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "w1", profession: "Warrior" }),
    ];
    state.currentFolder = professionFolder("Guardian");

    const result = getVisibleBuilds();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("g1");
  });
});

describe("getVisibleBuilds — smart-gamemode folder", () => {
  test("shows non-comp builds matching game mode", () => {
    state.builds = [
      makeBuild({ id: "p1", gameMode: "pvp" }),
      makeBuild({ id: "p2", gameMode: "pve" }),
    ];
    state.currentFolder = gameModeFolder("pvp");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["p1"]);
  });

  test("shows builds that are inside comps", () => {
    state.builds = [
      makeBuild({ id: "p1", gameMode: "wvw" }),
      makeBuild({ id: "p2", gameMode: "wvw" }),
    ];
    state.comps = [{ id: "comp-1", name: "WvW Comp", buildIds: ["p2"] }];
    state.currentFolder = gameModeFolder("wvw");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  test("defaults missing gameMode to pve", () => {
    state.builds = [
      makeBuild({ id: "b1", gameMode: "" }),
      makeBuild({ id: "b2", gameMode: "pve" }),
      makeBuild({ id: "b3", gameMode: "pvp" }),
    ];
    state.currentFolder = gameModeFolder("pve");

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
});

describe("getVisibleBuilds — all-builds folder", () => {
  test("shows builds in comps alongside regular builds (comps are references, not containers)", () => {
    state.builds = [
      makeBuild({ id: "b1" }),
      makeBuild({ id: "b2" }),
    ];
    state.comps = [{ id: "comp-1", name: "Test Comp", buildIds: ["b2"] }];
    state.currentFolder = { type: "all" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
});

describe("getVisibleBuilds — smart-rule folder", () => {
  function ruleFolder(children, match = "all") {
    return {
      type: "smart-rule",
      id: "sf-test",
      smartFolder: { id: "sf-test", name: "Test", rule: { type: "group", match, children } },
    };
  }

  test("filters by the rule", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "w1", profession: "Warrior" }),
    ];
    state.currentFolder = ruleFolder([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["g1"]);
  });

  test("a rule with no conditions shows every build, filed or not — Main Repository", () => {
    state.builds = [
      makeBuild({ id: "b1", folderId: null }),
      makeBuild({ id: "b2", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("this is what distinguishes Main Repository from All Builds", () => {
    state.builds = [
      makeBuild({ id: "b1", folderId: null }),
      makeBuild({ id: "b2", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];

    state.currentFolder = { type: "all" };
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);

    state.currentFolder = ruleFolder([]);
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  test("archived builds stay out", () => {
    state.builds = [
      makeBuild({ id: "b1" }),
      makeBuild({ id: "b2", archivedAt: "2026-01-01T00:00:00Z" }),
    ];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);
  });

  test("the search box narrows within a smart folder", () => {
    state.builds = [
      makeBuild({ id: "b1", title: "Zerg Firebrand" }),
      makeBuild({ id: "b2", title: "Roaming Willbender" }),
    ];
    state.currentFolder = ruleFolder([]);
    state.buildSearch = "zerg";

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["b1"]);
  });

  test("toolbar filters still apply on top of the rule", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian", gameMode: "wvw" }),
      makeBuild({ id: "g2", profession: "Guardian", gameMode: "pve" }),
    ];
    state.currentFolder = ruleFolder([
      { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
    ]);
    state.libraryPrefs.activeFilters = { gameModes: ["wvw"] };

    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["g1"]);
  });

  test("shows no sub-folders and no comps, like every other smart folder", () => {
    state.builds = [makeBuild({ id: "b1" })];
    state.folders = [{ id: "folder-1", name: "wvw", parentId: null, sortOrder: 0 }];
    state.comps = [{ id: "comp-1", name: "Comp", buildIds: [] }];
    state.currentFolder = ruleFolder([]);

    expect(getVisibleFolders()).toEqual([]);
    expect(getVisibleComps()).toEqual([]);
  });
});
