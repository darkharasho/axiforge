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
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "b0" ? { itemId: "b0", status: 413, message: "too large" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.migrateOrgLibrary({ teamName: "gw2eww" });
    expect(out.failed).toEqual([{ itemId: "b0", status: 413, message: "too large" }]);
    const root = (await h.folderStore.listFolders()).find((f) => f.id === "root0");
    expect(root.teamId).toBeUndefined();
    expect(root.orgName).toBe("gw2eww");
    expect((await h.buildStore.getAuth()).sharedLibrary).toBeDefined();
    // the team we created in this call is rolled back so the migration can be re-run
    expect(h.api.deleteTeam).toHaveBeenCalledWith("root0");
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
