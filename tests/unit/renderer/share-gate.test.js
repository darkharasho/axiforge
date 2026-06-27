"use strict";
const { shareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");
const { buildPublishState } = require("../../../src/shared/publishState");

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

// Parity: the renderer's inline predicate must agree with the canonical CJS helper.
describe("share-gate parity with buildPublishState", () => {
  const matrix = [
    { publishedFileId: "", updatedAt: "t", publishedAt: null },
    { publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" },
    { publishedFileId: "x", updatedAt: "t9", publishedAt: null },
  ];
  test.each(matrix)("enabled iff shareable for %j", (rec) => {
    const enabled = shareDisabledTooltip(rec, false) === null;
    expect(enabled).toBe(buildPublishState(rec).shareable);
  });
});
