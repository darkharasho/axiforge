"use strict";

// GET /api/gw2skills?url=<gw2skills editor url>&gameMode=<pve|wvw|pvp> -> { build }
//
// The whole import runs server-side: fetch the gw2skills page + ajax db (both
// CORS-blocked in the browser) AND decode the build's chat link against the GW2
// API. The chat-link decode used to run client-side because Cloudflare's shared
// egress IPs 429 on api.guildwars2.com — that's now solved by edge-caching the
// GW2 API responses (see buildChatLink.js's fetch wrapper), so the browser makes
// a single same-origin request and never has to reach gw2skills.net or the GW2
// API itself.
//
// CommonJS (matching slug.js) so Jest can `require()` it directly.
const { parseGw2Skills } = require("../../../src/main/gw2skillsParse.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const GW2SKILLS_RE = /^https?:\/\/(?:[a-z]{2}\.)?gw2skills\.net\/editor\//i;

// `deps.fetchText` / `deps.getUpgradeCatalog` are injected in tests.
async function handleGw2Skills(url, env, deps = {}) {
  if (!url || !GW2SKILLS_RE.test(url)) {
    return json({ error: "A gw2skills.net editor URL is required." }, 400);
  }
  const fetchText =
    deps.fetchText ||
    (async (u) => {
      const r = await fetch(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AxiForge/1.0)",
          Referer: "https://en.gw2skills.net/",
          Accept: "text/html,application/json,*/*",
        },
      });
      if (!r.ok) throw new Error(`gw2skills responded ${r.status}`);
      return r.text();
    });
  // Baked catalog served from the SPA's own assets (same shape as desktop's
  // getUpgradeCatalog("en")). The SPA `not_found_handling` can return index.html
  // with a 200 for a missing asset, so also reject a non-JSON response.
  const getUpgradeCatalog =
    deps.getUpgradeCatalog ||
    (async () => {
      const r = await env.ASSETS.fetch(new Request(new URL("/catalogs/upgrades.json", "https://build.axi.link")));
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) {
        throw new Error("upgrade catalog unavailable");
      }
      return r.json();
    });
  try {
    const build = await parseGw2Skills(url, { fetchText, getUpgradeCatalog, gameMode: deps.gameMode });
    return json({ build });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const upstream = /responded \d+|fetch|network|429|unavailable/i.test(msg);
    return json(
      {
        error: upstream ? "gw2skills.net could not be reached." : "Couldn't read that gw2skills build.",
        detail: msg,
      },
      upstream ? 502 : 400
    );
  }
}

module.exports = { handleGw2Skills };
