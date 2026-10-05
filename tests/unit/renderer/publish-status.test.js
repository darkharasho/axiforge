/** @jest-environment jsdom */
"use strict";

const esm = require("../../../src/renderer/modules/publish-status.js");
const cjs = require("../../../src/shared/publishState");

// Parity: the ESM twin must agree with the CJS module main uses.
describe("publish-status parity with src/shared/publishState", () => {
  const records = [
    null,
    { publishedFileId: "" },
    { publishedFileId: "f", updatedAt: "t1", publishedAt: "t1" },
    { publishedFileId: "f", updatedAt: "t2", publishedAt: "t1" },
    { publishedFileId: "f", updatedAt: "t9", publishedAt: null },
    { publishedFileId: "f", publishedHash: "a", contentHash: "a" },
    { publishedFileId: "f", publishedHash: "a", contentHash: "b" },
    { publishedFileId: "f", publishedHash: "a" },
  ];
  test.each(records)("publishStatus agrees for %j", (rec) => {
    expect(esm.publishStatus(rec)).toBe(cjs.publishStatus(rec));
  });

  const builds = [{ id: "b1", contentHash: "h1" }, { id: "b2" }];
  const buildOf = (id) => builds.find((b) => b.id === id);
  const comps = [
    { publishedFileId: "" },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "h1" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "old" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "x", publishedMemberHashes: { b1: "h1" } },
    { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b2: "z", gone: "y" } },
    { publishedFileId: "c", updatedAt: "t2", publishedAt: "t1" },
  ];
  test.each(comps)("compPublishStatus agrees for %j", (comp) => {
    expect(esm.compPublishStatus(comp, buildOf)).toEqual(cjs.compPublishStatus(comp, buildOf));
  });

  test("receipt field lists match", () => {
    expect(esm.PUBLISH_RECEIPT_FIELDS).toEqual(cjs.PUBLISH_RECEIPT_FIELDS);
    const rec = { id: "a", publishedHash: "h", publishedFileId: "f", title: "T" };
    expect(esm.withoutPublishReceipt(rec)).toEqual(cjs.withoutPublishReceipt(rec));
  });
});

describe("buildLookup", () => {
  test("finds builds by id and follows a replaced array", () => {
    const first = [{ id: "b1", contentHash: "a" }];
    expect(esm.buildLookup(first)("b1").contentHash).toBe("a");
    const second = [{ id: "b1", contentHash: "b" }];
    expect(esm.buildLookup(second)("b1").contentHash).toBe("b");
    expect(esm.buildLookup(undefined)("b1")).toBeUndefined();
  });
});

describe("publishBadgeHtml", () => {
  const el = (html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  };

  test("current and stale render a mark; never renders nothing in rows", () => {
    expect(el(esm.publishBadgeHtml("current")).className).toBe("publish-badge publish-badge--current");
    expect(el(esm.publishBadgeHtml("current")).title).toBe("Published — up to date");
    expect(el(esm.publishBadgeHtml("stale")).className).toBe("publish-badge publish-badge--stale");
    expect(el(esm.publishBadgeHtml("stale")).title).toBe("Changed since last publish");
    expect(el(esm.publishBadgeHtml("stale", { reason: "member" })).title)
      .toBe("A build in this comp changed since publish");
    expect(esm.publishBadgeHtml("never")).toBe("");
    expect(esm.publishBadgeHtml(undefined)).toBe("");
  });

  test("the editor variant carries a label and shows never", () => {
    const never = el(esm.publishBadgeHtml("never", { editor: true }));
    expect(never.className).toBe("publish-badge publish-badge--editor publish-badge--never");
    expect(never.textContent).toBe("Not published");
    expect(el(esm.publishBadgeHtml("stale", { editor: true })).textContent).toBe("Out of date");
    expect(el(esm.publishBadgeHtml("current", { editor: true })).textContent).toBe("Published");
  });

  test("itemPublishBadgeHtml resolves comps against the builds list", () => {
    const comp = { publishedFileId: "c", publishedHash: "s", contentHash: "s", publishedMemberHashes: { b1: "old" } };
    const html = esm.itemPublishBadgeHtml("comp", comp, [{ id: "b1", contentHash: "new" }]);
    expect(el(html).title).toBe("A build in this comp changed since publish");
    expect(esm.itemPublishBadgeHtml("build", { publishedFileId: "" }, [])).toBe("");
  });
});

describe("filters", () => {
  const builds = [{ id: "b1", contentHash: "new" }];
  const stale = { publishedFileId: "f", publishedHash: "a", contentHash: "b" };
  const never = { publishedFileId: "" };
  const current = { publishedFileId: "f", publishedHash: "a", contentHash: "a" };

  test("matchesPublishFilter passes everything when nothing is selected", () => {
    expect(esm.matchesPublishFilter("build", never, builds, [])).toBe(true);
    expect(esm.matchesPublishFilter("build", never, builds, undefined)).toBe(true);
  });

  test("matchesPublishFilter matches any selected status", () => {
    expect(esm.matchesPublishFilter("build", stale, builds, ["stale"])).toBe(true);
    expect(esm.matchesPublishFilter("build", current, builds, ["stale", "never"])).toBe(false);
    expect(esm.matchesPublishFilter("build", never, builds, ["stale", "never"])).toBe(true);
    const memberStale = { ...current, publishedMemberHashes: { b1: "old" } };
    expect(esm.matchesPublishFilter("comp", memberStale, builds, ["stale"])).toBe(true);
  });

  test("compMatchesStatusFilter maps the comps-list select values", () => {
    expect(esm.compMatchesStatusFilter(current, "published", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(stale, "published", builds)).toBe(false);
    expect(esm.compMatchesStatusFilter(stale, "stale", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(never, "draft", builds)).toBe(true);
    expect(esm.compMatchesStatusFilter(never, null, builds)).toBe(true);
  });

  test("compPublishChipHtml renders the three chips", () => {
    expect(esm.compPublishChipHtml("current")).toContain("Published");
    expect(esm.compPublishChipHtml("stale")).toContain("Out of date");
    expect(esm.compPublishChipHtml("stale")).toContain("axi-chip--warn");
    expect(esm.compPublishChipHtml("never")).toContain("Draft");
    expect(esm.compPublishChipHtml("current", { small: true })).toContain("comp-badge--sm");
  });
});
