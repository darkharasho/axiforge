"use strict";

const crypto = require("node:crypto");

// How long a deleted item stays recoverable. Matches Finder and Dropbox, which
// is the expectation people bring with them.
const RETENTION_DAYS = 30;
const DAY_MS = 86400000;

/**
 * Trash orchestration across the three stores.
 *
 * The stores each know how to stamp and un-stamp their own records; this module
 * owns the parts that span them:
 *
 *   • the folder cascade — deleting a folder trashes its subtree AND the builds
 *     and comps inside it, all under one batch id so restore is a single act;
 *   • deferred cleanup — unlinking a build from its comps and deleting its
 *     version history used to happen at delete time, which is exactly what made
 *     a delete unrecoverable. Both now wait until purge, so a restore inside the
 *     retention window brings back the build AND its history;
 *   • retention — the startup sweep that finally purges anything past the window.
 *
 * Stores are injected so this is testable against real stores in a temp dir.
 */
function createTrash({ buildStore, compStore, folderStore, historyStore }) {
  async function readTrash() {
    const [builds, comps, folders] = await Promise.all([
      buildStore.listTrashedBuilds(),
      compStore.listTrashedComps(),
      folderStore.listTrashedFolders(),
    ]);
    return { builds, comps, folders };
  }

  /**
   * A folder delete drags its whole subtree along under one batch id. Restoring
   * or purging any member has to act on the entire batch, or a folder comes back
   * without its builds (or worse, builds come back pointing at a folder that
   * was never restored).
   */
  function expandBatches(selection, trash) {
    const wanted = {
      builds: new Set(selection.builds || []),
      comps: new Set(selection.comps || []),
      folders: new Set(selection.folders || []),
    };

    const batchIds = new Set();
    const collect = (records, ids) => {
      for (const record of records) {
        if (ids.has(record.id) && record.trashBatchId) batchIds.add(record.trashBatchId);
      }
    };
    collect(trash.builds, wanted.builds);
    collect(trash.comps, wanted.comps);
    collect(trash.folders, wanted.folders);

    if (batchIds.size) {
      const pullIn = (records, ids) => {
        for (const record of records) {
          if (batchIds.has(record.trashBatchId)) ids.add(record.id);
        }
      };
      pullIn(trash.builds, wanted.builds);
      pullIn(trash.comps, wanted.comps);
      pullIn(trash.folders, wanted.folders);
    }

    return {
      builds: [...wanted.builds],
      comps: [...wanted.comps],
      folders: [...wanted.folders],
    };
  }

  /**
   * A restore has to land somewhere real. If the folder an item lived in was
   * purged while the item sat in the trash, putting it back under that dead id
   * hides it — an orphaned folder never renders in the sidebar at all, which
   * reads as the restore having silently done nothing. Send those to the root.
   */
  async function reattachOrphans({ builds, comps, folders }) {
    const live = new Set((await folderStore.listFolders()).map((f) => f.id));
    const isDead = (id) => id && !live.has(id);

    const orphanFolders = (await folderStore.listFolders())
      .filter((f) => folders.includes(f.id) && isDead(f.parentId));
    for (const folder of orphanFolders) {
      await folderStore.upsertFolder({ ...folder, parentId: null });
    }

    const orphanBuilds = (await buildStore.listBuilds())
      .filter((b) => builds.includes(b.id) && isDead(b.folderId))
      .map((b) => b.id);
    if (orphanBuilds.length) await buildStore.moveBuilds(orphanBuilds, null);

    const orphanComps = (await compStore.listComps())
      .filter((c) => comps.includes(c.id) && isDead(c.folderId));
    for (const comp of orphanComps) {
      await compStore.upsertComp({ ...comp, folderId: null });
    }
  }

  return {
    /**
     * What the trash view shows: one row per thing the user actually deleted.
     * Items a folder delete dragged along are in the trash too, but they are not
     * batch roots, so they stay rolled up under the folder.
     */
    async listTrash() {
      const { builds, comps, folders } = await readTrash();
      const rows = [
        ...builds.filter((b) => b.trashRoot).map((b) => ({
          type: "build", id: b.id, name: b.title, deletedAt: b.deletedAt,
          profession: b.profession || "", folderId: b.folderId || null,
        })),
        ...comps.filter((c) => c.trashRoot).map((c) => ({
          type: "comp", id: c.id, name: c.name, deletedAt: c.deletedAt,
          folderId: c.folderId || null,
        })),
        ...folders.filter((f) => f.trashRoot).map((f) => ({
          type: "folder", id: f.id, name: f.name, deletedAt: f.deletedAt,
          folderId: f.parentId || null,
        })),
      ];
      // Most recently deleted first — that is what someone opening the trash to
      // undo a mistake is looking for.
      return rows.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    },

    async trashBuilds(ids, { at } = {}) {
      return buildStore.trashBuilds(ids, { at, batchId: crypto.randomUUID() });
    },

    async trashComps(ids, { at } = {}) {
      return compStore.trashComps(ids, { at, batchId: crypto.randomUUID() });
    },

    /** Trashes the folder subtree plus every build and comp inside it. */
    async trashFolder(id, { at } = {}) {
      const batchId = crypto.randomUUID();
      const stamp = at || new Date().toISOString();
      const folderIds = await folderStore.trashFolderTree(id, { at: stamp, batchId });
      if (!folderIds.length) return { folders: [], builds: [], comps: [] };

      const inSubtree = new Set(folderIds);
      const [builds, comps] = await Promise.all([buildStore.listBuilds(), compStore.listComps()]);
      const buildIds = builds.filter((b) => inSubtree.has(b.folderId)).map((b) => b.id);
      const compIds = comps.filter((c) => inSubtree.has(c.folderId)).map((c) => c.id);

      // root: false — these are not their own trash rows, they belong to the folder.
      if (buildIds.length) await buildStore.trashBuilds(buildIds, { at: stamp, batchId, root: false });
      if (compIds.length) await compStore.trashComps(compIds, { at: stamp, batchId, root: false });
      return { folders: folderIds, builds: buildIds, comps: compIds };
    },

    async restore(selection) {
      const trash = await readTrash();
      const { builds, comps, folders } = expandBatches(selection, trash);
      // Folders first: a build restored before its folder would briefly point at
      // a folder that does not exist.
      if (folders.length) await folderStore.restoreFolders(folders);
      if (builds.length) await buildStore.restoreBuilds(builds);
      if (comps.length) await compStore.restoreComps(comps);
      await reattachOrphans({ builds, comps, folders });
      return { builds, comps, folders };
    },

    /**
     * Permanent removal. This is the only place records leave disk, so it is
     * where the cascades the trash deferred finally run.
     */
    async purge(selection) {
      const trash = await readTrash();
      const { builds, comps, folders } = expandBatches(selection, trash);

      for (const id of builds) {
        await compStore.removeBuildFromComps(id);
        await historyStore.deleteHistory(id).catch(() => {});
      }
      if (comps.length) await buildStore.clearCompFromBuilds(comps);
      if (folders.length) await buildStore.clearFolderFromBuilds(folders);

      return {
        builds: builds.length ? await buildStore.purgeTrashedBuilds(null, builds) : [],
        comps: comps.length ? await compStore.purgeTrashedComps(null, comps) : [],
        folders: folders.length ? await folderStore.purgeTrashedFolders(null, folders) : [],
      };
    },

    /** The startup sweep: anything past the retention window goes for good. */
    async purgeExpired(now = new Date()) {
      const cutoff = new Date(new Date(now).getTime() - RETENTION_DAYS * DAY_MS).toISOString();
      const { builds, comps, folders } = await readTrash();
      const expired = (records) => records.filter((r) => r.deletedAt < cutoff).map((r) => r.id);
      return this.purge({
        builds: expired(builds),
        comps: expired(comps),
        folders: expired(folders),
      });
    },

    async empty() {
      const { builds, comps, folders } = await readTrash();
      return this.purge({
        builds: builds.map((b) => b.id),
        comps: comps.map((c) => c.id),
        folders: folders.map((f) => f.id),
      });
    },
  };
}

module.exports = { createTrash, RETENTION_DAYS };
