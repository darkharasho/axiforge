"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { encryptBuild } = require("./buildEncryption");

// Resolve dist/site directory — packaged app uses resourcesPath, dev uses project root
function getSiteDistDir() {
  if (typeof app !== "undefined" && app.isPackaged) {
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
  const content = encryptBuild(buildData, base64urlKey);
  return {
    filePath: `site/builds/${fileId}.enc`,
    content,
  };
}

function buildEncryptedCompFile(compData, fileId, base64urlKey) {
  const content = encryptBuild(compData, base64urlKey);
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
  const target = `/?${type}=${fileId}.${encKey}`;
  return {
    filePath: `site/r/${fileId}/index.html`,
    content: `<!DOCTYPE html><meta http-equiv=refresh content="0;url=${target}">`,
  };
}

module.exports = { buildSpaBundle, buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile };
