# Team Sync — Plan 1 of 3: Worker Backend (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `/api/sync/*` team-sync API (auth, teams, versioned items with a per-team change cursor) to the existing Cloudflare Worker, backed by D1, with tests that run under Jest.

**Architecture:** New CommonJS modules under `workers/sync/src/` are mounted from the existing Worker entry (`workers/share-shortener/src/index.js`). All state lives in a D1 database (`SYNC_DB`); rate-limit counters use a small KV namespace (`SYNC_RL`). Handlers take `(request, env, deps)` so tests inject a `node:sqlite`-backed D1 shim, a Map-backed KV, a fake `fetch`, and a fixed clock — no miniflare/vitest needed.

**Tech Stack:** Cloudflare Workers (wrangler 4), D1 (SQLite), KV, Node 24 (`node:sqlite` for tests), Jest 30.

**Spec:** `docs/superpowers/specs/2026-08-21-team-sync-design.md` (sections 1, 1.1–1.8, 5, 7)

## Global Constraints

- Worker code is CommonJS (`"use strict"; module.exports = …`) like `workers/share-shortener/src/gw2skills-route.js`, so Jest can `require()` it; the ESM entry uses `await import()` to load it.
- Item body limit: **1.5 MB** (`MAX_BODY_BYTES = 1_500_000`). Over → `413 too_large` naming `type` and `id`.
- Write rate limit: **120 writes / minute / user**; join rate limit **10 / minute / IP**. Over → `429 rate_limited` with `Retry-After`.
- Invite codes: **10 chars** from `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U).
- Sessions: random 32 bytes, stored as SHA-256 hex; **90-day sliding expiry**, bumped at most once per hour.
- `changes` page size: `limit` ≤ **200** (default 200).
- Tombstones purged after **30 days** by a daily cron.
- Error body shape: `{ "error": { "code": "<code>", "message": "<text>" } }`, codes: `unauthorized | forbidden | not_found | conflict | too_large | invalid | rate_limited`.
- Run tests with `npx jest <file> --maxWorkers=2`.

---

## File structure

| File | Responsibility |
|---|---|
| `workers/sync/migrations/0001_init.sql` | Schema (spec §1.2) |
| `workers/sync/src/db.js` | Small helpers: `uuid()`, `nowIso()`, `sha256Hex()`, `randomToken()`, `inviteCode()`, `json()`, `errorResponse()` |
| `workers/sync/src/auth.js` | GitHub login, session lookup, logout |
| `workers/sync/src/teams.js` | Team CRUD, join, members, invite rotation |
| `workers/sync/src/items.js` | `changes`, `put`, `delete` (incl. folder cascade), `bulk`, seq/version logic |
| `workers/sync/src/ratelimit.js` | KV fixed-window counter |
| `workers/sync/src/purge.js` | Tombstone purge for the cron trigger |
| `workers/sync/src/router.js` | `handleSync(request, env, deps)` — routes `/api/sync/*` |
| `workers/share-shortener/src/index.js` | Mount router + `scheduled()` |
| `wrangler.jsonc` | `SYNC_DB`, `SYNC_RL`, cron, `run_worker_first` |
| `tests/helpers/d1Shim.js` | `createTestD1()` (node:sqlite → D1 API), `createTestKV()` |
| `tests/unit/worker-sync-*.test.js` | Tests per module |

---

### Task 1: Test shims — D1 over `node:sqlite`, Map-backed KV

**Files:**
- Create: `tests/helpers/d1Shim.js`
- Test: `tests/unit/worker-sync-d1shim.test.js`

**Interfaces:**
- Produces: `createTestD1() → { prepare(sql) → { bind(...p) → stmt, first(col?) , all(), run() }, batch(stmts[]), exec(sql), applyMigrations() }` and `createTestKV() → { get(key), put(key, value, {expirationTtl}), delete(key) }` matching the subset of the D1/KV APIs the Worker uses.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-d1shim.test.js
"use strict";
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

describe("d1Shim", () => {
  test("prepare/bind/first/all/run mirror the D1 API", async () => {
    const db = createTestD1();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)");
    const run = await db.prepare("INSERT INTO t (n) VALUES (?)").bind(5).run();
    expect(run.success).toBe(true);
    expect(run.meta.changes).toBe(1);
    expect(await db.prepare("SELECT n FROM t WHERE id = ?").bind(1).first("n")).toBe(5);
    expect(await db.prepare("SELECT * FROM t").bind().first()).toEqual({ id: 1, n: 5 });
    expect(await db.prepare("SELECT * FROM t WHERE id = 99").bind().first()).toBeNull();
    const all = await db.prepare("SELECT * FROM t").all();
    expect(all.results).toEqual([{ id: 1, n: 5 }]);
  });

  test("batch runs statements atomically and returns per-statement results", async () => {
    const db = createTestD1();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER UNIQUE)");
    const ok = await db.batch([
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(1),
      db.prepare("SELECT n FROM t").bind(),
    ]);
    expect(ok[0].meta.changes).toBe(1);
    expect(ok[1].results).toEqual([{ n: 1 }]);
    await expect(db.batch([
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(2),
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(1), // UNIQUE violation
    ])).rejects.toThrow();
    // first insert rolled back
    expect((await db.prepare("SELECT COUNT(*) AS c FROM t").first("c"))).toBe(1);
  });

  test("applyMigrations loads workers/sync/migrations/*.sql in order", async () => {
    const db = createTestD1();
    await db.applyMigrations();
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["users", "identities", "sessions", "teams", "memberships", "items"]));
  });

  test("KV shim supports get/put/delete with TTL", async () => {
    const kv = createTestKV({ now: () => 1_000_000 });
    await kv.put("k", "v", { expirationTtl: 60 });
    expect(await kv.get("k")).toBe("v");
    kv._advance(61_000);
    expect(await kv.get("k")).toBeNull();
    await kv.put("x", "1");
    await kv.delete("x");
    expect(await kv.get("x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-d1shim.test.js --maxWorkers=2`
Expected: FAIL — `Cannot find module '../helpers/d1Shim'`

- [ ] **Step 3: Write the shim**

```js
// tests/helpers/d1Shim.js
"use strict";
// Minimal D1 + KV test doubles built on node:sqlite so Worker handlers can be
// tested under Jest without miniflare. Only the API surface the Worker uses.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "../../workers/sync/migrations");

function plain(row) {
  if (row === undefined || row === null) return null;
  return Object.assign({}, row); // node:sqlite returns null-prototype objects
}

function createTestD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  function makeStatement(sql) {
    let params = [];
    const stmt = {
      bind(...p) { params = p; return stmt; },
      async first(col) {
        const row = plain(db.prepare(sql).get(...params));
        if (row === null) return null;
        return col === undefined ? row : (row[col] ?? null);
      },
      async all() {
        const rows = db.prepare(sql).all(...params).map(plain);
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        const r = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      _sync() {
        const isRead = /^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /\bRETURNING\b/i.test(sql);
        if (isRead) {
          const rows = db.prepare(sql).all(...params).map(plain);
          return { success: true, results: rows, meta: { changes: 0 } };
        }
        const r = db.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
    };
    return stmt;
  }

  return {
    prepare: (sql) => makeStatement(sql),
    async exec(sql) { db.exec(sql); return { count: 1, duration: 0 }; },
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._sync());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async applyMigrations() {
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      for (const f of files) db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    },
    _raw: db,
  };
}

function createTestKV({ now = Date.now } = {}) {
  const map = new Map();
  let offset = 0;
  const clock = () => now() + offset;
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.expiresAt && clock() >= e.expiresAt) { map.delete(key); return null; }
      return e.value;
    },
    async put(key, value, opts = {}) {
      map.set(key, { value: String(value), expiresAt: opts.expirationTtl ? clock() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(key) { map.delete(key); },
    _advance(ms) { offset += ms; },
  };
}

module.exports = { createTestD1, createTestKV };
```

- [ ] **Step 4: Create the migration so `applyMigrations` has something to load**

```sql
-- workers/sync/migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS identities (
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id),
  login             TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  client_label  TEXT,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  invite_code   TEXT NOT NULL UNIQUE,
  seq           INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL CHECK (role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS items (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('folder','build','comp')),
  parent_id   TEXT,
  body        TEXT,
  version     INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id),
  updated_by  TEXT NOT NULL REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE INDEX IF NOT EXISTS items_team_seq ON items(team_id, seq);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-d1shim.test.js --maxWorkers=2`
Expected: PASS (4 tests). Note: node prints `ExperimentalWarning: SQLite` — harmless.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/d1Shim.js tests/unit/worker-sync-d1shim.test.js workers/sync/migrations/0001_init.sql
git commit -m "test(sync): D1/KV test shims over node:sqlite + initial team-sync schema"
```

---

### Task 2: `db.js` helpers

**Files:**
- Create: `workers/sync/src/db.js`
- Test: `tests/unit/worker-sync-db.test.js`

**Interfaces:**
- Produces: `uuid()`, `nowIso(deps)`, `sha256Hex(str) → Promise<string>`, `randomToken() → string` (base64url, 32 bytes), `inviteCode() → string` (10 chars), `json(obj, status?, headers?) → Response`, `errorResponse(code, message, status?, headers?) → Response`, `STATUS_FOR_CODE`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-db.test.js
"use strict";
const db = require("../../workers/sync/src/db");

describe("sync db helpers", () => {
  test("inviteCode is 10 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const c = db.inviteCode();
      expect(c).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    }
  });
  test("randomToken is base64url and unique", () => {
    const a = db.randomToken(), b = db.randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test("sha256Hex", async () => {
    expect(await db.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("errorResponse shape and status mapping", async () => {
    const res = db.errorResponse("conflict", "nope");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", message: "nope" } });
    expect(db.errorResponse("rate_limited", "slow", 429, { "Retry-After": "7" }).headers.get("Retry-After")).toBe("7");
  });
  test("nowIso uses injected clock", () => {
    expect(db.nowIso({ now: () => 0 })).toBe("1970-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-db.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/db.js
"use strict";
// Shared helpers for the team-sync Worker modules. Uses only Web APIs that exist
// in both Workers and Node ≥ 20 (crypto.getRandomValues, crypto.subtle, Response).

const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U
const INVITE_LENGTH = 10;

const STATUS_FOR_CODE = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  invalid: 400,
  rate_limited: 429,
};

function uuid() {
  return crypto.randomUUID();
}

function nowIso(deps = {}) {
  const now = deps.now || Date.now;
  return new Date(now()).toISOString();
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function inviteCode() {
  const bytes = new Uint8Array(INVITE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return out;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorResponse(code, message, status = STATUS_FOR_CODE[code] || 500, extraHeaders = {}) {
  return json({ error: { code, message } }, status, extraHeaders);
}

module.exports = { uuid, nowIso, sha256Hex, randomToken, inviteCode, json, errorResponse, STATUS_FOR_CODE, INVITE_ALPHABET, INVITE_LENGTH };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-db.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/db.js tests/unit/worker-sync-db.test.js
git commit -m "feat(sync-worker): shared helpers (ids, tokens, invite codes, json responses)"
```

---

### Task 3: Rate limiter (KV fixed window)

**Files:**
- Create: `workers/sync/src/ratelimit.js`
- Test: `tests/unit/worker-sync-ratelimit.test.js`

**Interfaces:**
- Produces: `checkRateLimit(kv, key, limit, windowSeconds, deps) → Promise<{ ok: boolean, retryAfterSeconds: number }>`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-ratelimit.test.js
"use strict";
const { checkRateLimit } = require("../../workers/sync/src/ratelimit");
const { createTestKV } = require("../helpers/d1Shim");

test("allows `limit` hits per window then rejects with retryAfter", async () => {
  let t = 1_000_000;
  const deps = { now: () => t };
  const kv = createTestKV({ now: () => t });
  for (let i = 0; i < 3; i++) expect((await checkRateLimit(kv, "u1", 3, 60, deps)).ok).toBe(true);
  const rejected = await checkRateLimit(kv, "u1", 3, 60, deps);
  expect(rejected.ok).toBe(false);
  expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  t += 61_000; // next window
  expect((await checkRateLimit(kv, "u1", 3, 60, deps)).ok).toBe(true);
});

test("keys are independent", async () => {
  const kv = createTestKV();
  await checkRateLimit(kv, "a", 1, 60);
  expect((await checkRateLimit(kv, "a", 1, 60)).ok).toBe(false);
  expect((await checkRateLimit(kv, "b", 1, 60)).ok).toBe(true);
});

test("a missing KV binding fails open (never blocks writes)", async () => {
  expect((await checkRateLimit(undefined, "a", 1, 60)).ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-ratelimit.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/ratelimit.js
"use strict";
// Fixed-window counter in KV. Key = `${key}:${windowStart}`; value = count; TTL =
// window. KV is eventually consistent, so this is a soft limit — fine for
// abuse-dampening, not for billing.

async function checkRateLimit(kv, key, limit, windowSeconds, deps = {}) {
  if (!kv) return { ok: true, retryAfterSeconds: 0 };
  const now = (deps.now || Date.now)();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = `rl:${key}:${windowStart}`;
  const count = Number((await kv.get(bucket)) || 0);
  if (count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
  }
  await kv.put(bucket, String(count + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
  return { ok: true, retryAfterSeconds: 0 };
}

module.exports = { checkRateLimit };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-ratelimit.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/ratelimit.js tests/unit/worker-sync-ratelimit.test.js
git commit -m "feat(sync-worker): KV fixed-window rate limiter"
```

---

### Task 4: Auth — GitHub login, session lookup, logout

**Files:**
- Create: `workers/sync/src/auth.js`
- Test: `tests/unit/worker-sync-auth.test.js`

**Interfaces:**
- Produces:
  - `handleGithubLogin(request, env, deps) → Response` — `POST { token }` → `200 { sessionToken, user: {id, login, displayName, avatarUrl} }`; `401 unauthorized` if GitHub rejects; `400 invalid` if no token.
  - `authenticate(request, env, deps) → Promise<{ user: {id, login, displayName, avatarUrl}, sessionHash } | null>` — reads `Authorization: Bearer`, validates + slides expiry.
  - `handleLogout(request, env, deps, auth) → Response` — deletes the session → `204`.
  - `deps`: `{ fetchImpl?, now? }`. `SESSION_TTL_MS = 90 days`, `SESSION_BUMP_MS = 1 hour`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-auth.test.js
"use strict";
const { handleGithubLogin, authenticate, handleLogout, SESSION_TTL_MS } = require("../../workers/sync/src/auth");
const { createTestD1 } = require("../helpers/d1Shim");

function ghFetch(user) {
  return async (url, init) => {
    if (String(url) !== "https://api.github.com/user") throw new Error("unexpected url " + url);
    const token = (init.headers.Authorization || "").replace("Bearer ", "");
    if (token !== "gh-good") return new Response("{}", { status: 401 });
    return new Response(JSON.stringify(user), { status: 200 });
  };
}
const GH_USER = { id: 42, login: "vette", name: "Vette", avatar_url: "https://a/v.png" };

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  let t = Date.parse("2026-08-21T12:00:00Z");
  const deps = { fetchImpl: ghFetch(GH_USER), now: () => t, advance: (ms) => { t += ms; } };
  return { env: { SYNC_DB: db }, deps, db };
}
function loginReq(token) {
  return new Request("https://build.axi.link/api/sync/auth/github", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": "AxiForge/0.12.0 linux" },
    body: JSON.stringify({ token }),
  });
}
function authedReq(sessionToken) {
  return new Request("https://build.axi.link/api/sync/teams", { headers: { Authorization: `Bearer ${sessionToken}` } });
}

describe("auth", () => {
  test("first login creates user + identity + session; second login reuses the user", async () => {
    const { env, deps, db } = await setup();
    const r1 = await handleGithubLogin(loginReq("gh-good"), env, deps);
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b1.user).toEqual({ id: expect.any(String), login: "vette", displayName: "Vette", avatarUrl: "https://a/v.png" });

    const r2 = await handleGithubLogin(loginReq("gh-good"), env, deps);
    const b2 = await r2.json();
    expect(b2.user.id).toBe(b1.user.id);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM users").first("c")).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM sessions").first("c")).toBe(2);
    expect(await db.prepare("SELECT client_label FROM sessions").first("client_label")).toBe("AxiForge/0.12.0 linux");
  });

  test("login with a bad GitHub token → 401; missing token → 400", async () => {
    const { env, deps } = await setup();
    expect((await handleGithubLogin(loginReq("gh-bad"), env, deps)).status).toBe(401);
    const r = await handleGithubLogin(new Request("https://x/", { method: "POST", body: "{}" }), env, deps);
    expect(r.status).toBe(400);
  });

  test("GitHub token is never stored", async () => {
    const { env, deps, db } = await setup();
    await handleGithubLogin(loginReq("gh-good"), env, deps);
    const dump = JSON.stringify([
      (await db.prepare("SELECT * FROM users").all()).results,
      (await db.prepare("SELECT * FROM identities").all()).results,
      (await db.prepare("SELECT * FROM sessions").all()).results,
    ]);
    expect(dump).not.toContain("gh-good");
  });

  test("authenticate resolves a valid session, rejects garbage and expired ones, slides expiry hourly", async () => {
    const { env, deps, db } = await setup();
    const { sessionToken } = await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json();

    const a = await authenticate(authedReq(sessionToken), env, deps);
    expect(a.user.login).toBe("vette");
    expect(await authenticate(authedReq("nope"), env, deps)).toBeNull();
    expect(await authenticate(new Request("https://x/"), env, deps)).toBeNull();

    const exp0 = await db.prepare("SELECT expires_at FROM sessions").first("expires_at");
    deps.advance(30 * 60 * 1000); // 30 min: no bump
    await authenticate(authedReq(sessionToken), env, deps);
    expect(await db.prepare("SELECT expires_at FROM sessions").first("expires_at")).toBe(exp0);
    deps.advance(31 * 60 * 1000); // > 1 h: bump
    await authenticate(authedReq(sessionToken), env, deps);
    expect(await db.prepare("SELECT expires_at FROM sessions").first("expires_at")).not.toBe(exp0);

    deps.advance(SESSION_TTL_MS + 1000);
    expect(await authenticate(authedReq(sessionToken), env, deps)).toBeNull();
  });

  test("logout deletes the session", async () => {
    const { env, deps } = await setup();
    const { sessionToken } = await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json();
    const auth = await authenticate(authedReq(sessionToken), env, deps);
    const res = await handleLogout(authedReq(sessionToken), env, deps, auth);
    expect(res.status).toBe(204);
    expect(await authenticate(authedReq(sessionToken), env, deps)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-auth.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/auth.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-auth.test.js --maxWorkers=2`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/auth.js tests/unit/worker-sync-auth.test.js
git commit -m "feat(sync-worker): GitHub-verified login, sliding sessions, logout"
```

---

### Task 5: Teams — create, join, list, members, rename, delete, leave/remove, rotate invite

**Files:**
- Create: `workers/sync/src/teams.js`
- Test: `tests/unit/worker-sync-teams.test.js`

**Interfaces:**
- Produces (all `(request, env, deps, auth, params) → Response`): `createTeam`, `joinTeam`, `listTeams`, `renameTeam`, `deleteTeam`, `listMembers`, `removeMember`, `rotateInvite`. Plus `requireMembership(env, teamId, userId) → Promise<{ team, role } | null>` used by items.js.
- Wire shapes: team = `{ id, name, inviteCode, seq, createdAt }` (inviteCode only included for owners in `listTeams`; always for the creator/joiner response), member = `{ userId, login, displayName, avatarUrl, role, joinedAt }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-teams.test.js
"use strict";
const teams = require("../../workers/sync/src/teams");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  const now = "2026-08-21T12:00:00.000Z";
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-other", "other"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(now) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  return { env, deps, db, owner: as("u-owner", "owner"), member: as("u-mem", "member"), other: as("u-other", "other") };
}
const req = (method, body, ip = "1.2.3.4") => new Request("https://x/api/sync/teams", {
  method, headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: body ? JSON.stringify(body) : undefined,
});

describe("teams", () => {
  test("create → owner membership, invite code; list shows role and seq", async () => {
    const { env, deps, owner } = await setup();
    const res = await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("owner");
    expect(body.team.inviteCode).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    const list = await (await teams.listTeams(req("GET"), env, deps, owner, {})).json();
    expect(list).toEqual([{ team: { id: body.team.id, name: "EWW", inviteCode: body.team.inviteCode, seq: 0, createdAt: expect.any(String) }, role: "owner" }]);
  });

  test("create rejects empty/too-long names", async () => {
    const { env, deps, owner } = await setup();
    expect((await teams.createTeam(req("POST", { name: "  " }), env, deps, owner, {})).status).toBe(400);
    expect((await teams.createTeam(req("POST", { name: "x".repeat(81) }), env, deps, owner, {})).status).toBe(400);
  });

  test("join by invite code → member; idempotent; unknown code 404; members don't see the invite code", async () => {
    const { env, deps, owner, member } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    const j1 = await teams.joinTeam(req("POST", { inviteCode: team.inviteCode.toLowerCase() }), env, deps, member, {});
    expect(j1.status).toBe(200);
    expect((await j1.json()).role).toBe("member");
    const j2 = await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    expect(j2.status).toBe(200);
    expect((await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }), env, deps, member, {})).status).toBe(404);
    const list = await (await teams.listTeams(req("GET"), env, deps, member, {})).json();
    expect(list[0].role).toBe("member");
    expect(list[0].team.inviteCode).toBeUndefined();
  });

  test("join is rate limited per IP (10/min)", async () => {
    const { env, deps, member } = await setup();
    for (let i = 0; i < 10; i++) await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }, "9.9.9.9"), env, deps, member, {});
    const r = await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }, "9.9.9.9"), env, deps, member, {});
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  test("members list; owner can remove a member; member can leave; last owner cannot leave", async () => {
    const { env, deps, owner, member, other } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    const p = { teamId: team.id };
    const members = await (await teams.listMembers(req("GET"), env, deps, member, p)).json();
    expect(members.map((m) => [m.login, m.role])).toEqual([["owner", "owner"], ["member", "member"]]);

    expect((await teams.listMembers(req("GET"), env, deps, other, p)).status).toBe(403);
    expect((await teams.removeMember(req("DELETE"), env, deps, member, { ...p, userId: "u-owner" })).status).toBe(403);
    expect((await teams.removeMember(req("DELETE"), env, deps, owner, { ...p, userId: "u-owner" })).status).toBe(409); // last owner
    expect((await teams.removeMember(req("DELETE"), env, deps, member, { ...p, userId: "u-mem" })).status).toBe(204); // leave
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    expect((await teams.removeMember(req("DELETE"), env, deps, owner, { ...p, userId: "u-mem" })).status).toBe(204); // kick
    expect((await (await teams.listMembers(req("GET"), env, deps, owner, p)).json()).length).toBe(1);
  });

  test("rename/rotate/delete are owner-only; rotate invalidates the old code; delete cascades", async () => {
    const { env, deps, db, owner, member } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    const p = { teamId: team.id };
    expect((await teams.renameTeam(req("PATCH", { name: "New" }), env, deps, member, p)).status).toBe(403);
    expect((await teams.renameTeam(req("PATCH", { name: "New" }), env, deps, owner, p)).status).toBe(200);
    expect(await db.prepare("SELECT name FROM teams WHERE id = ?").bind(team.id).first("name")).toBe("New");

    expect((await teams.rotateInvite(req("POST"), env, deps, member, p)).status).toBe(403);
    const { inviteCode } = await (await teams.rotateInvite(req("POST"), env, deps, owner, p)).json();
    expect(inviteCode).not.toBe(team.inviteCode);
    expect((await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {})).status).toBe(404);

    await db.prepare("INSERT INTO items (team_id, id, type, body, version, seq, created_by, updated_by, updated_at) VALUES (?, 'b1', 'build', '{}', 1, 1, 'u-owner', 'u-owner', ?)").bind(team.id, "2026-08-21T12:00:00.000Z").run();
    expect((await teams.deleteTeam(req("DELETE"), env, deps, member, p)).status).toBe(403);
    expect((await teams.deleteTeam(req("DELETE"), env, deps, owner, p)).status).toBe(204);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM memberships WHERE team_id = ?").bind(team.id).first("c")).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM items WHERE team_id = ?").bind(team.id).first("c")).toBe(0);
  });

  test("requireMembership", async () => {
    const { env, deps, owner, other } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    expect((await teams.requireMembership(env, team.id, "u-owner")).role).toBe("owner");
    expect(await teams.requireMembership(env, team.id, "u-other")).toBeNull();
    expect(await teams.requireMembership(env, "nope", "u-owner")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-teams.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/teams.js
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
    if (owners <= 1) return errorResponse("conflict", "The last owner cannot leave. Delete the team or promote someone first.");
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-teams.test.js --maxWorkers=2`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/teams.js tests/unit/worker-sync-teams.test.js
git commit -m "feat(sync-worker): teams — create/join/list/members/rename/delete/rotate with owner rules"
```

---

### Task 6: Items — changes cursor, versioned put, delete with cascade, bulk

**Files:**
- Create: `workers/sync/src/items.js`
- Test: `tests/unit/worker-sync-items.test.js`

**Interfaces:**
- Produces (all `(request, env, deps, auth, params) → Response`): `getChanges`, `putItem`, `deleteItem`, `bulkItems`. Internal: `writeItem(env, deps, auth, teamId, { itemId, type, parentId, body, baseVersion }) → { status: 200|201|409|400|413|403, version?, seq?, current?, message? }`, `itemWire(row, loginsById)`.
- Wire `Item`: `{ id, type, parentId, body, version, seq, deleted, createdBy: {userId, login}, updatedBy: {userId, login}, updatedAt }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-items.test.js
"use strict";
const items = require("../../workers/sync/src/items");
const teams = require("../../workers/sync/src/teams");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  const now = "2026-08-21T12:00:00.000Z";
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-mem2", "member2"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(now) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  const owner = as("u-owner", "owner"), member = as("u-mem", "member"), member2 = as("u-mem2", "member2");
  const mk = (b) => new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const { team } = await (await teams.createTeam(mk({ name: "T" }), env, deps, owner, {})).json();
  await teams.joinTeam(mk({ inviteCode: team.inviteCode }), env, deps, member, {});
  await teams.joinTeam(mk({ inviteCode: team.inviteCode }), env, deps, member2, {});
  return { env, deps, db, owner, member, member2, teamId: team.id };
}
const jreq = (method, body, url = "https://x/") => new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const put = (env, deps, who, teamId, itemId, body) => items.putItem(jreq("PUT", body), env, deps, who, { teamId, itemId });
const del = (env, deps, who, teamId, itemId, baseVersion) => items.deleteItem(jreq("DELETE", undefined, `https://x/?baseVersion=${baseVersion}`), env, deps, who, { teamId, itemId });
const changes = (env, deps, who, teamId, since = 0, limit = 200) => items.getChanges(jreq("GET", undefined, `https://x/?since=${since}&limit=${limit}`), env, deps, who, { teamId });

describe("items", () => {
  test("create → 201 v1 seq1; update with correct baseVersion → 200 v2 seq2; stale baseVersion → 409 with current", async () => {
    const { env, deps, owner, teamId } = await setup();
    const r1 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "A" }, baseVersion: null });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ version: 1, seq: 1 });
    const r2 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "B" }, baseVersion: 1 });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ version: 2, seq: 2 });
    const r3 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "C" }, baseVersion: 1 });
    expect(r3.status).toBe(409);
    const b3 = await r3.json();
    expect(b3.error.code).toBe("conflict");
    expect(b3.current).toMatchObject({ id: "b1", version: 2, body: { title: "B" }, updatedBy: { login: "owner" } });
  });

  test("create over a live item → 409; create over a tombstone → 201 and un-deletes", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null })).status).toBe(409);
    expect((await del(env, deps, owner, teamId, "b1", 1)).status).toBe(200);
    const r = await put(env, deps, owner, teamId, "b1", { type: "build", body: { x: 1 }, baseVersion: null });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ version: 3, seq: 3 });
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: "b1", deleted: false, version: 3, body: { x: 1 } });
  });

  test("validation: bad type 400, parent must be a live folder in the team 400, oversize 413, boonCoverageHtml stripped", async () => {
    const { env, deps, owner, teamId } = await setup();
    expect((await put(env, deps, owner, teamId, "x", { type: "thing", body: {}, baseVersion: null })).status).toBe(400);
    expect((await put(env, deps, owner, teamId, "x", { type: "build", parentId: "nope", body: {}, baseVersion: null })).status).toBe(400);
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "x", { type: "build", parentId: "b1", body: {}, baseVersion: null })).status).toBe(400); // parent is a build
    await put(env, deps, owner, teamId, "f1", { type: "folder", body: { name: "F" }, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "b2", { type: "build", parentId: "f1", body: {}, baseVersion: null })).status).toBe(201);
    const big = await put(env, deps, owner, teamId, "big", { type: "build", body: { blob: "x".repeat(1_500_001) }, baseVersion: null });
    expect(big.status).toBe(413);
    expect((await big.json()).error.message).toMatch(/build big/);
    await put(env, deps, owner, teamId, "c1", { type: "comp", body: { name: "C", boonCoverageHtml: "<div>huge</div>" }, baseVersion: null });
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.find((i) => i.id === "c1").body).toEqual({ name: "C" });
  });

  test("changes: ordered by seq, paged with limit/hasMore/nextSeq, includes tombstones, since excludes seen", async () => {
    const { env, deps, owner, teamId } = await setup();
    for (let i = 1; i <= 5; i++) await put(env, deps, owner, teamId, `b${i}`, { type: "build", body: { i }, baseVersion: null });
    await del(env, deps, owner, teamId, "b2", 1); // seq 6
    const p1 = await (await changes(env, deps, owner, teamId, 0, 2)).json();
    expect(p1.items.map((i) => i.seq)).toEqual([1, 3]); // b2's seq 1 was replaced by its tombstone at seq 6 — b1=1, b3=3
    expect(p1.hasMore).toBe(true);
    expect(p1.nextSeq).toBe(3);
    const p2 = await (await changes(env, deps, owner, teamId, p1.nextSeq, 2)).json();
    expect(p2.items.map((i) => i.seq)).toEqual([4, 5]);
    const p3 = await (await changes(env, deps, owner, teamId, p2.nextSeq, 2)).json();
    expect(p3.items.map((i) => [i.id, i.seq, i.deleted, i.body])).toEqual([["b2", 6, true, null]]);
    expect(p3.hasMore).toBe(false);
    expect(p3.nextSeq).toBe(6);
    expect((await changes(env, deps, owner, teamId, 0, 999)).status).toBe(400); // limit cap
  });

  test("seq is monotonic and unique under concurrent writes", async () => {
    const { env, deps, owner, teamId } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) => put(env, deps, owner, teamId, `b${i}`, { type: "build", body: {}, baseVersion: null })));
    const { results } = await env.SYNC_DB.prepare("SELECT seq FROM items WHERE team_id = ? ORDER BY seq").bind(teamId).all();
    expect(results.map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await env.SYNC_DB.prepare("SELECT seq FROM teams WHERE id = ?").bind(teamId).first("seq")).toBe(20);
  });

  test("delete: version mismatch 409; member may delete own items only; owner may delete anything; non-member 403", async () => {
    const { env, deps, owner, member, member2, teamId } = await setup();
    await put(env, deps, member, teamId, "mine", { type: "build", body: {}, baseVersion: null });
    await put(env, deps, owner, teamId, "theirs", { type: "build", body: {}, baseVersion: null });
    expect((await del(env, deps, member, teamId, "mine", 7)).status).toBe(409);
    expect((await del(env, deps, member2, teamId, "mine", 1)).status).toBe(403);
    expect((await del(env, deps, member, teamId, "theirs", 1)).status).toBe(403);
    expect((await del(env, deps, member, teamId, "mine", 1)).status).toBe(200);
    expect((await del(env, deps, owner, teamId, "theirs", 1)).status).toBe(200);
    expect((await del(env, deps, owner, teamId, "theirs", 2)).status).toBe(404); // already a tombstone
    const outsider = { user: { id: "u-nobody", login: "nobody" } };
    expect((await put(env, deps, outsider, teamId, "z", { type: "build", body: {}, baseVersion: null })).status).toBe(403);
  });

  test("folder delete cascades with per-item seqs; member needs to have created every descendant", async () => {
    const { env, deps, owner, member, teamId } = await setup();
    await put(env, deps, member, teamId, "f1", { type: "folder", body: { name: "F" }, baseVersion: null });
    await put(env, deps, member, teamId, "f2", { type: "folder", parentId: "f1", body: { name: "G" }, baseVersion: null });
    await put(env, deps, member, teamId, "b1", { type: "build", parentId: "f2", body: {}, baseVersion: null });
    await put(env, deps, owner, teamId, "b2", { type: "build", parentId: "f1", body: {}, baseVersion: null });
    expect((await del(env, deps, member, teamId, "f1", 1)).status).toBe(403); // b2 is not theirs
    const r = await del(env, deps, owner, teamId, "f1", 1);
    expect(r.status).toBe(200);
    const all = await (await changes(env, deps, owner, teamId, 4)).json();
    expect(all.items.map((i) => [i.id, i.deleted]).sort()).toEqual([["b1", true], ["b2", true], ["f1", true], ["f2", true]]);
    expect(new Set(all.items.map((i) => i.seq)).size).toBe(4);
  });

  test("bulk: per-item results, one conflict does not fail the rest, ≤50 items", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    const r = await items.bulkItems(jreq("POST", { items: [
      { itemId: "b1", type: "build", body: {}, baseVersion: null },   // conflict (exists)
      { itemId: "b2", type: "build", body: {}, baseVersion: null },   // created
      { itemId: "b3", type: "nope", body: {}, baseVersion: null },    // invalid
    ] }), env, deps, owner, { teamId });
    expect(r.status).toBe(200);
    const { results } = await r.json();
    expect(results.map((x) => [x.itemId, x.status])).toEqual([["b1", 409], ["b2", 201], ["b3", 400]]);
    expect(results[0].current.id).toBe("b1");
    const tooMany = await items.bulkItems(jreq("POST", { items: Array.from({ length: 51 }, (_, i) => ({ itemId: `x${i}`, type: "build", body: {}, baseVersion: null })) }), env, deps, owner, { teamId });
    expect(tooMany.status).toBe(400);
  });

  test("write rate limit: 120/min/user → 429", async () => {
    const { env, deps, owner, teamId } = await setup();
    for (let i = 0; i < 120; i++) await put(env, deps, owner, teamId, `b${i}`, { type: "build", body: {}, baseVersion: null });
    const r = await put(env, deps, owner, teamId, "late", { type: "build", body: {}, baseVersion: null });
    expect(r.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-items.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/items.js
"use strict";
const { nowIso, json, errorResponse } = require("./db");
const { readJson } = require("./auth");
const { requireMembership } = require("./teams");
const { checkRateLimit } = require("./ratelimit");

const MAX_BODY_BYTES = 1_500_000;
const MAX_PAGE = 200;
const MAX_BULK = 50;
const WRITES_PER_MIN = 120;
const TYPES = new Set(["folder", "build", "comp"]);

function bytes(str) { return new TextEncoder().encode(str).length; }

async function loginsFor(env, userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.SYNC_DB.prepare(
    `SELECT user_id, login FROM identities WHERE user_id IN (${placeholders}) ORDER BY provider = 'github' DESC`
  ).bind(...ids).all();
  const map = new Map();
  for (const r of results) if (!map.has(r.user_id)) map.set(r.user_id, r.login);
  return map;
}

function itemWire(row, logins) {
  return {
    id: row.id,
    type: row.type,
    parentId: row.parent_id,
    body: row.body ? JSON.parse(row.body) : null,
    version: row.version,
    seq: row.seq,
    deleted: row.deleted === 1,
    createdBy: { userId: row.created_by, login: logins.get(row.created_by) || null },
    updatedBy: { userId: row.updated_by, login: logins.get(row.updated_by) || null },
    updatedAt: row.updated_at,
  };
}

async function currentItem(env, teamId, itemId) {
  const row = await env.SYNC_DB.prepare("SELECT * FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId).first();
  if (!row) return null;
  return itemWire(row, await loginsFor(env, [row.created_by, row.updated_by]));
}

async function memberOr403(env, teamId, auth) {
  const m = await requireMembership(env, teamId, auth.user.id);
  if (!m) return { error: errorResponse("forbidden", "You are not a member of this team.") };
  return { membership: m };
}

async function writeLimited(env, deps, auth) {
  const rl = await checkRateLimit(env.SYNC_RL, `write:${auth.user.id}`, WRITES_PER_MIN, 60, deps);
  if (rl.ok) return null;
  return errorResponse("rate_limited", "Too many changes too quickly. Try again shortly.", 429, { "Retry-After": String(rl.retryAfterSeconds) });
}

// Core write. Returns a plain result (not a Response) so bulk can reuse it.
async function writeItem(env, deps, auth, teamId, { itemId, type, parentId, body, baseVersion }) {
  if (!itemId || typeof itemId !== "string" || itemId.length > 64) return { status: 400, message: "Invalid item id." };
  if (!TYPES.has(type)) return { status: 400, message: `Invalid type "${type}".` };
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { status: 400, message: "body must be an object." };
  parentId = typeof parentId === "string" && parentId ? parentId : null;
  if (parentId === itemId) return { status: 400, message: "An item cannot be its own parent." };
  if (baseVersion !== null && baseVersion !== undefined && !(Number.isInteger(baseVersion) && baseVersion >= 1)) {
    return { status: 400, message: "baseVersion must be null or a positive integer." };
  }
  if (type === "comp" && body && "boonCoverageHtml" in body) {
    body = { ...body };
    delete body.boonCoverageHtml;
  }
  const text = JSON.stringify(body);
  if (bytes(text) > MAX_BODY_BYTES) {
    return { status: 413, message: `This ${type} (${type} ${itemId}) is too large to sync (limit ${MAX_BODY_BYTES / 1_000_000} MB).` };
  }
  if (parentId) {
    const parent = await env.SYNC_DB.prepare("SELECT type, deleted FROM items WHERE team_id = ? AND id = ?").bind(teamId, parentId).first();
    if (!parent || parent.deleted === 1 || parent.type !== "folder") return { status: 400, message: "parentId must be a live folder in this team." };
  }

  const db = env.SYNC_DB;
  const now = nowIso(deps);
  const existing = await db.prepare("SELECT version, deleted FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId).first();
  const base = baseVersion ?? null;

  const bump = db.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(teamId);
  const seqSub = "(SELECT seq FROM teams WHERE id = ?)";
  let write, created;
  if (!existing) {
    if (base !== null) return { status: 409, current: null, message: "Item does not exist (baseVersion must be null to create)." };
    created = true;
    write = db.prepare(
      `INSERT INTO items (team_id, id, type, parent_id, body, version, seq, deleted, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ${seqSub}, 0, ?, ?, ?)`
    ).bind(teamId, itemId, type, parentId, text, teamId, auth.user.id, auth.user.id, now);
  } else if (existing.deleted === 1) {
    if (base !== null) return { status: 409, current: await currentItem(env, teamId, itemId) };
    created = true;
    write = db.prepare(
      `UPDATE items SET type = ?, parent_id = ?, body = ?, version = version + 1, seq = ${seqSub}, deleted = 0,
              created_by = ?, updated_by = ?, updated_at = ?
        WHERE team_id = ? AND id = ? AND deleted = 1`
    ).bind(type, parentId, text, teamId, auth.user.id, auth.user.id, now, teamId, itemId);
  } else {
    if (base === null || base !== existing.version) return { status: 409, current: await currentItem(env, teamId, itemId) };
    created = false;
    write = db.prepare(
      `UPDATE items SET type = ?, parent_id = ?, body = ?, version = version + 1, seq = ${seqSub}, updated_by = ?, updated_at = ?
        WHERE team_id = ? AND id = ? AND version = ? AND deleted = 0`
    ).bind(type, parentId, text, teamId, auth.user.id, now, teamId, itemId, base);
  }
  const read = db.prepare("SELECT version, seq FROM items WHERE team_id = ? AND id = ?").bind(teamId, itemId);

  let results;
  try {
    results = await db.batch([bump, write, read]);
  } catch (err) {
    // Concurrent create on the same id → PK violation. Report as conflict.
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err.message))) {
      return { status: 409, current: await currentItem(env, teamId, itemId) };
    }
    throw err;
  }
  if (!created && results[1].meta.changes === 0) {
    // Lost the race between our SELECT and the guarded UPDATE.
    return { status: 409, current: await currentItem(env, teamId, itemId) };
  }
  const row = results[2].results[0];
  return { status: created ? 201 : 200, version: row.version, seq: row.seq };
}

// GET /teams/:teamId/changes?since=&limit=
async function getChanges(request, env, _deps, auth, params) {
  const { error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") || 0);
  const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : MAX_PAGE;
  if (!Number.isInteger(since) || since < 0) return errorResponse("invalid", "since must be a non-negative integer.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) return errorResponse("invalid", `limit must be 1–${MAX_PAGE}.`);
  const { results } = await env.SYNC_DB.prepare(
    "SELECT * FROM items WHERE team_id = ? AND seq > ? ORDER BY seq LIMIT ?"
  ).bind(params.teamId, since, limit + 1).all();
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const logins = await loginsFor(env, page.flatMap((r) => [r.created_by, r.updated_by]));
  return json({
    items: page.map((r) => itemWire(r, logins)),
    nextSeq: page.length ? page[page.length - 1].seq : since,
    hasMore,
  });
}

// PUT /teams/:teamId/items/:itemId
async function putItem(request, env, deps, auth, params) {
  const { error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return errorResponse("invalid", "Invalid JSON.");
  const result = await writeItem(env, deps, auth, params.teamId, { itemId: params.itemId, ...body });
  return writeResultResponse(result);
}

function writeResultResponse(result) {
  if (result.status === 201 || result.status === 200) return json({ version: result.version, seq: result.seq }, result.status);
  if (result.status === 409) return json({ error: { code: "conflict", message: result.message || "Item was changed by someone else." }, current: result.current }, 409);
  if (result.status === 413) return errorResponse("too_large", result.message);
  if (result.status === 403) return errorResponse("forbidden", result.message);
  if (result.status === 404) return errorResponse("not_found", result.message);
  return errorResponse("invalid", result.message || "Invalid request.");
}

// Collect a folder's live descendants (folders + items) via parent_id.
async function collectTree(env, teamId, rootId) {
  const { results } = await env.SYNC_DB.prepare(
    "SELECT id, type, parent_id, created_by, version FROM items WHERE team_id = ? AND deleted = 0"
  ).bind(teamId).all();
  const byParent = new Map();
  for (const r of results) {
    const list = byParent.get(r.parent_id) || [];
    list.push(r);
    byParent.set(r.parent_id, list);
  }
  const out = [];
  const queue = [rootId];
  while (queue.length) {
    const pid = queue.shift();
    for (const child of byParent.get(pid) || []) {
      out.push(child);
      if (child.type === "folder") queue.push(child.id);
    }
  }
  return out;
}

// DELETE /teams/:teamId/items/:itemId?baseVersion=N
async function deleteItem(request, env, deps, auth, params) {
  const { error, membership } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const baseVersion = Number(new URL(request.url).searchParams.get("baseVersion"));
  if (!Number.isInteger(baseVersion) || baseVersion < 1) return errorResponse("invalid", "baseVersion query param is required.");

  const db = env.SYNC_DB;
  const row = await db.prepare("SELECT * FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId).first();
  if (!row || row.deleted === 1) return errorResponse("not_found", "Item not found.");
  if (row.version !== baseVersion) {
    return json({ error: { code: "conflict", message: "Item was changed since you last saw it." }, current: await currentItem(env, params.teamId, params.itemId) }, 409);
  }
  const isOwner = membership.role === "owner";
  const descendants = row.type === "folder" ? await collectTree(env, params.teamId, row.id) : [];
  if (!isOwner) {
    const notMine = [row, ...descendants].some((r) => r.created_by !== auth.user.id);
    if (notMine) return errorResponse("forbidden", "Only the team owner or the item's creator can delete it.");
  }

  const now = nowIso(deps);
  const stmts = [];
  for (const r of [row, ...descendants]) {
    stmts.push(db.prepare("UPDATE teams SET seq = seq + 1 WHERE id = ?").bind(params.teamId));
    stmts.push(db.prepare(
      `UPDATE items SET deleted = 1, body = NULL, version = version + 1, seq = (SELECT seq FROM teams WHERE id = ?), updated_by = ?, updated_at = ?
        WHERE team_id = ? AND id = ? AND deleted = 0`
    ).bind(params.teamId, auth.user.id, now, params.teamId, r.id));
  }
  stmts.push(db.prepare("SELECT version, seq FROM items WHERE team_id = ? AND id = ?").bind(params.teamId, params.itemId));
  const results = await db.batch(stmts);
  const out = results[results.length - 1].results[0];
  return json({ version: out.version, seq: out.seq });
}

// POST /teams/:teamId/items:bulk { items: [...] }
async function bulkItems(request, env, deps, auth, params) {
  const { error } = await memberOr403(env, params.teamId, auth);
  if (error) return error;
  const limited = await writeLimited(env, deps, auth);
  if (limited) return limited;
  const body = await readJson(request);
  const list = body && Array.isArray(body.items) ? body.items : null;
  if (!list) return errorResponse("invalid", "items must be an array.");
  if (list.length > MAX_BULK) return errorResponse("invalid", `At most ${MAX_BULK} items per bulk request.`);
  const results = [];
  for (const entry of list) {
    const r = await writeItem(env, deps, auth, params.teamId, entry || {});
    results.push({ itemId: entry && entry.itemId, status: r.status, version: r.version, seq: r.seq, current: r.current, message: r.message });
  }
  return json({ results });
}

module.exports = { getChanges, putItem, deleteItem, bulkItems, writeItem, itemWire, MAX_BODY_BYTES, MAX_PAGE, MAX_BULK };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-items.test.js --maxWorkers=2`
Expected: PASS (9 tests). If the "changes" paging test fails on `[1, 3]`, re-read the test comment: `b2`'s original row (seq 2) is overwritten by its tombstone (seq 6), so the first page is seq 1 and 3.

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/items.js tests/unit/worker-sync-items.test.js
git commit -m "feat(sync-worker): versioned items with per-team seq cursor, cascading deletes, bulk"
```

---

### Task 7: Tombstone purge (cron)

**Files:**
- Create: `workers/sync/src/purge.js`
- Test: `tests/unit/worker-sync-purge.test.js`

**Interfaces:**
- Produces: `purgeTombstones(env, deps) → Promise<{ deleted: number }>`; `TOMBSTONE_TTL_MS = 30 days`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-purge.test.js
"use strict";
const { purgeTombstones, TOMBSTONE_TTL_MS } = require("../../workers/sync/src/purge");
const { createTestD1 } = require("../helpers/d1Shim");

test("deletes tombstones older than 30 days, keeps younger ones and live items", async () => {
  const db = createTestD1();
  await db.applyMigrations();
  const now = Date.parse("2026-08-21T12:00:00Z");
  await db.prepare("INSERT INTO users VALUES ('u', 'u', NULL, '2026-01-01T00:00:00.000Z')").run();
  await db.prepare("INSERT INTO teams VALUES ('t', 'T', 'ABCDEFGHJK', 3, 'u', '2026-01-01T00:00:00.000Z')").run();
  const ins = (id, deleted, updatedAt) => db.prepare(
    "INSERT INTO items (team_id, id, type, body, version, seq, deleted, created_by, updated_by, updated_at) VALUES ('t', ?, 'build', NULL, 1, 1, ?, 'u', 'u', ?)"
  ).bind(id, deleted, updatedAt).run();
  await ins("old-tomb", 1, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  await ins("new-tomb", 1, new Date(now - 1000).toISOString());
  await ins("old-live", 0, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  const r = await purgeTombstones({ SYNC_DB: db }, { now: () => now });
  expect(r.deleted).toBe(1);
  const ids = (await db.prepare("SELECT id FROM items ORDER BY id").all()).results.map((x) => x.id);
  expect(ids).toEqual(["new-tomb", "old-live"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-purge.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/purge.js
"use strict";
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Clients that have been offline longer than 30 days do a full re-pull anyway
// (their cursor is older than any surviving tombstone would matter for), so
// tombstones can be dropped after that.
async function purgeTombstones(env, deps = {}) {
  const cutoff = new Date((deps.now || Date.now)() - TOMBSTONE_TTL_MS).toISOString();
  const r = await env.SYNC_DB.prepare("DELETE FROM items WHERE deleted = 1 AND updated_at < ?").bind(cutoff).run();
  return { deleted: r.meta.changes };
}

module.exports = { purgeTombstones, TOMBSTONE_TTL_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-purge.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/purge.js tests/unit/worker-sync-purge.test.js
git commit -m "feat(sync-worker): daily tombstone purge"
```

---

### Task 8: Router — `/api/sync/*` dispatch, auth gate, error handling

**Files:**
- Create: `workers/sync/src/router.js`
- Test: `tests/unit/worker-sync-router.test.js`

**Interfaces:**
- Produces: `handleSync(request, env, deps?) → Promise<Response>`; returns `null` if the path is not under `/api/sync/`.
- Consumes: every handler from Tasks 4–6 with the uniform `(request, env, deps, auth, params)` signature.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/worker-sync-router.test.js
"use strict";
const { handleSync } = require("../../workers/sync/src/router");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

const GH = { id: 7, login: "vette", name: "Vette", avatar_url: null };
async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = {
    now: () => Date.parse("2026-08-21T12:00:00Z"),
    fetchImpl: async (_url, init) => (init.headers.Authorization === "Bearer gh-good"
      ? new Response(JSON.stringify(GH), { status: 200 }) : new Response("{}", { status: 401 })),
  };
  const call = (method, path, { body, token } = {}) => handleSync(new Request(`https://build.axi.link/api/sync${path}`, {
    method, headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, deps);
  return { env, deps, call };
}

describe("sync router", () => {
  test("returns null for non-sync paths", async () => {
    const { env, deps } = await setup();
    expect(await handleSync(new Request("https://build.axi.link/api/shorten"), env, deps)).toBeNull();
  });

  test("end-to-end: login → create team → put item → changes → logout → 401", async () => {
    const { call } = await setup();
    const login = await call("POST", "/auth/github", { body: { token: "gh-good" } });
    expect(login.status).toBe(200);
    const { sessionToken } = await login.json();

    const created = await call("POST", "/teams", { body: { name: "EWW" }, token: sessionToken });
    expect(created.status).toBe(201);
    const { team } = await created.json();

    const put = await call("PUT", `/teams/${team.id}/items/b1`, { body: { type: "build", body: { title: "A" }, baseVersion: null }, token: sessionToken });
    expect(put.status).toBe(201);

    const ch = await call("GET", `/teams/${team.id}/changes?since=0`, { token: sessionToken });
    expect((await ch.json()).items[0].body).toEqual({ title: "A" });

    const members = await call("GET", `/teams/${team.id}/members`, { token: sessionToken });
    expect((await members.json())[0].login).toBe("vette");

    expect((await call("DELETE", `/teams/${team.id}/items/b1?baseVersion=1`, { token: sessionToken })).status).toBe(200);
    expect((await call("POST", `/teams/${team.id}/items:bulk`, { body: { items: [] }, token: sessionToken })).status).toBe(200);
    expect((await call("POST", `/teams/${team.id}/invite/rotate`, { token: sessionToken })).status).toBe(200);
    expect((await call("PATCH", `/teams/${team.id}`, { body: { name: "X" }, token: sessionToken })).status).toBe(200);

    expect((await call("DELETE", "/auth/session", { token: sessionToken })).status).toBe(204);
    const after = await call("GET", "/teams", { token: sessionToken });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  test("unauthenticated protected route → 401; unknown route → 404; wrong method → 405", async () => {
    const { call } = await setup();
    expect((await call("GET", "/teams")).status).toBe(401);
    expect((await call("GET", "/nope")).status).toBe(404);
    expect((await call("GET", "/auth/github")).status).toBe(405);
  });

  test("handler exceptions become 500 JSON, never a thrown error", async () => {
    const { env, deps, call } = await setup();
    env.SYNC_DB = { prepare() { throw new Error("db down"); } };
    const res = await call("POST", "/auth/github", { body: { token: "gh-good" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-router.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// workers/sync/src/router.js
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
      const params = Object.fromEntries(Object.entries(match.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-router.test.js --maxWorkers=2`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/router.js tests/unit/worker-sync-router.test.js
git commit -m "feat(sync-worker): /api/sync router with auth gate and uniform errors"
```

---

### Task 9: Mount in the Worker entry, wrangler config, cron, deploy notes

**Files:**
- Modify: `workers/share-shortener/src/index.js` (the `export default { fetch }` block at the bottom)
- Modify: `wrangler.jsonc`
- Create: `workers/sync/README.md`
- Test: `tests/unit/worker-sync-mount.test.js`

**Interfaces:**
- Consumes: `handleSync` (Task 8), `purgeTombstones` (Task 7).

- [ ] **Step 1: Write the failing test**

The Worker entry is ESM (`export default`), which Jest's CJS runner can't `require`. Test the mount by asserting the source wires the two pieces — cheap and catches accidental removal:

```js
// tests/unit/worker-sync-mount.test.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ENTRY = path.join(__dirname, "../../workers/share-shortener/src/index.js");
const WRANGLER = path.join(__dirname, "../../wrangler.jsonc");

test("Worker entry dispatches /api/sync/* to handleSync before asset fallback and exposes scheduled()", () => {
  const src = fs.readFileSync(ENTRY, "utf8");
  expect(src).toMatch(/startsWith\("\/api\/sync\/"\)/);
  expect(src).toMatch(/import\("\.\.\/\.\.\/sync\/src\/router\.js"\)/);
  expect(src).toMatch(/async scheduled\(/);
  expect(src).toMatch(/purgeTombstones/);
  expect(src.indexOf("/api/sync/")).toBeLessThan(src.indexOf("env.ASSETS.fetch(request)"));
});

test("wrangler.jsonc binds SYNC_DB, SYNC_RL, routes /api/sync/* to the Worker, and schedules the purge", () => {
  const raw = fs.readFileSync(WRANGLER, "utf8");
  expect(raw).toMatch(/"binding":\s*"SYNC_DB"/);
  expect(raw).toMatch(/"migrations_dir":\s*"workers\/sync\/migrations"/);
  expect(raw).toMatch(/"binding":\s*"SYNC_RL"/);
  expect(raw).toMatch(/"\/api\/sync\/\*"/);
  expect(raw).toMatch(/"crons":\s*\[\s*"0 4 \* \* \*"\s*\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/worker-sync-mount.test.js --maxWorkers=2`
Expected: FAIL on the first `toMatch`.

- [ ] **Step 3: Mount the router and scheduled handler**

Replace the `export default { … }` block at the bottom of `workers/share-shortener/src/index.js` with:

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Team sync API (workers/sync). Checked first: it owns everything under /api/sync/.
    if (pathname.startsWith("/api/sync/")) {
      const { handleSync } = await import("../../sync/src/router.js");
      const res = await handleSync(request, env);
      if (res) return res;
    }

    if (pathname === "/api/shorten") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return handleShorten(request, env);
    }

    if (pathname === "/api/gw2skills") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const { handleGw2Skills } = await import("./gw2skills-route.js");
      return handleGw2Skills(url.searchParams.get("url") || "", env, {
        gameMode: url.searchParams.get("gameMode") || undefined,
      });
    }

    const resolveMatch = pathname.match(/^\/api\/b\/([^/]+)$/);
    if (resolveMatch) {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return handleResolve(resolveMatch[1], env);
    }

    if (/^\/b\/[0-9A-Za-z]{7,9}$/.test(pathname) && request.method === "GET") {
      return serveShell(request, env);
    }

    // Everything else: static assets (the built SPA).
    return env.ASSETS.fetch(request);
  },

  // Daily: drop team-sync tombstones older than 30 days.
  async scheduled(_event, env, ctx) {
    const { purgeTombstones } = await import("../../sync/src/purge.js");
    ctx.waitUntil(purgeTombstones(env).then((r) => console.log(`[sync] purged ${r.deleted} tombstones`)));
  },
};
```

- [ ] **Step 4: Update `wrangler.jsonc`**

Add inside the top-level object (keep the existing keys). The `database_id` is filled in Step 6:

```jsonc
  // Team sync (workers/sync): D1 for teams/items, KV for rate-limit counters.
  "d1_databases": [
    {
      "binding": "SYNC_DB",
      "database_name": "axiforge-sync",
      "database_id": "REPLACE_WITH_ID_FROM_wrangler_d1_create",
      "migrations_dir": "workers/sync/migrations"
    }
  ],
  "triggers": { "crons": ["0 4 * * *"] },
```

Add a second entry to `kv_namespaces`:

```jsonc
    {
      "binding": "SYNC_RL",
      "id": "REPLACE_WITH_ID_FROM_wrangler_kv_namespace_create",
      "preview_id": "REPLACE_WITH_PREVIEW_ID"
    }
```

And extend `run_worker_first` to `["/api/*", "/b/*", "/api/sync/*"]` (the `/api/*` entry already covers it, but being explicit documents intent and is what the test asserts).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/worker-sync-mount.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Provision Cloudflare resources and apply migrations (one-time, needs the Cloudflare login)**

```bash
npx wrangler d1 create axiforge-sync          # paste database_id into wrangler.jsonc
npx wrangler kv namespace create SYNC_RL      # paste id into wrangler.jsonc
npx wrangler kv namespace create SYNC_RL --preview   # paste preview_id
npx wrangler d1 migrations apply axiforge-sync --local    # for wrangler dev
npx wrangler d1 migrations apply axiforge-sync --remote   # production
```

Then run the full existing Worker locally and smoke it:

```bash
npx wrangler dev --local &
curl -s -X POST localhost:8787/api/sync/auth/github -H 'content-type: application/json' -d '{"token":"bad"}'
# → {"error":{"code":"unauthorized","message":"GitHub rejected the token."}}
```

- [ ] **Step 7: Write `workers/sync/README.md`**

```markdown
# Team sync API (`/api/sync/*`)

Spec: `docs/superpowers/specs/2026-08-21-team-sync-design.md`.

## Local dev
    npx wrangler d1 migrations apply axiforge-sync --local
    npx wrangler dev --local
    # desktop app against it:
    AXIFORGE_SYNC_BASE=http://localhost:8787/api/sync npm run dev

## Deploy
    npx wrangler d1 migrations apply axiforge-sync --remote
    npm run deploy:web        # builds the Playground + deploys the Worker

## Tests
    npx jest tests/unit/worker-sync --maxWorkers=2
Handlers take `(request, env, deps)`; tests inject a node:sqlite D1 shim
(`tests/helpers/d1Shim.js`), a Map KV, a fake `fetchImpl`, and a fixed `now`.

## Adding a migration
Create `workers/sync/migrations/NNNN_name.sql` (idempotent SQL), then apply
locally and remotely as above. The test shim applies every file in order.
```

- [ ] **Step 8: Run the whole unit suite and commit**

Run: `npx jest tests/unit --maxWorkers=2`
Expected: all green (previous count + the new worker-sync suites).

```bash
git add workers/share-shortener/src/index.js wrangler.jsonc workers/sync/README.md tests/unit/worker-sync-mount.test.js
git commit -m "feat(sync-worker): mount /api/sync in the Worker, D1/KV bindings, daily purge cron"
```

---

## Self-review

**Spec coverage (§1):** 1.1 hosting → T9; 1.2 schema → T1; 1.3 auth → T4; 1.4 endpoints → T5/T6/T8 (all 14 routes present in `ROUTES`); 1.5 write semantics (seq in same batch, version rules, tombstone re-create, folder cascade, bulk per-item) → T6; 1.6 roles → T5 (team ops) + T6 (delete rules incl. "member may delete a folder tree only if every descendant is theirs"); 1.7 limits (1.5 MB, strip `boonCoverageHtml`, 120 writes/min, invite alphabet, join 10/min/IP) → T6/T3/T2/T5; 1.8 tests → each task; §5 "Team deleted by owner" is a client concern (Plan 2); §7 rollout step 1 → T9 step 6.

**Placeholder scan:** the only `REPLACE_WITH_*` strings are the Cloudflare resource ids that can only come from `wrangler … create` at provisioning time (T9 step 6 tells the executor exactly which command yields them).

**Type consistency:** `requireMembership(env, teamId, userId) → {team, role}|null` defined in T5, consumed in T6; handler signature `(request, env, deps, auth, params)` is identical across T4–T8; `writeItem` result statuses `{200,201,400,409,413}` are exactly what `writeResultResponse` and `bulkItems` map; `Item` wire shape in `itemWire` matches the spec's `Item`.
