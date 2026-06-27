"use strict";
const { shareRejectionReason } = require("../../src/main/shareGate");

describe("shareRejectionReason", () => {
  test("rejects when never published", () => {
    expect(shareRejectionReason({ publishedFileId: "", publishedKey: "", updatedAt: "t1", publishedAt: null }, "Build"))
      .toBe("Build must be published before sharing");
  });
  test("rejects when published but missing key", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "", updatedAt: "t1", publishedAt: "t1" }, "Build"))
      .toBe("Build must be published before sharing");
  });
  test("rejects stale", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t2", publishedAt: "t1" }, "Build"))
      .toBe("Build has unpublished changes — publish again before sharing.");
  });
  test("allows fresh", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t1", publishedAt: "t1" }, "Build"))
      .toBeNull();
  });
  test("allows legacy null publishedAt", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t9", publishedAt: null }, "Build"))
      .toBeNull();
  });
  test("uses the noun in the stale message", () => {
    expect(shareRejectionReason({ publishedFileId: "x", publishedKey: "k", updatedAt: "t2", publishedAt: "t1" }, "Comp"))
      .toBe("Comp has unpublished changes — publish again before sharing.");
  });
});
