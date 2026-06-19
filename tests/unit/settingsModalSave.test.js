"use strict";

const fs = require("fs");
const path = require("path");

describe("settings-modal — no explicit Save button (auto-saves)", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("HTML template does not contain a Save button", () => {
    // Settings auto-save — there is no explicit Save button to click.
    expect(src).not.toMatch(/>Save<\/button>/);
  });

  test("sm-save-status element is present for Saved/error feedback", () => {
    expect(src).toMatch(/id="sm-save-status"/);
  });
});

describe("settings-modal _saveWebhooks — error handling", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("_saveWebhooks function contains try/catch around the setSetting call", () => {
    // This guards against silent failures where the modal stays open with no
    // user feedback when IPC calls fail.
    const saveFnMatch = src.match(/async function _saveWebhooks\(kind\)\s*\{([\s\S]*?)\n\}/);
    expect(saveFnMatch).not.toBeNull();
    const saveFnBody = saveFnMatch[1];
    expect(saveFnBody).toMatch(/try\s*\{/);
    expect(saveFnBody).toMatch(/catch\s*\{/);
  });

  test("_saveWebhooks shows a user-visible error when setSetting fails", () => {
    // Verify the catch block sets a visible error, not just logs to console.
    const saveFnMatch = src.match(/async function _saveWebhooks\(kind\)\s*\{([\s\S]*?)\n\}/);
    expect(saveFnMatch).not.toBeNull();
    const catchBlock = saveFnMatch[1].match(/catch\s*\{([^}]*)\}/s);
    expect(catchBlock).not.toBeNull();
    expect(catchBlock[1]).not.toMatch(/^\s*\/\//);
    expect(catchBlock[0]).toMatch(/textContent|saveStatus/);
  });

  test("comp and build webhooks both persist to their own array setting", () => {
    // The generic saver is parameterized by kind; each kind has its own setting key.
    expect(src).toMatch(/discord\.compWebhooks/);
    expect(src).toMatch(/discord\.buildWebhooks/);
    expect(src).toMatch(/setSetting\(WEBHOOK_KINDS\[kind\]\.setting/);
  });
});

describe("settings-modal — auto-save on input (issue #251)", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("_debounce helper is defined in the module", () => {
    // Auto-save debounces text input events to avoid firing on every keystroke.
    expect(src).toMatch(/function _debounce\s*\(/);
  });

  test("both comp and build add-webhook buttons are wired", () => {
    const initFnMatch = src.match(/export function initSettingsModal\(\)\s*\{([\s\S]*?)(?=\nexport )/);
    expect(initFnMatch).not.toBeNull();
    const initBody = initFnMatch[1];
    expect(initBody).toMatch(/addCompWebhook.*addEventListener.*['"](click)['"]/);
    expect(initBody).toMatch(/addBuildWebhook.*addEventListener.*['"](click)['"]/);
    // Both debounced savers are wired up.
    expect(initBody).toMatch(/_debouncedSaveWebhooks\.comp/);
    expect(initBody).toMatch(/_debouncedSaveWebhooks\.build/);
  });

  test("each rendered webhook row's URL input is wired with the debounced saver", () => {
    const renderFnMatch = src.match(/function _renderWebhooks\(kind\)\s*\{([\s\S]*?)\n\}/);
    expect(renderFnMatch).not.toBeNull();
    const renderBody = renderFnMatch[1];
    expect(renderBody).toMatch(/addEventListener\(['"]input['"]/);
    expect(renderBody).toMatch(/debSave/);
  });

  test("thread-mode radio changes trigger an immediate save", () => {
    const renderFnMatch = src.match(/function _renderWebhooks\(kind\)\s*\{([\s\S]*?)\n\}/);
    expect(renderFnMatch).not.toBeNull();
    const renderBody = renderFnMatch[1];
    expect(renderBody).toMatch(/\[data-field='thread-mode'\].*addEventListener.*['"](change)['"]/);
    expect(renderBody).toMatch(/_saveWebhooks\(kind\)/);
  });
});
