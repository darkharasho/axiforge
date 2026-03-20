"use strict";

const zlib = require("node:zlib");
const { encodeShareCode, decodeShareCode } = require("@mks.haro/axicode");

const COMP_PREFIX = "<AxiForge:Comp:";
const COMP_SUFFIX = ">";

function isValidCompCode(text) {
  if (typeof text !== "string") return false;
  if (!text.startsWith(COMP_PREFIX) || !text.endsWith(COMP_SUFFIX)) return false;
  const payload = text.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
  return payload.length > 0;
}

function extractPayload(shareCode) {
  // "<AxiForge:Label:payload>" → "payload"
  const firstColon = shareCode.indexOf(":");
  const secondColon = shareCode.indexOf(":", firstColon + 1);
  return shareCode.slice(secondColon + 1, -1);
}

function encodeComp(comp, builds) {
  // Encode each unique build, deduplicate by Z85 payload equality
  const payloadToIndex = new Map();
  const buildPayloads = [];
  const buildIdToIndex = new Map();

  // Collect all build IDs referenced in party line slots
  const referencedIds = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const buildId of (line.slots || [])) {
      referencedIds.add(buildId);
    }
  }

  for (const buildId of referencedIds) {
    const build = builds[buildId] || (Array.isArray(builds) ? builds.find((b) => b.id === buildId) : null);
    if (!build) return null; // Build not found — fail the entire encode

    let code;
    try {
      code = encodeShareCode(build);
    } catch {
      return null; // Build failed to encode — fail the entire encode
    }

    const payload = extractPayload(code);
    if (!payloadToIndex.has(payload)) {
      payloadToIndex.set(payload, buildPayloads.length);
      buildPayloads.push(payload);
    }
    buildIdToIndex.set(buildId, payloadToIndex.get(payload));
  }

  // Build the JSON schema
  const schema = {
    v: 1,
    n: String(comp.name || "Untitled Comp").slice(0, 140),
    g: comp.gameMode === "pve" || comp.gameMode === "wvw" ? comp.gameMode : null,
    b: buildPayloads,
    p: (comp.partyLines || []).map((line) => {
      const capacity = typeof line.capacity === "number" ? line.capacity : 5;
      const slots = (line.slots || []).map((id) =>
        buildIdToIndex.has(id) ? buildIdToIndex.get(id) : -1
      );
      // Pad to capacity with -1
      while (slots.length < capacity) slots.push(-1);
      return { c: capacity, s: slots };
    }),
  };

  // JSON → deflate → base64url
  const json = JSON.stringify(schema);
  const compressed = zlib.deflateSync(Buffer.from(json, "utf-8"));
  const base64url = compressed.toString("base64url");

  return `${COMP_PREFIX}${base64url}${COMP_SUFFIX}`;
}

const MAX_DECODED_SIZE = 1024 * 1024; // 1 MB safety limit

function decodeComp(code) {
  if (!isValidCompCode(code)) return null;

  try {
    const base64url = code.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
    const compressed = Buffer.from(base64url, "base64url");
    const inflated = zlib.inflateSync(compressed);

    if (inflated.length > MAX_DECODED_SIZE) return null;

    const schema = JSON.parse(inflated.toString("utf-8"));
    if (schema.v !== 1) return null;

    // Decode each build payload
    const decodedBuilds = [];
    const failedIndices = new Set();
    for (let i = 0; i < (schema.b || []).length; i++) {
      const payload = schema.b[i];
      try {
        // Wrap payload back into share code format for decoding (label is cosmetic)
        const fullCode = `<AxiForge:Build:${payload}>`;
        const build = decodeShareCode(fullCode);
        decodedBuilds.push(build);
      } catch {
        decodedBuilds.push(null);
        failedIndices.add(i);
      }
    }

    // Expand party lines
    const partyLines = (schema.p || []).map((line) => {
      const capacity = Math.max(1, Math.min(50, typeof line.c === "number" ? line.c : 5));
      // Map indices to build references, strip trailing empties
      const expandedSlots = [];
      for (const idx of (line.s || [])) {
        if (idx === -1 || idx < 0 || idx >= decodedBuilds.length || decodedBuilds[idx] === null) {
          // Empty or invalid slot — skip (stripped per spec)
          continue;
        }
        expandedSlots.push(decodedBuilds[idx]);
      }
      return { capacity, slots: expandedSlots };
    });

    const name = String(schema.n || "Untitled Comp").slice(0, 140) || "Untitled Comp";
    const gameMode = schema.g === "pve" || schema.g === "wvw" ? schema.g : null;

    const failedBuildCount = failedIndices.size;

    return {
      name,
      gameMode,
      builds: decodedBuilds.filter((b) => b !== null),
      partyLines,
      failedBuildCount,
    };
  } catch {
    return null;
  }
}

module.exports = { isValidCompCode, encodeComp, decodeComp };
