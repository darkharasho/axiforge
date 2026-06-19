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

describe("settings-modal _save — error handling", () => {
  let src;

  beforeAll(() => {
    src = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/modules/settings-modal.js"),
      "utf8"
    );
  });

  test("_save function contains try/catch around the setSetting calls", () => {
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
    const catchBlock = saveFnBody.match(/catch\s*\([^)]*\)\s*\{([^}]*)\}/s);
    expect(catchBlock).not.toBeNull();
    expect(catchBlock[1]).not.toMatch(/^\s*\/\//);
    expect(catchBlock[0]).toMatch(/textContent|showError|err/);
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

  test("webhook URL inputs are wired with debounced input event listener", () => {
    // Build webhook: typing a URL and pausing should trigger a debounced save.
    const initFnMatch = src.match(/export function initSettingsModal\(\)\s*\{([\s\S]*?)(?=\nexport )/);
    expect(initFnMatch).not.toBeNull();
    const initBody = initFnMatch[1];
    expect(initBody).toMatch(/buildWebhookUrl.*addEventListener.*['"](input)['"]/);
    expect(initBody).toMatch(/_debouncedSave/);

    // Comp webhooks: each rendered row's URL input is wired with _debouncedSaveWebhooks.
    const renderFnMatch = src.match(/function _renderCompWebhooks\(\)\s*\{([\s\S]*?)\n\}/);
    expect(renderFnMatch).not.toBeNull();
    const renderBody = renderFnMatch[1];
    expect(renderBody).toMatch(/addEventListener\(['"]input['"]/);
    expect(renderBody).toMatch(/_debouncedSaveWebhooks/);
  });

  test("radio/select changes trigger immediate save", () => {
    // Build thread-mode: radio changes in init should wire a change listener.
    const initFnMatch = src.match(/export function initSettingsModal\(\)\s*\{([\s\S]*?)(?=\nexport )/);
    expect(initFnMatch).not.toBeNull();
    const initBody = initFnMatch[1];
    expect(initBody).toMatch(/buildThreadMode.*addEventListener.*['"](change)['"]/);

    // Comp rows: the thread-mode element in each row is wired with a change listener.
    const renderFnMatch = src.match(/function _renderCompWebhooks\(\)\s*\{([\s\S]*?)\n\}/);
    expect(renderFnMatch).not.toBeNull();
    const renderBody = renderFnMatch[1];
    expect(renderBody).toMatch(/\[data-field='thread-mode'\].*addEventListener.*['"](change)['"]/);
  });
});
