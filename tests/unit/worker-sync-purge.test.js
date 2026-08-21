"use strict";
const { purgeTombstones, TOMBSTONE_TTL_MS } = require("../../workers/sync/src/purge");
const { createTestD1 } = require("../helpers/d1Shim");

async function seedTeam(db, id, seq, purgedSeq = 0) {
  await db.prepare("INSERT INTO teams (id, name, invite_code, seq, purged_seq, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'u', '2026-01-01T00:00:00.000Z')")
    .bind(id, id, id.padEnd(10, "0").slice(0, 10).toUpperCase(), seq, purgedSeq).run();
}

test("deletes tombstones older than 30 days, keeps younger ones and live items", async () => {
  const db = createTestD1();
  await db.applyMigrations();
  const now = Date.parse("2026-08-21T12:00:00Z");
  await db.prepare("INSERT INTO users VALUES ('u', 'u', NULL, '2026-01-01T00:00:00.000Z')").run();
  await seedTeam(db, "t", 3);
  const ins = (id, deleted, updatedAt, seq = 1) => db.prepare(
    "INSERT INTO items (team_id, id, type, body, version, seq, deleted, created_by, updated_by, updated_at) VALUES ('t', ?, 'build', NULL, 1, ?, ?, 'u', 'u', ?)"
  ).bind(id, seq, deleted, updatedAt).run();
  await ins("old-tomb", 1, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  await ins("new-tomb", 1, new Date(now - 1000).toISOString());
  await ins("old-live", 0, new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString());
  const r = await purgeTombstones({ SYNC_DB: db }, { now: () => now });
  expect(r.deleted).toBe(1);
  const ids = (await db.prepare("SELECT id FROM items ORDER BY id").all()).results.map((x) => x.id);
  expect(ids).toEqual(["new-tomb", "old-live"]);
});

test("raises teams.purged_seq to the max seq of the tombstones it deletes, per team, and never lowers it", async () => {
  const db = createTestD1();
  await db.applyMigrations();
  const now = Date.parse("2026-08-21T12:00:00Z");
  const old = new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString();
  await db.prepare("INSERT INTO users VALUES ('u', 'u', NULL, '2026-01-01T00:00:00.000Z')").run();
  await seedTeam(db, "t1", 10, 0);
  await seedTeam(db, "t2", 10, 7); // already purged past seq 5 once
  const ins = (team, id, seq) => db.prepare(
    "INSERT INTO items (team_id, id, type, body, version, seq, deleted, created_by, updated_by, updated_at) VALUES (?, ?, 'build', NULL, 1, ?, 1, 'u', 'u', ?)"
  ).bind(team, id, seq, old).run();
  await ins("t1", "a", 3);
  await ins("t1", "b", 5); // t1's max purged seq should become 5
  await ins("t2", "c", 4); // below t2's existing purged_seq (7) — must not lower it

  await purgeTombstones({ SYNC_DB: db }, { now: () => now });

  expect(await db.prepare("SELECT purged_seq FROM teams WHERE id = 't1'").first("purged_seq")).toBe(5);
  expect(await db.prepare("SELECT purged_seq FROM teams WHERE id = 't2'").first("purged_seq")).toBe(7); // unchanged, not lowered
});

test("also reaps expired sessions and returns { deleted, sessions }", async () => {
  const db = createTestD1();
  await db.applyMigrations();
  const now = Date.parse("2026-08-21T12:00:00Z");
  await db.prepare("INSERT INTO users VALUES ('u', 'u', NULL, '2026-01-01T00:00:00.000Z')").run();
  const ins = (hash, expiresAt) => db.prepare(
    "INSERT INTO sessions (token_hash, user_id, client_label, created_at, last_used_at, expires_at) VALUES (?, 'u', NULL, ?, ?, ?)"
  ).bind(hash, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", expiresAt).run();
  await ins("expired", new Date(now - 1000).toISOString());
  await ins("live", new Date(now + 1000 * 60 * 60).toISOString());

  const r = await purgeTombstones({ SYNC_DB: db }, { now: () => now });
  expect(r.sessions).toBe(1);
  expect(await db.prepare("SELECT COUNT(*) AS c FROM sessions").first("c")).toBe(1);
  expect(await db.prepare("SELECT token_hash FROM sessions").first("token_hash")).toBe("live");
});
