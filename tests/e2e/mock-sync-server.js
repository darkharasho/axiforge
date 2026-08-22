// Minimal in-memory stand-in for /api/sync: login, teams, items, changes.
const http = require("http");
const PORT = 9878;
let server;
const db = { teams: new Map(), items: new Map(), seq: new Map() };

function json(res, status, body) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s ? JSON.parse(s) : {})); }); }

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/api\/sync/, "");
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
  if (req.method === "POST" && p === "/auth/github") return json(res, 200, { sessionToken: "e2e-session", user: { id: "u1", login: "e2e", displayName: "E2E", avatarUrl: null } });
  if (!/^Bearer e2e-session$/.test(req.headers.authorization || "")) return json(res, 401, { error: { code: "unauthorized", message: "no" } });
  if (req.method === "DELETE" && p === "/auth/session") return json(res, 204, {});
  if (req.method === "POST" && p === "/teams") {
    const team = { id: body.id || `team-${db.teams.size + 1}`, name: body.name, inviteCode: "ABCDEFGHJK", seq: 0, createdAt: new Date().toISOString() };
    db.teams.set(team.id, team); db.items.set(team.id, new Map()); db.seq.set(team.id, 0);
    return json(res, 201, { team, role: "owner" });
  }
  if (req.method === "GET" && p === "/teams") return json(res, 200, [...db.teams.values()].map((team) => ({ team, role: "owner" })));
  let m;
  if ((m = p.match(/^\/teams\/([^/]+)\/members$/)) && req.method === "GET") return json(res, 200, [{ userId: "u1", login: "e2e", displayName: "E2E", avatarUrl: null, role: "owner", joinedAt: "" }]);
  if ((m = p.match(/^\/teams\/([^/]+)\/changes$/))) {
    const since = Number(url.searchParams.get("since") || 0);
    const items = [...(db.items.get(m[1]) || new Map()).values()].filter((i) => i.seq > since).sort((a, b) => a.seq - b.seq);
    return json(res, 200, { items, nextSeq: items.length ? items[items.length - 1].seq : since, hasMore: false });
  }
  if ((m = p.match(/^\/teams\/([^/]+)\/items\/([^/]+)$/)) && req.method === "PUT") {
    const [, teamId, id] = m;
    const seq = (db.seq.get(teamId) || 0) + 1; db.seq.set(teamId, seq);
    const existing = db.items.get(teamId).get(id);
    const version = existing ? existing.version + 1 : 1;
    db.items.get(teamId).set(id, { id, type: body.type, parentId: body.parentId, body: body.body, version, seq, deleted: false, createdBy: { userId: "u1", login: "e2e" }, updatedBy: { userId: "u1", login: "e2e" }, updatedAt: new Date().toISOString() });
    return json(res, existing ? 200 : 201, { version, seq });
  }
  return json(res, 404, { error: { code: "not_found", message: p } });
}

function start() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => handle(req, res).catch((e) => json(res, 500, { error: { code: "internal", message: e.message } })));
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") reject(new Error(`Mock sync server: port ${PORT} is already in use. Stop whatever is bound to it and retry.`));
      else reject(err);
    });
    server.listen(PORT, resolve);
  });
}
function stop() { return new Promise((r) => (server ? server.close(r) : r())); }
function reset() { db.teams.clear(); db.items.clear(); db.seq.clear(); }
function putCount(teamId) { return (db.items.get(teamId) || new Map()).size; }
module.exports = { start, stop, reset, putCount, PORT };
