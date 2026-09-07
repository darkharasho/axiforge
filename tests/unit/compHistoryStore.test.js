"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { CompHistoryStore, _memberIds } = require("../../src/main/compHistoryStore");

// Comps had no history at all. A build carried a full record of who changed
// what; the comp those builds sit in — the thing a squad argues over, and the
// thing one drag can restructure — carried nothing.
//
// The storage half is exercised in tests/unit/history/historyStore.test.js.
// What is left here is what is specific to COMPS: where its logs land, and the
// slot-level diffing that replaced `summarizeCompChange`. The old
// `summarizeCompChange` block is gone with the function: it compared whole
// sub-objects with JSON.stringify and could only ever say "party layout
// changed", where the differ names the party, the slot, and the build on each
// side.

let dir;
let store;

const titleOf = (id) => ({ b1: "Heal Druid", b2: "Firebrand", b3: "Scourge" }[id]);

function comp(over = {}) {
  return {
    id: "c1",
    name: "Squad",
    gameMode: "wvw",
    buildIds: ["b1", "b2"],
    partyLines: [{ id: "l1", capacity: 5, slots: ["b1", "b2"] }],
    categories: [],
    buildColors: {},
    notes: "",
    tags: [],
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-comphist-"));
  store = new CompHistoryStore(dir, { buildNameOf: titleOf });
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("CompHistoryStore", () => {
  test("keeps its logs apart from the build history", async () => {
    // A shared file would key comps and builds into the same map and a purge of
    // one would take the other.
    await store.appendVersion({ recordId: "c1", before: null, after: comp() });
    expect(await fs.readdir(path.join(dir, "history", "comps"))).toEqual(["c1.jsonl"]);
    await expect(fs.readdir(path.join(dir, "history", "builds"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("records the author and the source", async () => {
    const v = await store.appendVersion({
      recordId: "c1", before: null, after: comp(), author: "iruixos", source: "team-sync",
    });
    expect(v).toMatchObject({ v: 1, kind: "key", author: "iruixos", source: "team-sync", recordId: "c1" });
    expect(v.doc).toEqual(comp());
  });

  test("keeps every version — there is no cap", async () => {
    await store.appendVersion({ recordId: "c1", before: null, after: comp({ name: "n0" }) });
    for (let i = 1; i < 60; i += 1) {
      await store.appendVersion({
        recordId: "c1", after: comp({ name: `n${i}` }), author: `a${i}`,
      });
    }
    const { versions } = await store.listVersions("c1", { limit: 200 });
    expect(versions).toHaveLength(60);
    expect(await store.getVersion("c1", 30)).toEqual(comp({ name: "n29" }));
  });

  test("deleting one comp's history leaves the others alone", async () => {
    await store.appendVersion({ recordId: "c1", before: null, after: comp() });
    await store.appendVersion({ recordId: "c2", before: null, after: comp({ id: "c2" }) });
    await store.deleteHistory("c1");
    expect((await store.listVersions("c1")).versions).toEqual([]);
    expect((await store.listVersions("c2")).versions).toHaveLength(1);
  });

  test("concurrent appends do not drop versions", async () => {
    await store.appendVersion({ recordId: "c1", before: null, after: comp({ name: "n0" }) });
    await Promise.all(Array.from({ length: 12 }, (_, i) =>
      store.appendVersion({ recordId: "c1", after: comp({ name: `n${i + 1}` }), author: `a${i}` })));
    expect((await store.listVersions("c1", { limit: 50 })).versions).toHaveLength(13);
  });
});

describe("CompHistoryStore — what a comp change reads as", () => {
  async function change(mutate, { author = "me" } = {}) {
    await store.appendVersion({ recordId: "c1", before: null, after: comp(), author });
    const after = comp();
    mutate(after);
    return store.appendVersion({ recordId: "c1", after, author: `${author}-2` });
  }

  test("a slot swap names the party, the slot, and both builds", async () => {
    const v = await change((c) => { c.partyLines[0].slots[1] = "b3"; c.buildIds = ["b1", "b3"]; });
    expect(v.summary).toContain("party 1 slot 2: Firebrand → Scourge");
  });

  test("a build moved to a second party is two slot moves, each named", async () => {
    const v = await change((c) => {
      c.partyLines = [
        { id: "l1", capacity: 5, slots: ["b1"] },
        { id: "l2", capacity: 5, slots: ["b2"] },
      ];
    });
    expect(v.summary).toContain("party 1 slot 2: Firebrand → (none)");
    expect(v.summary).toContain("party 2");
  });

  test("a category slot reads as the category it reserves, not as a build", async () => {
    const v = await change((c) => { c.partyLines[0].slots[2] = "tag:cat-1"; });
    expect(v.summary).toBe("party 1 slot 3: (none) → any cat-1");
  });

  test("a rename and a game-mode switch read in the same terms as before", async () => {
    const v = await change((c) => { c.name = "Squad v2"; c.gameMode = "pve"; });
    expect(v.summary).toContain('name: "Squad" → "Squad v2"');
    expect(v.summary).toContain("game mode: wvw → pve");
  });

  test("every change is listed, not just the first", async () => {
    const v = await change((c) => { c.name = "Renamed"; c.notes = "hi"; c.tags = ["wvw"]; });
    expect(v.summary).toContain("name:");
    expect(v.summary).toContain("notes updated");
    expect(v.summary).toContain("tags updated");
  });

  test("a folder move is bookkeeping, logged but not an edit", async () => {
    const v = await change((c) => { c.folderId = "f2"; });
    expect(v).toMatchObject({ kind: "meta" });
    expect(v.summary).toBe("moved to another folder");
  });

  test("reordering the comp library writes nothing at all", async () => {
    expect(await change((c) => { c.sortOrder = 9; c.pinned = true; })).toBeNull();
  });

  test("a save that changed nothing writes nothing", async () => {
    expect(await change(() => {})).toBeNull();
  });

  test("a slot swap does not carry the whole comp — the patch is the change", async () => {
    // A saved comp is a couple of megabytes of embedded build data. The diff
    // must not walk into it, or a slot swap costs a full snapshot.
    const fat = comp({ partyLines: [{ id: "l1", capacity: 5, slots: [{ id: "b1", title: "Heal Druid", equipment: { blob: "x".repeat(5000) } }, "b2"] }] });
    await store.appendVersion({ recordId: "c1", before: null, after: fat });
    const after = structuredClone(fat);
    after.partyLines[0].slots[1] = "b3";
    const v = await store.appendVersion({ recordId: "c1", after, author: "someone-else" });
    expect(v.ops).toEqual([{ t: "slot", line: 0, index: 1, before: "b2", after: "b3" }]);
    expect(JSON.stringify(v.ops).length).toBeLessThan(200);
  });
});

describe("_memberIds", () => {
  test("counts a build referenced only by a slot as a member", () => {
    expect([..._memberIds({ buildIds: ["b1"], partyLines: [{ slots: ["b1", "b2"] }] })])
      .toEqual(["b1", "b2"]);
  });

  test("ignores tag slots, which name a category rather than a build", () => {
    expect([..._memberIds({ buildIds: [], partyLines: [{ slots: ["b1", "tag:cat-1", null] }] })])
      .toEqual(["b1"]);
  });

  test("an empty comp has no members", () => {
    expect([..._memberIds({})]).toEqual([]);
    expect([..._memberIds(null)]).toEqual([]);
  });
});
