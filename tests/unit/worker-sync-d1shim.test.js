"use strict";
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

describe("d1Shim", () => {
  test("prepare/bind/first/all/run mirror the D1 API", async () => {
    const db = createTestD1();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)");
    const run = await db.prepare("INSERT INTO t (n) VALUES (?)").bind(5).run();
    expect(run.success).toBe(true);
    expect(run.meta.changes).toBe(1);
    expect(await db.prepare("SELECT n FROM t WHERE id = ?").bind(1).first("n")).toBe(5);
    expect(await db.prepare("SELECT * FROM t").bind().first()).toEqual({ id: 1, n: 5 });
    expect(await db.prepare("SELECT * FROM t WHERE id = 99").bind().first()).toBeNull();
    const all = await db.prepare("SELECT * FROM t").all();
    expect(all.results).toEqual([{ id: 1, n: 5 }]);
  });

  test("batch runs statements atomically and returns per-statement results", async () => {
    const db = createTestD1();
    await db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER UNIQUE)");
    const ok = await db.batch([
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(1),
      db.prepare("SELECT n FROM t").bind(),
    ]);
    expect(ok[0].meta.changes).toBe(1);
    expect(ok[1].results).toEqual([{ n: 1 }]);
    await expect(db.batch([
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(2),
      db.prepare("INSERT INTO t (n) VALUES (?)").bind(1), // UNIQUE violation
    ])).rejects.toThrow();
    // first insert rolled back
    expect((await db.prepare("SELECT COUNT(*) AS c FROM t").first("c"))).toBe(1);
  });

  test("applyMigrations loads workers/sync/migrations/*.sql in order", async () => {
    const db = createTestD1();
    await db.applyMigrations();
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).results.map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["users", "identities", "sessions", "teams", "memberships", "items"]));
  });

  test("KV shim supports get/put/delete with TTL", async () => {
    const kv = createTestKV({ now: () => 1_000_000 });
    await kv.put("k", "v", { expirationTtl: 60 });
    expect(await kv.get("k")).toBe("v");
    kv._advance(61_000);
    expect(await kv.get("k")).toBeNull();
    await kv.put("x", "1");
    await kv.delete("x");
    expect(await kv.get("x")).toBeNull();
  });
});
