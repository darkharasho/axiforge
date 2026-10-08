/** @jest-environment jsdom */
"use strict";

const {
  initConfirmModal, showConfirmModal, isConfirmModalOpen, whenConfirmModalIdle,
} = require("../../../src/renderer/modules/confirm-modal.js");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (id) => document.getElementById(id).click();
const esc = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

beforeAll(() => initConfirmModal());

describe("boolean callers (default)", () => {
  test("confirm is true; cancel, close, Esc and displacement are false", async () => {
    let p = showConfirmModal({ title: "t", body: "" });
    click("cm-confirm");
    await expect(p).resolves.toBe(true);
    p = showConfirmModal({ title: "t", body: "" });
    click("cm-cancel");
    await expect(p).resolves.toBe(false);
    p = showConfirmModal({ title: "t", body: "" });
    esc();
    await expect(p).resolves.toBe(false);
    p = showConfirmModal({ title: "t", body: "" });
    const next = showConfirmModal({ title: "u", body: "" });
    await expect(p).resolves.toBe(false);
    click("cm-close");
    await expect(next).resolves.toBe(false);
  });
});

describe("detailed outcomes", () => {
  test.each([["cm-confirm", "confirm"], ["cm-cancel", "cancel"], ["cm-close", "close"]])("%s resolves %s", async (id, outcome) => {
    const p = showConfirmModal({ title: "t", body: "", detailed: true });
    click(id);
    await expect(p).resolves.toBe(outcome);
  });

  test("Esc is a close, not a cancel", async () => {
    const p = showConfirmModal({ title: "t", body: "", detailed: true });
    esc();
    await expect(p).resolves.toBe("close");
  });

  test("a confirm replaced by another resolves displaced; one Esc closes only the new one", async () => {
    const first = showConfirmModal({ title: "t", body: "", detailed: true });
    const second = showConfirmModal({ title: "u", body: "", detailed: true });
    await expect(first).resolves.toBe("displaced");
    esc();
    await expect(second).resolves.toBe("close");
    expect(isConfirmModalOpen()).toBe(false);
  });
});

describe("whenConfirmModalIdle", () => {
  test("resolves at once when nothing is open", async () => {
    await expect(whenConfirmModalIdle()).resolves.toBeUndefined();
  });

  test("waits for the open confirm, and for a follow-up opened from its answer", async () => {
    const first = showConfirmModal({ title: "t", body: "" });
    let idle = false;
    whenConfirmModalIdle().then(() => { idle = true; });
    let followUp;
    first.then(() => { followUp = showConfirmModal({ title: "follow-up", body: "" }); });
    click("cm-confirm");
    await flush();
    await flush();
    expect(followUp).toBeDefined();
    expect(idle).toBe(false);
    click("cm-cancel");
    await followUp;
    await flush();
    expect(idle).toBe(true);
  });
});
