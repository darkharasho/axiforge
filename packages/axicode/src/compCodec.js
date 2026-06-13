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

// A party-line slot may be a build id or a category reference ("tag:<id>"). In the
// encoded slot array, build slots are payload indices (>= 0), -1 is an empty slot, and a
// tag slot is stored as -(categoryIndex + 2). Older decoders treat any value < 0 as empty,
// so they simply drop tag slots instead of breaking — forward-compatible by construction.
const TAG_PREFIX = "tag:";
const isTagSlot = (id) => typeof id === "string" && id.startsWith(TAG_PREFIX);

function encodeCompCode(comp, builds) {
  const payloadToIndex = new Map();
  const buildPayloads = [];
  const buildIdToIndex = new Map();

  // Encode every build referenced by a slot or by a category (category members may not
  // appear in any line yet, but must survive the round-trip).
  const referencedIds = new Set();
  for (const line of (comp.partyLines || [])) {
    for (const buildId of (line.slots || [])) {
      if (!isTagSlot(buildId)) referencedIds.add(buildId);
    }
  }
  for (const cat of (comp.categories || [])) {
    for (const buildId of (cat.buildIds || [])) referencedIds.add(buildId);
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

  // Comp-scoped categories, with member builds stored as payload indices.
  const categories = (comp.categories || []).filter((c) => c && c.id);
  const categoryIdToIndex = new Map();
  categories.forEach((c, i) => categoryIdToIndex.set(c.id, i));
  const cat = categories.map((c) => ({
    i: c.id,
    n: String(c.name || "").slice(0, 60),
    ic: typeof c.icon === "string" ? c.icon.slice(0, 2000) : "",
    b: (c.buildIds || [])
      .filter((bid) => buildIdToIndex.has(bid))
      .map((bid) => buildIdToIndex.get(bid)),
  }));

  const schema = {
    v: 1,
    n: String(comp.name || "Untitled Comp").slice(0, 140),
    g: comp.gameMode === "pve" || comp.gameMode === "wvw" ? comp.gameMode : null,
    b: buildPayloads,
    p: (comp.partyLines || []).map((line) => {
      const capacity = typeof line.capacity === "number" ? line.capacity : 5;
      const slots = (line.slots || []).map((id) => {
        if (isTagSlot(id)) {
          const ci = categoryIdToIndex.get(id.slice(TAG_PREFIX.length));
          return ci === undefined ? -1 : -(ci + 2);
        }
        return buildIdToIndex.has(id) ? buildIdToIndex.get(id) : -1;
      });
      while (slots.length < capacity) slots.push(-1);
      return { c: capacity, s: slots };
    }),
    // Only emit `cat` when present, so comps without tags encode byte-identically to before.
    ...(cat.length ? { cat } : {}),
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

    // Categories (optional). Member build indices map back to decoded build objects, so
    // the import layer can remap them to freshly-created build ids by object identity.
    const schemaCats = Array.isArray(schema.cat) ? schema.cat : [];
    const categories = schemaCats.map((c) => ({
      id: typeof c.i === "string" ? c.i : null,
      name: String(c.n || "").slice(0, 60),
      icon: typeof c.ic === "string" ? c.ic : "",
      builds: (Array.isArray(c.b) ? c.b : [])
        .map((idx) => decodedBuilds[idx])
        .filter((b) => b != null),
    }));

    const partyLines = (schema.p || []).map((line) => {
      const capacity = Math.max(1, Math.min(50, typeof line.c === "number" ? line.c : 5));
      const expandedSlots = [];
      for (const idx of (line.s || [])) {
        if (idx <= -2) {
          // Tag slot → category at index (-idx - 2). Carry a marker the import maps to "tag:<id>".
          const cat = schemaCats[-idx - 2];
          if (cat && typeof cat.i === "string") expandedSlots.push({ __tagCategoryId: cat.i });
          continue;
        }
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
      categories,
      failedBuildCount,
    };
  } catch {
    return null;
  }
}

module.exports = { isValidCompCode, encodeCompCode, decodeCompCode };
