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
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(httpError(413, "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
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
        params[patSegs[i].slice(1)] = decodeURIComponent(segs[i]);
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
  ];
}

function createLocalApi({ token, version, ops }) {
  if (!token) throw new Error("createLocalApi requires a token");
  if (!ops) throw new Error("createLocalApi requires an ops object");

  const routes = buildRoutes({ version, ops });

  const server = http.createServer(async (req, res) => {
    try {
      if ((req.headers["authorization"] || "") !== `Bearer ${token}`) {
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
      sendJson(res, err?.statusCode || 500, { error: err?.message || "Internal error" });
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port }));
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

module.exports = { createLocalApi, generateToken };
