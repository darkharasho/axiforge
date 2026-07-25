"use strict";

// GET /api/gw2skills?url=<gw2skills editor url> -> { build } | { error }
//
// Written as CommonJS (matching slug.js) so Jest can `require()` it directly
// while wrangler/esbuild still consumes it fine via a dynamic `import()` from
// index.js (same CJS/ESM interop pattern already used for slug.js).
const { parseGw2Skills } = require("../../../src/main/gw2skillsParse.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const GW2SKILLS_RE = /^https?:\/\/(?:[a-z]{2}\.)?gw2skills\.net\/editor\//i;

// `deps.fetchText` is injected in tests; production defaults to global fetch.
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
  // Baked catalog is served from the SPA's own assets (same shape as desktop
  // getUpgradeCatalog("en") — produced by scripts/bake-catalogs.mjs).
  const getUpgradeCatalog = async () => {
    const assetUrl = new URL("/catalogs/upgrades.json", "https://build.axi.link");
    const r = await env.ASSETS.fetch(new Request(assetUrl));
    // Under the SPA's `not_found_handling`, a missing asset can resolve to
    // index.html with a 200 status instead of a 404 — so also reject when the
    // response isn't actually JSON, or this masquerades as a generic parse
    // error instead of the upstream/operational failure it really is.
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) {
      throw new Error("upgrade catalog unavailable");
    }
    return r.json();
  };
  try {
    const build = await parseGw2Skills(url, { fetchText, getUpgradeCatalog, gameMode: deps.gameMode });
    return json({ build });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const upstream = /responded \d+|fetch|network/i.test(msg);
    return json(
      { error: upstream ? "gw2skills.net could not be reached." : "Couldn't read that gw2skills build." },
      upstream ? 502 : 400
    );
  }
}

module.exports = { handleGw2Skills };
