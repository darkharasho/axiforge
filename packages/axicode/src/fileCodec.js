"use strict";

const zlib = require("zlib");

const CURRENT_VERSION = 1;

function encodeAxicodeFile({ builds = [], folders = [], comps = [] }) {
  const payload = {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    builds,
    folders,
    comps,
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
}

function decodeAxicodeFile(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Expected a Buffer");
  }

  let decompressed;
  try {
    decompressed = zlib.gunzipSync(buffer);
  } catch {
    throw new Error("Not a valid .axicode file: decompression failed");
  }

  let data;
  try {
    data = JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new Error("Not a valid .axicode file: invalid JSON");
  }

  if (typeof data.version !== "number") {
    throw new Error("Not a valid .axicode file: missing version");
  }
  if (data.version > CURRENT_VERSION) {
    throw new Error(
      "This .axicode file was created with a newer version of AxiForge. Please update to import it.",
    );
  }

  return {
    version: data.version,
    exportedAt: data.exportedAt || null,
    builds: Array.isArray(data.builds) ? data.builds : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
    comps: Array.isArray(data.comps) ? data.comps : [],
  };
}

function isValidAxicodeFile(buffer) {
  try {
    decodeAxicodeFile(buffer);
    return true;
  } catch {
    return false;
  }
}

module.exports = { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile };
