"use strict";

// How often a verbatim document is written instead of a patch. Reconstruction
// never walks more than this many lines; raising it shrinks files and
// lengthens the walk.
//
// This used to be 20, back when logs grew without bound and a keyframe was the
// only thing stopping the walk from getting long. The cap below changed that:
// pruning rewrites a log with a freshly materialized keyframe at its head, so
// the walk is bounded by MAX_VERSIONS rather than by this number, and periodic
// keyframes are nearly redundant. What they still buy is blast radius — a line
// that fails to parse costs every version back to the previous keyframe — so
// this stays finite rather than going away.
const KEYFRAME_INTERVAL = 100;

// Successive edits by the same author and source inside this window merge into
// one version instead of appending a new one.
//
// Only comps use this. A build is saved by an explicit click, so every version
// already corresponds to a decision the user made, and merging two of them
// destroys the middle state: setting an enrichment and then changing it again
// inside the window left one op reading `(none) -> the second one`, with the
// first nowhere on disk. Comps DO autosave — the notes textarea writes on a
// debounce — so without this, typing a paragraph would log a version per
// pause. See `coalesce` in historyStore.js's constructor.
const COALESCE_WINDOW_MS = 5 * 60 * 1000;

// How many versions a record keeps. Older ones are pruned.
//
// History here is an undo net — "I changed something I did not mean to" — not
// an archive, so the recent past is the useful part and the rest is weight.
//
// A count, deliberately, rather than an age. Age deletes the wrong thing: a
// record left untouched for a month and then edited by mistake would have
// every one of its versions fall outside the window at exactly the moment one
// was needed. A count guarantees the last MAX_VERSIONS are always there,
// however long ago they happened. It also keeps the clock out of the store
// entirely, which is why nothing here needs a fake timer to test, and it keeps
// the tail — the delete keyframe "Bring it back" reconstructs from — safe by
// construction.
const MAX_VERSIONS = 150;

// How many appends to a record pass before the store checks whether that
// record needs pruning.
//
// A prune reads the whole log, which is exactly the cost `appendVersion` is
// built to avoid paying on an ordinary save, so it is amortized: one read per
// this many saves, and a live log sits at no more than
// MAX_VERSIONS + PRUNE_CHECK_INTERVAL between checks. The startup sweep is the
// other half — it catches logs that grew in an earlier session, and logs whose
// record is gone and will never be appended to again.
const PRUNE_CHECK_INTERVAL = 25;

// How much of a log's tail is read to locate the final newline on a cold start.
const TAIL_BYTES = 65536;

// How many records keep a memoized reconstruction of their own tail, so a save
// does not re-read the whole log to find its diff base. Two documents are held
// per record (the tail and the one before it, which is what coalescing needs),
// so this bounds the memo at 2 x this many documents — comps run ~2 MB each,
// which is why it is small. An editing session touches one or two records.
const DOC_CACHE_RECORDS = 8;

// How many numbered alternatives the v1 migration will try before giving up on
// retiring its source file. `<file>.pre-v2` is the user's only undo copy, so it
// is never overwritten: a second migration takes `.pre-v2.1`, a third `.pre-v2.2`.
const PRE_V2_ALTERNATES = 32;

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
  MAX_VERSIONS,
  PRUNE_CHECK_INTERVAL,
  TAIL_BYTES,
  DOC_CACHE_RECORDS,
  PRE_V2_ALTERNATES,
  IGNORED_FIELDS,
  SUBSTANTIVE_OPS,
  INCIDENTAL_PATHS,
  NON_VERSIONED_PATHS,
};
