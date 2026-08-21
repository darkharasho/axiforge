// Cloudflare Worker: short links for transient build shares (build.axi.link/b/<slug>).
//
// Data plane:
//   POST /api/shorten   { code, name? }        -> { slug, url }
//   GET  /api/b/<slug>                          -> { code, name }  (404 if unknown)
// Navigation:
//   GET  /b/<slug>                              -> SPA shell + X-Robots-Tag: noindex
//   *                                           -> static assets (env.ASSETS)
//
// Slugs are content-addressed (see slug.js): the same build always maps to the
// same slug, so KV does not grow on repeat shares. The write endpoint validates
// with the real share-code decoder and caps body size, so it can't be abused as
// an open text store / redirector (which is what would earn a REAL Safe Browsing
// flag).
import { isValidShareCode } from "@axiapps/code";
import { computeSlug } from "./slug.js";

const MAX_BODY_BYTES = 4096; // a share code is well under this; reject anything larger
const MAX_NAME_LEN = 200;
const SLUG_MIN_LEN = 7;
const SLUG_MAX_LEN = 9; // collision fallback: 7 -> 8 -> 9 chars

const json = (obj, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });

async function handleShorten(request, env) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return json({ error: "too large" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const code = body && typeof body.code === "string" ? body.code : "";
  const name =
    body && typeof body.name === "string" ? body.name.slice(0, MAX_NAME_LEN) : "";
  // Second size guard in case content-length was absent/lied.
  if (code.length + name.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  if (!code || !isValidShareCode(code)) return json({ error: "invalid code" }, 400);

  const record = JSON.stringify(name ? { code, name } : { code });

  // Content-addressed slug with collision fallback: if a slug already maps to a
  // DIFFERENT record, lengthen. Identical record -> reuse the slug (idempotent).
  for (let length = SLUG_MIN_LEN; length <= SLUG_MAX_LEN; length++) {
    const slug = await computeSlug(code, name, length);
    const existing = await env.SHARE_SLUGS.get(slug);
    if (existing === null) {
      await env.SHARE_SLUGS.put(slug, record);
      return json({ slug, url: `${new URL(request.url).origin}/b/${slug}` });
    }
    if (existing === record) {
      return json({ slug, url: `${new URL(request.url).origin}/b/${slug}` });
    }
    // else: genuine collision on this length — try a longer slug.
  }
  return json({ error: "slug collision" }, 500);
}

async function handleResolve(slug, env) {
  if (!/^[0-9A-Za-z]{7,9}$/.test(slug)) return json({ error: "bad slug" }, 400);
  const record = await env.SHARE_SLUGS.get(slug);
  if (record === null) return json({ error: "not found" }, 404);
  return json(JSON.parse(record));
}

// Serve the SPA shell for a /b/<slug> navigation, tagged noindex so Google doesn't
// crawl the opaque build-permutation space (crawl volume hurts domain reputation).
async function serveShell(request, env) {
  const shellReq = new Request(new URL("/", request.url), request);
  const res = await env.ASSETS.fetch(shellReq);
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex");
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Team sync API (workers/sync). Checked first: it owns everything under /api/sync/.
    if (pathname.startsWith("/api/sync/")) {
      const { handleSync } = await import("../../sync/src/router.js");
      const res = await handleSync(request, env);
      if (res) return res;
    }

    if (pathname === "/api/shorten") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      return handleShorten(request, env);
    }

    if (pathname === "/api/gw2skills") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      const { handleGw2Skills } = await import("./gw2skills-route.js");
      return handleGw2Skills(url.searchParams.get("url") || "", env, {
        gameMode: url.searchParams.get("gameMode") || undefined,
      });
    }

    const resolveMatch = pathname.match(/^\/api\/b\/([^/]+)$/);
    if (resolveMatch) {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return handleResolve(resolveMatch[1], env);
    }

    if (/^\/b\/[0-9A-Za-z]{7,9}$/.test(pathname) && request.method === "GET") {
      return serveShell(request, env);
    }

    // Everything else: static assets (the built SPA).
    return env.ASSETS.fetch(request);
  },

  // Daily: drop team-sync tombstones older than 30 days.
  async scheduled(_event, env, ctx) {
    const { purgeTombstones } = await import("../../sync/src/purge.js");
    ctx.waitUntil(
      purgeTombstones(env)
        .then((r) => console.log(`[sync] purged ${r.deleted} tombstones`))
        .catch((err) => console.error("[sync] purge failed", err))
    );
  },
};
