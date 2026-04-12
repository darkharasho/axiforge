/**
 * @jest-environment jsdom
 */
"use strict";

// Tests for smart folder filtering (By Profession / By Game Mode).
// Verifies that getVisibleBuilds() returns the correct builds when
// the user navigates to a profession or game mode smart folder,
// including builds that belong to comps.

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
    state.currentFolder = { type: "smart-profession", id: "Guardian" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("shows builds that are inside comps", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "g2", profession: "Guardian" }),
    ];
    state.comps = [{ id: "comp-1", name: "Raid Comp", buildIds: ["g2"] }];
    state.currentFolder = { type: "smart-profession", id: "Guardian" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("shows builds that are inside custom folders", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian", folderId: null }),
      makeBuild({ id: "g2", profession: "Guardian", folderId: "folder-1" }),
    ];
    state.folders = [{ id: "folder-1", name: "Raid", parentId: null, sortOrder: 0 }];
    state.currentFolder = { type: "smart-profession", id: "Guardian" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["g1", "g2"]);
  });

  test("does not show builds from other professions", () => {
    state.builds = [
      makeBuild({ id: "g1", profession: "Guardian" }),
      makeBuild({ id: "w1", profession: "Warrior" }),
    ];
    state.currentFolder = { type: "smart-profession", id: "Guardian" };

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
    state.currentFolder = { type: "smart-gamemode", id: "pvp" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["p1"]);
  });

  test("shows builds that are inside comps", () => {
    state.builds = [
      makeBuild({ id: "p1", gameMode: "wvw" }),
      makeBuild({ id: "p2", gameMode: "wvw" }),
    ];
    state.comps = [{ id: "comp-1", name: "WvW Comp", buildIds: ["p2"] }];
    state.currentFolder = { type: "smart-gamemode", id: "wvw" };

    const result = getVisibleBuilds();
    expect(result.map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  test("defaults missing gameMode to pve", () => {
    state.builds = [
      makeBuild({ id: "b1", gameMode: "" }),
      makeBuild({ id: "b2", gameMode: "pve" }),
      makeBuild({ id: "b3", gameMode: "pvp" }),
    ];
    state.currentFolder = { type: "smart-gamemode", id: "pve" };

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
