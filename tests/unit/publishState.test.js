"use strict";
const { buildPublishState } = require("../../src/shared/publishState");

describe("buildPublishState", () => {
  test("never published", () => {
    expect(buildPublishState({ publishedFileId: "", updatedAt: "t1", publishedAt: null }))
      .toEqual({ neverPublished: true, stale: false, shareable: false });
  });

  test("published and fresh", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t1", publishedAt: "t1" }))
      .toEqual({ neverPublished: false, stale: false, shareable: true });
  });

  test("published then edited (stale)", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t2", publishedAt: "t1" }))
      .toEqual({ neverPublished: false, stale: true, shareable: false });
  });

  test("legacy published with null publishedAt is shareable, not stale", () => {
    expect(buildPublishState({ publishedFileId: "abc", updatedAt: "t9", publishedAt: null }))
      .toEqual({ neverPublished: false, stale: false, shareable: true });
  });

  test("tolerates missing/undefined record", () => {
    expect(buildPublishState(null)).toEqual({ neverPublished: true, stale: false, shareable: false });
  });
});
