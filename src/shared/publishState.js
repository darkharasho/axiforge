"use strict";

// The publish receipt: what a record says about its last publish. A history
// document or a duplicated record must not carry these over.
const PUBLISH_RECEIPT_FIELDS = [
  "publishedSlug", "publishedFileId", "publishedKey", "publishedAt", "publishedOwner",
  "publishedHash", "publishedMemberHashes",
];

/**
 * Publish status of a build, or of a comp's own fields.
 *
 * With a hash receipt (publishedHash) the answer is content-derived: main
 * attaches the current fingerprint as contentHash. A record main has not
 * annotated yet reads current until the next list reload. Legacy records,
 * published before receipts existed, fall back to updatedAt vs publishedAt.
 *
 * @returns {"never"|"current"|"stale"}
 */
function publishStatus(record) {
  const r = record || {};
  if (!r.publishedFileId) return "never";
  if (r.publishedHash) {
    if (!r.contentHash) return "current";
    return r.contentHash === r.publishedHash ? "current" : "stale";
  }
  return r.publishedAt && r.updatedAt !== r.publishedAt ? "stale" : "current";
}

/**
 * A comp is also out of date when a member build changed since the comp page
 * was uploaded. A member that is not in the library, or not annotated, cannot
 * be judged and is skipped.
 *
 * @param {object} comp
 * @param {(id: string) => object|undefined} [buildOf]
 * @returns {{status: "never"|"current"|"stale", reason: "self"|"member"|null}}
 */
function compPublishStatus(comp, buildOf) {
  const c = comp || {};
  const status = publishStatus(c);
  if (status !== "current") return { status, reason: status === "stale" ? "self" : null };
  if (c.publishedHash && typeof buildOf === "function") {
    for (const [id, hash] of Object.entries(c.publishedMemberHashes || {})) {
      const member = buildOf(id);
      if (member && member.contentHash && member.contentHash !== hash) {
        return { status: "stale", reason: "member" };
      }
    }
  }
  return { status: "current", reason: null };
}

function withoutPublishReceipt(record) {
  const out = { ...(record || {}) };
  for (const key of PUBLISH_RECEIPT_FIELDS) delete out[key];
  return out;
}

module.exports = { publishStatus, compPublishStatus, withoutPublishReceipt, PUBLISH_RECEIPT_FIELDS };
