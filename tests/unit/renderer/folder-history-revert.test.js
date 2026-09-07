/**
 * @jest-environment jsdom
 *
 * Per-entry revert in the shared-folder history panel.
 *
 * v2 stores no per-entry snapshot: a version is reconstructed by replaying the
 * append-only log up to it, so EVERY listed version is restorable — including
 * the newest, which is the "undo the last change" case. Restorability is keyed
 * off the version existing, nothing else.
 *
 * Confirmation is inline (a second click in the row) rather than the shared
 * confirm modal: the history panel is z-index 1101 and .confirm-modal-overlay
 * is --z-modal-confirm (1100), so the modal would render behind the panel.
 */
"use strict";

const {
  showFolderHistoryPanel,
  closeHistoryPanel,
} = require("../../../src/renderer/modules/library/history-panel.js");

const flush = () => new Promise((r) => setTimeout(r, 0));

// Two builds, interleaved. Newest-first, as folders:get-history returns them.
// The v2 folder feed annotates each version with recordId / recordKind /
// recordTitle / recordDeleted (the pre-v2 names were buildId / buildTitle).
function entries() {
  return [
    { v: 3, recordId: "b1", recordKind: "build", recordTitle: "Alac Mech", ts: "2026-09-04T12:00:00Z", source: "team-sync", author: "vette", summary: "traits changed" },
    { v: 2, recordId: "b2", recordKind: "build", recordTitle: "Quick Herald", ts: "2026-09-04T11:00:00Z", source: "local", author: "me", summary: "notes updated" },
    { v: 2, recordId: "b1", recordKind: "build", recordTitle: "Alac Mech", ts: "2026-09-04T10:00:00Z", source: "local", author: "me", summary: "helm rune: Scholar → Durability" },
    { v: 1, recordId: "b2", recordKind: "build", recordTitle: "Quick Herald", ts: "2026-09-04T09:00:00Z", source: "local", author: "me", summary: "" },
  ];
}

// Rows are addressed by (record, version): the feed merges several records, so
// a version number alone is not unique across it.
function rowFor(recordId, v) {
  return document.querySelector(`.history-panel__entry[data-record-id="${recordId}"][data-hist-v="${v}"]`);
}

function revertBtn(recordId, v) {
  return rowFor(recordId, v).querySelector(".history-panel__revert");
}

let revertBuild;

beforeEach(async () => {
  revertBuild = jest.fn().mockResolvedValue({ id: "b1", folderId: "f1" });
  window.desktopApi = {
    getFolderHistory: jest.fn().mockResolvedValue(entries()),
    revertBuild,
  };
  await showFolderHistoryPanel("f1", "Shared Folder");
  await flush();
});

afterEach(() => {
  closeHistoryPanel();
  document.body.innerHTML = "";
});

describe("folder history panel — per-entry revert", () => {
  test("every entry renders a restore button", () => {
    expect(document.querySelectorAll(".history-panel__revert")).toHaveLength(4);
  });

  test("every version is restorable, newest included", () => {
    // The newest entry restores the state at the latest change, which is the
    // most common thing to want after a teammate's bad sync. v2 has no inert
    // "snapshotless" entry any more.
    for (const btn of document.querySelectorAll(".history-panel__revert")) {
      expect(btn.disabled).toBe(false);
    }
  });

  test("the origin keyframe says it is the first recorded state, not that nothing changed", () => {
    // history:get-ops returns [] for v1 by design — there is no predecessor to
    // diff against — so its summary is empty. "No changes" would be a lie.
    expect(rowFor("b2", 1).textContent).toMatch(/first recorded state/i);
    expect(rowFor("b2", 1).textContent).not.toMatch(/no changes/i);
  });

  test("first click asks for confirmation instead of reverting", async () => {
    revertBtn("b1", 2).click();
    await flush();

    expect(revertBuild).not.toHaveBeenCalled();
    expect(rowFor("b1", 2).querySelector(".history-panel__confirm")).not.toBeNull();
    expect(rowFor("b1", 2).textContent).toMatch(/teammates/i);
  });

  test("confirming reverts that build, re-renders the library, and closes the panel", async () => {
    const rerender = jest.fn();
    const toast = jest.fn();
    document.addEventListener("library:rerender", rerender);
    document.addEventListener("library:toast", toast);

    revertBtn("b1", 2).click();
    await flush();
    rowFor("b1", 2).querySelector(".history-panel__confirm-yes").click();
    await flush();

    expect(revertBuild).toHaveBeenCalledWith("b1", 2);
    expect(rerender).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
    expect(document.querySelector(".history-panel")).toBeNull();

    document.removeEventListener("library:rerender", rerender);
    document.removeEventListener("library:toast", toast);
  });

  test("cancelling restores the button and reverts nothing", async () => {
    revertBtn("b1", 2).click();
    await flush();
    rowFor("b1", 2).querySelector(".history-panel__confirm-no").click();
    await flush();

    expect(revertBuild).not.toHaveBeenCalled();
    expect(rowFor("b1", 2).querySelector(".history-panel__confirm")).toBeNull();
    expect(revertBtn("b1", 2).disabled).toBe(false);
  });

  test("a failed revert keeps the panel open and reports the error", async () => {
    revertBuild.mockRejectedValue(new Error("offline"));
    const toast = jest.fn();
    document.addEventListener("library:toast", toast);

    revertBtn("b1", 2).click();
    await flush();
    rowFor("b1", 2).querySelector(".history-panel__confirm-yes").click();
    await flush();

    expect(document.querySelector(".history-panel")).not.toBeNull();
    expect(revertBtn("b1", 2).disabled).toBe(false);
    expect(toast.mock.calls[0][0].detail.type).toBe("error");
    expect(toast.mock.calls[0][0].detail.message).toMatch(/offline/);

    document.removeEventListener("library:toast", toast);
  });
});
