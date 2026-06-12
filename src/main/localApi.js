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
    // Over-limit bodies: stop accumulating but keep draining so "end" fires and the 413 can be delivered.
    // so the response can still be sent (req.destroy() races the response write).
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
        // Change 5: malformed percent-escapes → 400 (matchRoute is called inside the
        // request try block, so throwing here is safe). A GET /builds/% still yields
        // 404 because no route captures that pattern, but the guard is in place.
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

  // Change 1: Timing-safe auth — compute expected digest once at startup.
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
      // Change 3: guard against double-write if headers were already sent.
      if (!res.headersSent) sendJson(res, err?.statusCode || 500, { error: err?.message || "Internal error" });
    }
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          // Change 4: remove the startup-only error listener and attach a persistent one.
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

module.exports = { createLocalApi, generateToken };
