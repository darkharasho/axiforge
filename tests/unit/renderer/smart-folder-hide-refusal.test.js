/**
 * @jest-environment jsdom
 *
 * setBuiltinHidden persists through the same settings store as
 * saveSmartFolder / deleteSmartFolder, which (as of Task 6) propagates write
 * failures instead of swallowing them. handleHideSmartFolder is the first
 * caller of setBuiltinHidden, so a rejection must reach the user instead of
 * escaping as an unhandled promise rejection.
 */
"use strict";

const { state } = require("../../../src/renderer/modules/state.js");
const { handleHideSmartFolder } = require("../../../src/renderer/modules/library/library.js");

const REFUSAL = "Could not save settings.";

beforeEach(() => {
  document.body.innerHTML = "";
  state.folders = [];
  state.builds = [];
  state.comps = [];
  state.currentFolder = { type: "smart-rule", id: "__sf-untagged" };
  window.desktopApi = {
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => { throw new Error(REFUSAL); }),
  };
});

/** The text of whatever showToast put on the page, or "" if it put nothing. */
function toastText() {
  return [...document.querySelectorAll("[class*='toast']")]
    .map((el) => el.textContent)
    .join(" ");
}

test("a rejection from setBuiltinHidden reaches the user instead of being swallowed", async () => {
  await expect(handleHideSmartFolder("__sf-untagged")).resolves.toBeUndefined();
  expect(toastText()).toContain(REFUSAL);
  // The failed hide must not navigate away from the smart folder still being viewed.
  expect(state.currentFolder).toEqual({ type: "smart-rule", id: "__sf-untagged" });
});
