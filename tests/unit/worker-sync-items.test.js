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
    expect((await big.json()).error.message).toMatch(/build big/);
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
});
