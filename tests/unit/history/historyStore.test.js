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

// ─── fix round 2 (final review) ─────────────────────────────────────────────

// Corrupt the line carrying version `v` in place, leaving every other line
// byte-identical. A truncated JSON fragment is what a partial write leaves
// behind mid-file.
async function corruptVersion(recordId, v) {
  const file = path.join(dir, "history", "builds", `${recordId}.jsonl`);
  const lines = (await fs.readFile(file, "utf8")).split("\n");
  const i = lines.findIndex((l) => l && JSON.parse(l).v === v);
  lines[i] = lines[i].slice(0, Math.floor(lines[i].length / 2));
  await fs.writeFile(file, lines.join("\n"));
}

describe("A1 — reconstruction never blends two eras", () => {
  async function chain() {
    // v1 keyframe, then one field per version so a blend is visible.
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A", notes: "n1" }), author: "me", source: "local", ts: at(60 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "A", notes: "n2" }), author: "me", source: "local", ts: at(2 * 60 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "D", notes: "n2" }), author: "me", source: "local", ts: at(3 * 60 * 60_000) });
    expect((await store.listVersions("b1")).versions.map((x) => x.v)).toEqual([4, 3, 2, 1]);
  }

  test("a version past a gap in the chain returns null instead of a blend", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    await chain();
    await corruptVersion("b1", 3);

    expect(await store.getVersion("b1", 4)).toBeNull();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("getVersion"),
      expect.anything(),
    );
    expect(err.mock.calls.some((c) => String(c[0]).includes("b1@4"))).toBe(true);
    err.mockRestore();
  });

  test("versions BEFORE the gap still reconstruct — the whole log is not thrown away", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await chain();
    await corruptVersion("b1", 3);

    expect(await store.getVersion("b1", 1)).toEqual(build({ title: "A" }));
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "A", notes: "n1" }));
    console.error.mockRestore();
  });

  test("an intact log still reconstructs every version", async () => {
    await chain();
    expect(await store.getVersion("b1", 3)).toEqual(build({ title: "A", notes: "n2" }));
    expect(await store.getVersion("b1", 4)).toEqual(build({ title: "D", notes: "n2" }));
  });
});

describe("A2 — a record that has lost its base heals itself", () => {
  async function chainOfFive() {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "T1" }), author: "me", source: "local", ts: at(0) });
    for (let i = 2; i <= 5; i += 1) {
      await store.appendVersion({ recordId: "b1", after: build({ title: `T${i}` }), author: "me", source: "local", ts: at(i * 60 * 60_000) });
    }
    expect((await store.listVersions("b1")).versions.map((x) => x.v)).toEqual([5, 4, 3, 2, 1]);
  }

  test("the k < 0 guard: no keyframe at or before the target reconstructs to null, not a throw", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    await chainOfFive();
    await corruptVersion("b1", 1);
    await expect(store.getVersion("b1", 5)).resolves.toBeNull();
    expect(err.mock.calls.some((c) => String(c[1]).includes("no keyframe"))).toBe(true);
    err.mockRestore();
  });

  // A fresh store, the way the app meets a log damaged between runs: nothing is
  // memoized, so the damage is discovered by reading.
  async function reopen() {
    const next = new BuildHistoryStore(dir);
    await next.init();
    return next;
  }

  test("the next write after a lost keyframe is a keyframe and reconstructs", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await chainOfFive();
    await corruptVersion("b1", 1);
    store = await reopen();

    const v6 = await store.appendVersion({ recordId: "b1", after: build({ title: "T9" }), author: "me", source: "local", ts: at(9 * 60 * 60_000) });
    expect(v6).toMatchObject({ v: 6 });
    expect(v6.doc).toEqual(build({ title: "T9" }));
    expect(await store.getVersion("b1", 6)).toEqual(build({ title: "T9" }));
    console.error.mockRestore();
  });

  test("the healing version does not claim the record was just created", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await chainOfFive();
    await corruptVersion("b1", 1);
    store = await reopen();

    const v6 = await store.appendVersion({ recordId: "b1", after: build({ title: "T9" }), author: "me", source: "local", ts: at(9 * 60 * 60_000) });
    // The store cannot know what changed — its base is gone. Anything it names
    // is a guess, and every field but `title` is unchanged since v5.
    expect(v6.summary).toBeTruthy();
    expect(v6.summary).not.toContain("(none)");
    expect(v6.summary).not.toMatch(/profession|equipment|skills|specializations/);
    console.error.mockRestore();
  });
});

describe("A3 — the coalescing window is two-sided", () => {
  test("a backwards clock step does not merge into, and overwrite, an old version", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    const v2 = await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });
    expect(v2.summary).toBe('title: "A" → "B"');

    // NTP correction / DST / VM resume: the next save's clock reads three hours
    // EARLIER than the version before it. dt is -3h, which is <= the window.
    const v3 = await store.appendVersion({
      recordId: "b1", after: build({ title: "C" }), author: "me", source: "local",
      ts: at(60 * 60_000 - 3 * 60 * 60_000),
    });

    expect(v3.v).toBe(3);
    expect((await store.listVersions("b1")).versions.map((x) => x.v)).toEqual([3, 2, 1]);
    // The version the backwards step landed on must survive intact.
    const stored = (await store.listVersions("b1")).versions.find((x) => x.v === 2);
    expect(stored.summary).toBe('title: "A" → "B"');
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "B" }));
    expect(await store.getVersion("b1", 3)).toEqual(build({ title: "C" }));
  });

  test("a forwards step inside the window still coalesces", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });
    const merged = await store.appendVersion({ recordId: "b1", after: build({ title: "C" }), author: "me", source: "local", ts: at(60 * 60_000 + 60_000) });
    expect(merged.v).toBe(2);
  });
});

describe("A4 — a save does not re-read the whole log", () => {
  // `getVersion` is the reconstruct path: it does a full `readAll`, which the
  // reviewer measured at 186 ms per save on a 1.48 MB comp at v60.
  async function twoVersions() {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });
  }

  test("consecutive saves never re-enter reconstruction", async () => {
    await twoVersions();
    const spy = jest.spyOn(store, "getVersion");
    await store.appendVersion({ recordId: "b1", after: build({ title: "C" }), author: "me", source: "local", ts: at(2 * 60 * 60_000) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "D" }), author: "me", source: "local", ts: at(3 * 60 * 60_000) });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(await store.getVersion("b1", 4)).toEqual(build({ title: "D" }));
  });

  test("a coalescing burst reconstructs at most once, not twice per save", async () => {
    await twoVersions();
    const spy = jest.spyOn(store, "getVersion");
    for (let i = 1; i <= 4; i += 1) {
      await store.appendVersion({
        recordId: "b1", after: build({ title: `C${i}` }), author: "me", source: "local",
        ts: at(60 * 60_000 + i * 60_000),
      });
    }
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
    expect((await store.listVersions("b1")).versions.map((x) => x.v)).toEqual([2, 1]);
    expect(await store.getVersion("b1", 2)).toEqual(build({ title: "C4" }));
  });
});

describe("A4 — the memo cannot go stale", () => {
  test("deleteHistory is seen: the next save starts a new keyframe chain", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });
    await store.deleteHistory("b1");

    const v = await store.appendVersion({ recordId: "b1", after: build({ title: "C" }), author: "me", source: "local", ts: at(2 * 60 * 60_000) });
    expect(v).toMatchObject({ v: 1, kind: "key" });
    expect(v.doc).toEqual(build({ title: "C" }));
    expect(await store.getVersion("b1", 1)).toEqual(build({ title: "C" }));
  });

  test("a removed (self-undone) version is seen: the next save diffs against what survived", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });
    // Undo inside the window: v2 is REMOVED, and the tail is v1 ("A") again.
    await store.appendVersion({ recordId: "b1", after: build({ title: "A" }), author: "me", source: "local", ts: at(60 * 60_000 + 60_000) });

    const v = await store.appendVersion({ recordId: "b1", after: build({ title: "C" }), author: "me", source: "local", ts: at(5 * 60 * 60_000) });
    expect(v.v).toBe(2);
    expect(v.summary).toBe('title: "A" → "C"');
    expect(v.ops).toEqual([{ t: "field", path: "title", before: "A", after: "C" }]);
  });

  test("a write that did not come through this store is seen", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });

    // Someone else rewrote the tail entry: same version, different content.
    const file = path.join(dir, "history", "builds", "b1.jsonl");
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    const tail = JSON.parse(lines[lines.length - 1]);
    tail.ops = [{ t: "field", path: "title", before: "A", after: "Z" }];
    tail.summary = 'title: "A" → "Z"';
    lines[lines.length - 1] = JSON.stringify(tail);
    await fs.writeFile(file, `${lines.join("\n")}\n`);

    const v = await store.appendVersion({ recordId: "b1", after: build({ title: "Q" }), author: "me", source: "local", ts: at(5 * 60 * 60_000) });
    expect(v.ops).toEqual([{ t: "field", path: "title", before: "Z", after: "Q" }]);
  });

  test("a tail rewrite that changes ONLY ops — v, ts, author, source, kind, and summary all left untouched — is still seen", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build({ title: "A" }), author: "me", source: "local", ts: at(0) });
    // This append also warms the memo for v2 (base doc "B") via #write's `memo` seeding.
    await store.appendVersion({ recordId: "b1", after: build({ title: "B" }), author: "me", source: "local", ts: at(60 * 60_000) });

    // Rewrite the tail's `ops` out of band, but preserve every field the old
    // fingerprint checked — v, ts, author, source, kind, summary — so the
    // pre-fix fingerprint sees no change at all and keeps serving the memo
    // that was warmed against the ORIGINAL ops.
    const file = path.join(dir, "history", "builds", "b1.jsonl");
    const lines = (await fs.readFile(file, "utf8")).trim().split("\n");
    const tail = JSON.parse(lines[lines.length - 1]);
    expect(tail.summary).toBe('title: "A" → "B"'); // unchanged below — proves isolation
    tail.ops = [{ t: "field", path: "title", before: "A", after: "Z" }];
    lines[lines.length - 1] = JSON.stringify(tail);
    await fs.writeFile(file, `${lines.join("\n")}\n`);

    // The next save diffs against the reconstructed tail document. If the
    // stale memo (base doc "B") is served, the diff is computed against a
    // document this record never actually held on disk.
    const v = await store.appendVersion({ recordId: "b1", after: build({ title: "Q" }), author: "me", source: "local", ts: at(5 * 60 * 60_000) });
    expect(v.ops).toEqual([{ t: "field", path: "title", before: "Z", after: "Q" }]);
  });
});
