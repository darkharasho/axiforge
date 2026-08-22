"use strict";
const { makeHarness } = require("../helpers/teamSyncHarness");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

async function seedLegacy(h, { roots = 1 } = {}) {
  const auth = await h.buildStore.getAuth();
  await h.buildStore.saveAuth({ ...auth, sharedLibrary: { orgName: "gw2eww", repoName: "axibuilds-shared", isOwner: true } });
  for (let r = 0; r < roots; r++) {
    await h.folderStore.upsertFolder({ id: `root${r}`, name: `Root ${r}`, shared: true, orgName: "gw2eww" });
    await h.folderStore.upsertFolder({ id: `root${r}-sub`, name: "Sub", parentId: `root${r}` });
    await h.buildStore.upsertBuild({ id: `b${r}`, title: `B${r}`, folderId: `root${r}-sub` });
    await h.compStore.upsertComp({ id: `c${r}`, name: `C${r}`, folderId: `root${r}` });
  }
}

describe("TeamSync — migration", () => {
  test("legacyStatus reports org folders with counts; false when nothing legacy", async () => {
    h = await makeHarness();
    expect((await h.sync.legacyStatus()).hasLegacy).toBe(false);
    await seedLegacy(h);
    const s = await h.sync.legacyStatus();
    expect(s).toEqual({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root 0", builds: 1, comps: 1 }] });
  });

  test("single root: team id = root folder id; items keep ids; folder flipped; auth.sharedLibrary cleared", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockImplementation(async (name) => ({ team: { id: "server-generated", name, inviteCode: "ABCDEFGHJK", seq: 0 }, role: "owner" }));
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    // createTeam is asked to reuse the root folder id so members re-link in place
    expect(h.api.createTeam).toHaveBeenCalledWith("gw2eww", { id: "root0" });
    expect(out.foldersMigrated).toBe(1);
    expect(out.failed).toEqual([]);
    const ids = h.api.bulk.mock.calls.flatMap(([, items]) => items.map((i) => [i.itemId, i.type, i.parentId]));
    expect(ids).toEqual(expect.arrayContaining([["root0-sub", "folder", null], ["b0", "build", "root0-sub"], ["c0", "comp", null]]));
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root).toMatchObject({ shared: true, teamId: out.teamId, role: "owner" });
    expect(root.orgName).toBeUndefined();
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeUndefined();
  });

  test("multiple roots into an existing team: each root becomes a folder item under the team root", async () => {
    h = await makeHarness();
    await seedLegacy(h, { roots: 2 });
    await h.folderStore.upsertFolder({ id: "team-x", name: "X", shared: true, teamId: "team-x", role: "owner" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamId: "team-x" });
    expect(h.api.createTeam).not.toHaveBeenCalled();
    expect(out.foldersMigrated).toBe(2);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "root0")).toMatchObject({ parentId: "team-x" });
    expect(folders.find((f) => f.id === "root1")).toMatchObject({ parentId: "team-x" });
    expect(folders.find((f) => f.id === "root0").teamId).toBeUndefined();
    const rootItems = h.api.bulk.mock.calls.flatMap(([, items]) => items).filter((i) => i.itemId === "root0" || i.itemId === "root1");
    expect(rootItems.map((i) => i.parentId)).toEqual([null, null]);
  });

  test("partial failure: folder not flipped, auth kept, failures reported", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockResolvedValue({});
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "b0" ? { itemId: "b0", status: 403, message: "nope" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    expect(out.failed).toEqual([{ itemId: "b0", status: 403, message: "nope" }]);
    expect(out.note).toMatch(/Nothing was moved/);
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.teamId).toBeUndefined();
    expect(root.orgName).toBe("gw2eww");
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeDefined();
    // the team we created in this call is rolled back so the migration can be re-run
    expect(h.api.deleteTeam).toHaveBeenCalledWith("root0");
  });

  test("a thrown upload error rolls back the created team and leaves local legacy state untouched", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockResolvedValue({});
    h.api.bulk.mockRejectedValue(h.apiError("SYNC_OFFLINE", { message: "Network error" }));
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toMatchObject({ code: "SYNC_OFFLINE" });
    expect(h.api.deleteTeam).toHaveBeenCalledWith("root0");
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.teamId).toBeUndefined();
    expect(root.orgName).toBe("gw2eww");
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeDefined();
  });

  test("a failed rollback surfaces so the user can delete the stray team by hand", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockRejectedValue(h.apiError("SYNC_OFFLINE", { message: "Network error" }));
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "b0" ? { itemId: "b0", status: 403, message: "nope" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toThrow(/gw2eww.*root0.*could not be removed/s);
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.teamId).toBeUndefined();
    expect(root.orgName).toBe("gw2eww");
  });

  test("a 409 on the reused team id falls back to the team we already own", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockRejectedValue(h.apiError("SYNC_CONFLICT", { message: "That team id is already in use." }));
    h.api.listTeams.mockResolvedValue([{ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" }]);
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    expect(out).toMatchObject({ teamId: "root0", failed: [], foldersMigrated: 1 });
    expect(h.api.deleteTeam).not.toHaveBeenCalled();
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root).toMatchObject({ shared: true, teamId: "root0", role: "owner" });
  });

  test("a 409 for a team we do NOT own is still a hard failure", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockRejectedValue(h.apiError("SYNC_CONFLICT", { message: "That team id is already in use." }));
    h.api.listTeams.mockResolvedValue([]);
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toMatchObject({ code: "SYNC_CONFLICT" });
    expect(h.api.bulk).not.toHaveBeenCalled();
    expect((await h.folderStore.listFolders()).find((f) => f.id === "root0").orgName).toBe("gw2eww");
  });

  test("a too-deep root is refused BEFORE any team is created", async () => {
    h = await makeHarness();
    await seedLegacy(h, { roots: 2 });
    await h.folderStore.upsertFolder({ id: "root0-grandchild", name: "Deep", parentId: "root0-sub" });
    const before = await h.folderStore.listFolders();
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toThrow(/nested too deeply/);
    expect(h.api.createTeam).not.toHaveBeenCalled();
    expect(h.api.bulk).not.toHaveBeenCalled();
    expect(await h.folderStore.listFolders()).toHaveLength(before.length);
  });

  test("rate limits are retried inside the migration upload (shared _bulkUpload path)", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    let calls = 0;
    h.api.bulk.mockImplementation(async (_t, items) => {
      calls += 1;
      if (calls === 1) throw h.apiError("SYNC_RATE_LIMITED", { retryAfterMs: 1000 });
      return { results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) };
    });
    const p = h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    // Let the first (rejecting) bulk call settle — the engine does real disk
    // I/O in between, so plain microtask ticks aren't enough.
    while (h.api.bulk.mock.calls.length < 1) await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await h.advance(1000);
    const out = await p;
    expect(calls).toBe(2);
    expect(out.failed).toEqual([]);
  });

  test("joining a team re-links a legacy root by id and clears its legacy fields", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.joinTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", seq: 0 }, role: "member" });
    h.api.changes.mockResolvedValue({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.joinTeam("ABCDEFGHJK");
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root).toMatchObject({ teamId: "root0", shared: true, role: "member" });
    expect(root.orgName).toBeUndefined();
    expect((await h.sync.legacyStatus()).folders).toEqual([]);
  });

  // ── M3 / m2: the migration must not be derailed by its callers ────────────

  test("a throwing progress listener cannot fail (and roll back) a successful migration", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockResolvedValue({});
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" }, () => { throw new Error("Object has been destroyed"); });
    expect(out.foldersMigrated).toBe(1);
    expect(h.api.deleteTeam).not.toHaveBeenCalled();
    expect((await h.folderStore.listFolders()).find((f) => f.id === "root0")).toMatchObject({ teamId: "root0" });
  });

  test("a second migration is refused while one is in flight (m2)", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    let release;
    const gate = new Promise((r) => { release = r; });
    h.api.bulk.mockImplementation(async (_t, items) => {
      await gate;
      return { results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) };
    });
    const first = h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    while (h.api.bulk.mock.calls.length < 1) await new Promise((r) => setImmediate(r));
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toThrow(/already running/);
    release();
    await first;
    // the guard is released again afterwards
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toThrow(/Nothing to migrate/);
  });

  test("listTeams() does not adopt or detach anything while a migration runs (M2)", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockResolvedValue({});
    h.api.listTeams.mockResolvedValue([{ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" }]);
    let seen = false;
    h.api.bulk.mockImplementation(async () => {
      if (!seen) {
        seen = true;
        // the user closes Settings and opens the Library mid-upload
        await h.sync.listTeams();
        throw h.apiError("SYNC_OFFLINE", { message: "Network error" });
      }
      return { results: [] };
    });
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toMatchObject({ code: "SYNC_OFFLINE" });
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    // the rolled-back team must not have left the legacy root pinned to it
    expect(root.teamId).toBeUndefined();
    expect(root.orgName).toBe("gw2eww");
    expect((await h.sync.legacyStatus()).folders).toEqual([{ id: "root0", name: "Root 0", builds: 1, comps: 1 }]);
  });

  test("legacy fields are restored if something adopted the root behind our back (M2)", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.deleteTeam.mockResolvedValue({});
    h.api.bulk.mockImplementation(async () => {
      // simulate the race the lock closes: something flipped the root to a team
      // root (and cleared its legacy fields) while we were uploading
      await h.folderStore.upsertFolder({ id: "root0", name: "gw2eww", shared: true, teamId: "root0", role: "owner" });
      await h.folderStore.clearLegacyFields("root0");
      throw h.apiError("SYNC_OFFLINE", { message: "Network error" });
    });
    await expect(h.sync.migrateOrgLibrary({ teamName: "gw2eww" })).rejects.toMatchObject({ code: "SYNC_OFFLINE" });
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.orgName).toBe("gw2eww");
    expect(root.teamId).toBeUndefined();
  });

  // ── M1: a failure into an EXISTING team must not leave items on the server ─

  test("a per-item failure into an existing team deletes everything this run uploaded", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    await h.folderStore.upsertFolder({ id: "team-x", name: "X", shared: true, teamId: "team-x", role: "owner" });
    h.api.deleteItem.mockResolvedValue({});
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "c0" ? { itemId: "c0", status: 403, message: "nope" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.migrateOrgLibrary({ teamId: "team-x" });
    expect(out.foldersMigrated).toBe(0);
    expect(out.note).toMatch(/removed again/);
    expect(h.api.deleteTeam).not.toHaveBeenCalled();
    // root0 + root0-sub + b0 all landed and must all come back out again
    const deleted = h.api.deleteItem.mock.calls.map(([, id]) => id).sort();
    expect(deleted).toEqual(["b0", "root0", "root0-sub"]);
    // …and their version records go with them
    for (const id of deleted) expect(await h.syncStore.getVersion("team-x", id)).toBeFalsy();
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.parentId).toBeNull();
    expect(root.orgName).toBe("gw2eww");
  });

  test("a thrown upload into an existing team deletes what it uploaded, and says so when it cannot", async () => {
    h = await makeHarness();
    await seedLegacy(h, { roots: 2 });
    await h.folderStore.upsertFolder({ id: "team-x", name: "X", shared: true, teamId: "team-x", role: "owner" });
    let n = 0;
    h.api.bulk.mockImplementation(async (_t, items) => {
      n += 1;
      if (n > 1) throw h.apiError("SYNC_OFFLINE", { message: "Network error" });
      return { results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) };
    });
    h.api.deleteItem.mockRejectedValue(h.apiError("SYNC_OFFLINE", { message: "Network error" }));
    const err = await h.sync.migrateOrgLibrary({ teamId: "team-x" }).catch((e) => e);
    expect(err.message).toMatch(/visible to your teammates/);
    expect(err.cause).toMatchObject({ code: "SYNC_OFFLINE" });
    expect(h.api.deleteItem).toHaveBeenCalled();
    expect(h.api.deleteTeam).not.toHaveBeenCalled();
  });

  // ── m5: oversize items are skipped, not fatal ─────────────────────────────

  test("an item the server refuses as too large is skipped and the rest migrates", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    h.api.createTeam.mockResolvedValue({ team: { id: "root0", name: "gw2eww", inviteCode: "X", seq: 0 }, role: "owner" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "b0" ? { itemId: "b0", status: 413, message: "Too large" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    expect(out.failed).toEqual([]);
    expect(out.skipped).toEqual([{ itemId: "b0", status: 413, message: "Too large" }]);
    expect(out.foldersMigrated).toBe(1);
    expect(out.note).toMatch(/too large/);
    expect(h.api.deleteTeam).not.toHaveBeenCalled();
    // the build stays on disk as local-only data (spec §5)
    expect((await h.buildStore.listBuilds()).find((b) => b.id === "b0")).toBeTruthy();
    expect(await h.syncStore.getVersion("root0", "b0")).toBeFalsy();
  });

  // ── m6: a nested legacy folder is still migratable ────────────────────────

  test("a nested legacy folder is reported, migratable, and keeps the legacy signal alive", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    await h.folderStore.upsertFolder({ id: "personal", name: "Personal" });
    // the legacy root ends up nested under a personal folder
    await h.folderStore.upsertFolder({ id: "root0", name: "Root 0", parentId: "personal", orgName: "gw2eww" });
    const status = await h.sync.legacyStatus();
    expect(status.folders.map((f) => f.id)).toEqual(["root0"]);
    // cleanupLegacyFolders must NOT throw the auth signal away while it is there
    await h.sync.cleanupLegacyFolders();
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeDefined();

    await h.folderStore.upsertFolder({ id: "team-x", name: "X", shared: true, teamId: "team-x", role: "owner" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const out = await h.sync.migrateOrgLibrary({ teamId: "team-x" });
    expect(out.foldersMigrated).toBe(1);
    // the nested root uploads directly under the team root, not under "personal"
    const sent = h.api.bulk.mock.calls.flatMap(([, items]) => items).find((i) => i.itemId === "root0");
    expect(sent.parentId).toBeNull();
    expect((await h.folderStore.listFolders()).find((f) => f.id === "root0")).toMatchObject({ parentId: "team-x" });
  });

  test("a legacy folder nested inside another legacy folder is not a root of its own", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    await h.folderStore.upsertFolder({ id: "root0-sub", name: "Sub", parentId: "root0", orgName: "gw2eww" });
    expect((await h.sync.legacyStatus()).folders.map((f) => f.id)).toEqual(["root0"]);
  });

  test("cleanupLegacyFolders clears orgName on folders that already live in a team", async () => {
    h = await makeHarness();
    await seedLegacy(h);
    // Simulate a half-migrated state: the root is a team root but still carries orgName.
    await h.folderStore.upsertFolder({ id: "root0", name: "Root 0", shared: true, teamId: "t1", role: "owner", orgName: "gw2eww" });
    await h.sync.cleanupLegacyFolders();
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "root0").orgName).toBeUndefined();
    // nothing legacy is left on disk, so the stale auth blob goes too
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeUndefined();
    expect((await h.sync.legacyStatus()).hasLegacy).toBe(false);
  });
});
