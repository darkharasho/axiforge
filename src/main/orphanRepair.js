"use strict";

// Startup repair for records whose folder no longer exists.
//
// A build or comp is only reachable through its folder: the library renders
// root-level items when `folderId` is null and a folder's contents when it
// matches a live folder id. A record pointing at a folder id that resolves to
// neither is invisible — present on disk, absent from every view, with no UI
// anywhere that can reach it. Users read that as "the app ate my comps".
//
// Releases before 0.14.0 could produce exactly that: deleting a folder cleared
// `folderId` on the builds inside it but left comps pointing at the dead id.
// The trash's restore path has always repaired its own orphans (trash.js
// reattachOrphans); nothing repaired the ones already on disk.
//
// Trashed folders still count as real parents — a trashed build sitting in a
// trashed folder is waiting for a restore, not orphaned — so this only moves
// records whose folder id matches NO folder at all, live or trashed.

/**
 * @param {{buildStore: object, compStore: object, folderStore: object}} stores
 * @returns {Promise<{builds: string[], comps: string[], folders: string[]}>}
 *   ids of the records reattached to the root.
 */
async function repairOrphans({ buildStore, compStore, folderStore }) {
  const [live, trashed] = await Promise.all([
    folderStore.listFolders(),
    folderStore.listTrashedFolders(),
  ]);
  const known = new Set([...live, ...trashed].map((f) => f.id));
  const isDead = (id) => Boolean(id) && !known.has(id);

  const folders = [];
  for (const folder of live) {
    if (!isDead(folder.parentId)) continue;
    await folderStore.upsertFolder({ ...folder, parentId: null });
    folders.push(folder.id);
  }

  const builds = (await buildStore.listBuilds())
    .filter((b) => isDead(b.folderId))
    .map((b) => b.id);
  if (builds.length) await buildStore.moveBuilds(builds, null);

  const comps = [];
  for (const comp of await compStore.listComps()) {
    if (!isDead(comp.folderId)) continue;
    await compStore.upsertComp({ ...comp, folderId: null });
    comps.push(comp.id);
  }

  return { builds, comps, folders };
}

module.exports = { repairOrphans };
