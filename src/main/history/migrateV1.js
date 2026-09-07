"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { readJsonFile } = require("../jsonFile");

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
 * v1 files are objects keyed by record id. A flat array is accepted too and
 * grouped by `idField` — that is the only thing `idField` is for here, and it
 * costs nothing to tolerate.
 */
function toRecordMap(data, idField) {
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data)) return new Map(Object.entries(data));
  const out = new Map();
  for (const entry of data) {
    const id = entry && entry[idField];
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(entry);
  }
  return out;
}

/**
 * @param {{baseDir: string, store: import("../historyStore").HistoryStore,
 *          fileName: string, idField: string,
 *          liveDocs?: Map<string, object>}} input
 * @returns {Promise<{migrated: number, failed: number, skipped: boolean,
 *                    entries: number, derivedOnly: number}>}
 */
async function migrateV1(input) {
  const { baseDir, store, fileName, idField, liveDocs } = input || {};
  const result = { migrated: 0, failed: 0, skipped: true, entries: 0, derivedOnly: 0 };
  if (!baseDir || !store || !fileName) return result;

  const filePath = path.join(baseDir, fileName);
  try {
    // `null` covers absent (fresh install), already-migrated (renamed away),
    // and corrupt-beyond-recovery — jsonFile quarantines that last one for us.
    const data = await readJsonFile(filePath, null);
    const records = toRecordMap(data, idField);
    if (!records || records.size === 0) {
      // Nothing usable, but the file may still be sitting there (empty object,
      // or corrupt and already quarantined). Move it aside so the next launch
      // does not re-read and re-quarantine it forever.
      await retire(filePath);
      return result;
    }

    result.skipped = false;
    const live = liveDocs instanceof Map ? liveDocs : new Map();

    for (const [recordId, value] of records) {
      try {
        const counts = await migrateRecord({ store, recordId, value, liveDoc: live.get(recordId) });
        result.entries += counts.entries;
        result.derivedOnly += counts.derivedOnly;
        if (counts.wrote) result.migrated += 1;
      } catch (err) {
        result.failed += 1;
        console.warn(`[migrateV1] ${fileName} record ${recordId} could not be migrated:`, err && err.message);
        await reseed(store, recordId, live.get(recordId));
      }
    }

    // Only now, with every record attempted, is the old file safe to retire.
    await retire(filePath);
    return result;
  } catch (err) {
    console.error(`[migrateV1] ${fileName} migration failed:`, err && err.message);
    return result;
  }
}

/**
 * Replay one record oldest-first. Throws on an unusable record so the caller
 * can count it and re-seed; every other outcome is a normal result.
 */
async function migrateRecord({ store, recordId, value, liveDoc }) {
  if (!Array.isArray(value)) throw new Error(`expected an array of entries, got ${typeof value}`);

  // Newest-first on disk → oldest-first here. Entries with no snapshot are
  // pre-snapshot legacy rows: they name a change we cannot reconstruct, so
  // they are dropped rather than allowed to abort the record.
  const ordered = value.filter((e) => e && e.snapshot && typeof e.snapshot === "object").reverse();
  const counts = { entries: ordered.length, derivedOnly: 0, wrote: false };
  if (ordered.length === 0) return counts;

  // v1: the oldest state, which no entry describes. A keyframe, "Created".
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
  counts.wrote = true;

  // Each entry produced the NEXT state — the following entry's snapshot, or,
  // for the newest entry, the live document.
  for (let i = 0; i < ordered.length; i += 1) {
    const entry = ordered[i];
    const after = i + 1 < ordered.length ? ordered[i + 1].snapshot : liveDoc;
    // The newest entry with no live document: the build is gone (deleted, or
    // never in this profile). Its snapshot is already stored as the version
    // before it, so the chain simply ends here.
    if (!after) break;
    const written = await store.appendVersion({
      recordId,
      after,
      author: entry.authorLogin || "local",
      source: entry.source || "local",
      ts: entry.timestamp,
      coalesce: false,
    });
    // `null` means the transition was derived-only — a publish receipt, a sort
    // order, a `updatedAt` bump. v2 deliberately does not log those, so the
    // entry contributes no version. It is not a failure; it is the point.
    if (!written) counts.derivedOnly += 1;
  }
  return counts;
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

/** Rename, never delete: the old file is the user's only undo. */
async function retire(filePath) {
  try {
    await fs.rename(filePath, `${filePath}.pre-v2`);
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      console.warn(`[migrateV1] could not retire ${filePath}:`, err && err.message);
    }
  }
}

module.exports = { migrateV1 };
