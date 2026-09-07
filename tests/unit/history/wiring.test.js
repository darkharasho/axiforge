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

  test("interleaves builds and comps newest-first", async () => {
    await buildHistory.appendVersion({ recordId: "b1", before: null, after: { id: "b1" }, author: "me", source: "local", ts: at(0) });
    await compHistory.appendVersion({ recordId: "c1", before: null, after: { id: "c1" }, author: "me", source: "local", ts: at(5) });
    await buildHistory.appendVersion({ recordId: "b1", after: { id: "b1", title: "Renamed" }, author: "me", source: "local", ts: at(90) });

    const feed = await buildFolderFeed({
      folderId: "root", folders, limit: 50,
      builds: [{ id: "b1", title: "B", folderId: "root" }],
      comps: [{ id: "c1", name: "C", folderId: "root" }],
      buildHistory, compHistory,
    });

    expect(feed.map((e) => `${e.recordKind}:${e.recordId}`)).toEqual(["build:b1", "comp:c1", "build:b1"]);
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
});
