"use strict";

// The shared team trash.
//
// A delete used to be final for everyone the moment it synced: the row was
// tombstoned and `body` set to NULL, so the content was gone from the server and
// the only copy anywhere was whatever each client still happened to hold. A
// teammate who was offline, or who joined afterwards, had nothing to restore
// from at all — no client-side scheme can fix that, because there is nothing on
// their machine to restore.
//
// The tombstone now keeps its body for the retention window purgeTombstones
// already enforced, so the delete becomes something the team can undo.

const teams = require("../../workers/sync/src/teams");
const items = require("../../workers/sync/src/items");
const { purgeTombstones } = require("../../workers/sync/src/purge");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

const NOW = "2026-08-21T12:00:00.000Z";

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-other", "other"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, NOW).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(NOW) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  const owner = as("u-owner", "owner");
  const member = as("u-mem", "member");

  const req = (method, body) => new Request("https://x/api/sync/x", {
    method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
  await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});

  const put = (auth, itemId, payload) =>
    items.putItem(req("PUT", payload), env, deps, auth, { teamId: team.id, itemId });
  const del = (auth, itemId, baseVersion) =>
    items.deleteItem(
      new Request(`https://x/api/sync/teams/${team.id}/items/${itemId}?baseVersion=${baseVersion}`, {
        method: "DELETE", headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
      env, deps, auth, { teamId: team.id, itemId }
    );
  const trash = (auth) => items.listTrash(req("GET"), env, deps, auth, { teamId: team.id });
  const restore = (auth, itemId) =>
    items.restoreItem(req("POST"), env, deps, auth, { teamId: team.id, itemId });

  return { env, deps, db, team, owner, member, req, put, del, trash, restore };
}

describe("team trash", () => {
  test("a deleted item keeps its content, and shows up with who removed it", async () => {
    const h = await setup();
    // The member's own build — a member may only delete what they created.
    await h.put(h.member, "b1", { type: "build", body: { title: "Doomed Reaper" }, baseVersion: null });
    expect((await h.del(h.member, "b1", 1)).status).toBe(200);

    const { items: rows } = await (await h.trash(h.owner)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "b1",
      type: "build",
      name: "Doomed Reaper",
      carried: 0,
      deletedBy: { userId: "u-mem", login: "member" },
    });
    expect(rows[0].deletedAt).toBe(NOW);
  });

  test("the changes feed still sends a tombstone with no body", async () => {
    // Keeping the body on the server must not start shipping it to every
    // client on every delete — they branch on `deleted` and would throw it away.
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Doomed" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);

    const res = await items.getChanges(
      new Request(`https://x/api/sync/teams/${h.team.id}/changes?since=0`, { headers: { "cf-connecting-ip": "1.2.3.4" } }),
      h.env, h.deps, h.owner, { teamId: h.team.id }
    );
    const { items: wire } = await res.json();
    const tombstone = wire.find((i) => i.id === "b1");
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.body).toBeNull();
  });

  test("restoring brings it back as an ordinary write the whole team picks up", async () => {
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Doomed Reaper" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);

    const res = await h.restore(h.owner, "b1");
    expect(res.status).toBe(200);

    const changes = await (await items.getChanges(
      new Request(`https://x/api/sync/teams/${h.team.id}/changes?since=0`, { headers: { "cf-connecting-ip": "1.2.3.4" } }),
      h.env, h.deps, h.owner, { teamId: h.team.id }
    )).json();
    const back = changes.items.find((i) => i.id === "b1");
    expect(back.deleted).toBe(false);
    expect(back.body).toEqual({ title: "Doomed Reaper" });
    // And it is out of the trash.
    expect((await (await h.trash(h.owner)).json()).items).toEqual([]);
  });

  test("a folder delete is ONE trash row, and restoring it brings the subtree back", async () => {
    // The cascade tombstones the whole subtree under the folder's batch.
    // Listing every descendant would show twenty rows for one act.
    const h = await setup();
    await h.put(h.owner, "f1", { type: "folder", body: { name: "Raids" }, baseVersion: null });
    await h.put(h.owner, "b1", { type: "build", parentId: "f1", body: { title: "Inside A" }, baseVersion: null });
    await h.put(h.owner, "b2", { type: "build", parentId: "f1", body: { title: "Inside B" }, baseVersion: null });
    await h.del(h.owner, "f1", 1);

    const { items: rows } = await (await h.trash(h.owner)).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "f1", type: "folder", name: "Raids", carried: 2 });

    const restored = await (await h.restore(h.owner, "f1")).json();
    expect(restored.restored.sort()).toEqual(["b1", "b2", "f1"]);

    const live = await h.db.prepare("SELECT id FROM items WHERE team_id = ? AND deleted = 0 ORDER BY id").bind(h.team.id).all();
    expect(live.results.map((r) => r.id)).toEqual(["b1", "b2", "f1"]);
  });

  test("whoever deleted it can undo it without needing the owner", async () => {
    const h = await setup();
    // Owner's build, deleted by the owner, but a member could equally have
    // deleted their own — the point is that undoing your own action is not a
    // privileged operation.
    await h.put(h.member, "b1", { type: "build", body: { title: "Mine" }, baseVersion: null });
    await h.del(h.member, "b1", 1);
    expect((await h.restore(h.member, "b1")).status).toBe(200);
  });

  test("a member cannot restore somebody else's item", async () => {
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Owner's" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);

    const res = await h.restore(h.member, "b1");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  test("non-members see neither the trash nor a restore", async () => {
    const h = await setup();
    const outsider = { user: { id: "u-other", login: "other" } };
    await h.put(h.owner, "b1", { type: "build", body: { title: "x" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);
    expect((await h.trash(outsider)).status).toBe(403);
    expect((await h.restore(outsider, "b1")).status).toBe(403);
  });

  test("restoring something that was never deleted is a 404, not a resurrection", async () => {
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Alive" }, baseVersion: null });
    expect((await h.restore(h.owner, "b1")).status).toBe(404);
  });

  test("a tombstone from before this feature says so rather than restoring nothing", async () => {
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Old" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);
    // Simulate the pre-migration shape: tombstoned with the body thrown away.
    await h.db.prepare("UPDATE items SET body = NULL WHERE team_id = ? AND id = ?").bind(h.team.id, "b1").run();

    const res = await h.restore(h.owner, "b1");
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toMatch(/before the team trash existed/);
  });

  test("the retention clock runs from the deletion, and a restore does not reset it", async () => {
    // purgeTombstones used to measure from updated_at. A restore bumps that, so
    // measuring from it would let a restore-then-delete cycle keep a tombstone
    // alive indefinitely — and, worse, would purge nothing that had ever been
    // restored on schedule.
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Old" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);

    const thirtyOneDaysLater = Date.parse(NOW) + 31 * 24 * 60 * 60 * 1000;
    const out = await purgeTombstones(h.env, { now: () => thirtyOneDaysLater });
    expect(out.deleted).toBe(1);
    expect((await (await h.trash(h.owner)).json()).items).toEqual([]);
  });

  test("a tombstone inside the window survives the sweep", async () => {
    const h = await setup();
    await h.put(h.owner, "b1", { type: "build", body: { title: "Recent" }, baseVersion: null });
    await h.del(h.owner, "b1", 1);

    const tenDaysLater = Date.parse(NOW) + 10 * 24 * 60 * 60 * 1000;
    await purgeTombstones(h.env, { now: () => tenDaysLater });
    expect((await (await h.trash(h.owner)).json()).items).toHaveLength(1);
  });
});
