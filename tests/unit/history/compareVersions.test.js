"use strict";

/**
 * `history:compare` — a TRUE diff between any two versions.
 *
 * The renderer's first cut assembled this by concatenating the ops of every
 * version in the range. That is a union of edits, not a diff, and the first
 * test below is the case it gets wrong: a value that changes and changes BACK
 * must report as unchanged across the span.
 */

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildHistoryStore } = require("../../../src/main/buildHistoryStore");
const { compareVersions } = require("../../../src/main/history/compareVersions");
const { renderSummary } = require("../../../src/main/history/renderSummary");
const diffBuild = require("../../../src/main/history/diffBuild");

let dir, store;
const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const at = (m) => new Date(T0 + m * 60_000).toISOString();

function build(over = {}) {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior", folderId: "f1",
    specializations: [], tags: [], notes: "",
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [], elite: null },
    equipment: {
      statPackage: "Berserker", slots: {}, weapons: {},
      runes: { head: "Superior Rune of the Scholar" }, sigils: {}, infusions: {},
    },
    ...over,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-compare-"));
  store = new BuildHistoryStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const compare = (fromV, toV, summaryOpts) => compareVersions({
  store, differ: diffBuild, recordId: "b1", fromV, toV, summaryOpts,
});

describe("compareVersions", () => {
  test("a value that changes and changes back reports as unchanged across the span", async () => {
    // Coalescing is off the table here: the three appends are 30 minutes apart.
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Renamed" }), ts: at(30) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Power Berserker" }), ts: at(60) });

    // Each individual version DID change the title — this is exactly the churn
    // the old union-of-ops approach reported as two rows.
    const { ops } = await compare(1, 3);
    expect(ops).toEqual([]);
  });

  test("reports the net change, not the intermediate steps", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Middle" }), ts: at(30) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Final" }), ts: at(60) });

    const { ops } = await compare(1, 3);
    expect(ops).toEqual([
      { t: "field", path: "title", before: "Power Berserker", after: "Final", label: 'title: "Power Berserker" → "Final"' },
    ]);
  });

  test("hands back both reconstructed documents", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ title: "Renamed" }), ts: at(30) });

    const { fromDoc, toDoc } = await compare(1, 2);
    expect(fromDoc.title).toBe("Power Berserker");
    expect(toDoc.title).toBe("Renamed");
  });

  test("a missing version degrades to empty ops rather than throwing", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });

    const res = await compare(1, 99);
    expect(res.ops).toEqual([]);
    expect(res.toDoc).toBeNull();
    // The side that DID reconstruct still comes back, so the modal can show it.
    expect(res.fromDoc.title).toBe("Power Berserker");

    await expect(compare(99, 1)).resolves.toMatchObject({ ops: [], fromDoc: null });
  });

  test("derived ops never reach the table", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const patched = build();
    patched.skills.heal.description = "reworded by a game patch";
    patched.title = "Renamed";
    await store.appendVersion({ recordId: "b1", after: patched, ts: at(30) });

    const { ops } = await compare(1, 2);
    expect(ops.map((o) => o.t)).toEqual(["field"]);
  });

  test("a folder move reads the same way in the compare table as in the entry list", async () => {
    // The drift this fix exists to kill: the entry list rendered "moved to
    // another folder" (renderSummary) while the compare table rendered its own
    // "folder: f1 → f2". Both now come from renderOpDetail.
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    const moved = await store.appendVersion({ recordId: "b1", after: build({ folderId: "f2" }), ts: at(30) });

    const { ops } = await compare(1, 2);
    expect(ops).toHaveLength(1);
    expect(ops[0].label).toBe(moved.summary);
    expect(ops[0].label).toBe("moved to another folder");
  });

  test("the folder name resolver reaches the label, so both sides can name the folder", async () => {
    await store.appendVersion({ recordId: "b1", before: null, after: build(), ts: at(0) });
    await store.appendVersion({ recordId: "b1", after: build({ folderId: "f2" }), ts: at(30) });

    const opts = { folderNameOf: (id) => (id === "f2" ? "Raids" : undefined) };
    const { ops } = await compare(1, 2, opts);
    expect(ops[0].label).toBe("moved to Raids");
    // …and it is the same string renderSummary would produce for that op.
    expect(ops[0].label).toBe(renderSummary([{ t: "meta", path: "folderId", before: "f1", after: "f2" }], opts));
  });
});
