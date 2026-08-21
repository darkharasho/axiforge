"use strict";
const { purgeTombstones, TOMBSTONE_TTL_MS } = require("../../workers/sync/src/purge");
const { createTestD1 } = require("../helpers/d1Shim");

test("deletes tombstones older than 30 days, keeps younger ones and live items", async () => {
  const db = createTestD1();
  await db.applyMigrations();
  const now = Date.parse("2026-08-21T12:00:00Z");
  await db.prepare("INSERT INTO users VALUES ('u', 'u', NULL, '2026-01-01T00:00:00.000Z')").run();
  await db.prepare("INSERT INTO teams VALUES ('t', 'T', 'ABCDEFGHJK', 3, 'u', '2026-01-01T00:00:00.000Z')").run();
  const ins = (id, deleted, updatedAt) => db.prepare(
    "INSERT INTO items (team_id, id, type, body, version, seq, deleted, created_by, updated_by, updated_at) VALUES ('t', ?, 'build', NULL, 1, 1, ?, 'u', 'u', ?)"
  ).bind(id, deleted, updatedAt).run();
  await ins("old-tomb", 1, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  await ins("new-tomb", 1, new Date(now - 1000).toISOString());
  await ins("old-live", 0, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  const r = await purgeTombstones({ SYNC_DB: db }, { now: () => now });
  expect(r.deleted).toBe(1);
  const ids = (await db.prepare("SELECT id FROM items ORDER BY id").all()).results.map((x) => x.id);
  expect(ids).toEqual(["new-tomb", "old-live"]);
});
