"use strict";

const pako = require("pako");
const { base64urlEncode, base64urlDecode } = require("./base64url");
const { encodeShareCode, decodeShareCode } = require("./index");

const COMP_PREFIX = "<AxiForge:Comp:";
const COMP_SUFFIX = ">";

function isValidCompCode(text) {
  if (typeof text !== "string") return false;
  if (!text.startsWith(COMP_PREFIX) || !text.endsWith(COMP_SUFFIX)) return false;
  const payload = text.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
  return payload.length > 0;
}

function extractPayload(shareCode) {
  const firstColon = shareCode.indexOf(":");
  const secondColon = shareCode.indexOf(":", firstColon + 1);
  return shareCode.slice(secondColon + 1, -1);
}

function encodeCompCode(comp, builds) {
  const payloadToIndex = new Map();
  const buildPayloads = [];
  const buildIdToIndex = new Map();

  const referencedIds = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const buildId of (line.slots || [])) {
      referencedIds.add(buildId);
    }
  }

  for (const buildId of referencedIds) {
    const build = builds[buildId] || (Array.isArray(builds) ? builds.find((b) => b.id === buildId) : null);
    if (!build) return null;

    let code;
    try {
      code = encodeShareCode(build);
    } catch {
      return null;
    }

    const payload = extractPayload(code);
    if (!payloadToIndex.has(payload)) {
      payloadToIndex.set(payload, buildPayloads.length);
      buildPayloads.push(payload);
    }
    buildIdToIndex.set(buildId, payloadToIndex.get(payload));
  }

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
      while (slots.length < capacity) slots.push(-1);
      return { c: capacity, s: slots };
    }),
  };

  const json = JSON.stringify(schema);
  const compressed = pako.deflate(json);
  const b64 = base64urlEncode(compressed);

  return `${COMP_PREFIX}${b64}${COMP_SUFFIX}`;
}

const MAX_DECODED_SIZE = 1024 * 1024;

function decodeCompCode(code) {
  if (!isValidCompCode(code)) return null;

  try {
    const b64 = code.slice(COMP_PREFIX.length, -COMP_SUFFIX.length);
    const compressed = base64urlDecode(b64);
    const inflated = pako.inflate(compressed);

    if (inflated.length > MAX_DECODED_SIZE) return null;

    const jsonStr = new TextDecoder().decode(inflated);
    const schema = JSON.parse(jsonStr);
    if (schema.v !== 1) return null;

    const decodedBuilds = [];
    const failedIndices = new Set();
    for (let i = 0; i < (schema.b || []).length; i++) {
      const payload = schema.b[i];
      try {
        const fullCode = `<AxiForge:Build:${payload}>`;
        const build = decodeShareCode(fullCode);
        decodedBuilds.push(build);
      } catch {
        decodedBuilds.push(null);
        failedIndices.add(i);
      }
    }

    const partyLines = (schema.p || []).map((line) => {
      const capacity = Math.max(1, Math.min(50, typeof line.c === "number" ? line.c : 5));
      const expandedSlots = [];
      for (const idx of (line.s || [])) {
        if (idx === -1 || idx < 0 || idx >= decodedBuilds.length || decodedBuilds[idx] === null) {
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

module.exports = { isValidCompCode, encodeCompCode, decodeCompCode };
