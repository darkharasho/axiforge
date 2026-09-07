"use strict";

const { renderOpDetail } = require("./renderSummary");

/**
 * A TRUE diff between any two versions of a record.
 *
 * The renderer used to assemble this itself, by asking `history:get-ops` for
 * every version in `(older, newer]` and concatenating the results. That is a
 * union of edits, not a diff: a value that changed and later changed BACK
 * listed both ops instead of nothing, and a wide span read as churn rather
 * than net change. It also cost one IPC round trip per version in the range.
 *
 * Doing it here costs two reconstructions and one `diff()` call, no matter how
 * far apart the versions are — and it is the same differ that wrote the log,
 * so the compare table and the entry list can never disagree about what an op
 * means.
 *
 * Each op is labelled with `renderOpDetail`, the SAME function `renderSummary`
 * uses for the one-line entry summary. That vocabulary lives here, in
 * CommonJS, and cannot be imported by the ESM renderer; shipping the label as
 * data is what stops the renderer from growing a second copy that drifts.
 *
 * @param {{store: {getVersion: Function},
 *          differ: {diff: Function},
 *          recordId: string, fromV: number|string, toV: number|string,
 *          summaryOpts?: object}} input
 * @returns {Promise<{ops: object[], fromDoc: object|null, toDoc: object|null}>}
 */
async function compareVersions({ store, differ, recordId, fromV, toV, summaryOpts = {} }) {
  const [fromDoc, toDoc] = await Promise.all([
    store.getVersion(recordId, fromV),
    store.getVersion(recordId, toV),
  ]);

  // A version that cannot be reconstructed degrades to "no ops", the way
  // `history:get-ops` does — the caller still gets whichever document it did
  // manage to read, so the modal can show one side and say so.
  if (!fromDoc || !toDoc) {
    return { ops: [], fromDoc: fromDoc || null, toDoc: toDoc || null };
  }

  const ops = differ.diff(fromDoc, toDoc)
    // `derived` ops (icons, tooltips, catalog blobs rewritten by a game patch)
    // round-trip through the log but are nobody's edit.
    .filter((op) => op && op.t !== "derived")
    .map((op) => ({ ...op, label: renderOpDetail(op, summaryOpts) }));

  return { ops, fromDoc, toDoc };
}

module.exports = { compareVersions };
