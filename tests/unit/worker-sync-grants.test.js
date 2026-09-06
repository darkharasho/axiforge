"use strict";

// Per-folder access inside a teamspace.
//
// A team used to have exactly two settings for a person — owner (do anything) or
// member (write anything, delete only your own) — which is one decision for the
// whole library. A grant narrows or widens that for one folder and everything
// inside it, and the NEAREST grant walking up from an item wins.
//
// The rule that matters most here is that a team with no grants must behave
// exactly as it always did. Every existing worker test is that assertion; these
// are the ones that exercise the new lever.

const teams = require("../../workers/sync/src/teams");
const items = require("../../workers/sync/src/items");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

const NOW = "2026-09-05T12:00:00.000Z";

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-two", "second"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, NOW).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(NOW) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  const owner = as("u-owner", "owner");
  const member = as("u-mem", "member");
  const second = as("u-two", "second");

  const req = (method, body) => new Request("https://x/api/sync/x", {
    method, headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
  for (const who of [member, second]) await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, who, {});

  const put = (auth, itemId, payload) =>
    items.putItem(req("PUT", payload), env, deps, auth, { teamId: team.id, itemId });
  const del = (auth, itemId, baseVersion) =>
    items.deleteItem(
      new Request(`https://x/api/sync/teams/${team.id}/items/${itemId}?baseVersion=${baseVersion}`, {
        method: "DELETE", headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
      env, deps, auth, { teamId: team.id, itemId }
    );
  const changes = (auth, since = 0) =>
    items.getChanges(new Request(`https://x/api/sync/teams/${team.id}/changes?since=${since}`), env, deps, auth, { teamId: team.id });
  const grant = (auth, folderId, userId, access) =>
    teams.setGrant(req("PUT", { access }), env, deps, auth, { teamId: team.id, folderId, userId });
  const ungrant = (auth, folderId, userId) =>
    teams.clearGrant(req("DELETE"), env, deps, auth, { teamId: team.id, folderId, userId });
  const listGrants = (auth) => teams.listGrants(req("GET"), env, deps, auth, { teamId: team.id });

  // A small tree: root → raids → (a build), plus a loose build at the root.
  await put(owner, "raids", { type: "folder", parentId: null, body: { name: "Raids" } });
  await put(owner, "b-raid", { type: "build", parentId: "raids", body: { title: "Raid FB" } });
  await put(owner, "b-root", { type: "build", parentId: null, body: { title: "Loose" } });

  return { env, deps, db, team, owner, member, second, req, put, del, changes, grant, ungrant, listGrants };
}

const bodyOf = async (res) => res.json();
const idsIn = async (res) => (await res.json()).items.map((i) => i.id);

describe("setting a grant", () => {
  test("only an owner may hand one out", async () => {
    const t = await setup();
    const res = await t.grant(t.member, "raids", "u-two", "read");
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe("forbidden");
  });

  test("an owner cannot be restricted, because they could undo it in the same breath", async () => {
    const t = await setup();
    const res = await t.grant(t.owner, "raids", "u-owner", "read");
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error.message).toMatch(/Owners always have full access/);
  });

  test("the folder has to actually be in this team", async () => {
    const t = await setup();
    expect((await t.grant(t.owner, "no-such-folder", "u-mem", "read")).status).toBe(404);
  });

  test("a grant on the team's own id is the team-wide default for that person", async () => {
    const t = await setup();
    expect((await t.grant(t.owner, t.team.id, "u-mem", "read")).status).toBe(200);
    const res = await t.put(t.member, "b-new", { type: "build", parentId: null, body: { title: "Nope" } });
    expect(res.status).toBe(403);
  });

  test("the target has to be a member", async () => {
    const t = await setup();
    expect((await t.grant(t.owner, "raids", "u-stranger", "read")).status).toBe(404);
  });

  test("an unknown level is refused rather than silently ignored", async () => {
    const t = await setup();
    expect((await t.grant(t.owner, "raids", "u-mem", "admin")).status).toBe(400);
  });

  test("setting one twice replaces it", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    await t.grant(t.owner, "raids", "u-mem", "none");
    const { grants } = await bodyOf(await t.listGrants(t.owner));
    expect(grants).toHaveLength(1);
    expect(grants[0].access).toBe("none");
  });

  test('"inherit" removes the grant rather than storing a level', async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    expect((await t.grant(t.owner, "raids", "u-mem", "inherit")).status).toBe(204);
    expect((await bodyOf(await t.listGrants(t.owner))).grants).toEqual([]);
  });
});

describe("reading grants", () => {
  test("a member sees their own restrictions and nobody else's", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    await t.grant(t.owner, "raids", "u-two", "none");
    const { grants } = await bodyOf(await t.listGrants(t.member));
    expect(grants.map((g) => g.userId)).toEqual(["u-mem"]);
  });

  test("an owner sees the whole team's, with logins to render them by", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    await t.grant(t.owner, "raids", "u-two", "none");
    const { grants, defaults } = await bodyOf(await t.listGrants(t.owner));
    expect(grants.map((g) => g.login).sort()).toEqual(["member", "second"]);
    // The fallback level comes from the server so the client need not hard-code it.
    expect(defaults.member).toBe("write");
  });
});

describe("write access", () => {
  test("read-only means read-only: no new builds in that folder", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await t.put(t.member, "b-new", { type: "build", parentId: "raids", body: { title: "Nope" } });
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.code).toBe("forbidden");
  });

  test("and no edits to what is already there", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    expect((await t.put(t.member, "b-raid", { type: "build", parentId: "raids", body: { title: "Edited" }, baseVersion: 1 })).status).toBe(403);
  });

  test("the rest of the team's library is untouched by one folder's grant", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    expect((await t.put(t.member, "b-mine", { type: "build", parentId: null, body: { title: "Mine" } })).status).toBe(201);
  });

  test("the nearest grant wins, so a narrow one can re-open a broad one", async () => {
    const t = await setup();
    await t.grant(t.owner, t.team.id, "u-mem", "read");   // read-only everywhere…
    await t.grant(t.owner, "raids", "u-mem", "write");    // …except here
    expect((await t.put(t.member, "b-new", { type: "build", parentId: "raids", body: { title: "Yes" } })).status).toBe(201);
    expect((await t.put(t.member, "b-other", { type: "build", parentId: null, body: { title: "No" } })).status).toBe(403);
  });

  test("a grant covers nested folders too", async () => {
    const t = await setup();
    await t.put(t.owner, "wing1", { type: "folder", parentId: "raids", body: { name: "Wing 1" } });
    await t.grant(t.owner, "raids", "u-mem", "read");
    expect((await t.put(t.member, "b-deep", { type: "build", parentId: "wing1", body: { title: "Nope" } })).status).toBe(403);
  });

  test("you cannot move something out of a folder you may only read", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await t.put(t.member, "b-raid", { type: "build", parentId: null, body: { title: "Raid FB" }, baseVersion: 1 });
    expect(res.status).toBe(403);
  });

  test("nor smuggle one into it", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await t.put(t.member, "b-root", { type: "build", parentId: "raids", body: { title: "Loose" }, baseVersion: 1 });
    expect(res.status).toBe(403);
  });

  test("a folder with its own grant cannot be renamed by someone held to read", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await t.put(t.member, "raids", { type: "folder", parentId: null, body: { name: "Renamed" }, baseVersion: 1 });
    expect(res.status).toBe(403);
  });

  test("the owner is never affected by any of it", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    expect((await t.put(t.owner, "b-o", { type: "build", parentId: "raids", body: { title: "Fine" } })).status).toBe(201);
  });

  test("bulk writes are checked item by item, not once for the request", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await items.bulkItems(
      t.req("POST", { items: [
        { itemId: "b-ok", type: "build", parentId: null, body: { title: "ok" } },
        { itemId: "b-no", type: "build", parentId: "raids", body: { title: "no" } },
      ] }),
      t.env, t.deps, t.member, { teamId: t.team.id }
    );
    const { results } = await bodyOf(res);
    expect(results.map((r) => r.status)).toEqual([201, 403]);
  });
});

describe("delete access", () => {
  test("delete lets you remove a teammate's work, which write alone does not", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "delete");
    expect((await t.del(t.member, "b-raid", 1)).status).toBe(200);
  });

  test("without it you still may not touch someone else's", async () => {
    const t = await setup();
    const res = await t.del(t.member, "b-raid", 1);
    expect(res.status).toBe(403);
  });

  test("read-only revokes cleaning up after yourself", async () => {
    const t = await setup();
    await t.put(t.member, "b-mine", { type: "build", parentId: "raids", body: { title: "Mine" } });
    await t.grant(t.owner, "raids", "u-mem", "read");
    const res = await t.del(t.member, "b-mine", 1);
    expect(res.status).toBe(403);
  });

  test("a folder delete refuses when the cascade would take something you may not", async () => {
    const t = await setup();
    await t.put(t.member, "mine", { type: "folder", parentId: null, body: { name: "Mine" } });
    await t.put(t.member, "b-a", { type: "build", parentId: "mine", body: { title: "A" } });
    await t.put(t.owner, "b-theirs", { type: "build", parentId: "mine", body: { title: "Theirs" } });
    const res = await t.del(t.member, "mine", 1);
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error.message).toMatch(/contains items you do not have permission/);
  });

  test("an item you cannot see answers 404, not 403 — a 403 would confirm it exists", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    const res = await t.del(t.member, "b-raid", 1);
    expect(res.status).toBe(404);
  });
});

describe("hiding a folder", () => {
  test("none keeps the folder and its contents out of the changes feed", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    const ids = await idsIn(await t.changes(t.member));
    expect(ids).toEqual(["b-root"]);
  });

  test("everyone else still sees the whole team", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    expect((await idsIn(await t.changes(t.second))).sort()).toEqual(["b-raid", "b-root", "raids"]);
  });

  test("read still shows it — hidden and read-only are different things", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "read");
    expect((await idsIn(await t.changes(t.member))).sort()).toEqual(["b-raid", "b-root", "raids"]);
  });

  test("the cursor advances past filtered-out items, so a busy hidden folder cannot stall a pull", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    const page = await bodyOf(await t.changes(t.member));
    const all = await bodyOf(await t.changes(t.second));
    expect(page.items).toHaveLength(1);
    expect(page.nextSeq).toBe(all.nextSeq);
  });
});

describe("telling the client its access changed", () => {
  test("a grant edit makes that member's next incremental pull resync", async () => {
    const t = await setup();
    const before = await bodyOf(await t.changes(t.member));
    expect((await bodyOf(await t.changes(t.member, before.nextSeq))).resync).toBe(false);
    await t.grant(t.owner, "raids", "u-mem", "none");
    expect((await bodyOf(await t.changes(t.member, before.nextSeq))).resync).toBe(true);
  });

  test("and does not disturb anyone else's cursor", async () => {
    const t = await setup();
    const before = await bodyOf(await t.changes(t.second));
    await t.grant(t.owner, "raids", "u-mem", "none");
    expect((await bodyOf(await t.changes(t.second, before.nextSeq))).resync).toBe(false);
  });

  test("clearing a grant resyncs too — regaining access is as invisible as losing it", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    const after = await bodyOf(await t.changes(t.member));
    await t.ungrant(t.owner, "raids", "u-mem");
    const back = await bodyOf(await t.changes(t.member, after.nextSeq));
    expect(back.resync).toBe(true);
    expect((await idsIn(await t.changes(t.member))).sort()).toEqual(["b-raid", "b-root", "raids"]);
  });

  test("a resync from zero hands back only what is still visible", async () => {
    const t = await setup();
    await t.grant(t.owner, "raids", "u-mem", "none");
    expect(await idsIn(await t.changes(t.member, 0))).toEqual(["b-root"]);
  });
});

describe("trash", () => {
  test("a hidden folder's deletions stay hidden", async () => {
    const t = await setup();
    await t.del(t.owner, "b-raid", 1);
    await t.grant(t.owner, "raids", "u-mem", "none");
    const { items: rows } = await bodyOf(
      await items.listTrash(t.req("GET"), t.env, t.deps, t.member, { teamId: t.team.id })
    );
    expect(rows.map((r) => r.id)).toEqual([]);
  });

  test("read-only means you cannot put things back, and the row says so", async () => {
    const t = await setup();
    await t.put(t.member, "b-mine", { type: "build", parentId: "raids", body: { title: "Mine" } });
    await t.del(t.member, "b-mine", 1);
    await t.grant(t.owner, "raids", "u-mem", "read");
    const { items: rows } = await bodyOf(
      await items.listTrash(t.req("GET"), t.env, t.deps, t.member, { teamId: t.team.id })
    );
    expect(rows.find((r) => r.id === "b-mine").canRestore).toBe(false);
    const res = await items.restoreItem(t.req("POST"), t.env, t.deps, t.member, { teamId: t.team.id, itemId: "b-mine" });
    expect(res.status).toBe(403);
  });
});
