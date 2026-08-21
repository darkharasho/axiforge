"use strict";
const { uuid, nowIso, sha256Hex, randomToken, json, errorResponse } = require("./db");

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, sliding
const SESSION_BUMP_MS = 60 * 60 * 1000;          // bump expiry at most hourly

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function publicUser(row) {
  return { id: row.id, login: row.login, displayName: row.display_name, avatarUrl: row.avatar_url || null };
}

// POST /auth/github { token } — verify with GitHub, upsert user+identity, mint session.
async function handleGithubLogin(request, env, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const body = await readJson(request);
  const token = body && typeof body.token === "string" ? body.token : "";
  if (!token) return errorResponse("invalid", "Missing GitHub token.");

  const ghRes = await fetchImpl("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "axiforge-sync",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!ghRes.ok) return errorResponse("unauthorized", "GitHub rejected the token.");
  const gh = await ghRes.json();
  if (!gh || typeof gh.id !== "number" || !gh.login) return errorResponse("unauthorized", "GitHub returned no user.");

  const db = env.SYNC_DB;
  const now = nowIso(deps);
  const providerUserId = String(gh.id);
  const displayName = String(gh.name || gh.login).slice(0, 120);
  const avatarUrl = typeof gh.avatar_url === "string" ? gh.avatar_url.slice(0, 500) : null;

  let ident = await db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_user_id = ?").bind(providerUserId).first();
  let userId;
  if (ident) {
    userId = ident.user_id;
    await db.batch([
      db.prepare("UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?").bind(displayName, avatarUrl, userId),
      db.prepare("UPDATE identities SET login = ? WHERE provider = 'github' AND provider_user_id = ?").bind(gh.login, providerUserId),
    ]);
  } else {
    userId = uuid();
    await db.batch([
      db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?)").bind(userId, displayName, avatarUrl, now),
      db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(providerUserId, userId, gh.login),
    ]);
  }

  const sessionToken = randomToken();
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date((deps.now || Date.now)() + SESSION_TTL_MS).toISOString();
  const clientLabel = (request.headers.get("user-agent") || "").slice(0, 120) || null;
  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, client_label, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(tokenHash, userId, clientLabel, now, now, expiresAt).run();

  return json({ sessionToken, user: { id: userId, login: gh.login, displayName, avatarUrl } });
}

// Resolve `Authorization: Bearer <token>` → { user, sessionHash } or null.
async function authenticate(request, env, deps = {}) {
  const header = request.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1]);
  const row = await env.SYNC_DB.prepare(
    `SELECT s.token_hash, s.last_used_at, s.expires_at, u.id, u.display_name, u.avatar_url, i.login
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN identities i ON i.user_id = u.id
      WHERE s.token_hash = ?
      ORDER BY i.provider = 'github' DESC
      LIMIT 1`
  ).bind(tokenHash).first();
  if (!row) return null;
  const nowMs = (deps.now || Date.now)();
  if (Date.parse(row.expires_at) <= nowMs) {
    await env.SYNC_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  if (nowMs - Date.parse(row.last_used_at) >= SESSION_BUMP_MS) {
    const iso = new Date(nowMs).toISOString();
    await env.SYNC_DB.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(iso, new Date(nowMs + SESSION_TTL_MS).toISOString(), tokenHash).run();
  }
  return { user: publicUser(row), sessionHash: tokenHash };
}

// DELETE /auth/session
async function handleLogout(_request, env, _deps, auth) {
  await env.SYNC_DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.sessionHash).run();
  return new Response(null, { status: 204 });
}

module.exports = { handleGithubLogin, authenticate, handleLogout, publicUser, readJson, SESSION_TTL_MS, SESSION_BUMP_MS };
