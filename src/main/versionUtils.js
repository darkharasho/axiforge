"use strict";

// Semver parsing/comparison and release-notes range extraction.
// Pure — no I/O, no Electron APIs. Mirrors axibridge's versionUtils.ts,
// adapted for axiforge's RELEASE_NOTES.md format which uses
// "## Version vX.Y.Z — Month Day, Year" section headers.

const https = require("node:https");

function parseVersion(value) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/^v/i, "");
  const parts = cleaned.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const VERSION_HEADER = /^##\s*Version\s+v?([0-9]+\.[0-9]+\.[0-9]+)\b/;

// Extract release-notes sections that fall between `lastSeenVersion`
// (exclusive) and `currentVersion` (inclusive) from a RELEASE_NOTES.md body.
function extractReleaseNotesRangeFromFile(rawNotes, currentVersion, lastSeenVersion) {
  const current = parseVersion(currentVersion);
  if (!current) return null;
  const lastSeen = parseVersion(lastSeenVersion);
  const body = String(rawNotes || "").trim();
  if (!body) return null;

  const sections = body.split(/\n(?=##\s*Version\s+v)/).map((s) => s.trim()).filter(Boolean);
  const selected = sections.filter((section) => {
    const match = section.match(VERSION_HEADER);
    if (!match) return false;
    const version = parseVersion(match[1]);
    if (!version) return false;
    if (compareVersion(version, current) > 0) return false;
    if (lastSeen && compareVersion(version, lastSeen) <= 0) return false;
    return true;
  });
  if (selected.length === 0) return null;

  selected.sort((a, b) => {
    const av = parseVersion(a.match(VERSION_HEADER)?.[1] || "");
    const bv = parseVersion(b.match(VERSION_HEADER)?.[1] || "");
    if (!av || !bv) return 0;
    return compareVersion(bv, av);
  });
  return selected.join("\n\n").trim();
}

// Fetch release notes from GitHub Releases API for versions in the open
// range (lastSeenVersion, currentVersion]. Returns null on any failure.
function fetchGithubReleaseNotesRange(currentVersion, lastSeenVersion, repo = "darkharasho/axiforge") {
  const current = parseVersion(currentVersion);
  if (!current) return Promise.resolve(null);
  const lastSeen = parseVersion(lastSeenVersion);
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;

  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Axiforge", "Accept": "application/vnd.github+json" } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const releases = JSON.parse(data);
            if (!Array.isArray(releases)) { resolve(null); return; }
            const selected = releases
              .map((r) => ({ tag: String(r?.tag_name || ""), version: parseVersion(r?.tag_name), body: r?.body || "" }))
              .filter((r) => {
                if (!r.version) return false;
                if (compareVersion(r.version, current) > 0) return false;
                if (lastSeen && compareVersion(r.version, lastSeen) <= 0) return false;
                return true;
              })
              .sort((a, b) => compareVersion(b.version, a.version));
            if (selected.length === 0) { resolve(null); return; }
            const combined = selected
              .map((r) => {
                const tag = r.tag.startsWith("v") ? r.tag : `v${r.tag}`;
                const body = (r.body || "").trim();
                if (/^##\s*Version\s+v/i.test(body)) return body;
                return `## Version ${tag}\n\n${body}`.trim();
              })
              .join("\n\n");
            resolve(combined || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

module.exports = {
  parseVersion,
  compareVersion,
  extractReleaseNotesRangeFromFile,
  fetchGithubReleaseNotesRange,
};
