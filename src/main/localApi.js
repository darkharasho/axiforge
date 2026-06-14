"use strict";

// Local HTTP API for AxiVale (and other local Axi apps).
//
// - Binds to 127.0.0.1 only, on a random free port.
// - Every request requires "Authorization: Bearer <token>"; the token is
//   random per launch and published via the discovery file (localApiDiscovery).
// - Contains NO electron imports: all behavior is injected through `ops`,
//   which index.js wires to the existing IPC handler logic so validation,
//   history, write queues, and shared-library sync are preserved.

const http = require("node:http");
const crypto = require("node:crypto");

const MAX_BODY_BYTES = 5 * 1024 * 1024; // builds carry base64 images; 5MB matches real payloads

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Over-limit bodies: stop accumulating but keep draining so "end" fires and
    // the 413 can be delivered (req.destroy() would race the response write).
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return; // keep draining so "end" fires; just don't accumulate
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        // Don't push further chunks; keep draining so "end" fires and we can respond.
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) {
        return reject(httpError(413, "Request body too large"));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Pattern segments starting with ":" capture into params. Routes are matched
// in declaration order; segment counts must match exactly.
function matchRoute(routes, method, pathname) {
  const segs = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const patSegs = route.pattern.split("/").filter(Boolean);
    if (patSegs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(":")) {
        // Malformed percent-escapes → 400 (matchRoute is called inside the
        // request try block, so throwing here is safe). When a route with a param
        // segment matches, a malformed escape like "/builds/%" raises 400 here.
        try {
          params[patSegs[i].slice(1)] = decodeURIComponent(segs[i]);
        } catch (e) {
          if (e instanceof URIError) throw httpError(400, "Malformed URL escape in path");
          throw e;
        }
      } else if (patSegs[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

function buildRoutes({ version, ops }) {
  return [
    { method: "GET", pattern: "/health", handler: async () => ({ ok: true, version }) },

    // Graceful release for a headless instance an embedder (e.g. AxiVale) spawned:
    // quit only if no window was ever promoted, so we never kill a window the user
    // opened via AxiOM. ops.quitIfHeadless() owns the window check + the actual quit.
    { method: "POST", pattern: "/lifecycle/quit-if-headless", handler: async () => ops.quitIfHeadless() },

    // ── Builds ───────────────────────────────────────────────────────────
    { method: "GET", pattern: "/builds", handler: async () => ops.listBuilds() },
    {
      method: "POST", pattern: "/builds",
      handler: async ({ body }) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw httpError(400, "Request body must be a build object");
        }
        return ops.saveBuild(body);
      },
    },
    {
      method: "GET", pattern: "/builds/:id",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        const build = builds.find((b) => b.id === params.id);
        if (!build) throw httpError(404, `Build not found: ${params.id}`);
        return build;
      },
    },
    {
      method: "DELETE", pattern: "/builds/:id",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        if (!builds.some((b) => b.id === params.id)) {
          throw httpError(404, `Build not found: ${params.id}`);
        }
        await ops.deleteBuild(params.id);
        return { ok: true };
      },
    },
    {
      method: "POST", pattern: "/builds/:id/publish",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        if (!builds.some((b) => b.id === params.id)) {
          throw httpError(404, `Build not found: ${params.id}`);
        }
        return ops.publishBuild(params.id);
      },
    },
    {
      method: "POST", pattern: "/builds/:id/chat-link",
      handler: async ({ params }) => {
        const builds = await ops.listBuilds();
        const build = builds.find((b) => b.id === params.id);
        if (!build) throw httpError(404, `Build not found: ${params.id}`);
        return { chatLink: await ops.generateChatLink(build) };
      },
    },

    // ── Comps ────────────────────────────────────────────────────────────
    { method: "GET", pattern: "/comps", handler: async () => ops.listComps() },
    {
      method: "POST", pattern: "/comps",
      handler: async ({ body }) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw httpError(400, "Request body must be a comp object");
        }
        return ops.saveComp(body);
      },
    },
    {
      method: "GET", pattern: "/comps/:id",
      handler: async ({ params }) => {
        const comps = await ops.listComps();
        const comp = comps.find((c) => c.id === params.id);
        if (!comp) throw httpError(404, `Comp not found: ${params.id}`);
        return comp;
      },
    },
    {
      method: "DELETE", pattern: "/comps/:id",
      handler: async ({ params }) => {
        const comps = await ops.listComps();
        if (!comps.some((c) => c.id === params.id)) {
          throw httpError(404, `Comp not found: ${params.id}`);
        }
        await ops.deleteComp(params.id);
        return { ok: true };
      },
    },
    {
      method: "POST", pattern: "/comps/:id/publish",
      handler: async ({ params, body }) => {
        const comps = await ops.listComps();
        if (!comps.some((c) => c.id === params.id)) {
          throw httpError(404, `Comp not found: ${params.id}`);
        }
        return ops.publishComp(params.id, body?.boonCoverageHtml);
      },
    },
    {
      method: "GET", pattern: "/comps/:id/plaintext",
      handler: async ({ params }) => {
        const comps = await ops.listComps();
        if (!comps.some((c) => c.id === params.id)) {
          throw httpError(404, `Comp not found: ${params.id}`);
        }
        return { text: await ops.compPlaintext(params.id) };
      },
    },

    // ── Imports ──────────────────────────────────────────────────────────
    {
      method: "POST", pattern: "/import/chat-link",
      handler: async ({ body }) => {
        if (!body?.link || typeof body.link !== "string") {
          throw httpError(400, "Body must include a chat link string: { link }");
        }
        return ops.importChatLink(body.link, body.name ?? null, body.folderId ?? null, body.gameMode ?? null);
      },
    },
    {
      method: "POST", pattern: "/import/gw2skills",
      handler: async ({ body }) => {
        if (!body?.url || typeof body.url !== "string") {
          throw httpError(400, "Body must include a gw2skills editor URL: { url }");
        }
        return ops.importGw2Skills(body.url, body.name ?? null, body.folderId ?? null, body.gameMode ?? null);
      },
    },
    {
      method: "POST", pattern: "/import/gw2skills/parse",
      handler: async ({ body }) => {
        if (!body?.url || typeof body.url !== "string") {
          throw httpError(400, "Body must include a gw2skills editor URL: { url }");
        }
        return ops.parseGw2Skills(body.url, body.gameMode ?? undefined);
      },
    },
    {
      method: "POST", pattern: "/import/chat-link/parse",
      handler: async ({ body }) => {
        if (!body?.link || typeof body.link !== "string") {
          throw httpError(400, "Body must include a chat link string: { link }");
        }
        return ops.parseChatLink(body.link, body.gameMode ?? undefined);
      },
    },

    // ── Catalog ──────────────────────────────────────────────────────────
    { method: "GET", pattern: "/catalog/professions", handler: async () => ops.listProfessions() },
    {
      method: "GET", pattern: "/catalog/professions/:id",
      handler: async ({ params, query }) =>
        ops.getProfessionCatalog(params.id, query.get("gameMode") || undefined),
    },
    { method: "GET", pattern: "/catalog/upgrades", handler: async () => ops.getUpgradeCatalog() },

    // ── Folders ──────────────────────────────────────────────────────────
    { method: "GET", pattern: "/folders", handler: async () => ops.listFolders() },
  ];
}

function createLocalApi({ token, version, ops }) {
  if (!token) throw new Error("createLocalApi requires a token");
  if (!ops) throw new Error("createLocalApi requires an ops object");

  // Timing-safe auth — compute expected digest once at startup.
  const expectedAuth = crypto.createHash("sha256").update(`Bearer ${token}`).digest();
  function isAuthorized(header) {
    const actual = crypto.createHash("sha256").update(header || "").digest();
    return crypto.timingSafeEqual(actual, expectedAuth);
  }

  const routes = buildRoutes({ version, ops });

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAuthorized(req.headers["authorization"])) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const match = matchRoute(routes, req.method, url.pathname);
      if (!match) {
        return sendJson(res, 404, { error: `No route: ${req.method} ${url.pathname}` });
      }
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJsonBody(req) : null;
      const result = await match.handler({ params: match.params, query: url.searchParams, body });
      sendJson(res, 200, result === undefined ? { ok: true } : result);
    } catch (err) {
      // Guard against double-write if headers were already sent.
      if (!res.headersSent) sendJson(res, err?.statusCode || 500, { error: err?.message || "Internal error" });
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          // Remove the startup-only error listener and attach a persistent one.
          server.removeListener("error", reject);
          server.on("error", (err) => console.error("[local-api] server error:", err?.message || err));
          resolve({ port: server.address().port });
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    get port() {
      return server.address()?.port ?? null;
    },
  };
}

module.exports = { createLocalApi, generateToken, httpError };
