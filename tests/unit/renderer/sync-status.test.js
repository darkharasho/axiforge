"use strict";
const { describeSyncStatus, SYNC_STATUSES } = require("../../../src/renderer/modules/sync-status.js");

test("all five statuses have a class, svg and title; unknown → null", () => {
  expect(SYNC_STATUSES).toEqual(["syncing", "synced", "pending", "conflict", "error"]);
  for (const s of SYNC_STATUSES) {
    const d = describeSyncStatus(s);
    expect(d.className).toBe(`--${s}`);
    expect(d.svg).toMatch(/^<svg/);
    expect(d.title.length).toBeGreaterThan(3);
  }
  expect(describeSyncStatus("pending").title).toBe("Waiting to sync");
  expect(describeSyncStatus("conflict").title).toBe("Sync conflict — click to resolve");
  expect(describeSyncStatus("nope")).toBeNull();
  expect(describeSyncStatus(undefined)).toBeNull();
});
