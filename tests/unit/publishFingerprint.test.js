"use strict";

const {
  buildFingerprint, compFingerprint, memberHashes, buildReceipt, compReceipt,
  annotateBuild, annotateComp, annotateSyncEvent,
} = require("../../src/main/publishFingerprint");

function build(over = {}) {
  return {
    id: "b1", version: 2, title: "Heal Druid", profession: "Ranger",
    specializations: [{ id: 5, name: "Druid", elite: true }],
    skills: { heal: { id: 1 }, utility: [{ id: 2 }, null, null], elite: null },
    underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
    equipment: { statPackage: "Harrier" }, tags: ["heal"], notes: "n", images: {},
    gameMode: "wvw", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    buildUrl: "", publishedSlug: "", publishedFileId: "", publishedKey: "", publishedAt: null,
    publishedOwner: "", publishedHash: "", folderId: null, compIds: [], pinned: false,
    deletedAt: null, trashBatchId: "", trashRoot: false, archivedAt: null, archiveBatchId: "",
    archiveRoot: false, sortOrder: 0, selectedLegends: ["", ""], selectedUnderwaterLegends: ["", ""],
    activeLegendSlot: 0, selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    morphSkillIds: [0, 0, 0],
    ...over,
  };
}

function comp(over = {}) {
  return {
    id: "c1", name: "Squad", notes: "", images: {}, tags: [], folderId: null, sortOrder: 0,
    buildIds: ["b1"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1"] }], gameMode: "wvw",
    buildColors: {}, categories: [], createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

describe("buildFingerprint", () => {
  test("is 16 hex characters", () => {
    expect(buildFingerprint(build())).toMatch(/^[0-9a-f]{16}$/);
  });

  test("does not depend on key order", () => {
    const b = build();
    const reversed = Object.fromEntries(Object.entries(b).reverse());
    expect(buildFingerprint(reversed)).toBe(buildFingerprint(b));
  });

  test("ignores identity, timestamps, receipts and library bookkeeping", () => {
    const base = buildFingerprint(build());
    expect(buildFingerprint(build({
      id: "other", updatedAt: "2027-01-01T00:00:00.000Z", createdAt: "2027-01-01T00:00:00.000Z",
      publishedFileId: "f", publishedKey: "k", publishedSlug: "s", publishedAt: "2027-01-01T00:00:00.000Z",
      publishedOwner: "o", publishedHash: "abc", folderId: "f1", compIds: ["c1"], pinned: true,
      sortOrder: 9, deletedAt: "2027-01-01T00:00:00.000Z", trashBatchId: "t", trashRoot: true,
      archivedAt: "2027-01-01T00:00:00.000Z", archiveBatchId: "a", archiveRoot: true,
      activeLegendSlot: 1, buildUrl: "https://x", contentHash: "zzz",
    }))).toBe(base);
  });

  test("changes when a title or a skill changes", () => {
    const base = buildFingerprint(build());
    expect(buildFingerprint(build({ title: "Heal Druid v2" }))).not.toBe(base);
    expect(buildFingerprint(build({ skills: { heal: { id: 99 }, utility: [{ id: 2 }, null, null], elite: null } }))).not.toBe(base);
  });

  test("covers content fields it was never told about", () => {
    expect(buildFingerprint(build({ someFutureField: 1 }))).not.toBe(buildFingerprint(build()));
  });
});

describe("compFingerprint", () => {
  test("ignores bookkeeping and party-line ids", () => {
    const base = compFingerprint(comp());
    expect(compFingerprint(comp({
      id: "x", folderId: "f", sortOrder: 4, updatedAt: "2027-01-01T00:00:00.000Z",
      publishedFileId: "f", publishedHash: "h", publishedMemberHashes: { b1: "m" },
      boonCoverageHtml: "<p>", archivedAt: "2027-01-01T00:00:00.000Z",
      partyLines: [{ id: "regenerated", capacity: 5, slots: ["b1"] }],
    }))).toBe(base);
  });

  test("absent fields hash as their upsertComp defaults", () => {
    const full = comp({ notes: "", images: {}, tags: [], buildColors: {}, categories: [] });
    const sparse = comp();
    for (const k of ["notes", "images", "tags", "buildColors", "categories"]) delete sparse[k];
    expect(compFingerprint(sparse)).toBe(compFingerprint(full));
  });

  test("changes when the name, a slot or the membership changes", () => {
    const base = compFingerprint(comp());
    expect(compFingerprint(comp({ name: "Squad 2" }))).not.toBe(base);
    expect(compFingerprint(comp({ partyLines: [{ id: "l1", capacity: 5, slots: [] }] }))).not.toBe(base);
    expect(compFingerprint(comp({ buildIds: ["b1", "b2"] }))).not.toBe(base);
  });
});

describe("receipts", () => {
  test("buildReceipt carries the build's fingerprint", () => {
    expect(buildReceipt(build())).toEqual({ publishedHash: buildFingerprint(build()) });
  });

  test("compReceipt carries the comp's own hash and one hash per member", () => {
    const b2 = build({ id: "b2", title: "Firebrand" });
    expect(compReceipt(comp(), [build(), b2])).toEqual({
      publishedHash: compFingerprint(comp()),
      publishedMemberHashes: { b1: buildFingerprint(build()), b2: buildFingerprint(b2) },
    });
    expect(memberHashes([build()])).toEqual({ b1: buildFingerprint(build()) });
  });
});

describe("annotation", () => {
  test("annotateBuild / annotateComp attach the current fingerprint without mutating", () => {
    const b = build();
    const out = annotateBuild(b);
    expect(out.contentHash).toBe(buildFingerprint(b));
    expect(b.contentHash).toBeUndefined();
    expect(annotateComp(comp()).contentHash).toBe(compFingerprint(comp()));
    expect(annotateBuild(null)).toBeNull();
    expect(annotateComp(undefined)).toBeUndefined();
  });

  test("annotateSyncEvent annotates build and comp items only", () => {
    expect(annotateSyncEvent({ type: "build", id: "b1", item: build() }).item.contentHash)
      .toBe(buildFingerprint(build()));
    expect(annotateSyncEvent({ type: "comp", id: "c1", item: comp() }).item.contentHash)
      .toBe(compFingerprint(comp()));
    const folder = { type: "folder", id: "f", item: { name: "F" } };
    expect(annotateSyncEvent(folder)).toBe(folder);
    const noItem = { status: "synced", folderId: "t" };
    expect(annotateSyncEvent(noItem)).toBe(noItem);
  });
});
