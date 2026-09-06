"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { CompHistoryStore, summarizeCompChange } = require("../../src/main/compHistoryStore");

// Comps had no history at all. A build carried a full record of who changed
// what; the comp those builds sit in — the thing a squad argues over, and the
// thing one drag can restructure — carried nothing.

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-comphist-"));
  store = new CompHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("CompHistoryStore", () => {
  test("keeps its entries apart from the build history file", async () => {
    // Same storage logic, different file — a shared file would key comps and
    // builds into the same map and a purge of one would take the other.
    expect(path.basename(store.historyPath)).toBe("comp-history.json");
    await store.addEntry({ compId: "c1", summary: "x", snapshot: { id: "c1" } });
    expect(await fs.readdir(dir)).toContain("comp-history.json");
  });

  test("stamps entries with compId, not buildId", async () => {
    const entry = await store.addEntry({ compId: "c1", summary: "x", snapshot: { id: "c1" } });
    expect(entry.compId).toBe("c1");
    expect(entry.buildId).toBeUndefined();
  });

  test("newest first, so the most recent entry is never the one that ages out", async () => {
    await store.addEntry({ compId: "c1", summary: "first", snapshot: {} });
    await store.addEntry({ compId: "c1", summary: "second", snapshot: {} });
    const entries = await store.getHistory("c1");
    expect(entries.map((e) => e.summary)).toEqual(["second", "first"]);
  });

  test("caps at 50 by trimming the tail", async () => {
    for (let i = 0; i < 55; i++) {
      await store.addEntry({ compId: "c1", summary: `edit ${i}`, snapshot: {} });
    }
    const entries = await store.getHistory("c1");
    expect(entries).toHaveLength(50);
    expect(entries[0].summary).toBe("edit 54");
    expect(entries[49].summary).toBe("edit 5");
  });

  test("deleteHistory drops one comp and leaves the others", async () => {
    await store.addEntry({ compId: "c1", summary: "a", snapshot: {} });
    await store.addEntry({ compId: "c2", summary: "b", snapshot: {} });
    await store.deleteHistory("c1");
    expect(await store.getHistory("c1")).toEqual([]);
    expect(await store.getHistory("c2")).toHaveLength(1);
  });

  test("concurrent writes do not drop each other", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.addEntry({ compId: "c1", summary: `e${i}`, snapshot: {} }))
    );
    expect(await store.getHistory("c1")).toHaveLength(12);
  });
});

describe("summarizeCompChange", () => {
  const base = {
    name: "Squad",
    gameMode: "wvw",
    buildIds: ["b1", "b2"],
    partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }],
    categories: [],
    buildColors: {},
    notes: "",
    tags: [],
  };
  const titleOf = (id) => ({ b1: "Heal Druid", b2: "Firebrand", b3: "Scourge" }[id]);

  test("a comp with no previous version reads as created", () => {
    expect(summarizeCompChange(null, base)).toBe("comp created");
  });

  test("names the builds that arrived and left, rather than counting them", () => {
    // "party lines changed" tells a teammate nothing they could act on.
    const after = { ...base, buildIds: ["b1", "b3"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b3"] }] };
    const summary = summarizeCompChange(base, after, titleOf);
    expect(summary).toContain("added Scourge");
    expect(summary).toContain("removed Firebrand");
  });

  test("falls back to counts when no titles are available", () => {
    const after = { ...base, buildIds: ["b1"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1"] }] };
    expect(summarizeCompChange(base, after)).toContain("removed 1 build");
  });

  test("a build moved between parties is a layout change, not a membership one", () => {
    const after = {
      ...base,
      partyLines: [
        { id: "l1", capacity: 5, slots: ["b1"] },
        { id: "l2", capacity: 5, slots: ["b2"] },
      ],
    };
    const summary = summarizeCompChange(base, after, titleOf);
    expect(summary).toContain("parties: 1 → 2");
    expect(summary).not.toContain("removed");
    expect(summary).not.toContain("added");
  });

  test("a reorder inside one party still says something", () => {
    const after = { ...base, partyLines: [{ id: "l1", capacity: 5, slots: ["b2", "b1"] }] };
    expect(summarizeCompChange(base, after, titleOf)).toBe("party layout changed");
  });

  test("counts a build referenced only by a slot as a member", () => {
    // buildIds and the slots can disagree; the summary must not report a build
    // as removed just because it dropped out of one of the two lists.
    const before = { ...base, buildIds: ["b1"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }] };
    const after = { ...base, buildIds: ["b1", "b2"], partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }] };
    expect(summarizeCompChange(before, after, titleOf)).toBe("comp updated");
  });

  test("ignores tag slots, which name a category rather than a build", () => {
    const before = { ...base, partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }] };
    const after = { ...base, partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2", "tag:cat-1"] }] };
    const summary = summarizeCompChange(before, after, titleOf);
    expect(summary).not.toContain("added");
    expect(summary).toBe("party layout changed");
  });

  test("reports a rename and a game-mode switch in readable terms", () => {
    const after = { ...base, name: "Squad v2", gameMode: "pve" };
    const summary = summarizeCompChange(base, after, titleOf);
    expect(summary).toContain('name: "Squad" → "Squad v2"');
    expect(summary).toContain("game mode: WvW → PvE");
  });

  test("lists every change, not just the first", () => {
    const after = { ...base, name: "Renamed", notes: "hi", tags: ["wvw"] };
    const summary = summarizeCompChange(base, after, titleOf);
    expect(summary).toContain("name:");
    expect(summary).toContain("notes updated");
    expect(summary).toContain("tags changed");
  });
});
