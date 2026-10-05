# Sync access policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The team-sync Worker refuses GitHub users on the Axi access denylist: login is refused with a neutral 403, and an already signed-in user loses every session (D1 rows and `sess:` KV cache entries).

**Architecture:** A new `workers/sync/src/policy.js` reads the public Axi manifest (`denylist` = SHA-256 hashes of `kind:normalized` identifiers), caching it in the existing `SYNC_RL` KV namespace (240 s) behind a 60 s per-isolate memo, and answers `isGithubUserBlocked(env, deps, githubId)`. `auth.js` calls it in `handleGithubLogin` (before any D1 write) and in `authenticate()` on both the cached and cold paths. The check is enabled only when `env.POLICY_MANIFEST_URL` is set (set in `wrangler.jsonc`), so tests and local dev never reach the network unless they opt in. It fails open: an unreachable or malformed manifest refuses nobody.

**Tech Stack:** Cloudflare Worker (CommonJS modules under `workers/sync/src`), D1, KV, Jest 30 with the node:sqlite D1 shim in `tests/helpers/d1Shim.js`.

**Spec:** `darkharasho/axi-config` → `docs/superpowers/specs/2026-10-05-axi-config-design.md`, section "Server-side enforcement → axiforge sync Worker" (private repo; the relevant rules are copied into Global Constraints below).

## Spec deltas (decided here)

- **Signed-in user on the denylist gets 401, not 403.** The spec asks for a neutral 403 on login and for session deletion in `authenticate()`. `authenticate()` deletes every session of the user and returns `null`, so the router's existing 401 "Sign in to sync teams." answers. Reason: the desktop client treats a 403 on a mutation as "this change was rejected" and drops the outbox entry (`src/main/teamSync.js` around lines 473 and 841); a 403 on every request would discard the user's local edits, and the spec puts deleting a banned party's data out of scope. A 401 makes the client simply signed out. The next login then gets the 403.
- **Manifest cache lives in KV + a memo** instead of a module-level cache only, so all isolates share one fetch per 4 minutes and tests stay isolated (the memo is a `WeakMap` keyed by the KV binding).

## Global Constraints

- Identity hash: `sha256_hex("github_user:" + normalized)`, where `normalized` is the decimal GitHub user id after NFC → trim → lowercase → NFC, valid only if it matches `^[1-9]\d{0,19}$`. Vector: id `1234567` → `ba52ca31dec642ad640ce0bbbf8382b6f89493a8ac7d965d2e69659c654a6b2f`.
- Manifest: `GET https://config.axi.link/v1/manifest?app=axiforge` → JSON `{ version, flags, minVersion, notice, denylist: string[] }`; `denylist` holds only lowercase SHA-256 hex strings.
- Removing a ban must restore service access within 5 minutes (KV TTL 240 s + memo 60 s).
- Refusal message is neutral and identical everywhere: `"Access unavailable for this account."` (error code `forbidden`, HTTP 403) on login. It never says which identifier matched.
- Share links (`/b/*`) are untouched. No telemetry: nothing reports a match anywhere.
- The policy check fails open (fetch error, non-2xx, bad JSON, missing `denylist` → nobody refused), and logs a `console.warn`.
- Never deploy (`wrangler deploy`, `npm run deploy:web`, remote migrations) during implementation; deployment is a manual operator step.
- Tests run with `--maxWorkers=2`.
- Commits use Conventional Commits with scope `sync` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A session cached before this change (KV entry without `githubId`) must still be checked: it falls through to the D1 path, which re-caches it with `githubId`.
2. A user banned while signed in on two devices: one request from either device must remove both sessions and both `sess:` entries.
3. The manifest endpoint being down (DNS not yet live, 5xx) must not slow every request: a failure is memoized for 60 s, so at most one fetch per minute per isolate.
4. A user who is unbanned must be able to log in again once the cache lapses, and their teams/data are intact (nothing but sessions was deleted).
5. The warm-cache path must still cost zero D1 calls for a non-banned user (existing test "a second request inside the cache window resolves without touching D1").

## File Structure

- Create `workers/sync/src/policy.js` — manifest loading/caching and `isGithubUserBlocked`.
- Create `tests/unit/worker-sync-policy.test.js` — policy unit tests.
- Modify `workers/sync/src/auth.js` — login refusal, session revocation, `githubId` in the session cache.
- Modify `tests/unit/worker-sync-auth.test.js` — new "access policy" describe block.
- Modify `wrangler.jsonc` — `vars.POLICY_MANIFEST_URL`.
- Modify `tests/unit/worker-sync-mount.test.js` — assert the var is configured.
- Modify `workers/sync/README.md` — document the access policy.

---

### Task 1: Policy module

**Files:**
- Create: `workers/sync/src/policy.js`
- Test: `tests/unit/worker-sync-policy.test.js`

**Interfaces:**
- Consumes: `sha256Hex(str): Promise<string>` from `workers/sync/src/db.js`.
- Produces: `githubUserHash(githubId: string|number): Promise<string|null>`, `isGithubUserBlocked(env, deps, githubId): Promise<boolean>`, constants `POLICY_KV_KEY = "policy:manifest"`, `POLICY_KV_TTL_SECONDS = 240`, `POLICY_MEMO_TTL_MS = 60000`. `deps` may carry `policyFetchImpl` (defaults to global `fetch`) and `now` (defaults to `Date.now`). `env` uses `POLICY_MANIFEST_URL` and `SYNC_RL`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/worker-sync-policy.test.js`:

```js
"use strict";
const { githubUserHash, isGithubUserBlocked, POLICY_KV_KEY, POLICY_KV_TTL_SECONDS, POLICY_MEMO_TTL_MS } = require("../../workers/sync/src/policy");
const { createTestKV } = require("../helpers/d1Shim");
const { sha256Hex } = require("../../workers/sync/src/db");

const URL_ = "https://config.axi.link/v1/manifest?app=axiforge";

function manifestFetch(denylist, calls) {
  return async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ version: 3, flags: {}, minVersion: null, notice: null, denylist }), { status: 200 });
  };
}

function setup({ denylist = [], fetchImpl, url = URL_ } = {}) {
  let t = Date.parse("2026-10-05T12:00:00Z");
  const calls = [];
  const deps = { now: () => t, advance: (ms) => { t += ms; }, policyFetchImpl: fetchImpl || manifestFetch(denylist, calls) };
  const env = { SYNC_RL: createTestKV({ now: () => t }) };
  if (url) env.POLICY_MANIFEST_URL = url;
  return { env, deps, calls };
}

describe("githubUserHash", () => {
  test("matches the shared Axi test vector", async () => {
    expect(await githubUserHash("1234567")).toBe("ba52ca31dec642ad640ce0bbbf8382b6f89493a8ac7d965d2e69659c654a6b2f");
    expect(await githubUserHash(1234567)).toBe("ba52ca31dec642ad640ce0bbbf8382b6f89493a8ac7d965d2e69659c654a6b2f");
  });

  test("rejects ids that are not positive decimal integers", async () => {
    expect(await githubUserHash("octocat")).toBeNull();
    expect(await githubUserHash("0123")).toBeNull();
    expect(await githubUserHash("")).toBeNull();
  });
});

describe("isGithubUserBlocked", () => {
  test("is disabled (no fetch) when POLICY_MANIFEST_URL is unset", async () => {
    const { env, deps, calls } = setup({ url: null, denylist: [await sha256Hex("github_user:42")] });
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("refuses a listed id and allows an unlisted one", async () => {
    const { env, deps, calls } = setup({ denylist: [await sha256Hex("github_user:42")] });
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(true);
    expect(await isGithubUserBlocked(env, deps, "43")).toBe(false);
    expect(calls).toEqual([URL_]);
  });

  test("an invalid id is never blocked", async () => {
    const { env, deps } = setup({ denylist: [await sha256Hex("github_user:0")] });
    expect(await isGithubUserBlocked(env, deps, 0)).toBe(false);
  });

  test("memo answers within 60 s, KV answers after the memo lapses, refetch after KV lapses", async () => {
    const { env, deps, calls } = setup({ denylist: [] });
    await isGithubUserBlocked(env, deps, 42);
    await isGithubUserBlocked(env, deps, 42);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(await env.SYNC_RL.get(POLICY_KV_KEY))).toEqual([]);

    deps.advance(POLICY_MEMO_TTL_MS + 1);
    await isGithubUserBlocked(env, deps, 42);
    expect(calls).toHaveLength(1); // served from KV

    deps.advance(POLICY_KV_TTL_SECONDS * 1000);
    await isGithubUserBlocked(env, deps, 42);
    expect(calls).toHaveLength(2);
  });

  test("fails open on network error, non-2xx and malformed bodies", async () => {
    for (const fetchImpl of [
      async () => { throw new Error("dns"); },
      async () => new Response("nope", { status: 503 }),
      async () => new Response("not json", { status: 200 }),
      async () => new Response(JSON.stringify({ version: 1 }), { status: 200 }),
    ]) {
      const { env, deps } = setup({ fetchImpl });
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      expect(await isGithubUserBlocked(env, deps, 42)).toBe(false);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    }
  });

  test("a failed fetch is memoized for 60 s so an outage does not cost a fetch per request", async () => {
    let n = 0;
    const { env, deps } = setup({ fetchImpl: async () => { n += 1; throw new Error("down"); } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await isGithubUserBlocked(env, deps, 42);
    await isGithubUserBlocked(env, deps, 42);
    expect(n).toBe(1);
    deps.advance(POLICY_MEMO_TTL_MS + 1);
    await isGithubUserBlocked(env, deps, 42);
    expect(n).toBe(2);
    warn.mockRestore();
  });

  test("works without a KV binding (memo only)", async () => {
    const { env, deps, calls } = setup({ denylist: [await sha256Hex("github_user:42")] });
    delete env.SYNC_RL;
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(true);
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a throwing KV binding falls back to fetching", async () => {
    const { env, deps, calls } = setup({ denylist: [await sha256Hex("github_user:42")] });
    env.SYNC_RL = { get: async () => { throw new Error("kv"); }, put: async () => { throw new Error("kv"); } };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(true);
    expect(calls).toHaveLength(1);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest tests/unit/worker-sync-policy.test.js --maxWorkers=2`
Expected: FAIL with `Cannot find module '../../workers/sync/src/policy'`.

- [ ] **Step 3: Implement `workers/sync/src/policy.js`**

```js
"use strict";
// Axi access policy for the sync Worker.
//
// The Axi apps can revoke access for people who violate their terms of use
// (see README "Access"). The list is published at config.axi.link as a manifest
// whose `denylist` holds only SHA-256 hashes of "kind:normalized" identifiers;
// this module answers whether a GitHub user id is on it.
//
// Caching: the denylist is kept in the SYNC_RL KV namespace for 240 s and in a
// per-isolate memo for 60 s, so an unban takes effect within 5 minutes. The
// memo is a WeakMap keyed by the KV binding (or by `env` when there is none),
// which keeps tests isolated without any reset hook.
//
// Fails OPEN: if the manifest cannot be fetched or parsed nobody is refused
// here. The check is off entirely unless env.POLICY_MANIFEST_URL is set.
const { sha256Hex } = require("./db");

const POLICY_KV_KEY = "policy:manifest";
const POLICY_KV_TTL_SECONDS = 240;
const POLICY_MEMO_TTL_MS = 60 * 1000;
const GITHUB_ID = /^[1-9]\d{0,19}$/;

const memo = new WeakMap();

async function githubUserHash(githubId) {
  const normalized = String(githubId).normalize("NFC").trim().toLowerCase().normalize("NFC");
  if (!GITHUB_ID.test(normalized)) return null;
  return sha256Hex("github_user:" + normalized);
}

function parseDenylist(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((h) => typeof h === "string");
}

async function readKv(kv) {
  if (!kv) return null;
  try {
    const raw = await kv.get(POLICY_KV_KEY);
    return raw ? parseDenylist(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn("[policy] denylist cache get failed:", err && err.message || err);
    return null;
  }
}

async function writeKv(kv, list) {
  if (!kv) return;
  try {
    await kv.put(POLICY_KV_KEY, JSON.stringify(list), { expirationTtl: POLICY_KV_TTL_SECONDS });
  } catch (err) {
    console.warn("[policy] denylist cache put failed:", err && err.message || err);
  }
}

async function fetchDenylist(url, deps) {
  try {
    const res = await (deps.policyFetchImpl || fetch)(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      console.warn("[policy] manifest fetch failed: HTTP", res.status);
      return null;
    }
    const list = parseDenylist((await res.json()).denylist);
    if (!list) console.warn("[policy] manifest has no denylist");
    return list;
  } catch (err) {
    console.warn("[policy] manifest fetch failed:", err && err.message || err);
    return null;
  }
}

// → Set of hashes, or null when the policy is off or unavailable.
async function loadDenylist(env, deps) {
  const url = env.POLICY_MANIFEST_URL;
  if (!url) return null;
  const nowMs = (deps.now || Date.now)();
  const memoKey = env.SYNC_RL || env;
  const hit = memo.get(memoKey);
  if (hit && hit.until > nowMs) return hit.set;

  let list = await readKv(env.SYNC_RL);
  if (!list) {
    list = await fetchDenylist(url, deps);
    if (list) await writeKv(env.SYNC_RL, list);
  }
  const set = list ? new Set(list) : null;
  memo.set(memoKey, { set, until: nowMs + POLICY_MEMO_TTL_MS });
  return set;
}

async function isGithubUserBlocked(env, deps = {}, githubId) {
  const set = await loadDenylist(env, deps);
  if (!set || set.size === 0) return false;
  const hash = await githubUserHash(githubId);
  return hash !== null && set.has(hash);
}

module.exports = { githubUserHash, isGithubUserBlocked, POLICY_KV_KEY, POLICY_KV_TTL_SECONDS, POLICY_MEMO_TTL_MS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest tests/unit/worker-sync-policy.test.js --maxWorkers=2`
Expected: PASS, 9 tests, no stray console output (warnings are spied).

- [ ] **Step 5: Commit**

```bash
git add workers/sync/src/policy.js tests/unit/worker-sync-policy.test.js
git commit -m "feat(sync): Axi access policy lookup for GitHub users

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Enforce the policy in login and authenticate()

**Files:**
- Modify: `workers/sync/src/auth.js` (`handleGithubLogin`, `authenticate`, new `revokeUserSessions`)
- Modify: `wrangler.jsonc`
- Modify: `workers/sync/README.md`
- Test: `tests/unit/worker-sync-auth.test.js`, `tests/unit/worker-sync-mount.test.js`

**Interfaces:**
- Consumes: `isGithubUserBlocked(env, deps, githubId)` from Task 1.
- Produces: `revokeUserSessions(env, userId): Promise<void>` exported from `auth.js`. Session cache entries now have the shape `{ user, expiresAt, githubId }` (`githubId` is a string or `null`). `handleGithubLogin` returns `403 { error: { code: "forbidden", message: "Access unavailable for this account." } }` for a listed user.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/worker-sync-auth.test.js` (after the last `describe` block; `setup`, `loginReq`, `authedReq`, `GH_USER` and `createTestKV` are already defined at the top of the file):

```js
describe("access policy", () => {
  const { sha256Hex } = require("../../workers/sync/src/db");
  const { revokeUserSessions } = require("../../workers/sync/src/auth");
  const MANIFEST = "https://config.axi.link/v1/manifest?app=axiforge";

  // Same GitHub mock as setup(), plus the manifest URL. `state.denylist` is read
  // on every fetch, so a test can ban/unban between requests.
  async function policySetup() {
    const base = await setup();
    const state = { denylist: [], manifestCalls: 0 };
    const gh = base.deps.fetchImpl;
    base.deps.policyFetchImpl = async (url) => {
      if (String(url) !== MANIFEST) throw new Error("unexpected url " + url);
      state.manifestCalls += 1;
      return new Response(JSON.stringify({ version: 1, flags: {}, minVersion: null, notice: null, denylist: state.denylist }), { status: 200 });
    };
    base.deps.fetchImpl = gh;
    base.env.POLICY_MANIFEST_URL = MANIFEST;
    return { ...base, state, ban: async () => { state.denylist = [await sha256Hex("github_user:" + GH_USER.id)]; } };
  }

  test("a listed GitHub user cannot log in, and no user/session row is written", async () => {
    const { env, deps, db, ban } = await policySetup();
    await ban();
    const r = await handleGithubLogin(loginReq("gh-good"), env, deps);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: { code: "forbidden", message: "Access unavailable for this account." } });
    expect(await db.prepare("SELECT COUNT(*) AS c FROM users").first("c")).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM sessions").first("c")).toBe(0);
  });

  test("an unlisted user logs in normally with the policy on", async () => {
    const { env, deps } = await policySetup();
    const r = await handleGithubLogin(loginReq("gh-good"), env, deps);
    expect(r.status).toBe(200);
  });

  test("a ban revokes every session of the user, D1 rows and sess: cache entries", async () => {
    const { env, deps, db, ban } = await policySetup();
    const a = (await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json()).sessionToken;
    const b = (await (await handleGithubLogin(loginReq("gh-good", "5.6.7.8"), env, deps)).json()).sessionToken;
    expect(await authenticate(authedReq(a), env, deps)).not.toBeNull();
    expect(await authenticate(authedReq(b), env, deps)).not.toBeNull();
    const hashB = await sha256Hex(b);
    expect(await env.SYNC_RL.get("sess:" + hashB)).not.toBeNull();

    await ban();
    deps.advance(4 * 60 * 1000 + 1); // policy cache lapsed; both sess: entries still warm
    expect(await authenticate(authedReq(a), env, deps)).toBeNull();
    expect(await db.prepare("SELECT COUNT(*) AS c FROM sessions").first("c")).toBe(0);
    expect(await env.SYNC_RL.get("sess:" + hashB)).toBeNull();
    expect(await authenticate(authedReq(b), env, deps)).toBeNull();
    // Only sessions go: the user and identity rows stay, so an unban restores everything.
    expect(await db.prepare("SELECT COUNT(*) AS c FROM users").first("c")).toBe(1);
  });

  test("the warm cache path is checked too (no D1 needed to refuse)", async () => {
    const { env, deps, ban } = await policySetup();
    const token = (await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json()).sessionToken;
    await authenticate(authedReq(token), env, deps); // caches { user, expiresAt, githubId }
    const hash = await sha256Hex(token);
    expect(JSON.parse(await env.SYNC_RL.get("sess:" + hash)).githubId).toBe("42");

    await ban();
    deps.advance(4 * 60 * 1000 + 1); // policy cache lapsed (240 s KV, 60 s memo); session cache (300 s) still warm
    expect(await authenticate(authedReq(token), env, deps)).toBeNull();
  });

  test("a session cached before githubId existed falls through to D1 and is still checked", async () => {
    const { env, deps, ban } = await policySetup();
    const token = (await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json()).sessionToken;
    const first = await authenticate(authedReq(token), env, deps);
    const hash = await sha256Hex(token);
    await env.SYNC_RL.put("sess:" + hash, JSON.stringify({ user: first.user, expiresAt: "2099-01-01T00:00:00.000Z" }), { expirationTtl: 300 });

    await ban();
    deps.advance(4 * 60 * 1000 + 1);
    expect(await authenticate(authedReq(token), env, deps)).toBeNull();
  });

  test("unban: after the cache period the user can log in again", async () => {
    const { env, deps, state, ban } = await policySetup();
    await ban();
    expect((await handleGithubLogin(loginReq("gh-good"), env, deps)).status).toBe(403);
    state.denylist = [];
    deps.advance(5 * 60 * 1000);
    expect((await handleGithubLogin(loginReq("gh-good"), env, deps)).status).toBe(200);
  });

  test("manifest outage fails open for login and authenticate", async () => {
    const { env, deps } = await policySetup();
    deps.policyFetchImpl = async () => { throw new Error("dns"); };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handleGithubLogin(loginReq("gh-good"), env, deps);
    expect(r.status).toBe(200);
    const { sessionToken } = await r.json();
    expect(await authenticate(authedReq(sessionToken), env, deps)).not.toBeNull();
    warn.mockRestore();
  });

  test("revokeUserSessions removes only that user's sessions", async () => {
    const { env, deps, db } = await policySetup();
    const mine = (await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json());
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES ('other', 'O', NULL, '2026-01-01')").run();
    await db.prepare("INSERT INTO sessions (token_hash, user_id, client_label, created_at, last_used_at, expires_at) VALUES ('h-other', 'other', NULL, '2026-01-01', '2026-01-01', '2099-01-01')").run();
    await revokeUserSessions(env, mine.user.id);
    expect((await db.prepare("SELECT token_hash FROM sessions").all()).results).toEqual([{ token_hash: "h-other" }]);
  });
});
```

Append to `tests/unit/worker-sync-mount.test.js`:

```js
test("wrangler.jsonc points the access policy at the axiforge manifest", () => {
  const raw = fs.readFileSync(WRANGLER, "utf8");
  expect(raw).toMatch(/"POLICY_MANIFEST_URL":\s*"https:\/\/config\.axi\.link\/v1\/manifest\?app=axiforge"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest tests/unit/worker-sync-auth.test.js tests/unit/worker-sync-mount.test.js --maxWorkers=2`
Expected: FAIL — the "access policy" tests (login returns 200 for a listed user; `revokeUserSessions` is not a function) and the wrangler var test.

- [ ] **Step 3: Implement the auth changes**

In `workers/sync/src/auth.js`:

1. Add the import below the existing `require` lines:

```js
const { isGithubUserBlocked } = require("./policy");
```

2. Add `revokeUserSessions` after `cacheDelete`:

```js
// Deletes every session of a user and evicts their `sess:` cache entries. Used
// when the user is on the Axi access denylist (see policy.js). Select first:
// the cache is keyed by token hash, and its entries outlive the D1 rows by up
// to one TTL.
async function revokeUserSessions(env, userId) {
  const { results } = await env.SYNC_DB.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").bind(userId).all();
  await env.SYNC_DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  for (const row of results || []) await cacheDelete(env.SYNC_RL, row.token_hash);
}
```

3. In `handleGithubLogin`, directly after the line
`if (!gh || typeof gh.id !== "number" || !gh.login) return errorResponse("unauthorized", "GitHub returned no user.");`
insert:

```js
  if (await isGithubUserBlocked(env, deps, gh.id)) {
    // Neutral on purpose: never say which identifier matched. Also drop any
    // sessions the user still holds from before the ban.
    const known = await env.SYNC_DB.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_user_id = ?").bind(String(gh.id)).first();
    if (known) await revokeUserSessions(env, known.user_id);
    return errorResponse("forbidden", "Access unavailable for this account.");
  }
```

4. Replace the cached-path block in `authenticate()`:

```js
  const cached = await cacheGet(env.SYNC_RL, tokenHash);
  if (cached) {
    // Still valid → answer without going near D1, which is the whole point.
    if (Date.parse(cached.expiresAt) > nowMs) return { user: cached.user, sessionHash: tokenHash };
    // Lapsed → drop it and fall through, so the D1 path below also deletes the
    // dead row rather than leaving it for the nightly purge.
    await cacheDelete(env.SYNC_RL, tokenHash);
  }
```

with:

```js
  const cached = await cacheGet(env.SYNC_RL, tokenHash);
  // Entries written before the access policy existed have no `githubId`; treat
  // them as a miss so the D1 path below checks the policy and re-caches them.
  if (cached && cached.githubId !== undefined) {
    if (Date.parse(cached.expiresAt) > nowMs) {
      // Still valid → answer without going near D1, which is the whole point.
      if (cached.githubId && await isGithubUserBlocked(env, deps, cached.githubId)) {
        await revokeUserSessions(env, cached.user.id);
        return null;
      }
      return { user: cached.user, sessionHash: tokenHash };
    }
    // Lapsed → drop it and fall through, so the D1 path below also deletes the
    // dead row rather than leaving it for the nightly purge.
    await cacheDelete(env.SYNC_RL, tokenHash);
  }
```

5. In the D1 `SELECT` of `authenticate()`, change the column list to include the identity:

```js
    `SELECT s.token_hash, s.last_used_at, s.expires_at, u.id, u.display_name, u.avatar_url, i.login, i.provider, i.provider_user_id
```

6. Directly after the expired-row block (`if (Date.parse(row.expires_at) <= nowMs) { ... return null; }`) insert:

```js
  const githubId = row.provider === "github" ? row.provider_user_id : null;
  if (githubId && await isGithubUserBlocked(env, deps, githubId)) {
    await revokeUserSessions(env, row.id);
    return null;
  }
```

7. Change the final `cachePut` to carry the id:

```js
  await cachePut(env.SYNC_RL, tokenHash, { user, expiresAt, githubId });
```

8. Add `revokeUserSessions` to `module.exports`.

- [ ] **Step 4: Configure the manifest URL**

In `wrangler.jsonc`, add a top-level `vars` entry (next to `compatibility_flags`):

```jsonc
  // Axi access policy (workers/sync/src/policy.js). Remove to switch the check off.
  "vars": {
    "POLICY_MANIFEST_URL": "https://config.axi.link/v1/manifest?app=axiforge"
  },
```

- [ ] **Step 5: Document it**

Append to `workers/sync/README.md`:

```markdown
## Access policy
The Axi apps can revoke access for people who violate their terms of use.
`src/policy.js` reads the public manifest at `POLICY_MANIFEST_URL`
(`wrangler.jsonc`), whose `denylist` holds only SHA-256 hashes of
`kind:normalized` identifiers. A listed GitHub user gets a neutral 403
("Access unavailable for this account.") on login; a listed user who is already
signed in has every session deleted (D1 rows and `sess:` cache entries) and is
answered 401 like any signed-out client. Nothing else is deleted, so an unban
restores access within 5 minutes. If the manifest is unreachable nobody is
refused. Unset `POLICY_MANIFEST_URL` to switch the check off.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest tests/unit/worker-sync --maxWorkers=2`
Expected: PASS — every `worker-sync-*` file, including the existing "auth session cache" tests (zero D1 calls on a warm hit).

- [ ] **Step 7: Run the full suite**

Run: `npm test -- --maxWorkers=2`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add workers/sync/src/auth.js wrangler.jsonc workers/sync/README.md tests/unit/worker-sync-auth.test.js tests/unit/worker-sync-mount.test.js
git commit -m "feat(sync): refuse GitHub users on the Axi access denylist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Operator follow-up (not part of implementation)

Deploying is manual: `npm run deploy:web` publishes the Worker (and the Playground SPA). Until `config.axi.link` is live the manifest fetch fails and the check stays open.
