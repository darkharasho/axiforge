"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { readJsonFile } = require("../jsonFile");
const { PRE_V2_ALTERNATES } = require("./constants");

/**
 * One-shot migration of v1 build/comp history into the v2 append-only logs.
 *
 * v1 kept ONE file (`build-history.json` / `comp-history.json`) holding, per
 * record, a newest-first array of entries. Each entry carried a full 22 KB
 * `snapshot` of the document *before* its own change, and the array was capped
 * at 50. v2 keeps one JSONL log per record holding structural diffs, uncapped.
 *
 * ## The chronology, which is the whole difficulty
 *
 * v1 entries are newest-first and each `snapshot` is the state BEFORE that
 * entry's change. So for `e₁…eₙ` (newest → oldest):
 *
 *   - `eₙ.snapshot` is the OLDEST state the record was ever seen in. It has no
 *     entry of its own — nothing in v1 describes how it came to be — so it
 *     becomes v1 of the new log, a keyframe summarised "Created".
 *   - the change recorded by `eₖ` produced `eₖ₋₁.snapshot`.
 *   - the change recorded by `e₁` produced the CURRENT live document.
 *
 * Reading that forwards: walk the array BACKWARDS, and version `k+1` is the
 * state that entry `oₖ` (in oldest-first order) *produced*, and therefore
 * carries `oₖ`'s timestamp and author — not `oₖ`'s own snapshot, which is the
 * state it left behind. Getting this off by one produces a history that looks
 * plausible and attributes every change to the wrong person.
 *
 * ## Summaries are recomputed, not copied
 *
 * 48% of real v1 entries (63 of 131 in the measured profile) say the literal
 * string "build updated" — the old summariser's fallback, paid for with a full
 * snapshot. Feeding each state transition back through `diff` +
 * `renderSummary` turns those into real descriptions, and "build updated" is
 * not a reachable output of the new renderer.
 *
 * ## Failure is expected and never fatal
 *
 * This runs during `init()`, and history must never block app launch. Every
 * failure path logs and degrades: a record whose array is unusable is unlinked
 * and re-seeded from the live document so the user keeps a working (if empty)
 * history rather than a half-written log; the function as a whole cannot
 * reject.
 *
 * The source file is RENAMED to `<fileName>.pre-v2`, never deleted, and only
 * after every record has been attempted. That rename is both the "already
 * migrated" marker and the user's undo.
 */

/** ts for the origin keyframe: the state's own stamp beats the entry's. */
function originTs(snapshot, entry) {
  return (
    (snapshot && (snapshot.updatedAt || snapshot.createdAt)) ||
    (entry && entry.timestamp) ||
    new Date().toISOString()
  );
}

function docTs(doc) {
  return (doc && (doc.updatedAt || doc.createdAt)) || new Date().toISOString();
}

/**
 * v1 files are objects keyed by record id, and only ever that: the pre-v2
 * `HistoryStore.#readAll` coerced anything that was not a plain object — an
 * array included — to `{}`, so no other shape could reach disk.
 */
function toRecordMap(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return new Map(Object.entries(data));
}

/** Has this record already been migrated? One entry is enough to say yes. */
async function hasLog(store, recordId) {
  const { versions } = await store.listVersions(recordId, { limit: 1 });
  return versions.length > 0;
}

/**
 * @param {{baseDir: string, store: import("../historyStore").HistoryStore,
 *          fileName: string, liveDocs?: Map<string, object>}} input
 * @returns {Promise<{migrated: number, failed: number, skipped: boolean,
 *                    retired: boolean, entries: number, versioned: number,
 *                    derivedOnly: number, dropped: number}>}
 *
 * `migrated` and `failed` count RECORDS. `entries`, `versioned`,
 * `derivedOnly` and `dropped` count v1 ENTRIES, and every entry lands in
 * exactly one of the last three:
 *
 *     versioned + derivedOnly + dropped === entries
 *
 * (The origin keyframe is deliberately outside that sum: it is the state
 * before the oldest entry's change, so no entry produced it.)
 */
async function migrateV1(input) {
  const { baseDir, store, fileName, liveDocs } = input || {};
  const result = {
    migrated: 0, failed: 0, skipped: true, retired: true,
    entries: 0, versioned: 0, derivedOnly: 0, dropped: 0,
  };
  if (!baseDir || !store || !fileName) return result;

  const filePath = path.join(baseDir, fileName);
  try {
    // `null` covers absent (fresh install), already-migrated (renamed away),
    // and corrupt-beyond-recovery — jsonFile quarantines that last one for us.
    const data = await readJsonFile(filePath, null);
    const records = toRecordMap(data);
    if (!records || records.size === 0) {
      // Nothing usable, but the file may still be sitting there (empty object,
      // or corrupt and already quarantined). Move it aside so the next launch
      // does not re-read and re-quarantine it forever.
      result.retired = await retire(filePath);
      return result;
    }

    result.skipped = false;
    const live = liveDocs instanceof Map ? liveDocs : new Map();

    for (const [recordId, value] of records) {
      const count = Array.isArray(value) ? value.length : 0;
      // The real idempotence guard. The source file's absence is NOT a
      // reliable already-migrated signal — a failed rename, or a profile
      // restored from backup, puts it back, and re-running then appends the
      // whole chain a second time onto a log that already ends at the live
      // document. The result reads as history running backwards: the
      // duplicate v1-state lands ABOVE the live state, dated older.
      try {
        if (await hasLog(store, recordId)) {
          result.entries += count;
          result.dropped += count;
          continue;
        }
      } catch (err) {
        // Even the guard degrades rather than throws; a record we cannot ask
        // about is safer left alone than migrated twice.
        console.error(`[migrateV1] could not check existing history for ${recordId}:`, err && err.message);
        result.entries += count;
        result.dropped += count;
        continue;
      }

      const before = {
        entries: result.entries, versioned: result.versioned,
        derivedOnly: result.derivedOnly, dropped: result.dropped,
      };
      try {
        const wrote = await migrateRecord({ store, recordId, value, liveDoc: live.get(recordId), tally: result });
        if (wrote) result.migrated += 1;
      } catch (err) {
        result.failed += 1;
        console.warn(`[migrateV1] ${fileName} record ${recordId} could not be migrated:`, err && err.message);
        // The record's log is about to be thrown away, so nothing it counted
        // survives: roll its entries back into `dropped` and keep the sum true.
        const seen = result.entries - before.entries;
        result.versioned = before.versioned;
        result.derivedOnly = before.derivedOnly;
        result.dropped = before.dropped + seen;
        await reseed(store, recordId, live.get(recordId));
      }
    }

    // Only now, with every record attempted, is the old file safe to retire.
    result.retired = await retire(filePath);
    console.log(
      `[migrateV1] ${fileName}: ${result.migrated} records migrated, ${result.failed} failed`
      + ` — ${result.entries} entries (${result.versioned} versioned, ${result.derivedOnly} no-change,`
      + ` ${result.dropped} dropped)`
    );
    return result;
  } catch (err) {
    console.error(`[migrateV1] ${fileName} migration failed:`, err && err.message);
    return result;
  }
}

/**
 * Replay one record oldest-first, tallying into `tally`. Throws on an unusable
 * record so the caller can count it and re-seed; every other outcome is a
 * normal result. Returns whether anything was written.
 */
async function migrateRecord({ store, recordId, value, liveDoc, tally }) {
  if (!Array.isArray(value)) throw new Error(`expected an array of entries, got ${typeof value}`);
  tally.entries += value.length;

  // Newest-first on disk → oldest-first here. Entries with no snapshot are
  // pre-snapshot legacy rows: they name a change we cannot reconstruct, so
  // they are dropped rather than allowed to abort the record.
  const ordered = value.filter((e) => e && e.snapshot && typeof e.snapshot === "object").reverse();
  tally.dropped += value.length - ordered.length;
  if (ordered.length === 0) return false;

  const { diff, classify } = store.differ;

  // v1: the oldest state, which no entry describes. A keyframe, "Created".
  //
  // It takes the author and source of `first` — the entry that changed AWAY
  // from this state, not into it. That is deliberate: v1 records a state whose
  // own author v1 never stored, and the entry that superseded it is the only
  // name attached to it anywhere. Its `ts` comes from the snapshot's own
  // `updatedAt` where there is one, so the origin is dated when it was
  // written rather than when it was replaced. Do not "fix" this to `first`'s
  // timestamp; that would date the origin to the moment it ended.
  const first = ordered[0];
  const seeded = await store.appendVersion({
    recordId,
    after: first.snapshot,
    author: first.authorLogin || "local",
    source: first.source || "local",
    ts: originTs(first.snapshot, first),
    coalesce: false,
  });
  if (!seeded) throw new Error("could not write the origin keyframe");

  // What the chain currently holds, so each entry can be classified against
  // the same base the store will diff against.
  let base = first.snapshot;

  // Each entry produced the NEXT state — the following entry's snapshot, or,
  // for the newest entry, the live document.
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    const after = i + 1 < ordered.length ? ordered[i + 1].snapshot : liveDoc;
    // The newest entry with no live document: the build is gone (deleted, or
    // never in this profile). Its snapshot is already stored as the version
    // before it, so the chain simply ends here and the entry produced nothing.
    if (!after) {
      tally.dropped += 1;
      break;
    }

    // Classify the transition OURSELVES rather than reading it off
    // appendVersion's return. `null` from the store means either "nothing
    // worth recording" or "the write failed and degraded", and those must not
    // be reported to the user as the same thing: the second is a lost version.
    // IGNORED_FIELDS never reach ops, so diffing our own `base` and diffing
    // the store's reconstructed tail give the same op list.
    const { substantive, incidental } = classify(diff(base, after));
    const noChange = substantive.length === 0 && incidental.length === 0;

    const written = await store.appendVersion({
      recordId,
      after,
      author: entry.authorLogin || "local",
      source: entry.source || "local",
      ts: entry.timestamp,
      coalesce: false,
    });

    if (written) {
      tally.versioned += 1;
      base = after;
    } else if (noChange) {
      // A publish receipt, a sort order, an `updatedAt`-only save. v2
      // deliberately does not log those; the entry contributes no version.
      // The chain's base is unchanged, because nothing was appended.
      tally.derivedOnly += 1;
    } else {
      throw new Error(
        `version for entry ${entry.id} was not written despite`
        + ` ${substantive.length} substantive / ${incidental.length} incidental ops`
      );
    }
  }
  return true;
}

/**
 * A record that blew up leaves a partial log describing a chain that never
 * happened. Delete it and start the record's history at the live document, so
 * the user gets a correct empty history instead of a wrong populated one.
 */
async function reseed(store, recordId, liveDoc) {
  try {
    await store.deleteHistory(recordId);
    if (!liveDoc) return;
    await store.appendVersion({
      recordId,
      after: liveDoc,
      ts: docTs(liveDoc),
      coalesce: false,
    });
  } catch (err) {
    console.warn(`[migrateV1] could not re-seed record ${recordId}:`, err && err.message);
  }
}

/**
 * Rename, never delete, and never OVER: the old file is the user's only undo.
 *
 * `.pre-v2` may already exist — downgrade to a pre-v2 build, use it, upgrade
 * again, and there is a second v1 file to retire. Renaming onto the first one
 * would destroy the copy the user could still go back to, so each retirement
 * takes a name nobody has: `.pre-v2`, then `.pre-v2.1`, `.pre-v2.2`, ...
 *
 * The name is CLAIMED with an exclusive create rather than checked with a stat,
 * so two processes racing at startup cannot both decide the same name is free.
 *
 * Returns whether the file is retired — true when it was renamed, and true
 * when it was already gone, which is the same end state. A failure returns
 * false and logs at error level: the undo file the user was promised does not
 * exist, and a caller that reports success regardless is lying. It still never
 * throws, because `init()` is downstream.
 */
async function retire(filePath) {
  const base = `${filePath}.pre-v2`;
  let lastErr = null;
  for (let i = 0; i <= PRE_V2_ALTERNATES; i += 1) {
    const target = i === 0 ? base : `${base}.${i}`;
    let claimed;
    try {
      // "wx" fails with EEXIST if anything is already there, atomically.
      claimed = await fs.open(target, "wx");
    } catch (err) {
      if (err && (err.code === "EEXIST" || err.code === "EISDIR")) continue;
      lastErr = err;
      break;
    }
    await claimed.close();
    try {
      // Renames over our own empty placeholder, which is the point of claiming.
      await fs.rename(filePath, target);
      return true;
    } catch (err) {
      // Leave no 0-byte decoy behind for the user to find.
      await fs.unlink(target).catch(() => {});
      if (err && err.code === "ENOENT") return true;
      lastErr = err;
      break;
    }
  }
  console.error(
    `[migrateV1] could not retire ${filePath} to ${path.basename(base)} —`
    + ` the pre-v2 undo copy was NOT created:`,
    lastErr ? lastErr.message : `every name up to .${PRE_V2_ALTERNATES} is taken`
  );
  return false;
}

module.exports = { migrateV1 };
