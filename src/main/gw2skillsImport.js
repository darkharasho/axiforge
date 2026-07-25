"use strict";

const https = require("https");
const core = require("./gw2skillsParse.js");

// ── HTTP helper ────────────────────────────────────────────────────────────────

function httpsGet(url, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error("Too many redirects"));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AxiForge/1.0)",
          Referer: "https://en.gw2skills.net/",
          Accept: "text/html,application/json,*/*",
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGet(new URL(res.headers.location, url).href, redirectCount + 1));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

// ── Main import function ───────────────────────────────────────────────────────

/**
 * Fetch and decode a gw2skills.net editor URL into an axiforge build object.
 * READ-ONLY: returns the assembled (normalize-ready) build; never writes a store.
 * Thin desktop adapter over ./gw2skillsParse.js — injects Node `https` for
 * `fetchText` and the desktop `getUpgradeCatalog` dependency.
 *
 * @param {string} url  full gw2skills.net editor URL
 * @param {{ name?: string, folderId?: (string|null), gameMode?: string }} [opts]
 * @returns {Promise<object>} the assembled axiforge build object (not saved)
 */
async function parseGw2Skills(url, opts = {}) {
  const { getUpgradeCatalog } = require("./gw2Data"); // lazy: desktop-only dep
  return core.parseGw2Skills(url, {
    fetchText: (u) => httpsGet(u),
    getUpgradeCatalog: () => getUpgradeCatalog("en"),
    name: opts.name ?? null,
    folderId: opts.folderId ?? null,
    gameMode: opts.gameMode,
  });
}

/**
 * Backward-compatible positional wrapper around parseGw2Skills.
 * The store write is performed by the caller (IPC handler / local-API op),
 * not here — parse and import return the same object; only the caller differs.
 *
 * @param {string}      url
 * @param {string}      name
 * @param {string|null} folderId
 * @param {string}      gameMode
 * @returns {Promise<object>} assembled axiforge build object
 */
async function importGw2SkillsBuild(url, name, folderId, gameMode) {
  return parseGw2Skills(url, { name, folderId, gameMode });
}

module.exports = {
  importGw2SkillsBuild,
  parseGw2Skills,
  // Back-compat test surface — now sourced from the core module.
  _parsePreloadFromHtml: core.parsePreloadFromHtml,
  _buildStatLookup: core._buildStatLookup,
  _normalizeStatName: core._normalizeStatName,
  _lookupUpgradeName: core._lookupUpgradeName,
  _lookupBuffName: core._lookupBuffName,
  _mapEquipment: core._mapEquipment,
  _extractMorphSkillIds: core._extractMorphSkillIds,
};
