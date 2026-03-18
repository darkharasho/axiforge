"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

class CompStore {
  constructor(baseDir) {
    this.compsPath = path.join(baseDir, "comps.json");
  }

  async init() {
    await this.#ensureFile(this.compsPath, "[]");
  }

  async listComps() {
    return this.#readJson(this.compsPath);
  }

  async upsertComp(input) {
    const comps = await this.listComps();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const name = String(input.name || "Untitled Comp").slice(0, 140);
    const notes = String(input.notes || "").slice(0, 12000);
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const folderId = typeof input.folderId === "string" ? input.folderId : null;
    const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;
    const buildIds = Array.isArray(input.buildIds) ? input.buildIds : [];
    const gameMode = input.gameMode === "pve" || input.gameMode === "wvw" ? input.gameMode : null;
    const partyLines = Array.isArray(input.partyLines)
      ? input.partyLines.map((pl) => ({
          id: pl.id || crypto.randomUUID(),
          capacity: typeof pl.capacity === "number" ? pl.capacity : 5,
          slots: Array.isArray(pl.slots) ? pl.slots : [],
        }))
      : [{ id: crypto.randomUUID(), capacity: 5, slots: [] }];

    const existing = comps.find((c) => c.id === id);
    if (existing) {
      Object.assign(existing, {
        name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode,
        updatedAt: now,
      });
      existing.createdAt = existing.createdAt || now;
      await this.#writeJson(this.compsPath, comps);
      return { ...existing };
    }

    const comp = {
      id, name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode,
      createdAt: now, updatedAt: now,
    };
    comps.push(comp);
    await this.#writeJson(this.compsPath, comps);
    return comp;
  }

  async deleteComp(id) {
    const comps = await this.listComps();
    const filtered = comps.filter((c) => c.id !== id);
    await this.#writeJson(this.compsPath, filtered);
  }

  async reorderComps(updates) {
    const comps = await this.listComps();
    for (const { id, sortOrder } of updates) {
      const comp = comps.find((c) => c.id === id);
      if (comp) comp.sortOrder = sortOrder;
    }
    await this.#writeJson(this.compsPath, comps);
  }

  async removeBuildFromComps(buildId) {
    const comps = await this.listComps();
    let changed = false;
    for (const comp of comps) {
      if (comp.buildIds.includes(buildId)) {
        comp.buildIds = comp.buildIds.filter((id) => id !== buildId);
        changed = true;
      }
      for (const line of comp.partyLines) {
        if (line.slots.includes(buildId)) {
          line.slots = line.slots.filter((id) => id !== buildId);
          changed = true;
        }
      }
    }
    if (changed) await this.#writeJson(this.compsPath, comps);
  }

  async #readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async #ensureFile(filePath, defaultContent) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, defaultContent);
    }
  }
}

module.exports = { CompStore };
