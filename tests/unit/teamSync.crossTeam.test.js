"use strict";
// One item id, two teams. The server keys items by (team, id), so the same id
// can be live in two teams at once — running the legacy-library migration from
// two machines did exactly that. Locally every store is keyed by id alone, so
// the copy can only sit under ONE team root. A pull used to settle that by
// whichever team happened to be pulled last: it re-parented the folder under
// its own root, and the other team — the one the teammates could see — lost it
// from this user's library without a trace.
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
function item(over) {
  return { id: "f1", type: "folder", parentId: null, body: { name: "Test Comp", sortOrder: 0 }, version: 1, seq: 1, deleted: false, createdBy: who("me"), updatedBy: who("me"), updatedAt: "2026-08-25T22:31:53.541Z", ...over };
}
// Team A owns f1 (and build b1 inside it) locally; team B is a second team the
// same user belongs to.
async function seed(h) {
  await h.folderStore.upsertFolder({ id: "A", name: "A", shared: true, teamId: "A", role: "owner" });
  await h.folderStore.upsertFolder({ id: "B", name: "B", shared: true, teamId: "B", role: "owner" });
  await h.folderStore.upsertFolder({ id: "f1", name: "Test Comp", parentId: "A" });
  await h.buildStore.upsertBuild({ id: "b1", title: "Build", folderId: "f1" });
  await h.syncStore.setVersion("A", "f1", { version: 1, createdBy: "me" });
  await h.syncStore.setVersion("A", "b1", { version: 1, createdBy: "me" });
}
const verdicts = (map) => async (_teamId, ids) => ({ statuses: Object.fromEntries(ids.map((id) => [id, map[id] || "missing"])) });
const parentOf = async (h, id) => (await h.folderStore.listFolders()).find((f) => f.id === id).parentId;

describe("TeamSync — an id that another team owns locally", () => {
  test("a copy still live in the owning team is not pulled away from it", async () => {
    h = await makeHarness();
    await seed(h);
    h.api.verifyItems.mockImplementation(verdicts({ f1: "live" }));
    h.api.changes.mockResolvedValueOnce({ items: [item()], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    expect(h.api.verifyItems).toHaveBeenCalledWith("A", ["f1"]);
    expect(await parentOf(h, "f1")).toBe("A");
    // Known, so a later full re-pull can place it if A lets go of it.
    expect(await h.syncStore.getVersion("B", "f1")).toEqual({ version: 1, createdBy: "u-me" });
  });

  test("the same holds when B's version is already recorded (a copy hijacked before the fix)", async () => {
    h = await makeHarness();
    await seed(h);
    await h.syncStore.setVersion("B", "f1", { version: 1, createdBy: "me" });
    h.api.verifyItems.mockImplementation(verdicts({ f1: "deleted" }));
    h.api.changes.mockResolvedValueOnce({ items: [item()], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    // A no longer has it, so this IS where it lives now — the echo check must
    // not short-circuit past the ownership question.
    expect(await parentOf(h, "f1")).toBe("B");
  });

  test("a real cross-team move (gone from the owning team) re-homes it, contents and all", async () => {
    h = await makeHarness();
    await seed(h);
    h.api.verifyItems.mockImplementation(verdicts({ f1: "deleted" }));
    h.api.changes.mockResolvedValueOnce({ items: [item()], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    expect(await parentOf(h, "f1")).toBe("B");
    expect((await h.buildStore.listBuilds()).find((b) => b.id === "b1").folderId).toBe("f1");
    expect(await h.syncStore.getVersion("A", "f1")).toBeNull();
  });

  test("no verdict from the server: nothing moves and the pull retries from that item", async () => {
    h = await makeHarness();
    await seed(h);
    h.api.verifyItems.mockRejectedValue(apiError("SYNC_OFFLINE"));
    h.api.changes.mockResolvedValueOnce({ items: [item({ seq: 4 })], nextSeq: 4, hasMore: false });
    await expect(h.sync.pullTeam("B")).rejects.toThrow(/PULL_APPLY_FAILED/);
    expect(await parentOf(h, "f1")).toBe("A");
    expect((await h.syncStore.getTeam("B")).cursor).toBe(3);
  });

  test("a new item whose parent another team owns is not slipped into that team's tree", async () => {
    h = await makeHarness();
    await seed(h);
    h.api.verifyItems.mockImplementation(verdicts({ f1: "live" }));
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "b2", type: "build", parentId: "f1", body: { id: "b2", title: "Theirs" } }),
    ], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    expect(h.api.verifyItems).toHaveBeenCalledWith("A", ["f1"]);
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
  });

  test("a tombstone from a team that does not own the local copy leaves it alone", async () => {
    h = await makeHarness();
    await seed(h);
    await h.syncStore.setVersion("B", "f1", { version: 1, createdBy: "me" });
    h.api.changes.mockResolvedValueOnce({ items: [item({ deleted: true, body: null, version: 2 })], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    expect(await parentOf(h, "f1")).toBe("A");
    expect((await h.buildStore.listBuilds()).map((b) => b.id)).toEqual(["b1"]);
    expect(await h.syncStore.getVersion("B", "f1")).toBeNull();
  });

  // A teammate moves f1 from A to B: a put lands in B, then a delete in A. Pull
  // B between the two and A still says live, so the put is held back; A's
  // tombstone then trashes the only local copy. B must be asked again.
  test("the move race: A's tombstone after B's held-back put re-pulls B, which places it", async () => {
    h = await makeHarness();
    await seed(h);
    h.api.verifyItems.mockImplementation(verdicts({ f1: "live" }));
    h.api.changes.mockResolvedValueOnce({ items: [item()], nextSeq: 1, hasMore: false });
    await h.sync.pullTeam("B");
    expect(await parentOf(h, "f1")).toBe("A");

    h.api.changes.mockImplementation(async (teamId, since) => {
      if (teamId === "A") return { items: [item({ deleted: true, body: null, version: 2, seq: 9 })], nextSeq: 9, hasMore: false };
      expect(since).toBe(0);
      return { items: [item()], nextSeq: 1, hasMore: false };
    });
    await h.sync.pullTeam("A");
    await h.sync._crossTeamRepulls();
    expect(await parentOf(h, "f1")).toBe("B");
    // Out of the trash with its contents, not a fresh empty folder.
    expect((await h.buildStore.listBuilds()).find((b) => b.id === "b1").folderId).toBe("f1");
    expect(await h.folderStore.listTrashedFolders()).toEqual([]);
  });
});
