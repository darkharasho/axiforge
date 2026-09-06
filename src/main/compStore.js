"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { readJsonFile, writeJsonAtomic } = require("./jsonFile");

class CompStore {
  #writeQueue = Promise.resolve();

  constructor(baseDir) {
    this.compsPath = path.join(baseDir, "comps.json");
  }

  // Serialize all read-modify-write operations. Shared-library pulls upsert
  // comps concurrently with user saves; without this, interleaved writes drop
  // each other (last writer wins on the whole file).
  #enqueue(fn) {
    const next = this.#writeQueue.then(() => fn());
    this.#writeQueue = next.catch(() => {});
    return next;
  }

  async init() {
    await this.#ensureFile(this.compsPath, "[]");
  }

  // Raw reader for every write path. They rewrite the whole array, so reading
  // through the trash-filtered listComps() would erase trashed comps on save.
  async #readAllComps() {
    return this.#readJson(this.compsPath);
  }

  async listComps() {
    return (await this.#readAllComps()).filter((c) => !c.deletedAt);
  }

  async listTrashedComps() {
    return (await this.#readAllComps()).filter((c) => c.deletedAt);
  }

  async listArchivedComps() {
    return (await this.#readAllComps()).filter((c) => c.archivedAt && !c.deletedAt);
  }

  /** @see BuildStore#setBuildsArchived - same contract, same reasoning. */
  async setCompsArchived(ids, archived, { at, batchId, root = true } = {}) {
    return this.#enqueue(async () => {
      const idSet = new Set(ids);
      const comps = await this.#readAllComps();
      const stamp = at || new Date().toISOString();
      const changed = [];
      for (const comp of comps) {
        if (!idSet.has(comp.id) || Boolean(comp.archivedAt) === archived) continue;
        if (archived) {
          comp.archivedAt = stamp;
          if (batchId) comp.archiveBatchId = batchId;
          comp.archiveRoot = root;
        } else {
          delete comp.archivedAt;
          delete comp.archiveBatchId;
          delete comp.archiveRoot;
        }
        changed.push(comp);
      }
      if (changed.length) await this.#writeJson(this.compsPath, comps);
      return changed;
    });
  }

  /** @param {{at?: string, batchId?: string, root?: boolean}} [opts] */
  async trashComps(ids, { at, batchId, root = true } = {}) {
    return this.#enqueue(async () => {
      const idSet = new Set(ids);
      const comps = await this.#readAllComps();
      const stamp = at || new Date().toISOString();
      const trashed = [];
      for (const comp of comps) {
        if (!idSet.has(comp.id) || comp.deletedAt) continue;
        comp.deletedAt = stamp;
        if (batchId) comp.trashBatchId = batchId;
        comp.trashRoot = root;
        trashed.push(comp);
      }
      if (trashed.length) await this.#writeJson(this.compsPath, comps);
      return trashed;
    });
  }

  async restoreComps(ids) {
    return this.#enqueue(async () => {
      const idSet = new Set(ids);
      const comps = await this.#readAllComps();
      const restored = [];
      for (const comp of comps) {
        if (!idSet.has(comp.id) || !comp.deletedAt) continue;
        delete comp.deletedAt;
        delete comp.trashBatchId;
        delete comp.trashRoot;
        restored.push(comp);
      }
      if (restored.length) await this.#writeJson(this.compsPath, comps);
      return restored;
    });
  }

  /**
   * @param {string} [before] - ISO cutoff; omit to ignore age.
   * @param {string[]} [ids] - restrict to these ids; omit for all of them.
   */
  async purgeTrashedComps(before, ids) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      const idSet = ids ? new Set(ids) : null;
      const doomed = comps.filter(
        (c) => c.deletedAt
          && (!before || c.deletedAt < before)
          && (!idSet || idSet.has(c.id)),
      );
      if (!doomed.length) return [];
      const doomedIds = new Set(doomed.map((c) => c.id));
      await this.#writeJson(this.compsPath, comps.filter((c) => !doomedIds.has(c.id)));
      return [...doomedIds];
    });
  }

  async upsertComp(input) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      const now = new Date().toISOString();
      const stampPublishedAt = input.__stampPublishedAt === true;
      const id = input.id || crypto.randomUUID();
      const name = String(input.name || "Untitled Comp").slice(0, 140);
      const notes = String(input.notes || "").slice(0, 100000);
      // Screenshots pasted into the notes editor, keyed by the ~img:<key> tokens
      // the notes markdown references. Values are data URLs.
      const images = {};
      if (input.images && typeof input.images === "object") {
        for (const [k, v] of Object.entries(input.images)) {
          if (typeof v === "string") images[k] = v;
        }
      }
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

      // Comp-scoped build categories: [{ id, name, buildIds }]. These let a comp group
      // a subset of its own builds under a named tag that can be dragged into a line as
      // a unit. Only buildIds — membership is resolved against comp.buildIds at use time.
      const categories = Array.isArray(input.categories)
        ? input.categories
            .filter((c) => c && typeof c === "object")
            .map((c) => ({
              id: typeof c.id === "string" ? c.id : crypto.randomUUID(),
              name: String(c.name || "").slice(0, 60),
              icon: typeof c.icon === "string" ? c.icon.slice(0, 2000) : "",
              buildIds: Array.isArray(c.buildIds)
                ? c.buildIds.filter((x) => typeof x === "string")
                : [],
            }))
        : [];

      const publishedPatch = {
        ...(typeof input.publishedFileId === "string" ? { publishedFileId: input.publishedFileId } : {}),
        ...(typeof input.publishedKey === "string" ? { publishedKey: input.publishedKey } : {}),
        ...(typeof input.publishedSlug === "string" ? { publishedSlug: input.publishedSlug } : {}),
        ...(typeof input.boonCoverageHtml === "string" ? { boonCoverageHtml: input.boonCoverageHtml } : {}),
        ...(typeof input.publishedOwner === "string" ? { publishedOwner: input.publishedOwner } : {}),
      };

      const existing = comps.find((c) => c.id === id);
      if (existing) {
        Object.assign(existing, {
          name, notes, images, tags, folderId, sortOrder, buildIds, partyLines, gameMode, buildColors, categories,
          ...publishedPatch,
          updatedAt: now,
        });
        if (stampPublishedAt) existing.publishedAt = now;
        existing.createdAt = existing.createdAt || now;
        await this.#writeJson(this.compsPath, comps);
        return { ...existing };
      }

      const comp = {
        id, name, notes, images, tags, folderId, sortOrder, buildIds, partyLines, gameMode, buildColors, categories,
        ...publishedPatch,
        createdAt: now, updatedAt: now,
      };
      if (stampPublishedAt) comp.publishedAt = now;
      comps.push(comp);
      await this.#writeJson(this.compsPath, comps);
      return comp;
    });
  }

  async deleteComp(id) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      const filtered = comps.filter((c) => c.id !== id);
      await this.#writeJson(this.compsPath, filtered);
    });
  }

  async reorderComps(updates) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      for (const { id, sortOrder } of updates) {
        const comp = comps.find((c) => c.id === id);
        if (comp) comp.sortOrder = sortOrder;
      }
      await this.#writeJson(this.compsPath, comps);
    });
  }

  async deleteComps(ids) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      const idSet = new Set(ids);
      const filtered = comps.filter((c) => !idSet.has(c.id));
      await this.#writeJson(this.compsPath, filtered);
    });
  }

  async addTagsToComps(ids, tags) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
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
    });
  }

  async removeTagsFromComps(ids, tags) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
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
    });
  }

  async removeBuildFromComps(buildId) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
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
    });
  }

  /**
   * Stamp publish metadata onto a comp without re-upserting a stale snapshot
   * or bumping updatedAt. See BuildStore.markPublished for the rationale.
   */
  async markPublished(id, { publishedFileId, publishedKey, publishedSlug, publishedOwner, boonCoverageHtml, snapshotUpdatedAt }) {
    return this.#enqueue(async () => {
      const comps = await this.#readAllComps();
      const existing = comps.find((c) => c.id === id);
      if (!existing) return null;
      if (publishedFileId) existing.publishedFileId = publishedFileId;
      if (publishedKey) existing.publishedKey = publishedKey;
      if (publishedSlug) existing.publishedSlug = publishedSlug;
      if (publishedOwner) existing.publishedOwner = publishedOwner;
      if (typeof boonCoverageHtml === "string") existing.boonCoverageHtml = boonCoverageHtml;
      existing.publishedAt = snapshotUpdatedAt || existing.updatedAt;
      await this.#writeJson(this.compsPath, comps);
      return { ...existing };
    });
  }

  async #readJson(filePath) {
    const data = await readJsonFile(filePath, []);
    return Array.isArray(data) ? data : [];
  }

  async #writeJson(filePath, data) {
    await writeJsonAtomic(filePath, data);
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
