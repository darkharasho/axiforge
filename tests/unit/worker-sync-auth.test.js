"use strict";
const { handleGithubLogin, authenticate, handleLogout, SESSION_TTL_MS } = require("../../workers/sync/src/auth");
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
