"use strict";
const { publishStatus, compPublishStatus } = require("../shared/publishState");

/**
 * @param {object} record build or comp, annotated with contentHash by main
 * @param {"Build"|"Comp"} noun
 * @param {(id: string) => object|undefined} [buildOf] comps only: resolves
 *   member builds (annotated) so a changed member blocks sharing too
 * @returns {string|null} rejection message, or null if shareable
 */
function shareRejectionReason(record, noun, buildOf) {
  const r = record || {};
  if (!r.publishedFileId || !r.publishedKey) {
    return `${noun} must be published before sharing`;
  }
  const status = buildOf ? compPublishStatus(r, buildOf).status : publishStatus(r);
  if (status === "stale") {
    return `${noun} has unpublished changes — publish again before sharing.`;
  }
  return null;
}

module.exports = { shareRejectionReason };
