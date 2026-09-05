"use strict";

const {
  captureBuildDeletion,
  restoreBuildDeletion,
  captureFolderDeletion,
  restoreFolderDeletion,
  captureCompDeletion,
  restoreCompDeletion,
} = require("../../../src/renderer/modules/library/delete-undo.js");

// A recording stand-in for window.desktopApi. Restore is defined by the calls it
// makes, so the fake records them rather than asserting on a mock's internals.
function fakeApi() {
  const calls = { saveBuild: [], saveComp: [], saveFolder: [], moveBuilds: [] };
  return {
    calls,
    saveBuild: async (b) => { calls.saveBuild.push(b); return b; },
    saveComp: async (c) => { calls.saveComp.push(c); return c; },
    saveFolder: async (f) => { calls.saveFolder.push(f); return f; },
    moveBuilds: async (ids, folderId) => { calls.moveBuilds.push({ ids, folderId }); },
  };
}

describe("build delete undo", () => {
  test("restores the build with its id and published link fields intact", async () => {
    const build = {
      id: "b1",
      title: "Power Berserker",
      folderId: "f1",
      compIds: [],
      publishedSlug: "power-berserker",
      publishedKey: "key-1",
      publishedAt: "2026-01-01T00:00:00.000Z",
    };
    const snapshot = captureBuildDeletion(["b1"], { builds: [build], comps: [] });

    const api = fakeApi();
    await restoreBuildDeletion(snapshot, api);

    expect(api.calls.saveBuild).toHaveLength(1);
    expect(api.calls.saveBuild[0]).toMatchObject({
      id: "b1",
      title: "Power Berserker",
      folderId: "f1",
      publishedSlug: "power-berserker",
      publishedKey: "key-1",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("restores comp membership and party-line slots the delete stripped", async () => {
    const build = { id: "b1", title: "Healer", folderId: null, compIds: ["c1"] };
    const comp = {
      id: "c1",
      name: "Zerg",
      gameMode: "wvw",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "l1", slots: ["b1", "b2"] }],
    };
    const snapshot = captureBuildDeletion(["b1"], { builds: [build], comps: [comp] });

    const api = fakeApi();
    await restoreBuildDeletion(snapshot, api);

    expect(api.calls.saveComp).toHaveLength(1);
    expect(api.calls.saveComp[0]).toMatchObject({
      id: "c1",
      gameMode: "wvw",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "l1", slots: ["b1", "b2"] }],
    });
  });

  test("does not touch comps the deleted build was never in", async () => {
    const build = { id: "b1", compIds: ["c1"] };
    const inComp = { id: "c1", buildIds: ["b1"], partyLines: [] };
    const other = { id: "c2", buildIds: ["b9"], partyLines: [] };
    const snapshot = captureBuildDeletion(["b1"], { builds: [build], comps: [inComp, other] });

    const api = fakeApi();
    await restoreBuildDeletion(snapshot, api);

    expect(api.calls.saveComp.map((c) => c.id)).toEqual(["c1"]);
  });

  test("surfaces a rejected restore instead of failing silently", async () => {
    // Team folders reject a restore the current user lacks permission for; the
    // undo must not swallow that into a no-op.
    const snapshot = captureBuildDeletion(["b1"], { builds: [{ id: "b1" }], comps: [] });
    const api = {
      saveBuild: async () => {
        throw new Error("Only the team owner or the build's creator can delete it from the team.");
      },
      saveComp: async () => {},
    };

    await expect(restoreBuildDeletion(snapshot, api)).rejects.toThrow(/team owner/);
  });

  test("captures a deep copy so later edits to live state cannot corrupt the undo", async () => {
    const build = { id: "b1", title: "Original", compIds: [] };
    const snapshot = captureBuildDeletion(["b1"], { builds: [build], comps: [] });

    build.title = "Mutated After Capture";

    const api = fakeApi();
    await restoreBuildDeletion(snapshot, api);

    expect(api.calls.saveBuild[0].title).toBe("Original");
  });
});

describe("folder delete undo", () => {
  // f1 > f2 > f3, with builds spread across the subtree.
  const folders = [
    { id: "f1", name: "WvW", parentId: null, sortOrder: 0 },
    { id: "f2", name: "Zerg", parentId: "f1", sortOrder: 0 },
    { id: "f3", name: "Frontline", parentId: "f2", sortOrder: 0 },
    { id: "other", name: "PvE", parentId: null, sortOrder: 1 },
  ];
  const builds = [
    { id: "b1", folderId: "f1" },
    { id: "b2", folderId: "f3" },
    { id: "b3", folderId: "other" },
  ];

  test("restores the whole subtree, parents before children", async () => {
    const snapshot = captureFolderDeletion("f1", { folders, builds });

    const api = fakeApi();
    await restoreFolderDeletion(snapshot, api);

    expect(api.calls.saveFolder.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });

  test("moves each orphaned build back to the exact folder it came from", async () => {
    const snapshot = captureFolderDeletion("f1", { folders, builds });

    const api = fakeApi();
    await restoreFolderDeletion(snapshot, api);

    const moves = api.calls.moveBuilds.map((m) => ({ ids: [...m.ids].sort(), folderId: m.folderId }));
    expect(moves).toEqual(
      expect.arrayContaining([
        { ids: ["b1"], folderId: "f1" },
        { ids: ["b2"], folderId: "f3" },
      ]),
    );
    expect(moves.some((m) => m.ids.includes("b3"))).toBe(false);
  });

  test("restores folders before moving builds into them", async () => {
    const order = [];
    const api = fakeApi();
    const tracked = {
      ...api,
      saveFolder: async (f) => { order.push(`folder:${f.id}`); return f; },
      moveBuilds: async (ids, folderId) => { order.push(`move:${folderId}`); },
    };
    const snapshot = captureFolderDeletion("f1", { folders, builds });

    await restoreFolderDeletion(snapshot, tracked);

    const lastFolder = order.lastIndexOf("folder:f3");
    const firstMove = order.findIndex((o) => o.startsWith("move:"));
    expect(lastFolder).toBeLessThan(firstMove);
  });
});

describe("comp delete undo", () => {
  test("restores the comp with its party lines intact", async () => {
    const comp = {
      id: "c1",
      name: "Zerg Comp",
      folderId: "f1",
      gameMode: "wvw",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "l1", slots: ["b1", null, "b2", null, null] }],
    };
    const snapshot = captureCompDeletion(["c1"], { comps: [comp], builds: [] });

    const api = fakeApi();
    await restoreCompDeletion(snapshot, api);

    expect(api.calls.saveComp).toHaveLength(1);
    expect(api.calls.saveComp[0]).toMatchObject({
      id: "c1",
      name: "Zerg Comp",
      gameMode: "wvw",
      buildIds: ["b1", "b2"],
      partyLines: [{ id: "l1", slots: ["b1", null, "b2", null, null] }],
    });
  });

  test("re-links the builds the delete unlinked", async () => {
    // comps:delete also runs store.clearCompFromBuilds, stripping the comp id
    // from every build's compIds. Restoring only the comp would leave the two
    // sides disagreeing about the membership.
    const comp = { id: "c1", name: "Zerg Comp", buildIds: ["b1"] };
    const builds = [
      { id: "b1", title: "Scourge", compIds: ["c1", "c2"] },
      { id: "b9", title: "Unrelated", compIds: ["c2"] },
    ];
    const snapshot = captureCompDeletion(["c1"], { comps: [comp], builds });

    const api = fakeApi();
    await restoreCompDeletion(snapshot, api);

    expect(api.calls.saveBuild).toHaveLength(1);
    expect(api.calls.saveBuild[0]).toMatchObject({ id: "b1", compIds: ["c1", "c2"] });
  });

  test("restores every comp in a multi-select delete", async () => {
    const comps = [
      { id: "c1", name: "A", buildIds: [] },
      { id: "c2", name: "B", buildIds: [] },
    ];
    const snapshot = captureCompDeletion(["c1", "c2"], { comps, builds: [] });

    const api = fakeApi();
    await restoreCompDeletion(snapshot, api);

    expect(api.calls.saveComp.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  test("snapshot is a deep copy, so later edits cannot corrupt a pending undo", async () => {
    const comp = { id: "c1", name: "Zerg Comp", buildIds: ["b1"], partyLines: [{ slots: ["b1"] }] };
    const snapshot = captureCompDeletion(["c1"], { comps: [comp], builds: [] });

    comp.name = "MUTATED";
    comp.partyLines[0].slots.push("b2");

    const api = fakeApi();
    await restoreCompDeletion(snapshot, api);

    expect(api.calls.saveComp[0].name).toBe("Zerg Comp");
    expect(api.calls.saveComp[0].partyLines[0].slots).toEqual(["b1"]);
  });

  test("ignores ids that are not present", async () => {
    const snapshot = captureCompDeletion(["nope"], { comps: [], builds: [] });
    const api = fakeApi();
    await restoreCompDeletion(snapshot, api);
    expect(api.calls.saveComp).toEqual([]);
  });
});
