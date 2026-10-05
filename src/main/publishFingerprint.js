"use strict";

const crypto = require("node:crypto");

// Everything on a normalized build that is NOT on its published page: identity,
// timestamps, the publish receipt itself, and this machine's library
// bookkeeping. An exclusion list rather than an allowlist, so a content field
// added to normalizeBuild later counts as content without anyone remembering to
// add it here. activeLegendSlot is a view toggle (history treats it as
// bookkeeping too); contentHash is what main attaches for the renderer.
const BUILD_NON_CONTENT = new Set([
  "id", "version", "createdAt", "updatedAt", "buildUrl",
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner", "publishedHash",
  "folderId", "compIds", "pinned", "sortOrder",
  "deletedAt", "trashBatchId", "trashRoot", "archivedAt", "archiveBatchId", "archiveRoot",
  "activeLegendSlot", "contentHash",
]);

// Keys sorted at every depth and undefined dropped, so two machines holding the
// same record hash it the same no matter how it was assembled.
function stable(value) {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : stable(v)));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

function hashOf(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 16);
}

/** Fingerprint of a normalized build's published-page content. */
function buildFingerprint(build) {
  const projection = {};
  for (const [key, value] of Object.entries(build || {})) {
    if (!BUILD_NON_CONTENT.has(key)) projection[key] = value;
  }
  return hashOf(projection);
}

/**
 * Fingerprint of a comp's OWN page fields. Member builds are receipted
 * separately (publishedMemberHashes) so the renderer can tell a comp edit from
 * a member edit. Absent fields hash as upsertComp's defaults, and party-line
 * ids are left out: they are not shown, and legacy lines get fresh ones on save.
 */
function compFingerprint(comp) {
  const c = comp || {};
  return hashOf({
    name: c.name || "",
    notes: c.notes || "",
    images: c.images || {},
    tags: c.tags || [],
    buildIds: c.buildIds || [],
    partyLines: (c.partyLines || []).map((line) => ({
      capacity: typeof line?.capacity === "number" ? line.capacity : 5,
      slots: Array.isArray(line?.slots) ? line.slots : [],
    })),
    gameMode: c.gameMode || null,
    buildColors: c.buildColors || {},
    categories: c.categories || [],
  });
}

function memberHashes(builds) {
  const out = {};
  for (const b of builds || []) out[b.id] = buildFingerprint(b);
  return out;
}

function buildReceipt(build) {
  return { publishedHash: buildFingerprint(build) };
}

function compReceipt(comp, memberBuilds) {
  return { publishedHash: compFingerprint(comp), publishedMemberHashes: memberHashes(memberBuilds) };
}

/**
 * Receipt for a comp a build publish re-uploaded, or null when that upload left
 * a member out (it failed to enrich): the page is incomplete, so the comp must
 * keep reading out of date.
 */
function compReceiptAfterRepublish(comp, includedBuilds, skippedIds) {
  if (skippedIds && skippedIds.length) return null;
  return compReceipt(comp, includedBuilds);
}

function annotateBuild(build) {
  return build ? { ...build, contentHash: buildFingerprint(build) } : build;
}

function annotateComp(comp) {
  return comp ? { ...comp, contentHash: compFingerprint(comp) } : comp;
}

// Team-sync events hand the renderer a freshly pulled record that it splices
// straight into state, bypassing the list handlers that normally annotate.
function annotateSyncEvent(data) {
  if (!data || !data.item) return data;
  if (data.type === "build") return { ...data, item: annotateBuild(data.item) };
  if (data.type === "comp") return { ...data, item: annotateComp(data.item) };
  return data;
}

module.exports = {
  buildFingerprint,
  compFingerprint,
  memberHashes,
  buildReceipt,
  compReceipt,
  compReceiptAfterRepublish,
  annotateBuild,
  annotateComp,
  annotateSyncEvent,
};
