"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { VersionLog } = require("./history/versionLog");
const { renderSummary } = require("./history/renderSummary");
const { KEYFRAME_INTERVAL, COALESCE_WINDOW_MS } = require("./history/constants");

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
 * Only three things differ per record type — the subdirectory, the id field,
 * and the differ — so those are the constructor's whole job. What counts as a
 * change lives in the differ (`history/diffBuild.js`, `history/diffComp.js`);
 * how a change is phrased lives in `history/renderSummary.js`.
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

function sanitizeId(recordId) {
  const id = String(recordId === null || recordId === undefined ? "" : recordId);
  if (SAFE_ID.test(id)) return id;
  return crypto.createHash("sha1").update(id).digest("hex");
}

class HistoryStore {
  #writeQueue = Promise.resolve();
  #logs = new Map();

  /**
   * @param {string} baseDir
   * @param {{subdir: string, idField: string,
   *          differ: {diff: Function, applyOps: Function, classify: Function},
   *          summaryOpts?: object}} opts
   */
  constructor(baseDir, { subdir, idField, differ, summaryOpts = {} }) {
    this.dir = path.join(baseDir, "history", subdir);
    this.idField = idField;
    this.differ = differ;
    this.summaryOpts = summaryOpts;
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
   *          summaryOpts?: object}} input
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
  }) {
    const { diff, classify } = this.differ;
    const log = this.#logFor(recordId);
    const sOpts = { ...this.summaryOpts, ...(summaryOpts || {}) };
    // A deletion is the one change that must always be recorded, and always as
    // a keyframe: "Bring it back" needs a whole document, not a patch onto one.
    const isDelete = kind === "delete";

    const last = await log.lastEntry();

    if (!last) {
      // Nothing stored yet, so there is no base of our own to diff against —
      // this is the one and only place the caller's `before` is used, and only
      // to phrase the summary. The version itself is always a whole-document
      // keyframe: a record's origin is the one thing that must never be a patch.
      const summary = isDelete
        ? "Deleted"
        : (before ? renderSummary(diff(before, after), sOpts) || "Created" : "Created");
      return this.#write(log, recordId, {
        // A copy, not a reference — see #entry.
        v: 1, ts, author, source, kind: kind || "key", summary, doc: structuredClone(after),
      });
    }

    const base = await this.getVersion(recordId, last.v);
    const ops = diff(base || {}, after);
    if (!isDelete) {
      if (ops.length === 0) return null;
      const { substantive, incidental } = classify(ops);
      if (substantive.length === 0 && incidental.length === 0) return null;
    }

    // Successive edits by the same hand in the same sitting are one edit. The
    // `last.v > 1` guard is load-bearing: coalescing into version 1 would
    // rewrite the record's origin keyframe and erase where it came from. A
    // deletion never merges into the edit before it either.
    const coalesce =
      !isDelete &&
      last.v > 1 &&
      last.kind !== "delete" &&
      last.author === author &&
      last.source === source &&
      Date.parse(ts) - Date.parse(last.ts) <= COALESCE_WINDOW_MS;

    // Coalescing needs the version BEFORE `last` as its base; if that cannot be
    // reconstructed there is nothing to merge into and the edit becomes a
    // version of its own rather than a patch against a guess.
    const prev = coalesce ? await this.getVersion(recordId, last.v - 1) : null;
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
        return null;
      }
      return this.#write(log, recordId, this.#entry({
        v: last.v, ts, author, source, kind, ops: merged,
        // Keep whatever shape the entry already had: replacing a keyframe with
        // a patch would strand every delta that reconstructs through it.
        keyframe: last.doc !== undefined, after, sOpts,
      }), { replace: true });
    }

    const v = last.v + 1;
    return this.#write(log, recordId, this.#entry({
      v, ts, author, source, kind, ops,
      keyframe: isDelete || v % KEYFRAME_INTERVAL === 1,
      after, sOpts,
    }));
  }

  #entry({ v, ts, author, source, kind, ops, keyframe, after, sOpts }) {
    const { classify } = this.differ;
    const entry = { v, ts, author, source };
    // An explicit kind from the caller wins ("delete"); otherwise a change with
    // nothing substantive in it is bookkeeping, and a keyframe says so.
    const resolved = kind
      || (classify(ops).substantive.length === 0 ? "meta" : (keyframe ? "key" : undefined));
    if (resolved) entry.kind = resolved;
    entry.summary = kind === "delete" ? "Deleted" : renderSummary(ops, sOpts);
    // A copy, never a reference: a caller that mutates `after` after the save
    // must not retroactively rewrite the version it was handed back.
    if (keyframe) entry.doc = structuredClone(after);
    else entry.ops = ops;
    return entry;
  }

  async #write(log, recordId, entry, { replace = false } = {}) {
    if (replace) await log.replaceLast(entry);
    else await log.append(entry);
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
    const versions = newestFirst.slice(start, start + limit);
    const next = newestFirst[start + limit];
    return { versions, nextCursor: next ? next.v : null };
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
      return tail.filter(Boolean).map((e) => ({ ...e, recordId }));
    }));
    return lists
      .flat()
      .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
      .slice(0, limit);
  }

  /**
   * TRANSITIONAL (Task 6 removes it): every record's full version list, keyed
   * by record id. The folder history feed still reads history this way; it
   * becomes `listTails` once the feed is extracted.
   */
  async getAllHistory() {
    let names;
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if (!err || err.code !== "ENOENT") logDegrade("getAllHistory", this.dir, err);
      return {};
    }
    const out = {};
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const recordId = name.slice(0, -".jsonl".length);
      // Capped like the sibling handlers: every keyframe carries a whole
      // document and this crosses IPC. v1 capped at 50 per record; uncapped
      // here would be strictly worse than what it replaces.
      const { versions } = await this.listVersions(recordId, { limit: 200 });
      if (versions.length) out[recordId] = versions;
    }
    return out;
  }

  /** TRANSITIONAL (Task 6 removes it): the newest-first list for a record. */
  async getHistory(recordId) {
    const { versions } = await this.listVersions(recordId, { limit: 200 });
    return versions;
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
    });
  }
}

module.exports = { HistoryStore };
