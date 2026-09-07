/**
 * @jest-environment jsdom
 *
 * Restoring a version from the shared-folder history panel.
 *
 * v2 stores no per-entry snapshot: a version is reconstructed by replaying the
 * append-only log up to it, so EVERY listed version is restorable — including
 * the newest, which is the "undo the last change" case. Restorability is keyed
 * off the version existing, nothing else.
 *
 * The panel itself never reverts. Its button opens the compare modal, which
 * owns the confirmation — so a stray click in a list of near-identical rows
 * cannot roll a build back, and the restore path exists in exactly one place.
 */
"use strict";

const {
  showFolderHistoryPanel,
  closeHistoryPanel,
} = require("../../../src/renderer/modules/library/history-panel.js");
const { closeCompareModal } = require("../../../src/renderer/modules/library/history-compare.js");
const { state } = require("../../../src/renderer/modules/state.js");

const flush = () => new Promise((r) => setTimeout(r, 0));

// Two live builds plus one sitting in the trash, interleaved. Newest-first, as
// folders:get-history returns them. The v2 folder feed annotates each version
// with recordId / recordKind / recordTitle / recordDeleted (the pre-v2 names
// were buildId / buildTitle).
function entries() {
  return [
    { v: 3, recordId: "b1", recordKind: "build", recordTitle: "Alac Mech", ts: "2026-09-04T12:00:00Z", source: "team-sync", author: "vette", summary: "traits changed" },
    { v: 2, recordId: "b2", recordKind: "build", recordTitle: "Quick Herald", ts: "2026-09-04T11:00:00Z", source: "local", author: "me", summary: "notes updated" },
    { v: 2, recordId: "b1", recordKind: "build", recordTitle: "Alac Mech", ts: "2026-09-04T10:00:00Z", source: "local", author: "me", summary: "helm rune: Scholar → Durability" },
    { v: 1, recordId: "b2", recordKind: "build", recordTitle: "Quick Herald", ts: "2026-09-04T09:00:00Z", source: "local", author: "me", summary: "" },
    { v: 2, recordId: "b3", recordKind: "build", recordTitle: "Old Scourge", recordDeleted: true, ts: "2026-09-03T09:00:00Z", source: "local", author: "me", summary: "notes updated" },
  ];
}

// Rows are addressed by (record, version): the feed merges several records, so
// a version number alone is not unique across it.
function rowFor(recordId, v) {
  return document.querySelector(`.history-panel__entry[data-record-id="${recordId}"][data-hist-v="${v}"]`);
}

function restoreBtn(recordId, v) {
  return rowFor(recordId, v).querySelector(".history-panel__revert");
}

// Enough of the per-record history API for the compare modal to open on top of
// the folder panel.
function stubCompare(api) {
  api.getBuildHistory = jest.fn(async (id) => ({
    versions: entries().filter((e) => e.recordId === id).map(({ v, ts, source, author, summary }) => ({ v, ts, source, author, summary })),
    nextCursor: null,
  }));
  api.compareHistory = jest.fn().mockResolvedValue({
    ops: [{ t: "field", path: "notes", before: "", after: "kite", label: "notes updated" }],
    fromDoc: { id: "b1" },
    toDoc: { id: "b1" },
  });
  api.getHistoryOps = jest.fn().mockResolvedValue([]);
  api.getHistoryVersion = jest.fn().mockResolvedValue(null);
  return api;
}

let revertBuild;

beforeEach(async () => {
  state.builds = [];
  state.upgradeCatalog = {};
  revertBuild = jest.fn().mockResolvedValue({ id: "b1", folderId: "f1" });
  window.desktopApi = stubCompare({
    getFolderHistory: jest.fn().mockResolvedValue(entries()),
    revertBuild,
  });
  await showFolderHistoryPanel("f1", "Shared Folder");
  await flush();
});

afterEach(() => {
  closeCompareModal();
  closeHistoryPanel();
  document.body.innerHTML = "";
});

describe("folder history panel — restoring a version", () => {
  test("every entry renders a restore button", () => {
    expect(document.querySelectorAll(".history-panel__revert")).toHaveLength(5);
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

  test("the button says it opens a review, and opening one reverts nothing", async () => {
    expect(restoreBtn("b1", 2).textContent).toMatch(/review & restore/i);

    restoreBtn("b1", 2).click();
    await flush();
    await flush();

    expect(revertBuild).not.toHaveBeenCalled();
    // The modal opened on that record's version, with the panel still behind it.
    expect(document.querySelector(".hist-compare-overlay")).not.toBeNull();
    expect(window.desktopApi.getBuildHistory).toHaveBeenCalledWith("b1", { limit: 200 });
    expect(document.querySelectorAll(".hist-compare__pick")[0].value).toBe("2");
    expect(document.querySelector(".history-panel")).not.toBeNull();
  });

  test("the row body opens the same modal as the button", async () => {
    rowFor("b1", 3).querySelector(".history-panel__entry-body").click();
    await flush();
    await flush();

    expect(document.querySelector(".hist-compare-overlay")).not.toBeNull();
    expect(document.querySelectorAll(".hist-compare__pick")[0].value).toBe("3");
    expect(revertBuild).not.toHaveBeenCalled();
  });

  test("a trashed record offers to bring it back, not to roll it back", async () => {
    // "Roll this build back to v2" reads as a no-op on something that looks
    // gone. Restoring one of its versions takes it out of the trash, and both
    // the button and the modal's confirmation have to say so.
    expect(restoreBtn("b3", 2).textContent).toMatch(/bring it back/i);

    restoreBtn("b3", 2).click();
    await flush();
    await flush();

    const restore = document.querySelector(".hist-compare__restore");
    expect(restore.textContent).toMatch(/bring back v2/i);
    restore.click();
    expect(document.querySelector(".hist-compare__confirm-text").textContent)
      .toMatch(/out of the trash/i);
  });

  test("confirming in the modal reverts that build, re-renders the library, and closes the panel", async () => {
    const rerender = jest.fn();
    const toast = jest.fn();
    document.addEventListener("library:rerender", rerender);
    document.addEventListener("library:toast", toast);

    restoreBtn("b1", 2).click();
    await flush();
    await flush();
    document.querySelector(".hist-compare__restore").click();
    expect(revertBuild).not.toHaveBeenCalled();
    document.querySelector(".hist-compare__confirm-yes").click();
    await flush();

    expect(revertBuild).toHaveBeenCalledWith("b1", 2);
    expect(rerender).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
    // onRestored closes the panel underneath, so the library is visible again.
    expect(document.querySelector(".hist-compare-overlay")).toBeNull();
    expect(document.querySelector(".history-panel")).toBeNull();

    document.removeEventListener("library:rerender", rerender);
    document.removeEventListener("library:toast", toast);
  });

  test("a failed revert leaves both the modal and the panel open and reports the error", async () => {
    revertBuild.mockRejectedValue(new Error("offline"));
    const toast = jest.fn();
    document.addEventListener("library:toast", toast);

    restoreBtn("b1", 2).click();
    await flush();
    await flush();
    document.querySelector(".hist-compare__restore").click();
    document.querySelector(".hist-compare__confirm-yes").click();
    await flush();

    expect(document.querySelector(".hist-compare-overlay")).not.toBeNull();
    expect(document.querySelector(".history-panel")).not.toBeNull();
    expect(document.querySelector(".hist-compare__restore").disabled).toBe(false);
    expect(toast.mock.calls[0][0].detail.type).toBe("error");
    expect(toast.mock.calls[0][0].detail.message).toMatch(/offline/);

    document.removeEventListener("library:toast", toast);
  });
});
