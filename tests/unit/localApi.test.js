"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
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

  // Change 5: The decodeURIComponent try/catch guard is in place in matchRoute.
  // Now that GET /builds/:id exists, a malformed percent-escape like "/builds/%"
  // matches the route pattern and triggers 400 (malformed escape) rather than 404.
  test("malformed percent-escape in path yields 400 (decodeURIComponent guard fires)", async () => {
    const res = await req(port, token, "GET", "/builds/%");
    expect(res.status).toBe(400);
  });
});

describe("local API — builds endpoints", () => {
  let api, token, port, dir, store;
  const published = [];
  const chatLinked = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-builds-"));
    store = new BuildStore(dir);
    await store.init();
    published.length = 0;
    chatLinked.length = 0;
    ({ api, token, port } = await startApi({
      listBuilds: () => store.listBuilds(),
      saveBuild: (b) => store.upsertBuild(b),
      deleteBuild: (id) => store.deleteBuild(id),
      publishBuild: async (id) => {
        published.push(id);
        return { pagesUrl: `https://example.test/?b=${id}`, slug: "test", fileId: "f1", changed: true };
      },
      generateChatLink: async (build) => {
        chatLinked.push(build.id);
        return "[&DQg1KTIlIjbBEgAAgQAAAEABAAC1EgAAtRIAAAAAAAAAAAAAAAAAAAAAAAA=]";
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /builds returns an empty list initially", async () => {
    const res = await req(port, token, "GET", "/builds");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /builds creates a build through BuildStore normalization", async () => {
    const res = await req(port, token, "POST", "/builds", {
      title: "API Test Build",
      profession: "Warrior",
      tags: ["wvw"],
    });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.title).toBe("API Test Build");
    expect(saved.gameMode).toBe("pve"); // normalizeBuild default
    const onDisk = await store.listBuilds();
    expect(onDisk).toHaveLength(1);
  });

  test("POST /builds with an existing id updates the build", async () => {
    const created = await store.upsertBuild({ title: "Before", profession: "Ranger" });
    const res = await req(port, token, "POST", "/builds", { ...created, title: "After" });
    const updated = await res.json();
    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("After");
    expect(await store.listBuilds()).toHaveLength(1);
  });

  test("GET /builds/:id returns the build, 404 when missing", async () => {
    const created = await store.upsertBuild({ title: "Findable", profession: "Thief" });
    const found = await req(port, token, "GET", `/builds/${created.id}`);
    expect(found.status).toBe(200);
    expect((await found.json()).title).toBe("Findable");

    const missing = await req(port, token, "GET", "/builds/does-not-exist");
    expect(missing.status).toBe(404);
  });

  test("DELETE /builds/:id removes the build", async () => {
    const created = await store.upsertBuild({ title: "Doomed", profession: "Mesmer" });
    const res = await req(port, token, "DELETE", `/builds/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await store.listBuilds()).toHaveLength(0);
  });

  test("POST /builds/:id/publish delegates to ops.publishBuild", async () => {
    const created = await store.upsertBuild({ title: "Pub", profession: "Guardian" });
    const res = await req(port, token, "POST", `/builds/${created.id}/publish`);
    expect(res.status).toBe(200);
    expect((await res.json()).pagesUrl).toContain(created.id);
    expect(published).toEqual([created.id]);
  });

  test("POST /builds/:id/chat-link looks up the build and returns { chatLink }", async () => {
    const created = await store.upsertBuild({ title: "Linkable", profession: "Engineer" });
    const res = await req(port, token, "POST", `/builds/${created.id}/chat-link`);
    expect(res.status).toBe(200);
    expect((await res.json()).chatLink).toMatch(/^\[&/);
    expect(chatLinked).toEqual([created.id]);
  });

  test("POST /builds/:id/chat-link returns 404 for an unknown build", async () => {
    const res = await req(port, token, "POST", "/builds/nope/chat-link");
    expect(res.status).toBe(404);
  });
});
