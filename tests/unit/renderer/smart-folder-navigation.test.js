/**
 * @jest-environment jsdom
 *
 * `state.currentFolder.smartFolder` is a snapshot taken at navigation time.
 * Editing, renaming or deleting the smart folder you are currently viewing
 * changes the store but not that snapshot, so renderLibrary() has to
 * re-resolve it on every render -- otherwise the list you are looking at keeps
 * filtering through the pre-edit rule, or points at a folder that is gone.
 */
"use strict";

const { state } = require("../../../src/renderer/modules/state.js");
const { renderLibrary, handleHideSmartFolder } = require("../../../src/renderer/modules/library/library.js");
const {
  loadSmartFolders,
  saveSmartFolder,
  deleteSmartFolder,
  getSmartFolder,
} = require("../../../src/renderer/modules/library/smart-folders.js");

const ruleFor = (mode) => ({
  type: "group",
  match: "all",
  children: [{ type: "condition", field: "gameMode", op: "isAnyOf", value: [mode] }],
});

let settings;

beforeEach(async () => {
  settings = {};
  document.body.innerHTML = "";
  window.desktopApi = {
    getSetting: jest.fn(async (k) => (k in settings ? settings[k] : null)),
    setSetting: jest.fn(async (k, v) => { settings[k] = v; }),
  };
  state.builds = [];
  state.folders = [];
  state.comps = [];
  state.currentFolder = null;
  await loadSmartFolders();
});

test("an edit to the folder being viewed takes effect on the next render", async () => {
  const saved = await saveSmartFolder({ name: "WvW", rule: ruleFor("wvw") });
  state.currentFolder = { type: "smart-rule", id: saved.id, smartFolder: saved };

  await saveSmartFolder({ ...saved, name: "PvE only", rule: ruleFor("pve") });
  renderLibrary();

  expect(state.currentFolder.smartFolder.name).toBe("PvE only");
  expect(state.currentFolder.smartFolder.rule.children[0].value).toEqual(["pve"]);
});

test("deleting the folder being viewed falls back to All Builds (by folder)", async () => {
  const saved = await saveSmartFolder({ name: "WvW", rule: ruleFor("wvw") });
  state.currentFolder = { type: "smart-rule", id: saved.id, smartFolder: saved };

  // The modal's own Delete button only calls renderLibrary(); the navigation
  // reset used to live solely in the context-menu handler.
  await deleteSmartFolder(saved.id);
  renderLibrary();

  expect(state.currentFolder).toEqual({ type: "all" });
});

test("hiding the built-in being viewed falls back to All Builds (by folder)", async () => {
  state.currentFolder = {
    type: "smart-rule",
    id: "__sf-untagged",
    smartFolder: getSmartFolder("__sf-untagged"),
  };
  await handleHideSmartFolder("__sf-untagged");

  expect(state.currentFolder).toEqual({ type: "all" });
  expect(settings["library.smartFolderOverrides"]).toEqual({ hidden: ["__sf-untagged"] });
});

test("generated profession rows survive a render, since they are not persisted", () => {
  state.currentFolder = {
    type: "smart-rule",
    id: "__sf-prof:Guardian",
    smartFolder: { id: "__sf-prof:Guardian", name: "Guardian", rule: { type: "group", match: "all", children: [] } },
  };
  renderLibrary();

  expect(state.currentFolder.type).toBe("smart-rule");
  expect(state.currentFolder.smartFolder.rule.children).toEqual([
    { type: "condition", field: "profession", op: "isAnyOf", value: ["Guardian"] },
  ]);
});

test("a folder that is still there is left alone", async () => {
  const saved = await saveSmartFolder({ name: "WvW", rule: ruleFor("wvw") });
  state.currentFolder = { type: "smart-rule", id: saved.id, smartFolder: saved };
  renderLibrary();

  expect(state.currentFolder.id).toBe(saved.id);
  expect(state.currentFolder.smartFolder.name).toBe("WvW");
});
