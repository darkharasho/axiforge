"use strict";
const { describeSyncStatus, SYNC_STATUSES } = require("../../../src/renderer/modules/sync-status.js");

test("all five statuses have a class, icon and title; unknown → null", () => {
  expect(SYNC_STATUSES).toEqual(["syncing", "synced", "pending", "conflict", "error"]);
  for (const s of SYNC_STATUSES) {
    const d = describeSyncStatus(s);
    expect(d.className).toBe(`--${s}`);
    // Syncing is the design system's spinner; the rest are glyphs.
    expect(d.svg).toMatch(s === "syncing" ? /^<span class="[^"]*\baxi-spinner\b/ : /^<svg/);
    expect(d.title.length).toBeGreaterThan(3);
  }
  expect(describeSyncStatus("pending").title).toBe("Waiting to sync");
  expect(describeSyncStatus("conflict").title).toBe("Sync conflict — click to resolve");
  expect(describeSyncStatus("nope")).toBeNull();
  expect(describeSyncStatus(undefined)).toBeNull();
});
