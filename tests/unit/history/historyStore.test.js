"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");
const { KEYFRAME_INTERVAL } = require("../../../src/main/history/constants");

let dir, store;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");

function build(over = {}) {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior",
    equipment: { statPackage: "Berserker", runes: { head: "Superior Rune of the Scholar" }, slots: {}, weapons: {}, sigils: {}, infusions: {} },
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [], elite: null },
    specializations: [], tags: [], notes: "", folderId: "f1",
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-hstore-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

// Every append gets an explicit clock so coalescing is deterministic.
function at(ms) { return new Date(T0 + ms).toISOString(); }

describe("appendVersion — basics", () => {
  test("the first version is a keyframe carrying the whole doc", async () => {
    const v = await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "local", source: "local", ts: at(0) });
    expect(v).toMatchObject({ v: 1, kind: "key", author: "local", source: "local" });
    expect(v.doc).toEqual(build());
  });

  test("a later version stores ops, not a doc", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({
      recordId: "b1", after: build({ title: "Renamed" }), author: "local", source: "local", ts: at(10 * 60_000),
    });
    expect(v.v).toBe(2);
    expect(v.doc).toBeUndefined();
    expect(v.ops).toEqual([{ t: "field", path: "title", before: "Power Berserker", after: "Renamed" }]);
    expect(v.summary).toBe('title: "Power Berserker" → "Renamed"');
  });

  test("an unchanged save writes nothing and returns null", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({ recordId: "b1", after: build(), ts: at(10 * 60_000) });
    expect(v).toBeNull();
    expect((await store.listVersions("b1")).versions).toHaveLength(1);
  });

  test("a derived-only change writes nothing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const patched = build();
    patched.skills.heal.description = "reworded by a game patch";
    const v = await store.appendVersion({ recordId: "b1", after: patched, ts: at(10 * 60_000) });
    expect(v).toBeNull();
  });

  test("an incidental-only change is logged as kind meta", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({ recordId: "b1", after: build({ folderId: "f2" }), ts: at(10 * 60_000) });
    expect(v).toMatchObject({ kind: "meta" });
    expect(v.summary).toContain("moved to");
  });
});

describe("appendVersion — the store owns its diff base", () => {
  test("a skipped derived-only save does not create a gap in the chain", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });

    const patched = build();
    patched.skills.heal.description = "reworded";
    await store.appendVersion({ recordId: "b1", after: patched, ts: at(10 * 60_000) });   // → null

    // Caller's `before` is now the patched doc, but the log's tail is the original.
    const edited = { ...patched, title: "Renamed" };
    await store.appendVersion({ recordId: "b1", before: patched, after: edited, ts: at(20 * 60_000) });

    expect(await store.getVersion("b1", 2)).toEqual(edited);
  });
});

describe("appendVersion — coalescing", () => {
  test("edits inside the window by the same author merge into one version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(11 * 60_000) });

    const { versions } = await store.listVersions("b1");
    expect(versions).toHaveLength(2);
    expect(versions[0].v).toBe(2);
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "B" }));
  });

  test("edits outside the window stay separate", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(30 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("a different author breaks coalescing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "teammate", source: "local", ts: at(11 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("a different source breaks coalescing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "team-sync", ts: at(11 * 60_000) });
    expect((await store.listVersions("b1")).versions).toHaveLength(3);
  });

  test("coalescing never swallows the first version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(60_000) });
    const { versions } = await store.listVersions("b1");
    expect(versions.map((x) => x.v)).toEqual([2, 1]);
    expect(await store.getVersion("b1", 1)).toEqual(build());
  });
});

describe("keyframes and reconstruction", () => {
  test(`every ${KEYFRAME_INTERVAL}th version is a keyframe`, async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < KEYFRAME_INTERVAL * 2; i++) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `t${i}` }),
        author: "me", source: "local", ts: at((i + 1) * 60 * 60_000),   // an hour apart: never coalesces
      });
    }
    const { versions } = await store.listVersions("b1", { limit: 100 });
    const keyframes = versions.filter((x) => x.kind === "key").map((x) => x.v).sort((a, b) => a - b);
    expect(keyframes).toEqual([1, KEYFRAME_INTERVAL + 1]);
  });

  test("every version reconstructs exactly", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < 45; i++) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `t${i}` }),
        author: "me", source: "local", ts: at((i + 1) * 60 * 60_000),
      });
    }
    for (let i = 0; i < 45; i++) {
      expect(await store.getVersion("b1", i + 1)).toEqual(build({ title: `t${i}` }));
    }
  });

  test("getVersion on a missing version is null", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    expect(await store.getVersion("b1", 99)).toBeNull();
    expect(await store.getVersion("nope", 1)).toBeNull();
  });
});

describe("listVersions and listTails", () => {
  test("listVersions is newest-first and paginates", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i < 10; i++) {
      await store.appendVersion({ recordId: "b1", after: build({ title: `t${i}` }), author: "me", source: "local", ts: at((i + 1) * 60 * 60_000) });
    }
    const first = await store.listVersions("b1", { limit: 4 });
    expect(first.versions.map((x) => x.v)).toEqual([10, 9, 8, 7]);
    const second = await store.listVersions("b1", { limit: 4, cursor: first.nextCursor });
    expect(second.versions.map((x) => x.v)).toEqual([6, 5, 4, 3]);
  });

  test("listTails merges records newest-first and tags each with its record id", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ id: "b1" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b2", before: null, after: build({ id: "b2" }), author: "me", source: "local", ts: at(60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ id: "b1", title: "Renamed" }), author: "me", source: "local", ts: at(120 * 60_000) });

    const feed = await store.listTails(["b1", "b2"], 10);
    expect(feed.map((x) => x.recordId)).toEqual(["b1", "b2", "b1"]);
  });

  test("listTails ignores record ids with no history", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    expect(await store.listTails(["b1", "ghost"], 10)).toHaveLength(1);
  });
});

describe("deleteHistory", () => {
  test("removes the record's log", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.deleteHistory("b1");
    expect((await store.listVersions("b1")).versions).toEqual([]);
  });
});

describe("concurrency", () => {
  test("parallel appends to one record do not drop versions", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    await Promise.all([1, 2, 3, 4, 5].map((i) => store.appendVersion({
      recordId: "b1", after: build({ title: `t${i}` }),
      author: `author${i}`, source: "local", ts: at((i + 1) * 60 * 60_000),
    })));
    const { versions } = await store.listVersions("b1", { limit: 50 });
    expect(versions.map((x) => x.v)).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

// The store must not read the clock: `ts` is injected so a version's time is
// the caller's save time (a team-sync pull replays a teammate's edit) and so
// coalescing is testable without faking timers.
describe("the clock is injected, never read", () => {
  test("appendVersion reads the clock in no form at all", async () => {
    // Spying on Date.now alone is not enough: `new Date()` does not route
    // through it, so a store defaulting its own timestamp that way would pass
    // a Date.now-only assertion trivially.
    const RealDate = global.Date;
    const reads = [];
    class GuardedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) reads.push("new Date()");
        super(...args);
      }
      static now() { reads.push("Date.now()"); return RealDate.now(); }
    }
    const t0 = at(0);
    const t1 = at(10 * 60_000);
    global.Date = GuardedDate;
    try {
      await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: t0 });
      await store.appendVersion({ recordId: "b1", after: build({ title: "Renamed" }), ts: t1 });
    } finally {
      global.Date = RealDate;
    }
    expect(reads).toEqual([]);
  });

  test("the injected ts is what lands on the version", async () => {
    const v = await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    expect(v.ts).toBe(at(0));
  });
});

describe("robustness", () => {
  test("a record id outside the safe charset never escapes the history directory", async () => {
    await store.appendVersion({ recordId: "../../escape", before: null, after: build(), ts: at(0) });
    const names = await fs.readdir(path.join(dir, "history", "builds"));
    expect(names).toEqual([expect.stringMatching(/^[0-9a-f]{40}\.jsonl$/)]);
    expect(await store.getVersion("../../escape", 1)).toEqual(build());
  });

  test("appendVersion returns null instead of throwing when the log cannot be written", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    // A doc that cannot be serialised: the append must degrade, not reject.
    const cyclic = build();
    cyclic.self = cyclic;
    await expect(store.appendVersion({ recordId: "b1", after: cyclic, ts: at(10 * 60_000) })).resolves.toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test("a delete is always recorded, always as a keyframe, even when nothing else changed", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const v = await store.appendVersion({ recordId: "b1", after: build(), kind: "delete", ts: at(10 * 60_000) });
    expect(v).toMatchObject({ v: 2, kind: "delete", summary: "Deleted" });
    expect(v.doc).toEqual(build());
  });
});

// ─── fix round 1 ────────────────────────────────────────────────────────────

describe("coalescing an edit that undoes itself", () => {
  test("a rename and a rename back inside the window leaves no version behind", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Typo" }), author: "me", source: "local", ts: at(10 * 60_000) });

    // Fixing the typo puts the document back exactly where version 1 left it,
    // so version 2 has nothing left to say. Rewriting it with an empty patch
    // would leave a blank row in the panel, mislabelled as bookkeeping.
    const v = await store.appendVersion({ recordId: "b1", after: build(), author: "me", source: "local", ts: at(11 * 60_000) });

    expect(v).toBeNull();
    const { versions } = await store.listVersions("b1");
    expect(versions.map((x) => x.v)).toEqual([1]);
    expect(await store.getVersion("b1", 1)).toEqual(build());
  });

  test("no blank, mislabelled version is ever written", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ notes: "oops" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build(), author: "me", source: "local", ts: at(11 * 60_000) });

    const { versions } = await store.listVersions("b1");
    expect(versions.every((x) => x.summary !== "")).toBe(true);
    expect(versions.some((x) => x.kind === "meta")).toBe(false);
  });

  test("the log keeps working after the removal", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Typo" }), author: "me", source: "local", ts: at(10 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build(), author: "me", source: "local", ts: at(11 * 60_000) });

    // The next real edit takes v2 again, and reconstructs from the keyframe
    // that is still v1 — a stale offset would have appended past a dead line.
    const v = await store.appendVersion({ recordId: "b1", after: build({ title: "Renamed" }), author: "me", source: "local", ts: at(60 * 60_000) });
    expect(v.v).toBe(2);
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "Renamed" }));
    expect(await store.getVersion("b1", 1)).toEqual(build());
  });

  test("an undo OUTSIDE the window is a version of its own, not a removal", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Typo" }), author: "me", source: "local", ts: at(10 * 60_000) });
    const v = await store.appendVersion({ recordId: "b1", after: build(), author: "me", source: "local", ts: at(60 * 60_000) });
    expect(v.v).toBe(3);
    expect((await store.listVersions("b1")).versions.map((x) => x.v)).toEqual([3, 2, 1]);
  });
});

describe("the returned version does not alias the caller's document", () => {
  test("mutating `after` afterwards does not rewrite the returned version", async () => {
    const after = build();
    const v = await store.appendVersion({ recordId: "b1", before: null, after, ts: at(0) });
    after.title = "mutated by the caller";
    expect(v.doc.title).toBe("Power Berserker");
    expect(await store.getVersion("b1", 1)).toEqual(build());
  });

  // The v1 branch above and the keyframe branch here are two separate
  // assignment sites; only one of them was cloned on the first pass.
  test("a delete keyframe does not alias the caller's document either", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const after = build({ title: "About to go" });
    const v = await store.appendVersion({ recordId: "b1", after, kind: "delete", ts: at(10 * 60_000) });
    after.title = "mutated by the caller";
    expect(v.doc.title).toBe("About to go");
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "About to go" }));
  });

  test("coalescing into a keyframe does not alias the caller's document either", async () => {
    // v21 is a keyframe, so coalescing into it rewrites a whole doc.
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "t0" }), author: "me", source: "local", ts: at(0) });
    for (let i = 1; i <= KEYFRAME_INTERVAL; i += 1) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `t${i}` }),
        author: "me", source: "local", ts: at((i + 1) * 60 * 60_000),
      });
    }
    const keyframe = (await store.listVersions("b1", { limit: 100 })).versions[0];
    expect(keyframe).toMatchObject({ v: KEYFRAME_INTERVAL + 1, kind: "key" });

    const after = build({ title: "coalesced" });
    const v = await store.appendVersion({
      recordId: "b1", after, author: "me", source: "local",
      ts: at((KEYFRAME_INTERVAL + 1) * 60 * 60_000 + 60_000),
    });
    after.title = "mutated by the caller";
    expect(v).toMatchObject({ v: KEYFRAME_INTERVAL + 1, kind: "key" });
    expect(v.doc.title).toBe("coalesced");
    expect(await store.getVersion("b1", KEYFRAME_INTERVAL + 1)).toEqual(build({ title: "coalesced" }));
  });
});
