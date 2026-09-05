"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { readJsonFile, writeJsonAtomic } = require("./jsonFile");

class FolderStore {
  #writeQueue = Promise.resolve();

  constructor(baseDir) {
    this.foldersPath = path.join(baseDir, "folders.json");
  }

  // Serialize all read-modify-write operations to prevent concurrent calls
  // from racing on folders.json (last write wins without serialization).
  #enqueue(fn) {
    const next = this.#writeQueue.then(() => fn());
    this.#writeQueue = next.catch(() => {});
    return next;
  }

  async init() {
    await this.#ensureFile(this.foldersPath, "[]");
  }

  // Raw reader for every write path — see the note in buildStore: rewriting the
  // array after a trash-filtered read would erase trashed folders.
  async #readAllFolders() {
    return this.#readJson(this.foldersPath);
  }

  async listFolders() {
    return (await this.#readAllFolders()).filter((f) => !f.deletedAt);
  }

  async listTrashedFolders() {
    return (await this.#readAllFolders()).filter((f) => f.deletedAt);
  }

  async listArchivedFolders() {
    return (await this.#readAllFolders()).filter((f) => f.archivedAt && !f.deletedAt);
  }

  /**
   * Archive or un-archive a folder and its whole subtree. A folder is the unit
   * people actually think in ("we don't run this season's comps any more"), and
   * archiving one without its children would leave the children stranded: they
   * would still be live records whose parent the library no longer draws.
   *
   * Only the folder the user picked is an `archiveRoot`, so the archive view
   * shows one row for it rather than a row per descendant.
   *
   * @param {{at?: string, batchId?: string}} [opts]
   * @returns {Promise<string[]>} ids of every folder touched
   */
  async setFolderTreeArchived(id, archived, { at, batchId } = {}) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      // Descend over folders that are not in the trash: a trashed child must not
      // be pulled into this batch and quietly un-trashed by the restore path.
      const subtree = this.#collectDescendants(folders.filter((f) => !f.deletedAt), id);
      if (!subtree.length) return [];
      const subtreeSet = new Set(subtree);
      const stamp = at || new Date().toISOString();
      for (const folder of folders) {
        if (!subtreeSet.has(folder.id)) continue;
        if (archived) {
          folder.archivedAt = stamp;
          if (batchId) folder.archiveBatchId = batchId;
          folder.archiveRoot = folder.id === id;
        } else {
          delete folder.archivedAt;
          delete folder.archiveBatchId;
          delete folder.archiveRoot;
        }
      }
      await this.#writeJson(this.foldersPath, folders);
      return subtree;
    });
  }

  /**
   * Trash a folder and everything under it as one act. The descendants carry
   * the same batch id but are NOT batch roots, so the trash view shows the one
   * folder the user deleted rather than a row per descendant.
   *
   * @param {{at?: string, batchId?: string}} [opts]
   * @returns {Promise<string[]>} ids of every folder trashed
   */
  async trashFolderTree(id, { at, batchId } = {}) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      // Descend over live folders only, so an already-trashed child is not
      // re-stamped into this batch and dragged back out by its restore.
      const subtree = this.#collectDescendants(folders.filter((f) => !f.deletedAt), id);
      if (!subtree.length) return [];
      const subtreeSet = new Set(subtree);
      const stamp = at || new Date().toISOString();
      for (const folder of folders) {
        if (!subtreeSet.has(folder.id)) continue;
        folder.deletedAt = stamp;
        if (batchId) folder.trashBatchId = batchId;
        folder.trashRoot = folder.id === id;
      }
      await this.#writeJson(this.foldersPath, folders);
      return subtree;
    });
  }

  async restoreFolders(ids) {
    return this.#enqueue(async () => {
      const idSet = new Set(ids);
      const folders = await this.#readAllFolders();
      const restored = [];
      for (const folder of folders) {
        if (!idSet.has(folder.id) || !folder.deletedAt) continue;
        delete folder.deletedAt;
        delete folder.trashBatchId;
        delete folder.trashRoot;
        restored.push(folder);
      }
      if (restored.length) await this.#writeJson(this.foldersPath, folders);
      return restored;
    });
  }

  /**
   * @param {string} [before] - ISO cutoff; omit to ignore age.
   * @param {string[]} [ids] - restrict to these ids; omit for all of them.
   */
  async purgeTrashedFolders(before, ids) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      const idSet = ids ? new Set(ids) : null;
      const doomed = folders.filter(
        (f) => f.deletedAt
          && (!before || f.deletedAt < before)
          && (!idSet || idSet.has(f.id)),
      );
      if (!doomed.length) return [];
      const doomedIds = new Set(doomed.map((f) => f.id));
      await this.#writeJson(this.foldersPath, folders.filter((f) => !doomedIds.has(f.id)));
      return [...doomedIds];
    });
  }

  async upsertFolder(input) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      const now = new Date().toISOString();
      const name = String(input.name || "Untitled Folder").slice(0, 100);
      const parentId =
        typeof input.parentId === "string" ? input.parentId : null;

      const shared = input.shared === true;
      const orgName = typeof input.orgName === "string" ? input.orgName : undefined;
      const lastSyncedAt = typeof input.lastSyncedAt === "string" ? input.lastSyncedAt : undefined;
      const teamId = typeof input.teamId === "string" ? input.teamId : (input.teamId === null ? null : undefined);
      const role = input.role === "owner" || input.role === "member" ? input.role : (input.role === null ? null : undefined);

      // Shared folders must be top-level
      if (shared && parentId) {
        throw new Error("Shared folders must be top-level");
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
        if (teamId !== undefined) { if (teamId === null) delete existing.teamId; else existing.teamId = teamId; }
        if (role !== undefined) { if (role === null) delete existing.role; else existing.role = role; }
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
      if (teamId) folder.teamId = teamId;
      if (role) folder.role = role;
      folders.push(folder);
      await this.#writeJson(this.foldersPath, folders);
      return { ...folder };
    });
  }

  // Drop the fields the retired GitHub-org shared library left on a folder.
  // `upsertFolder` treats `orgName: undefined` as "leave as is", so clearing
  // them needs its own operation. Returns the updated folder, or null when the
  // id is unknown.
  async clearLegacyFields(id) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      const folder = folders.find((f) => f.id === id);
      if (!folder) return null;
      if (folder.orgName === undefined && folder.lastSyncedAt === undefined) return { ...folder };
      delete folder.orgName;
      delete folder.lastSyncedAt;
      // Every other mutator bumps updatedAt (strictly monotonic); this one used
      // not to, which would hide the change from any updatedAt-based diff.
      const now = new Date().toISOString();
      const prev = folder.updatedAt;
      folder.updatedAt = !prev || now > prev ? now : new Date(new Date(prev).getTime() + 1).toISOString();
      await this.#writeJson(this.foldersPath, folders);
      return { ...folder };
    });
  }

  async deleteFolder(id) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      const toDelete = this.#collectDescendants(folders, id);
      if (!toDelete.length) return [];
      const remaining = folders.filter((f) => !toDelete.includes(f.id));
      await this.#writeJson(this.foldersPath, remaining);
      return toDelete;
    });
  }

  async reorderFolders(updates) {
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      for (const { id, sortOrder } of updates) {
        const folder = folders.find((f) => f.id === id);
        if (folder) folder.sortOrder = sortOrder;
      }
      await this.#writeJson(this.foldersPath, folders);
    });
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
    return this.#enqueue(async () => {
      const folders = await this.#readAllFolders();
      const now = new Date().toISOString();
      for (const folder of folders) {
        if (ids.includes(folder.id)) {
          folder.updatedAt = now;
        }
      }
      await this.#writeJson(this.foldersPath, folders);
    });
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
    const data = await readJsonFile(filePath, []);
    return Array.isArray(data) ? data : [];
  }

  async #writeJson(filePath, data) {
    await writeJsonAtomic(filePath, data);
  }
}

module.exports = { FolderStore };
