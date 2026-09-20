"use strict";
// The team's publish target, from the server to the root folder on disk.
//
// Publishing reads the target off the root folder rather than asking the sync
// server, so it keeps working offline and does not pay a round trip per publish.
// That makes the mirror the whole feature: if it goes stale, a member publishes
// the team's work to the wrong GitHub account and it still looks like it worked.

const { makeHarness } = require("../helpers/teamSyncHarness");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const team = (over = {}) => ({
  team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 1, ...over },
  role: over.role || "owner",
});

async function root() {
  return (await h.folderStore.listFolders()).find((f) => f.id === "team-1");
}

describe("TeamSync — team publish target", () => {
  test("listTeams mirrors the team's publish owner onto its root folder", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    expect(await root()).toMatchObject({ publishOwner: "gw2eww", publishOwnerType: "org" });
  });

  test("a team with no target leaves the folder without one", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team()]);
    await h.sync.listTeams();
    const folder = await root();
    expect(folder.publishOwner).toBeUndefined();
    expect(folder.publishOwnerType).toBeUndefined();
  });

  // The reason the mirror exists at all: an owner clearing the target has to
  // reach every member, or they keep publishing to an org the team has left.
  test("clearing it on the server clears it on the folder", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    h.api.listTeams.mockResolvedValue([team()]);
    await h.sync.listTeams();
    const folder = await root();
    expect(folder.publishOwner).toBeUndefined();
    expect(folder.publishOwnerType).toBeUndefined();
  });

  test("changing it to another owner rewrites both fields", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "vette", publishOwnerType: "user" })]);
    await h.sync.listTeams();
    expect(await root()).toMatchObject({ publishOwner: "vette", publishOwnerType: "user" });
  });

  // listTeams runs on every 30s poll tick; R5 forbids it from touching folders
  // that did not change. The publish fields must not undo that.
  test("an unchanged target does not bump updatedAt", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    const before = (await root()).updatedAt;
    await h.sync.listTeams();
    expect((await root()).updatedAt).toBe(before);
  });

  test("setPublishOwner writes through to the folder without waiting for a poll", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team()]);
    await h.sync.listTeams();
    h.api.setTeamPublishOwner.mockResolvedValue({
      team: { id: "team-1", name: "EWW", publishOwner: "gw2eww", publishOwnerType: "org" },
      role: "owner",
    });
    await h.sync.setPublishOwner("team-1", "gw2eww", "org");
    expect(h.api.setTeamPublishOwner).toHaveBeenCalledWith("team-1", "gw2eww", "org");
    expect(await root()).toMatchObject({ publishOwner: "gw2eww", publishOwnerType: "org", teamId: "team-1", role: "owner" });
  });

  test("setPublishOwner(null) clears it locally too", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    h.api.setTeamPublishOwner.mockResolvedValue({ team: { id: "team-1", name: "EWW" }, role: "owner" });
    await h.sync.setPublishOwner("team-1", null);
    expect(h.api.setTeamPublishOwner).toHaveBeenCalledWith("team-1", null, "user");
    expect((await root()).publishOwner).toBeUndefined();
  });

  // What is left after a detach is a personal folder. One that still pointed at
  // the team's org would publish there with nothing on screen to explain why.
  test("leaving the team drops the target from the folder", async () => {
    h = await makeHarness();
    h.api.listTeams.mockResolvedValue([team({ publishOwner: "gw2eww", publishOwnerType: "org" })]);
    await h.sync.listTeams();
    h.api.listTeams.mockResolvedValue([]);
    await h.sync.listTeams();
    const folder = await root();
    expect(folder.teamId).toBeUndefined();
    expect(folder.publishOwner).toBeUndefined();
    expect(folder.publishOwnerType).toBeUndefined();
  });
});
