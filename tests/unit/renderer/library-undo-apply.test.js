"use strict";

const { pushUndo, popUndo, clearUndo, applyUndo } = require("../../../src/renderer/modules/library/undo.js");

beforeEach(() => clearUndo());

describe("applyUndo", () => {
  test("reports the action's own label on success", async () => {
    const toasts = [];
    const action = { type: "delete-builds", label: "Restored 2 builds", undo: async () => {} };

    await applyUndo(action, { toast: (msg, type) => toasts.push({ msg, type }) });

    expect(toasts).toEqual([{ msg: "Restored 2 builds", type: "success" }]);
  });

  test("falls back to a generic label when the action has none", async () => {
    const toasts = [];
    await applyUndo({ undo: async () => {} }, { toast: (msg, type) => toasts.push({ msg, type }) });

    expect(toasts).toEqual([{ msg: "Undone!", type: "success" }]);
  });

  test("shows the real failure message when the undo is rejected", async () => {
    const toasts = [];
    const action = {
      label: "Restored 1 build",
      undo: async () => {
        throw new Error("Only the team owner or the build's creator can delete it from the team.");
      },
    };

    await applyUndo(action, { toast: (msg, type) => toasts.push({ msg, type }) });

    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].msg).toMatch(/team owner/);
  });

  test("does not report success when the undo failed", async () => {
    const toasts = [];
    const action = { label: "Restored 1 build", undo: async () => { throw new Error("nope"); } };

    await applyUndo(action, { toast: (msg, type) => toasts.push({ msg, type }) });

    expect(toasts.some((t) => t.type === "success")).toBe(false);
  });

  test("re-renders even when the undo failed, so a partial restore is visible", async () => {
    let renders = 0;
    const action = { undo: async () => { throw new Error("nope"); } };

    await applyUndo(action, { toast: () => {}, render: () => { renders++; } });

    expect(renders).toBe(1);
  });

  test("is a no-op when there is nothing to undo", async () => {
    const toasts = [];
    let renders = 0;

    await applyUndo(null, { toast: (m) => toasts.push(m), render: () => { renders++; } });

    expect(toasts).toEqual([]);
    expect(renders).toBe(0);
  });
});
