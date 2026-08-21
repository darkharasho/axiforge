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
}

module.exports = { SyncStore };
