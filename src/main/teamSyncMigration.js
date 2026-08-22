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

// Every folder that still carries GitHub-org legacy markers and is not part of
// a team. m6: a legacy folder is NOT required to be top-level — the old sync
// could leave one nested, and requiring `!parentId` made it permanently
// unmigratable while `cleanupLegacyFolders` still dropped `auth.sharedLibrary`
// (destroying the only remaining "you have a legacy library" signal).
// A legacy folder that sits inside ANOTHER legacy folder is part of that root's
// tree, not a root of its own.
function legacyRootsIn(folders) {
  const legacy = folders.filter((f) => f.orgName && !f.teamId);
  const legacyIds = new Set(legacy.map((f) => f.id));
  const hasLegacyAncestor = (f) => {
    const seen = new Set([f.id]);
    let cur = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (legacyIds.has(cur.id)) return true;
      cur = cur.parentId ? folders.find((x) => x.id === cur.parentId) : null;
    }
    return false;
  };
  return legacy.filter((f) => !hasLegacyAncestor(f));
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
    // The tree's own root always lands directly under the team root — its local
    // parent (m6: a legacy root may be nested) is not part of the team.
    const parentId = id === rootId ? null : teamSync.parentIdFor(f.parentId, teamRootId);
    items.push({ itemId: id, type: "folder", parentId, body: S.folderBody(f), baseVersion: null });
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
 * @returns {Promise<{ teamId: string, uploaded: number, failed: object[], skipped: object[], foldersMigrated: number, note?: string }>}
 */
async function migrateOrgLibrary(teamSync, { teamId = null, teamName = null } = {}, onProgress) {
  const session = await teamSync.getSession();
  if (!session) throw new Error("Enable team sync first.");
  // m2: one migration at a time. Two overlapping runs race on the same team id
  // and each other's rollback (run A can delete the team run B just committed
  // to). pullTeam/flushTeam have the same guard.
  if (teamSync._migrationInProgress) throw new Error("A library migration is already running.");
  const status = await legacyStatus(teamSync);
  const roots = status.folders;
  if (!status.hasLegacy || !roots.length) throw new Error("Nothing to migrate.");

  teamSync._migrationInProgress = true;
  try {
    return await runMigration(teamSync, { teamId, teamName }, onProgress, { status, roots });
  } finally {
    teamSync._migrationInProgress = false;
  }
}

async function runMigration(teamSync, { teamId, teamName }, onProgress, { status, roots }) {
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
  // M2 belt-and-braces: snapshot the legacy markers of every root we are about
  // to migrate, so a rollback can put them back even if something else cleared
  // them behind our back.
  const legacySnapshot = roots.map((r) => {
    const f = folders.find((x) => x.id === r.id);
    return f ? { id: f.id, orgName: f.orgName, lastSyncedAt: f.lastSyncedAt } : null;
  }).filter(Boolean);

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
  const skipped = [];
  const uploadedIds = [];
  let uploaded = 0;
  let base = 0;
  let foldersDone = 0;
  const rollbackTeam = () => rollbackCreatedTeam(teamSync, {
    teamId: targetTeamId, teamName: createdTeam && createdTeam.team.name, createdRootFolderId, legacySnapshot,
  });
  // M1: when the team already existed (or was adopted from an earlier run) we
  // must NOT delete it — but the items this run pushed are the user's private
  // library and would stay live and visible to every teammate. Take them back
  // out again.
  const rollbackItems = () => rollbackUploadedItems(teamSync, targetTeamId, uploadedIds);
  const undo = async () => (createdTeam ? rollbackTeam() : rollbackItems());
  // M3: `onProgress` is an IPC send to a WebContents that may be destroyed
  // mid-upload. A throw here used to propagate into the catch below and roll
  // back a team whose items had all landed.
  const report = (p) => { if (onProgress) { try { onProgress(p); } catch { /* ignore */ } } };

  try {
    for (const { items } of perRoot) {
      const res = await teamSync._bulkUpload(targetTeamId, items, (p) => {
        report({ done: base + p.done, total, foldersDone, foldersTotal: roots.length });
      }, { skipOversize: true });
      uploaded += res.uploaded;
      failed.push(...res.failed);
      skipped.push(...res.skipped);
      uploadedIds.push(...res.uploadedIds);
      base += items.length;
      foldersDone += 1;
      report({ done: base, total, foldersDone, foldersTotal: roots.length });
    }
  } catch (err) {
    // _bulkUpload THROWS (rather than reporting per-item failures) on offline,
    // 5xx and exhausted rate-limit waits. Roll the created team back here too:
    // otherwise it survives half-populated, blocks the id on the retry, and the
    // next poll would adopt the local root as its root folder.
    const problem = await undo();
    if (problem) { problem.cause = err; throw problem; }
    throw err;
  }

  if (failed.length) {
    // Leave the local library untouched so the user can retry. A team we
    // created in this call would otherwise block the retry (its id is taken),
    // so roll it back — and for a pre-existing team, take the items back out.
    const problem = await undo();
    if (problem) { problem.failed = failed; throw problem; }
    return {
      teamId: targetTeamId, uploaded, failed, skipped, foldersMigrated: 0,
      // m7: "Migrated with N failures" never told the user that NOTHING moved
      // locally and that the partial upload was undone.
      note: `Nothing was moved: ${failed.length} item${failed.length === 1 ? "" : "s"} could not be uploaded, and everything this run had already uploaded was removed again. Your library is exactly as it was — fix the problem and run the migration again.`,
    };
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
  const out = { teamId: targetTeamId, uploaded, failed, skipped, foldersMigrated: roots.length };
  if (skipped.length) {
    // m5 / spec §5: an item the server will never accept stays on disk as
    // local-only data rather than blocking the whole migration.
    out.note = `${skipped.length} item${skipped.length === 1 ? " was" : "s were"} too large for the sync server and stayed on this computer only. Everything else is now in the team.`;
  }
  return out;
}

// Undo a team this run created after the migration failed, so the user can
// simply run it again. Returns an Error to throw when the SERVER-side delete
// failed — that team now needs manual attention and must not be swallowed.
async function rollbackCreatedTeam(teamSync, { teamId, teamName, createdRootFolderId, legacySnapshot }) {
  let deleteError = null;
  try {
    await teamSync.api.deleteTeam(teamId);
  } catch (err) {
    deleteError = err;
  }
  if (createdRootFolderId) await teamSync.folderStore.deleteFolder(createdRootFolderId).catch(() => {});
  await teamSync.syncStore.removeTeam(teamId).catch(() => {});
  await restoreLegacyFields(teamSync, legacySnapshot, teamId);
  if (!deleteError) return null;
  return new Error(
    `Migration failed and the team "${teamName || teamId}" (${teamId}) could not be removed: ${deleteError.message} ` +
    "Delete it in Settings → Teams before trying the migration again."
  );
}

// M2: something else (a concurrent listTeams(), a poll) may have converted a
// legacy root into a team root while we were uploading. After a rollback that
// team no longer exists, so put the legacy markers back — otherwise the folder
// is pinned to a dead team with no legacy fields and the migration can never be
// re-run.
async function restoreLegacyFields(teamSync, legacySnapshot, deadTeamId) {
  if (!legacySnapshot || !legacySnapshot.length) return;
  const folders = await teamSync.folderStore.listFolders();
  for (const snap of legacySnapshot) {
    if (!snap.orgName) continue;
    const f = folders.find((x) => x.id === snap.id);
    if (!f) continue;
    if (f.orgName === snap.orgName && !f.teamId) continue; // untouched
    await teamSync.folderStore.upsertFolder({
      id: f.id, name: f.name, parentId: f.parentId || null, sortOrder: f.sortOrder,
      shared: !f.parentId, orgName: snap.orgName,
      ...(snap.lastSyncedAt ? { lastSyncedAt: snap.lastSyncedAt } : {}),
      ...(f.teamId === deadTeamId ? { teamId: null, role: null } : {}),
    }).catch(() => {});
  }
}

// M1: remove the items THIS run pushed into a team it did not create. Deleted
// in reverse upload order so children go before their parents. Returns an Error
// to throw when some items could not be removed — they are live in the team and
// the user has to know.
async function rollbackUploadedItems(teamSync, teamId, uploadedIds) {
  if (!uploadedIds || !uploadedIds.length) return null;
  const stuck = [];
  for (const itemId of [...uploadedIds].reverse()) {
    try {
      const known = await teamSync.syncStore.getVersion(teamId, itemId);
      await teamSync.api.deleteItem(teamId, itemId, known ? known.version : undefined);
    } catch (err) {
      if (!err || err.code !== "SYNC_NOT_FOUND") { stuck.push(itemId); continue; }
    }
    await teamSync.syncStore.removeVersion(teamId, itemId).catch(() => {});
    await teamSync.syncStore.dequeue(teamId, itemId).catch(() => {});
  }
  if (!stuck.length) return null;
  return new Error(
    `Migration failed after ${uploadedIds.length} item${uploadedIds.length === 1 ? "" : "s"} had already been uploaded, and ${stuck.length} of them could not be removed from the team again. ` +
    "Those items are visible to your teammates right now. Delete them from the team folder, or run the migration again to finish it."
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
  // m4: one serialized read-modify-write. Startup runs cleanupLegacyFolders()
  // and pullAll() concurrently; a get-then-save here could otherwise write back
  // a session token that pullAll's 401 handler had just deleted.
  await teamSync.buildStore.updateAuth((auth) => {
    if (!auth || auth.sharedLibrary === undefined) return undefined;
    delete auth.sharedLibrary;
    return auth;
  });
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
