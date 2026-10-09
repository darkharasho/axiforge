"use strict";

// A team publishes to one account, by default its creator's, so a shared build
// keeps one link whoever edits it. That only works if every member can push
// there: the owner's app invites them, and a member's app accepts.

const { createTeamRepoAccess, SYNC_INTERVAL_MS } = require("../../src/main/teamRepoAccess");

const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });

function setup({ teams = [], members = {}, repos = {}, collaborators = [], orgPushers = [], invitations = [], myInvite = null, added = null, login = "owner" } = {}) {
  let t = 1_000_000;
  let saved = added;
  const gh = {
    getRepo: jest.fn(async (_token, owner) => {
      if (!(owner in repos)) throw notFound();
      return repos[owner];
    }),
    listRepoCollaborators: jest.fn(async (_t, _o, opts) => (opts?.affiliation === "all" ? [...collaborators, ...orgPushers] : collaborators)),
    listRepoInvitations: jest.fn(async () => invitations),
    addRepoCollaborator: jest.fn(async () => {}),
    removeRepoCollaborator: jest.fn(async () => {}),
    deleteRepoInvitation: jest.fn(async () => {}),
    findMyRepoInvitation: jest.fn(async () => myInvite),
    acceptRepoInvitation: jest.fn(async () => {}),
  };
  const deps = {
    getGithub: async () => ({ token: "tok", login }),
    listTeams: async () => teams,
    listMembers: jest.fn(async (teamId) => members[teamId] || []),
    setPublishOwner: jest.fn(async () => {}),
    gh,
    loadAdded: async () => saved,
    saveAdded: jest.fn(async (data) => { saved = data; }),
    now: () => t,
    log: { warn: jest.fn() },
  };
  const access = createTeamRepoAccess(deps);
  return { access, gh, deps, advance: (ms) => { t += ms; }, saved: () => saved };
}

const ADMIN = { permissions: { admin: true, push: true } };
const team = (id, over = {}) => ({ team: { id, publishOwner: "owner", publishOwnerType: "user", ...over }, role: "owner" });
const people = (...logins) => logins.map((login) => ({ login }));

describe("syncCollaborators (the owner's side)", () => {
  test("invites every member who isn't already there, and remembers who it invited", async () => {
    const { access, gh, saved } = setup({
      teams: [team("t1")],
      members: { t1: people("owner", "vette", "ge0rge", "iruixos") },
      repos: { owner: ADMIN },
      collaborators: ["vette"],
      invitations: [{ id: 7, login: "ge0rge" }],
    });
    await access.syncCollaborators({ force: true });
    expect(gh.addRepoCollaborator.mock.calls.map((c) => c[2])).toEqual(["iruixos"]);
    expect(saved()).toEqual({ owner: ["iruixos"] });
  });

  test("removes a member it invited once they leave; never anyone it didn't add", async () => {
    const { access, gh, saved } = setup({
      teams: [team("t1")],
      members: { t1: people("owner", "vette") },
      repos: { owner: ADMIN },
      collaborators: ["vette", "gone", "handpicked"],
      invitations: [{ id: 9, login: "pending-gone" }],
      added: { owner: ["vette", "gone", "pending-gone"] },
    });
    await access.syncCollaborators({ force: true });
    expect(gh.removeRepoCollaborator.mock.calls.map((c) => c[2])).toEqual(["gone"]);
    expect(gh.deleteRepoInvitation).toHaveBeenCalledWith("tok", "owner", 9);
    expect(saved()).toEqual({ owner: ["vette"] });
  });

  test("two teams sharing a target keep each other's members", async () => {
    const { access, gh } = setup({
      teams: [team("t1"), team("t2")],
      members: { t1: people("a"), t2: people("b") },
      repos: { owner: ADMIN },
      collaborators: ["a", "b"],
      added: { owner: ["a", "b"] },
    });
    await access.syncCollaborators({ force: true });
    expect(gh.removeRepoCollaborator).not.toHaveBeenCalled();
    expect(gh.addRepoCollaborator).not.toHaveBeenCalled();
  });

  test("leaves alone a person's repo that isn't this user's, and repos it can't administer", async () => {
    const { access, gh } = setup({
      teams: [team("t1", { publishOwner: "someone-else" }), team("t2", { publishOwner: "guild", publishOwnerType: "org" })],
      members: { t1: people("x"), t2: people("y") },
      repos: { guild: { permissions: { admin: false, push: true } } },
    });
    await access.syncCollaborators({ force: true });
    expect(gh.getRepo.mock.calls.map((c) => c[1])).toEqual(["guild"]);
    expect(gh.addRepoCollaborator).not.toHaveBeenCalled();
  });

  test("an org target skips members who already push through the org, and keeps going past a refusal", async () => {
    const { access, gh, saved } = setup({
      teams: [team("t1", { publishOwner: "guild", publishOwnerType: "org" })],
      members: { t1: people("owner", "orgmate", "outsider", "friend") },
      repos: { guild: ADMIN },
      orgPushers: ["orgmate"],
    });
    gh.addRepoCollaborator.mockImplementation(async (_t, _o, login) => {
      if (login === "outsider") throw Object.assign(new Error("outside collaborators not allowed"), { status: 403 });
    });
    await access.syncCollaborators({ force: true });
    expect(gh.addRepoCollaborator.mock.calls.map((c) => c[2])).toEqual(["outsider", "friend"]);
    expect(saved()).toEqual({ guild: ["friend"] });
  });

  test("a member's app never manages the repo", async () => {
    const { access, gh } = setup({
      teams: [{ ...team("t1"), role: "member" }],
      repos: { owner: ADMIN },
      login: "owner",
    });
    await access.syncCollaborators({ force: true });
    expect(gh.getRepo).not.toHaveBeenCalled();
  });

  test("a repo that doesn't exist yet is skipped until it does", async () => {
    const { access, gh } = setup({ teams: [team("t1")], members: { t1: people("x") } });
    await access.syncCollaborators({ force: true });
    expect(gh.addRepoCollaborator).not.toHaveBeenCalled();
  });

  test("a team with no target gets its owner's account", async () => {
    const { access, deps, gh } = setup({
      teams: [team("t1", { publishOwner: undefined, publishOwnerType: undefined })],
      members: { t1: people("x") },
      repos: { owner: ADMIN },
    });
    await access.syncCollaborators({ force: true });
    expect(deps.setPublishOwner).toHaveBeenCalledWith("t1", "owner", "user");
    expect(gh.addRepoCollaborator.mock.calls.map((c) => c[2])).toEqual(["x"]);
  });

  test("throttled unless forced", async () => {
    const { access, gh, advance } = setup({ teams: [team("t1")], repos: { owner: ADMIN } });
    await access.syncCollaborators({ force: true });
    await access.syncCollaborators();
    expect(gh.getRepo).toHaveBeenCalledTimes(1);
    advance(SYNC_INTERVAL_MS);
    await access.syncCollaborators();
    expect(gh.getRepo).toHaveBeenCalledTimes(2);
  });

  test("a failing repo is logged, not thrown", async () => {
    const { access, gh, deps } = setup({ teams: [team("t1")], repos: { owner: ADMIN } });
    gh.listRepoCollaborators.mockRejectedValue(new Error("boom"));
    await expect(access.syncCollaborators({ force: true })).resolves.toBeUndefined();
    expect(deps.log.warn).toHaveBeenCalled();
  });
});

describe("ensurePushAccess (a member's side)", () => {
  const me = { token: "tok", login: "vette" };

  test("its own account needs no check", async () => {
    const { access, gh } = setup();
    await access.ensurePushAccess(me, "Vette", "user");
    expect(gh.getRepo).not.toHaveBeenCalled();
  });

  test("push access passes, and is remembered", async () => {
    const { access, gh } = setup({ repos: { owner: { permissions: { push: true } } } });
    await access.ensurePushAccess(me, "owner", "user");
    await access.ensurePushAccess(me, "owner", "user");
    expect(gh.getRepo).toHaveBeenCalledTimes(1);
  });

  test("a waiting invite is accepted", async () => {
    const { access, gh } = setup({ repos: { owner: { permissions: { push: false } } }, myInvite: { id: 42 } });
    await access.ensurePushAccess(me, "owner", "user");
    expect(gh.acceptRepoInvitation).toHaveBeenCalledWith("tok", 42);
  });

  test("no access and no invite holds the publish", async () => {
    const { access } = setup({ repos: { owner: { permissions: { push: false } } } });
    await expect(access.ensurePushAccess(me, "owner", "user")).rejects.toMatchObject({
      code: "PUBLISH_DISCONNECTED", message: expect.stringMatching(/Waiting for access to owner\/axibuilds/),
    });
  });

  test("waiting on an org says who can grant access", async () => {
    const { access } = setup({ repos: { guild: { permissions: { push: false } } } });
    await expect(access.ensurePushAccess(me, "guild", "org")).rejects.toMatchObject({
      message: expect.stringMatching(/an admin of guild can give you write access/),
    });
  });

  test("an owner's repo that doesn't exist yet holds it; an org's is created as before", async () => {
    const { access } = setup();
    await expect(access.ensurePushAccess(me, "owner", "user")).rejects.toMatchObject({ code: "PUBLISH_DISCONNECTED" });
    await expect(access.ensurePushAccess(me, "guild", "org")).resolves.toBeUndefined();
  });
});
