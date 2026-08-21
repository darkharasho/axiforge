"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS, BACKOFF_BASE_MS } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

async function seedTeam(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
  await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "t" });
}

describe("TeamSync — outbox", () => {
  test("enqueue persists before resolving and does not call the API until the debounce fires", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.sync.enqueue("t", "b1", "build", "put");
    expect((await h.syncStore.listOutbox("t"))[0]).toMatchObject({ itemId: "b1", op: "put" });
    expect(h.api.putItem).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(expect.objectContaining({ status: "syncing", type: "build", id: "b1", folderId: "t" }));
    h.sync.stopPolling();
    expect(h.sync._flushTimers.size).toBe(0); // fix 4: stopPolling clears pending debounce timers
  });

  test("flush reads the LATEST body from the store and sends parentId relative to the team root", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "v1", folderId: "sub" });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.buildStore.upsertBuild({ id: "b1", title: "v2", folderId: "sub" });
    await h.sync.enqueue("t", "b1", "build", "put"); // debounce reset, still one entry
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
    const [teamId, itemId, payload] = h.api.putItem.mock.calls[0];
    expect([teamId, itemId]).toEqual(["t", "b1"]);
    expect(payload.type).toBe("build");
    expect(payload.parentId).toBe("sub");
    expect(payload.baseVersion).toBeNull();
    expect(payload.body.title).toBe("v2");
    expect(payload.body.folderId).toBeUndefined();
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 1, createdBy: "me" });
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", folderId: "t" }));
  });

  test("debounce respects the 5s max delay under continuous edits", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    for (let i = 0; i < 12; i++) { await h.sync.enqueue("t", "b1", "build", "put"); await h.advance(500); }
    // 6s of edits every 500ms: the max-delay rule must have fired at least once
    expect(h.api.putItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(h.api.putItem.mock.calls.length).toBeLessThanOrEqual(2);
    void FLUSH_MAX_DELAY_MS;
  });

  test("update sends the known version; delete sends DELETE with baseVersion; delete with no version is a local no-op", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.syncStore.setVersion("t", "b1", { version: 4, createdBy: "me" });
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockResolvedValue({ version: 5, seq: 10 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem.mock.calls[0][2].baseVersion).toBe(4);

    h.api.deleteItem.mockResolvedValue({ version: 6, seq: 11 });
    await h.sync.enqueue("t", "b1", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.deleteItem).toHaveBeenCalledWith("t", "b1", 5);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();

    await h.sync.enqueue("t", "never-synced", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.deleteItem).toHaveBeenCalledTimes(1);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("a put whose item vanished locally is dropped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.sync.enqueue("t", "ghost", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem).not.toHaveBeenCalled();
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("offline: entry kept, attempts++, exponential backoff, pending event; succeeds on a later flush", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_OFFLINE")).mockRejectedValueOnce(apiError("SYNC_OFFLINE")).mockResolvedValue({ version: 1, seq: 1 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    let [e] = await h.syncStore.listOutbox("t");
    expect(e.attempts).toBe(1);
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(BACKOFF_BASE_MS * 2);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "pending", type: "build", id: "b1" }));
    await h.sync.flushTeam("t"); // too early — skipped
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
    await h.advance(BACKOFF_BASE_MS * 2);
    await h.sync.flushTeam("t");
    [e] = await h.syncStore.listOutbox("t");
    expect(e.attempts).toBe(2);
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(BACKOFF_BASE_MS * 4);
    await h.advance(BACKOFF_BASE_MS * 4);
    await h.sync.flushTeam("t");
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("rate limited uses Retry-After", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_RATE_LIMITED", { retryAfterMs: 42_000 }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    const [e] = await h.syncStore.listOutbox("t");
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(42_000);
  });

  test("forbidden: dequeued, error event with server message, item re-pulled", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "someone-else" });
    h.api.deleteItem.mockRejectedValueOnce(apiError("SYNC_FORBIDDEN", { message: "Only the team owner or the item's creator can delete it." }));
    await h.sync.enqueue("t", "b1", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", type: "build", id: "b1", error: "forbidden", message: expect.stringMatching(/creator/) }));
    expect(h.api.changes).toHaveBeenCalled(); // re-pull requested
  });

  test("too large: dequeued with a user-facing error naming the item", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Huge", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_TOO_LARGE", { message: "This build (build b1) is too large to sync (limit 1.5 MB)." }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", id: "b1", error: "too_large" }));
  });

  test("conflict: entry marked, conflict event emitted, entry skipped by later flushes", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "me" });
    const current = { id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Theirs" }, version: 2, seq: 9, deleted: false, createdBy: { userId: "me", login: "me" }, updatedBy: { userId: "u2", login: "vette" }, updatedAt: "2026-08-21T11:59:00.000Z" };
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    const [e] = await h.syncStore.listOutbox("t");
    expect(e.conflict).toEqual(current);
    expect(h.events).toContainEqual({ channel: "sync-conflict", teamId: "t", itemId: "b1", type: "build", title: "Mine", current });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "conflict", type: "build", id: "b1" }));
    await h.sync.flushTeam("t");
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
  });

  test("unauthorized: session cleared, outbox preserved, auth error event, polling stopped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_UNAUTHORIZED"));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.sync.getSession()).toBeNull();
    expect((await h.syncStore.listOutbox("t")).length).toBe(1);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", error: "auth" }));
  });

  test("flushes are serialized per team and concurrent flushTeam calls coalesce", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.buildStore.upsertBuild({ id: "b2", title: "B", folderId: "t" });
    let inFlight = 0, maxInFlight = 0;
    h.api.putItem.mockImplementation(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setImmediate(r)); inFlight--; return { version: 1, seq: 1 }; });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.sync.enqueue("t", "b2", "build", "put");
    await Promise.all([h.sync.flushTeam("t"), h.sync.flushTeam("t"), h.sync.flushTeam("t")]);
    expect(h.api.putItem).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  test("folder items: put sends {name, sortOrder} with the folder's parent; root-level subfolder parentId is null", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    await h.sync.enqueue("t", "sub", "folder", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem.mock.calls[0][2]).toEqual({ type: "folder", parentId: null, body: { name: "Sub", sortOrder: 0 }, baseVersion: null });
  });

  // ─── fix round 1 ────────────────────────────────────────────────────────────

  test("fix 1: a re-enqueue during an in-flight flush is not lost (queuedAt-guarded dequeue)", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "v1", folderId: "t" });
    let resolvePut;
    h.api.putItem.mockImplementationOnce(() => new Promise((r) => { resolvePut = r; }));
    await h.sync.enqueue("t", "b1", "build", "put");
    const flushPromise = h.sync.flushTeam("t"); // starts flushing the ORIGINAL entry
    while (h.api.putItem.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    // A second edit races the in-flight flush: it must produce a fresh outbox
    // entry that the stale flush cannot dequeue out from under it.
    await h.buildStore.upsertBuild({ id: "b1", title: "v2", folderId: "t" });
    await h.sync.enqueue("t", "b1", "build", "put");
    resolvePut({ version: 1, seq: 1 });
    await flushPromise;
    const [e] = await h.syncStore.listOutbox("t");
    expect(e).toBeTruthy(); // NOT dropped by the stale flush's dequeue
    expect(e.attempts).toBe(0);
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 1, createdBy: "me" }); // still recorded despite the stale dequeue no-op
    h.api.putItem.mockResolvedValueOnce({ version: 2, seq: 2 });
    await h.sync.flushTeam("t");
    expect(h.api.putItem).toHaveBeenCalledTimes(2);
    expect(h.api.putItem.mock.calls[1][2].baseVersion).toBe(1); // sent with the version the first flush recorded
    expect(h.api.putItem.mock.calls[1][2].body.title).toBe("v2");
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("fix 2: SYNC_NOT_FOUND on put drops the entry, emits a per-item error, and reconciles teams", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.listTeams.mockResolvedValue([{ team: { id: "t", name: "T" }, role: "member" }]);
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_NOT_FOUND"));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]); // dropped, no retry scheduled
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", type: "build", id: "b1", error: "not_found" }));
    expect(h.api.listTeams).toHaveBeenCalledTimes(1); // reconciliation
    expect(h.api.changes).toHaveBeenCalled(); // re-pull requested
  });

  test("fix 3: flushTeam re-runs after an in-flight flush when called again mid-flight", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    let resolvePut;
    h.api.putItem.mockImplementationOnce(() => new Promise((r) => { resolvePut = r; }));
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    const spy = jest.spyOn(h.sync, "_flushTeamInner");
    await h.sync.enqueue("t", "b1", "build", "put");
    const flushPromise = h.sync.flushTeam("t");
    while (h.api.putItem.mock.calls.length === 0) await new Promise((r) => setImmediate(r));
    await h.buildStore.upsertBuild({ id: "b2", title: "B", folderId: "t" });
    await h.sync.enqueue("t", "b2", "build", "put"); // schedules a debounce timer, does not itself flush
    const secondCall = h.sync.flushTeam("t"); // requests a re-run while the first pass is in flight
    expect(secondCall).toBe(flushPromise);
    resolvePut({ version: 1, seq: 1 });
    await flushPromise;
    expect(h.api.putItem).toHaveBeenCalledTimes(2); // b1 (first pass) + b2 (re-run pass)
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ─── R6.2 ───────────────────────────────────────────────────────────────────

  test("R6.2: two forbidden entries in one flush trigger only ONE reconcile + re-pull", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.buildStore.upsertBuild({ id: "b2", title: "B", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "someone-else" });
    await h.syncStore.setVersion("t", "b2", { version: 1, createdBy: "someone-else" });
    h.api.deleteItem.mockRejectedValue(apiError("SYNC_FORBIDDEN", { message: "Only the team owner or the item's creator can delete it." }));
    h.api.listTeams.mockResolvedValue([{ team: { id: "t", name: "T" }, role: "member" }]);
    await h.sync.enqueue("t", "b1", "build", "delete");
    await h.sync.enqueue("t", "b2", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events.filter((e) => e.status === "error" && e.error === "forbidden")).toHaveLength(2); // still one per-item error each
    expect(h.api.listTeams).toHaveBeenCalledTimes(1); // ONE reconcile for both entries
    expect(h.api.changes).toHaveBeenCalledTimes(1); // ONE re-pull for both entries
  });
});
