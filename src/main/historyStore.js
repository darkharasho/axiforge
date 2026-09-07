"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { VersionLog } = require("./history/versionLog");
const { renderSummary } = require("./history/renderSummary");
const {
  KEYFRAME_INTERVAL, COALESCE_WINDOW_MS, DOC_CACHE_RECORDS, MAX_VERSIONS,
} = require("./history/constants");

/**
 * Per-record version history, on disk as one append-only JSONL log per record:
 * `data/history/<subdir>/<recordId>.jsonl`.
 *
 * v1 kept a single JSON file holding a full snapshot per entry, capped at 50
 * entries per record. That cap silently ate a build's origin after fifty saves,
 * and a snapshot per entry made the file grow with the size of the record
 * rather than the size of the change. v2 stores a KEYFRAME every
 * KEYFRAME_INTERVAL versions and a structural PATCH in between, uncapped.
 *
 * Only two things differ per record type — the subdirectory and the differ — so
 * those are the constructor's whole job. What counts as a change lives in the
 * differ (`history/diffBuild.js`, `history/diffComp.js`); how a change is
 * phrased lives in `history/renderSummary.js`.
 *
 * Two invariants hold this together:
 *
 *   1. **The store owns its diff base.** `appendVersion` reconstructs its own
 *      last stored version and diffs THAT against `after`. The caller's
 *      `before` is only consulted when the log is empty. A save that produced
 *      only derived ops writes no version, so the caller's `before` and the
 *      chain's tail drift apart — diffing the caller's `before` would then
 *      write a patch against a state the chain never held, and reconstruction
 *      would silently return the wrong document.
 *   2. **`doc` presence marks a keyframe**, not `kind`. `kind` is the semantic
 *      label ("key", "meta", "delete"); reconstruction only ever asks whether
 *      an entry carries a `doc`. That keeps a delete-keyframe or an
 *      incidental-only keyframe from confusing the walk.
 *
 * Nothing here throws at the caller: every failure path logs and degrades,
 * mirroring `jsonFile.js` and `history/versionLog.js`. History is never worth
 * failing a save over, but a silent loss is worth a line in the log.
 */

function logDegrade(action, detail, err) {
  console.error(`[historyStore] ${action} failed${detail ? ` for ${detail}` : ""}:`, err && err.message);
}

// Record ids reach the filesystem as file names. They are UUIDs today, so this
// is a guard rather than a transformation: anything outside the safe charset
// (a "../" traversal, a NUL, a colon on Windows) is replaced wholesale by a
// stable hash rather than escaped piecemeal.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// What a version says when the store could not read its own previous state.
// The entry is a keyframe, so the record is readable again from here on; what
// it cannot honestly claim is a list of changed fields.
const RECOVERED_SUMMARY = "Snapshot — earlier history could not be read";

function sanitizeId(recordId) {
  const id = String(recordId === null || recordId === undefined ? "" : recordId);
  if (SAFE_ID.test(id)) return id;
  return crypto.createHash("sha1").update(id).digest("hex");
}

// Identity of a log's final entry, cheap to compute from what `lastEntry()`
// already read. Any write this store makes changes `v`, `ts`, or the summary,
// so a memo tagged with a stale fingerprint is never mistaken for a live one.
// This is defence in depth behind the explicit invalidation below — the same
// posture as `versionLog.js`'s `_lastOffset` guard — and it is what catches a
// tail rewritten out of band. `ops` is hashed rather than embedded whole: it
// can be large, and this runs on every save, but an out-of-band rewrite of
// `ops` alone (every other field untouched) must still be caught, or a stale
// memo could hand back a document the record never actually held.
function tailFingerprint(entry) {
  if (!entry) return "";
  const opsHash = crypto.createHash("sha1").update(JSON.stringify(entry.ops === undefined ? null : entry.ops)).digest("hex");
  return [
    entry.v, entry.ts, entry.author, entry.source, entry.kind || "",
    entry.summary || "", entry.doc === undefined ? "p" : "k", opsHash,
  ].join("\u0000");
}

class HistoryStore {
  #writeQueue = Promise.resolve();
  #logs = new Map();
  // name -> { fp, docs: Map<version, document> }. The reconstructed tail (and,
  // for coalescing, the version before it) memoized so an ordinary save costs
  // no `readAll` at all. Correctness comes first: the memo is dropped outright
  // on every write whose result we cannot state exactly, and re-seeded from
  // the document we just wrote otherwise.
  #docs = new Map();

  /**
   * @param {string} baseDir
   * `summaryOpts` may be an object or a FUNCTION returning one (sync or async),
   * resolved once per version actually written. The name resolvers a summary
   * needs — which folder is `folderId`, which build is in a comp slot — are
   * snapshots of live state, and `renderSummary` is synchronous, so they have
   * to be in hand before it runs. Making the store fetch them means the six
   * places that append a version (save, revert, team-sync pull, tombstone,
   * trash, migration) cannot each forget to.
   *
   * `coalesce` and `versionIncidental` are the two places builds and comps
   * genuinely want different behaviour, and both follow from how each is
   * saved. A build is saved by an explicit click, so a version per save is a
   * version per decision and merging two of them destroys a state the user
   * chose; its bookkeeping (a folder move, comp membership, a drag-reorder) is
   * written by the library on the user's behalf and is not an edit to the
   * build. A comp autosaves its notes on a debounce, so it needs the window,
   * and a comp moving between folders is worth a line in the folder feed.
   *
   * Both default to the comp behaviour, which is the older one: a subclass has
   * to ask to opt out.
   *
   * @param {{subdir: string,
   *          differ: {diff: Function, applyOps: Function, classify: Function},
   *          summaryOpts?: object|Function,
   *          coalesce?: boolean, versionIncidental?: boolean}} opts
   */
  constructor(baseDir, { subdir, differ, summaryOpts = {}, coalesce = true, versionIncidental = true }) {
    this.dir = path.join(baseDir, "history", subdir);
    this.differ = differ;
    this.summaryOpts = summaryOpts;
    this.coalesceByDefault = coalesce !== false;
    this.versionIncidental = versionIncidental !== false;
  }

  // appendVersion is fire-and-forget from several places (local save, shared
  // pull); serialize so concurrent read-modify-writes don't drop each other's
  // entries. VersionLog documents this queue as its serializer — it assumes a
  // single in-flight append per instance and does not guard interleaving
  // itself.
  #enqueue(fn) {
    const next = this.#writeQueue.then(() => fn());
    this.#writeQueue = next.catch(() => {});
    return next;
  }

  #logFor(recordId) {
    const name = sanitizeId(recordId);
    let log = this.#logs.get(name);
    if (!log) {
      log = new VersionLog(path.join(this.dir, `${name}.jsonl`));
      this.#logs.set(name, log);
    }
    return log;
  }

  /* ------------------------------------------------------------- tail memo */

  #memoGet(name, last, v) {
    const memo = this.#docs.get(name);
    if (!memo) return undefined;
    if (memo.fp !== tailFingerprint(last)) {
      // Somebody wrote to this log without going through us.
      this.#docs.delete(name);
      return undefined;
    }
    return memo.docs.get(v);
  }

  #memoSet(name, tailEntry, pairs) {
    const docs = new Map();
    for (const [v, doc] of pairs) if (doc) docs.set(v, structuredClone(doc));
    // Re-insert so the Map's iteration order is least-recently-used first.
    this.#docs.delete(name);
    this.#docs.set(name, { fp: tailFingerprint(tailEntry), docs });
    while (this.#docs.size > DOC_CACHE_RECORDS) {
      this.#docs.delete(this.#docs.keys().next().value);
    }
  }

  /**
   * The document as of version `v`, from the memo when it is provably current,
   * from the tail entry itself when `v` IS the tail and the tail is a keyframe,
   * and only otherwise by replaying the log.
   */
  async #docAt(recordId, last, v) {
    if (v === last.v && last.doc !== undefined) return structuredClone(last.doc);
    const cached = this.#memoGet(sanitizeId(recordId), last, v);
    if (cached !== undefined) return structuredClone(cached);
    return this.getVersion(recordId, v);
  }

  async init() {
    try {
      await fs.mkdir(this.dir, { recursive: true });
    } catch (err) {
      // History must never block app launch.
      logDegrade("init", this.dir, err);
    }
  }

  /* ------------------------------------------------------------------ write */

  /**
   * Append one version for `recordId`, or nothing at all.
   *
   * Returns the version written, or `null` when the save changed nothing that
   * counts. A version is written when `substantive.length > 0 ||
   * incidental.length > 0`: a derived-only change (publishing, reordering,
   * pinning, a game patch rewriting a skill's description) is not an edit and
   * must not put a noise line in the history panel.
   *
   * `ts` is injected by the caller and defaults to now. The store itself never
   * reads the clock, so tests are deterministic without faking timers.
   *
   * @param {{recordId: string, before?: object|null, after: object,
   *          author?: string, source?: string, kind?: string, ts?: string,
   *          summaryOpts?: object, coalesce?: boolean}} input
   */
  async appendVersion(input) {
    const opts = input || {};
    if (!opts.recordId || !opts.after) return null;
    return this.#enqueue(() => this.#appendVersion(opts)).catch((err) => {
      logDegrade("appendVersion", opts.recordId, err);
      return null;
    });
  }

  async #appendVersion({
    recordId,
    before = null,
    after,
    author = "local",
    source = "local",
    kind,
    ts = new Date().toISOString(),
    summaryOpts,
    // Opt out of the coalescing window. Comps want it on; builds turn it off
    // store-wide (see the constructor). The v1
    // migration (history/migrateV1.js) wants it off, because every v1 entry is
    // already a version the user committed to and can see. Merging two of them
    // because they happen to sit five minutes apart would delete history the
    // migration exists to preserve — in the measured baseline that is 39 of
    // 131 entries.
    coalesce: allowCoalesce = this.coalesceByDefault,
  }) {
    const { diff, classify } = this.differ;
    const log = this.#logFor(recordId);
    // A deletion is the one change that must always be recorded, and always as
    // a keyframe: "Bring it back" needs a whole document, not a patch onto one.
    const isDelete = kind === "delete";

    const last = await log.lastEntry();

    if (!last) {
      // Nothing stored yet, so there is no base of our own to diff against —
      // this is the one and only place the caller's `before` is used, and only
      // to phrase the summary. The version itself is always a whole-document
      // keyframe: a record's origin is the one thing that must never be a patch.
      const sOpts = await this.#summaryOptions(recordId, summaryOpts);
      const summary = isDelete
        ? "Deleted"
        : (before ? renderSummary(diff(before, after), sOpts) || "Created" : "Created");
      return this.#write(log, recordId, {
        // A copy, not a reference — see #entry.
        v: 1, ts, author, source, kind: kind || "key", summary, doc: structuredClone(after),
      }, { memo: [[1, after]] });
    }

    // A record whose base cannot be reconstructed (its keyframe was lost, or a
    // gap opened in the chain) must not keep accumulating deltas onto a state
    // nothing can rebuild: every one of them would be unreadable too, and the
    // summary would describe a diff against {} — a creation that did not
    // happen. The next write heals it instead, by being a keyframe.
    const base = await this.#docAt(recordId, last, last.v);
    const lostBase = base === null;
    const ops = diff(base || {}, after);
    if (!isDelete) {
      if (ops.length === 0) return null;
      const { substantive, incidental } = classify(ops);
      if (substantive.length === 0 && incidental.length === 0) return null;
      // Bookkeeping on its own is not an edit here (builds). Nothing is lost by
      // skipping it: the diff base is the last VERSIONED document, so the move
      // still appears as an op on the next real edit and its summary still
      // says where the record went — it just does not get a row of its own.
      // A deletion is exempt by construction; `isDelete` never reaches here.
      if (!this.versionIncidental && substantive.length === 0) return null;
    }

    // Resolved here rather than at the top: a save that writes no version (the
    // common case for a derived-only change) must not pay for reading the
    // folder tree and the build list to name something it will never render.
    const sOpts = await this.#summaryOptions(recordId, summaryOpts);

    // Successive edits by the same hand in the same sitting are one edit. The
    // `last.v > 1` guard is load-bearing: coalescing into version 1 would
    // rewrite the record's origin keyframe and erase where it came from. A
    // deletion never merges into the edit before it either.
    const dt = Date.parse(ts) - Date.parse(last.ts);
    const coalesce =
      allowCoalesce &&
      !isDelete &&
      last.v > 1 &&
      last.kind !== "delete" &&
      last.author === author &&
      last.source === source &&
      // Two-sided on purpose. `dt <= WINDOW` alone is true for ANY negative
      // dt, so a backwards clock step — DST, an NTP correction, a VM resume —
      // makes the next save coalesce into, and overwrite in place, an
      // arbitrarily old version. A save that appears to predate the version
      // before it is not "the same sitting"; it gets a version of its own.
      dt >= 0 && dt <= COALESCE_WINDOW_MS;

    // Coalescing needs the version BEFORE `last` as its base; if that cannot be
    // reconstructed there is nothing to merge into and the edit becomes a
    // version of its own rather than a patch against a guess.
    const prev = coalesce ? await this.#docAt(recordId, last, last.v - 1) : null;
    if (coalesce && prev) {
      const merged = diff(prev, after);
      if (merged.length === 0) {
        // The edit undid itself inside the window — fix a typo, undo it; toggle
        // a trait on and off. `after` is byte-equal to `prev`, so `last` has
        // nothing left to say. REMOVE it rather than rewrite it: an entry with
        // no ops renders as a blank row and, since it has nothing substantive
        // in it, gets relabelled as bookkeeping. Skipping the write and leaving
        // `last` in place would be worse still — its ops would describe a
        // transition the live document no longer matches.
        await log.removeLast();
        // The tail is now some earlier entry we never read, so we cannot state
        // what the memo should hold. Drop it.
        this.#docs.delete(sanitizeId(recordId));
        return null;
      }
      return this.#write(log, recordId, this.#entry({
        v: last.v, ts, author, source, kind, ops: merged,
        // Keep whatever shape the entry already had: replacing a keyframe with
        // a patch would strand every delta that reconstructs through it.
        keyframe: last.doc !== undefined, after, sOpts,
      }), { replace: true, memo: [[last.v, after], [last.v - 1, prev]] });
    }

    const v = last.v + 1;
    return this.#write(log, recordId, this.#entry({
      v, ts, author, source, kind, ops, lostBase,
      keyframe: isDelete || lostBase || v % KEYFRAME_INTERVAL === 1,
      after, sOpts,
    }), { memo: [[v, after], [last.v, base]] });
  }

  async #summaryOptions(recordId, perCall) {
    let base = this.summaryOpts;
    if (typeof base === "function") {
      try {
        base = await base();
      } catch (err) {
        // A resolver that cannot read its source costs a name, never a version.
        logDegrade("summaryOpts", recordId, err);
        base = {};
      }
    }
    return { ...(base || {}), ...(perCall || {}) };
  }

  #entry({ v, ts, author, source, kind, ops, keyframe, after, sOpts, lostBase = false }) {
    const { classify } = this.differ;
    const entry = { v, ts, author, source };
    // An explicit kind from the caller wins ("delete"); otherwise a change with
    // nothing substantive in it is bookkeeping, and a keyframe says so.
    const resolved = kind
      || (lostBase ? "key" : null)
      || (classify(ops).substantive.length === 0 ? "meta" : (keyframe ? "key" : undefined));
    if (resolved) entry.kind = resolved;
    // With no base, `ops` is a diff against {} — it names every field in the
    // document as though the record had just been created. That is not what
    // the user changed and must never be shown as if it were.
    entry.summary = kind === "delete"
      ? "Deleted"
      : (lostBase ? RECOVERED_SUMMARY : renderSummary(ops, sOpts));
    // A copy, never a reference: a caller that mutates `after` after the save
    // must not retroactively rewrite the version it was handed back.
    if (keyframe) entry.doc = structuredClone(after);
    else entry.ops = ops;
    return entry;
  }

  /**
   * @param {{replace?: boolean, memo?: Array<[number, object]>}} opts
   *   `memo` is what the tail memo should hold once this entry is on disk:
   *   the document this entry represents, and (when coalescing) the one before
   *   it. Seeding it here, from values we just computed, is what keeps the
   *   memo exact rather than merely probable. A failed write throws before we
   *   touch it, and the memo is dropped first either way.
   */
  async #write(log, recordId, entry, { replace = false, memo = null } = {}) {
    const name = sanitizeId(recordId);
    this.#docs.delete(name);
    if (replace) await log.replaceLast(entry);
    else await log.append(entry);
    if (memo) this.#memoSet(name, entry, memo);
    return { ...entry, recordId };
  }

  /* ------------------------------------------------------------------- read */

  /**
   * Reconstruct the document as of version `v`: walk back to the nearest entry
   * carrying a `doc`, then replay every patch forward from it.
   */
  async getVersion(recordId, v) {
    const target = Number(v);
    if (!Number.isFinite(target)) return null;
    const { entries } = await this.#logFor(recordId).readAll();
    const idx = entries.findIndex((e) => e && e.v === target);
    if (idx === -1) return null;

    let k = idx;
    while (k >= 0 && (!entries[k] || entries[k].doc === undefined)) k -= 1;
    // No keyframe at or before the target: the log was truncated below its own
    // origin. Say so rather than returning a document built from nothing.
    if (k < 0) {
      logDegrade("getVersion", `${recordId}@${target}`, new Error("no keyframe at or before this version"));
      return null;
    }

    // The walk must cross an UNBROKEN run of versions. A line that failed to
    // parse (a partial write, a truncated file) simply vanishes from `entries`,
    // and replaying the patches either side of the hole produces a document
    // that blends two different points in history — a WRONG document, returned
    // with no error, which `builds:revert` would then write over the user's
    // live build. Versions are dense by construction (every append takes
    // `last.v + 1`; a coalesce replaces in place), so a jump in `v` here means
    // a lost entry and nothing else. Refuse rather than guess.
    for (let i = k + 1; i <= idx; i += 1) {
      if (!entries[i] || entries[i].v !== entries[i - 1].v + 1) {
        logDegrade(
          "getVersion",
          `${recordId}@${target}`,
          new Error(`gap in the version chain before v${target} (after v${entries[i - 1].v})`),
        );
        return null;
      }
    }

    let doc = structuredClone(entries[k].doc);
    for (let i = k + 1; i <= idx; i += 1) {
      doc = this.differ.applyOps(doc, (entries[i] && entries[i].ops) || []);
    }
    return doc;
  }

  /**
   * Newest-first page of versions. `cursor` is the version number to resume at,
   * as handed back in `nextCursor`.
   */
  async listVersions(recordId, { limit = 100, cursor = null } = {}) {
    const { entries } = await this.#logFor(recordId).readAll();
    const newestFirst = entries.filter(Boolean).reverse().map((e) => ({ ...e, recordId }));
    let start = 0;
    if (cursor !== null && cursor !== undefined) {
      start = newestFirst.findIndex((e) => e.v === Number(cursor));
      if (start === -1) return { versions: [], nextCursor: null };
    }
    const versions = await this.#relabel(recordId, newestFirst.slice(start, start + limit));
    const next = newestFirst[start + limit];
    return { versions, nextCursor: next ? next.v : null };
  }

  /**
   * A summary is written once, when its version is written, so a resolver that
   * was missing that day leaves a raw item id frozen in the log forever. The
   * ops are the durable record; the sentence about them is not. Re-rendering
   * here means a fix to the vocabulary reaches the history that already exists
   * — the same reason `compareVersions` labels its ops at read time instead of
   * storing the labels, and the same `renderSummary` call the write path makes,
   * so the two can never disagree.
   *
   * Entries with no `ops` keep what they were written with. That is not a
   * limitation to route around: a keyframe has a document rather than ops, and
   * the two summaries that are not descriptions of ops at all — "Deleted" and
   * the recovered-entry text — are only ever written onto keyframes.
   */
  async #relabel(recordId, entries) {
    if (!entries.some((e) => Array.isArray(e.ops))) return entries;
    // Resolved once for the page, not once per entry: the resolvers behind it
    // read the folder tree and the upgrade catalog.
    const sOpts = await this.#summaryOptions(recordId, null);
    return entries.map((e) => (
      Array.isArray(e.ops) ? { ...e, summary: renderSummary(e.ops, sOpts) } : e
    ));
  }

  /**
   * The newest `limit` versions across a set of records, merged newest-first
   * and each tagged with the record it came from — the folder feed's shape.
   * Record ids with no history contribute nothing.
   */
  async listTails(recordIds, limit = 100) {
    const ids = Array.isArray(recordIds) ? recordIds : [];
    const lists = await Promise.all(ids.map(async (recordId) => {
      const tail = await this.#logFor(recordId).readTail(limit);
      return this.#relabel(recordId, tail.filter(Boolean).map((e) => ({ ...e, recordId })));
    }));
    return lists
      .flat()
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
      .slice(0, limit);
  }

  /* ---------------------------------------------------------------- prune */

  /**
   * Trim every log in this store's directory back to MAX_VERSIONS.
   *
   * Reads the directory rather than taking a list of record ids: a log whose
   * record was purged is exactly the kind that would otherwise grow forever
   * unnoticed. Sequential on purpose — this runs at startup beside the trash
   * sweep, and a parallel fan-out over every record in a library would be a
   * burst of whole-file reads and rewrites competing with the launch.
   *
   * Never throws. A log that cannot be pruned is left exactly as it was.
   *
   * @returns {Promise<{records: number, dropped: number}>}
   */
  async pruneAll() {
    let names;
    try {
      names = (await fs.readdir(this.dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (!err || err.code !== "ENOENT") logDegrade("pruneAll", this.dir, err);
      return { records: 0, dropped: 0 };
    }
    let records = 0;
    let dropped = 0;
    for (const name of names) {
      const result = await this.pruneRecord(name.slice(0, -".jsonl".length));
      if (result && result.dropped > 0) {
        records += 1;
        dropped += result.dropped;
      }
    }
    return { records, dropped };
  }

  /**
   * Trim one record's log to the newest MAX_VERSIONS.
   *
   * Queued behind writes: this rewrites the whole file, and an append landing
   * halfway through would be written at an offset the rename then throws away.
   */
  async pruneRecord(recordId) {
    return this.#enqueue(() => this.#pruneRecord(recordId)).catch((err) => {
      logDegrade("pruneRecord", recordId, err);
      return null;
    });
  }

  async #pruneRecord(recordId) {
    const log = this.#logFor(recordId);
    const { entries } = await log.readAll();
    const live = entries.filter(Boolean);
    const keepFrom = live.length - MAX_VERSIONS;
    if (keepFrom <= 0) return null;

    // The oldest surviving entry becomes the log's new origin, so it needs the
    // whole document rather than the patch it was written as — a JSONL log of
    // patches cannot be pruned by dropping its head, because the survivors
    // reconstruct through the keyframe that would go with it. If the document
    // cannot be rebuilt — a torn line, a gap in the chain — there is no honest
    // origin to write and the file is left alone. A log that is too big is a
    // far smaller problem than one whose history cannot be read.
    const head = live[keepFrom];
    const doc = await this.getVersion(recordId, head.v);
    if (doc === null) {
      logDegrade("pruneRecord", `${recordId}@${head.v}`, new Error("could not materialize the new origin"));
      return null;
    }

    // Keeps its own v, ts, author and summary: it is still the version it
    // always was, and still describes the change the user made then. What
    // changes is that it now carries the document instead of the ops that
    // produced it — `doc` presence is what marks a keyframe, so the rest of
    // the store needs no special case for a pruned head. Version numbers are
    // untouched, which keeps them dense and keeps `getVersion`'s gap check
    // meaningful; a version below the new origin now simply does not exist.
    const origin = { ...head, doc };
    delete origin.ops;
    const kept = [origin, ...live.slice(keepFrom + 1)];

    await log.rewrite(kept);
    // Every offset and every memoized document for this record is now suspect.
    this.#docs.delete(sanitizeId(recordId));
    return { dropped: keepFrom, kept: kept.length, oldestVersion: origin.v };
  }

  /* ----------------------------------------------------------------- delete */

  async deleteHistory(recordId) {
    return this.#enqueue(async () => {
      const name = sanitizeId(recordId);
      const log = this.#logFor(recordId);
      try {
        await log.unlink();
      } catch (err) {
        logDegrade("deleteHistory", recordId, err);
      }
      this.#logs.delete(name);
      // Not a staleness guard — the fingerprint above already handles that,
      // and a deleted log has no tail to match against. This frees the two
      // documents the memo holds for a record that no longer exists.
      this.#docs.delete(name);
    });
  }
}

module.exports = { HistoryStore };
