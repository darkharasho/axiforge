/** @jest-environment jsdom */
"use strict";
jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], teams: [], teamSession: null, outbox: {},
    folderSyncStatus: {}, buildSyncStatus: {}, compSyncStatus: {}, conflicts: {},
  },
}));
const { state } = require("../../../src/renderer/modules/state.js");
const teams = require("../../../src/renderer/modules/teams.js");

beforeEach(() => {
  state.folders = [
    { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" },
    { id: "a", name: "A", parentId: "t" },
    { id: "m", name: "Guild", parentId: null, shared: true, teamId: "m", role: "member" },
    { id: "p", name: "P", parentId: null },
  ];
  state.builds = [{ id: "b1", title: "My Build" }];
  state.comps = [{ id: "c1", name: "My Comp" }];
  state.folderSyncStatus = {};
  state.buildSyncStatus = {};
  state.compSyncStatus = {};
  state.conflicts = {};
  window.desktopApi = {
    getTeamSession: jest.fn(async () => ({ sessionToken: "s", userId: "u", login: "me" })),
    listTeams: jest.fn(async () => [{ team: { id: "t", name: "EWW" }, role: "owner" }]),
    listOutbox: jest.fn(async () => ({ t: [{ itemId: "b1", type: "build", op: "put", conflict: null }] })),
    listFolders: jest.fn(async () => state.folders),
  };
});

test("teamRootFor walks parents; isTeamOwner; teamLabel", () => {
  expect(teams.teamRootFor("a").id).toBe("t");
  expect(teams.teamRootFor("p")).toBeNull();
  expect(teams.teamRootFor(null)).toBeNull();
  expect(teams.isTeamOwner("a")).toBe(true);
  expect(teams.isTeamOwner("m")).toBe(false);
  expect(teams.isTeamOwner("p")).toBe(false);
  expect(teams.rootForTeam("m").name).toBe("Guild");
  expect(teams.rootForTeam("zzz")).toBeNull();
  expect(teams.teamLabel(state.folders[0])).toBe("Team: EWW · owner");
  expect(teams.teamLabel({ name: "Guild" })).toBe("Team: Guild · member");
});

test("loadTeamState populates session, teams, outbox and refreshes folders; tolerates no session", async () => {
  await teams.loadTeamState();
  expect(state.teamSession.login).toBe("me");
  expect(state.teams).toEqual([{ team: { id: "t", name: "EWW" }, role: "owner" }]);
  expect(state.outbox.t[0].itemId).toBe("b1");
  expect(window.desktopApi.listFolders).toHaveBeenCalled();
  window.desktopApi.getTeamSession.mockResolvedValue(null);
  await teams.loadTeamState();
  expect(state.teamSession).toBeNull();
  expect(state.teams).toEqual([]);
  expect(state.outbox).toEqual({});
  expect(window.desktopApi.listTeams).toHaveBeenCalledTimes(1);
});

test("loadTeamState survives a rejecting session/teams/outbox call", async () => {
  window.desktopApi.getTeamSession.mockRejectedValue(new Error("offline"));
  await expect(teams.loadTeamState()).resolves.toBeUndefined();
  expect(state.teamSession).toBeNull();

  window.desktopApi.getTeamSession.mockResolvedValue({ sessionToken: "s", userId: "u", login: "me" });
  window.desktopApi.listTeams.mockRejectedValue(new Error("offline"));
  window.desktopApi.listOutbox.mockRejectedValue(new Error("offline"));
  await teams.loadTeamState();
  expect(state.teams).toEqual([]);
  expect(state.outbox).toEqual({});
});

describe("seedSyncStatusFromOutbox", () => {
  test("seeds pending/conflict badges and conflict records for builds and comps", () => {
    state.outbox = {
      t: [
        { itemId: "b1", type: "build", op: "put", conflict: null },
        { itemId: "c1", type: "comp", op: "put", conflict: { updatedAt: "2026-08-21T00:00:00Z" } },
      ],
    };
    teams.seedSyncStatusFromOutbox();
    expect(state.buildSyncStatus).toEqual({ b1: "pending" });
    expect(state.compSyncStatus).toEqual({ c1: "conflict" });
    expect(state.conflicts["build:b1"]).toBeUndefined();
    expect(state.conflicts["comp:c1"]).toEqual({
      teamId: "t", itemId: "c1", type: "comp", title: "My Comp",
      current: { updatedAt: "2026-08-21T00:00:00Z" },
    });
  });

  test("seeds folder conflicts so a dismissed modal stays reachable after a restart", () => {
    state.outbox = { t: [{ itemId: "a", type: "folder", op: "put", conflict: { deleted: true } }] };
    teams.seedSyncStatusFromOutbox();
    expect(state.folderSyncStatus).toEqual({ a: "conflict" });
    expect(state.conflicts["folder:a"]).toEqual({
      teamId: "t", itemId: "a", type: "folder", title: "A", current: { deleted: true },
    });
  });

  test("does not seed a pending folder badge (nothing would ever clear it)", () => {
    state.outbox = { t: [{ itemId: "a", type: "folder", op: "put", conflict: null }] };
    teams.seedSyncStatusFromOutbox();
    expect(state.folderSyncStatus).toEqual({});
    expect(state.conflicts).toEqual({});
  });
});
