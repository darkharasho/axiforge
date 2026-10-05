/** @jest-environment jsdom */
"use strict";

jest.mock("../../../src/renderer/modules/state", () => ({
  state: {
    builds: [],
    folders: [],
    comps: [],
    currentFolder: null,
    buildSearch: "",
    libraryPrefs: { viewMode: "list", sortField: "sortOrder", sortDirection: "asc", activeFilters: {} },
  },
}));

const { state } = require("../../../src/renderer/modules/state");
const { getVisibleBuilds, getVisibleComps } = require("../../../src/renderer/modules/library/folder-store");

const build = (id, over = {}) => ({
  id, title: id, profession: "Guardian", gameMode: "pve", folderId: null, tags: [],
  specializations: [], pinned: false, sortOrder: 0, ...over,
});

beforeEach(() => {
  state.builds = [
    build("never"),
    build("current", { publishedFileId: "f", publishedHash: "a", contentHash: "a" }),
    build("stale", { publishedFileId: "f", publishedHash: "a", contentHash: "b" }),
  ];
  state.comps = [
    { id: "cNever", name: "N", folderId: null, sortOrder: 0 },
    { id: "cMember", name: "M", folderId: null, sortOrder: 1, publishedFileId: "c", publishedHash: "s",
      contentHash: "s", publishedMemberHashes: { current: "old" } },
  ];
  state.libraryPrefs.activeFilters = {};
});

test("no publish filter shows everything", () => {
  expect(getVisibleBuilds().map((b) => b.id).sort()).toEqual(["current", "never", "stale"]);
  expect(getVisibleComps().map((c) => c.id)).toEqual(["cNever", "cMember"]);
});

test("filters builds by status", () => {
  state.libraryPrefs.activeFilters = { publishStatus: ["stale", "never"] };
  expect(getVisibleBuilds().map((b) => b.id).sort()).toEqual(["never", "stale"]);
});

test("filters comps by status, including member staleness", () => {
  state.libraryPrefs.activeFilters = { publishStatus: ["stale"] };
  expect(getVisibleComps().map((c) => c.id)).toEqual(["cMember"]);
  state.libraryPrefs.activeFilters = { publishStatus: ["current"] };
  expect(getVisibleComps()).toEqual([]);
});

test("the smart-folder rule leaves the derived filter out", () => {
  const { filtersToRule } = require("../../../src/renderer/modules/library/toolbar");
  expect(filtersToRule({ publishStatus: ["stale"], tags: ["x"] }).children)
    .toEqual([{ type: "condition", field: "tags", op: "hasAnyOf", value: ["x"] }]);
});
