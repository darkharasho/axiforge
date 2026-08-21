"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
const current = (over) => ({ id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Theirs" }, version: 2, seq: 9, deleted: false, createdBy: who("me"), updatedBy: who("vette"), updatedAt: "2026-08-21T11:59:00.000Z", ...over });

async function conflicted(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
  await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
  await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
  h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current() }));
  await h.sync.enqueue("t", "b1", "build", "put");
  await h.advance(FLUSH_DEBOUNCE_MS);
  expect((await h.syncStore.listOutbox("t"))[0].conflict.version).toBe(2);
}

describe("TeamSync — conflicts", () => {
  test("keep mine: re-PUTs with the server's version and clears the conflict", async () => {
    h = await makeHarness();
    await conflicted(h);
    h.api.putItem.mockResolvedValueOnce({ version: 3, seq: 10 });
    await h.sync.resolveConflict("t", "b1", "mine");
    expect(h.api.putItem).toHaveBeenCalledTimes(2);
    expect(h.api.putItem.mock.calls[1][2]).toMatchObject({ baseVersion: 2, body: expect.objectContaining({ title: "Mine" }) });
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 3, createdBy: "u-me" });
  });

  test("take theirs: applies the remote item, dequeues, records version", async () => {
    h = await makeHarness();
    await conflicted(h);
    await h.sync.resolveConflict("t", "b1", "theirs");
    expect((await h.buildStore.listBuilds())[0].title).toBe("Theirs");
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 2, createdBy: "u-me" });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", item: expect.objectContaining({ title: "Theirs" }) }));
  });

  test("take theirs when the remote is a tombstone deletes locally", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current({ deleted: true, body: null, version: 2 }) }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    await h.sync.resolveConflict("t", "b1", "theirs");
    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();
  });

  test("keep mine when the remote is a tombstone re-creates (baseVersion null)", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current({ deleted: true, body: null, version: 2 }) })).mockResolvedValueOnce({ version: 3, seq: 11 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    await h.sync.resolveConflict("t", "b1", "mine");
    expect(h.api.putItem.mock.calls[1][2].baseVersion).toBeNull();
  });

  test("resolveConflict on a non-conflicted entry is a no-op", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.sync.resolveConflict("t", "nope", "mine");
    expect(h.api.putItem).not.toHaveBeenCalled();
  });
});

describe("TeamSync — share folder to team / stop sharing", () => {
  test("shareFolderToTeam uploads folders first, then builds and comps in ≤50-item batches, flips the root, records versions", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "Personal" });
    await h.folderStore.upsertFolder({ id: "p-sub", name: "Sub", parentId: "p" });
    for (let i = 0; i < 60; i++) await h.buildStore.upsertBuild({ id: `b${i}`, title: `B${i}`, folderId: i % 2 ? "p" : "p-sub" });
    await h.compStore.upsertComp({ id: "c1", name: "C", folderId: "p", boonCoverageHtml: "<big/>" });
    h.api.bulk.mockImplementation(async (_teamId, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const progress = [];
    const out = await h.sync.shareFolderToTeam("p", "team-1", (p) => progress.push(p));
    expect(out.failed).toEqual([]);
    expect(out.uploaded).toBe(63); // 2 folders + 60 builds + 1 comp
    const calls = h.api.bulk.mock.calls;
    expect(calls.every(([, items]) => items.length <= 50)).toBe(true);
    expect(calls[0][1][0]).toEqual({ itemId: "p", type: "folder", parentId: null, body: { name: "Personal", sortOrder: 0 }, baseVersion: null });
    expect(calls[0][1][1]).toEqual({ itemId: "p-sub", type: "folder", parentId: "p", body: { name: "Sub", sortOrder: 0 }, baseVersion: null });
    const allItems = calls.flatMap(([, items]) => items);
    expect(allItems.find((i) => i.itemId === "c1").body.boonCoverageHtml).toBeUndefined();
    expect(allItems.find((i) => i.itemId === "b1").parentId).toBe("p");
    const folders = await h.folderStore.listFolders();
    const pFolder = folders.find((f) => f.id === "p");
    expect(pFolder).toMatchObject({ parentId: "team-1" });
    expect(pFolder.shared).toBeUndefined(); // jest's toMatchObject in this version requires the key to be present to compare against `undefined`
    expect(await h.syncStore.getVersion("team-1", "b1")).toEqual({ version: 1, createdBy: "me" });
    expect(progress[progress.length - 1]).toEqual({ done: 63, total: 63 });
  });

  test("shareFolderToTeam reports per-item failures and still moves the folder under the team", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "big", title: "Big", folderId: "p" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "big" ? { itemId: "big", status: 413, message: "too large" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.shareFolderToTeam("p", "team-1");
    expect(out.failed).toEqual([{ itemId: "big", status: 413, message: "too large" }]);
    expect(await h.syncStore.getVersion("team-1", "big")).toBeNull();
  });

  test("stopSharing (owner): deletes the folder item remotely, keeps data locally as personal", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P", parentId: "team-1" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "p" });
    await h.syncStore.setVersion("team-1", "p", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("team-1", "b1", { version: 1, createdBy: "me" });
    h.api.deleteItem.mockResolvedValue({ version: 2, seq: 5 });
    await h.sync.stopSharing("p");
    expect(h.api.deleteItem).toHaveBeenCalledWith("team-1", "p", 1);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "p").parentId).toBeNull();
    expect((await h.buildStore.listBuilds())[0].folderId).toBe("p");
    expect(await h.syncStore.getVersion("team-1", "b1")).toBeNull();
  });

  test("canDelete: owner always; member only for items they created or that are not yet on the server", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "own", name: "O", shared: true, teamId: "own", role: "owner" });
    await h.folderStore.upsertFolder({ id: "mem", name: "M", shared: true, teamId: "mem", role: "member" });
    await h.syncStore.setVersion("mem", "mine", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("mem", "theirs", { version: 1, createdBy: "u-vette" });
    await h.syncStore.setVersion("own", "theirs", { version: 1, createdBy: "u-vette" });
    expect(await h.sync.canDelete("own", "theirs")).toBe(true);
    expect(await h.sync.canDelete("mem", "mine")).toBe(true);
    expect(await h.sync.canDelete("mem", "theirs")).toBe(false);
    expect(await h.sync.canDelete("mem", "unsynced")).toBe(true);
  });
});

describe("TeamSync — shareFolderToTeam rate limiting and idempotent conflicts (R3)", () => {
  test("R3a: a rate-limited batch is retried after waiting retryAfterMs, then succeeds", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "p" });
    h.api.bulk
      .mockRejectedValueOnce(apiError("SYNC_RATE_LIMITED", { retryAfterMs: 30_000 }))
      .mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const p = h.sync.shareFolderToTeam("p", "team-1");
    // Let the initial bulk call (which rejects, real disk I/O in between)
    // settle before advancing timers — Promise.resolve() ticks aren't
    // enough because getSession()/listFolders() do real fs reads.
    while (h.api.bulk.mock.calls.length < 1) await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await h.advance(30_000);
    const out = await p;
    expect(out.failed).toEqual([]);
    expect(out.uploaded).toBe(2); // folder p + build b1
    expect(h.api.bulk).toHaveBeenCalledTimes(2); // same batch retried once
  });

  test("R3a: gives up after 5 consecutive rate-limit waits", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "p" });
    h.api.bulk.mockImplementation(async () => { throw apiError("SYNC_RATE_LIMITED", { retryAfterMs: 1_000 }); });
    const p = h.sync.shareFolderToTeam("p", "team-1");
    p.catch(() => {}); // avoid unhandled-rejection noise while we drive timers
    for (let i = 1; i <= 6; i++) {
      while (h.api.bulk.mock.calls.length < i) await new Promise((r) => setImmediate(r));
      if (i < 6) {
        await new Promise((r) => setImmediate(r));
        await h.advance(1_000);
      }
    }
    await expect(p).rejects.toThrow();
    expect(h.api.bulk).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
  });

  test("R3b: a 409-with-current result is treated as already-uploaded and its version recorded", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "p" });
    const remoteCurrent = { id: "b1", type: "build", version: 4, deleted: false, createdBy: { userId: "u-vette", login: "vette" } };
    h.api.bulk.mockImplementation(async (_t, items) => ({
      results: items.map((it) => it.itemId === "b1"
        ? { itemId: "b1", status: 409, current: remoteCurrent }
        : { itemId: it.itemId, status: 201, version: 1, seq: 1 }),
    }));
    const out = await h.sync.shareFolderToTeam("p", "team-1");
    expect(out.failed).toEqual([]);
    expect(out.uploaded).toBe(2); // folder + build both counted
    expect(await h.syncStore.getVersion("team-1", "b1")).toEqual({ version: 4, createdBy: "u-vette" });
  });

  test("R3b: a 409 with a deleted current is still a real failure", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B1", folderId: "p" });
    const remoteCurrent = { id: "b1", type: "build", version: 4, deleted: true, createdBy: { userId: "u-vette", login: "vette" } };
    h.api.bulk.mockImplementation(async (_t, items) => ({
      results: items.map((it) => it.itemId === "b1"
        ? { itemId: "b1", status: 409, current: remoteCurrent }
        : { itemId: it.itemId, status: 201, version: 1, seq: 1 }),
    }));
    const out = await h.sync.shareFolderToTeam("p", "team-1");
    expect(out.failed).toEqual([{ itemId: "b1", status: 409, message: "Already exists in the team." }]);
    expect(await h.syncStore.getVersion("team-1", "b1")).toBeNull();
  });
});
