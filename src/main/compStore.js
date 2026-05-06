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
    const notes = String(input.notes || "").slice(0, 100000);
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const folderId = typeof input.folderId === "string" ? input.folderId : null;
    const sortOrder = typeof input.sortOrder === "number" ? input.sortOrder : 0;
    const buildIds = Array.isArray(input.buildIds) ? input.buildIds : [];
    const gameMode = input.gameMode === "pve" || input.gameMode === "wvw" ? input.gameMode : null;
    const VALID_SLOT_COLORS = ["normal", "red", "blue"];
    const partyLines = Array.isArray(input.partyLines)
      ? input.partyLines.map((pl) => ({
          id: pl.id || crypto.randomUUID(),
          capacity: typeof pl.capacity === "number" ? pl.capacity : 5,
          slots: Array.isArray(pl.slots) ? pl.slots : [],
        }))
      : [{ id: crypto.randomUUID(), capacity: 5, slots: [] }];

    // Build-level color map (buildId -> "normal"|"red"|"blue")
    // Migrate from legacy per-slot slotColors if buildColors not present
    let buildColors = {};
    if (input.buildColors && typeof input.buildColors === "object") {
      for (const [k, v] of Object.entries(input.buildColors)) {
        buildColors[k] = VALID_SLOT_COLORS.includes(v) ? v : "normal";
      }
    } else if (Array.isArray(input.partyLines)) {
      // Migrate: first slot color wins for each buildId
      for (const pl of input.partyLines) {
        const colors = Array.isArray(pl.slotColors) ? pl.slotColors : [];
        for (let i = 0; i < (pl.slots || []).length; i++) {
          const sid = (pl.slots || [])[i];
          const c = colors[i];
          if (sid && !buildColors[sid] && c && c !== "normal" && VALID_SLOT_COLORS.includes(c)) {
            buildColors[sid] = c;
          }
        }
      }
    }

    const publishedPatch = {
      ...(typeof input.publishedFileId === "string" ? { publishedFileId: input.publishedFileId } : {}),
      ...(typeof input.publishedKey === "string" ? { publishedKey: input.publishedKey } : {}),
      ...(typeof input.publishedSlug === "string" ? { publishedSlug: input.publishedSlug } : {}),
      ...(typeof input.boonCoverageHtml === "string" ? { boonCoverageHtml: input.boonCoverageHtml } : {}),
    };

    const existing = comps.find((c) => c.id === id);
    if (existing) {
      Object.assign(existing, {
        name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode, buildColors,
        ...publishedPatch,
        updatedAt: now,
      });
      existing.createdAt = existing.createdAt || now;
      await this.#writeJson(this.compsPath, comps);
      return { ...existing };
    }

    const comp = {
      id, name, notes, tags, folderId, sortOrder, buildIds, partyLines, gameMode, buildColors,
      ...publishedPatch,
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

  async deleteComps(ids) {
    const comps = await this.listComps();
    const idSet = new Set(ids);
    const filtered = comps.filter((c) => !idSet.has(c.id));
    await this.#writeJson(this.compsPath, filtered);
  }

  async addTagsToComps(ids, tags) {
    const comps = await this.listComps();
    const idSet = new Set(ids);
    const now = new Date().toISOString();
    let changed = false;
    for (const comp of comps) {
      if (!idSet.has(comp.id)) continue;
      const existing = new Set(comp.tags || []);
      for (const tag of tags) {
        if (!existing.has(tag)) {
          existing.add(tag);
          changed = true;
        }
      }
      comp.tags = [...existing];
      comp.updatedAt = now;
    }
    if (changed) await this.#writeJson(this.compsPath, comps);
  }

  async removeTagsFromComps(ids, tags) {
    const comps = await this.listComps();
    const idSet = new Set(ids);
    const tagsToRemove = new Set(tags);
    const now = new Date().toISOString();
    let changed = false;
    for (const comp of comps) {
      if (!idSet.has(comp.id)) continue;
      const before = (comp.tags || []).length;
      comp.tags = (comp.tags || []).filter((t) => !tagsToRemove.has(t));
      if (comp.tags.length !== before) {
        comp.updatedAt = now;
        changed = true;
      }
    }
    if (changed) await this.#writeJson(this.compsPath, comps);
  }

  async removeBuildFromComps(buildId) {
    const comps = await this.listComps();
    let changed = false;
    for (const comp of comps) {
      if (comp.buildIds.includes(buildId)) {
        comp.buildIds = comp.buildIds.filter((id) => id !== buildId);
        if (comp.buildIds.length === 0) {
          comp.gameMode = null;
        }
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
