"use strict";

/**
 * Derive publish gating state for a build or comp record.
 * Legacy records (publishedAt == null) are treated as fresh, never stale.
 * @param {{publishedFileId?: string, updatedAt?: string, publishedAt?: string|null}} record
 * @returns {{neverPublished: boolean, stale: boolean, shareable: boolean}}
 */
function buildPublishState(record) {
  const r = record || {};
  const neverPublished = !r.publishedFileId;
  const stale = Boolean(r.publishedAt) && r.updatedAt !== r.publishedAt;
  const shareable = !neverPublished && !stale;
  return { neverPublished, stale, shareable };
}

module.exports = { buildPublishState };
