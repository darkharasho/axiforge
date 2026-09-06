"use strict";
const { handleGithubLogin, authenticate, handleLogout, SESSION_TTL_MS, SESSION_CACHE_TTL_MS } = require("../../workers/sync/src/auth");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

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
  return { env: { SYNC_DB: db, SYNC_RL: createTestKV({ now: () => t }) }, deps, db };
}
function loginReq(token, ip = "1.2.3.4") {
  return new Request("https://build.axi.link/api/sync/auth/github", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": "AxiForge/0.12.0 linux", "cf-connecting-ip": ip },
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

  test("login is rate limited per IP (10/min) with Retry-After", async () => {
    const { env, deps } = await setup();
    for (let i = 0; i < 10; i++) await handleGithubLogin(loginReq("gh-good", "9.9.9.9"), env, deps);
    const r = await handleGithubLogin(loginReq("gh-good", "9.9.9.9"), env, deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
    // A different IP is unaffected.
    const other = await handleGithubLogin(loginReq("gh-good", "8.8.8.8"), env, deps);
    expect(other.status).toBe(200);
  });

  test("GitHub 401/403 → unauthorized; other non-2xx or a thrown fetch → unavailable (502)", async () => {
    const { env, deps } = await setup();
    const forbidden = await handleGithubLogin(loginReq("gh-good"), { ...env }, { ...deps, fetchImpl: async () => new Response("{}", { status: 403 }) });
    expect(forbidden.status).toBe(401);
    expect((await forbidden.json()).error.code).toBe("unauthorized");

    const serverError = await handleGithubLogin(loginReq("gh-good"), { ...env }, { ...deps, fetchImpl: async () => new Response("oops", { status: 502 }) });
    expect(serverError.status).toBe(502);
    expect((await serverError.json()).error.code).toBe("unavailable");

    const thrown = await handleGithubLogin(loginReq("gh-good"), { ...env }, { ...deps, fetchImpl: async () => { throw new Error("network down"); } });
    expect(thrown.status).toBe(502);
    expect((await thrown.json()).error.code).toBe("unavailable");
  });

  test("first-login race: two concurrent first logins for the same GitHub user converge on one user row, no 500", async () => {
    const { env, deps, db } = await setup();
    const [r1, r2] = await Promise.all([
      handleGithubLogin(loginReq("gh-good"), env, deps),
      handleGithubLogin(loginReq("gh-good"), env, deps),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    expect(b1.user.id).toBe(b2.user.id);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM users").first("c")).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM identities").first("c")).toBe(1);
  });
});

// The session cache. `authenticate()` runs before every handler, so its D1 read
// is the single most repeated query in the service — a 30-second poll per member
// paid for a `sessions JOIN users JOIN identities` round trip that almost always
// returned the identical row. On 2026-09-06 that steady state exhausted D1's
// daily row-read allowance and took team sync down for everybody.
describe("auth session cache", () => {
  // Wraps the D1 double to record every statement it is asked to prepare, so a
  // test can assert that a request cost ZERO D1 round trips rather than merely
  // that it returned the right answer.
  function countingDb(db) {
    const calls = [];
    return Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
      prepare(sql) { calls.push(sql); return db.prepare(sql); },
      _calls: calls,
    });
  }

  async function loggedIn() {
    const { env, deps, db } = await setup();
    const { sessionToken } = await (await handleGithubLogin(loginReq("gh-good"), env, deps)).json();
    const counting = countingDb(db);
    return { env: { ...env, SYNC_DB: counting }, deps, db, counting, sessionToken, kv: env.SYNC_RL };
  }

  test("a second request inside the cache window resolves without touching D1", async () => {
    const { env, deps, counting, sessionToken } = await loggedIn();

    const first = await authenticate(authedReq(sessionToken), env, deps);
    expect(first.user.login).toBe("vette");
    expect(counting._calls.length).toBeGreaterThan(0); // the cold read happened

    counting._calls.length = 0;
    const second = await authenticate(authedReq(sessionToken), env, deps);
    expect(second).toEqual(first);
    expect(counting._calls).toEqual([]); // ...and the warm one cost nothing
  });

  test("the cache lapses, so D1 stays the source of truth", async () => {
    const { env, deps, counting, sessionToken } = await loggedIn();
    await authenticate(authedReq(sessionToken), env, deps);

    deps.advance(SESSION_CACHE_TTL_MS + 1000);
    counting._calls.length = 0;
    const after = await authenticate(authedReq(sessionToken), env, deps);
    expect(after.user.login).toBe("vette");
    expect(counting._calls.length).toBeGreaterThan(0);
  });

  test("logout evicts the cached copy instead of leaving it to age out", async () => {
    const { env, deps, sessionToken } = await loggedIn();
    const auth = await authenticate(authedReq(sessionToken), env, deps);
    await handleLogout(authedReq(sessionToken), env, deps, auth);
    // Without eviction this returns the cached user for the rest of the TTL —
    // a signed-out client that still passes authentication.
    expect(await authenticate(authedReq(sessionToken), env, deps)).toBeNull();
  });

  test("a session that lapses inside its own cache window is refused, not served", async () => {
    const { env, deps, sessionToken, db, counting } = await loggedIn();
    // A session with less life left than the cache TTL: the entry written now
    // outlives the session it describes. The cached path has to read the
    // `expiresAt` it stored rather than assume a hit means "still valid".
    await db.prepare("UPDATE sessions SET expires_at = ?")
      .bind(new Date(Date.parse("2026-08-21T12:00:00Z") + 60 * 1000).toISOString()).run();
    expect(await authenticate(authedReq(sessionToken), env, deps)).not.toBeNull();

    deps.advance(2 * 60 * 1000); // past the session, still inside the cache TTL
    expect(await authenticate(authedReq(sessionToken), env, deps)).toBeNull();
    // ...and the dead row was actually reaped, not merely hidden.
    expect(counting._calls.some((q) => /DELETE FROM sessions/.test(q))).toBe(true);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM sessions").first("c")).toBe(0);
  });

  test("a KV outage falls back to D1 rather than signing everybody out", async () => {
    const { env, deps, sessionToken } = await loggedIn();
    const broken = {
      get: async () => { throw new Error("KV down"); },
      put: async () => { throw new Error("KV down"); },
      delete: async () => { throw new Error("KV down"); },
    };
    const a = await authenticate(authedReq(sessionToken), { ...env, SYNC_RL: broken }, deps);
    expect(a.user.login).toBe("vette");
  });

  test("no KV binding at all still authenticates", async () => {
    const { env, deps, sessionToken } = await loggedIn();
    const a = await authenticate(authedReq(sessionToken), { ...env, SYNC_RL: undefined }, deps);
    expect(a.user.login).toBe("vette");
  });

  test("caching does not stop the hourly expiry slide", async () => {
    const { env, deps, db, sessionToken } = await loggedIn();
    await authenticate(authedReq(sessionToken), env, deps);
    const exp0 = await db.prepare("SELECT expires_at FROM sessions").first("expires_at");

    // Poll steadily for just over an hour. Most of these are cache hits; the
    // bump has to survive them and still land on the first miss past the hour.
    for (let i = 0; i < 13; i++) {
      deps.advance(5 * 60 * 1000);
      await authenticate(authedReq(sessionToken), env, deps);
    }
    expect(await db.prepare("SELECT expires_at FROM sessions").first("expires_at")).not.toBe(exp0);
  });
});
