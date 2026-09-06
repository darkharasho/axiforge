// In-memory stand-in for /api/sync (workers/sync/src/*).
//
// It used to answer `role: "owner"` for everything and implement four routes,
// so no E2E test could ever exercise a member, a 403, a conflict or a delete —
// the authorization model was simply absent from the end-to-end suite. This
// version mirrors the Worker's ACTUAL behaviour:
//
//   * multiple users, identified by the GitHub token the app signs in with;
//   * real memberships with owner/member roles, last-owner guards, and
//     invite codes that are only disclosed to owners;
//   * every route the client calls, with the Worker's authz:
//       - ownerOnly()      → rename / delete team / rotate invite / set role
//       - requireMembership() → members / changes / items (403 otherwise)
//       - deleteItem: owner deletes anything; a member only items they created
//         (checked across the whole subtree), 409 on a stale baseVersion;
//       - putItem/bulk: optimistic concurrency on baseVersion, 409 + `current`.
//
// Anything a spec needs to set up that a user cannot do from one app instance
// (a team owned by somebody else, a teammate editing an item behind your back)
// is available through the `/__*` test hooks at the bottom — never by relaxing
// the authorization rules above.
const http = require("http");
// One sync server per Playwright worker. The db below is module-level singleton
// state and `resetSync()` wipes ALL of it, so two workers sharing one instance
// would pull each other's teams out from under themselves. Each worker gets its
// own process on its own port instead — see global-setup.js.
const PORT = Number(process.env.MOCK_SYNC_PORT) || 9878;
let server;

// ─── State ──────────────────────────────────────────────────────────────────

const db = {
  users: new Map(),      // userId  → { id, login, displayName, avatarUrl }
  ghTokens: new Map(),   // githubToken → userId
  sessions: new Map(),   // sessionToken → userId
  teams: new Map(),      // teamId  → { id, name, inviteCode, seq, createdBy, createdAt }
  members: new Map(),    // teamId  → Map(userId → role)
  items: new Map(),      // teamId  → Map(itemId → row)
};

function reset() {
  for (const m of Object.values(db)) m.clear();
  // The default identity every spec gets unless it seeds another one.
  registerUser("e2e-github-token", "e2e");
  db.sessions.set("e2e-session", "u-e2e");
}

// Users are derived from whatever GitHub token the app was seeded with, so a
// spec can be "somebody else" just by writing a different token to auth.json.
function registerUser(githubToken, login) {
  const id = `u-${login}`;
  if (!db.users.has(id)) db.users.set(id, { id, login, displayName: login.toUpperCase(), avatarUrl: null });
  if (githubToken) db.ghTokens.set(githubToken, id);
  return db.users.get(id);
}
function userForGithubToken(token) {
  const known = db.ghTokens.get(token);
  if (known) return db.users.get(known);
  // `gh-<login>` is the convention for ad-hoc identities in specs.
  const login = /^gh-(.+)$/.exec(token || "")?.[1] || "e2e";
  return registerUser(token, login);
}
function userByLogin(login) {
  return db.users.get(`u-${login}`) || registerUser(null, login);
}

const memberRole = (teamId, userId) => db.members.get(teamId)?.get(userId) || null;
const ownersOf = (teamId) => [...(db.members.get(teamId) || new Map()).values()].filter((r) => r === "owner").length;

function addMember(teamId, userId, role) {
  if (!db.members.has(teamId)) db.members.set(teamId, new Map());
  db.members.get(teamId).set(userId, role);
}

function makeInviteCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function nextSeq(teamId) {
  const team = db.teams.get(teamId);
  team.seq += 1;
  return team.seq;
}

function teamWire(team, { includeInvite }) {
  const t = { id: team.id, name: team.name, seq: team.seq, createdAt: team.createdAt };
  if (includeInvite) t.inviteCode = team.inviteCode;
  return t;
}

function itemWire(row) {
  const login = (id) => db.users.get(id)?.login || null;
  return {
    id: row.id, type: row.type, parentId: row.parentId,
    body: row.deleted ? null : row.body,
    version: row.version, seq: row.seq, deleted: row.deleted,
    createdBy: { userId: row.createdBy, login: login(row.createdBy) },
    updatedBy: { userId: row.updatedBy, login: login(row.updatedBy) },
    updatedAt: row.updatedAt,
  };
}

// ─── HTTP plumbing ──────────────────────────────────────────────────────────

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
function fail(res, status, code, message) { json(res, status, { error: { code, message } }); }
function conflict(res, row) {
  json(res, 409, { error: { code: "conflict", message: "Item was changed by someone else." }, current: row ? itemWire(row) : null });
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}

// ─── Item writes (mirrors workers/sync/src/items.js writeItem) ───────────────

function writeItem(teamId, userId, entry) {
  const { itemId, type, parentId = null, body, baseVersion = null } = entry || {};
  if (!itemId || !["folder", "build", "comp"].includes(type)) return { status: 400, message: "Invalid item." };
  if (body === null || typeof body !== "object") return { status: 400, message: "body must be an object." };
  const items = db.items.get(teamId);
  const existing = items.get(itemId);
  const now = new Date().toISOString();
  if (!existing || existing.deleted) {
    if (baseVersion !== null && baseVersion !== undefined) {
      return { status: 409, current: existing || null, message: "Item does not exist (baseVersion must be null to create)." };
    }
    const row = {
      id: itemId, type, parentId, body,
      version: existing ? existing.version + 1 : 1,
      seq: nextSeq(teamId), deleted: false,
      createdBy: existing ? existing.createdBy : userId, updatedBy: userId, updatedAt: now,
    };
    items.set(itemId, row);
    return { status: 201, version: row.version, seq: row.seq };
  }
  if (baseVersion === null || baseVersion === undefined || baseVersion !== existing.version) {
    return { status: 409, current: existing, message: "Item was changed by someone else." };
  }
  existing.type = type;
  existing.parentId = parentId;
  existing.body = body;
  existing.version += 1;
  existing.seq = nextSeq(teamId);
  existing.updatedBy = userId;
  existing.updatedAt = now;
  return { status: 200, version: existing.version, seq: existing.seq };
}

// Live descendants of a folder, breadth-first (matches the Worker's collectTree).
function collectTree(teamId, rootId) {
  const rows = [...db.items.get(teamId).values()].filter((r) => !r.deleted);
  const out = [];
  const seen = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const pid = queue.shift();
    for (const child of rows.filter((r) => r.parentId === pid)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      if (child.type === "folder") queue.push(child.id);
    }
  }
  return out;
}

// ─── Routing ────────────────────────────────────────────────────────────────

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/api\/sync/, "");
  const method = req.method.toUpperCase();
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};

  // Stand-in for api.github.com/user (AXIFORGE_GITHUB_API_ROOT). The identity
  // it reports comes from the token, so a spec that seeds a different GitHub
  // token in auth.json really is a different person end to end.
  if (method === "GET" && p === "/user") {
    const token = /^(?:token|Bearer)\s+(.+)$/i.exec(req.headers.authorization || "")?.[1];
    const user = userForGithubToken(token);
    return json(res, 200, { login: user.login, id: user.id, avatar_url: null, html_url: `https://github.com/${user.login}` });
  }

  // ─── Test-only hooks (no auth: they stand in for other people/processes) ──
  if (method === "POST" && p === "/__reset") { reset(); return json(res, 204); }
  if (method === "POST" && p === "/__seed") return json(res, 200, seed(body));
  if (method === "POST" && p === "/__edit-as") return editAs(res, body);
  if (method === "GET" && p === "/__state") {
    const teamId = url.searchParams.get("teamId");
    if (!db.teams.has(teamId)) return fail(res, 404, "not_found", "No such team.");
    return json(res, 200, {
      team: db.teams.get(teamId),
      members: [...db.members.get(teamId)].map(([userId, role]) => ({ userId, login: db.users.get(userId)?.login, role })),
      items: [...db.items.get(teamId).values()].map(itemWire),
    });
  }

  if (method === "POST" && p === "/auth/github") {
    const user = userForGithubToken(body && body.token);
    const sessionToken = `sess-${user.id}`;
    db.sessions.set(sessionToken, user.id);
    return json(res, 200, { sessionToken, user: { id: user.id, login: user.login, displayName: user.displayName, avatarUrl: null } });
  }

  // Everything below is authenticated, exactly like the Worker.
  const sessionToken = /^Bearer\s+(.+)$/.exec(req.headers.authorization || "")?.[1];
  const userId = sessionToken ? db.sessions.get(sessionToken) : null;
  if (!userId) return fail(res, 401, "unauthorized", "Sign in to sync teams.");

  if (method === "DELETE" && p === "/auth/session") { db.sessions.delete(sessionToken); return json(res, 204); }

  if (method === "POST" && p === "/teams") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(res, 400, "invalid", "Team name must be 1–80 characters.");
    const requested = typeof body.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id) ? body.id : null;
    if (requested && db.teams.has(requested)) return fail(res, 409, "conflict", "That team id is already in use.");
    const team = createTeam({ id: requested, name, ownerId: userId });
    return json(res, 201, { team: teamWire(team, { includeInvite: true }), role: "owner" });
  }

  if (method === "POST" && p === "/teams/join") {
    const code = typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";
    if (!code) return fail(res, 400, "invalid", "Missing invite code.");
    const team = [...db.teams.values()].find((t) => t.inviteCode === code);
    if (!team) return fail(res, 404, "not_found", "No team with that invite code.");
    const existing = memberRole(team.id, userId);
    if (existing) return json(res, 200, { team: teamWire(team, { includeInvite: existing === "owner" }), role: existing });
    addMember(team.id, userId, "member");
    return json(res, 200, { team: teamWire(team, { includeInvite: false }), role: "member" });
  }

  if (method === "GET" && p === "/teams") {
    const mine = [...db.teams.values()]
      .filter((t) => memberRole(t.id, userId))
      .map((t) => ({ team: teamWire(t, { includeInvite: memberRole(t.id, userId) === "owner" }), role: memberRole(t.id, userId) }));
    return json(res, 200, mine);
  }

  let m;
  // PATCH /teams/:id — rename (owner only)
  if ((m = p.match(/^\/teams\/([^/]+)$/)) && (method === "PATCH" || method === "DELETE")) {
    const teamId = m[1];
    const role = memberRole(teamId, userId);
    if (!db.teams.has(teamId) || !role) return fail(res, 403, "forbidden", "You are not a member of this team.");
    if (role !== "owner") return fail(res, 403, "forbidden", "Only a team owner can do that.");
    if (method === "DELETE") {
      db.teams.delete(teamId); db.members.delete(teamId); db.items.delete(teamId);
      return json(res, 204);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(res, 400, "invalid", "Team name must be 1–80 characters.");
    db.teams.get(teamId).name = name;
    return json(res, 200, { team: teamWire(db.teams.get(teamId), { includeInvite: true }), role: "owner" });
  }

  if ((m = p.match(/^\/teams\/([^/]+)\/members$/)) && method === "GET") {
    const teamId = m[1];
    if (!memberRole(teamId, userId)) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const rows = [...db.members.get(teamId)].map(([id, role]) => {
      const u = db.users.get(id);
      return { userId: id, login: u.login, displayName: u.displayName, avatarUrl: null, role, joinedAt: "" };
    });
    return json(res, 200, rows);
  }

  // DELETE /teams/:id/members/:userId — owner removes anyone; anyone leaves.
  // PATCH  /teams/:id/members/:userId — owner-only role change.
  if ((m = p.match(/^\/teams\/([^/]+)\/members\/([^/]+)$/)) && (method === "DELETE" || method === "PATCH")) {
    const [, teamId, targetId] = m;
    const myRole = memberRole(teamId, userId);
    if (!myRole) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const targetRole = memberRole(teamId, targetId);
    if (method === "DELETE") {
      const isSelf = targetId === userId;
      if (!isSelf && myRole !== "owner") return fail(res, 403, "forbidden", "Only a team owner can remove members.");
      if (!targetRole) return fail(res, 404, "not_found", "That user is not a member.");
      if (targetRole === "owner" && ownersOf(teamId) <= 1) {
        return fail(res, 403, "forbidden", "The last owner cannot leave. Promote another member to owner first, or delete the team.");
      }
      db.members.get(teamId).delete(targetId);
      return json(res, 204);
    }
    if (myRole !== "owner") return fail(res, 403, "forbidden", "Only a team owner can do that.");
    const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
    if (!["owner", "member"].includes(role)) return fail(res, 400, "invalid", 'role must be "owner" or "member".');
    if (!targetRole) return fail(res, 404, "not_found", "That user is not a member.");
    if (targetRole !== role && targetRole === "owner" && ownersOf(teamId) <= 1) {
      return fail(res, 403, "forbidden", "The last owner cannot be demoted. Promote another member first.");
    }
    db.members.get(teamId).set(targetId, role);
    return json(res, 200, { userId: targetId, role });
  }

  if ((m = p.match(/^\/teams\/([^/]+)\/invite\/rotate$/)) && method === "POST") {
    const teamId = m[1];
    const role = memberRole(teamId, userId);
    if (!role) return fail(res, 403, "forbidden", "You are not a member of this team.");
    if (role !== "owner") return fail(res, 403, "forbidden", "Only a team owner can do that.");
    db.teams.get(teamId).inviteCode = makeInviteCode();
    return json(res, 200, { inviteCode: db.teams.get(teamId).inviteCode });
  }

  if ((m = p.match(/^\/teams\/([^/]+)\/changes$/)) && method === "GET") {
    const teamId = m[1];
    if (!memberRole(teamId, userId)) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const since = Number(url.searchParams.get("since") || 0);
    const limit = Number(url.searchParams.get("limit") || 200);
    const all = [...db.items.get(teamId).values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    return json(res, 200, {
      resync: false,
      items: page.map(itemWire),
      nextSeq: page.length ? page[page.length - 1].seq : since,
      hasMore: all.length > page.length,
    });
  }

  if ((m = p.match(/^\/teams\/([^/]+)\/items:bulk$/)) && method === "POST") {
    const teamId = m[1];
    if (!memberRole(teamId, userId)) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const list = Array.isArray(body.items) ? body.items : null;
    if (!list) return fail(res, 400, "invalid", "items must be an array.");
    const results = list.map((entry) => {
      const r = writeItem(teamId, userId, entry);
      return {
        itemId: entry && entry.itemId, status: r.status, version: r.version, seq: r.seq,
        current: r.current ? itemWire(r.current) : undefined, message: r.message,
      };
    });
    return json(res, 200, { results });
  }

  if ((m = p.match(/^\/teams\/([^/]+)\/items\/([^/:]+)$/))) {
    const [, teamId, itemId] = m;
    const role = memberRole(teamId, userId);
    if (!role) return fail(res, 403, "forbidden", "You are not a member of this team.");

    if (method === "PUT") {
      const r = writeItem(teamId, userId, { ...body, itemId });
      if (r.status === 409) return conflict(res, r.current);
      if (r.status === 400) return fail(res, 400, "invalid", r.message);
      return json(res, r.status, { version: r.version, seq: r.seq });
    }

    if (method === "DELETE") {
      const baseVersion = Number(url.searchParams.get("baseVersion"));
      if (!Number.isInteger(baseVersion) || baseVersion < 1) return fail(res, 400, "invalid", "baseVersion query param is required.");
      const row = db.items.get(teamId).get(itemId);
      if (!row || row.deleted) return fail(res, 404, "not_found", "Item not found.");
      if (row.version !== baseVersion) return conflict(res, row);
      const descendants = row.type === "folder" ? collectTree(teamId, itemId) : [];
      if (role !== "owner" && [row, ...descendants].some((r) => r.createdBy !== userId)) {
        return fail(res, 403, "forbidden", "Only the team owner or the item's creator can delete it.");
      }
      const now = new Date().toISOString();
      // Body retained, batch stamped — this is what backs the shared team trash.
      // @see workers/sync/src/items.js
      for (const r of [row, ...descendants]) {
        r.deleted = true; r.version += 1; r.seq = nextSeq(teamId);
        r.updatedBy = userId; r.updatedAt = now;
        r.deletedAt = now; r.deletedBy = userId; r.deleteBatch = row.id;
      }
      return json(res, 200, { version: row.version, seq: row.seq });
    }
  }

  // GET /teams/:id/trash — one row per thing somebody actually deleted.
  if ((m = p.match(/^\/teams\/([^/]+)\/trash$/)) && method === "GET") {
    const [, teamId] = m;
    if (!db.items.has(teamId)) return fail(res, 404, "not_found", "No such team.");
    if (!memberRole(teamId, userId)) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const rows = [...db.items.get(teamId).values()].filter((r) => r.deleted && r.deleteBatch === r.id);
    const isOwner = memberRole(teamId, userId) === "owner";
    return json(res, 200, {
      items: rows
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .map((r) => ({
          id: r.id, type: r.type, parentId: r.parentId,
          name: (r.body && (r.body.title || r.body.name)) || null,
          version: r.version,
          carried: [...db.items.get(teamId).values()].filter((d) => d.deleted && d.deleteBatch === r.deleteBatch && d.id !== r.id).length,
          deletedAt: r.deletedAt,
          deletedBy: { userId: r.deletedBy, login: db.users.get(r.deletedBy)?.login || null },
          canRestore:
            isOwner ||
            r.deletedBy === userId ||
            ![...db.items.get(teamId).values()]
              .filter((d) => d.deleted && d.deleteBatch === r.deleteBatch)
              .some((d) => d.createdBy !== userId),
        })),
    });
  }

  // POST /teams/:id/trash/:itemId/restore — undo a deletion for everyone.
  if ((m = p.match(/^\/teams\/([^/]+)\/trash\/([^/]+)\/restore$/)) && method === "POST") {
    const [, teamId, itemId] = m;
    if (!db.items.has(teamId)) return fail(res, 404, "not_found", "No such team.");
    const role = memberRole(teamId, userId);
    if (!role) return fail(res, 403, "forbidden", "You are not a member of this team.");
    const row = db.items.get(teamId).get(itemId);
    if (!row || !row.deleted) return fail(res, 404, "not_found", "Nothing deleted with that id.");
    if (!row.body) return fail(res, 404, "not_found", "That item was deleted before the team trash existed, so there is nothing left to restore.");
    const batch = row.deleteBatch || row.id;
    const members = [...db.items.get(teamId).values()].filter((r) => r.deleted && r.deleteBatch === batch);
    if (role !== "owner" && row.deletedBy !== userId && members.some((r) => r.createdBy !== userId)) {
      return fail(res, 403, "forbidden", "Only the team owner, the item's creator, or whoever deleted it can restore it.");
    }
    const now = new Date().toISOString();
    for (const r of members) {
      r.deleted = false; r.version += 1; r.seq = nextSeq(teamId);
      r.updatedBy = userId; r.updatedAt = now;
      r.deletedAt = null; r.deletedBy = null; r.deleteBatch = null;
    }
    return json(res, 200, { version: row.version, seq: row.seq, restored: members.map((r) => r.id) });
  }

  return fail(res, 404, "not_found", p);
}

// ─── Seeding helpers used by the /__* hooks ─────────────────────────────────

function createTeam({ id, name, ownerId, inviteCode }) {
  const teamId = id || `team-${db.teams.size + 1}`;
  const team = { id: teamId, name, inviteCode: inviteCode || makeInviteCode(), seq: 0, createdBy: ownerId, createdAt: new Date().toISOString() };
  db.teams.set(teamId, team);
  db.members.set(teamId, new Map([[ownerId, "owner"]]));
  db.items.set(teamId, new Map());
  return team;
}

/**
 * POST /__seed
 * { teams: [{ id?, name, inviteCode?, ownerLogin, members?: [{login, role}],
 *             items?: [{ id, type, parentId?, body, createdByLogin? }] }] }
 * Returns the created teams (with invite codes) so a spec can drive the UI with them.
 */
function seed(body) {
  const out = [];
  for (const spec of (body && body.teams) || []) {
    const owner = userByLogin(spec.ownerLogin || "mate");
    const team = createTeam({ id: spec.id, name: spec.name, ownerId: owner.id, inviteCode: spec.inviteCode });
    for (const mem of spec.members || []) addMember(team.id, userByLogin(mem.login).id, mem.role || "member");
    for (const item of spec.items || []) {
      const author = userByLogin(item.createdByLogin || spec.ownerLogin || "mate");
      db.items.get(team.id).set(item.id, {
        id: item.id, type: item.type, parentId: item.parentId || null, body: item.body,
        version: 1, seq: nextSeq(team.id), deleted: false,
        createdBy: author.id, updatedBy: author.id, updatedAt: new Date().toISOString(),
      });
    }
    out.push({ id: team.id, name: team.name, inviteCode: team.inviteCode, ownerId: owner.id });
  }
  return { teams: out };
}

/**
 * POST /__edit-as { teamId, itemId, login, body }
 * A teammate changing an item behind the app's back — the only way to produce a
 * genuine version conflict with a single running app instance.
 */
function editAs(res, body) {
  const { teamId, itemId, login, body: newBody } = body || {};
  const items = db.items.get(teamId);
  if (!items) return fail(res, 404, "not_found", "No such team.");
  const row = items.get(itemId);
  if (!row) return fail(res, 404, "not_found", "No such item.");
  const user = userByLogin(login || "mate");
  if (!memberRole(teamId, user.id)) addMember(teamId, user.id, "member");
  row.body = { ...row.body, ...newBody };
  row.version += 1;
  row.seq = nextSeq(teamId);
  row.updatedBy = user.id;
  row.updatedAt = new Date().toISOString();
  return json(res, 200, itemWire(row));
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

function start() {
  reset();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) =>
      handle(req, res).catch((e) => json(res, 500, { error: { code: "internal", message: e.message } })));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") reject(new Error(`Mock sync server: port ${PORT} is already in use. Stop whatever is bound to it and retry.`));
      else reject(err);
    });
    server.listen(PORT, resolve);
  });
}
function stop() { return new Promise((r) => (server ? server.close(r) : r())); }

module.exports = { start, stop, PORT };

// Run as `node mock-sync-server.js` with MOCK_SYNC_PORT set — global-setup
// forks one of these per worker.
if (require.main === module) {
  start()
    .then(() => process.send && process.send({ ready: true, port: PORT }))
    .catch((err) => { console.error(err.message); process.exit(1); });
}
