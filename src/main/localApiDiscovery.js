"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Discovery file for the local API. AxiVale (and other Axi apps) read this to
// find the port and per-launch bearer token. It lives next to builds.json, so
// it is exactly as private as the user's build data.
function discoveryFilePath(dataDir) {
  return path.join(dataDir, "local-api.json");
}

// Atomic write (tmp + rename), same pattern as BuildStore#writeJson, so a
// reader never sees a partially-written file. Mode 0o600 keeps the token
// owner-readable only. On Windows the mode option is a no-op; the file falls back to default ACLs.
async function writeDiscoveryFile(dataDir, info) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  const target = discoveryFilePath(dataDir);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(info, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(tmp, target);
}

// Synchronous removal — called from app "will-quit", where async work is not
// guaranteed to complete before the process exits.
function removeDiscoveryFileSync(dataDir) {
  try {
    fs.unlinkSync(discoveryFilePath(dataDir));
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn("[local-api] failed to remove discovery file:", err.message);
    }
  }
}

module.exports = { discoveryFilePath, writeDiscoveryFile, removeDiscoveryFileSync };
