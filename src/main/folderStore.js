"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

class FolderStore {
  constructor(baseDir) {
    this.foldersPath = path.join(baseDir, "folders.json");
  }

  async init() {
    await this.#ensureFile(this.foldersPath, "[]");
  }

  async listFolders() {
    return this.#readJson(this.foldersPath);
  }

  async upsertFolder(input) {
    const folders = await this.listFolders();
    const now = new Date().toISOString();
    const name = String(input.name || "Untitled Folder").slice(0, 100);
    const parentId =
      typeof input.parentId === "string" ? input.parentId : null;

    const shared = input.shared === true;
    const orgName = typeof input.orgName === "string" ? input.orgName : undefined;
    const lastSyncedAt = typeof input.lastSyncedAt === "string" ? input.lastSyncedAt : undefined;

    // Shared folders must be top-level
    if (shared && parentId) {
      throw new Error("Shared folders must be top-level");
    }

    // Non-shared folders cannot nest under shared folders
    if (parentId) {
      const parentFolder = folders.find((f) => f.id === parentId);
      if (parentFolder?.shared) {
        throw new Error("Cannot nest folders under a shared folder");
      }
    }

    // Depth check
    if (parentId) {
      const depth = this.#getDepth(folders, parentId);
      if (depth >= 3) {
        throw new Error(
          "Maximum folder nesting depth (3) exceeded",
        );
      }
    }

    const existing = input.id
      ? folders.find((f) => f.id === input.id)
      : null;

    if (existing) {
      existing.name = name;
      existing.parentId = parentId;
      if (input.sortOrder !== undefined) {
        existing.sortOrder = Number(input.sortOrder) || 0;
      }
      if (input.shared !== undefined) existing.shared = Boolean(input.shared);
      if (input.orgName !== undefined) existing.orgName = input.orgName;
      if (input.lastSyncedAt !== undefined) existing.lastSyncedAt = input.lastSyncedAt;
      // Ensure updatedAt is strictly greater than the previous value
      const prevUpdatedAt = existing.updatedAt;
      existing.updatedAt =
        now > prevUpdatedAt
          ? now
          : new Date(new Date(prevUpdatedAt).getTime() + 1).toISOString();
      await this.#writeJson(this.foldersPath, folders);
      return { ...existing };
    }

    const folder = {
      id: input.id || crypto.randomUUID(),
      name,
      parentId,
      sortOrder:
        typeof input.sortOrder === "number" ? input.sortOrder : 0,
      createdAt: now,
      updatedAt: now,
    };
    if (shared) folder.shared = true;
    if (orgName) folder.orgName = orgName;
    if (lastSyncedAt) folder.lastSyncedAt = lastSyncedAt;
    folders.push(folder);
    await this.#writeJson(this.foldersPath, folders);
    return { ...folder };
  }

  async deleteFolder(id) {
    const folders = await this.listFolders();
    const toDelete = this.#collectDescendants(folders, id);
    if (!toDelete.length) return [];
    const remaining = folders.filter((f) => !toDelete.includes(f.id));
    await this.#writeJson(this.foldersPath, remaining);
    return toDelete;
  }

  async reorderFolders(updates) {
    const folders = await this.listFolders();
    for (const { id, sortOrder } of updates) {
      const folder = folders.find((f) => f.id === id);
      if (folder) folder.sortOrder = sortOrder;
    }
    await this.#writeJson(this.foldersPath, folders);
  }

  async folderExists(id) {
    const folders = await this.listFolders();
    return folders.some((f) => f.id === id);
  }

  /**
   * Update updatedAt on one or more folders.
   * @param {string[]} ids - Folder IDs to touch
   */
  async touchFolders(ids) {
    if (!ids.length) return;
    const folders = await this.listFolders();
    const now = new Date().toISOString();
    for (const folder of folders) {
      if (ids.includes(folder.id)) {
        folder.updatedAt = now;
      }
    }
    await this.#writeJson(this.foldersPath, folders);
  }

  // --- Private helpers ---

  #getDepth(folders, parentId) {
    let depth = 1; // The parent itself is depth 1
    let current = parentId;
    while (current) {
      const parent = folders.find((f) => f.id === current);
      if (!parent || !parent.parentId) break;
      current = parent.parentId;
      depth++;
    }
    return depth;
  }

  #collectDescendants(folders, id) {
    const result = [];
    const exists = folders.some((f) => f.id === id);
    if (!exists) return result;
    result.push(id);
    const children = folders.filter((f) => f.parentId === id);
    for (const child of children) {
      result.push(...this.#collectDescendants(folders, child.id));
    }
    return result;
  }

  async #ensureFile(filePath, fallback) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, fallback, "utf-8");
    }
  }

  async #readJson(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  }

  async #writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}

module.exports = { FolderStore };
