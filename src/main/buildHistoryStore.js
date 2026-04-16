"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const HISTORY_CAP = 50; // max entries per build

class BuildHistoryStore {
  constructor(baseDir) {
    this.historyPath = path.join(baseDir, "build-history.json");
  }

  async init() {
    try {
      await fs.access(this.historyPath);
    } catch {
      await fs.writeFile(this.historyPath, "{}", "utf-8");
    }
  }

  async #readAll() {
    try {
      const raw = await fs.readFile(this.historyPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async #writeAll(data) {
    await fs.writeFile(this.historyPath, JSON.stringify(data, null, 2), "utf-8");
  }

  async getHistory(buildId) {
    const all = await this.#readAll();
    return all[buildId] || [];
  }

  async addEntry({ buildId, authorLogin, source, summary, snapshot }) {
    const all = await this.#readAll();
    if (!all[buildId]) all[buildId] = [];
    const entry = {
      id: crypto.randomUUID(),
      buildId,
      timestamp: new Date().toISOString(),
      authorLogin: authorLogin || "local",
      source: source || "local",
      summary: summary || "build updated",
      snapshot,
    };
    // Newest first; cap at HISTORY_CAP entries
    all[buildId].unshift(entry);
    if (all[buildId].length > HISTORY_CAP) {
      all[buildId] = all[buildId].slice(0, HISTORY_CAP);
    }
    await this.#writeAll(all);
    return entry;
  }

  async deleteHistory(buildId) {
    const all = await this.#readAll();
    if (all[buildId]) {
      delete all[buildId];
      await this.#writeAll(all);
    }
  }
}

/**
 * Returns a human-readable single-line summary of what changed between two
 * build objects. Checks fields in priority order and returns the first match.
 */
function summarizeBuildChange(before, after) {
  if (!before) return "build created";
  if (before.title !== after.title) {
    return `title: "${before.title}" → "${after.title}"`;
  }
  if (before.profession !== after.profession) {
    return `profession: ${before.profession} → ${after.profession}`;
  }
  if ((before.gameMode || "pve") !== (after.gameMode || "pve")) {
    return `gameMode: ${before.gameMode || "pve"} → ${after.gameMode || "pve"}`;
  }
  if (JSON.stringify(before.specializations) !== JSON.stringify(after.specializations)) {
    return "specializations changed";
  }
  if (JSON.stringify(before.skills) !== JSON.stringify(after.skills)) {
    return "skills changed";
  }
  if (JSON.stringify(before.underwaterSkills) !== JSON.stringify(after.underwaterSkills)) {
    return "underwater skills changed";
  }
  if (JSON.stringify(before.equipment) !== JSON.stringify(after.equipment)) {
    return "equipment changed";
  }
  if (before.notes !== after.notes) {
    return "notes updated";
  }
  if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) {
    return "tags changed";
  }
  return "build updated";
}

module.exports = { BuildHistoryStore, summarizeBuildChange };
