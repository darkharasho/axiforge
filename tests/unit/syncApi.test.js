"use strict";
const { SyncApi, SyncApiError, DEFAULT_BASE_URL } = require("../../src/main/syncApi");

function res(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}
function makeApi(fetchImpl, token = "sess") {
  return new SyncApi({ baseUrl: "http://x/api/sync", getToken: async () => token, fetchImpl });
}

describe("SyncApi", () => {
  test("default base url", () => {
    expect(DEFAULT_BASE_URL).toBe("https://build.axi.link/api/sync");
  });

  test("sends bearer token, JSON body, and parses JSON", async () => {
    const fetchImpl = jest.fn(async () => res(201, { version: 1, seq: 9 }));
    const api = makeApi(fetchImpl);
    const out = await api.putItem("t1", "b1", { type: "build", parentId: null, body: { a: 1 }, baseVersion: null });
    expect(out).toEqual({ version: 1, seq: 9 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/api/sync/teams/t1/items/b1");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer sess");
    expect(JSON.parse(init.body)).toEqual({ type: "build", parentId: null, body: { a: 1 }, baseVersion: null });
  });

  test("loginGithub does not send a session token; logout returns on 204", async () => {
    const fetchImpl = jest.fn(async (url) => String(url).endsWith("/auth/github") ? res(200, { sessionToken: "s", user: { id: "u" } }) : res(204));
    const api = makeApi(fetchImpl, null);
    expect(await api.loginGithub("gh")).toEqual({ sessionToken: "s", user: { id: "u" } });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ token: "gh" });
    expect(await api.logout()).toBeNull();
  });

  test("maps HTTP errors to SyncApiError codes and carries current / retryAfterMs", async () => {
    const cases = [
      [401, { error: { code: "unauthorized", message: "x" } }, "SYNC_UNAUTHORIZED"],
      [403, { error: { code: "forbidden", message: "x" } }, "SYNC_FORBIDDEN"],
      [404, { error: { code: "not_found", message: "x" } }, "SYNC_NOT_FOUND"],
      [413, { error: { code: "too_large", message: "x" } }, "SYNC_TOO_LARGE"],
      [400, { error: { code: "invalid", message: "x" } }, "SYNC_INVALID"],
      [500, { error: { code: "internal", message: "x" } }, "SYNC_OFFLINE"],
      [502, undefined, "SYNC_OFFLINE"],
    ];
    for (const [status, body, code] of cases) {
      const api = makeApi(async () => res(status, body));
      await expect(api.listTeams()).rejects.toMatchObject({ code, status });
    }
    const conflict = makeApi(async () => res(409, { error: { code: "conflict", message: "changed" }, current: { id: "b1", version: 3 } }));
    const err = await conflict.putItem("t", "b1", {}).catch((e) => e);
    expect(err).toBeInstanceOf(SyncApiError);
    expect(err.code).toBe("SYNC_CONFLICT");
    expect(err.current).toEqual({ id: "b1", version: 3 });
    expect(err.message).toBe("changed");

    const limited = makeApi(async () => res(429, { error: { code: "rate_limited", message: "slow" } }, { "retry-after": "7" }));
    await expect(limited.listTeams()).rejects.toMatchObject({ code: "SYNC_RATE_LIMITED", retryAfterMs: 7000 });
  });

  test("network failure → SYNC_OFFLINE with status 0", async () => {
    const api = makeApi(async () => { throw new TypeError("fetch failed"); });
    await expect(api.listTeams()).rejects.toMatchObject({ code: "SYNC_OFFLINE", status: 0 });
  });

  test("query building for changes and deleteItem", async () => {
    const fetchImpl = jest.fn(async () => res(200, { items: [], nextSeq: 0, hasMore: false }));
    const api = makeApi(fetchImpl);
    await api.changes("t", 41, 50);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://x/api/sync/teams/t/changes?since=41&limit=50");
    await api.deleteItem("t", "b 1", 3);
    expect(fetchImpl.mock.calls[1][0]).toBe("http://x/api/sync/teams/t/items/b%201?baseVersion=3");
    expect(fetchImpl.mock.calls[1][1].method).toBe("DELETE");
  });
});
