"use strict";

const { needsBaselineReceipt, buildReceipt, compReceipt } = require("./publishFingerprint");

/**
 * Startup backfill: gives every published record that predates publish
 * receipts a baseline one, so an edit after this point reads "Out of date".
 * Builds first, so a comp's member hashes are taken from the same content the
 * builds now carry. Touches only the receipt fields — never updatedAt, never a
 * history version (both are non-versioned bookkeeping).
 */
async function backfillPublishReceipts({ buildStore, compStore }) {
  const builds = await buildStore.backfillReceipts((b) => (needsBaselineReceipt(b) ? buildReceipt(b) : null));
  const byId = new Map((await buildStore.listBuilds()).map((b) => [b.id, b]));
  const comps = await compStore.backfillReceipts((c) => {
    if (!needsBaselineReceipt(c)) return null;
    // A member missing from this library cannot be judged later either, so it
    // is left out rather than guessed.
    const members = (c.buildIds || []).map((id) => byId.get(id)).filter(Boolean);
    return compReceipt(c, members);
  });
  return { builds, comps };
}

module.exports = { backfillPublishReceipts };
