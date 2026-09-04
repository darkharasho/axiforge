/**
 * @jest-environment jsdom
 *
 * Per-entry revert in the shared-folder history panel.
 *
 * A history snapshot holds the build as it was BEFORE the logged change, so
 * every entry is restorable — including the newest, which is the "undo the last
 * change" case. Only legacy entries written before snapshots existed are inert.
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
function entries() {
  return [
    { id: "e1", buildId: "b1", buildTitle: "Alac Mech", timestamp: "2026-09-04T12:00:00Z", source: "team-sync", authorLogin: "vette", summary: "traits changed", snapshot: { id: "b1" } },
    { id: "e2", buildId: "b2", buildTitle: "Quick Herald", timestamp: "2026-09-04T11:00:00Z", source: "local", authorLogin: "me", summary: "notes updated", snapshot: { id: "b2" } },
    { id: "e3", buildId: "b1", buildTitle: "Alac Mech", timestamp: "2026-09-04T10:00:00Z", source: "local", authorLogin: "me", summary: "Created", snapshot: { id: "b1" } },
    { id: "e4", buildId: "b2", buildTitle: "Quick Herald", timestamp: "2026-09-04T09:00:00Z", source: "local", authorLogin: "me", summary: "Created" }, // no snapshot
  ];
}

function rowFor(entryId) {
  return document.querySelector(`.history-panel__entry[data-entry-id="${entryId}"]`);
}

function revertBtn(entryId) {
  return rowFor(entryId).querySelector(".history-panel__revert");
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

  test("every entry with a snapshot is restorable, newest included", () => {
    // The newest entry restores the state from just before the latest change,
    // which is the most common thing to want after a teammate's bad sync.
    expect(revertBtn("e1").disabled).toBe(false);
    expect(revertBtn("e2").disabled).toBe(false);
    expect(revertBtn("e3").disabled).toBe(false);
  });

  test("an entry with no snapshot is disabled", () => {
    expect(revertBtn("e4").disabled).toBe(true);
  });

  test("first click asks for confirmation instead of reverting", async () => {
    revertBtn("e3").click();
    await flush();

    expect(revertBuild).not.toHaveBeenCalled();
    expect(rowFor("e3").querySelector(".history-panel__confirm")).not.toBeNull();
    expect(rowFor("e3").textContent).toMatch(/teammates/i);
  });

  test("confirming reverts that build, re-renders the library, and closes the panel", async () => {
    const rerender = jest.fn();
    const toast = jest.fn();
    document.addEventListener("library:rerender", rerender);
    document.addEventListener("library:toast", toast);

    revertBtn("e3").click();
    await flush();
    rowFor("e3").querySelector(".history-panel__confirm-yes").click();
    await flush();

    expect(revertBuild).toHaveBeenCalledWith("b1", "e3");
    expect(rerender).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
    expect(document.querySelector(".history-panel")).toBeNull();

    document.removeEventListener("library:rerender", rerender);
    document.removeEventListener("library:toast", toast);
  });

  test("cancelling restores the button and reverts nothing", async () => {
    revertBtn("e3").click();
    await flush();
    rowFor("e3").querySelector(".history-panel__confirm-no").click();
    await flush();

    expect(revertBuild).not.toHaveBeenCalled();
    expect(rowFor("e3").querySelector(".history-panel__confirm")).toBeNull();
    expect(revertBtn("e3").disabled).toBe(false);
  });

  test("a failed revert keeps the panel open and reports the error", async () => {
    revertBuild.mockRejectedValue(new Error("offline"));
    const toast = jest.fn();
    document.addEventListener("library:toast", toast);

    revertBtn("e3").click();
    await flush();
    rowFor("e3").querySelector(".history-panel__confirm-yes").click();
    await flush();

    expect(document.querySelector(".history-panel")).not.toBeNull();
    expect(revertBtn("e3").disabled).toBe(false);
    expect(toast.mock.calls[0][0].detail.type).toBe("error");
    expect(toast.mock.calls[0][0].detail.message).toMatch(/offline/);

    document.removeEventListener("library:toast", toast);
  });
});
