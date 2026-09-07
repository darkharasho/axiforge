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
  return migrateV1({ baseDir: dir, store, fileName: "build-history.json", liveDocs });
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

  // The brief's version of this fed a wholly unparseable file and asserted
  // only `failed: 0` — which a migration that did nothing at all also
  // satisfies. Feed it a file that is parseable but PARTLY corrupt, which is
  // the case that actually matters (a user must still get an app that starts,
  // with whatever history could be salvaged), and assert the salvage happened.
  test("migration never throws, and salvages what it can from partly corrupt input", async () => {
    await writeV1({
      good: [
        { id: "e1", buildId: "good", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
      bad: "this is not an array",
    });
    const res = await run(new Map([["good", doc("v2")], ["bad", doc("live")]]));
    expect(res.failed).toBe(1);
    // The good record was actually migrated, not silently skipped.
    expect(res.versioned).toBeGreaterThan(0);
    const { versions } = await store.listVersions("good", { limit: 10 });
    expect(versions.map((v) => v.v)).toEqual([2, 1]);
    expect(await store.getVersion("good", 1)).toEqual(doc("v1"));
    expect(await store.getVersion("good", 2)).toEqual(doc("v2"));
  });

  test("migration never throws on wholly unreadable input", async () => {
    await fs.writeFile(path.join(dir, "build-history.json"), "{not json", "utf8");
    await expect(run(new Map())).resolves.toMatchObject({ failed: 0 });
  });

  // --- fix round 1 -------------------------------------------------------

  // A failed rename means the source file survives, so the next launch reads
  // it again. Without a per-record guard the whole chain is appended a second
  // time onto a log that already ends at the live document, and the log runs
  // backwards: the duplicated origin state lands ABOVE the live state, dated
  // older, "reverting" the build.
  test("a re-run over a surviving source file neither duplicates nor inverts the chain", async () => {
    const v1 = {
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e2", buildId: "b1", timestamp: "2026-09-01T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    };
    const live = new Map([["b1", doc("v3")]]);
    await writeV1(v1);
    await run(live);
    // The rename did not stick — restore from backup, a locked file, anything.
    await writeV1(v1);
    const second = await run(live);

    expect(second.migrated).toBe(0);
    const { versions } = await store.listVersions("b1", { limit: 100 });
    expect(versions.map((v) => v.v)).toEqual([3, 2, 1]);
    // Timestamps must still run forward, and the newest version must still be
    // the live document rather than a resurrected origin state.
    const ts = versions.map((v) => v.ts);
    expect(ts).toEqual([...ts].sort().reverse());
    expect(await store.getVersion("b1", 3)).toEqual(doc("v3"));
  });

  test("reports that the source file was retired", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    expect(await run(new Map([["b1", doc("v2")]]))).toMatchObject({ retired: true });
  });

  // Was "reports retired:false when the rename fails": a directory at the
  // destination is no longer a failure, because the destination is no longer
  // fixed. It is an occupied name, and an occupied name gets stepped over —
  // see "the pre-v2 undo copy is never overwritten" below for the case where
  // there is genuinely nowhere left to go.
  test("a directory sitting at the destination is stepped over, never written into", async () => {
    await writeV1({ b1: [{ id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") }] });
    await fs.mkdir(path.join(dir, "build-history.json.pre-v2"));
    await fs.writeFile(path.join(dir, "build-history.json.pre-v2", "x"), "x", "utf8");

    const res = await run(new Map([["b1", doc("v2")]]));
    expect(res).toMatchObject({ retired: true, migrated: 1 });
    // The directory and its contents are untouched...
    expect(await fs.readFile(path.join(dir, "build-history.json.pre-v2", "x"), "utf8")).toBe("x");
    // ...and the source moved to the next free name instead.
    expect(JSON.parse(await fs.readFile(path.join(dir, "build-history.json.pre-v2.1"), "utf8"))).toHaveProperty("b1");
    await expect(fs.access(path.join(dir, "build-history.json"))).rejects.toThrow();
  });

  // Every v1 entry must land in exactly one bucket, so the totals reconcile.
  test("every entry is accounted for: versioned + derivedOnly + dropped === entries", async () => {
    await writeV1({
      // 3 entries: one legacy with no snapshot (dropped), one real change
      // (versioned), one whose change the differ sees as nothing (derivedOnly).
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-04T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: { ...doc("v2"), sortOrder: 1 } },
        { id: "e2", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v2") },
        { id: "e3", buildId: "b1", timestamp: "2026-09-02T10:00:00.000Z", authorLogin: "me", source: "local", summary: "legacy" },
      ],
      // 1 entry, no live doc: the newest entry produced nothing (dropped).
      b2: [
        { id: "f1", buildId: "b2", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("gone") },
      ],
      // 2 entries in a record that cannot be migrated at all (both dropped).
      b3: "this is not an array",
    });
    const res = await run(new Map([["b1", { ...doc("v3"), sortOrder: 1 }]]));
    expect(res.entries).toBe(4);
    expect(res.versioned + res.derivedOnly + res.dropped).toBe(res.entries);
    expect(res.dropped).toBeGreaterThanOrEqual(2);
    expect(res.derivedOnly).toBe(1);
  });

  // appendVersion returns null both for "nothing worth recording" and for "the
  // write failed and degraded". Reading the reason off that sentinel reports a
  // LOST version to the user as "nothing to record here", so the migration
  // classifies the transition itself and only accepts null when it agrees.
  test("a degraded write is counted as failed, not as a no-change entry", async () => {
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    });
    const real = store.appendVersion.bind(store);
    let calls = 0;
    // Call 1 is the origin keyframe; call 2 is the substantive v1→v2
    // transition, which we make degrade.
    store.appendVersion = (args) => {
      calls += 1;
      return calls === 2 ? Promise.resolve(null) : real(args);
    };
    const res = await run(new Map([["b1", doc("v2")]]));

    expect(res.derivedOnly).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.migrated).toBe(0);
  });

  test("a record that already has a v2 log is left alone and its entries are dropped", async () => {
    await store.appendVersion({ recordId: "b1", after: doc("already"), ts: "2026-01-01T00:00:00.000Z" });
    await writeV1({
      b1: [
        { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") },
      ],
    });
    const res = await run(new Map([["b1", doc("v2")]]));
    expect(res.migrated).toBe(0);
    expect(res.dropped).toBe(1);
    const { versions } = await store.listVersions("b1", { limit: 10 });
    expect(versions.map((v) => v.v)).toEqual([1]);
    expect(await store.getVersion("b1", 1)).toEqual(doc("already"));
  });
});

// ─── final review, B6 ───────────────────────────────────────────────────────

describe("the pre-v2 undo copy is never overwritten", () => {
  const v1Entry = { id: "e1", buildId: "b1", timestamp: "2026-09-03T10:00:00.000Z", authorLogin: "me", source: "local", summary: "x", snapshot: doc("v1") };
  const read = (name) => fs.readFile(path.join(dir, name), "utf8");

  // Downgrade to a pre-v2 build, use it, upgrade again: the second migration
  // used to rename the new v1 file straight over the first one's `.pre-v2`,
  // destroying the only copy of the history the user could still go back to.
  test("an existing .pre-v2 survives a second migration", async () => {
    await fs.writeFile(path.join(dir, "build-history.json.pre-v2"), '{"original":true}', "utf8");
    await writeV1({ b1: [v1Entry] });

    const res = await run(new Map([["b1", doc("v2")]]));

    expect(res.retired).toBe(true);
    expect(await read("build-history.json.pre-v2")).toBe('{"original":true}');
    // The new one is kept too, under a name of its own.
    expect(JSON.parse(await read("build-history.json.pre-v2.1"))).toHaveProperty("b1");
    await expect(fs.access(path.join(dir, "build-history.json"))).rejects.toThrow();
  });

  test("a third migration takes the next name again", async () => {
    await fs.writeFile(path.join(dir, "build-history.json.pre-v2"), "one", "utf8");
    await fs.writeFile(path.join(dir, "build-history.json.pre-v2.1"), "two", "utf8");
    await writeV1({ b1: [v1Entry] });

    expect((await run(new Map([["b1", doc("v2")]]))).retired).toBe(true);
    expect(await read("build-history.json.pre-v2")).toBe("one");
    expect(await read("build-history.json.pre-v2.1")).toBe("two");
    expect(JSON.parse(await read("build-history.json.pre-v2.2"))).toHaveProperty("b1");
  });

  // Running as root defeats the permission bit, so this asserts nothing there.
  const asUser = process.getuid && process.getuid() !== 0 ? test : test.skip;
  asUser("a destination it cannot write reports retired:false and leaves the source alone", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    await writeV1({ b1: [v1Entry] });
    await fs.chmod(dir, 0o500);
    try {
      const res = await run(new Map([["b1", doc("v2")]]));
      expect(res.retired).toBe(false);
      await expect(fs.access(path.join(dir, "build-history.json"))).resolves.toBeUndefined();
      expect(err).toHaveBeenCalled();
    } finally {
      await fs.chmod(dir, 0o700);
      err.mockRestore();
    }
  });

  test("with every name taken it reports retired:false and leaves the source alone", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    await fs.writeFile(path.join(dir, "build-history.json.pre-v2"), "0", "utf8");
    for (let i = 1; i <= 32; i += 1) {
      await fs.writeFile(path.join(dir, `build-history.json.pre-v2.${i}`), String(i), "utf8");
    }
    await writeV1({ b1: [v1Entry] });

    const res = await run(new Map([["b1", doc("v2")]]));
    expect(res.retired).toBe(false);
    expect(res.migrated).toBe(1);
    // Nothing clobbered, and the source is still there for the user.
    expect(await read("build-history.json.pre-v2")).toBe("0");
    await expect(fs.access(path.join(dir, "build-history.json"))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
