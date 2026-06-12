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

  test("POST /builds/:id/publish returns 404 for an unknown build", async () => {
    const res = await req(port, token, "POST", "/builds/nope/publish");
    expect(res.status).toBe(404);
    expect(published).toHaveLength(0);
  });

  test("DELETE /builds/:id returns 404 for an unknown build", async () => {
    const res = await req(port, token, "DELETE", "/builds/nope");
    expect(res.status).toBe(404);
  });
});

describe("local API — comps endpoints", () => {
  let api, token, port, dir, compStore;
  const publishedComps = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-comps-"));
    compStore = new CompStore(dir);
    await compStore.init();
    publishedComps.length = 0;
    ({ api, token, port } = await startApi({
      listComps: () => compStore.listComps(),
      saveComp: (c) => compStore.upsertComp(c),
      deleteComp: (id) => compStore.deleteComp(id),
      publishComp: async (id, boonCoverageHtml) => {
        publishedComps.push({ id, boonCoverageHtml });
        return { pagesUrl: `https://example.test/?c=${id}`, slug: "comp", fileId: "c1", changed: true };
      },
      compPlaintext: async (id) => {
        const comps = await compStore.listComps();
        const comp = comps.find((c) => c.id === id);
        if (!comp) throw new Error("Comp not found");
        return `**${comp.name}**\n\n**Comp**\n(empty)\n\n**Builds**\n(none)`;
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /comps returns an empty list initially", async () => {
    const res = await req(port, token, "GET", "/comps");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("POST /comps creates a comp through CompStore normalization", async () => {
    const res = await req(port, token, "POST", "/comps", { name: "Zerg Comp", gameMode: "wvw" });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.name).toBe("Zerg Comp");
    expect(saved.partyLines).toHaveLength(1); // CompStore default party line
    expect(await compStore.listComps()).toHaveLength(1);
  });

  test("GET /comps/:id returns the comp, 404 when missing", async () => {
    const created = await compStore.upsertComp({ name: "Findable Comp" });
    const found = await req(port, token, "GET", `/comps/${created.id}`);
    expect(found.status).toBe(200);
    expect((await found.json()).name).toBe("Findable Comp");

    const missing = await req(port, token, "GET", "/comps/does-not-exist");
    expect(missing.status).toBe(404);
  });

  test("DELETE /comps/:id removes the comp", async () => {
    const created = await compStore.upsertComp({ name: "Doomed Comp" });
    const res = await req(port, token, "DELETE", `/comps/${created.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await compStore.listComps()).toHaveLength(0);
  });

  test("POST /comps/:id/publish forwards optional boonCoverageHtml", async () => {
    const created = await compStore.upsertComp({ name: "Pub Comp" });
    const res = await req(port, token, "POST", `/comps/${created.id}/publish`, {
      boonCoverageHtml: "<table></table>",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).pagesUrl).toContain(created.id);
    expect(publishedComps).toEqual([{ id: created.id, boonCoverageHtml: "<table></table>" }]);
  });

  test("POST /comps/:id/publish works without a body", async () => {
    const created = await compStore.upsertComp({ name: "Pub Comp 2" });
    const res = await req(port, token, "POST", `/comps/${created.id}/publish`);
    expect(res.status).toBe(200);
    expect(publishedComps[0].boonCoverageHtml).toBeUndefined();
  });

  test("GET /comps/:id/plaintext returns { text }", async () => {
    const created = await compStore.upsertComp({ name: "Plain Comp" });
    const res = await req(port, token, "GET", `/comps/${created.id}/plaintext`);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toContain("**Plain Comp**");
  });

  test("POST /comps/:id/publish returns 404 for an unknown comp", async () => {
    const res = await req(port, token, "POST", "/comps/nope/publish");
    expect(res.status).toBe(404);
    expect(publishedComps).toHaveLength(0);
  });

  test("GET /comps/:id/plaintext returns 404 for an unknown comp", async () => {
    const res = await req(port, token, "GET", "/comps/nope/plaintext");
    expect(res.status).toBe(404);
    expect(publishedComps).toHaveLength(0);
  });

  test("DELETE /comps/:id returns 404 for an unknown comp", async () => {
    const res = await req(port, token, "DELETE", "/comps/nope");
    expect(res.status).toBe(404);
  });
});

describe("local API — import endpoints", () => {
  let api, token, port;
  const importedChatLinks = [];
  const importedGw2Skills = [];

  beforeEach(async () => {
    importedChatLinks.length = 0;
    importedGw2Skills.length = 0;
    ({ api, token, port } = await startApi({
      importChatLink: async (link, name, folderId, gameMode) => {
        importedChatLinks.push({ link, name, folderId, gameMode });
        return { id: "imported-1", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
      importGw2Skills: async (url, name, folderId, gameMode) => {
        importedGw2Skills.push({ url, name, folderId, gameMode });
        return { id: "imported-2", title: name || "Imported Build", gameMode: gameMode || "pve" };
      },
    }));
  });

  afterEach(async () => {
    await api.stop();
  });

  test("POST /import/chat-link forwards link, name, folderId, gameMode", async () => {
    const res = await req(port, token, "POST", "/import/chat-link", {
      link: "[&DQg1KTIlIjY=]",
      name: "Imported Hammer",
      folderId: "folder-1",
      gameMode: "wvw",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("imported-1");
    expect(importedChatLinks).toEqual([
      { link: "[&DQg1KTIlIjY=]", name: "Imported Hammer", folderId: "folder-1", gameMode: "wvw" },
    ]);
  });

  test("POST /import/chat-link requires a link", async () => {
    const res = await req(port, token, "POST", "/import/chat-link", { name: "No Link" });
    expect(res.status).toBe(400);
    expect(importedChatLinks).toHaveLength(0);
  });

  test("POST /import/gw2skills forwards url, name, folderId, gameMode", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills", {
      url: "http://gw2skills.net/editor/?ABC",
      name: "Imported gw2skills",
      folderId: null,
      gameMode: "pve",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("imported-2");
    expect(importedGw2Skills).toEqual([
      { url: "http://gw2skills.net/editor/?ABC", name: "Imported gw2skills", folderId: null, gameMode: "pve" },
    ]);
  });

  test("POST /import/gw2skills requires a url", async () => {
    const res = await req(port, token, "POST", "/import/gw2skills", {});
    expect(res.status).toBe(400);
    expect(importedGw2Skills).toHaveLength(0);
  });
});

describe("local API — catalog and folders endpoints", () => {
  let api, token, port, dir, folderStore;
  const catalogCalls = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-api-catalog-"));
    folderStore = new FolderStore(dir);
    await folderStore.init();
    catalogCalls.length = 0;
    ({ api, token, port } = await startApi({
      listProfessions: async () => [{ id: "Guardian", name: "Guardian" }],
      getProfessionCatalog: async (id, gameMode) => {
        catalogCalls.push({ id, gameMode });
        return { profession: { id, name: id }, specializations: [], skills: [] };
      },
      getUpgradeCatalog: async () => ({ runes: [], sigils: [], relics: [] }),
      listFolders: () => folderStore.listFolders(),
    }));
  });

  afterEach(async () => {
    await api.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("GET /catalog/professions returns the profession list", async () => {
    const res = await req(port, token, "GET", "/catalog/professions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "Guardian", name: "Guardian" }]);
  });

  test("GET /catalog/professions/:id passes id and gameMode query", async () => {
    const res = await req(port, token, "GET", "/catalog/professions/Necromancer?gameMode=wvw");
    expect(res.status).toBe(200);
    expect((await res.json()).profession.id).toBe("Necromancer");
    expect(catalogCalls).toEqual([{ id: "Necromancer", gameMode: "wvw" }]);
  });

  test("GET /catalog/professions/:id omits gameMode when not given", async () => {
    await req(port, token, "GET", "/catalog/professions/Warrior");
    expect(catalogCalls).toEqual([{ id: "Warrior", gameMode: undefined }]);
  });

  test("GET /catalog/upgrades returns the upgrade catalog", async () => {
    const res = await req(port, token, "GET", "/catalog/upgrades");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runes: [], sigils: [], relics: [] });
  });

  test("GET /folders returns folders from the store", async () => {
    await folderStore.upsertFolder({ name: "WvW Builds" });
    const res = await req(port, token, "GET", "/folders");
    expect(res.status).toBe(200);
    const folders = await res.json();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("WvW Builds");
  });
});
