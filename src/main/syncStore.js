"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");

class SyncStore {
  constructor(baseDir) {
    this.syncPath = path.join(baseDir, "syncState.json");
  }

  async init() {
    try {
      await fs.access(this.syncPath);
    } catch {
      await fs.writeFile(this.syncPath, "{}", "utf-8");
    }
  }

  async getState() {
    const raw = await fs.readFile(this.syncPath, "utf-8");
    return JSON.parse(raw);
  }

  async #write(state) {
    await fs.writeFile(this.syncPath, JSON.stringify(state, null, 2), "utf-8");
  }

  async getShas(folderId) {
    const state = await this.getState();
    return state[folderId]?.remoteShas || {};
  }

  async setShas(folderId, shas) {
    const state = await this.getState();
    if (!state[folderId]) state[folderId] = {};
    state[folderId].remoteShas = { ...shas };
    await this.#write(state);
  }

  async setSha(folderId, filePath, sha) {
    const state = await this.getState();
    if (!state[folderId]) state[folderId] = {};
    if (!state[folderId].remoteShas) state[folderId].remoteShas = {};
    state[folderId].remoteShas[filePath] = sha;
    await this.#write(state);
  }

  async removeSha(folderId, filePath) {
    const state = await this.getState();
    if (state[folderId]?.remoteShas) {
      delete state[folderId].remoteShas[filePath];
      await this.#write(state);
    }
  }

  async removeFolder(folderId) {
    const state = await this.getState();
    delete state[folderId];
    await this.#write(state);
  }

  async reset() {
    await fs.writeFile(this.syncPath, "{}", "utf-8");
  }
}

module.exports = { SyncStore };
