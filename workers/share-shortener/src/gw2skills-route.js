"use strict";

// GET /api/gw2skills?url=<gw2skills url> -> the raw text of that gw2skills.net
// resource (page HTML or ajax db JSON).
//
// Why a dumb proxy and not a full parse here: the browser can't fetch gw2skills
// .net (no CORS), but decoding the build's chat link needs many api.guildwars2
// .com calls — and those 429 from Cloudflare's shared egress IPs. The browser,
// by contrast, reaches the GW2 API fine over CORS from the user's own IP (this
// is exactly how chat-link import already works on web). So the Worker only
// proxies the CORS-blocked gw2skills.net fetches; ALL parsing + GW2-API decoding
// happens client-side.
//
// Written as CommonJS (matching slug.js) so Jest can `require()` it directly.
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Only proxy gw2skills.net (and its language subdomains) — never an arbitrary
// host, or this is an open SSRF proxy.
const GW2SKILLS_HOST = /(^|\.)gw2skills\.net$/i;

// `deps.fetch` is injected in tests; production defaults to global fetch.
async function handleGw2Skills(rawUrl, env, deps = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return json({ error: "A gw2skills.net URL is required." }, 400);
  }
  if (!/^https?:$/.test(parsed.protocol) || !GW2SKILLS_HOST.test(parsed.hostname)) {
    return json({ error: "Only gw2skills.net URLs can be imported." }, 400);
  }
  const doFetch = deps.fetch || fetch;
  let res;
  try {
    res = await doFetch(parsed.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AxiForge/1.0)",
        Referer: "https://en.gw2skills.net/",
        Accept: "text/html,application/json,*/*",
      },
    });
  } catch (err) {
    return json({ error: "gw2skills.net could not be reached.", detail: String((err && err.message) || err) }, 502);
  }
  if (!res.ok) {
    return json({ error: `gw2skills.net responded ${res.status}.` }, 502);
  }
  const body = await res.text();
  // Pass the upstream content-type through (text/html for the page, JSON for the
  // ajax db) so the client can treat each appropriately.
  return new Response(body, {
    status: 200,
    headers: { "content-type": res.headers.get("content-type") || "text/plain; charset=utf-8" },
  });
}

module.exports = { handleGw2Skills };
