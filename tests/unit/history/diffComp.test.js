"use strict";

const { diff, applyOps, invert, classify } = require("../../../src/main/history/diffComp");

function comp(over = {}) {
  return {
    id: "c1",
    name: "Zerg",
    notes: "",
    tags: ["wvw"],
    gameMode: "wvw",
    folderId: "f1",
    buildIds: ["b1", "b2"],
    partyLines: [
      { id: "l1", capacity: 5, slots: ["b1", "b2", null, null, null] },
      { id: "l2", capacity: 5, slots: ["tag:heal", null, null, null, null] },
    ],
    ...over,
  };
}

// `updatedAt`/`version` change on every save; a diff that reported them would
// write a version for every save and defeat the zero-ops rule.
function withoutBookkeeping(doc) {
  const { updatedAt, version, ...rest } = doc;
  return rest;
}

describe("diffComp — slots", () => {
  test("a slot swap is one small op naming the party and the index", () => {
    const after = comp();
    after.partyLines[0].slots[1] = "b9";
    expect(diff(comp(), after)).toEqual([
      { t: "slot", line: 0, index: 1, before: "b2", after: "b9" },
    ]);
  });

  test("a category slot is a slot op like any other", () => {
    const after = comp();
    after.partyLines[1].slots[0] = "tag:dps";
    expect(diff(comp(), after)).toEqual([
      { t: "slot", line: 1, index: 0, before: "tag:heal", after: "tag:dps" },
    ]);
  });

  test("it does not recurse into an embedded build object", () => {
    const before = comp({ partyLines: [{ id: "l1", capacity: 5, slots: [{ id: "b1", title: "Old" }] }] });
    const after = comp({ partyLines: [{ id: "l1", capacity: 5, slots: [{ id: "b1", title: "New" }] }] });
    const ops = diff(before, after);
    expect(ops).toEqual([
      { t: "slot", line: 0, index: 0, before: { id: "b1", title: "Old" }, after: { id: "b1", title: "New" } },
    ]);
  });

  test("an identical comp produces no ops", () => {
    expect(diff(comp(), comp())).toEqual([]);
  });

  test("bookkeeping alone is derived and never writes a version", () => {
    const ops = diff(comp(), comp({ sortOrder: 4, pinned: true }));
    expect(ops.every((op) => op.t === "derived")).toBe(true);
    const { substantive, incidental } = classify(ops);
    expect(substantive).toEqual([]);
    expect(incidental).toEqual([]);
  });

  test("a folder move is incidental, not substantive", () => {
    const { substantive, incidental } = classify(diff(comp(), comp({ folderId: "f2" })));
    expect(substantive).toEqual([]);
    expect(incidental).toEqual([{ t: "meta", path: "folderId", before: "f1", after: "f2" }]);
  });

  test("a slot change is substantive", () => {
    const after = comp();
    after.partyLines[0].slots[1] = "b9";
    expect(classify(diff(comp(), after)).substantive).toHaveLength(1);
  });
});

describe("diffComp — round trip", () => {
  const mutations = {
    "a slot swap": (c) => { c.partyLines[0].slots[1] = "b9"; },
    "a slot emptied": (c) => { c.partyLines[0].slots[0] = null; },
    "a party line emptied": (c) => { c.partyLines[1].slots = [null, null, null, null, null]; },
    "a party line added": (c) => { c.partyLines.push({ id: "l3", capacity: 10, slots: ["b7"] }); },
    "a party line removed": (c) => { c.partyLines.pop(); },
    "party lines dropped entirely": (c) => { delete c.partyLines; },
    "party lines turned null": (c) => { c.partyLines = null; },
    "a line's capacity changed": (c) => { c.partyLines[0].capacity = 10; },
    "a rename": (c) => { c.name = "Renamed"; },
    "notes written": (c) => { c.notes = "focus the guard"; },
    "a retag": (c) => { c.tags = ["pve", "raid"]; },
    "a folder move": (c) => { c.folderId = "f2"; },
    "a trash stamp": (c) => { c.deletedAt = "2026-09-01T00:00:00.000Z"; c.trashRoot = true; },
    "an archive stamp": (c) => { c.archivedAt = "2026-09-01T00:00:00.000Z"; },
    "membership changed": (c) => { c.buildIds = ["b1"]; },
    "categories changed": (c) => { c.categories = [{ id: "heal", name: "Heal" }]; },
    "slot colours changed": (c) => { c.buildColors = { b1: "#f00" }; },
    "a game mode change": (c) => { c.gameMode = "pve"; },
    "an unknown key appearing": (c) => { c.experimentalThing = { a: 1 }; },
    "an unknown key disappearing": (c) => { delete c.gameMode; c.leftover = undefined; },
    "publishing": (c) => { c.publishedSlug = "abc"; c.publishedAt = "2026-09-01T00:00:00.000Z"; },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    test(`applyOps(before, diff(before, after)) === after — ${name}`, () => {
      const before = comp({ updatedAt: "2026-01-01T00:00:00.000Z", version: 1 });
      const after = comp({ updatedAt: "2026-02-02T00:00:00.000Z", version: 2 });
      mutate(after);
      const ops = diff(before, after);
      expect(withoutBookkeeping(applyOps(before, ops))).toEqual(withoutBookkeeping(after));
    });

    test(`invert round-trips back to before — ${name}`, () => {
      const before = comp({ updatedAt: "2026-01-01T00:00:00.000Z", version: 1 });
      const after = comp({ updatedAt: "2026-01-01T00:00:00.000Z", version: 1 });
      mutate(after);
      const ops = diff(before, after);
      expect(applyOps(applyOps(before, ops), invert(ops))).toEqual(before);
    });
  }

  test("a first version has nothing to compare against and carries every key", () => {
    const after = comp();
    expect(applyOps({}, diff(null, after))).toEqual(after);
  });
});
