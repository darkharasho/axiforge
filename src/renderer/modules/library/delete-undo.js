"use strict";

// Snapshot/restore for the two library deletes that undo has to reverse.
//
// Both deletes cascade in the main process, so reversing them needs state
// captured BEFORE the delete lands:
//   • builds:delete   also runs compStore.removeBuildFromComps, which strips the
//     build from every comp's buildIds AND its party-line slots.
//   • folders:delete  cascades to descendant folders and then nulls the folderId
//     of every build inside the subtree (clearFolderFromBuilds).
//
// Capture is pure and deep-copies, so a later edit to live `state` can't corrupt
// a pending undo. Restore takes the desktopApi surface it needs as an argument,
// which keeps both halves testable without a DOM.

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * @param {string[]} ids - build ids about to be deleted
 * @param {{builds: object[], comps: object[]}} state
 */
export function captureBuildDeletion(ids, { builds = [], comps = [] } = {}) {
  const idSet = new Set(ids);
  const doomed = builds.filter((b) => idSet.has(b.id));

  // A comp is affected if it lists the build, or holds it in a party-line slot.
  const affected = comps.filter(
    (c) =>
      (c.buildIds || []).some((id) => idSet.has(id)) ||
      (c.partyLines || []).some((line) => (line.slots || []).some((id) => idSet.has(id))),
  );

  return { builds: clone(doomed), comps: clone(affected) };
}

export async function restoreBuildDeletion(snapshot, api) {
  if (!snapshot) return;
  // Builds first: a comp referencing a build that doesn't exist yet would render
  // an empty slot until the next refresh.
  for (const build of snapshot.builds) await api.saveBuild(build);
  for (const comp of snapshot.comps) await api.saveComp(comp);
}

/**
 * @param {string} folderId - root of the subtree about to be deleted
 * @param {{folders: object[], builds: object[]}} state
 */
export function captureFolderDeletion(folderId, { folders = [], builds = [] } = {}) {
  // Breadth-first from the root, so the list is already parents-before-children —
  // restoring a child before its parent would leave it orphaned at the root.
  const subtree = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    const folder = folders.find((f) => f.id === id);
    if (!folder) continue;
    subtree.push(folder);
    for (const child of folders.filter((f) => f.parentId === id)) queue.push(child.id);
  }

  const subtreeIds = new Set(subtree.map((f) => f.id));
  // Group by original folder so each build goes back exactly where it was, not
  // all of them to the subtree root.
  const byFolder = new Map();
  for (const build of builds) {
    if (!subtreeIds.has(build.folderId)) continue;
    if (!byFolder.has(build.folderId)) byFolder.set(build.folderId, []);
    byFolder.get(build.folderId).push(build.id);
  }

  return {
    folders: clone(subtree),
    buildMoves: [...byFolder.entries()].map(([id, ids]) => ({ folderId: id, ids })),
  };
}

export async function restoreFolderDeletion(snapshot, api) {
  if (!snapshot) return;
  // Every folder must exist before any move — builds:move rejects an unknown
  // folder id outright.
  for (const folder of snapshot.folders) await api.saveFolder(folder);
  for (const { folderId, ids } of snapshot.buildMoves) await api.moveBuilds(ids, folderId);
}
