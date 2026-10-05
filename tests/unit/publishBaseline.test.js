"use strict";

// Records published before publish receipts existed carry no publishedHash.
// Many also have no publishedAt (team pulls never copied it), and those read
// "Published" forever, whatever the user edits. The startup backfill gives each
// such record a baseline receipt so later edits read "Out of date".

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { annotateBuild, annotateComp, needsBaselineReceipt } = require("../../src/main/publishFingerprint");
const { backfillPublishReceipts } = require("../../src/main/publishBaseline");
const { publishStatus, compPublishStatus } = require("../../src/shared/publishState");

describe("needsBaselineReceipt", () => {
  test("published, no hash, no publishedAt → baseline", () => {
    expect(needsBaselineReceipt({ publishedFileId: "f", updatedAt: "t1" })).toBe(true);
  });
  test("published, no hash, publishedAt === updatedAt → baseline (known current)", () => {
    expect(needsBaselineReceipt({ publishedFileId: "f", updatedAt: "t1", publishedAt: "t1" })).toBe(true);
  });
  test("published, no hash, edited since publish → left as legacy stale", () => {
    expect(needsBaselineReceipt({ publishedFileId: "f", updatedAt: "t2", publishedAt: "t1" })).toBe(false);
  });
  test("already has a hash, or never published → no baseline", () => {
    expect(needsBaselineReceipt({ publishedFileId: "f", publishedHash: "abc" })).toBe(false);
    expect(needsBaselineReceipt({ updatedAt: "t1" })).toBe(false);
  });
});

describe("backfillPublishReceipts", () => {
  let dir, builds, comps;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-baseline-"));
    builds = new BuildStore(dir);
    comps = new CompStore(dir);
    await builds.init();
    await comps.init();
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  test("a legacy comp with no publishedAt reads stale after an edit once backfilled", async () => {
    const b = await builds.upsertBuild({ title: "Heal", profession: "Ranger" });
    // Legacy shape: published, but no publishedAt and no hash (a pulled comp).
    let c = await comps.upsertComp({ name: "Squad", buildIds: [b.id], publishedFileId: "f", publishedKey: "k" });
    expect(compPublishStatus(annotateComp(c), () => null).status).toBe("current");

    await backfillPublishReceipts({ buildStore: builds, compStore: comps });

    c = (await comps.listComps())[0];
    expect(c.publishedHash).toBeTruthy();
    expect(c.publishedMemberHashes).toEqual({ [b.id]: expect.any(String) });
    expect(compPublishStatus(annotateComp(c), () => null).status).toBe("current");

    const edited = await comps.upsertComp({ id: c.id, name: "Squad 2" });
    expect(compPublishStatus(annotateComp(edited), () => null)).toEqual({ status: "stale", reason: "self" });
  });

  test("a member build edit after backfill marks the comp stale (member)", async () => {
    const b = await builds.upsertBuild({ title: "Heal", profession: "Ranger" });
    const c = await comps.upsertComp({ name: "Squad", buildIds: [b.id], publishedFileId: "f" });
    await backfillPublishReceipts({ buildStore: builds, compStore: comps });

    const edited = annotateBuild(await builds.upsertBuild({ ...b, title: "Heal v2" }));
    const comp = annotateComp((await comps.listComps()).find((x) => x.id === c.id));
    expect(compPublishStatus(comp, (id) => (id === edited.id ? edited : null))).toEqual({ status: "stale", reason: "member" });
  });

  test("a legacy build is baselined; one edited since publish stays stale", async () => {
    const fresh = await builds.upsertBuild({ title: "A", profession: "Ranger", publishedFileId: "f1" });
    const edited = await builds.upsertBuild({ title: "B", profession: "Ranger", publishedFileId: "f2", publishedAt: "2020-01-01T00:00:00.000Z" });
    await backfillPublishReceipts({ buildStore: builds, compStore: comps });

    const list = await builds.listBuilds();
    const a = list.find((x) => x.id === fresh.id);
    const b = list.find((x) => x.id === edited.id);
    expect(a.publishedHash).toBeTruthy();
    expect(publishStatus(annotateBuild(a))).toBe("current");
    expect(b.publishedHash || "").toBe("");
    expect(publishStatus(annotateBuild(b))).toBe("stale");
  });

  test("backfill keeps updatedAt and is idempotent", async () => {
    const c = await comps.upsertComp({ name: "Squad", publishedFileId: "f" });
    await backfillPublishReceipts({ buildStore: builds, compStore: comps });
    const after = (await comps.listComps())[0];
    expect(after.updatedAt).toBe(c.updatedAt);
    const result = await backfillPublishReceipts({ buildStore: builds, compStore: comps });
    expect(result).toEqual({ builds: 0, comps: 0 });
  });
});
