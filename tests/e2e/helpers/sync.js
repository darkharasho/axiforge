// Talks to the mock sync server's test-only hooks (tests/e2e/mock-sync-server.js).
//
// The server runs in Playwright's globalSetup process, not in the worker
// process that runs the specs, so specs cannot poke its `db` directly — every
// hook is an HTTP call. Nothing here bypasses the server's authorization
// rules: the hooks only stand in for other people and other processes.
const { PORT } = require("../mock-sync-server");

const BASE = `http://localhost:${PORT}/api/sync`;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return data;
}

/** Wipe every team, item, membership and session. */
const resetSync = () => call("POST", "/__reset", {});

/**
 * Create teams owned by somebody else (with members and items already in them).
 * @returns {Promise<{teams: {id, name, inviteCode, ownerId}[]}>}
 */
const seedSync = (teams) => call("POST", "/__seed", { teams });

/** Everything the server knows about a team: row, members, items (incl. tombstones). */
const syncState = (teamId) => call("GET", `/__state?teamId=${encodeURIComponent(teamId)}`);

/** A teammate edits an item behind the running app's back (forces a conflict). */
const editAsTeammate = (teamId, itemId, login, body) =>
  call("POST", "/__edit-as", { teamId, itemId, login, body });

/** Session token the server hands a given GitHub login — for direct authz probes. */
const sessionTokenFor = (login) => `sess-u-${login}`;

/** Raw authenticated request, so a spec can assert the server's own 403s. */
async function asUser(login, method, path, { body, query } = {}) {
  const res = await fetch(BASE + path + (query ? `?${query}` : ""), {
    method,
    headers: {
      authorization: `Bearer ${sessionTokenFor(login)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

module.exports = { resetSync, seedSync, syncState, editAsTeammate, sessionTokenFor, asUser, SYNC_BASE: BASE };
