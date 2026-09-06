/**
 * @jest-environment jsdom
 */
"use strict";

// Search reaches through sub-folders. Standing at the root (or inside a folder)
// with a query typed, the library shows every match in the subtree below you --
// not just the ones sitting at the level you happen to be looking at.

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
  getVisibleFolders,
  getVisibleComps,
} = require("../../../src/renderer/modules/library/folder-store");

let seq = 0;
function makeBuild(overrides = {}) {
  return {
    id: "b" + ++seq,
    title: "Test Build",
    profession: "Guardian",
    gameMode: "pve",
    folderId: null,
    notes: "",
    tags: [],
    specializations: [],
    pinned: false,
    sortOrder: 0,
    ...overrides,
  };
}

function makeFolder(overrides = {}) {
  return {
    id: "f" + ++seq,
    name: "Folder",
    parentId: null,
    sortOrder: 0,
    ...overrides,
  };
}

function makeComp(overrides = {}) {
  return {
    id: "c" + ++seq,
    name: "Test Comp",
    folderId: null,
    tags: [],
    buildIds: [],
    sortOrder: 0,
    ...overrides,
  };
}

// root
//  └── wvw (folder)
//       └── zerg (folder)
//            └── "Celestial Firebrand" (build)
function nestedFixture() {
  state.folders = [
    makeFolder({ id: "wvw", name: "WvW" }),
    makeFolder({ id: "zerg", name: "Zerg", parentId: "wvw" }),
  ];
  state.builds = [
    makeBuild({ id: "deep", title: "Celestial Firebrand", folderId: "zerg" }),
    makeBuild({ id: "mid", title: "Scrapper", folderId: "wvw" }),
    makeBuild({ id: "top", title: "Root Build" }),
  ];
}

beforeEach(() => {
  seq = 0;
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

describe("getVisibleBuilds — search flattens nested folders", () => {
  test("no query at root still shows only root-level builds", () => {
    nestedFixture();
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["top"]);
  });

  test("query at root finds a build two folders deep", () => {
    nestedFixture();
    state.buildSearch = "firebrand";
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["deep"]);
  });

  test("query at root spans every level at once", () => {
    nestedFixture();
    state.buildSearch = "e"; // matches Celestial, Scrapper... and Root Build
    expect(getVisibleBuilds().map((b) => b.id).sort()).toEqual(["deep", "mid", "top"]);
  });

  test("query inside a folder searches its subtree, not the whole library", () => {
    nestedFixture();
    state.builds.push(makeBuild({ id: "other", title: "Firebrand Elsewhere" }));
    state.currentFolder = { type: "custom", id: "wvw" };
    state.buildSearch = "firebrand";
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["deep"]);
  });

  test("query in the All Builds smart folder flattens too", () => {
    nestedFixture();
    state.currentFolder = { type: "all", id: "__all" };
    state.buildSearch = "firebrand";
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["deep"]);
  });

  test("nested build is findable by notes, not just title", () => {
    nestedFixture();
    state.builds[0].notes = "quickness uptime rotation";
    state.buildSearch = "quickness";
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["deep"]);
  });

  test("nested build is findable by elite spec name", () => {
    nestedFixture();
    state.builds[0].specializations = [{ name: "Willbender", elite: true }];
    state.buildSearch = "willbender";
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["deep"]);
  });

  test("dropdown filters still apply on top of a flattened search", () => {
    nestedFixture();
    state.builds[0].profession = "Guardian";
    state.builds[1].profession = "Engineer";
    state.buildSearch = "e";
    state.libraryPrefs.activeFilters = { professions: ["Engineer"] };
    expect(getVisibleBuilds().map((b) => b.id)).toEqual(["mid"]);
  });

  test("archived builds stay out of flattened results", () => {
    nestedFixture();
    state.builds[0].archivedAt = "2026-01-01T00:00:00Z";
    state.buildSearch = "firebrand";
    expect(getVisibleBuilds()).toEqual([]);
  });
});

describe("getVisibleFolders — search flattens nested folders", () => {
  test("no query at root shows only top-level folders", () => {
    nestedFixture();
    expect(getVisibleFolders().map((f) => f.id)).toEqual(["wvw"]);
  });

  test("query surfaces a nested folder by its own name", () => {
    nestedFixture();
    state.buildSearch = "zerg";
    expect(getVisibleFolders().map((f) => f.id)).toEqual(["zerg"]);
  });

  test("a folder no longer rides along just because a build inside it matches", () => {
    nestedFixture();
    state.buildSearch = "firebrand";
    // "deep" surfaces as a result in its own right, so its ancestors don't
    // need to stand in for it.
    expect(getVisibleFolders()).toEqual([]);
  });

  test("query inside a folder only surfaces its own descendants", () => {
    nestedFixture();
    state.folders.push(makeFolder({ id: "pve-zerg", name: "Zerg" }));
    state.currentFolder = { type: "custom", id: "wvw" };
    state.buildSearch = "zerg";
    expect(getVisibleFolders().map((f) => f.id)).toEqual(["zerg"]);
  });
});

describe("getVisibleComps — search flattens nested folders", () => {
  test("query at root finds a comp inside a folder", () => {
    nestedFixture();
    state.comps = [
      makeComp({ id: "deepcomp", name: "Havoc Squad", folderId: "zerg" }),
      makeComp({ id: "rootcomp", name: "Other" }),
    ];
    state.buildSearch = "havoc";
    expect(getVisibleComps().map((c) => c.id)).toEqual(["deepcomp"]);
  });

  test("no query at root still shows only root-level comps", () => {
    nestedFixture();
    state.comps = [
      makeComp({ id: "deepcomp", name: "Havoc Squad", folderId: "zerg" }),
      makeComp({ id: "rootcomp", name: "Other" }),
    ];
    expect(getVisibleComps().map((c) => c.id)).toEqual(["rootcomp"]);
  });

  test("query inside a folder searches its subtree", () => {
    nestedFixture();
    state.comps = [
      makeComp({ id: "deepcomp", name: "Havoc Squad", folderId: "zerg" }),
      makeComp({ id: "outside", name: "Havoc Elsewhere" }),
    ];
    state.currentFolder = { type: "custom", id: "wvw" };
    state.buildSearch = "havoc";
    expect(getVisibleComps().map((c) => c.id)).toEqual(["deepcomp"]);
  });
});
