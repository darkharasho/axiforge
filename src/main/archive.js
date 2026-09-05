"use strict";

const crypto = require("node:crypto");

/**
 * The archive: a place to put things you are done with but not done needing.
 *
 * Deliberately NOT a second trash. The trash is a staging area on a clock —
 * records there are gone as far as the rest of the app is concerned, and in 30
 * days they are gone for real. An archived record is the opposite: it stays a
 * fully live record everywhere in main. Comps still resolve archived builds,
 * published links still work, team sync still carries it, `listBuilds()` still
 * returns it. The stamp says one thing only: keep this out of the library view.
 *
 * That is what makes this cheap. Hiding archived records from `listBuilds()`
 * would have rippled through ~100 call sites in teamSync, publishing and orphan
 * repair, and in most of them "hidden" would have been read as "deleted".
 * Filtering happens in the renderer's library views instead, where the question
 * "should the user see this right now?" actually belongs.
 *
 * What this module owns is the part that spans stores: the folder cascade, so
 * archiving a folder takes its subtree and contents with it under one batch id
 * and un-archiving puts the whole thing back in one act.
 */
function createArchive({ buildStore, compStore, folderStore }) {
  async function readArchive() {
    const [builds, comps, folders] = await Promise.all([
      buildStore.listArchivedBuilds(),
      compStore.listArchivedComps(),
      folderStore.listArchivedFolders(),
    ]);
    return { builds, comps, folders };
  }

  /**
   * A folder archive drags its subtree along under one batch id. Un-archiving
   * any member has to act on the whole batch, or a folder comes back empty
   * while its builds stay hidden — or worse, builds reappear at a folder the
   * library is still not drawing.
   */
  function expandBatches(selection, archive) {
    const wanted = {
      builds: new Set(selection.builds || []),
      comps: new Set(selection.comps || []),
      folders: new Set(selection.folders || []),
    };

    const batchIds = new Set();
    const collect = (records, ids) => {
      for (const record of records) {
        if (ids.has(record.id) && record.archiveBatchId) batchIds.add(record.archiveBatchId);
      }
    };
    collect(archive.builds, wanted.builds);
    collect(archive.comps, wanted.comps);
    collect(archive.folders, wanted.folders);

    if (batchIds.size) {
      const pullIn = (records, ids) => {
        for (const record of records) {
          if (batchIds.has(record.archiveBatchId)) ids.add(record.id);
        }
      };
      pullIn(archive.builds, wanted.builds);
      pullIn(archive.comps, wanted.comps);
      pullIn(archive.folders, wanted.folders);
    }

    return {
      builds: [...wanted.builds],
      comps: [...wanted.comps],
      folders: [...wanted.folders],
    };
  }

  return {
    /**
     * What the archive view shows: one row per thing the user archived. Items a
     * folder archive dragged along are archived too, but they are not batch
     * roots, so they stay rolled up under the folder.
     */
    async listArchive() {
      const { builds, comps, folders } = await readArchive();
      const rows = [
        ...builds.filter((b) => b.archiveRoot).map((b) => ({
          type: "build", id: b.id, name: b.title, archivedAt: b.archivedAt,
          profession: b.profession || "", folderId: b.folderId || null,
        })),
        ...comps.filter((c) => c.archiveRoot).map((c) => ({
          type: "comp", id: c.id, name: c.name, archivedAt: c.archivedAt,
          folderId: c.folderId || null,
        })),
        ...folders.filter((f) => f.archiveRoot).map((f) => ({
          type: "folder", id: f.id, name: f.name, archivedAt: f.archivedAt,
          folderId: f.parentId || null,
        })),
      ];
      // Most recently archived first.
      return rows.sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
    },

    async archiveBuilds(ids, { at } = {}) {
      return buildStore.setBuildsArchived(ids, true, { at, batchId: crypto.randomUUID() });
    },

    async archiveComps(ids, { at } = {}) {
      return compStore.setCompsArchived(ids, true, { at, batchId: crypto.randomUUID() });
    },

    /** Archives the folder subtree plus every build and comp inside it. */
    async archiveFolder(id, { at } = {}) {
      const batchId = crypto.randomUUID();
      const stamp = at || new Date().toISOString();
      const folderIds = await folderStore.setFolderTreeArchived(id, true, { at: stamp, batchId });
      if (!folderIds.length) return { folders: [], builds: [], comps: [] };

      const inSubtree = new Set(folderIds);
      const [builds, comps] = await Promise.all([buildStore.listBuilds(), compStore.listComps()]);
      const buildIds = builds.filter((b) => inSubtree.has(b.folderId)).map((b) => b.id);
      const compIds = comps.filter((c) => inSubtree.has(c.folderId)).map((c) => c.id);

      // root: false — these are not their own archive rows, they belong to the folder.
      if (buildIds.length) await buildStore.setBuildsArchived(buildIds, true, { at: stamp, batchId, root: false });
      if (compIds.length) await compStore.setCompsArchived(compIds, true, { at: stamp, batchId, root: false });
      return { folders: folderIds, builds: buildIds, comps: compIds };
    },

    /**
     * Put a selection back in the library. Unlike the trash there is nothing to
     * reattach: an archived record never stopped pointing at a real folder,
     * because archiving a folder archives its contents rather than orphaning
     * them, and nothing is ever purged out from under it.
     */
    async unarchive(selection) {
      const archive = await readArchive();
      const { builds, comps, folders } = expandBatches(selection, archive);
      // Folders first, mirroring restore: a build un-archived before its folder
      // would briefly sit in a folder the library still is not drawing.
      for (const id of folders) await folderStore.setFolderTreeArchived(id, false);
      if (builds.length) await buildStore.setBuildsArchived(builds, false);
      if (comps.length) await compStore.setCompsArchived(comps, false);
      return { builds, comps, folders };
    },
  };
}

module.exports = { createArchive };
