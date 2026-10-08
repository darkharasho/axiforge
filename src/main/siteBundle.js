"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { encryptPayload } = require("./buildEncryption");

const SITE_VERSION_PATH = "site/site-version";

// The newest payload format this viewer reads. Bump it whenever the viewer
// learns a format an older viewer can't read (a PAYLOAD_VERSION or
// COMP_FORMAT_VERSION bump, or any other change older viewers would misread).
const VIEWER_FORMAT = 2;

// A copy of the shell lives outside site/, where apps up to v1.3.1 never write
// or delete. The repo's guard workflow serves it whenever an older app has put
// its own shell back into site/ (see githubApi.ensurePagesWorkflow).
const VIEWER_DIR = "viewer/";
const VIEWER_FORMAT_PATH = `${VIEWER_DIR}viewer-format`;

function isShellPath(p) {
  if (p === SITE_VERSION_PATH) return false;
  if (!p.startsWith("site/")) return false;
  if (p.startsWith("site/builds/") || p.startsWith("site/comps/") || p.startsWith("site/r/")) return false;
  return true;
}

function computeSpaVersion(bundle) {
  const hash = crypto.createHash("sha256");
  for (const rel of Object.keys(bundle).filter(isShellPath).sort()) {
    hash.update(rel);
    hash.update("\0");
    hash.update(String(bundle[rel]));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

// Resolve dist/site directory — packaged app uses resourcesPath, dev uses project root.
// electron is required lazily and read at call time: at module-load time under jest the
// active "electron" mock depends on worker scheduling, and outside Electron `require
// ("electron")` returns the binary path string (no `.app`) — both are handled here as dev.
function getSiteDistDir() {
  let app;
  try { app = require("electron").app; } catch { /* not running under Electron */ }
  if (app && app.isPackaged) {
    return path.join(process.resourcesPath, "site");
  }
  return path.join(__dirname, "../../dist/site");
}

function buildSpaBundle() {
  const distDir = getSiteDistDir();
  if (!fs.existsSync(distDir)) {
    throw new Error(`Site not built. Run "npm run build:site" first. Expected: ${distDir}`);
  }
  const files = {};
  walkDir(distDir, distDir, files);
  files["site/.nojekyll"] = "\n";
  files[SITE_VERSION_PATH] = computeSpaVersion(files);
  for (const [rel, content] of Object.entries(files)) {
    files[VIEWER_DIR + rel.slice("site/".length)] = content;
  }
  files[VIEWER_FORMAT_PATH] = String(VIEWER_FORMAT);
  return files;
}

function walkDir(dir, root, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, root, files);
    } else {
      const rel = "site/" + path.relative(root, full).replace(/\\/g, "/");
      // Read text files as utf8, binary files as base64
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot"].includes(ext);
      files[rel] = isBinary
        ? fs.readFileSync(full).toString("base64")
        : fs.readFileSync(full, "utf8");
    }
  }
}

function buildEncryptedBuildFile(buildData, fileId, base64urlKey) {
  const content = encryptPayload(buildData, base64urlKey);
  return {
    filePath: `site/builds/${fileId}.enc`,
    content,
  };
}

function buildEncryptedCompFile(compData, fileId, base64urlKey) {
  const content = encryptPayload(compData, base64urlKey);
  return {
    filePath: `site/comps/${fileId}.enc`,
    content,
  };
}

/**
 * Build a redirect HTML file for short URLs.
 * @param {string} fileId
 * @param {string} encKey — base64url encryption key
 * @param {"b"|"c"} type — "b" for builds, "c" for comps
 */
function buildRedirectFile(fileId, encKey, type) {
  const target = `../../?${type}=${fileId}.${encKey}`;
  return {
    filePath: `site/r/${fileId}/index.html`,
    content: `<!DOCTYPE html><meta http-equiv=refresh content="0;url=${target}">`,
  };
}

/**
 * Decide whether this publish uploads the viewer shell or only data.
 * @param {object} bundle
 * @param {string|null} remoteVersion — the repo's site/site-version
 * @param {number|null} [remoteFormat] — the repo's viewer/viewer-format
 */
function partitionBundleForPublish(bundle, remoteVersion, remoteFormat = null) {
  const localVersion = bundle[SITE_VERSION_PATH];
  const localFormat = Number(bundle[VIEWER_FORMAT_PATH]) || 0;
  // Never replace a viewer that reads newer formats than ours: links
  // published by a newer app would stop opening.
  const remoteIsNewer = Number(remoteFormat) > localFormat;
  const shellChanged = !remoteIsNewer && (!remoteVersion || remoteVersion !== localVersion);
  if (shellChanged) return { shellChanged: true, filesToPublish: { ...bundle } };
  const filesToPublish = {};
  for (const [p, content] of Object.entries(bundle)) {
    // Shell unchanged: only re-publish per-build/comp/redirect data.
    // Shell files AND the version marker are dropped.
    if (p.startsWith("site/builds/") || p.startsWith("site/comps/") || p.startsWith("site/r/")) {
      filesToPublish[p] = content;
    }
  }
  return { shellChanged: false, filesToPublish };
}

module.exports = { getSiteDistDir, buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile, computeSpaVersion, SITE_VERSION_PATH, VIEWER_FORMAT, VIEWER_DIR, VIEWER_FORMAT_PATH, partitionBundleForPublish };
