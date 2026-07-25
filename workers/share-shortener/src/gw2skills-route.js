"use strict";

// GET /api/gw2skills?url=<gw2skills editor url>&gameMode=<pve|wvw|pvp> -> { build }
//
// The whole import runs server-side and returns a finished build in ONE response:
// fetch the gw2skills page + ajax db (both CORS-blocked in the browser) AND decode
// the build's chat link. The chat-link decode normally needs api.guildwars2.com,
// which 429s Cloudflare's shared egress IPs — so we serve those GW2 API requests
// from BAKED static data (scripts/bake-gw2api.mjs) via __GW2_BAKED_FETCH__. No
// live GW2 API call happens anywhere, and the browser makes a single same-origin
// request.
//
// CommonJS (matching slug.js) so Jest can `require()` it directly.
const { parseGw2Skills } = require("../../../src/main/gw2skillsParse.js");
const { serveBakedGw2Api } = require("../../../src/main/gw2ApiBaked.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const GW2SKILLS_RE = /^https?:\/\/(?:[a-z]{2}\.)?gw2skills\.net\/editor\//i;

// Per-isolate cache of the baked GW2 API arrays (immutable per deployment).
const _bakedRaw = new Map(); // ep -> Promise<Array>
function bakedLoader(env) {
  return (ep) => {
    if (!_bakedRaw.has(ep)) {
      _bakedRaw.set(
        ep,
        (async () => {
          const r = await env.ASSETS.fetch(
            new Request(new URL(`/catalogs/gw2api/${ep}.json`, "https://build.axi.link"))
          );
          if (!r.ok) throw new Error(`baked gw2api/${ep} unavailable (${r.status})`);
          return r.json();
        })()
      );
    }
    return _bakedRaw.get(ep);
  };
}

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
  const getUpgradeCatalog =
    deps.getUpgradeCatalog ||
    (async () => {
      const r = await env.ASSETS.fetch(new Request(new URL("/catalogs/upgrades.json", "https://build.axi.link")));
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) {
        throw new Error("upgrade catalog unavailable");
      }
      return r.json();
    });

  // Route the chat-link decoder's GW2 API calls to baked data (no live call).
  const loadJson = deps.bakedLoader || bakedLoader(env);
  globalThis.__GW2_BAKED_FETCH__ = (apiUrl) => serveBakedGw2Api(apiUrl, loadJson);

  try {
    const build = await parseGw2Skills(url, { fetchText, getUpgradeCatalog, gameMode: deps.gameMode });
    return json({ build });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const upstream = /responded \d+|fetch|network|unavailable/i.test(msg);
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
