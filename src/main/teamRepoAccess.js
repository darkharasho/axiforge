"use strict";

/**
 * Who may push to a team's publish repo.
 *
 * A team publishes to one account (publishTarget.js), by default its creator's,
 * so a shared build has one link whoever edits it. For a member's publish to
 * land there, the member needs push access to <target>/axibuilds:
 *
 *   * The owner's app keeps the repo's collaborators in step with the team:
 *     every member is invited, and a member it invited who has left is removed.
 *     It only touches people it added itself, so collaborators added by hand
 *     stay put.
 *   * A member's app accepts the invite the first time it publishes there.
 *
 * Neither can be done by anyone else: only an admin of the repo can invite, and
 * only the invitee can accept. Until both have happened the member's publishes
 * are held, not sent to their own account.
 */

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/**
 * @param {object} deps
 * @param {() => Promise<{token: string, login: string}|null>} deps.getGithub
 * @param {() => Promise<Array<{team: object, role: string}>>} deps.listTeams
 * @param {(teamId: string) => Promise<Array<{login?: string}>>} deps.listMembers
 * @param {(teamId: string, owner: string, ownerType: string) => Promise<unknown>} deps.setPublishOwner
 * @param {object} deps.gh githubApi
 * @param {() => Promise<object|null>} deps.loadAdded  target login → logins this app invited
 * @param {(added: object) => Promise<void>} deps.saveAdded
 */
function createTeamRepoAccess({ getGithub, listTeams, listMembers, setPublishOwner, gh, loadAdded, saveAdded, now = Date.now, log = console }) {
  let lastSync = 0;
  let running = null;
  const canPush = new Set(); // targets this app has confirmed push access to

  /**
   * Bring every repo this user administers for a team in step with the team.
   * Throttled; `force` (a target just changed) skips the wait.
   */
  function syncCollaborators({ force = false } = {}) {
    if (running) return running;
    if (!force && now() - lastSync < SYNC_INTERVAL_MS) return Promise.resolve();
    lastSync = now();
    running = runSync().catch((err) => log.warn("[team-repo-access] sync failed:", err?.message || err))
      .finally(() => { running = null; });
    return running;
  }

  async function runSync() {
    const github = await getGithub();
    if (!github) return;
    const teams = await listTeams();
    // Several teams can share a target; who belongs there is their union, or
    // syncing one team would remove the members of another.
    const byTarget = new Map();
    for (const { team, role } of teams || []) {
      let owner = team.publishOwner;
      if (!owner) {
        // A team the server had no target for (an older server, or an owner
        // without a GitHub identity there). Its owner's app gives it theirs.
        if (role !== "owner") continue;
        await setPublishOwner(team.id, github.login, "user");
        owner = github.login;
      }
      // A person's repo is theirs alone to share; an org repo, any admin's.
      if (team.publishOwnerType !== "org" && !same(owner, github.login)) continue;
      if (role !== "owner") continue;
      const entry = byTarget.get(owner.toLowerCase()) || { owner, isOrg: team.publishOwnerType === "org", teamIds: [] };
      entry.teamIds.push(team.id);
      byTarget.set(owner.toLowerCase(), entry);
    }
    if (!byTarget.size) return;

    const added = { ...((await loadAdded()) || {}) };
    for (const { owner, isOrg, teamIds } of byTarget.values()) {
      try {
        added[owner.toLowerCase()] = await syncTarget(github, owner, isOrg, teamIds, added[owner.toLowerCase()] || []);
      } catch (err) {
        log.warn("[team-repo-access] couldn't update collaborators on", owner, err?.message || err);
      }
    }
    await saveAdded(added);
  }

  async function syncTarget(github, owner, isOrg, teamIds, previouslyAdded) {
    let repo;
    try {
      repo = await gh.getRepo(github.token, owner);
    } catch (err) {
      // Not created yet: the owner's first publish makes it, and the next sync
      // invites everyone.
      if (err?.status === 404) return previouslyAdded;
      throw err;
    }
    if (!repo?.permissions?.admin) return previouslyAdded;

    const want = new Map();
    for (const teamId of teamIds) {
      for (const m of (await listMembers(teamId)) || []) {
        if (m?.login && !same(m.login, owner) && !same(m.login, github.login)) want.set(m.login.toLowerCase(), m.login);
      }
    }
    const collaborators = await gh.listRepoCollaborators(github.token, owner);
    // In an org, members who can already push through the org need no invite.
    const pushers = isOrg ? await gh.listRepoCollaborators(github.token, owner, { affiliation: "all" }) : [];
    const invitations = await gh.listRepoInvitations(github.token, owner);
    const have = new Set([...collaborators, ...pushers, ...invitations.map((i) => i.login)].map((l) => l.toLowerCase()));

    const next = new Set(previouslyAdded.map((l) => l.toLowerCase()));
    for (const [key, login] of want) {
      if (have.has(key)) continue;
      try {
        await gh.addRepoCollaborator(github.token, owner, login);
        next.add(key);
      } catch (err) {
        // An org can forbid outside collaborators; one refusal shouldn't stop
        // the rest. The member's publishes wait with a message saying why.
        log.warn("[team-repo-access] couldn't add", login, "to", owner, err?.message || err);
      }
    }
    for (const key of [...next]) {
      if (want.has(key)) continue;
      const invite = invitations.find((i) => same(i.login, key));
      if (invite) await gh.deleteRepoInvitation(github.token, owner, invite.id);
      else if (collaborators.some((l) => same(l, key))) await gh.removeRepoCollaborator(github.token, owner, key);
      next.delete(key);
    }
    return [...next];
  }

  /**
   * Make sure this user can push to a team target that isn't theirs, accepting
   * a waiting invite if there is one. Throws PUBLISH_DISCONNECTED (held, retried
   * on focus) when it can't yet.
   */
  async function ensurePushAccess(github, owner, ownerType) {
    if (same(owner, github.login) || canPush.has(owner.toLowerCase())) return;
    let repo;
    try {
      repo = await gh.getRepo(github.token, owner);
    } catch (err) {
      if (err?.status !== 404) throw err;
      // An org repo is created by whoever publishes first, as it always was.
      if (ownerType === "org") return;
      throw coded(`Waiting for ${owner} to set up publishing. Their team's builds publish to their account.`, "PUBLISH_DISCONNECTED");
    }
    if (!repo?.permissions?.push) {
      const invite = await gh.findMyRepoInvitation(github.token, owner);
      if (!invite) {
        const who = ownerType === "org"
          ? `A team owner who administers it adds team members from AxiForge, or an admin of ${owner} can give you write access.`
          : `${owner}'s AxiForge adds team members the next time it's open.`;
        throw coded(`Waiting for access to ${owner}/axibuilds. ${who}`, "PUBLISH_DISCONNECTED");
      }
      await gh.acceptRepoInvitation(github.token, invite.id);
    }
    canPush.add(owner.toLowerCase());
  }

  return { syncCollaborators, ensurePushAccess, forget: (owner) => canPush.delete(String(owner).toLowerCase()) };
}

module.exports = { createTeamRepoAccess, SYNC_INTERVAL_MS };
