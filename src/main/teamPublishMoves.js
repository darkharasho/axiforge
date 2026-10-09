"use strict";

/**
 * Moving published items to where they belong now.
 *
 * Before every team had one publish target, each member published a shared
 * build to their own account, so its link showed whichever copy that member
 * last published. Two halves put that right:
 *
 *   * itemsToMove: team items still published somewhere other than the team's
 *     target are queued to republish there. The move keeps the item's file id
 *     and key, so only the host in the link changes.
 *   * planMovedStubs: the old host's copy is deleted and replaced with a small
 *     pointer to the new host, which the viewer follows (src/site/moved.js), so
 *     a link handed out before the move opens the current build.
 *
 * Only the old host can write to its own repo, so each app stubs its own copies.
 */

const { movedPointerPath } = require("./siteBundle");

const lower = (s) => String(s || "").toLowerCase();

/**
 * Team items to republish at their team's target.
 *
 * One app moves each item, to keep members from racing each other's sync
 * writes: the member whose account holds the old copy. If they have left the
 * team, a team owner's app does it instead.
 *
 * @param {object} args
 * @param {Array<{kind: "build"|"comp", record: object}>} args.records
 * @param {(record: object) => object|null} args.rootFor  the item's team root folder
 * @param {string} args.viewerLogin
 * @param {Map<string, Set<string>>} [args.memberLogins]  teamId → lowercased member logins;
 *   only needed for teams this user owns
 * @returns {Array<{kind: string, id: string}>}
 */
function itemsToMove({ records, rootFor, viewerLogin, memberLogins = new Map() }) {
  const out = [];
  for (const { kind, record } of records) {
    if (!record?.publishedFileId || !record.publishedOwner || record.deletedAt) continue;
    const root = rootFor(record);
    if (!root?.publishOwner) continue;
    const from = lower(record.publishedOwner);
    if (from === lower(root.publishOwner)) continue;
    const hostIsMe = from === lower(viewerLogin);
    const hostLeft = root.role === "owner" && memberLogins.has(root.teamId) && !memberLogins.get(root.teamId).has(from);
    if (hostIsMe || hostLeft) out.push({ kind, id: record.id });
  }
  return out;
}

/**
 * The commit that turns this user's stale copies into pointers: for every
 * record now published elsewhere whose payload is still in this user's repo,
 * delete the payload and point at the new host.
 *
 * @param {object} args
 * @param {Array<{kind: "build"|"comp", record: object}>} args.records
 * @param {string} args.viewerLogin
 * @param {Set<string>} args.sitePaths  every site/ path in the viewer's repo
 * @returns {Record<string, string|null>} path → content, null to delete
 */
function planMovedStubs({ records, viewerLogin, sitePaths }) {
  const bundle = {};
  for (const { kind, record } of records) {
    if (!record?.publishedFileId || !record.publishedOwner) continue;
    if (lower(record.publishedOwner) === lower(viewerLogin)) continue;
    const payload = `site/${kind === "comp" ? "comps" : "builds"}/${record.publishedFileId}.enc`;
    if (!sitePaths.has(payload)) continue;
    bundle[payload] = null;
    bundle[movedPointerPath(record.publishedFileId)] = `${JSON.stringify({ owner: record.publishedOwner })}\n`;
  }
  return bundle;
}

module.exports = { itemsToMove, planMovedStubs };
