"use strict";

// The grant mirror.
//
// The server decides — see tests/unit/worker-sync-grants.test.js — but the
// client keeps a copy so an edit is refused before it is written locally and
// queued. Getting the REFRESH right is the whole job here: a mirror that lags is
// worse than none, because the UI then confidently offers something the server
// will bounce.

const { makeHarness } = require("../helpers/teamSyncHarness");

async function withTeam(h, { role = "member" } = {}) {
  await h.folderStore.upsertFolder({ id: "root", name: "EWW", parentId: null, shared: true, teamId: "t1", role });
  const raids = await h.folderStore.upsertFolder({ name: "Raids", parentId: "root" });
  const wing = await h.folderStore.upsertFolder({ name: "Wing 1", parentId: raids.id });
  return { raids: raids.id, wing: wing.id };
}

describe("refreshing the mirror", () => {
  test("a resync is what re-reads the grants — nothing else changes them", async () => {
    const h = await makeHarness();
    await withTeam(h);
    h.api.listGrants.mockResolvedValue({ grants: [{ folderId: "t1", access: "read" }], defaults: { member: "write" } });
    h.api.changes
      .mockResolvedValueOnce({ resync: true, items: [], nextSeq: 0, hasMore: false })
      .mockResolvedValueOnce({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.pullTeam("t1");
    expect(await h.syncStore.getGrants("t1")).toEqual({ t1: "read" });
    await h.cleanup();
  });

  test("an ordinary pull does not spend a request on them", async () => {
    const h = await makeHarness();
    await withTeam(h);
    await h.sync.pullTeam("t1");
    expect(h.api.listGrants).not.toHaveBeenCalled();
    await h.cleanup();
  });

  test("a failed refresh leaves the old mirror rather than wiping it", async () => {
    const h = await makeHarness();
    await withTeam(h);
    await h.syncStore.setGrants("t1", { t1: "read" });
    h.api.listGrants.mockRejectedValue(new Error("offline"));
    h.api.changes
      .mockResolvedValueOnce({ resync: true, items: [], nextSeq: 0, hasMore: false })
      .mockResolvedValueOnce({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.pullTeam("t1");
    expect(await h.syncStore.getGrants("t1")).toEqual({ t1: "read" });
    await h.cleanup();
  });
});

describe("what the mirror is for", () => {
  test("a read-only folder refuses a write before anything is written", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h);
    await h.syncStore.setGrants("t1", { [raids]: "read" });
    await expect(h.sync.assertCanWrite(raids)).rejects.toThrow(/do not have permission/);
    await h.cleanup();
  });

  test("the rest of the team is unaffected by one folder's grant", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h);
    await h.syncStore.setGrants("t1", { [raids]: "read" });
    await expect(h.sync.assertCanWrite("root")).resolves.toBeUndefined();
    await h.cleanup();
  });

  test("a personal folder is never restricted", async () => {
    const h = await makeHarness();
    await withTeam(h);
    const personal = await h.folderStore.upsertFolder({ name: "Mine", parentId: null });
    await h.syncStore.setGrants("t1", { t1: "none" });
    await expect(h.sync.assertCanWrite(personal.id)).resolves.toBeUndefined();
    await h.cleanup();
  });

  test("an outright delete grant lets you remove a teammate's work", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h);
    await h.syncStore.setGrants("t1", { [raids]: "delete" });
    await h.syncStore.setVersion("t1", "b1", { version: 1, createdBy: "someone-else" });
    expect(await h.sync.canDeleteIn("t1", "b1", raids)).toBe(true);
    await h.cleanup();
  });

  test("without one you still may not, which is the rule the team already had", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h);
    await h.syncStore.setVersion("t1", "b1", { version: 1, createdBy: "someone-else" });
    expect(await h.sync.canDeleteIn("t1", "b1", raids)).toBe(false);
    await h.cleanup();
  });

  test("read-only takes away cleaning up after yourself", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h);
    await h.syncStore.setGrants("t1", { [raids]: "read" });
    await h.syncStore.setVersion("t1", "b1", { version: 1, createdBy: "me" });
    expect(await h.sync.canDeleteIn("t1", "b1", raids)).toBe(false);
    await h.cleanup();
  });

  test("an owner is never restricted by any of it", async () => {
    const h = await makeHarness();
    const { raids } = await withTeam(h, { role: "owner" });
    await h.syncStore.setGrants("t1", { [raids]: "none" });
    await expect(h.sync.assertCanWrite(raids)).resolves.toBeUndefined();
    await h.cleanup();
  });
});

describe("the map handed to the renderer", () => {
  test("one entry per team folder, so the UI needs no walking logic of its own", async () => {
    const h = await makeHarness();
    const { raids, wing } = await withTeam(h);
    await h.syncStore.setGrants("t1", { [raids]: "read" });
    const map = await h.sync.accessMap();
    expect(map).toEqual({ root: "write", [raids]: "read", [wing]: "read" });
    await h.cleanup();
  });

  test("personal folders are not in it — there is nothing to say about them", async () => {
    const h = await makeHarness();
    await withTeam(h);
    const personal = await h.folderStore.upsertFolder({ name: "Mine", parentId: null });
    expect(await h.sync.accessMap()).not.toHaveProperty(personal.id);
    await h.cleanup();
  });
});

describe("setting one", () => {
  test("changing your OWN level re-reads the mirror immediately", async () => {
    const h = await makeHarness();
    await withTeam(h, { role: "owner" });
    h.api.setGrant.mockResolvedValue({});
    h.api.listGrants.mockResolvedValue({ grants: [{ folderId: "t1", access: "read" }], defaults: { member: "write" } });
    await h.sync.setGrant("t1", "t1", "me", "read");
    expect(await h.syncStore.getGrants("t1")).toEqual({ t1: "read" });
    await h.cleanup();
  });

  test("changing someone else's does not — their client is told by its own resync", async () => {
    const h = await makeHarness();
    await withTeam(h, { role: "owner" });
    h.api.setGrant.mockResolvedValue({});
    await h.sync.setGrant("t1", "t1", "them", "read");
    expect(h.api.listGrants).not.toHaveBeenCalled();
    await h.cleanup();
  });

  test('"inherit" clears rather than storing a level', async () => {
    const h = await makeHarness();
    await withTeam(h, { role: "owner" });
    h.api.clearGrant.mockResolvedValue(null);
    await h.sync.setGrant("t1", "raids", "them", "inherit");
    expect(h.api.clearGrant).toHaveBeenCalledWith("t1", "raids", "them");
    expect(h.api.setGrant).not.toHaveBeenCalled();
    await h.cleanup();
  });
});
