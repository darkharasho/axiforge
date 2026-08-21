"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { readJsonFile, writeJsonAtomic } = require("./jsonFile");

class SyncStore {
  #writeQueue = Promise.resolve();

  constructor(baseDir) {
    this.syncPath = path.join(baseDir, "syncState.json");
  }

  // Serialize every read-modify-write. Pulls and pushes run concurrently and
  // both update SHAs; without this, interleaved setSha() calls drop each
  // other's writes and the lost SHA shows up later as a spurious 409/refetch.
  #enqueue(fn) {
    const next = this.#writeQueue.then(() => fn());
    this.#writeQueue = next.catch(() => {});
    return next;
  }

  async init() {
    try {
      await fs.access(this.syncPath);
    } catch {
      await writeJsonAtomic(this.syncPath, {}, { backup: false });
    }
  }

  async getState() {
    const data = await readJsonFile(this.syncPath, {});
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }

  async #write(state) {
    await writeJsonAtomic(this.syncPath, state, { backup: false });
  }

  async getShas(folderId) {
    const state = await this.getState();
    return state[folderId]?.remoteShas || {};
  }

  async setShas(folderId, shas) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      if (!state[folderId]) state[folderId] = {};
      state[folderId].remoteShas = { ...shas };
      await this.#write(state);
    });
  }

  async setSha(folderId, filePath, sha) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      if (!state[folderId]) state[folderId] = {};
      if (!state[folderId].remoteShas) state[folderId].remoteShas = {};
      state[folderId].remoteShas[filePath] = sha;
      await this.#write(state);
    });
  }

  async removeSha(folderId, filePath) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      if (state[folderId]?.remoteShas) {
        delete state[folderId].remoteShas[filePath];
        await this.#write(state);
      }
    });
  }

  async removeFolder(folderId) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      delete state[folderId];
      await this.#write(state);
    });
  }

  async reset() {
    return this.#enqueue(async () => {
      await this.#write({});
    });
  }

  // ─── Team scope ────────────────────────────────────────────────────────────
  // syncState.json: { "<teamId>": { cursor, versions: { id: {version, createdBy} }, outbox: { id: entry }, failures } }

  #teamOf(state, teamId) {
    const t = state[teamId] && typeof state[teamId] === "object" ? state[teamId] : {};
    return {
      cursor: Number.isInteger(t.cursor) ? t.cursor : 0,
      versions: t.versions && typeof t.versions === "object" ? t.versions : {},
      outbox: t.outbox && typeof t.outbox === "object" ? t.outbox : {},
      failures: Number.isInteger(t.failures) ? t.failures : 0,
    };
  }

  async getTeam(teamId) {
    return this.#teamOf(await this.getState(), teamId);
  }

  #mutateTeam(teamId, fn) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      const team = this.#teamOf(state, teamId);
      const out = fn(team);
      state[teamId] = team;
      await this.#write(state);
      return out;
    });
  }

  setCursor(teamId, seq) { return this.#mutateTeam(teamId, (t) => { t.cursor = seq; }); }
  setFailures(teamId, n) { return this.#mutateTeam(teamId, (t) => { t.failures = n; }); }

  async getVersion(teamId, itemId) {
    const t = await this.getTeam(teamId);
    return t.versions[itemId] || null;
  }
  setVersion(teamId, itemId, { version, createdBy }) {
    return this.#mutateTeam(teamId, (t) => { t.versions[itemId] = { version, createdBy: createdBy || null }; });
  }
  removeVersion(teamId, itemId) { return this.#mutateTeam(teamId, (t) => { delete t.versions[itemId]; }); }

  // A new op for an item replaces any pending one (delete supersedes put; a put
  // after a delete is a re-create) and resets retry/conflict state. `queuedAt`
  // is also the optimistic token a flush in flight against the PREVIOUS entry
  // must present to dequeue()/patchOutbox() it — this guarantees a re-enqueue
  // that races an in-flight flush gets a strictly later queuedAt, so the stale
  // flush's token never matches and can't clobber the fresh entry.
  enqueue(teamId, itemId, { type, op }) {
    return this.#mutateTeam(teamId, (t) => {
      const prev = t.outbox[itemId];
      const prevAtMs = prev ? Date.parse(prev.queuedAt) : 0;
      const queuedAtMs = Math.max(Date.now(), prevAtMs + 1);
      const entry = { type, op, queuedAt: new Date(queuedAtMs).toISOString(), attempts: 0, nextAttemptAt: null, conflict: null };
      t.outbox[itemId] = entry;
      return { ...entry };
    });
  }
  // Both guards are optimistic-concurrency: when { queuedAt } is passed, the
  // mutation only applies if the stored entry's queuedAt still matches — a
  // stale caller (flushing an entry that has since been replaced by a fresh
  // enqueue) becomes a no-op instead of clobbering the new entry. Returns
  // whether the mutation applied.
  dequeue(teamId, itemId, { queuedAt } = {}) {
    return this.#mutateTeam(teamId, (t) => {
      const cur = t.outbox[itemId];
      if (!cur) return false;
      if (queuedAt !== undefined && cur.queuedAt !== queuedAt) return false;
      delete t.outbox[itemId];
      return true;
    });
  }
  patchOutbox(teamId, itemId, patch, { queuedAt } = {}) {
    return this.#mutateTeam(teamId, (t) => {
      const cur = t.outbox[itemId];
      if (!cur) return false;
      if (queuedAt !== undefined && cur.queuedAt !== queuedAt) return false;
      Object.assign(cur, patch);
      return true;
    });
  }
  async listOutbox(teamId) {
    const t = await this.getTeam(teamId);
    return Object.entries(t.outbox)
      .map(([itemId, e]) => ({ itemId, ...e }))
      .sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
  }

  removeTeam(teamId) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      delete state[teamId];
      await this.#write(state);
    });
  }
  async listTeamIds() {
    const state = await this.getState();
    return Object.keys(state).filter((k) => state[k] && typeof state[k] === "object" && ("cursor" in state[k] || "outbox" in state[k]));
  }
}

module.exports = { SyncStore };
