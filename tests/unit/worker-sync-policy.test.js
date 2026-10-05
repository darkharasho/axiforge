"use strict";
const { githubUserHash, isGithubUserBlocked, POLICY_KV_KEY, POLICY_KV_TTL_SECONDS, POLICY_MEMO_TTL_MS, POLICY_FETCH_TIMEOUT_MS } = require("../../workers/sync/src/policy");
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
    const hash = await sha256Hex("github_user:42");
    const { env, deps, calls } = setup({ denylist: [hash.toUpperCase()] });
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

  test("fetch timeout causes graceful failure with warning", async () => {
    const { env, deps } = setup({
      fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))
    });
    deps.policyTimeoutMs = 20;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await isGithubUserBlocked(env, deps, 42)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
