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

  test("a malformed percent-encoded path segment → 400 invalid, not a thrown 500", async () => {
    const { env, deps } = await setup();
    // "%" not followed by two hex digits makes decodeURIComponent throw.
    const res = await handleSync(new Request("https://build.axi.link/api/sync/teams/%E0%A4%A/members", {
      headers: { Authorization: "Bearer whatever" },
    }), env, deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid");
  });
});
