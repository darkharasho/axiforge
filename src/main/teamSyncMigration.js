"use strict";
// One-click migration of a legacy GitHub-org shared library (src/main/sharedLibrary.js,
// removed) into a Team. Kept out of teamSync.js — the engine is big enough —
// and used through the thin TeamSync.legacyStatus() / .migrateOrgLibrary() /
// .cleanupLegacyFolders() delegates.
//
// Shape of the legacy state on disk:
//   * auth.sharedLibrary = { orgName, repoName, isOwner }
//   * top-level folders with { shared: true, orgName, lastSyncedAt }
//
// Ordering (R5): resolve the target team and its root id UP FRONT, upload
// everything with ids preserved, and only flip local state when NOTHING
// failed — a partial failure leaves the library exactly as it was so the user
// can simply run the migration again.

function legacyRootsIn(folders) {
  return folders.filter((f) => f.orgName && !f.teamId && !f.parentId);
}

async function legacyStatus(teamSync) {
  const auth = await teamSync.buildStore.getAuth();
  const folders = await teamSync.folderStore.listFolders();
  const roots = legacyRootsIn(folders);
  const authOrg = (auth && auth.sharedLibrary && auth.sharedLibrary.orgName) || null;
  if (!roots.length && !authOrg) return { hasLegacy: false, orgName: null, folders: [] };
  const builds = await teamSync.buildStore.listBuilds();
  const comps = await teamSync.compStore.listComps();
  return {
    hasLegacy: true,
    orgName: authOrg || roots[0].orgName || null,
    folders: roots.map((r) => {
      const tree = new Set(teamSync.collectFolderTree(r.id, folders));
      return {
        id: r.id,
        name: r.name,
        builds: builds.filter((b) => tree.has(b.folderId)).length,
        comps: comps.filter((c) => tree.has(c.folderId)).length,
      };
    }),
  };
}

// Every item of `rootId`'s subtree as bulk-upload payloads, ids preserved.
// `teamRootId` is the folder that IS the team root: it is never an item itself,
// and its direct children upload with `parentId: null` (the server's "directly
// under the team root" convention).
function itemsForTree(teamSync, rootId, teamRootId, folders, builds, comps) {
  const S = teamSync.constructor;
  const treeIds = teamSync.collectFolderTree(rootId, folders);
  const treeSet = new Set(treeIds);
  const items = [];
  for (const id of treeIds) {
    if (id === teamRootId) continue;
    const f = folders.find((x) => x.id === id);
    items.push({ itemId: id, type: "folder", parentId: teamSync.parentIdFor(f.parentId, teamRootId), body: S.folderBody(f), baseVersion: null });
  }
  for (const b of builds) {
    if (treeSet.has(b.folderId)) items.push({ itemId: b.id, type: "build", parentId: teamSync.parentIdFor(b.folderId, teamRootId), body: S.buildBody(b), baseVersion: null });
  }
  for (const c of comps) {
    if (treeSet.has(c.folderId)) items.push({ itemId: c.id, type: "comp", parentId: teamSync.parentIdFor(c.folderId, teamRootId), body: S.compBody(c), baseVersion: null });
  }
  return items;
}

/**
 * @param {object} teamSync
 * @param {{ teamId?: string, teamName?: string }} opts  target team (existing id, or a name to create)
 * @param {(p: { done: number, total: number, foldersDone: number, foldersTotal: number }) => void} [onProgress]
 * @returns {Promise<{ teamId: string, uploaded: number, failed: object[], foldersMigrated: number }>}
 */
async function migrateOrgLibrary(teamSync, { teamId = null, teamName = null } = {}, onProgress) {
  const session = await teamSync.getSession();
  if (!session) throw new Error("Enable team sync first.");
  const status = await legacyStatus(teamSync);
  const roots = status.folders;
  if (!status.hasLegacy || !roots.length) throw new Error("Nothing to migrate.");

  let folders = await teamSync.folderStore.listFolders();

  // A single legacy root becomes the team root itself (nothing gets deeper);
  // any other root moves UNDER a team root and so gains a level of nesting.
  // folderStore caps nesting at 3, and anything deeper would be silently
  // dropped on every teammate's pull — so refuse HERE, before a team is
  // created, or a failed pre-flight would leave a stray team behind.
  const singleRootBecomesTeamRoot = !teamId && roots.length === 1;
  if (!singleRootBecomesTeamRoot) {
    for (const r of roots) {
      const depths = teamSync._relativeDepths(r.id, folders);
      for (const d of depths.values()) {
        if (d >= 2) throw new Error(`"${r.name}" has sub-folders nested too deeply to move into a team. Move them up one level and try again.`);
      }
    }
  }

  // (a) Resolve the target team and the id of the folder that will be its root
  //     BEFORE uploading anything, so nothing has to look the root up mid-run.
  let targetTeamId = teamId;
  let teamRootId = null;
  let createdTeam = null;     // { team, role } when this call created the team
  let createdRootFolderId = null; // a brand-new local root folder we may have to roll back
  let teamRole = "owner";
  if (targetTeamId) {
    const root = teamSync.rootFolderForTeam(targetTeamId, folders);
    if (!root) throw new Error("Team not found locally.");
    teamRootId = root.id;
    teamRole = root.role || "owner";
  } else {
    // A single legacy root becomes the team root itself: we ask the server to
    // reuse its id so teammates whose local copy has the same folder id
    // re-link in place when they join.
    const reuseId = roots.length === 1 ? roots[0].id : null;
    const name = teamName || status.orgName || "My team";
    let out;
    try {
      out = await teamSync.api.createTeam(name, reuseId ? { id: reuseId } : {});
      createdTeam = out;
    } catch (err) {
      // The id we asked to reuse is taken. If it is taken by a team WE own,
      // an earlier run created it and could not roll it back — adopt it and
      // re-upload (bulk writes are idempotent: a 409 carrying the live
      // `current` counts as uploaded). Anything else is a real failure.
      if (!reuseId || !err || err.code !== "SYNC_CONFLICT") throw err;
      // Deliberately the raw API, not teamSync.listTeams(): the latter would
      // _ensureRootFolder() the local legacy root into a team root (clearing
      // its legacy fields) before we know the upload succeeds.
      const list = await teamSync.api.listTeams().catch(() => null);
      const owned = list && list.find((t) => t.team.id === reuseId && t.role === "owner");
      if (!owned) throw err;
      out = owned; // adopted, not created — never rolled back by this run
    }
    targetTeamId = out.team.id;
    teamRole = out.role || "owner";
    if (reuseId) {
      teamRootId = reuseId; // flipped to a team root only on success (R5c)
    } else {
      const idsBefore = new Set(folders.map((f) => f.id));
      teamRootId = await teamSync._ensureRootFolder(out.team, out.role);
      // Only a folder we actually created may be rolled back on failure.
      createdRootFolderId = idsBefore.has(teamRootId) ? null : teamRootId;
      folders = await teamSync.folderStore.listFolders();
    }
  }

  // (b) Upload everything, ids preserved.
  const builds = await teamSync.buildStore.listBuilds();
  const comps = await teamSync.compStore.listComps();
  const perRoot = roots.map((r) => ({ root: r, items: itemsForTree(teamSync, r.id, teamRootId, folders, builds, comps) }));
  const total = perRoot.reduce((n, x) => n + x.items.length, 0);
  const failed = [];
  let uploaded = 0;
  let base = 0;
  let foldersDone = 0;
  const rollback = () => rollbackCreatedTeam(teamSync, { teamId: targetTeamId, teamName: createdTeam && createdTeam.team.name, createdRootFolderId });
  try {
    for (const { items } of perRoot) {
      const res = await teamSync._bulkUpload(targetTeamId, items, (p) => {
        if (onProgress) onProgress({ done: base + p.done, total, foldersDone, foldersTotal: roots.length });
      });
      uploaded += res.uploaded;
      failed.push(...res.failed);
      base += items.length;
      foldersDone += 1;
      if (onProgress) onProgress({ done: base, total, foldersDone, foldersTotal: roots.length });
    }
  } catch (err) {
    // _bulkUpload THROWS (rather than reporting per-item failures) on offline,
    // 5xx and exhausted rate-limit waits. Roll the created team back here too:
    // otherwise it survives half-populated, blocks the id on the retry, and the
    // next poll would adopt the local root as its root folder.
    if (createdTeam) {
      const problem = await rollback();
      if (problem) { problem.cause = err; throw problem; }
    }
    throw err;
  }

  if (failed.length) {
    // Leave the local library untouched so the user can retry. A team we
    // created in this call would otherwise block the retry (its id is taken),
    // so roll it back — nothing local points at it yet.
    if (createdTeam) {
      const problem = await rollback();
      if (problem) { problem.failed = failed; throw problem; }
    }
    return { teamId: targetTeamId, uploaded, failed, foldersMigrated: 0 };
  }

  // (c) Everything landed — flip local state over to the team.
  for (const { root } of perRoot) {
    const current = (await teamSync.folderStore.listFolders()).find((f) => f.id === root.id);
    if (!current) continue;
    if (root.id === teamRootId) {
      await teamSync.folderStore.upsertFolder({
        id: current.id, name: (createdTeam && createdTeam.team.name) || current.name, parentId: null,
        sortOrder: current.sortOrder, shared: true, teamId: targetTeamId, role: teamRole,
      });
    } else {
      // Becomes a plain folder under the team root (team membership is carried
      // by the root, not by every folder in the tree).
      await teamSync.folderStore.upsertFolder({ id: current.id, name: current.name, parentId: teamRootId, sortOrder: current.sortOrder, shared: false });
    }
  }
  await clearLegacy(teamSync);
  teamSync._emit("sync-status", { status: "synced", folderId: teamRootId });
  return { teamId: targetTeamId, uploaded, failed, foldersMigrated: roots.length };
}

// Undo a team this run created after the migration failed, so the user can
// simply run it again. Returns an Error to throw when the SERVER-side delete
// failed — that team now needs manual attention and must not be swallowed.
async function rollbackCreatedTeam(teamSync, { teamId, teamName, createdRootFolderId }) {
  let deleteError = null;
  try {
    await teamSync.api.deleteTeam(teamId);
  } catch (err) {
    deleteError = err;
  }
  if (createdRootFolderId) await teamSync.folderStore.deleteFolder(createdRootFolderId).catch(() => {});
  await teamSync.syncStore.removeTeam(teamId).catch(() => {});
  if (!deleteError) return null;
  return new Error(
    `Migration failed and the team "${teamName || teamId}" (${teamId}) could not be removed: ${deleteError.message} ` +
    "Delete it in Settings \u2192 Teams before trying the migration again."
  );
}

// Drop every trace of the GitHub-org library: folder fields first, then the
// auth blob that drove it. Only folders that carry `orgName` are touched —
// `lastSyncedAt` is a live field on team roots that pull keeps up to date.
async function clearLegacy(teamSync) {
  for (const f of await teamSync.folderStore.listFolders()) {
    if (f.orgName) await teamSync.folderStore.clearLegacyFields(f.id);
  }
  await clearAuthSharedLibrary(teamSync);
}

async function clearAuthSharedLibrary(teamSync) {
  const auth = await teamSync.buildStore.getAuth();
  if (!auth || auth.sharedLibrary === undefined) return;
  const next = { ...auth };
  delete next.sharedLibrary;
  await teamSync.buildStore.saveAuth(next);
}

// Startup housekeeping (non-destructive): a folder that is now part of a team
// can't be a GitHub-org shared folder any more, so drop its legacy fields —
// this is what stops the orphan banner following an already-migrated library
// around. When nothing legacy is left on disk, the stale auth blob goes too.
async function cleanupLegacyFolders(teamSync) {
  const folders = await teamSync.folderStore.listFolders();
  let cleared = 0;
  for (const f of folders) {
    if (!f.orgName) continue;
    if (f.teamId || teamSync.teamRootFor(f.id, folders)) {
      await teamSync.folderStore.clearLegacyFields(f.id);
      cleared += 1;
    }
  }
  if (!legacyRootsIn(await teamSync.folderStore.listFolders()).length) await clearAuthSharedLibrary(teamSync);
  return { cleared };
}

module.exports = { migrateOrgLibrary, legacyStatus, cleanupLegacyFolders };
