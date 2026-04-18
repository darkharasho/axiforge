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
