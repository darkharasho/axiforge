"use strict";
// Routes /api/sync/*. Every handler has the signature
//   (request, env, deps, auth, params) → Response
// `deps` = { fetchImpl, now } for tests; `auth` = { user, sessionHash }.
const { json, errorResponse } = require("./db");
const auth = require("./auth");
const teams = require("./teams");
const items = require("./items");

const PREFIX = "/api/sync";

// [method, pattern, handler, requiresAuth]
const ROUTES = [
  ["POST",   /^\/auth\/github$/,                                 auth.handleGithubLogin, false],
  ["DELETE", /^\/auth\/session$/,                                auth.handleLogout,      true],
  ["POST",   /^\/teams$/,                                        teams.createTeam,       true],
  ["POST",   /^\/teams\/join$/,                                  teams.joinTeam,         true],
  ["GET",    /^\/teams$/,                                        teams.listTeams,        true],
  ["PATCH",  /^\/teams\/(?<teamId>[^/]+)$/,                      teams.renameTeam,       true],
  ["DELETE", /^\/teams\/(?<teamId>[^/]+)$/,                      teams.deleteTeam,       true],
  ["GET",    /^\/teams\/(?<teamId>[^/]+)\/members$/,             teams.listMembers,      true],
  ["DELETE", /^\/teams\/(?<teamId>[^/]+)\/members\/(?<userId>[^/]+)$/, teams.removeMember, true],
  ["POST",   /^\/teams\/(?<teamId>[^/]+)\/invite\/rotate$/,      teams.rotateInvite,     true],
  ["GET",    /^\/teams\/(?<teamId>[^/]+)\/changes$/,             items.getChanges,       true],
  ["PUT",    /^\/teams\/(?<teamId>[^/]+)\/items\/(?<itemId>[^/:]+)$/, items.putItem,      true],
  ["DELETE", /^\/teams\/(?<teamId>[^/]+)\/items\/(?<itemId>[^/:]+)$/, items.deleteItem,   true],
  ["POST",   /^\/teams\/(?<teamId>[^/]+)\/items:bulk$/,          items.bulkItems,        true],
];

async function handleSync(request, env, deps = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX + "/")) return null;
  const path = url.pathname.slice(PREFIX.length);
  const method = request.method.toUpperCase();

  try {
    let pathMatched = false;
    for (const [m, pattern, handler, requiresAuth] of ROUTES) {
      const match = path.match(pattern);
      if (!match) continue;
      pathMatched = true;
      if (m !== method) continue;
      let params;
      try {
        params = Object.fromEntries(Object.entries(match.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      } catch {
        return errorResponse("invalid", "Malformed URL.");
      }
      let session = null;
      if (requiresAuth) {
        session = await auth.authenticate(request, env, deps);
        if (!session) return errorResponse("unauthorized", "Sign in to sync teams.");
      }
      return await handler(request, env, deps, session, params);
    }
    if (pathMatched) return errorResponse("invalid", "Method not allowed.", 405);
    return errorResponse("not_found", "No such route.");
  } catch (err) {
    console.error("[sync] unhandled:", err && err.stack || err);
    return json({ error: { code: "internal", message: "Internal error." } }, 500);
  }
}

module.exports = { handleSync, ROUTES };
