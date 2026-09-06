"use strict";
// Per-folder access inside a teamspace.
//
// The rule in one line: the NEAREST grant, walking up from the item through its
// folders to the team root, decides what you may do. No grant anywhere means the
// team role's default, which is what every team had before this existed — so a
// team with no grants behaves exactly as it always did, and pays nothing for the
// feature.
//
// A grant names a person, or names EVERYONE — a folder's blanket level, which is
// the only form that stays true as people join. A person's own grant beats the
// blanket at the same folder; between folders the nearer one wins either way.
//
// A grant lives on a folder and covers that folder AND its contents. Covering
// the folder itself is what makes `none` mean "you cannot see this folder",
// rather than "you can see an Officers folder you may not open" — which is the
// thing people are actually asking for when they ask to hide one.

const LEVELS = { none: 0, read: 1, write: 2, delete: 3 };
const ACCESS_VALUES = Object.keys(LEVELS);

// What you get where nobody has said otherwise. `member` → write is today's
// behaviour: write anything, delete only what you created (see canDelete).
const DEFAULT_FOR_ROLE = { owner: "delete", member: "write" };

// A grant against this pseudo-user is the folder's blanket level: everyone in
// the team gets at least this, without anybody having to be named. It is the
// only way a level can stay true as people join and leave. @see migration 0004.
const EVERYONE = "*";

const MAX_WALK = 64; // cycle guard; folder depth is capped at 3 client-side

function rank(access) {
  return LEVELS[access] ?? 0;
}

function isAccess(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEVELS, value);
}

/**
 * An answer to "what may this user do, and where", for one team.
 *
 * `unrestricted` is the fast path and the common case: an owner, or a member
 * with no grants at all in this team. Callers skip every per-item check and the
 * changes feed skips loading the folder tree, so a team that never uses grants
 * runs exactly the queries it ran before.
 */
class TeamAccess {
  constructor({ teamId, role, grants, everyone, parents }) {
    this.teamId = teamId;
    this.role = role;
    this.grants = grants;                    // Map folderId → access, this user
    this.everyone = everyone || new Map();   // Map folderId → access, the blanket
    this.parents = parents;                  // Map folderId → parentId (null at the root)
    this.isOwner = role === "owner";
    this.default = DEFAULT_FOR_ROLE[role] || "read";
    this.unrestricted = this.isOwner || (grants.size === 0 && this.everyone.size === 0);
  }

  /**
   * The level set AT one folder, if any: this user's own grant, else the
   * folder's blanket.
   *
   * Personal beats blanket at the same folder, because that is what naming
   * somebody means — a blanket that could not be excepted would be a worse tool
   * than no blanket at all. Across folders neither wins by kind: the nearer one
   * does, which is the same rule everything else here obeys.
   */
  atFolderOnly(folderId) {
    return this.grants.get(folderId) || this.everyone.get(folderId) || null;
  }

  /**
   * Access to the CONTENTS of a location. `null` is the team root.
   *
   * Walks up through parent folders and stops at the first grant. The team's own
   * id is checked last, as the root's stand-in: the root folder is not an item
   * (its children carry `parentId: null`), so a grant on the team id is how
   * "this person is read-only across the whole team" is written down.
   */
  at(folderId) {
    if (this.isOwner) return "delete";
    const seen = new Set();
    let cursor = folderId || null;
    for (let hops = 0; cursor && hops < MAX_WALK; hops += 1) {
      if (seen.has(cursor)) break; // cyclic parent chain — fall through to the default
      seen.add(cursor);
      const grant = this.atFolderOnly(cursor);
      if (grant) return grant;
      cursor = this.parents.get(cursor) ?? null;
    }
    return this.atFolderOnly(this.teamId) || this.default;
  }

  /**
   * Access to an item itself.
   *
   * A folder is governed by its own grant — that is what makes `none` hide the
   * folder rather than just its contents. Everything else is governed by the
   * folder it sits in.
   */
  forItem(row) {
    return this.at(row.type === "folder" ? row.id : row.parent_id);
  }

  canRead(row) {
    return rank(this.forItem(row)) >= LEVELS.read;
  }

  canWrite(row) {
    return rank(this.forItem(row)) >= LEVELS.write;
  }

  /**
   * Deleting is either granted outright, or earned by having created the thing.
   *
   * The creator clause is the rule the team has always had, kept intact: a
   * member may clean up after themselves. It requires `write` rather than
   * `read`, because a folder someone has been made read-only on should not still
   * let them destroy their own contributions to it.
   */
  canDelete(row, userId) {
    const level = rank(this.forItem(row));
    if (level >= LEVELS.delete) return true;
    return level >= LEVELS.write && row.created_by === userId;
  }
}

/**
 * Load one user's access for one team.
 *
 * The folder tree is only read when the user actually has grants — for everyone
 * else `at()` never walks, so the extra query is skipped entirely.
 *
 * @param {object} env
 * @param {string} teamId
 * @param {string} userId
 * @param {string} role membership role
 */
async function loadTeamAccess(env, teamId, userId, role) {
  const grants = new Map();
  const everyone = new Map();
  if (role !== "owner") {
    // Both in one query: a member is governed by their own grants and by the
    // blanket ones together, and splitting them into two round trips would only
    // make the pair possible to read at different moments.
    const { results } = await env.SYNC_DB.prepare(
      "SELECT folder_id, user_id, access FROM folder_grants WHERE team_id = ? AND user_id IN (?, ?)"
    ).bind(teamId, userId, EVERYONE).all();
    for (const r of results) (r.user_id === EVERYONE ? everyone : grants).set(r.folder_id, r.access);
  }
  const parents = new Map();
  if (grants.size > 0 || everyone.size > 0) {
    // Tombstoned folders included on purpose: the trash and the changes feed
    // both have to place items that no longer live anywhere.
    const { results } = await env.SYNC_DB.prepare(
      "SELECT id, parent_id FROM items WHERE team_id = ? AND type = 'folder'"
    ).bind(teamId).all();
    for (const r of results) parents.set(r.id, r.parent_id);
  }
  return new TeamAccess({ teamId, role, grants, everyone, parents });
}

module.exports = { TeamAccess, loadTeamAccess, LEVELS, ACCESS_VALUES, DEFAULT_FOR_ROLE, EVERYONE, rank, isAccess };
