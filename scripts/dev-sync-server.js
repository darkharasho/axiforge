#!/usr/bin/env node
"use strict";
/**
 * A team-sync Worker on localhost, with a team full of people who do not exist.
 *
 * Per-folder access can only really be tested with a populated team: the access
 * editor lists members, and the gestures worth testing — removing somebody's
 * exception, dropping a blanket level, demoting one of two people excepted
 * together — need somebody to perform them on. The only real teams live in
 * production D1, and seeding fakes there would put invented members in front of
 * everyone else in that team. So this stands up the same Worker code against a
 * local SQLite instead, and invents the people there.
 *
 * It is the real thing on both sides of the seam: workers/sync/src/router.js
 * handles every request, the schema is the migrations applied in order, and the
 * team is built by calling the Worker's own createTeam/joinTeam/putItem/setGrant
 * handlers, so nothing here can seed a state the server would refuse to produce.
 * Only the clock and the people are fake.
 *
 * A session row is minted for the owner and written into the profile's auth.json
 * so the app comes up already signed in — there is no GitHub token to exchange
 * for a user who does not exist.
 *
 * Usage:
 *   node scripts/dev-sync-server.js              # serve, seeding on first run
 *   node scripts/dev-sync-server.js --reset      # throw the team away and reseed
 *
 * Then point the app at it (`npm run dev:fake-team` does both):
 *   APP_PROFILE=fake-team AXIFORGE_SYNC_BASE=http://127.0.0.1:8788/api/sync npm run dev
 *
 * @see tests/integration/team-grants-roundtrip.test.js — the same wiring, asserted
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { createTestD1, createTestKV } = require("../tests/helpers/d1Shim");
const { sha256Hex } = require("../workers/sync/src/db");
const { handleSync } = require("../workers/sync/src/router");
const teams = require("../workers/sync/src/teams");
const items = require("../workers/sync/src/items");

const PORT = Number(process.env.PORT || 8788);
const PROFILE = process.env.APP_PROFILE || "fake-team";
const DB_PATH = path.join(__dirname, "../.dev-sync", `${PROFILE}.sqlite`);
const RESET = process.argv.includes("--reset");

// Fixed, so a reseed does not invalidate the auth.json of a profile that is
// still open. It authenticates against a database on this machine only.
const SESSION_TOKEN = "dev-fake-team-session-token";

const OWNER = { id: "u-owner", login: "darkharasho", name: "darkharasho (you)" };
const FAKES = [
  { id: "u-vette", login: "vette", name: "Vette" },
  { id: "u-aria", login: "aria", name: "Aria Shadowstep" },
  { id: "u-kodan", login: "kodan", name: "Kodan Bearclaw" },
  { id: "u-zojja", login: "zojja", name: "Zojja" },
  { id: "u-taimi", login: "taimi", name: "Taimi" },
];

/** Where Electron would put this profile's userData. @see src/main/index.js */
function profileDataDir() {
  const name = `axiforge-desktop-${PROFILE}`;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support", name, "data");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming"), name, "data");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), name, "data");
}

/**
 * Build the team by asking the Worker for it, one handler call at a time.
 *
 * Users, identities and the owner's session are the only direct inserts: they
 * are what /auth/github would have written, and that route needs a real GitHub
 * token for a real GitHub account, which is the one thing a fake member cannot
 * have.
 */
async function seed(db) {
  const now = new Date().toISOString();
  const everyone = [OWNER, ...FAKES];

  for (const u of everyone) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)")
      .bind(u.id, u.name, now).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)")
      .bind(u.id, u.id, u.login).run();
  }

  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, client_label, created_at, last_used_at, expires_at) VALUES (?, ?, 'dev-sync-server', ?, ?, ?)"
  ).bind(await sha256Hex(SESSION_TOKEN), OWNER.id, now, now,
    new Date(Date.now() + 90 * 86400_000).toISOString()).run();

  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = {};
  const as = (u) => ({ user: { id: u.id, login: u.login, displayName: u.name, avatarUrl: null } });
  const req = (method, body) => new Request("http://127.0.0.1/api/sync/seed", {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const call = async (fn, request, auth, params) => {
    const res = await fn(request, env, deps, auth, params || {});
    if (res.status >= 400) throw new Error(`${fn.name}: ${await res.text()}`);
    return res.status === 204 ? null : await res.json();
  };

  const { team } = await call(teams.createTeam, req("POST", { name: "Fake Squad" }), as(OWNER));
  for (const u of FAKES) {
    await call(teams.joinTeam, req("POST", { inviteCode: team.inviteCode }), as(u));
  }

  // A tree with depth, because the nearest-grant rule is only interesting below
  // a folder that already has one of its own.
  const folder = async (id, parentId, name) =>
    call(items.putItem, req("PUT", { type: "folder", parentId, body: { name } }),
      as(OWNER), { teamId: team.id, itemId: id });
  await folder("raids", null, "Raids");
  await folder("squads", "raids", "Squads");
  await folder("officers", null, "Officers");
  await folder("reference", null, "Reference");

  // Something to take away in every shape the editor can show it: a blanket
  // level, a person excepted above it, a person excepted below an inherited
  // one, two people excepted together, and a team-wide read-only member.
  const grant = (folderId, userId, access) =>
    call(teams.setGrant, req("PUT", { access }), as(OWNER), { teamId: team.id, folderId, userId });
  await grant("officers", "*", "none");
  await grant("officers", "u-vette", "write");
  await grant("reference", "*", "read");
  await grant("squads", "u-aria", "delete");
  await grant("squads", "u-kodan", "delete");
  await grant(team.id, "u-zojja", "read");

  return team;
}

/** Start the app already signed in. @see BuildStore#readAuth — no `__enc` is plaintext. */
function writeProfileSession(user) {
  const dir = profileDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "auth.json");
  let auth = {};
  try { auth = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  // An encrypted auth.json cannot be merged into from out here, and this profile
  // exists only for this server, so replace it rather than guess at its contents.
  if (auth && auth.__enc) auth = {};
  auth.sync = { sessionToken: SESSION_TOKEN, userId: user.id, login: user.login };
  fs.writeFileSync(file, JSON.stringify(auth, null, 2));
  return file;
}

async function toWebRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  // The rate limiter keys on it and Workers always supply it.
  if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "127.0.0.1");
  return new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (RESET) {
    for (const f of [DB_PATH, `${DB_PATH}-journal`, `${DB_PATH}-wal`]) fs.rmSync(f, { force: true });
  }
  const fresh = !fs.existsSync(DB_PATH);
  const db = createTestD1(DB_PATH);
  // applyMigrations replays all of them from nothing, so only ever on a new file.
  if (fresh) await db.applyMigrations();

  let team;
  if (fresh) {
    team = await seed(db);
  } else {
    team = await db.prepare("SELECT id, name, invite_code AS inviteCode FROM teams LIMIT 1").first();
  }
  const authFile = writeProfileSession(OWNER);

  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const res = await handleSync(await toWebRequest(nodeReq), env, {});
      if (!res) {
        nodeRes.writeHead(404, { "content-type": "text/plain" }).end("not a /api/sync route\n");
        return;
      }
      const body = Buffer.from(await res.arrayBuffer());
      nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
      nodeRes.end(body);
    } catch (err) {
      console.error("[dev-sync]", err && err.stack || err);
      nodeRes.writeHead(500, { "content-type": "application/json" });
      nodeRes.end(JSON.stringify({ error: { code: "internal", message: String(err && err.message || err) } }));
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const members = [OWNER, ...FAKES].map((u) => u.name).join(", ");
    console.log(`\n[dev-sync] http://127.0.0.1:${PORT}/api/sync  (${fresh ? "seeded" : "reusing"} ${DB_PATH})`);
    console.log(`[dev-sync] team "${team.name}" ${team.id} — ${FAKES.length + 1} members: ${members}`);
    console.log(`[dev-sync] signed in as ${OWNER.login} via ${authFile}`);
    console.log("[dev-sync] seeded access: Officers blanket=none (Vette: write) · Reference blanket=read · "
      + "Squads exceptions for Aria + Kodan · Zojja read-only team-wide");
    console.log("[dev-sync] --reset throws the team away and seeds a new one\n");
  });
}

main().catch((err) => {
  console.error("[dev-sync] failed to start:", err && err.stack || err);
  process.exit(1);
});
