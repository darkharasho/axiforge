"use strict";
const { shareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");
const { publishStatus } = require("../../../src/shared/publishState");

describe("shareDisabledTooltip", () => {
  test("never published", () => {
    expect(shareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }, false))
      .toBe("Publish this build first");
  });
  test("stale", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false))
      .toBe("Publish your latest changes first");
  });
  test("editor dirty even if published+fresh", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, true))
      .toBe("Publish your latest changes first");
  });
  test("shareable and clean → enabled (null)", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, false))
      .toBeNull();
  });
});

const { compShareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");

describe("compShareDisabledTooltip", () => {
  test("never published", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }))
      .toBe("Publish this comp first");
  });
  test("stale", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }))
      .toBe("Publish your latest changes first");
  });
  test("shareable → null", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }))
      .toBeNull();
  });
});

// Parity: the renderer's tooltip must agree with the canonical CJS status.
describe("share-gate parity with publishStatus", () => {
  const matrix = [
    { publishedFileId: "", updatedAt: "t", publishedAt: null },
    { publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t9", publishedAt: null },
    { publishedFileId: "x", publishedHash: "h", contentHash: "h", updatedAt: "t9", publishedAt: "t1" },
    { publishedFileId: "x", publishedHash: "h", contentHash: "other" },
  ];
  test.each(matrix)("enabled iff current for %j", (rec) => {
    const enabled = shareDisabledTooltip(rec, false) === null;
    expect(enabled).toBe(publishStatus(rec) === "current");
  });
});

describe("compShareDisabledTooltip with member builds", () => {
  const comp = { publishedFileId: "x", publishedHash: "h", contentHash: "h", publishedMemberHashes: { b1: "old" } };
  test("a changed member blocks sharing", () => {
    expect(compShareDisabledTooltip(comp, [{ id: "b1", contentHash: "new" }]))
      .toBe("Publish your latest changes first");
  });
  test("matching members allow it", () => {
    expect(compShareDisabledTooltip(comp, [{ id: "b1", contentHash: "old" }])).toBeNull();
  });
});
