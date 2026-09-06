"use strict";
const { uuid, nowIso, inviteCode, json, errorResponse } = require("./db");
const { readJson } = require("./auth");
const { checkRateLimit } = require("./ratelimit");
const { ACCESS_VALUES, isAccess, DEFAULT_FOR_ROLE, EVERYONE } = require("./access");

const MAX_TEAM_NAME = 80;
const JOIN_LIMIT_PER_MIN = 10;
// Team creation is cheap for us but unbounded creation is a capacity/abuse
// problem, so it gets its own per-user hourly ceiling. Well above anything a
// human does by hand (the migration flow creates at most one).
const CREATE_LIMIT_PER_HOUR = 20;
const INVITE_ATTEMPTS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = new Set(["owner", "member"]); // must stay in sync with the memberships.role CHECK constraint

// D1/SQLite report a UNIQUE violation as e.g.
//   "D1_ERROR: UNIQUE constraint failed: teams.invite_code: SQLITE_CONSTRAINT"
// so the offending column is recoverable from the message. Anything we cannot
// positively identify is treated as "not a collision" and propagates.
function uniqueViolationTarget(err) {
  const msg = String((err && err.message) || err || "");
  const m = /UNIQUE constraint failed:\s*([A-Za-z0-9_.,\s]+)/i.exec(msg);
  return m ? m[1].trim() : "";
}
function isInviteCodeCollision(err) {
  return /\bteams\.invite_code\b/i.test(uniqueViolationTarget(err));
}
function isTeamIdCollision(err) {
  return /\bteams\.(id|rowid)\b/i.test(uniqueViolationTarget(err));
}

// Runs `attempt(code)` with a fresh invite code, retrying ONLY on an
// invite_code UNIQUE violation. Every other error propagates on the first try.
async function withInviteCode(attempt) {
  let lastErr;
  for (let i = 0; i < INVITE_ATTEMPTS; i += 1) {
    try {
      return await attempt(inviteCode());
    } catch (err) {
      if (!isInviteCodeCollision(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

function teamWire(row, { includeInvite }) {
  const t = { id: row.id, name: row.name, seq: row.seq, createdAt: row.created_at };
  if (includeInvite) t.inviteCode = row.invite_code;
  return t;
}

function cleanName(raw) {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > MAX_TEAM_NAME) return null;
  return name;
}

async function requireMembership(env, teamId, userId) {
  const row = await env.SYNC_DB.prepare(
    `SELECT t.*, m.role, m.grants_seq FROM teams t JOIN memberships m ON m.team_id = t.id WHERE t.id = ? AND m.user_id = ?`
  ).bind(teamId, userId).first();
  if (!row) return null;
  const { role, grants_seq: grantsSeq, ...team } = row;
  // `grants_seq` sits alongside the role rather than inside `team`: it is this
  // member's stamp, not the team's. @see getChanges.
  return { team, role, grants_seq: Number.isInteger(grantsSeq) ? grantsSeq : 0 };
}

// POST /teams { name, id? }
// `id` lets a client migrating its old GitHub-org library keep the folder id it
// already has (so teammates re-link in place). It must look like a UUID and
// must not be taken; anything else is ignored / rejected.
async function createTeam(request, env, deps, auth) {
  const rl = await checkRateLimit(env.SYNC_RL, `create:${auth.user.id}`, CREATE_LIMIT_PER_HOUR, 3600, deps);
  if (!rl.ok) return errorResponse("rate_limited", "Too many teams created. Try again later.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
  const body = await readJson(request);
  const name = cleanName(body && body.name);
  if (!name) return errorResponse("invalid", `Team name must be 1–${MAX_TEAM_NAME} characters.`);
  const now = nowIso(deps);
  const requestedId = body && typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  if (requestedId) {
    const taken = await env.SYNC_DB.prepare("SELECT id FROM teams WHERE id = ?").bind(requestedId).first();
    if (taken) return errorResponse("conflict", "That team id is already in use.");
  }
  const id = requestedId || uuid();
  // Invite codes are UNIQUE; retry a couple of times on the (astronomically
  // rare) collision. The SELECT above is check-then-insert, so a concurrent
  // create of the same requested id still has to be caught here — and it must
  // surface as the same 409, because the client's adoption path keys on it.
  return withInviteCode(async (code) => {
    try {
      await env.SYNC_DB.batch([
        env.SYNC_DB.prepare("INSERT INTO teams (id, name, invite_code, seq, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)").bind(id, name, code, auth.user.id, now),
        env.SYNC_DB.prepare("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, auth.user.id, now),
      ]);
    } catch (err) {
      if (isTeamIdCollision(err)) return errorResponse("conflict", "That team id is already in use.");
      throw err; // invite-code collisions are retried by withInviteCode; everything else propagates
    }
    const row = await env.SYNC_DB.prepare("SELECT * FROM teams WHERE id = ?").bind(id).first();
    return json({ team: teamWire(row, { includeInvite: true }), role: "owner" }, 201);
  });
}

// POST /teams/join { inviteCode }
async function joinTeam(request, env, deps, auth) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rl = await checkRateLimit(env.SYNC_RL, `join:${ip}`, JOIN_LIMIT_PER_MIN, 60, deps);
  if (!rl.ok) return errorResponse("rate_limited", "Too many join attempts. Try again shortly.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
  const body = await readJson(request);
  const code = body && typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";
  if (!code) return errorResponse("invalid", "Missing invite code.");
  const row = await env.SYNC_DB.prepare("SELECT * FROM teams WHERE invite_code = ?").bind(code).first();
  if (!row) return errorResponse("not_found", "No team with that invite code.");
  const existing = await requireMembership(env, row.id, auth.user.id);
  if (existing) return json({ team: teamWire(row, { includeInvite: existing.role === "owner" }), role: existing.role });
  await env.SYNC_DB.prepare("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(row.id, auth.user.id, nowIso(deps)).run();
  return json({ team: teamWire(row, { includeInvite: false }), role: "member" });
}

// GET /teams
async function listTeams(_request, env, _deps, auth) {
  const { results } = await env.SYNC_DB.prepare(
    `SELECT t.*, m.role FROM teams t JOIN memberships m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.created_at`
  ).bind(auth.user.id).all();
  return json(results.map((r) => ({ team: teamWire(r, { includeInvite: r.role === "owner" }), role: r.role })));
}

async function ownerOnly(env, teamId, auth) {
  const m = await requireMembership(env, teamId, auth.user.id);
  if (!m) return { error: errorResponse("forbidden", "You are not a member of this team.") };
  if (m.role !== "owner") return { error: errorResponse("forbidden", "Only a team owner can do that.") };
  return { membership: m };
}

// PATCH /teams/:teamId { name }
async function renameTeam(request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  const body = await readJson(request);
  const name = cleanName(body && body.name);
  if (!name) return errorResponse("invalid", `Team name must be 1–${MAX_TEAM_NAME} characters.`);
  await env.SYNC_DB.prepare("UPDATE teams SET name = ? WHERE id = ?").bind(name, params.teamId).run();
  const row = await env.SYNC_DB.prepare("SELECT * FROM teams WHERE id = ?").bind(params.teamId).first();
  return json({ team: teamWire(row, { includeInvite: true }), role: "owner" });
}

// DELETE /teams/:teamId — hard delete; FK cascades remove memberships + items.
async function deleteTeam(_request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  await env.SYNC_DB.batch([
    env.SYNC_DB.prepare("DELETE FROM items WHERE team_id = ?").bind(params.teamId),
    env.SYNC_DB.prepare("DELETE FROM memberships WHERE team_id = ?").bind(params.teamId),
    env.SYNC_DB.prepare("DELETE FROM teams WHERE id = ?").bind(params.teamId),
  ]);
  return new Response(null, { status: 204 });
}

// GET /teams/:teamId/members
async function listMembers(_request, env, _deps, auth, params) {
  const m = await requireMembership(env, params.teamId, auth.user.id);
  if (!m) return errorResponse("forbidden", "You are not a member of this team.");
  const { results } = await env.SYNC_DB.prepare(
    `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.avatar_url,
            (SELECT login FROM identities i WHERE i.user_id = u.id ORDER BY i.provider = 'github' DESC LIMIT 1) AS login
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ? ORDER BY m.joined_at, m.rowid`
  ).bind(params.teamId).all();
  return json(results.map((r) => ({ userId: r.user_id, login: r.login, displayName: r.display_name, avatarUrl: r.avatar_url, role: r.role, joinedAt: r.joined_at })));
}

// DELETE /teams/:teamId/members/:userId — owner removes anyone; anyone removes self (leave).
async function removeMember(_request, env, _deps, auth, params) {
  const me = await requireMembership(env, params.teamId, auth.user.id);
  if (!me) return errorResponse("forbidden", "You are not a member of this team.");
  const isSelf = params.userId === auth.user.id;
  if (!isSelf && me.role !== "owner") return errorResponse("forbidden", "Only a team owner can remove members.");
  const target = await requireMembership(env, params.teamId, params.userId);
  if (!target) return errorResponse("not_found", "That user is not a member.");
  if (target.role === "owner") {
    const owners = await env.SYNC_DB.prepare("SELECT COUNT(*) AS c FROM memberships WHERE team_id = ? AND role = 'owner'").bind(params.teamId).first("c");
    if (owners <= 1) return errorResponse("forbidden", "The last owner cannot leave. Promote another member to owner first, or delete the team.");
  }
  await env.SYNC_DB.prepare("DELETE FROM memberships WHERE team_id = ? AND user_id = ?").bind(params.teamId, params.userId).run();
  return new Response(null, { status: 204 });
}

// POST /teams/:teamId/invite/rotate
async function rotateInvite(_request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  return withInviteCode(async (code) => {
    await env.SYNC_DB.prepare("UPDATE teams SET invite_code = ? WHERE id = ?").bind(code, params.teamId).run();
    return json({ inviteCode: code });
  });
}

// PATCH /teams/:teamId/members/:userId { role } — owner-only role change.
// Without this a sole owner is trapped: removeMember refuses to drop the last
// owner, so their only exit is deleting the team (and everyone's data with it).
async function setMemberRole(request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  const body = await readJson(request);
  const role = body && typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
  if (!ROLES.has(role)) return errorResponse("invalid", "role must be \"owner\" or \"member\".");
  const target = await requireMembership(env, params.teamId, params.userId);
  if (!target) return errorResponse("not_found", "That user is not a member.");
  if (target.role === role) return json({ userId: params.userId, role });
  if (target.role === "owner") {
    const owners = await env.SYNC_DB.prepare("SELECT COUNT(*) AS c FROM memberships WHERE team_id = ? AND role = 'owner'").bind(params.teamId).first("c");
    if (owners <= 1) return errorResponse("forbidden", "The last owner cannot be demoted. Promote another member first.");
  }
  await env.SYNC_DB.prepare("UPDATE memberships SET role = ? WHERE team_id = ? AND user_id = ?").bind(role, params.teamId, params.userId).run();
  return json({ userId: params.userId, role });
}

// ── Per-folder grants ────────────────────────────────────────────────────────
//
// See workers/sync/src/access.js for how a grant is resolved. These three
// endpoints are the whole write surface: an owner sets one, clears one, or reads
// the list. Everything else derives from that.

/**
 * Stamp the team's current seq onto a member so their next incremental pull is
 * told to resync.
 *
 * Losing read access is invisible to the changes feed — the items did not
 * change, they simply stop being handed out — so without this the client would
 * keep every copy it already had until something unrelated happened to touch it.
 * Same mechanism as `purged_seq`; @see getChanges.
 */
function invalidateGrants(env, teamId, userId) {
  const stampAll = userId === EVERYONE;
  return [
    env.SYNC_DB.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(teamId),
    // A blanket grant moved everyone's floor, so everyone has to be told —
    // stamping only the named user would strand the whole team but one.
    stampAll
      ? env.SYNC_DB.prepare(
        "UPDATE memberships SET grants_seq = (SELECT seq FROM teams WHERE id = ?) WHERE team_id = ?"
      ).bind(teamId, teamId)
      : env.SYNC_DB.prepare(
        "UPDATE memberships SET grants_seq = (SELECT seq FROM teams WHERE id = ?) WHERE team_id = ? AND user_id = ?"
      ).bind(teamId, teamId, userId),
  ];
}

// GET /teams/:teamId/grants — owners see the whole team's, a member sees only
// their own. A member is shown their own restrictions on purpose: the client
// greys out what the server would refuse, and cannot do that blind.
async function listGrants(_request, env, _deps, auth, params) {
  const me = await requireMembership(env, params.teamId, auth.user.id);
  if (!me) return errorResponse("forbidden", "You are not a member of this team.");
  const isOwner = me.role === "owner";
  const sql = `SELECT g.folder_id, g.user_id, g.access, g.granted_by, g.granted_at,
                      (SELECT login FROM identities i WHERE i.user_id = g.user_id ORDER BY i.provider = 'github' DESC LIMIT 1) AS login
                 FROM folder_grants g
                WHERE g.team_id = ?${isOwner ? "" : ` AND g.user_id IN (?, '${EVERYONE}')`}
                ORDER BY g.granted_at`;
  const stmt = isOwner
    ? env.SYNC_DB.prepare(sql).bind(params.teamId)
    : env.SYNC_DB.prepare(sql).bind(params.teamId, auth.user.id);
  const { results } = await stmt.all();
  return json({
    // The level everyone falls back to, so the client can label "inherited"
    // without hard-coding a rule that lives on the server.
    defaults: DEFAULT_FOR_ROLE,
    grants: results.map((r) => ({
      folderId: r.folder_id,
      userId: r.user_id,
      login: r.login,
      access: r.access,
      grantedBy: r.granted_by,
      grantedAt: r.granted_at,
    })),
  });
}

// PUT /teams/:teamId/grants/:folderId/:userId { access }
// `access: "inherit"` removes the grant, which is not the same as "none" —
// inherit falls back to the nearest ancestor, none is an explicit block.
async function setGrant(request, env, deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  const body = await readJson(request);
  const raw = body && typeof body.access === "string" ? body.access.trim().toLowerCase() : "";
  if (raw === "inherit") return clearGrant(request, env, deps, auth, params);
  if (!isAccess(raw)) return errorResponse("invalid", `access must be one of ${ACCESS_VALUES.join(", ")} or "inherit".`);

  // '*' is the folder's blanket level rather than a person, so there is nobody
  // to check for membership — and no owner to protect, since an owner's access
  // is decided by their role before any grant is consulted.
  if (params.userId !== EVERYONE) {
    const target = await requireMembership(env, params.teamId, params.userId);
    if (!target) return errorResponse("not_found", "That user is not a member.");
    // An owner can hand out and take back any grant in the team, so a grant that
    // appeared to restrict one would be a lie. Say so rather than storing it.
    if (target.role === "owner") return errorResponse("invalid", "Owners always have full access. Make them a member first.");
  }

  // The team's own id is the root: a grant there is the team-wide default for
  // this person. Anything else has to be a folder that really exists here.
  if (params.folderId !== params.teamId) {
    const folder = await env.SYNC_DB.prepare(
      "SELECT type FROM items WHERE team_id = ? AND id = ? AND deleted = 0"
    ).bind(params.teamId, params.folderId).first();
    if (!folder || folder.type !== "folder") return errorResponse("not_found", "No such folder in this team.");
  }

  await env.SYNC_DB.batch([
    env.SYNC_DB.prepare(
      `INSERT INTO folder_grants (team_id, folder_id, user_id, access, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (team_id, folder_id, user_id)
       DO UPDATE SET access = excluded.access, granted_by = excluded.granted_by, granted_at = excluded.granted_at`
    ).bind(params.teamId, params.folderId, params.userId, raw, auth.user.id, nowIso(deps)),
    ...invalidateGrants(env, params.teamId, params.userId),
  ]);
  return json({ folderId: params.folderId, userId: params.userId, access: raw });
}

// DELETE /teams/:teamId/grants/:folderId/:userId — back to inherited.
async function clearGrant(_request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  await env.SYNC_DB.batch([
    env.SYNC_DB.prepare("DELETE FROM folder_grants WHERE team_id = ? AND folder_id = ? AND user_id = ?")
      .bind(params.teamId, params.folderId, params.userId),
    // Bumped even when nothing was deleted: a no-op resync costs one extra
    // page, and getting this wrong the other way silently strands a client.
    ...invalidateGrants(env, params.teamId, params.userId),
  ]);
  return new Response(null, { status: 204 });
}

module.exports = { createTeam, joinTeam, listTeams, renameTeam, deleteTeam, listMembers, removeMember, setMemberRole, rotateInvite, requireMembership, listGrants, setGrant, clearGrant, MAX_TEAM_NAME };
