"use strict";
const { uuid, nowIso, inviteCode, json, errorResponse } = require("./db");
const { readJson } = require("./auth");
const { checkRateLimit } = require("./ratelimit");

const MAX_TEAM_NAME = 80;
const JOIN_LIMIT_PER_MIN = 10;

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
    `SELECT t.*, m.role FROM teams t JOIN memberships m ON m.team_id = t.id WHERE t.id = ? AND m.user_id = ?`
  ).bind(teamId, userId).first();
  if (!row) return null;
  const { role, ...team } = row;
  return { team, role };
}

// POST /teams { name }
async function createTeam(request, env, deps, auth) {
  const body = await readJson(request);
  const name = cleanName(body && body.name);
  if (!name) return errorResponse("invalid", `Team name must be 1–${MAX_TEAM_NAME} characters.`);
  const now = nowIso(deps);
  const id = uuid();
  // Invite codes are UNIQUE; retry a couple of times on the (astronomically rare) collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = inviteCode();
    try {
      await env.SYNC_DB.batch([
        env.SYNC_DB.prepare("INSERT INTO teams (id, name, invite_code, seq, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)").bind(id, name, code, auth.user.id, now),
        env.SYNC_DB.prepare("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, auth.user.id, now),
      ]);
      const row = await env.SYNC_DB.prepare("SELECT * FROM teams WHERE id = ?").bind(id).first();
      return json({ team: teamWire(row, { includeInvite: true }), role: "owner" }, 201);
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  return errorResponse("invalid", "Could not create team.", 500);
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
    if (owners <= 1) return errorResponse("forbidden", "The last owner cannot leave. Delete the team or promote someone first.");
  }
  await env.SYNC_DB.prepare("DELETE FROM memberships WHERE team_id = ? AND user_id = ?").bind(params.teamId, params.userId).run();
  return new Response(null, { status: 204 });
}

// POST /teams/:teamId/invite/rotate
async function rotateInvite(_request, env, _deps, auth, params) {
  const { error } = await ownerOnly(env, params.teamId, auth);
  if (error) return error;
  const code = inviteCode();
  await env.SYNC_DB.prepare("UPDATE teams SET invite_code = ? WHERE id = ?").bind(code, params.teamId).run();
  return json({ inviteCode: code });
}

module.exports = { createTeam, joinTeam, listTeams, renameTeam, deleteTeam, listMembers, removeMember, rotateInvite, requireMembership, MAX_TEAM_NAME };
