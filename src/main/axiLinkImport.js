"use strict";

const https = require("https");
const { decryptBuild } = require("./buildEncryption.js");

// ── HTTP ──────────────────────────────────────────────────────────────────────

/**
 * GET a URL as text, reporting the status so a 404 on one data base can fall
 * through to the next candidate instead of being decrypted as garbage.
 * @returns {Promise<{status: number, body: string}>}
 */
function httpsGetStatus(url, redirectCount = 0) {
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
          Accept: "text/plain,text/html,*/*",
          "Cache-Control": "no-cache",
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(httpsGetStatus(new URL(res.headers.location, url).href, redirectCount + 1));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
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

// ── Link parsing ──────────────────────────────────────────────────────────────

/**
 * Where the published data actually lives, in the order worth trying.
 *
 * This mirrors resolveDataBase() in src/site/rawBase.js — the SPA reads its
 * encrypted files from raw.githubusercontent.com so a fresh publish is live
 * within seconds of the commit, rather than waiting on a Pages deploy. The
 * page's own directory is kept as a second candidate: it serves the same files
 * once Pages catches up, and it is the only base that works for a site hosted
 * anywhere other than github.io.
 */
function dataBases(url) {
  const explicit = url.searchParams.get("remoteBase");
  if (explicit) return [explicit.endsWith("/") ? explicit : `${explicit}/`];

  const bases = [];
  const repo = (url.pathname || "/").split("/").filter(Boolean)[0] || "";
  const ghUser = (url.hostname || "").match(/^([^.]+)\.github\.io$/);
  if (ghUser && repo) {
    bases.push(`https://raw.githubusercontent.com/${ghUser[1]}/${repo}/main/site/`);
  }
  // The directory the link points at — "/axibuilds/" for the SPA, which Pages
  // serves from the repo's site/ folder.
  const dir = url.pathname.endsWith("/") ? url.pathname : url.pathname.replace(/[^/]*$/, "");
  bases.push(`${url.origin}${dir}`);
  return bases;
}

/** Splits a "<fileId>.<key>" param. Returns null if it is not that shape. */
function splitRef(param) {
  const value = String(param || "").trim();
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) return null;
  return { fileId: value.slice(0, dot), key: value.slice(dot + 1) };
}

/**
 * Reads a published AxiForge link into everything needed to fetch its payload.
 *
 * Accepts every link shape the SPA itself accepts (src/site/main.js): the
 * current `?b=<id>.<key>` / `?c=<id>.<key>` query form, the `?legacy=` form the
 * 404 redirect produces, and the oldest bare `#<id>.<key>` hash. It also
 * accepts a `/r/<id>/` short link, which carries no key and has to be resolved
 * over the network — see resolveShortLink.
 *
 * @returns {{kind: "build"|"comp", fileId: string|null, key: string|null,
 *            name: string, bases: string[], shortId: string|null}}
 */
function parseAxiLink(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Paste an AxiForge build link.");

  let url;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a link.");
  }

  const bases = dataBases(url);
  const name = url.searchParams.get("n") || "";

  const comp = splitRef(url.searchParams.get("c"));
  if (comp) return { kind: "comp", ...comp, name, bases, shortId: null };

  const build =
    splitRef(url.searchParams.get("b")) ||
    splitRef(url.searchParams.get("legacy")) ||
    splitRef(url.hash.replace(/^#/, ""));
  if (build) return { kind: "build", ...build, name, bases, shortId: null };

  // Short link: /r/<fileId>/ — the key lives in the redirect it serves.
  const short = url.pathname.match(/\/r\/([^/]+)\/?$/);
  if (short) return { kind: "build", fileId: null, key: null, name, bases, shortId: short[1] };

  throw new Error("That link has no build in it. Copy the full link, including the ?b= part.");
}

/**
 * Follows a /r/<id>/ short link to the `?b=<id>.<key>` it redirects to.
 * The redirect is a static meta-refresh page (see buildRedirectFile in
 * siteBundle.js), so the key comes out of its HTML rather than a Location header.
 */
async function resolveShortLink(url, fetchText) {
  const target = url.replace(/\/?$/, "/");
  const { status, body } = await fetchText(target);
  if (status !== 200) throw new Error(`That link isn't published (HTTP ${status}).`);
  const match = String(body).match(/[?&](b|c)=([^"'&\s>]+)/);
  if (!match) throw new Error("That short link doesn't point at a build.");
  const ref = splitRef(decodeURIComponent(match[2]));
  if (!ref) throw new Error("That short link doesn't point at a build.");
  return { kind: match[1] === "c" ? "comp" : "build", ...ref };
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Fields the publish snapshot carries that must NOT ride along into a local
 * copy. Everything else is dropped for free: buildStore's normalizeBuild is an
 * allowlist, so the display-only enrichment serializeForPublish adds
 * (catalogSkills, computedStats, equipmentDisplay, …) never reaches disk.
 *
 * These are the fields normalizeBuild *does* keep and that would otherwise make
 * the import masquerade as the original — pointing at someone else's published
 * file, sitting in a folder that does not exist here, or arriving pre-trashed.
 */
const NOT_MINE = [
  "id", "createdAt", "updatedAt", "folderId", "compIds", "pinned", "sortOrder",
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
  "deletedAt", "trashBatchId", "trashRoot",
];

function toImportedBuild(payload, { name, folderId, gameMode } = {}) {
  if (!payload || typeof payload !== "object" || !payload.profession) {
    throw new Error("That link decrypted, but there's no build inside it.");
  }
  const build = { ...payload };
  for (const field of NOT_MINE) delete build[field];
  build.title = name || payload.title || "Imported Build";
  build.folderId = folderId ?? null;
  build.gameMode = payload.gameMode || gameMode || "pve";
  return build;
}

async function fetchPayload({ fileId, key, bases, dir }, fetchText) {
  const failures = [];
  for (const base of bases) {
    let res;
    try {
      res = await fetchText(`${base}${dir}/${encodeURIComponent(fileId)}.enc`);
    } catch (err) {
      failures.push(err?.message || String(err));
      continue;
    }
    if (res.status !== 200) {
      failures.push(`HTTP ${res.status}`);
      continue;
    }
    try {
      return decryptBuild(res.body.trim(), key);
    } catch {
      // Reached the file but could not open it: the key in the link is wrong or
      // truncated. Trying the next base would only repeat that, so stop here.
      throw new Error("Couldn't decrypt that build — the link looks incomplete or was edited.");
    }
  }
  throw new Error(
    failures.includes("HTTP 404")
      ? "That build isn't published anymore (the link's file is gone)."
      : `Couldn't reach that build (${failures[0] || "no response"}).`
  );
}

/**
 * Import a build from a published AxiForge link (the SPA pages the app publishes
 * to GitHub Pages, e.g. https://<user>.github.io/axibuilds/?n=…&b=<id>.<key>).
 *
 * READ-ONLY: returns the assembled, normalize-ready build. The caller writes it,
 * matching how the chat-link and gw2skills imports are wired.
 *
 * @param {string} link
 * @param {{name?: string, folderId?: string|null, gameMode?: string}} [opts]
 * @param {{fetchText?: Function}} [deps] injection point for tests
 */
async function importAxiLink(link, opts = {}, deps = {}) {
  const fetchText = deps.fetchText || httpsGetStatus;
  let parsed = parseAxiLink(link);

  if (parsed.shortId) {
    const resolved = await resolveShortLink(link, fetchText);
    parsed = { ...parsed, ...resolved };
  }
  if (parsed.kind === "comp") {
    throw new Error("That's a link to a comp, not a build. Open the comp and copy a build's link.");
  }

  const payload = await fetchPayload({ ...parsed, dir: "builds" }, fetchText);
  // The link's `n=` param is a slug ("u-chrono"), not a title — the payload
  // carries the real name, so only an explicit name from the user overrides it.
  return toImportedBuild(payload, { name: opts.name, folderId: opts.folderId, gameMode: opts.gameMode });
}

module.exports = {
  importAxiLink,
  // Test surface
  _parseAxiLink: parseAxiLink,
  _toImportedBuild: toImportedBuild,
  _resolveShortLink: resolveShortLink,
};
