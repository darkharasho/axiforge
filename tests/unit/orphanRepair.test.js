"use strict";

const { repairOrphans } = require("../../src/main/orphanRepair");

function makeStores({ folders = [], trashedFolders = [], builds = [], comps = [] } = {}) {
  const moved = [];
  const upsertedFolders = [];
  const upsertedComps = [];
  return {
    moved, upsertedFolders, upsertedComps,
    folderStore: {
      listFolders: async () => folders,
      listTrashedFolders: async () => trashedFolders,
      upsertFolder: async (f) => { upsertedFolders.push(f); },
    },
    buildStore: {
      listBuilds: async () => builds,
      moveBuilds: async (ids, folderId) => { moved.push([ids, folderId]); },
    },
    compStore: {
      listComps: async () => comps,
      upsertComp: async (c) => { upsertedComps.push(c); },
    },
  };
}

describe("repairOrphans", () => {
  test("reattaches comps whose folder was hard-deleted", async () => {
    const s = makeStores({
      folders: [{ id: "live", parentId: null }],
      comps: [
        { id: "c-orphan", name: "Lost", folderId: "gone" },
        { id: "c-ok", name: "Fine", folderId: "live" },
      ],
    });
    const result = await repairOrphans(s);

    expect(result.comps).toEqual(["c-orphan"]);
    expect(s.upsertedComps).toEqual([{ id: "c-orphan", name: "Lost", folderId: null }]);
  });

  test("reattaches builds and folders with dead parents", async () => {
    const s = makeStores({
      folders: [{ id: "child", parentId: "gone" }],
      builds: [{ id: "b1", folderId: "gone" }, { id: "b2", folderId: "child" }],
    });
    const result = await repairOrphans(s);

    expect(result.folders).toEqual(["child"]);
    expect(s.upsertedFolders).toEqual([{ id: "child", parentId: null }]);
    expect(result.builds).toEqual(["b1"]);
    expect(s.moved).toEqual([[["b1"], null]]);
  });

  test("leaves records inside a TRASHED folder alone", async () => {
    // Those are waiting for a restore, not orphaned — reattaching them to the
    // root would tear a trashed folder's contents out of its restore batch.
    const s = makeStores({
      folders: [],
      trashedFolders: [{ id: "binned", parentId: null }],
      builds: [{ id: "b1", folderId: "binned" }],
      comps: [{ id: "c1", folderId: "binned" }],
    });
    const result = await repairOrphans(s);

    expect(result).toEqual({ builds: [], comps: [], folders: [] });
    expect(s.moved).toEqual([]);
    expect(s.upsertedComps).toEqual([]);
  });

  test("root-level records are not orphans", async () => {
    const s = makeStores({
      builds: [{ id: "b1", folderId: null }],
      comps: [{ id: "c1", folderId: undefined }],
    });
    const result = await repairOrphans(s);
    expect(result).toEqual({ builds: [], comps: [], folders: [] });
  });
});
