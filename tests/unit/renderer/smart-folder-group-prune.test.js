/**
 * @jest-environment jsdom
 *
 * By Profession and By Game Mode have always drawn collapsed on a fresh
 * install, but an expansion the user made once persists forever. The smart
 * folder list has since grown past the point where two open generated groups
 * leave anything else visible, so a one-time prune closes them -- once, and
 * never again, or the chevron would stop working.
 */
"use strict";

const { state } = require("../../../src/renderer/modules/state.js");
const {
  pruneGeneratedGroupsOnce,
  GENERATED_GROUP_IDS,
} = require("../../../src/renderer/modules/library/sidebar.js");

let settings;

beforeEach(() => {
  settings = {};
  window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  state.libraryPrefs.sidebarExpandedFolders = [];
});

test("closes the generated groups and leaves real folders expanded", async () => {
  state.libraryPrefs.sidebarExpandedFolders = [...GENERATED_GROUP_IDS, "folder-1"];

  await pruneGeneratedGroupsOnce();

  expect(state.libraryPrefs.sidebarExpandedFolders).toEqual(["folder-1"]);
  expect(settings["library.sidebarExpandedFolders"]).toEqual(["folder-1"]);
});

test("runs once -- a later expansion of a generated group survives", async () => {
  state.libraryPrefs.sidebarExpandedFolders = [...GENERATED_GROUP_IDS];
  await pruneGeneratedGroupsOnce();

  state.libraryPrefs.sidebarExpandedFolders = ["__smart-profession"];
  await pruneGeneratedGroupsOnce();

  expect(state.libraryPrefs.sidebarExpandedFolders).toEqual(["__smart-profession"]);
});

test("records the flag even when there was nothing to prune", async () => {
  await pruneGeneratedGroupsOnce();

  expect(settings["library.generatedGroupsPruned"]).toBe(true);
});

test("does nothing without a settings API rather than throwing", async () => {
  window.desktopApi = {};
  state.libraryPrefs.sidebarExpandedFolders = [...GENERATED_GROUP_IDS];

  await expect(pruneGeneratedGroupsOnce()).resolves.toBeUndefined();
  expect(state.libraryPrefs.sidebarExpandedFolders).toEqual([...GENERATED_GROUP_IDS]);
});
