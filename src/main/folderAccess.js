"use strict";
// Resolving per-folder team access on this machine.
//
// The server is the authority — see workers/sync/src/access.js, which this
// mirrors — but a client that only finds out by being refused is a bad client:
// the edit is already saved locally, the outbox already has an entry, and the
// user learns about it from an error toast some seconds later. So the same rule
// runs here, over the local folder tree, to grey things out and refuse early.
//
// The two implementations must agree. The rule is small enough to state in one
// line and is stated identically in both: the NEAREST grant, walking up from the
// item through its folders to the team root, wins.

const LEVELS = { none: 0, read: 1, write: 2, delete: 3 };
const DEFAULT_FOR_ROLE = { owner: "delete", member: "write" };

function rank(access) {
  return LEVELS[access] ?? 0;
}

/**
 * Access to a folder and its contents.
 *
 * @param {object} args
 * @param {object[]} args.folders the local folder list
 * @param {string|null} args.folderId
 * @param {string} args.teamId
 * @param {Record<string,string>} args.grants this user's grants, folderId → access
 * @param {string} args.role team role
 */
function accessAt({ folders, folderId, teamId, grants = {}, role }) {
  if (role === "owner") return "delete";
  // A grant on the team's own id is the team-wide default for this person. It
  // is keyed by the TEAM id, not the root folder's local id, because the root
  // folder is not an item on the server — its children sync with a null parent.
  const fallback = grants[teamId] || DEFAULT_FOR_ROLE[role] || "read";
  const byId = new Map((folders || []).map((f) => [f.id, f]));
  const seen = new Set();
  let cursor = folderId || null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (grants[cursor]) return grants[cursor];
    const folder = byId.get(cursor);
    if (!folder || folder.teamId) break; // reached the team root (or a dangling id)
    cursor = folder.parentId;
  }
  return fallback;
}

/**
 * Every folder in one team, mapped to the caller's access.
 *
 * Keyed by folder id, which answers for builds and comps too: a build's access
 * is the access of the folder it sits in, and a folder's own access is its own
 * entry. So the renderer needs no walking logic of its own and cannot drift from
 * this one.
 */
function buildAccessMap({ folders, root, teamId, grants = {}, role }) {
  const inTeam = (f) => {
    let cursor = f;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.id === root.id) return true;
      cursor = cursor.parentId ? folders.find((x) => x.id === cursor.parentId) : null;
    }
    return false;
  };
  const map = {};
  for (const folder of folders || []) {
    if (!inTeam(folder)) continue;
    map[folder.id] = accessAt({ folders, folderId: folder.id, teamId, grants, role });
  }
  return map;
}

module.exports = { accessAt, buildAccessMap, rank, LEVELS, DEFAULT_FOR_ROLE };
