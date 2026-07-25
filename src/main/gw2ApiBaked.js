"use strict";

// Answers the subset of api.guildwars2.com/v2 requests that the chat-link decoder
// (gw2buildlink) makes, from BAKED static JSON instead of the live API — so the
// web/Worker import path never depends on a live GW2 API call (Cloudflare IPs 429;
// per-user browser calls are fragile). See scripts/bake-gw2api.mjs for the data.
//
// URL shapes gw2buildlink builds (see node_modules/gw2buildlink/dist/gw2ApiClient.js):
//   /v2/professions?ids=all | ?ids=<name>
//   /v2/specializations?ids=all | ?ids=<a,b> | /specializations/<id>
//   /v2/skills?ids=<a,b> | ?search=<name>
//   /v2/traits?ids=<a,b>
//   /v2/pets?ids=all | /pets/<id>

const ENDPOINT_RE = /\/v2\/(professions|specializations|skills|traits|pets)(?:\/([^/?]+))?/;

// Per-isolate index cache: ep -> Map<String(id), item>. Keyed by ep only; the
// baked data is immutable for a deployment.
const _indexCache = new Map();

async function _index(ep, loadJson) {
  let byId = _indexCache.get(ep);
  if (!byId) {
    const list = await loadJson(ep); // caller memoizes the raw array per isolate
    byId = new Map((Array.isArray(list) ? list : []).map((o) => [String(o.id), o]));
    byId.__list = Array.isArray(list) ? list : [];
    _indexCache.set(ep, byId);
  }
  return byId;
}

/**
 * If `url` is a recognized GW2 API request, return a Response synthesized from the
 * baked data (`loadJson(ep)` resolves the baked array for an endpoint). Otherwise
 * return null so the caller falls back to the network.
 */
async function serveBakedGw2Api(url, loadJson) {
  if (typeof url !== "string" || !url.includes("api.guildwars2.com")) return null;
  const m = ENDPOINT_RE.exec(url);
  if (!m) return null;
  const ep = m[1];
  const single = m[2];
  const byId = await _index(ep, loadJson);
  const list = byId.__list;

  const params = new URL(url).searchParams;
  const ids = params.get("ids");
  const search = params.get("search");

  let body;
  if (single != null) {
    body = byId.get(decodeURIComponent(single)) ?? null;
  } else if (ids === "all") {
    body = list;
  } else if (ids != null) {
    body = ids.split(",").map((id) => byId.get(id)).filter(Boolean);
  } else if (search != null) {
    // /v2/<ep>?search=<name> returns an array of matching ids.
    const q = search.toLowerCase();
    body = list.filter((o) => typeof o.name === "string" && o.name.toLowerCase().includes(q)).map((o) => o.id);
  } else {
    body = list;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Test/maintenance: drop the per-isolate index cache.
function _resetBakedCache() {
  _indexCache.clear();
}

module.exports = { serveBakedGw2Api, _resetBakedCache };
