"use strict";
const teams = require("../../workers/sync/src/teams");
const { ROUTES } = require("../../workers/sync/src/router");
const { createTestD1, createTestKV } = require("../helpers/d1Shim");

async function setup() {
  const db = createTestD1();
  await db.applyMigrations();
  const now = "2026-08-21T12:00:00.000Z";
  for (const [id, login] of [["u-owner", "owner"], ["u-mem", "member"], ["u-other", "other"]]) {
    await db.prepare("INSERT INTO users (id, display_name, avatar_url, created_at) VALUES (?, ?, NULL, ?)").bind(id, login, now).run();
    await db.prepare("INSERT INTO identities (provider, provider_user_id, user_id, login) VALUES ('github', ?, ?, ?)").bind(id, id, login).run();
  }
  const env = { SYNC_DB: db, SYNC_RL: createTestKV() };
  const deps = { now: () => Date.parse(now) };
  const as = (id, login) => ({ user: { id, login, displayName: login, avatarUrl: null } });
  return { env, deps, db, owner: as("u-owner", "owner"), member: as("u-mem", "member"), other: as("u-other", "other") };
}
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
// Force the next N calls to db.inviteCode() to return specific codes, so a
// UNIQUE(invite_code) collision can be provoked for real (SQLite raises it, we
// do not fake the error).
function forceNextInviteCodes(...codes) {
  const real = crypto.getRandomValues.bind(crypto);
  const queue = [...codes];
  const spy = jest.spyOn(crypto, "getRandomValues").mockImplementation((arr) => {
    if (arr instanceof Uint8Array && arr.length === 10 && queue.length) {
      const code = queue.shift();
      for (let i = 0; i < 10; i += 1) arr[i] = ALPHABET.indexOf(code[i]);
      return arr;
    }
    return real(arr);
  });
  const restore = () => spy.mockRestore();
  restore.remaining = () => queue.length; // 0 proves the forced collision really happened
  return restore;
}

const req = (method, body, ip = "1.2.3.4") => new Request("https://x/api/sync/teams", {
  method, headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: body ? JSON.stringify(body) : undefined,
});

describe("teams", () => {
  test("create → owner membership, invite code; list shows role and seq", async () => {
    const { env, deps, owner } = await setup();
    const res = await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("owner");
    expect(body.team.inviteCode).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    const list = await (await teams.listTeams(req("GET"), env, deps, owner, {})).json();
    expect(list).toEqual([{ team: { id: body.team.id, name: "EWW", inviteCode: body.team.inviteCode, seq: 0, createdAt: expect.any(String) }, role: "owner" }]);
  });

  test("create rejects empty/too-long names", async () => {
    const { env, deps, owner } = await setup();
    expect((await teams.createTeam(req("POST", { name: "  " }), env, deps, owner, {})).status).toBe(400);
    expect((await teams.createTeam(req("POST", { name: "x".repeat(81) }), env, deps, owner, {})).status).toBe(400);
  });

  test("create with a client-supplied id uses it; duplicate → 409", async () => {
    const { env, deps, owner, member } = await setup();
    const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    const res = await teams.createTeam(req("POST", { name: "EWW", id }), env, deps, owner, {});
    expect(res.status).toBe(201);
    expect((await res.json()).team.id).toBe(id);
    const dup = await teams.createTeam(req("POST", { name: "Other", id }), env, deps, member, {});
    expect(dup.status).toBe(409);
    // a non-uuid id is ignored, not an error
    const odd = await teams.createTeam(req("POST", { name: "Odd", id: "../evil" }), env, deps, owner, {});
    expect(odd.status).toBe(201);
    expect((await odd.json()).team.id).not.toBe("../evil");
  });

  test("join by invite code → member; idempotent; unknown code 404; members don't see the invite code", async () => {
    const { env, deps, owner, member } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    const j1 = await teams.joinTeam(req("POST", { inviteCode: team.inviteCode.toLowerCase() }), env, deps, member, {});
    expect(j1.status).toBe(200);
    expect((await j1.json()).role).toBe("member");
    const j2 = await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    expect(j2.status).toBe(200);
    expect((await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }), env, deps, member, {})).status).toBe(404);
    const list = await (await teams.listTeams(req("GET"), env, deps, member, {})).json();
    expect(list[0].role).toBe("member");
    expect(list[0].team.inviteCode).toBeUndefined();
  });

  test("join is rate limited per IP (10/min)", async () => {
    const { env, deps, member } = await setup();
    for (let i = 0; i < 10; i++) await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }, "9.9.9.9"), env, deps, member, {});
    const r = await teams.joinTeam(req("POST", { inviteCode: "ZZZZZZZZZZ" }, "9.9.9.9"), env, deps, member, {});
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  test("members list; owner can remove a member; member can leave; last owner cannot leave", async () => {
    const { env, deps, owner, member, other } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    const p = { teamId: team.id };
    const members = await (await teams.listMembers(req("GET"), env, deps, member, p)).json();
    expect(members.map((m) => [m.login, m.role])).toEqual([["owner", "owner"], ["member", "member"]]);

    expect((await teams.listMembers(req("GET"), env, deps, other, p)).status).toBe(403);
    expect((await teams.removeMember(req("DELETE"), env, deps, member, { ...p, userId: "u-owner" })).status).toBe(403);
    expect((await teams.removeMember(req("DELETE"), env, deps, owner, { ...p, userId: "u-owner" })).status).toBe(403); // last owner
    expect((await teams.removeMember(req("DELETE"), env, deps, member, { ...p, userId: "u-mem" })).status).toBe(204); // leave
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    expect((await teams.removeMember(req("DELETE"), env, deps, owner, { ...p, userId: "u-mem" })).status).toBe(204); // kick
    expect((await (await teams.listMembers(req("GET"), env, deps, owner, p)).json()).length).toBe(1);
  });

  test("rename/rotate/delete are owner-only; rotate invalidates the old code; delete cascades", async () => {
    const { env, deps, db, owner, member } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    const p = { teamId: team.id };
    expect((await teams.renameTeam(req("PATCH", { name: "New" }), env, deps, member, p)).status).toBe(403);
    expect((await teams.renameTeam(req("PATCH", { name: "New" }), env, deps, owner, p)).status).toBe(200);
    expect(await db.prepare("SELECT name FROM teams WHERE id = ?").bind(team.id).first("name")).toBe("New");

    expect((await teams.rotateInvite(req("POST"), env, deps, member, p)).status).toBe(403);
    const { inviteCode } = await (await teams.rotateInvite(req("POST"), env, deps, owner, p)).json();
    expect(inviteCode).not.toBe(team.inviteCode);
    expect((await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {})).status).toBe(404);

    await db.prepare("INSERT INTO items (team_id, id, type, body, version, seq, created_by, updated_by, updated_at) VALUES (?, 'b1', 'build', '{}', 1, 1, 'u-owner', 'u-owner', ?)").bind(team.id, "2026-08-21T12:00:00.000Z").run();
    expect((await teams.deleteTeam(req("DELETE"), env, deps, member, p)).status).toBe(403);
    expect((await teams.deleteTeam(req("DELETE"), env, deps, owner, p)).status).toBe(204);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM memberships WHERE team_id = ?").bind(team.id).first("c")).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM items WHERE team_id = ?").bind(team.id).first("c")).toBe(0);
  });


  test("a create that loses the id race (row appears after the pre-check) is a 409, not a 500", async () => {
    const { env, deps, db, owner, member } = await setup();
    const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    expect((await teams.createTeam(req("POST", { name: "First", id }), env, deps, owner, {})).status).toBe(201);
    // Simulate the concurrent case: the SELECT pre-check misses (as it would if
    // the other create had not committed yet), so the INSERT is what collides.
    const realPrepare = db.prepare.bind(db);
    let blinded = false;
    db.prepare = (sql) => {
      if (!blinded && sql === "SELECT id FROM teams WHERE id = ?") {
        blinded = true;
        const st = realPrepare(sql);
        return { ...st, bind: () => ({ ...st, first: async () => null }) };
      }
      return realPrepare(sql);
    };
    const res = await teams.createTeam(req("POST", { name: "Second", id }), env, deps, member, {});
    db.prepare = realPrepare;
    expect(blinded).toBe(true);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    // the loser did not clobber the winner
    expect(await db.prepare("SELECT name FROM teams WHERE id = ?").bind(id).first("name")).toBe("First");
    expect(await db.prepare("SELECT COUNT(*) AS c FROM memberships WHERE team_id = ?").bind(id).first("c")).toBe(1);
  });

  test("create retries an invite-code collision but propagates unrelated errors immediately", async () => {
    const { env, deps, db, owner, member } = await setup();
    const first = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    const restore = forceNextInviteCodes(first.team.inviteCode); // first attempt collides
    try {
      const res = await teams.createTeam(req("POST", { name: "Second" }), env, deps, member, {});
      expect(res.status).toBe(201);
      expect((await res.json()).team.inviteCode).not.toBe(first.team.inviteCode);
      expect(restore.remaining()).toBe(0);
    } finally { restore(); }

    // an unrelated DB failure must surface on the FIRST attempt, unretried
    const realBatch = db.batch.bind(db);
    let calls = 0;
    db.batch = async () => { calls += 1; throw new Error("D1_ERROR: disk I/O error"); };
    await expect(teams.createTeam(req("POST", { name: "Third" }), env, deps, owner, {})).rejects.toThrow("disk I/O error");
    db.batch = realBatch;
    expect(calls).toBe(1);
  });

  test("create is rate limited per user (20/hour)", async () => {
    const { env, deps, owner } = await setup();
    for (let i = 0; i < 20; i++) expect((await teams.createTeam(req("POST", { name: `T${i}` }), env, deps, owner, {})).status).toBe(201);
    const r = await teams.createTeam(req("POST", { name: "Too many" }), env, deps, owner, {});
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  test("rotate survives an invite-code collision and still yields a working code", async () => {
    const { env, deps, db, owner, member } = await setup();
    const a = await (await teams.createTeam(req("POST", { name: "A" }), env, deps, owner, {})).json();
    const b = await (await teams.createTeam(req("POST", { name: "B" }), env, deps, owner, {})).json();
    const restore = forceNextInviteCodes(b.team.inviteCode); // first rotate attempt collides with team B
    let rotated;
    try {
      const res = await teams.rotateInvite(req("POST"), env, deps, owner, { teamId: a.team.id });
      expect(res.status).toBe(200);
      rotated = (await res.json()).inviteCode;
      expect(restore.remaining()).toBe(0);
    } finally { restore(); }
    expect(rotated).not.toBe(b.team.inviteCode);
    expect(rotated).not.toBe(a.team.inviteCode);
    expect(await db.prepare("SELECT invite_code FROM teams WHERE id = ?").bind(a.team.id).first("invite_code")).toBe(rotated);
    // team B kept its code, and the rotated one really joins team A
    expect(await db.prepare("SELECT invite_code FROM teams WHERE id = ?").bind(b.team.id).first("invite_code")).toBe(b.team.inviteCode);
    const joined = await (await teams.joinTeam(req("POST", { inviteCode: rotated }), env, deps, member, {})).json();
    expect(joined.team.id).toBe(a.team.id);
  });

  test("setMemberRole: owner can promote/demote, member cannot, non-member 403, last owner protected", async () => {
    const { env, deps, db, owner, member, other } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    await teams.joinTeam(req("POST", { inviteCode: team.inviteCode }), env, deps, member, {});
    const p = { teamId: team.id, userId: "u-mem" };

    // a plain member cannot change roles (not even their own)
    expect((await teams.setMemberRole(req("PATCH", { role: "owner" }), env, deps, member, p)).status).toBe(403);
    // a non-member cannot either
    expect((await teams.setMemberRole(req("PATCH", { role: "owner" }), env, deps, other, p)).status).toBe(403);
    expect(await db.prepare("SELECT role FROM memberships WHERE team_id = ? AND user_id = 'u-mem'").bind(team.id).first("role")).toBe("member");

    // bad role / unknown target
    expect((await teams.setMemberRole(req("PATCH", { role: "admin" }), env, deps, owner, p)).status).toBe(400);
    expect((await teams.setMemberRole(req("PATCH", {}), env, deps, owner, p)).status).toBe(400);
    expect((await teams.setMemberRole(req("PATCH", { role: "owner" }), env, deps, owner, { ...p, userId: "u-other" })).status).toBe(404);

    // the owner promotes
    const res = await teams.setMemberRole(req("PATCH", { role: "owner" }), env, deps, owner, p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "u-mem", role: "owner" });
    expect(await db.prepare("SELECT role FROM memberships WHERE team_id = ? AND user_id = 'u-mem'").bind(team.id).first("role")).toBe("owner");

    // the promoted member is now a real owner: they can rotate, and the original owner can now leave
    expect((await teams.rotateInvite(req("POST"), env, deps, member, { teamId: team.id })).status).toBe(200);
    expect((await teams.removeMember(req("DELETE"), env, deps, owner, { teamId: team.id, userId: "u-owner" })).status).toBe(204);

    // ...and the sole remaining owner cannot demote themselves into a leaderless team
    const solo = await teams.setMemberRole(req("PATCH", { role: "member" }), env, deps, member, p);
    expect(solo.status).toBe(403);
    expect(await db.prepare("SELECT role FROM memberships WHERE team_id = ? AND user_id = 'u-mem'").bind(team.id).first("role")).toBe("owner");
  });

  test("the last-owner error names a route that exists", async () => {
    const { env, deps, owner } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    const res = await teams.removeMember(req("DELETE"), env, deps, owner, { teamId: team.id, userId: "u-owner" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/promote/i);
    expect(ROUTES.some(([method, pattern, handler]) => method === "PATCH" && handler === teams.setMemberRole && pattern.test(`/teams/${team.id}/members/u-mem`))).toBe(true);
  });

  test("requireMembership", async () => {
    const { env, deps, owner, other } = await setup();
    const { team } = await (await teams.createTeam(req("POST", { name: "EWW" }), env, deps, owner, {})).json();
    expect((await teams.requireMembership(env, team.id, "u-owner")).role).toBe("owner");
    expect(await teams.requireMembership(env, team.id, "u-other")).toBeNull();
    expect(await teams.requireMembership(env, "nope", "u-owner")).toBeNull();
  });
});
