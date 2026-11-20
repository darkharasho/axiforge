/** @jest-environment jsdom */
"use strict";

// Leaving or replacing a build with unsaved edits asks in the app's own themed
// modal, never the native window.confirm.
const { initConfirmModal } = require("../../../src/renderer/modules/confirm-modal.js");
const { state } = require("../../../src/renderer/modules/state.js");
const { confirmDiscardDirty, promptLeaveDirtyEditor } = require("../../../src/renderer/modules/editor.js");

const click = (id) => document.getElementById(id).click();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const modalOpen = () => !document.querySelector(".confirm-modal-overlay").classList.contains("confirm-modal-overlay--hidden");

beforeAll(() => initConfirmModal());
beforeEach(() => {
  window.confirm = jest.fn(() => true);
  state.editor = { ...state.editor, title: "Heal <b>FB</b>" };
});
afterEach(() => expect(window.confirm).not.toHaveBeenCalled());

describe("confirmDiscardDirty", () => {
  test("clean editor resolves true without asking", async () => {
    state.editorDirty = false;
    await expect(confirmDiscardDirty("Load another build")).resolves.toBe(true);
    expect(modalOpen()).toBe(false);
  });

  test.each([["cm-confirm", true], ["cm-cancel", false]])("dirty editor asks in the themed modal (%s → %s)", async (id, expected) => {
    state.editorDirty = true;
    const p = confirmDiscardDirty("Load another build");
    await flush();
    expect(modalOpen()).toBe(true);
    const body = document.getElementById("cm-body").innerHTML;
    expect(body).toContain("&lt;b&gt;FB&lt;/b&gt;");
    expect(body).toContain("Load another build");
    click(id);
    await expect(p).resolves.toBe(expected);
  });
});

describe("promptLeaveDirtyEditor", () => {
  test("clean editor leaves without asking", async () => {
    state.editorDirty = false;
    await expect(promptLeaveDirtyEditor()).resolves.toBe("leave");
    expect(modalOpen()).toBe(false);
  });

  test.each([
    ["cm-confirm", "save"],
    ["cm-alt", "discard"],
    ["cm-cancel", "stay"],
    ["cm-close", "stay"],
  ])("%s resolves %s", async (id, choice) => {
    state.editorDirty = true;
    const p = promptLeaveDirtyEditor();
    await flush();
    expect(document.getElementById("cm-confirm").textContent).toBe("Save");
    expect(document.getElementById("cm-alt").textContent).toBe("Discard");
    click(id);
    await expect(p).resolves.toBe(choice);
  });
});
