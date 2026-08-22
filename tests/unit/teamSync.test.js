"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { TeamSync } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

describe("TeamSync — session", () => {
  test("getSession reads auth.sync; enableWithGithub stores it; disable clears it and calls logout", async () => {
    h = await makeHarness({ session: null });
    expect(await h.sync.getSession()).toBeNull();
    h.api.loginGithub.mockResolvedValue({ sessionToken: "s1", user: { id: "u1", login: "vette", displayName: "V", avatarUrl: null } });
    const user = await h.sync.enableWithGithub("gh-token");
    expect(user.login).toBe("vette");
    expect(h.api.loginGithub).toHaveBeenCalledWith("gh-token");
    expect(await h.sync.getSession()).toEqual({ sessionToken: "s1", userId: "u1", login: "vette" });
    h.api.logout.mockResolvedValue(null);
    await h.sync.disable();
    expect(h.api.logout).toHaveBeenCalled();
    expect(await h.sync.getSession()).toBeNull();
  });

  test("disable tolerates a failing logout", async () => {
    h = await makeHarness();
    h.api.logout.mockRejectedValue(apiError("SYNC_OFFLINE"));
    await h.sync.disable();
    expect(await h.sync.getSession()).toBeNull();
  });
});

describe("TeamSync — teams ↔ root folders", () => {
  test("createTeam makes a root folder with id = team id", async () => {
    h = await makeHarness();
    h.api.createTeam.mockResolvedValue({ team: { id: "team-1", name: "EWW", inviteCode: "ABCDEFGHJK", seq: 0 }, role: "owner" });
    const out = await h.sync.createTeam("EWW");
    expect(out.team.inviteCode).toBe("ABCDEFGHJK");
    const folders = await h.folderStore.listFolders();
    expect(folders).toEqual([expect.objectContaining({ id: "team-1", name: "EWW", parentId: null, shared: true, teamId: "team-1", role: "owner" })]);
  });

  test("joinTeam makes the root folder and pulls once", async () => {
    h = await makeHarness();
    h.api.joinTeam.mockResolvedValue({ team: { id: "team-2", name: "Guild", seq: 0 }, role: "member" });
    await h.sync.joinTeam("abcdefghjk");
    expect(h.api.joinTeam).toHaveBeenCalledWith("abcdefghjk");
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ id: "team-2", teamId: "team-2", role: "member", shared: true });
    expect(h.api.changes).toHaveBeenCalledWith("team-2", 0, 200);
  });

  test("listTeams reconciles: creates missing roots, updates name/role, detaches teams no longer listed", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "old", name: "Old", shared: true, teamId: "old", role: "member" });
    await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "old" });
    await h.syncStore.setCursor("old", 5);
    h.api.listTeams.mockResolvedValue([
      { team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 3 }, role: "owner" },
    ]);
    const list = await h.sync.listTeams();
    expect(list).toEqual([{ team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 3 }, role: "owner" }]);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "team-1")).toMatchObject({ shared: true, teamId: "team-1", role: "owner", name: "EWW" });
    const old = folders.find((f) => f.id === "old");
    expect(old.shared).toBe(false);
    expect(old.teamId).toBeUndefined();
    expect(folders.find((f) => f.id === "sub").parentId).toBe("old"); // subtree kept as personal
    expect(await h.syncStore.listTeamIds()).not.toContain("old");
    expect(h.events).toContainEqual(expect.objectContaining({ channel: "sync-status", status: "detached", folderId: "old", name: "Old" }));
  });

  test("leaveTeam / deleteTeam detach locally (data kept as personal)", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "t" });
    h.api.removeMember.mockResolvedValue(null);
    await h.sync.leaveTeam("t");
    expect(h.api.removeMember).toHaveBeenCalledWith("t", "me");
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ shared: false });
    expect((await h.buildStore.listBuilds())[0].folderId).toBe("t");
    h.api.deleteTeam.mockResolvedValue(null);
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    await h.sync.deleteTeam("t");
    expect(h.api.deleteTeam).toHaveBeenCalledWith("t");
    expect((await h.folderStore.listFolders())[0].teamId).toBeUndefined();
  });

  test("renameTeam renames the root folder too", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    h.api.renameTeam.mockResolvedValue({ team: { id: "t", name: "New" }, role: "owner" });
    await h.sync.renameTeam("t", "New");
    expect((await h.folderStore.listFolders())[0].name).toBe("New");
  });
});

describe("TeamSync — mapping helpers and bodies", () => {
  test("teamRootFor walks parents; parentIdFor maps root → null", () => {
    const folders = [
      { id: "t", name: "T", parentId: null, shared: true, teamId: "t" },
      { id: "a", name: "A", parentId: "t" },
      { id: "b", name: "B", parentId: "a" },
      { id: "p", name: "P", parentId: null },
    ];
    const sync = new TeamSync({});
    expect(sync.teamRootFor("b", folders).id).toBe("t");
    expect(sync.teamRootFor("t", folders).id).toBe("t");
    expect(sync.teamRootFor("p", folders)).toBeNull();
    expect(sync.teamRootFor(null, folders)).toBeNull();
    expect(sync.rootFolderForTeam("t", folders).id).toBe("t");
    expect(sync.parentIdFor("t", "t")).toBeNull();
    expect(sync.parentIdFor("a", "t")).toBe("a");
  });

  test("teamRootFor terminates on a parentId cycle (R5)", () => {
    const folders = [
      { id: "x", name: "X", parentId: "y" },
      { id: "y", name: "Y", parentId: "x" },
    ];
    const sync = new TeamSync({});
    expect(sync.teamRootFor("x", folders)).toBeNull();
  });

  test("_ensureRootFolder does not bump updatedAt when name/role/teamId are unchanged (R5)", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([
      { team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 3 }, role: "owner" },
    ]);
    await h.sync.listTeams();
    const before = (await h.folderStore.listFolders()).find((f) => f.id === "team-1").updatedAt;
    await h.sync.listTeams();
    const after = (await h.folderStore.listFolders()).find((f) => f.id === "team-1").updatedAt;
    expect(after).toBe(before);
  });

  // ── SECURITY: an id match is not permission to absorb a folder ─────────────

  test("joining a team whose id collides with an ORDINARY personal folder does not absorb it", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "secret-id", name: "My private stuff" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "secret-id" });
    h.api.joinTeam.mockResolvedValue({ team: { id: "secret-id", name: "WvW Squad", seq: 0 }, role: "member" });
    h.api.changes.mockResolvedValue({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.joinTeam("ABCDEFGHJK");
    const folders = await h.folderStore.listFolders();
    const personal = folders.find((f) => f.id === "secret-id");
    expect(personal).toMatchObject({ name: "My private stuff" });
    expect(personal.teamId).toBeUndefined();
    expect(personal.shared).toBeFalsy();
    // a fresh root was created instead, with an id of its own
    const root = folders.find((f) => f.teamId === "secret-id");
    expect(root).toBeTruthy();
    expect(root.id).not.toBe("secret-id");
    expect(root).toMatchObject({ name: "WvW Squad", role: "member", shared: true });
    // the private build is still outside the team
    expect(h.sync.teamRootFor("secret-id", folders)).toBeNull();
  });

  test("a LEGACY org root with the same id is still adopted (the migration's re-link)", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "legacy-id", name: "Old shared", shared: true, orgName: "gw2eww" });
    h.api.joinTeam.mockResolvedValue({ team: { id: "legacy-id", name: "EWW", seq: 0 }, role: "member" });
    h.api.changes.mockResolvedValue({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.joinTeam("ABCDEFGHJK");
    const folders = await h.folderStore.listFolders();
    expect(folders.filter((f) => f.teamId === "legacy-id")).toHaveLength(1);
    expect(folders.find((f) => f.id === "legacy-id")).toMatchObject({ teamId: "legacy-id", role: "member" });
    expect(folders.find((f) => f.id === "legacy-id").orgName).toBeUndefined();
  });

  // ── _bulkUpload ────────────────────────────────────────────────────────────

  test("a 409 on the FIRST attempt re-sends the local body against the server version (m1)", async () => {
    h = await makeHarness();
    const items = [{ itemId: "b1", type: "build", parentId: null, body: { title: "local" }, baseVersion: null }];
    const calls = [];
    h.api.bulk.mockImplementation(async (_t, sent) => {
      calls.push(sent.map((i) => [i.itemId, i.baseVersion, i.body.title]));
      if (calls.length === 1) return { results: [{ itemId: "b1", status: 409, current: { version: 7, createdBy: { userId: "other" } } }] };
      return { results: [{ itemId: "b1", status: 200, version: 8 }] };
    });
    const out = await h.sync._bulkUpload("t1", items);
    expect(calls).toEqual([[["b1", null, "local"]], [["b1", 7, "local"]]]);
    expect(out).toMatchObject({ uploaded: 1, failed: [] });
    expect(await h.syncStore.getVersion("t1", "b1")).toMatchObject({ version: 8 });
  });

  test("a 409 on the RE-SEND keeps the server copy so a re-run stays idempotent", async () => {
    h = await makeHarness();
    const items = [{ itemId: "b1", type: "build", parentId: null, body: { title: "local" }, baseVersion: null }];
    h.api.bulk.mockImplementation(async () => ({ results: [{ itemId: "b1", status: 409, current: { version: 7, createdBy: { userId: "other" } } }] }));
    const out = await h.sync._bulkUpload("t1", items);
    expect(h.api.bulk).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ uploaded: 1, failed: [] });
    expect(await h.syncStore.getVersion("t1", "b1")).toMatchObject({ version: 7, createdBy: "other" });
  });

  test("a whole-batch 413 is split and retried; only a lone item that 413s is unshippable (m5)", async () => {
    h = await makeHarness();
    const items = Array.from({ length: 4 }, (_, i) => ({ itemId: `b${i}`, type: "build", parentId: null, body: {}, baseVersion: null }));
    h.api.bulk.mockImplementation(async (_t, sent) => {
      if (sent.length > 1) throw h.apiError("SYNC_TOO_LARGE", { message: "Body too large" });
      if (sent[0].itemId === "b2") throw h.apiError("SYNC_TOO_LARGE", { message: "Body too large" });
      return { results: sent.map((i) => ({ itemId: i.itemId, status: 201, version: 1 })) };
    });
    const out = await h.sync._bulkUpload("t1", items, null, { skipOversize: true });
    expect(out.uploaded).toBe(3);
    expect(out.failed).toEqual([]);
    expect(out.skipped).toEqual([{ itemId: "b2", status: 413, message: "This item is too large for the sync server." }]);
    expect(out.uploadedIds.sort()).toEqual(["b0", "b1", "b3"]);
  });

  test("without skipOversize a 413 is still a hard failure (share path unchanged)", async () => {
    h = await makeHarness();
    const items = [{ itemId: "b1", type: "build", parentId: null, body: {}, baseVersion: null }];
    h.api.bulk.mockResolvedValue({ results: [{ itemId: "b1", status: 413, message: "Too large" }] });
    const out = await h.sync._bulkUpload("t1", items);
    expect(out.failed).toEqual([{ itemId: "b1", status: 413, message: "Too large" }]);
    expect(out.skipped).toEqual([]);
  });

  test("a throwing progress listener never fails an upload (M3)", async () => {
    h = await makeHarness();
    const items = [{ itemId: "b1", type: "build", parentId: null, body: {}, baseVersion: null }];
    h.api.bulk.mockResolvedValue({ results: [{ itemId: "b1", status: 201, version: 1 }] });
    const out = await h.sync._bulkUpload("t1", items, () => { throw new Error("Object has been destroyed"); });
    expect(out.uploaded).toBe(1);
  });

  test("bodies strip local-only fields and keep publish metadata", () => {
    const build = { id: "b", title: "B", folderId: "f", pinned: true, sortOrder: 3, compIds: ["c"], publishedFileId: "x", publishedOwner: "me", equipment: {} };
    expect(TeamSync.buildBody(build)).toEqual({ id: "b", title: "B", publishedFileId: "x", publishedOwner: "me", equipment: {} });
    const comp = { id: "c", name: "C", folderId: "f", sortOrder: 1, boonCoverageHtml: "<div/>", partyLines: [] };
    expect(TeamSync.compBody(comp)).toEqual({ id: "c", name: "C", partyLines: [] });
    expect(TeamSync.folderBody({ id: "f", name: "F", sortOrder: 2, parentId: "t", updatedAt: "x" })).toEqual({ name: "F", sortOrder: 2 });
  });
});
