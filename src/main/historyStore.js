"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { readJsonFile, writeJsonAtomic } = require("./jsonFile");

const HISTORY_CAP = 50; // max entries per record

/**
 * Per-record version history, on disk as `{ recordId: [entry, ...] }`.
 *
 * Builds have had this since the shared-folder work; comps now need the same
 * thing, and the storage half is identical — a capped, newest-first list of
 * snapshots with an author and a summary. Only two things differ per record
 * type: which file it lives in and what the id field is called, so those are
 * the constructor's whole job. Everything type-specific (what counts as a
 * change, how to phrase it) belongs in the subclass module beside its
 * summarize* function.
 *
 * Entries are newest-first and the cap trims the TAIL, so the most recent
 * entry — including a "Deleted" one — is never the thing that ages out.
 */
class HistoryStore {
  #writeQueue = Promise.resolve();

  /**
   * @param {string} baseDir
   * @param {{fileName: string, idField: string, cap?: number, defaultSummary?: string}} opts
   */
  constructor(baseDir, { fileName, idField, cap = HISTORY_CAP, defaultSummary = "updated" }) {
    this.historyPath = path.join(baseDir, fileName);
    this.idField = idField;
    this.cap = cap;
    this.defaultSummary = defaultSummary;
  }

  // addEntry is fire-and-forget from several places (local save, shared pull);
  // serialize so concurrent read-modify-writes don't drop each other's entries.
  #enqueue(fn) {
    const next = this.#writeQueue.then(() => fn());
    this.#writeQueue = next.catch(() => {});
    return next;
  }

  async init() {
    try {
      await fs.access(this.historyPath);
    } catch {
      await writeJsonAtomic(this.historyPath, {}, { backup: false });
    }
  }

  async #readAll() {
    try {
      const data = await readJsonFile(this.historyPath, {});
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  async #writeAll(data) {
    // History snapshots can be large; skip the .bak generation for this file.
    await writeJsonAtomic(this.historyPath, data, { backup: false });
  }

  async getAllHistory() {
    return this.#readAll();
  }

  async getHistory(recordId) {
    const all = await this.#readAll();
    return all[recordId] || [];
  }

  /**
   * @param {object} input carries the id under this store's `idField`
   *   (`buildId` / `compId`), plus authorLogin, source, summary, snapshot.
   */
  async addEntry(input) {
    const recordId = input[this.idField];
    return this.#enqueue(async () => {
      const all = await this.#readAll();
      if (!all[recordId]) all[recordId] = [];
      const entry = {
        id: crypto.randomUUID(),
        [this.idField]: recordId,
        timestamp: new Date().toISOString(),
        authorLogin: input.authorLogin || "local",
        source: input.source || "local",
        summary: input.summary || this.defaultSummary,
        snapshot: input.snapshot,
      };
      // Newest first; cap at this.cap entries
      all[recordId].unshift(entry);
      if (all[recordId].length > this.cap) {
        all[recordId] = all[recordId].slice(0, this.cap);
      }
      await this.#writeAll(all);
      return entry;
    });
  }

  async deleteHistory(recordId) {
    return this.#enqueue(async () => {
      const all = await this.#readAll();
      if (all[recordId]) {
        delete all[recordId];
        await this.#writeAll(all);
      }
    });
  }
}

module.exports = { HistoryStore, HISTORY_CAP };
