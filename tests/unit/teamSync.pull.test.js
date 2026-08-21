"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FAILURES_BEFORE_TOAST } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
function item(over) {
  return { id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Remote" }, version: 1, seq: 1, deleted: false, createdBy: who("vette"), updatedBy: who("vette"), updatedAt: "2026-08-21T11:00:00.000Z", ...over };
}
async function seedTeam(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
}

describe("TeamSync — pull", () => {
  test("applies builds/comps/folders into the stores with folderId restored, records history, stores versions and cursor", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "f1", type: "folder", body: { name: "Raids", sortOrder: 2 }, seq: 1 }),
      item({ id: "b1", parentId: "f1", seq: 2 }),
      item({ id: "c1", type: "comp", body: { id: "c1", name: "Comp", buildIds: ["b1"], partyLines: [] }, seq: 3 }),
    ], nextSeq: 3, hasMore: false });
    await h.sync.pullTeam("t");
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "f1")).toMatchObject({ name: "Raids", parentId: "t", sortOrder: 2 });
    const b = (await h.buildStore.listBuilds()).find((x) => x.id === "b1");
    expect(b).toMatchObject({ title: "Remote", folderId: "f1" });
    expect((await h.compStore.listComps())[0]).toMatchObject({ name: "Comp", folderId: "t" });
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 1, createdBy: "u-vette" });
    expect((await h.syncStore.getTeam("t")).cursor).toBe(3);
    const hist = await h.historyStore.getHistory("b1");
    expect(hist[0]).toMatchObject({ source: "team-sync", authorLogin: "vette", summary: "Created" });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", folderId: "t", item: expect.objectContaining({ title: "Remote" }) }));
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", folderId: "t" }));
  });

  test("pages until hasMore is false, persisting the cursor after each page", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes
      .mockResolvedValueOnce({ items: [item({ id: "b1", seq: 1 })], nextSeq: 1, hasMore: true })
      .mockRejectedValueOnce(apiError("SYNC_OFFLINE"));
    await expect(h.sync.pullTeam("t")).rejects.toMatchObject({ code: "SYNC_OFFLINE" });
    expect((await h.syncStore.getTeam("t")).cursor).toBe(1); // first page was persisted
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b2", seq: 2 })], nextSeq: 2, hasMore: false });
    await h.sync.pullTeam("t");
    expect(h.api.changes).toHaveBeenLastCalledWith("t", 1, 200);
    expect((await h.buildStore.listBuilds()).map((b) => b.id).sort()).toEqual(["b1", "b2"]);
  });

  test("skips echoes of our own writes and items with a pending outbox entry", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Local", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 3, createdBy: "me" });
    await h.buildStore.upsertBuild({ id: "b2", title: "Editing", folderId: "t" });
    await h.syncStore.enqueue("t", "b2", { type: "build", op: "put" });
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "b1", version: 3, seq: 5, body: { id: "b1", title: "Echo" } }),
      item({ id: "b2", version: 9, seq: 6, body: { id: "b2", title: "Theirs" } }),
    ], nextSeq: 6, hasMore: false });
    await h.sync.pullTeam("t");
    const builds = await h.buildStore.listBuilds();
    expect(builds.find((b) => b.id === "b1").title).toBe("Local");
    expect(builds.find((b) => b.id === "b2").title).toBe("Editing");
    expect(await h.syncStore.getVersion("t", "b2")).toBeNull(); // not recorded — flush will 409 and resolve it
  });

  test("tombstones delete locally: build removed from comps, folder cascade, versions dropped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.folderStore.upsertFolder({ id: "f1", name: "F", parentId: "t" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "f1" });
    await h.compStore.upsertComp({ id: "c1", name: "C", folderId: "t", buildIds: ["b1"], partyLines: [{ id: "l", capacity: 5, slots: ["b1"] }] });
    for (const id of ["f1", "b1", "c1"]) await h.syncStore.setVersion("t", id, { version: 1, createdBy: "x" });
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "b1", deleted: true, body: null, version: 2, seq: 7 }),
      item({ id: "f1", type: "folder", deleted: true, body: null, version: 2, seq: 8 }),
    ], nextSeq: 8, hasMore: false });
    await h.sync.pullTeam("t");
    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect((await h.compStore.listComps())[0].buildIds).toEqual([]);
    expect((await h.folderStore.listFolders()).map((f) => f.id)).toEqual(["t"]);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();
    expect(await h.syncStore.getVersion("t", "f1")).toBeNull();
  });

  test("remote update of a build records a history entry with the remote author", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Old", folderId: "t" });
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b1", version: 2, seq: 2, body: { id: "b1", title: "New" }, updatedBy: who("iruixos") })], nextSeq: 2, hasMore: false });
    await h.sync.pullTeam("t");
    const hist = await h.historyStore.getHistory("b1");
    expect(hist[0]).toMatchObject({ source: "team-sync", authorLogin: "iruixos" });
    expect(hist[0].summary).not.toBe("Created");
  });

  test("pullAll flushes first, pulls every team, isolates failures, counts consecutive failures and emits once at 3", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "a", name: "A", shared: true, teamId: "a", role: "member" });
    await h.folderStore.upsertFolder({ id: "b", name: "B", shared: true, teamId: "b", role: "member" });
    await h.buildStore.upsertBuild({ id: "x", title: "X", folderId: "a" });
    await h.syncStore.enqueue("a", "x", { type: "build", op: "put" });
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    h.api.changes.mockImplementation(async (teamId) => { if (teamId === "a") throw apiError("SYNC_OFFLINE"); return { items: [], nextSeq: 0, hasMore: false }; });
    for (let i = 0; i < FAILURES_BEFORE_TOAST; i++) await h.sync.pullAll();
    expect(h.api.putItem).toHaveBeenCalledTimes(1); // outbox flushed before pulling
    expect(h.api.changes).toHaveBeenCalledWith("b", 0, 200);
    const errs = h.events.filter((e) => e.status === "error" && e.error === "pull");
    expect(errs).toHaveLength(1);
    expect((await h.syncStore.getTeam("a")).failures).toBe(FAILURES_BEFORE_TOAST);
    h.api.changes.mockResolvedValue({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.pullAll();
    expect((await h.syncStore.getTeam("a")).failures).toBe(0);
  });

  test("401 during pull clears the session and stops polling", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockRejectedValueOnce(apiError("SYNC_UNAUTHORIZED"));
    h.sync.startPolling();
    await h.sync.pullAll();
    expect(await h.sync.getSession()).toBeNull();
    expect(h.sync._pollTimer).toBeNull();
  });

  test("startPolling pulls every POLL_INTERVAL_MS; onFocus honours the cooldown; concurrent pullTeam coalesces", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.sync.startPolling();
    await h.advance(POLL_INTERVAL_MS);
    await h.advance(POLL_INTERVAL_MS);
    expect(h.api.changes).toHaveBeenCalledTimes(2);
    await h.sync.onFocus();
    await h.sync.onFocus();
    expect(h.api.changes).toHaveBeenCalledTimes(3);
    await h.advance(FOCUS_COOLDOWN_MS);
    await h.sync.onFocus();
    expect(h.api.changes).toHaveBeenCalledTimes(4);
    let resolve;
    h.api.changes.mockImplementationOnce(() => new Promise((r) => { resolve = () => r({ items: [], nextSeq: 0, hasMore: false }); }));
    const p1 = h.sync.pullTeam("t"); const p2 = h.sync.pullTeam("t");
    // Real disk-backed stores mean getSession()/listFolders()/getTeam() need
    // genuine event-loop turns before api.changes is actually invoked and
    // `resolve` gets assigned — poll for it instead of assuming it's ready
    // synchronously.
    while (!resolve) await new Promise((r) => setImmediate(r));
    resolve();
    await Promise.all([p1, p2]);
    expect(h.api.changes).toHaveBeenCalledTimes(5);
    h.sync.stopPolling();
  });

  test("resync: true re-derives membership from a full re-pull, dropping items not present on the server (R1)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "t" });
    await h.buildStore.upsertBuild({ id: "b2", title: "B2", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "x" });
    await h.syncStore.setVersion("t", "b2", { version: 1, createdBy: "x" });
    await h.syncStore.setCursor("t", 50);
    h.api.changes
      .mockResolvedValueOnce({ items: [], nextSeq: 50, hasMore: false, resync: true })
      .mockResolvedValueOnce({ items: [item({ id: "b1", version: 1, seq: 1 })], nextSeq: 1, hasMore: false, resync: false });
    await h.sync.pullTeam("t");
    expect(h.api.changes).toHaveBeenNthCalledWith(1, "t", 50, 200);
    expect(h.api.changes).toHaveBeenNthCalledWith(2, "t", 0, 200);
    const builds = (await h.buildStore.listBuilds()).map((b) => b.id).sort();
    expect(builds).toEqual(["b1"]);
    expect(await h.syncStore.getVersion("t", "b2")).toBeNull();
    expect((await h.syncStore.getTeam("t")).cursor).toBe(1);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b2", folderId: "t", removed: true }));
  });

  test("resync keeps items with a pending outbox entry even if the server no longer has them (R1)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "x" });
    await h.syncStore.enqueue("t", "b1", { type: "build", op: "put" });
    h.api.changes.mockResolvedValueOnce({ items: [], nextSeq: 10, hasMore: false, resync: true });
    h.api.changes.mockResolvedValueOnce({ items: [], nextSeq: 0, hasMore: false, resync: false });
    await h.sync.pullTeam("t");
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
  });

  test("SYNC_FORBIDDEN during changes detaches the team via listTeams and does not count as a failure (R2)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockRejectedValueOnce(apiError("SYNC_FORBIDDEN"));
    h.api.listTeams.mockResolvedValueOnce([]);
    await h.sync.pullAll();
    expect(h.api.listTeams).toHaveBeenCalled();
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ shared: false });
    expect((await h.syncStore.getTeam("t")).failures).toBe(0);
    expect(h.events.some((e) => e.status === "error" && e.error === "pull")).toBe(false);
  });

  test("SYNC_NOT_FOUND during changes also detaches via listTeams without counting as a failure (R2)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockRejectedValueOnce(apiError("SYNC_NOT_FOUND"));
    h.api.listTeams.mockResolvedValueOnce([]);
    await h.sync.pullAll();
    expect(h.api.listTeams).toHaveBeenCalled();
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ shared: false });
    expect((await h.syncStore.getTeam("t")).failures).toBe(0);
  });
});
