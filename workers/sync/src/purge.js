"use strict";
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Clients that have been offline longer than 30 days do a full re-pull anyway
// (their cursor is older than any surviving tombstone would matter for), so
// tombstones can be dropped after that.
async function purgeTombstones(env, deps = {}) {
  const cutoff = new Date((deps.now || Date.now)() - TOMBSTONE_TTL_MS).toISOString();
  const r = await env.SYNC_DB.prepare("DELETE FROM items WHERE deleted = 1 AND updated_at < ?").bind(cutoff).run();
  return { deleted: r.meta.changes };
}

module.exports = { purgeTombstones, TOMBSTONE_TTL_MS };
