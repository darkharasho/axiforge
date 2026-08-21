"use strict";
const items = require("../../workers/sync/src/items");
const teams = require("../../workers/sync/src/teams");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  const now = "2026-08-21T12:00:00.000Z";
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-mem2", "member2"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(now) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  const owner = as("u-owner", "owner"), member = as("u-mem", "member"), member2 = as("u-mem2", "member2");
  const mk = (b) => new Request("https://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const { team } = await (await teams.createTeam(mk({ name: "T" }), env, deps, owner, {})).json();
  await teams.joinTeam(mk({ inviteCode: team.inviteCode }), env, deps, member, {});
  await teams.joinTeam(mk({ inviteCode: team.inviteCode }), env, deps, member2, {});
  return { env, deps, db, owner, member, member2, teamId: team.id };
}
const jreq = (method, body, url = "https://x/") => new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const put = (env, deps, who, teamId, itemId, body) => items.putItem(jreq("PUT", body), env, deps, who, { teamId, itemId });
const del = (env, deps, who, teamId, itemId, baseVersion) => items.deleteItem(jreq("DELETE", undefined, `https://x/?baseVersion=${baseVersion}`), env, deps, who, { teamId, itemId });
const changes = (env, deps, who, teamId, since = 0, limit = 200) => items.getChanges(jreq("GET", undefined, `https://x/?since=${since}&limit=${limit}`), env, deps, who, { teamId });

describe("items", () => {
  test("create → 201 v1 seq1; update with correct baseVersion → 200 v2 seq2; stale baseVersion → 409 with current", async () => {
    const { env, deps, owner, teamId } = await setup();
    const r1 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "A" }, baseVersion: null });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ version: 1, seq: 1 });
    const r2 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "B" }, baseVersion: 1 });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ version: 2, seq: 2 });
    const r3 = await put(env, deps, owner, teamId, "b1", { type: "build", parentId: null, body: { title: "C" }, baseVersion: 1 });
    expect(r3.status).toBe(409);
    const b3 = await r3.json();
    expect(b3.error.code).toBe("conflict");
    expect(b3.current).toMatchObject({ id: "b1", version: 2, body: { title: "B" }, updatedBy: { login: "owner" } });
  });

  test("create over a live item → 409; create over a tombstone → 201 and un-deletes", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null })).status).toBe(409);
    expect((await del(env, deps, owner, teamId, "b1", 1)).status).toBe(200);
    const r = await put(env, deps, owner, teamId, "b1", { type: "build", body: { x: 1 }, baseVersion: null });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ version: 3, seq: 3 });
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: "b1", deleted: false, version: 3, body: { x: 1 } });
  });

  test("un-tombstone race: loser (stale pre-read) gets 409 with current, no data loss", async () => {
    const { env, deps, owner, member, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: { v: 1 }, baseVersion: null }); // v1, seq1
    expect((await del(env, deps, owner, teamId, "b1", 1)).status).toBe(200); // tombstoned, v2, seq2

    // Winner: a real concurrent writer un-deletes b1 first.
    const winner = await put(env, deps, member, teamId, "b1", { type: "build", body: { winner: true }, baseVersion: null });
    expect(winner.status).toBe(201);
    expect(await winner.json()).toEqual({ version: 3, seq: 3 });

    // Loser: simulate a writer whose pre-batch read of `items` observed the row
    // still tombstoned (stale snapshot), so it takes the create-over-tombstone
    // branch. Its guarded `UPDATE ... WHERE deleted = 1` matches 0 rows because
    // the winner already un-deleted the row — this must not be reported as a
    // silent success with someone else's data.
    const staleEnv = {
      ...env,
      SYNC_DB: {
        ...env.SYNC_DB,
        prepare(sql) {
          if (sql === "SELECT version, deleted FROM items WHERE team_id = ? AND id = ?") {
            return { bind: () => ({ first: async () => ({ version: 2, deleted: 1 }) }) };
          }
          return env.SYNC_DB.prepare(sql);
        },
      },
    };
    const loser = await items.writeItem(staleEnv, deps, owner, teamId, { itemId: "b1", type: "build", body: { loser: true }, baseVersion: null });
    expect(loser.status).toBe(409);
    expect(loser.current).toMatchObject({ id: "b1", version: 3, body: { winner: true } });

    // No data loss: the winner's write is the one that survives.
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.find((i) => i.id === "b1").body).toEqual({ winner: true });
  });

  test("validation: bad type 400, parent must be a live folder in the team 400, oversize 413, boonCoverageHtml stripped", async () => {
    const { env, deps, owner, teamId } = await setup();
    expect((await put(env, deps, owner, teamId, "x", { type: "thing", body: {}, baseVersion: null })).status).toBe(400);
    expect((await put(env, deps, owner, teamId, "x", { type: "build", parentId: "nope", body: {}, baseVersion: null })).status).toBe(400);
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "x", { type: "build", parentId: "b1", body: {}, baseVersion: null })).status).toBe(400); // parent is a build
    await put(env, deps, owner, teamId, "f1", { type: "folder", body: { name: "F" }, baseVersion: null });
    expect((await put(env, deps, owner, teamId, "b2", { type: "build", parentId: "f1", body: {}, baseVersion: null })).status).toBe(201);
    const big = await put(env, deps, owner, teamId, "big", { type: "build", body: { blob: "x".repeat(1_500_001) }, baseVersion: null });
    expect(big.status).toBe(413);
    expect((await big.json()).error.message).toMatch(/This build \(big\) is too large/);
    await put(env, deps, owner, teamId, "c1", { type: "comp", body: { name: "C", boonCoverageHtml: "<div>huge</div>" }, baseVersion: null });
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.find((i) => i.id === "c1").body).toEqual({ name: "C" });
  });

  test("changes: ordered by seq, paged with limit/hasMore/nextSeq, includes tombstones, since excludes seen", async () => {
    const { env, deps, owner, teamId } = await setup();
    for (let i = 1; i <= 5; i++) await put(env, deps, owner, teamId, `b${i}`, { type: "build", body: { i }, baseVersion: null });
    await del(env, deps, owner, teamId, "b2", 1); // seq 6
    const p1 = await (await changes(env, deps, owner, teamId, 0, 2)).json();
    expect(p1.items.map((i) => i.seq)).toEqual([1, 3]); // b2's seq 1 was replaced by its tombstone at seq 6 — b1=1, b3=3
    expect(p1.hasMore).toBe(true);
    expect(p1.nextSeq).toBe(3);
    const p2 = await (await changes(env, deps, owner, teamId, p1.nextSeq, 2)).json();
    expect(p2.items.map((i) => i.seq)).toEqual([4, 5]);
    const p3 = await (await changes(env, deps, owner, teamId, p2.nextSeq, 2)).json();
    expect(p3.items.map((i) => [i.id, i.seq, i.deleted, i.body])).toEqual([["b2", 6, true, null]]);
    expect(p3.hasMore).toBe(false);
    expect(p3.nextSeq).toBe(6);
    expect((await changes(env, deps, owner, teamId, 0, 999)).status).toBe(400); // limit cap
  });

  test("seq is monotonic and unique under concurrent writes", async () => {
    const { env, deps, owner, teamId } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) => put(env, deps, owner, teamId, `b${i}`, { type: "build", body: {}, baseVersion: null })));
    const { results } = await env.SYNC_DB.prepare("SELECT seq FROM items WHERE team_id = ? ORDER BY seq").bind(teamId).all();
    expect(results.map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await env.SYNC_DB.prepare("SELECT seq FROM teams WHERE id = ?").bind(teamId).first("seq")).toBe(20);
  });

  test("delete: version mismatch 409; member may delete own items only; owner may delete anything; non-member 403", async () => {
    const { env, deps, owner, member, member2, teamId } = await setup();
    await put(env, deps, member, teamId, "mine", { type: "build", body: {}, baseVersion: null });
    await put(env, deps, owner, teamId, "theirs", { type: "build", body: {}, baseVersion: null });
    expect((await del(env, deps, member, teamId, "mine", 7)).status).toBe(409);
    expect((await del(env, deps, member2, teamId, "mine", 1)).status).toBe(403);
    expect((await del(env, deps, member, teamId, "theirs", 1)).status).toBe(403);
    expect((await del(env, deps, member, teamId, "mine", 1)).status).toBe(200);
    expect((await del(env, deps, owner, teamId, "theirs", 1)).status).toBe(200);
    expect((await del(env, deps, owner, teamId, "theirs", 2)).status).toBe(404); // already a tombstone
    const outsider = { user: { id: "u-nobody", login: "nobody" } };
    expect((await put(env, deps, outsider, teamId, "z", { type: "build", body: {}, baseVersion: null })).status).toBe(403);
  });

  test("folder delete cascades with per-item seqs; member needs to have created every descendant", async () => {
    const { env, deps, owner, member, teamId } = await setup();
    await put(env, deps, member, teamId, "f1", { type: "folder", body: { name: "F" }, baseVersion: null });
    await put(env, deps, member, teamId, "f2", { type: "folder", parentId: "f1", body: { name: "G" }, baseVersion: null });
    await put(env, deps, member, teamId, "b1", { type: "build", parentId: "f2", body: {}, baseVersion: null });
    await put(env, deps, owner, teamId, "b2", { type: "build", parentId: "f1", body: {}, baseVersion: null });
    expect((await del(env, deps, member, teamId, "f1", 1)).status).toBe(403); // b2 is not theirs
    const r = await del(env, deps, owner, teamId, "f1", 1);
    expect(r.status).toBe(200);
    const all = await (await changes(env, deps, owner, teamId, 4)).json();
    expect(all.items.map((i) => [i.id, i.deleted]).sort()).toEqual([["b1", true], ["b2", true], ["f1", true], ["f2", true]]);
    expect(new Set(all.items.map((i) => i.seq)).size).toBe(4);
  });

  test("bulk: per-item results, one conflict does not fail the rest, ≤50 items", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    const r = await items.bulkItems(jreq("POST", { items: [
      { itemId: "b1", type: "build", body: {}, baseVersion: null },   // conflict (exists)
      { itemId: "b2", type: "build", body: {}, baseVersion: null },   // created
      { itemId: "b3", type: "nope", body: {}, baseVersion: null },    // invalid
    ] }), env, deps, owner, { teamId });
    expect(r.status).toBe(200);
    const { results } = await r.json();
    expect(results.map((x) => [x.itemId, x.status])).toEqual([["b1", 409], ["b2", 201], ["b3", 400]]);
    expect(results[0].current.id).toBe("b1");
    const tooMany = await items.bulkItems(jreq("POST", { items: Array.from({ length: 51 }, (_, i) => ({ itemId: `x${i}`, type: "build", body: {}, baseVersion: null })) }), env, deps, owner, { teamId });
    expect(tooMany.status).toBe(400);
  });

  test("write rate limit: 120/min/user → 429", async () => {
    const { env, deps, owner, teamId } = await setup();
    for (let i = 0; i < 120; i++) await put(env, deps, owner, teamId, `b${i}`, { type: "build", body: {}, baseVersion: null });
    const r = await put(env, deps, owner, teamId, "late", { type: "build", body: {}, baseVersion: null });
    expect(r.status).toBe(429);
  });

  test("write rate limit charges bulk per item: a 50-item bulk plus 71 singles trips 429 on the 71st", async () => {
    const { env, deps, owner, teamId } = await setup();
    const bulk = await items.bulkItems(jreq("POST", { items: Array.from({ length: 50 }, (_, i) => ({ itemId: `x${i}`, type: "build", body: {}, baseVersion: null })) }), env, deps, owner, { teamId });
    expect(bulk.status).toBe(200);
    const { results } = await bulk.json();
    expect(results.every((r) => r.status === 201)).toBe(true); // 50 quota consumed, 70 left of 120
    for (let i = 0; i < 70; i++) {
      const r = await put(env, deps, owner, teamId, `y${i}`, { type: "build", body: {}, baseVersion: null });
      expect(r.status).toBe(201);
    }
    const r71 = await put(env, deps, owner, teamId, "y70", { type: "build", body: {}, baseVersion: null });
    expect(r71.status).toBe(429);
  });

  test("folder cycles: PUT that would move a folder inside its own descendant → 400; a cycle seeded directly in SQL doesn't hang DELETE and tombstones every reachable row", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "a", { type: "folder", body: { name: "A" }, baseVersion: null });
    await put(env, deps, owner, teamId, "b", { type: "folder", parentId: "a", body: { name: "B" }, baseVersion: null });
    // a -> b already; moving a under b would make a its own (indirect) ancestor.
    const cyclic = await put(env, deps, owner, teamId, "a", { type: "folder", parentId: "b", body: { name: "A" }, baseVersion: 1 });
    expect(cyclic.status).toBe(400);
    expect((await cyclic.json()).error.message).toMatch(/cannot be moved inside itself/);

    // Seed a genuine cycle directly (bypassing the guard) to prove collectTree/DELETE
    // terminate instead of looping forever, and still tombstone everything reachable.
    await env.SYNC_DB.prepare("UPDATE items SET parent_id = 'b' WHERE team_id = ? AND id = 'a'").bind(teamId).run();
    const del1 = await del(env, deps, owner, teamId, "a", 1);
    expect(del1.status).toBe(200);
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.filter((i) => i.deleted).map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  test("delete version guard: a write landing between the pre-read and the batch is not silently tombstoned — 409 with current", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: { v: 1 }, baseVersion: null }); // v1, seq1

    let batchCalls = 0;
    const racingEnv = {
      ...env,
      SYNC_DB: {
        ...env.SYNC_DB,
        prepare: (sql) => env.SYNC_DB.prepare(sql),
        async batch(stmts) {
          batchCalls += 1;
          if (batchCalls === 1) {
            // A concurrent writer bumps the row between our pre-read and this batch.
            await put(env, deps, owner, teamId, "b1", { type: "build", body: { v: 2 }, baseVersion: 1 });
          }
          return env.SYNC_DB.batch(stmts);
        },
      },
    };
    const res = await items.deleteItem(jreq("DELETE", undefined, "https://x/?baseVersion=1"), racingEnv, deps, owner, { teamId, itemId: "b1" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.current).toMatchObject({ id: "b1", version: 2, body: { v: 2 } });
    // The concurrent write survives; the item is not tombstoned.
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.find((i) => i.id === "b1")).toMatchObject({ deleted: false, version: 2 });
  });

  test("path itemId wins over a conflicting body itemId", async () => {
    const { env, deps, owner, teamId } = await setup();
    const res = await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null, itemId: "other" });
    expect(res.status).toBe(201);
    const list = await (await changes(env, deps, owner, teamId)).json();
    expect(list.items.map((i) => i.id)).toEqual(["b1"]);
  });

  test("PUT cannot change an existing item's type", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null });
    const res = await put(env, deps, owner, teamId, "b1", { type: "folder", body: { name: "x" }, baseVersion: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/change item type/);
  });

  test("body-size pre-check: an oversize content-length is rejected with 413 before parsing, for PUT and bulk", async () => {
    const { env, deps, owner, teamId } = await setup();
    const bigPut = new Request("https://x/", {
      method: "PUT",
      headers: { "content-type": "application/json", "content-length": String(items.MAX_BODY_BYTES * 2) },
      body: JSON.stringify({ type: "build", body: {}, baseVersion: null }),
    });
    const putRes = await items.putItem(bigPut, env, deps, owner, { teamId, itemId: "b1" });
    expect(putRes.status).toBe(413);

    const bigBulk = new Request("https://x/", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(items.MAX_BULK_BODY_BYTES + 1) },
      body: JSON.stringify({ items: [] }),
    });
    const bulkRes = await items.bulkItems(bigBulk, env, deps, owner, { teamId });
    expect(bulkRes.status).toBe(413);
  });

  test("changes: resync=true when the cursor falls inside a purge gap; since=0 never resyncs", async () => {
    const { env, deps, owner, teamId } = await setup();
    await put(env, deps, owner, teamId, "b1", { type: "build", body: {}, baseVersion: null }); // seq1
    await env.SYNC_DB.prepare("UPDATE teams SET purged_seq = 5 WHERE id = ?").bind(teamId).run();

    const stale = await (await changes(env, deps, owner, teamId, 3)).json();
    expect(stale).toEqual({ resync: true, items: [], nextSeq: 3, hasMore: false });

    const fresh = await (await changes(env, deps, owner, teamId, 0)).json();
    expect(fresh.resync).toBe(false);
    expect(fresh.items).toHaveLength(1);

    const pastPurge = await (await changes(env, deps, owner, teamId, 5)).json();
    expect(pastPurge.resync).toBe(false); // since === purged_seq, not < it
  });

  test("loginsFor chunks its IN list so a page with >90 distinct authors still resolves every login", async () => {
    const { env, deps, owner, teamId } = await setup();
    const AUTHORS = 95;
    for (let i = 0; i < AUTHORS; i++) {
      const id = `u-many-${i}`;
      await env.SYNC_DB.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, `many${i}`, "2026-08-21T12:00:00.000Z").run();
      await env.SYNC_DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, `many${i}`).run();
      const r = await items.writeItem(env, deps, { user: { id, login: `many${i}` } }, teamId, { itemId: `b-many-${i}`, type: "build", body: {}, baseVersion: null });
      expect(r.status).toBe(201);
    }
    const list = await (await changes(env, deps, owner, teamId, 0, 200)).json();
    expect(list.items).toHaveLength(AUTHORS);
    for (const item of list.items) {
      const idx = Number(item.id.replace("b-many-", ""));
      expect(item.createdBy.login).toBe(`many${idx}`);
    }
  });
});
