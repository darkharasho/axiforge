"use strict";
const db = require("../../workers/sync/src/db");

describe("sync db helpers", () => {
  test("inviteCode is 10 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const c = db.inviteCode();
      expect(c).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
    }
  });
  test("randomToken is base64url and unique", () => {
    const a = db.randomToken(), b = db.randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  test("sha256Hex", async () => {
    expect(await db.sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("errorResponse shape and status mapping", async () => {
    const res = db.errorResponse("conflict", "nope");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", message: "nope" } });
    expect(db.errorResponse("rate_limited", "slow", 429, { "Retry-After": "7" }).headers.get("Retry-After")).toBe("7");
  });
  test("nowIso uses injected clock", () => {
    expect(db.nowIso({ now: () => 0 })).toBe("1970-01-01T00:00:00.000Z");
  });
});
