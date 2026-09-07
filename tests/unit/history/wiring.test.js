"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { buildFolderFeed } = require("../../../src/main/history/folderFeed");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");
const { CompHistoryStore } = require("../../../src/main/compHistoryStore");

let dir, buildHistory, compHistory;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const at = (m) => new Date(T0 + m * 60_000).toISOString();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-feed-"));
  buildHistory = new BuildHistoryStore(dir);
  compHistory = new CompHistoryStore(dir);
  await buildHistory.init();
  await compHistory.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const folders = [
  { id: "root", parentId: null, name: "Raids" },
  { id: "child", parentId: "root", name: "Support" },
  { id: "other", parentId: null, name: "Elsewhere" },
];

describe("buildFolderFeed", () => {
  test("includes descendants and excludes unrelated folders", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1", title: "In root" }, author: "me", source: "local", ts: at(0) });
    await buildHistory.appendVersion({ recordId: "b2", before: null, after: { id: "b2", title: "In child" }, author: "me", source: "local", ts: at(1) });
    await buildHistory.appendVersion({ recordId: "b3", before: null, after: { id: "b3", title: "Elsewhere" }, author: "me", source: "local", ts: at(2) });

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [
        { id: "b1", title: "In root", folderId: "root" },
        { id: "b2", title: "In child", folderId: "child" },
        { id: "b3", title: "Elsewhere", folderId: "other" },
      ],
      comps: [],
      buildHistory, compHistory,
    });

    expect(feed.map((e) => e.recordId).sort()).toEqual(["b1", "b2"]);
  });

  // Three DISTINCT records at strictly decreasing timestamps, so the expected
  // sequence is asymmetric. The first version of this test compared against a
  // palindrome, and reversing the comparator in folderFeed.js left it green.
  test("interleaves builds and comps newest-first", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    await compHistory.appendVersion({ recordId: "c1", before: null, after: { id: "c1" }, author: "me", source: "local", ts: at(5) });
    await buildHistory.appendVersion({ recordId: "b2", before: null, after: { id: "b2" }, author: "me", source: "local", ts: at(10) });
    // A second version on b1, newest of all, so a record can appear twice.
    await buildHistory.appendVersion({ recordId: "b1", after: { id: "b1", title: "Renamed" }, author: "me", source: "local", ts: at(90) });

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [{ id: "b1", title: "B1", folderId: "root" }, { id: "b2", title: "B2", folderId: "child" }],
      comps: [{ id: "c1", name: "C", folderId: "root" }],
      buildHistory, compHistory,
    });

    expect(feed.map((e) => `${e.recordKind}:${e.recordId}@${e.v}`)).toEqual([
      "build:b1@2", "build:b2@1", "comp:c1@1", "build:b1@1",
    ]);
  });

  test("annotates trashed records so the panel can offer an undelete", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [{ id: "b1", title: "Gone", folderId: "root", deletedAt: "2026-09-02T00:00:00.000Z" }],
      comps: [], buildHistory, compHistory,
    });
    expect(feed[0]).toMatchObject({ recordDeleted: true, recordTitle: "Gone" });
  });

  test("respects the limit", async () => {
    for (let i = 0; i < 30; i++) {
      await buildHistory.appendVersion({ recordId: "b1", ...(i === 0 ? { before: null } : {}), after: { id: "b1", title: `t${i}` }, author: "me", source: "local", ts: at(i * 90) });
    }
    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 10,
      builds: [{ id: "b1", title: "B", folderId: "root" }], comps: [], buildHistory, compHistory,
    });
    expect(feed).toHaveLength(10);
  });

  // The case above is satisfied by the per-store slice inside listTails. THIS
  // one is not: neither store's own tail reaches the limit, only the merge of
  // the two does, so it fails if the feed-level cap goes missing.
  test("caps the MERGED feed, not just each store's tail", async () => {
    for (let i = 0; i < 6; i++) {
      // Interleaved in time, so the newest 8 must contain both kinds.
      await buildHistory.appendVersion({ recordId: "b1", ...(i === 0 ? { before: null } : {}), after: { id: "b1", title: `b${i}` }, author: "me", source: "local", ts: at(i * 180) });
      await compHistory.appendVersion({ recordId: "c1", ...(i === 0 ? { before: null } : {}), after: { id: "c1", name: `c${i}` }, author: "me", source: "local", ts: at(i * 180 + 90) });
    }
    const perStore = 6;
    const limit = 8;
    expect(perStore).toBeLessThan(limit); // neither tail overflows on its own

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit,
      builds: [{ id: "b1", title: "B", folderId: "root" }],
      comps: [{ id: "c1", name: "C", folderId: "root" }],
      buildHistory, compHistory,
    });

    expect(feed).toHaveLength(limit);
    // The newest 8 of the 12, still newest-first and still interleaved.
    expect(feed.map((e) => `${e.recordKind}@${e.v}`)).toEqual([
      "comp@6", "build@6", "comp@5", "build@5", "comp@4", "build@4", "comp@3", "build@3",
    ]);
  });

  test("a missing folderId returns nothing rather than every unfiled record", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    const args = {
      folders, limit: 50,
      // No folderId of its own: the seed used to land in the descendant set and
      // match this record.
      builds: [{ id: "b1", title: "Unfiled" }],
      comps: [], buildHistory, compHistory,
    };
    expect(await buildFolderFeed({ ...args, folderId: null })).toEqual([]);
    expect(await buildFolderFeed({ ...args, folderId: undefined })).toEqual([]);
  });
});
