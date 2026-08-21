"use strict";

// Ownership/publish decisions shared by the main-process IPC handlers. They live
// here (not inline in index.js) so the rules can be unit-tested without booting
// Electron.

/**
 * Resolve the team roots on both sides of a (possible) move and refuse it when
 * the current user may not remove the item from the source team.
 *
 * MUST be called BEFORE the local write. A guard that fires afterwards leaves
 * the item locally moved with a `put` enqueued to the destination and no
 * `delete` enqueued to the source — and since the source's server version is
 * unchanged, no pull ever repairs it (permanent divergence).
 *
 * @param {{teamSync: object, findTeamRoot: (folderId: string|null) => Promise<object|null>}} deps
 * @param {{itemId: string, oldFolderId: string|null, newFolderId: string|null, label: string}} move
 * @returns {Promise<{oldRoot: object|null, newRoot: object|null}>} the resolved
 *   roots, so callers can enqueue against them without re-resolving.
 */
async function assertCanMoveOutOfTeam({ teamSync, findTeamRoot }, { itemId, oldFolderId, newFolderId, label }) {
  const oldRoot = oldFolderId ? await findTeamRoot(oldFolderId) : null;
  const newRoot = newFolderId ? await findTeamRoot(newFolderId) : null;
  if (oldFolderId && oldFolderId !== newFolderId && oldRoot && oldRoot.id !== newRoot?.id) {
    if (!(await teamSync.canDelete(oldRoot.teamId, itemId))) {
      throw new Error(`Only the team owner or the ${label}'s creator can move it out of the team.`);
    }
  }
  return { oldRoot, newRoot };
}

/**
 * Decide how a comp publish should treat one contained build.
 *
 * A build previously published by a *different* owner keeps its existing URL:
 * we neither re-upload its encrypted file into the current publisher's repo nor
 * re-stamp `publishedOwner`. Re-uploading would move the bytes while the stale
 * `publishedOwner` kept the link pointing at the original owner's copy. This
 * mirrors `builds:publish-build`'s PUBLISHED_BY_OTHER semantics and keeps
 * already-shared URLs stable.
 *
 * @param {{build: object, owner: string, force?: boolean, slug: string}} args
 * @returns {{foreignOwner: string|null, needsRecord: boolean}} `foreignOwner` is
 *   the other user's login when the build must be left alone; `needsRecord` is
 *   whether the local record's publish metadata has to be re-stamped.
 */
function decideCompBuildPublish({ build, owner, force = false, slug }) {
  // A foreign owner is only actionable when there really is a published copy to
  // link to; a half-written record falls through to a normal publish.
  const hasCopy = Boolean(build.publishedFileId && build.publishedKey);
  if (hasCopy && build.publishedOwner && build.publishedOwner !== owner && !force) {
    return { foreignOwner: build.publishedOwner, needsRecord: false };
  }
  const needsRecord = !build.publishedFileId || build.publishedSlug !== slug || build.publishedOwner !== owner;
  return { foreignOwner: null, needsRecord };
}

/**
 * Refuse to move `folderId` under `newParentId` when any folder in its subtree
 * would end up deeper than `maxDepth` (FolderStore's rule: a folder may only be
 * created when its parent's depth < maxDepth, root folders being depth 1).
 * FolderStore checks only the moved folder itself, so a legal-looking move can
 * carry grandchildren past the limit — locally tolerated, but every teammate's
 * pull then throws on those folders and their sync stalls.
 *
 * @param {{folders: object[], folderId: string, newParentId: string|null, maxDepth?: number}} args
 */
function assertFolderTreeFits({ folders, folderId, newParentId, maxDepth = 3 }) {
  let parentDepth = 0;
  for (let cur = newParentId; cur; ) {
    parentDepth += 1;
    const parent = folders.find((f) => f.id === cur);
    cur = parent ? parent.parentId : null;
    if (parentDepth > maxDepth) break;
  }
  // Relative depth of every descendant (BFS so parents are visited first).
  const rel = new Map([[folderId, 0]]);
  const queue = [folderId];
  let maxRel = 0;
  while (queue.length) {
    const id = queue.shift();
    for (const f of folders) {
      if (f.parentId !== id || rel.has(f.id)) continue;
      const d = rel.get(id) + 1;
      rel.set(f.id, d);
      if (d > maxRel) maxRel = d;
      queue.push(f.id);
    }
  }
  if (parentDepth + 1 + maxRel > maxDepth) throw new Error("FOLDER_TOO_DEEP");
}

module.exports = { assertCanMoveOutOfTeam, assertFolderTreeFits, decideCompBuildPublish };
