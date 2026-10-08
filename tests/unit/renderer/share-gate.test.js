"use strict";
const { shareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");
const { publishStatus } = require("../../../src/shared/publishState");

describe("shareDisabledTooltip", () => {
  test("never published", () => {
    expect(shareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }, false))
      .toBe("Not published yet — Copy link publishes it");
  });
  test("stale", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false))
      .toBe("Your latest changes aren't published yet");
  });
  test("editor dirty even if published+fresh", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, true))
      .toBe("Save your changes first");
  });
  test("shareable and clean → enabled (null)", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, false))
      .toBeNull();
  });
  test.each(["queued", "publishing"])("an upload in flight does not block (main waits for it): %s", (state) => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false, state)).toBeNull();
  });
  test("a failed upload blocks with its own reason", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false, "failed"))
      .toBe("Publishing failed — retry it first");
  });
});

const { compShareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");

describe("compShareDisabledTooltip", () => {
  test("never published", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }))
      .toBe("Not published yet — Copy link publishes it");
  });
  test("stale", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }))
      .toBe("Your latest changes aren't published yet");
  });
  test("shareable → null", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }))
      .toBeNull();
  });
  test("queued → null; failed → blocked", () => {
    const stale = { publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" };
    expect(compShareDisabledTooltip(stale, [], "queued")).toBeNull();
    expect(compShareDisabledTooltip(stale, [], "failed")).toBe("Publishing failed — retry it first");
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
      .toBe("Your latest changes aren't published yet");
  });
  test("matching members allow it", () => {
    expect(compShareDisabledTooltip(comp, [{ id: "b1", contentHash: "old" }])).toBeNull();
  });
});
