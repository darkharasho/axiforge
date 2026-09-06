/**
 * @jest-environment jsdom
 *
 * A folder rename that main refuses must say so.
 *
 * folders:save throws outright for a team root ("Rename or move the team from
 * Settings → Teams.") and for a folder you only have read access to. The
 * rejection used to escape handleRenameFolder unhandled: the inline input had
 * already torn itself down by then, so a refused rename looked exactly like a
 * menu item that did nothing — which is how the team-root case got reported as
 * "right click rename shared folder doesn't do anything".
 */
"use strict";

const { state } = require("../../../src/renderer/modules/state.js");
const { handleRenameFolder } = require("../../../src/renderer/modules/library/library.js");

const FOLDER = { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" };
const REFUSAL = "Rename or move the team from Settings → Teams.";

let saveFolder;

beforeEach(() => {
  document.body.innerHTML = `<div id="lib-content"><div data-folder-id="t">EWW</div></div>`;
  state.folders = [FOLDER];
  state.builds = [];
  state.comps = [];
  state.teams = [{ team: { id: "t", name: "EWW" }, role: "owner" }];
  saveFolder = jest.fn();
  window.desktopApi = {
    saveFolder: (...args) => saveFolder(...args),
    listFolders: jest.fn(async () => state.folders),
    listBuilds: jest.fn(async () => []),
    listComps: jest.fn(async () => []),
  };
});

/** Drive the inline input the rename opens: type a name and press Enter. */
async function typeNewName(value) {
  // insertInlineInput defers focus a tick, so the input exists only after one.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const input = document.querySelector("input.lib-inline-input");
  expect(input).toBeTruthy();
  input.value = value;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

/** The text of whatever showToast put on the page, or "" if it put nothing. */
function toastText() {
  return [...document.querySelectorAll("[class*='toast']")]
    .map((el) => el.textContent)
    .join(" ");
}

test("a refusal from main reaches the user instead of being swallowed", async () => {
  saveFolder.mockRejectedValue(new Error(REFUSAL));

  const pending = handleRenameFolder("t");
  await typeNewName("Renamed");
  await expect(pending).resolves.toBeUndefined();

  expect(saveFolder).toHaveBeenCalled();
  // The reason itself, not a generic "something went wrong" — the message is the
  // only thing that tells you where the rename actually lives.
  expect(toastText()).toContain(REFUSAL);
});

test("a rename main accepts still goes through, with no error toast", async () => {
  saveFolder.mockResolvedValue({ ...FOLDER, name: "Renamed" });

  const pending = handleRenameFolder("t");
  await typeNewName("Renamed");
  await pending;

  expect(saveFolder).toHaveBeenCalledWith(expect.objectContaining({ id: "t", name: "Renamed" }));
  expect(toastText()).not.toContain(REFUSAL);
});
