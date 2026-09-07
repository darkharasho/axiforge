"use strict";

// How often a verbatim document is written instead of a patch. Reconstruction
// never walks more than this many lines; raising it shrinks files and
// lengthens the walk.
const KEYFRAME_INTERVAL = 20;

// Successive edits by the same author and source inside this window merge into
// one version instead of appending a new one.
const COALESCE_WINDOW_MS = 5 * 60 * 1000;

// How much of a log's tail is read to locate the final newline on a cold start.
const TAIL_BYTES = 65536;

// Changed by every save; excluded from ops entirely, otherwise every save would
// log a version and defeat the zero-ops rule. Keyframes still carry them.
const IGNORED_FIELDS = ["updatedAt", "version"];

// A change here is a real edit worth a summary line. `slot` is the comp-side
// op (a party slot swapped) — see history/diffComp.js; the build differ never
// emits one.
const SUBSTANTIVE_OPS = ["skill", "trait", "spec", "gear", "stat", "consumable", "field", "raw", "slot"];

// A change here is bookkeeping: it is logged (a folder move matters in a shared
// folder feed) but it is not a build edit and gets its own phrasing. The trash
// and archive batch keys travel with the stamps they belong to.
const INCIDENTAL_PATHS = [
  "folderId",
  "compIds",
  "archivedAt",
  "deletedAt",
  "trashBatchId",
  "trashRoot",
  "archiveBatchId",
  "archiveRoot",
];

// Bookkeeping that rides along with a build without being part of it: sort
// position, pin state, publish receipts, timestamps. These round-trip as
// `derived` ops, so a change here on its own never writes a version — publishing
// a build or reordering the library is not an edit to the build.
const NON_VERSIONED_PATHS = [
  "sortOrder",
  "pinned",
  "publishedSlug",
  "publishedFileId",
  "publishedKey",
  "publishedAt",
  "publishedOwner",
  "buildUrl",
  "createdAt",
  "activeLegendSlot",
];

module.exports = {
  KEYFRAME_INTERVAL,
  COALESCE_WINDOW_MS,
  TAIL_BYTES,
  IGNORED_FIELDS,
  SUBSTANTIVE_OPS,
  INCIDENTAL_PATHS,
  NON_VERSIONED_PATHS,
};
