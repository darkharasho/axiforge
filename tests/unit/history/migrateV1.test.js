"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { migrateV1 } = require("../../../src/main/history/migrateV1");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");

let dir, store;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-migrate-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function doc(title, rune = "Scholar") {
  return { id: "b1", title, equipment: { runes: { head: rune }, slots: {}, weapons: {}, sigils: {}, infusions: {} } };
}

async function writeV1(data) {
  await fs.writeFile(path.join(dir, "build-history.json"), JSON.stringify(data), "utf8");
}

function run(liveDocs = new Map()) {
  return migrateV1({ baseDir: dir, store, fileName: "build-history.json", idField: "buildId", liveDocs });
}

describe("migrateV1", () => {
  test("replays a record oldest-first and ends at the live doc", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("v1") },
      ],
    });
    const res = await run(new Map([["b1", doc("v3")]]));

    expect(res).toMatchObject({ migrated: 1, failed: 0 });
    const { versions } = await store.listVersions("b1", { limit: 10 });
    expect(versions.map((v) => v.v)).toEqual([3, 2, 1]);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v1"));
    expect(await store.getVersion("b1", 2)).toEqual(doc("v2"));
    expect(await store.getVersion("b1", 3)).toEqual(doc("v3"));
  });

  test("carries each entry's timestamp and author onto the version it produced", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "teammate", source: "team-sync", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map([["b1", doc("v2")]]));
    const { versions } = await store.listVersions("b1");
    expect(versions[0]).toMatchObject({ v: 2, author: "teammate", source: "team-sync", ts: "2026-09-03T10:00:00.000Z" });
  });

  test('recomputes summaries, so "build updated" does not survive', async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "build updated", snapshot: doc("Same", "Scholar") },
      ],
    });
    await run(new Map([["b1", doc("Same", "Durability")]]));
    const { versions } = await store.listVersions("b1");
    // Brief says "helm"; the Task 2 coordinator ruling (progress.md) renamed
    // SLOT_LABELS.head to "head" because no renderer string says "helm". Same
    // ruling, same rename, one string.
    expect(versions[0].summary).toBe("head rune: Scholar → Durability");
  });

  test("a record whose build is gone stops at the newest snapshot", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map());
    expect((await store.listVersions("b1")).versions.map((v) => v.v)).toEqual([1]);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v1"));
  });

  test("legacy entries with no snapshot are skipped without aborting the record", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "me", source: "local", summary: "legacy" },
      ],
    });
    const res = await run(new Map([["b1", doc("v3")]]));
    expect(res.failed).toBe(0);
    expect(await store.getVersion("b1", 1)).toEqual(doc("v2"));
  });

  test("a corrupt record starts fresh from the live doc and is counted as failed", async () => {
    await writeV1({ b1: "this is not an array" });
    const res = await run(new Map([["b1", doc("live")]]));
    expect(res.failed).toBe(1);
    const { versions } = await store.listVersions("b1");
    expect(versions).toHaveLength(1);
    expect(await store.getVersion("b1", 1)).toEqual(doc("live"));
  });

  test("renames the source file rather than deleting it", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    await run(new Map([["b1", doc("v2")]]));
    await expect(fs.access(path.join(dir, "build-history.json.pre-v2"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(dir, "build-history.json"))).rejects.toThrow();
  });

  test("is a no-op when there is nothing to migrate", async () => {
    expect(await run()).toMatchObject({ migrated: 0, failed: 0, skipped: true });
  });

  test("does not run twice", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    await run(new Map([["b1", doc("v2")]]));
    expect(await run(new Map([["b1", doc("v2")]]))).toMatchObject({ skipped: true });
    expect((await store.listVersions("b1")).versions).toHaveLength(2);
  });

  // The verbatim attribution test above has a single entry, so an off-by-one
  // in the walk is invisible to it. This one has two entries with different
  // authors: each version must carry the author of the entry that PRODUCED it
  // (older entry → older version), not the one whose snapshot it equals.
  test("attributes each version to the entry that produced it, not the one it snapshots", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "newer", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "older", source: "team-sync", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map([["b1", doc("v3")]]));
    const { versions } = await store.listVersions("b1");
    const byV = Object.fromEntries(versions.map((v) => [v.v, v]));
    // v2 is the state e2's change produced.
    expect(byV[2]).toMatchObject({ author: "older", source: "team-sync", ts: "2026-09-02T10:00:00.000Z" });
    // v3 is the live doc, which e1's change produced.
    expect(byV[3]).toMatchObject({ author: "newer", source: "local", ts: "2026-09-03T10:00:00.000Z" });
    // Times must run forward across the log.
    expect(versions.map((v) => v.ts)).toEqual([...versions.map((v) => v.ts)].sort().reverse());
  });

  test("keeps two v1 entries inside the coalescing window as two versions", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:01:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    });
    await run(new Map([["b1", doc("v3")]]));
    const { versions } = await store.listVersions("b1");
    expect(versions.map((v) => v.v)).toEqual([3, 2, 1]);
    expect(await store.getVersion("b1", 2)).toEqual(doc("v2"));
  });

  test("migration never throws, even on unreadable input", async () => {
    await fs.writeFile(path.join(dir, "build-history.json"), "{not json", "utf8");
    await expect(run(new Map())).resolves.toMatchObject({ failed: 0 });
  });
});
