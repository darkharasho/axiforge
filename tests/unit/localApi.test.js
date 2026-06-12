"use strict";

const { createLocalApi, generateToken } = require("../../src/main/localApi");

// Minimal ops stub — individual endpoint groups get real stores in later tests.
function stubOps(overrides = {}) {
  return {
    listBuilds: async () => [],
    saveBuild: async (b) => b,
    deleteBuild: async () => true,
    publishBuild: async () => ({}),
    generateChatLink: async () => "",
    listComps: async () => [],
    saveComp: async (c) => c,
    deleteComp: async () => undefined,
    publishComp: async () => ({}),
    compPlaintext: async () => "",
    importChatLink: async () => ({}),
    importGw2Skills: async () => ({}),
    listProfessions: async () => [],
    getProfessionCatalog: async () => ({}),
    getUpgradeCatalog: async () => ({}),
    listFolders: async () => [],
    ...overrides,
  };
}

async function startApi(opsOverrides = {}) {
  const token = generateToken();
  const api = createLocalApi({ token, version: "0.0.0-test", ops: stubOps(opsOverrides) });
  const { port } = await api.start();
  return { api, token, port };
}

function req(port, token, method, path, body) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("local API core", () => {
  let api, token, port;

  beforeEach(async () => {
    ({ api, token, port } = await startApi());
  });

  afterEach(async () => {
    await api.stop();
  });

  test("generateToken returns a 64-char hex string, unique per call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  test("listens on an ephemeral 127.0.0.1 port", () => {
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
  });

  test("rejects requests without a token with 401", async () => {
    const res = await req(port, null, "GET", "/health");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  test("rejects requests with a wrong token with 401", async () => {
    const res = await req(port, "not-the-token", "GET", "/health");
    expect(res.status).toBe(401);
  });

  test("GET /health returns ok + version", async () => {
    const res = await req(port, token, "GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: "0.0.0-test" });
  });

  test("unknown route returns 404", async () => {
    const res = await req(port, token, "GET", "/nope");
    expect(res.status).toBe(404);
  });

  test("known path with wrong method returns 404", async () => {
    const res = await req(port, token, "DELETE", "/health");
    expect(res.status).toBe(404);
  });

  test("malformed JSON body returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/builds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  test("ops errors surface as 500 with the message", async () => {
    const { api: api2, token: t2, port: p2 } = await startApi({
      listBuilds: async () => { throw new Error("disk on fire"); },
    });
    const res = await req(p2, t2, "GET", "/builds");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("disk on fire");
    await api2.stop();
  });

  test("stop() shuts the server down", async () => {
    await api.stop();
    await expect(req(port, token, "GET", "/health")).rejects.toThrow();
    // Re-create for afterEach's stop()
    ({ api, token, port } = await startApi());
  });

  test("over-limit body returns 413", async () => {
    const big = "x".repeat(5 * 1024 * 1024 + 16);
    const res = await fetch(`http://127.0.0.1:${port}/builds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: big }),
    });
    expect(res.status).toBe(413);
  });

  // Change 5: GET /builds/:id doesn't exist as a route, so a malformed percent-escape
  // like "/builds/%" yields 404 (no route match) rather than a 500.
  // The decodeURIComponent try/catch guard is in place in matchRoute.
  test("malformed percent-escape in path yields 404 (no matching route)", async () => {
    const res = await req(port, token, "GET", "/builds/%");
    expect(res.status).toBe(404);
  });
});
