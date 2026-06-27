"use strict";
const { buildPublishState } = require("../shared/publishState");

/**
 * @param {object} record build or comp
 * @param {"Build"|"Comp"} noun
 * @returns {string|null} rejection message, or null if shareable
 */
function shareRejectionReason(record, noun) {
  const r = record || {};
  if (!r.publishedFileId || !r.publishedKey) {
    return `${noun} must be published before sharing`;
  }
  const { stale } = buildPublishState(r);
  if (stale) {
    return `${noun} has unpublished changes — publish again before sharing.`;
  }
  return null;
}

module.exports = { shareRejectionReason };
