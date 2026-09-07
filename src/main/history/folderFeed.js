"use strict";

/**
 * The folder history feed: one newest-first timeline for every build and comp
 * in a folder and its descendants.
 *
 * This used to sit inline in the `folders:get-history` handler and read every
 * record's ENTIRE log (`getAllHistory`) before throwing almost all of it away.
 * It now collects the record ids that belong to the folder first and asks each
 * store for only the tail it can possibly show, which is what `listTails` is
 * for: a folder with a hundred builds no longer pays to reconstruct a hundred
 * full histories to render ten rows.
 *
 * Entries are annotated with `recordId` / `recordKind` / `recordTitle` /
 * `recordDeleted`. The pre-v2 names were `buildTitle` / `buildDeleted`, which
 * carried a COMP's name on a comp entry and left the panel to un-confuse it.
 *
 * @param {{folderId: string, folders: object[], builds: object[],
 *          comps: object[], buildHistory: object, compHistory: object,
 *          limit?: number}} input
 * @returns {Promise<object[]>} newest-first, at most `limit` entries
 */
async function buildFolderFeed({ folderId, folders = [], builds = [], comps = [], buildHistory, compHistory, limit = 100 }) {
  // This folder and every folder beneath it.
  const folderIds = new Set();
  const queue = [folderId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (folderIds.has(id)) continue;
    folderIds.add(id);
    for (const f of folders) {
      if (f && f.parentId === id) queue.push(f.id);
    }
  }

  // Trashed builds are included on purpose. A deletion is the single most
  // useful thing this panel can show — especially in a shared folder, where
  // someone else performed it — and listBuilds() filters trashed records out,
  // so the build simply vanished from its own folder's history the moment it
  // was deleted, taking every earlier entry with it. The caller passes the
  // trashed records in alongside the live ones; `recordDeleted` lets the panel
  // say the record is currently in the trash, so "Restore this version" reads
  // as the undelete it is.
  const index = (records, titleOf) => {
    const map = new Map();
    for (const r of records) {
      if (!r || !folderIds.has(r.folderId)) continue;
      map.set(r.id, { title: titleOf(r) || r.id, deleted: !!r.deletedAt });
    }
    return map;
  };
  const buildInfo = index(builds, (b) => b.title);
  // A comp is the thing a squad actually argues over, so its history belongs in
  // the same timeline rather than a second panel nobody opens.
  const compInfo = index(comps, (c) => c.name);

  const annotate = (entries, kind, info) => entries.map((e) => {
    const meta = info.get(e.recordId) || {};
    return { ...e, recordKind: kind, recordTitle: meta.title, recordDeleted: !!meta.deleted };
  });

  const [buildEntries, compEntries] = await Promise.all([
    buildHistory ? buildHistory.listTails([...buildInfo.keys()], limit) : [],
    compHistory ? compHistory.listTails([...compInfo.keys()], limit) : [],
  ]);

  return [...annotate(buildEntries, "build", buildInfo), ...annotate(compEntries, "comp", compInfo)]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, limit);
}

module.exports = { buildFolderFeed };
