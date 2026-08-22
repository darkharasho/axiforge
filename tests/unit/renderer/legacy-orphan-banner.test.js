/** @jest-environment jsdom */
"use strict";
// Task 6: a folder left behind by the old GitHub-org shared library (orgName,
// no teamId) shows a banner in the folder view pointing at Settings → Teams.

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { folders: [], builds: [], comps: [], currentFolder: null, libraryPrefs: { viewMode: "list" }, outbox: {}, teams: [], teamSession: null },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  getVisibleBuilds: () => [], getVisibleFolders: () => [], getVisibleComps: () => [],
}));
jest.mock("../../../src/renderer/modules/library/drag-drop.js", () => ({ wireDragDropEvents: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  clearSelection: jest.fn(), handleBuildClick: jest.fn(), handleCompClick: jest.fn(), updateSelectionVisuals: jest.fn(),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { renderContent, initContent } = require("../../../src/renderer/modules/library/content.js");

function render(folder, callbacks = {}) {
  document.body.innerHTML = `<div id="lib-content"></div>`;
  state.folders = folder ? [folder] : [];
  state.currentFolder = folder ? { type: "custom", id: folder.id } : null;
  initContent(callbacks);
  renderContent();
  return document.getElementById("lib-content");
}

test("orphaned legacy folder shows the banner; the button opens Settings → Teams", () => {
  const onOpenSettings = jest.fn();
  const el = render({ id: "root0", name: "Root", orgName: "gw2eww" }, { onOpenSettings });
  const banner = el.querySelector(".lib-banner");
  expect(banner).not.toBeNull();
  expect(banner.textContent).toContain("This library moved to Teams — join with the owner's invite code.");
  banner.querySelector("[data-open-settings]").click();
  expect(onOpenSettings).toHaveBeenCalledWith("teams");
});

test("no banner for a migrated folder, a personal folder, or the library root", () => {
  expect(render({ id: "root0", name: "Root", orgName: "gw2eww", teamId: "t1", shared: true }).querySelector(".lib-banner")).toBeNull();
  expect(render({ id: "p", name: "Personal" }).querySelector(".lib-banner")).toBeNull();
  expect(render(null).querySelector(".lib-banner")).toBeNull();
});
