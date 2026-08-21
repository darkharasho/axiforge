"use strict";

// Shared durable-JSON helpers for the on-disk stores (builds, comps, folders,
// sync state, history).
//
// Guarantees:
//   - writes are atomic (tmp file + rename) so a crash mid-write can never leave
//     a truncated/empty store behind;
//   - the previous good copy is kept as `<file>.bak` (when `backup` is on) so a
//     corrupt primary can be recovered transparently on the next read;
//   - a corrupt file that cannot be recovered is quarantined as
//     `<file>.corrupt-<timestamp>` instead of being overwritten by the next save.

const fs = require("node:fs/promises");
const path = require("node:path");

function bakPath(filePath) {
  return `${filePath}.bak`;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function tryParse(text) {
  if (text === null || text === undefined) return { ok: false, empty: true };
  if (!String(text).trim()) return { ok: false, empty: true };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, empty: false };
  }
}

async function quarantine(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${filePath}.corrupt-${stamp}`;
  try {
    await fs.copyFile(filePath, dest);
    console.error(`[jsonFile] ${path.basename(filePath)} is corrupt — preserved a copy at ${dest}`);
  } catch (err) {
    console.error(`[jsonFile] failed to quarantine corrupt ${filePath}:`, err.message);
  }
  return dest;
}

/**
 * Read and parse a JSON store file.
 *
 * - Missing or empty file → `fallback`.
 * - Corrupt file → try `<file>.bak`; if it parses, return it (and log). If it
 *   doesn't, quarantine the corrupt file and return `fallback`. In both cases
 *   the original bytes are never destroyed by a subsequent write.
 */
async function readJsonFile(filePath, fallback) {
  const primary = tryParse(await readIfExists(filePath));
  if (primary.ok) return primary.data;
  if (primary.empty) return fallback;

  const backup = tryParse(await readIfExists(bakPath(filePath)));
  if (backup.ok) {
    console.warn(`[jsonFile] ${path.basename(filePath)} is corrupt — recovered from .bak`);
    await quarantine(filePath);
    return backup.data;
  }
  await quarantine(filePath);
  return fallback;
}

/**
 * Atomically write JSON to `filePath`. When `backup` is true (default) the
 * current contents are first copied to `<file>.bak` so there is always one
 * prior good generation on disk.
 */
async function writeJsonAtomic(filePath, data, { backup = true } = {}) {
  const text = JSON.stringify(data, null, 2);
  if (backup) {
    try {
      const current = await readIfExists(filePath);
      // Only promote a parseable, non-empty primary to .bak — never overwrite a
      // good .bak with a corrupt primary.
      if (tryParse(current).ok) {
        await fs.copyFile(filePath, bakPath(filePath));
      }
    } catch (err) {
      console.warn(`[jsonFile] backup of ${path.basename(filePath)} failed:`, err.message);
    }
  }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, filePath);
}

/**
 * Take a once-per-day snapshot of the given store files into
 * `<baseDir>/backups/<YYYY-MM-DD>/`, keeping the newest `keep` days.
 * Best-effort: never throws.
 */
async function snapshotDaily(baseDir, fileNames, { keep = 7, now = new Date() } = {}) {
  const backupsDir = path.join(baseDir, "backups");
  const day = now.toISOString().slice(0, 10);
  const dayDir = path.join(backupsDir, day);
  try {
    await fs.mkdir(dayDir, { recursive: true });
    for (const name of fileNames) {
      const src = path.join(baseDir, name);
      const dest = path.join(dayDir, name);
      try {
        await fs.access(dest);
        continue; // already snapshotted today
      } catch { /* not yet */ }
      const text = await readIfExists(src);
      if (!tryParse(text).ok) continue; // don't snapshot empty/corrupt data
      await fs.writeFile(dest, text, "utf8");
    }
    const entries = (await fs.readdir(backupsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    const stale = entries.slice(0, Math.max(0, entries.length - keep));
    for (const name of stale) {
      await fs.rm(path.join(backupsDir, name), { recursive: true, force: true });
    }
    return dayDir;
  } catch (err) {
    console.warn("[jsonFile] daily snapshot failed:", err.message);
    return null;
  }
}

module.exports = { readJsonFile, writeJsonAtomic, snapshotDaily };
