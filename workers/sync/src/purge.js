"use strict";
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Clients that have been offline longer than 30 days do a full re-pull anyway
// (their cursor is older than any surviving tombstone would matter for), so
// tombstones can be dropped after that. Before deleting a team's tombstones we
// raise `teams.purged_seq` to the highest seq we are about to remove, so
// `getChanges` can tell a stale client (whose cursor now points past a gap in
// history) to do a full resync instead of silently missing deletes.
async function purgeTombstones(env, deps = {}) {
  const db = env.SYNC_DB;
  const cutoff = new Date((deps.now || Date.now)() - TOMBSTONE_TTL_MS).toISOString();
  const { results: teamMaxSeq } = await db.prepare(
    // COALESCE: rows tombstoned before the team trash existed have no
    // deleted_at, and their updated_at is the deletion stamp anyway. Measuring
    // from deleted_at matters now that a restore bumps updated_at — otherwise
    // restoring something would silently reset its retention clock.
    `SELECT team_id, MAX(seq) AS max_seq FROM items WHERE deleted = 1 AND COALESCE(deleted_at, updated_at) < ? GROUP BY team_id`
  ).bind(cutoff).all();

  let deleted = 0;
  for (const { team_id: teamId, max_seq: maxSeq } of teamMaxSeq) {
    const results = await db.batch([
      // Only raise purged_seq, never lower it (a later purge could otherwise
      // race with a team created after an earlier purge ran).
      db.prepare("UPDATE teams SET purged_seq = ? WHERE id = ? AND purged_seq < ?").bind(maxSeq, teamId, maxSeq),
      db.prepare("DELETE FROM items WHERE team_id = ? AND deleted = 1 AND COALESCE(deleted_at, updated_at) < ?").bind(teamId, cutoff),
    ]);
    deleted += results[1].meta.changes;
  }

  const now = (deps.now || Date.now)();
  const sessions = await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(new Date(now).toISOString()).run();
  return { deleted, sessions: sessions.meta.changes };
}

module.exports = { purgeTombstones, TOMBSTONE_TTL_MS };
