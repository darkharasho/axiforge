"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
function item(over) {
  return { id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Remote" }, version: 1, seq: 1, deleted: false, createdBy: who("vette"), updatedBy: who("vette"), updatedAt: "2026-08-21T11:00:00.000Z", ...over };
}
async function seedTeam(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
}

// ─── C2: a rejected write (403/404) must be repaired by a FULL re-pull ────────

describe("TeamSync — 403/404 restores server state locally (C2)", () => {
  test("forbidden folder delete: version cleared, cursor reset to 0, folder AND its build restored locally", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "t" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Teammate's", folderId: "sub" });
    await h.syncStore.setVersion("t", "sub", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-vette" });
    await h.syncStore.setCursor("t", 42);
    // The IPC handler already applied the delete locally before enqueuing.
    await h.folderStore.deleteFolder("sub");
    await h.buildStore.deleteBuild("b1");

    h.api.listTeams.mockResolvedValue([{ team: { id: "t", name: "T" }, role: "member" }]);
    h.api.deleteItem.mockRejectedValueOnce(apiError("SYNC_FORBIDDEN", { message: "Only the team owner or the item's creator can delete it." }));
    // The full re-pull replays everything from seq 0 — including items whose
    // versions we still know (b1), which must still be re-created locally.
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "sub", type: "folder", body: { name: "Sub", sortOrder: 0 }, version: 1, seq: 1 }),
      item({ id: "b1", parentId: "sub", body: { id: "b1", title: "Teammate's" }, version: 1, seq: 2 }),
    ], nextSeq: 2, hasMore: false });

    const removeVersionSpy = jest.spyOn(h.syncStore, "removeVersion");
    await h.sync.enqueue("t", "sub", "folder", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);

    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(removeVersionSpy).toHaveBeenCalledWith("t", "sub"); // stale version dropped so the re-pull can re-apply
    expect(h.api.changes).toHaveBeenCalledWith("t", 0, 200);   // FULL re-pull, not incremental from cursor 42
    expect((await h.folderStore.listFolders()).map((f) => f.id).sort()).toEqual(["sub", "t"]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
  });

  test("not-found put: the full re-pull's tombstone removes the local item and its version", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "me" });
    await h.syncStore.setCursor("t", 7);
    h.api.listTeams.mockResolvedValue([{ team: { id: "t", name: "T" }, role: "member" }]);
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_NOT_FOUND"));
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b1", deleted: true, body: null, version: 2, seq: 1 })], nextSeq: 1, hasMore: false });

    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);

    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.api.changes).toHaveBeenCalledWith("t", 0, 200);
    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();
  });

  test("the version-echo skip still applies when the item IS present locally", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Local", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 3, createdBy: "me" });
    const upsertSpy = jest.spyOn(h.buildStore, "upsertBuild");
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b1", version: 3, seq: 5, body: { id: "b1", title: "Echo" } })], nextSeq: 5, hasMore: false });
    await h.sync.pullTeam("t");
    expect(upsertSpy).not.toHaveBeenCalled();
    expect((await h.buildStore.listBuilds())[0].title).toBe("Local");
    expect(await h.historyStore.getHistory("b1")).toEqual([]);
  });
});

// ─── I1: a failed apply must not advance the cursor past the item ─────────────

describe("TeamSync — a failed apply never skips the item (I1)", () => {
  test("cursor stops just before the failing item, pullTeam rejects, and the next pull replays it", async () => {
    h = await makeHarness();
    await seedTeam(h);
    const page = [
      item({ id: "b1", seq: 1, body: { id: "b1", title: "One" } }),
      item({ id: "f2", type: "folder", seq: 2, body: { name: "Two", sortOrder: 0 } }),
      item({ id: "b3", seq: 3, body: { id: "b3", title: "Three" } }),
    ];
    h.api.changes.mockResolvedValueOnce({ items: page, nextSeq: 3, hasMore: false });
    const upsertFolder = jest.spyOn(h.folderStore, "upsertFolder");
    upsertFolder.mockRejectedValueOnce(new Error("boom"));

    await expect(h.sync.pullTeam("t")).rejects.toThrow("PULL_APPLY_FAILED:folder:f2");
    expect((await h.syncStore.getTeam("t")).cursor).toBe(1); // seq of f2 minus one
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]); // item 1 applied
    expect((await h.folderStore.listFolders()).map((f) => f.id)).toEqual(["t"]); // item 3 not reached

    h.api.changes.mockResolvedValueOnce({ items: page.slice(1), nextSeq: 3, hasMore: false });
    await h.sync.pullTeam("t");
    expect(h.api.changes).toHaveBeenLastCalledWith("t", 1, 200);
    expect((await h.folderStore.listFolders()).map((f) => f.id).sort()).toEqual(["f2", "t"]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id).sort()).toEqual(["b1", "b3"]);
    expect((await h.syncStore.getTeam("t")).cursor).toBe(3);
  });
});

// ─── enqueueFolderTree helper ────────────────────────────────────────────────

describe("TeamSync — enqueueFolderTree", () => {
  test("put: enqueues folders (parents first), then builds, then comps", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "t" });
    await h.folderStore.upsertFolder({ id: "sub2", name: "Sub2", parentId: "sub" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "sub2" });
    await h.compStore.upsertComp({ id: "c1", name: "C", folderId: "sub" });
    await h.buildStore.upsertBuild({ id: "outside", title: "X", folderId: "t" });

    const out = await h.sync.enqueueFolderTree("t", "sub", "put");
    expect(out).toEqual({ count: 4 });
    const outbox = await h.syncStore.listOutbox("t");
    expect(outbox.map((e) => [e.itemId, e.type, e.op])).toEqual([
      ["sub", "folder", "put"],
      ["sub2", "folder", "put"],
      ["b1", "build", "put"],
      ["c1", "comp", "put"],
    ]);
    h.sync.stopPolling();
  });

  test("delete: enqueues a single folder delete for the root of the tree (server cascades)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "t" });
    await h.folderStore.upsertFolder({ id: "sub2", name: "Sub2", parentId: "sub" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "sub2" });

    const out = await h.sync.enqueueFolderTree("t", "sub", "delete");
    expect(out).toEqual({ count: 1 });
    expect(await h.syncStore.listOutbox("t")).toEqual([
      expect.objectContaining({ itemId: "sub", type: "folder", op: "delete" }),
    ]);
    h.sync.stopPolling();
  });
});

describe("TeamSync — _fullRepull vs an in-flight incremental pull", () => {
  test("waits for the running pull, then pulls from 0 so its cursor reset is not overwritten", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.syncStore.setCursor("t", 10);
    let releaseFirst;
    const firstPage = new Promise((resolve) => { releaseFirst = resolve; });
    h.api.changes
      .mockReturnValueOnce(firstPage)                                                           // incremental pull, held open
      .mockResolvedValueOnce({ items: [item({ id: "b1", seq: 3 })], nextSeq: 3, hasMore: false }); // the from-0 repair pull

    const incremental = h.sync.pullTeam("t");          // in flight
    const repair = h.sync._fullRepull("t");            // must not reset the cursor underneath it
    for (let i = 0; i < 200 && h.api.changes.mock.calls.length < 1; i++) await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); // give the repair every chance to (wrongly) race
    expect(h.api.changes).toHaveBeenCalledTimes(1);    // repair is waiting, not racing
    releaseFirst({ items: [], nextSeq: 42, hasMore: false });
    await incremental;
    await repair;

    expect(h.api.changes.mock.calls.map((c) => c[1])).toEqual([10, 0]);
    expect((await h.syncStore.getTeam("t")).cursor).toBe(3);   // the repair pull's nextSeq, not 42
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
  });

  test("a poll tick that fires in the drain→reset window cannot starve the from-0 pull", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.syncStore.setCursor("t", 10);
    let releaseFirst;
    const firstPage = new Promise((resolve) => { releaseFirst = resolve; });
    h.api.changes
      .mockReturnValueOnce(firstPage)
      .mockImplementation(async (_teamId, since) => (since === 0
        ? { items: [item({ id: "b1", seq: 3 })], nextSeq: 3, hasMore: false }
        : { items: [], nextSeq: 42, hasMore: false }));

    const incremental = h.sync.pullTeam("t");
    const repair = h.sync._fullRepull("t");
    for (let i = 0; i < 200 && h.api.changes.mock.calls.length < 1; i++) await new Promise((r) => setImmediate(r));
    releaseFirst({ items: [], nextSeq: 42, hasMore: false });
    await incremental;
    // The 30 s poll timer fires the instant the drained pull settles — before
    // the repair has reset the cursor. If the repair does not own the pull
    // slot, this poll claims it with the stale cursor and the repair's
    // pullTeam() merely joins it: no from-0 pull ever happens.
    const poll = h.sync.pullTeam("t");
    await Promise.all([repair, poll]);

    expect(h.api.changes.mock.calls.map((c) => c[1])).toContain(0);
    expect((await h.syncStore.getTeam("t")).cursor).toBe(3);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
  });
});
