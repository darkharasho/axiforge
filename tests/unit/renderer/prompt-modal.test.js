/**
 * @jest-environment jsdom
 *
 * showPrompt exists because Electron's renderer does not implement
 * window.prompt() — calling it raises "prompt() is and will not be supported."
 * It was private to library.js; settings-modal.js needs it for team rename, so
 * it now lives in its own module. These tests pin the contract both callers
 * rely on: a trimmed string, or null for every flavour of "no".
 */
"use strict";

const { showPrompt } = require("../../../src/renderer/modules/prompt-modal.js");

const overlay = () => document.querySelector(".confirm-modal-overlay");
const input = () => overlay().querySelector("input");
const btn = (action) => overlay().querySelector(`[data-action="${action}"]`);

afterEach(() => { document.body.innerHTML = ""; });

test("OK resolves the trimmed input and tears the overlay down", async () => {
  const p = showPrompt("New team name", "EWW");
  expect(input().value).toBe("EWW");
  input().value = "  EWW Reloaded  ";
  btn("ok").click();
  await expect(p).resolves.toBe("EWW Reloaded");
  expect(overlay()).toBeNull();
});

test("Cancel, Escape and an empty OK all resolve null", async () => {
  let p = showPrompt("Name");
  btn("cancel").click();
  await expect(p).resolves.toBeNull();

  p = showPrompt("Name", "x");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await expect(p).resolves.toBeNull();

  p = showPrompt("Name");
  input().value = "   ";
  btn("ok").click();
  await expect(p).resolves.toBeNull();
});

test("Enter commits", async () => {
  const p = showPrompt("Name");
  input().value = "Raid Crew";
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await expect(p).resolves.toBe("Raid Crew");
});

test("the keydown listener does not outlive the prompt", async () => {
  const p = showPrompt("Name");
  btn("cancel").click();
  await p;
  // A stale handler would throw on the removed input, or resolve a dead promise.
  expect(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))).not.toThrow();
});

test("the title is escaped — folder and team names reach it verbatim", async () => {
  const p = showPrompt("<img src=x onerror=alert(1)>");
  expect(overlay().querySelector(".confirm-modal__title").innerHTML)
    .toBe("&lt;img src=x onerror=alert(1)&gt;");
  btn("cancel").click();
  await p;
});
