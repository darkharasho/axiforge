"use strict";

const fs = require("fs");
const path = require("path");

describe("settings-modal save button — defensive attributes", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("Save button has explicit type='button' to prevent accidental form submission", () => {
    // The Save button must have type="button". Without it, some browsers/Electron
    // versions treat a button inside certain layouts as type="submit".
    const saveButtonMatch = src.match(/id="sm-save"[^>]*>Save<\/button>|>Save<\/button>[^<]*id="sm-save"/);
    // Find the sm-save button in the HTML template
    const smSaveBtn = src.match(/<button[^>]+id="sm-save"[^>]*>Save<\/button>/);
    expect(smSaveBtn).not.toBeNull();
    expect(smSaveBtn[0]).toMatch(/type="button"/);
  });
});

describe("settings-modal _save — error handling", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("_save function contains try/catch around the setSetting calls", () => {
    // Extract the _save function body and check for try/catch.
    // This guards against silent failures where the modal stays open with no
    // user feedback when IPC calls fail.
    const saveFnMatch = src.match(/async function _save\(\)\s*\{([\s\S]*?)(?=\n(?:function|async function|\/\/ ─))/);
    expect(saveFnMatch).not.toBeNull();
    const saveFnBody = saveFnMatch[1];
    expect(saveFnBody).toMatch(/try\s*\{/);
    expect(saveFnBody).toMatch(/catch\s*\(/);
  });

  test("_save shows a user-visible error when setSetting fails", () => {
    // Verify the catch block in _save sets a visible error, not just logs to console.
    const saveFnMatch = src.match(/async function _save\(\)\s*\{([\s\S]*?)(?=\n(?:function|async function|\/\/ ─))/);
    expect(saveFnMatch).not.toBeNull();
    const saveFnBody = saveFnMatch[1];
    // Should have some error display in catch (not just console.error)
    const catchBlock = saveFnBody.match(/catch\s*\([^)]*\)\s*\{([^}]*)\}/s);
    expect(catchBlock).not.toBeNull();
    // The catch block should reference an error display element, not just log
    expect(catchBlock[1]).not.toMatch(/^\s*\/\//); // not just a comment
    expect(catchBlock[0]).toMatch(/textContent|showError|err/);
  });
});

describe("settings-modal webhook URL inputs — Enter key triggers save (issue #251)", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("keydown Enter handler is attached to webhook URL inputs in initSettingsModal", () => {
    // Users expect pressing Enter in a text field to confirm/save. Without this,
    // they type the URL, press Enter, see nothing happen, close with X, and lose the URL.
    // The handler must be wired in initSettingsModal (after _el is set) and call _save.
    const initFnMatch = src.match(/export function initSettingsModal\(\)\s*\{([\s\S]*?)(?=\nexport )/);
    expect(initFnMatch).not.toBeNull();
    const initBody = initFnMatch[1];
    // Must attach a keydown listener to one or both webhook URL inputs
    expect(initBody).toMatch(/webhookUrl|sm-webhook-url/);
    expect(initBody).toMatch(/keydown|keypress|key.*Enter/);
  });

  test("Enter key handler references _save (not just the click binding)", () => {
    // The Enter key handler must be separate from the click handler, referencing _save
    // in a keydown/keypress context, not just the existing click listener wiring.
    const initFnMatch = src.match(/export function initSettingsModal\(\)\s*\{([\s\S]*?)(?=\nexport )/);
    expect(initFnMatch).not.toBeNull();
    const initBody = initFnMatch[1];
    // Should have a keydown/keypress event listener that calls _save
    expect(initBody).toMatch(/addEventListener\(['"](keydown|keypress)['"]/);
  });
});
