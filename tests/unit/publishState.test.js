"use strict";
const {
  publishStatus, compPublishStatus, withoutPublishReceipt, PUBLISH_RECEIPT_FIELDS,
} = require("../../src/shared/publishState");

describe("publishStatus", () => {
  test("never published", () => {
    expect(publishStatus({ publishedFileId: "" })).toBe("never");
    expect(publishStatus(null)).toBe("never");
  });

  test("hash receipt: current when the content matches, stale when it does not", () => {
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa", contentHash: "aaa" })).toBe("current");
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa", contentHash: "bbb" })).toBe("stale");
  });

  test("hash receipt ignores timestamps — a team pull rewrites updatedAt", () => {
    expect(publishStatus({
      publishedFileId: "f", publishedHash: "aaa", contentHash: "aaa", updatedAt: "t9", publishedAt: "t1",
    })).toBe("current");
  });

  test("an un-annotated record with a receipt reads current until main annotates it", () => {
    expect(publishStatus({ publishedFileId: "f", publishedHash: "aaa" })).toBe("current");
  });

  test("legacy (no hash): falls back to updatedAt vs publishedAt", () => {
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t1", publishedAt: "t1" })).toBe("current");
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t2", publishedAt: "t1" })).toBe("stale");
    expect(publishStatus({ publishedFileId: "f", updatedAt: "t9", publishedAt: null })).toBe("current");
  });
});

describe("compPublishStatus", () => {
  const builds = new Map([
    ["b1", { id: "b1", contentHash: "h1" }],
    ["b2", { id: "b2", contentHash: "h2" }],
    ["b3", { id: "b3" }],
  ]);
  const buildOf = (id) => builds.get(id);
  const comp = (over = {}) => ({
    publishedFileId: "c", publishedHash: "self", contentHash: "self",
    publishedMemberHashes: { b1: "h1", b2: "h2" }, ...over,
  });

  test("never / own-field staleness come first", () => {
    expect(compPublishStatus({ publishedFileId: "" }, buildOf)).toEqual({ status: "never", reason: null });
    expect(compPublishStatus(comp({ contentHash: "edited" }), buildOf)).toEqual({ status: "stale", reason: "self" });
  });

  test("current when the comp and every member match", () => {
    expect(compPublishStatus(comp(), buildOf)).toEqual({ status: "current", reason: null });
  });

  test("a changed member makes the comp stale with reason member", () => {
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "old", b2: "h2" } }), buildOf))
      .toEqual({ status: "stale", reason: "member" });
  });

  test("a member that is gone, or not annotated, cannot be judged and is skipped", () => {
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "h1", gone: "x", b3: "y" } }), buildOf))
      .toEqual({ status: "current", reason: null });
  });

  test("legacy comps (no hash) and a missing lookup skip the member check", () => {
    expect(compPublishStatus({ publishedFileId: "c", updatedAt: "t", publishedAt: "t", publishedMemberHashes: { b1: "old" } }, buildOf))
      .toEqual({ status: "current", reason: null });
    expect(compPublishStatus(comp({ publishedMemberHashes: { b1: "old" } })))
      .toEqual({ status: "current", reason: null });
  });

  test("tolerates a null comp", () => {
    expect(compPublishStatus(null, buildOf)).toEqual({ status: "never", reason: null });
  });
});

describe("withoutPublishReceipt", () => {
  test("drops every receipt field and nothing else, without mutating", () => {
    const rec = {
      id: "b1", title: "T", publishedSlug: "s", publishedFileId: "f", publishedKey: "k",
      publishedAt: "t", publishedOwner: "o", publishedHash: "h", publishedMemberHashes: { b: "m" },
      publishedFormat: "2:h",
    };
    expect(withoutPublishReceipt(rec)).toEqual({ id: "b1", title: "T" });
    expect(rec.publishedHash).toBe("h");
    expect(PUBLISH_RECEIPT_FIELDS).toEqual([
      "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
      "publishedHash", "publishedMemberHashes", "publishedFormat",
    ]);
  });
});
