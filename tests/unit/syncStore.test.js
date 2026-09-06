"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { SyncStore } = require("../../src/main/syncStore");

async function makeTempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-sync-"));
  const store = new SyncStore(dir);
  await store.init();
  return { store, dir };
}

async function cleanupDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("SyncStore — init", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("creates syncState.json with empty object if missing", async () => {
    const content = await fs.readFile(path.join(dir, "syncState.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({});
  });

  test("preserves existing syncState.json", async () => {
    const existing = { "folder-1": { remoteShas: { "meta": "abc" } } };
    await fs.writeFile(path.join(dir, "syncState.json"), JSON.stringify(existing));
    const store2 = new SyncStore(dir);
    await store2.init();
    const state = await store2.getState();
    expect(state).toEqual(existing);
  });
});

describe("SyncStore — team scope (cursor / versions / outbox)", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("getTeam defaults", async () => {
    expect(await store.getTeam("t1")).toEqual({ cursor: 0, versions: {}, outbox: {}, failures: 0, grants: {} });
  });

  test("cursor / versions / failures round-trip", async () => {
    await store.setCursor("t1", 42);
    await store.setVersion("t1", "b1", { version: 3, createdBy: "u1" });
    await store.setFailures("t1", 2);
    const t = await store.getTeam("t1");
    expect(t.cursor).toBe(42);
    expect(t.versions.b1).toEqual({ version: 3, createdBy: "u1" });
    expect(await store.getVersion("t1", "b1")).toEqual({ version: 3, createdBy: "u1" });
    expect(t.failures).toBe(2);
    await store.removeVersion("t1", "b1");
    expect(await store.getVersion("t1", "b1")).toBeNull();
  });

  test("enqueue creates an entry with queuedAt/attempts; delete supersedes put; put after delete replaces it", async () => {
    const e = await store.enqueue("t1", "b1", { type: "build", op: "put" });
    expect(e).toMatchObject({ type: "build", op: "put", attempts: 0, nextAttemptAt: null, conflict: null });
    expect(typeof e.queuedAt).toBe("string");
    await store.enqueue("t1", "b1", { type: "build", op: "delete" });
    expect((await store.listOutbox("t1"))[0]).toMatchObject({ itemId: "b1", op: "delete" });
    await store.enqueue("t1", "b1", { type: "build", op: "put" });
    expect((await store.listOutbox("t1"))[0]).toMatchObject({ itemId: "b1", op: "put", attempts: 0, conflict: null });
  });

  test("patchOutbox / dequeue / listOutbox ordering by queuedAt", async () => {
    await store.enqueue("t1", "b1", { type: "build", op: "put" });
    await new Promise((r) => setTimeout(r, 3));
    await store.enqueue("t1", "c1", { type: "comp", op: "put" });
    await store.patchOutbox("t1", "b1", { attempts: 2, nextAttemptAt: "2030-01-01T00:00:00.000Z", conflict: { version: 5 } });
    const list = await store.listOutbox("t1");
    expect(list.map((x) => x.itemId)).toEqual(["b1", "c1"]);
    expect(list[0]).toMatchObject({ attempts: 2, conflict: { version: 5 } });
    await store.dequeue("t1", "b1");
    expect((await store.listOutbox("t1")).map((x) => x.itemId)).toEqual(["c1"]);
    await store.dequeue("t1", "nope"); // no throw
  });

  test("enqueue twice at the same instant still yields distinct queuedAt", async () => {
    const [e1, e2] = await Promise.all([
      store.enqueue("t1", "b1", { type: "build", op: "put" }),
      store.enqueue("t1", "b1", { type: "build", op: "put" }),
    ]);
    expect(e1.queuedAt).not.toBe(e2.queuedAt);
    const stored = (await store.listOutbox("t1"))[0];
    expect(stored.queuedAt).toBe(e2.queuedAt > e1.queuedAt ? e2.queuedAt : e1.queuedAt);
  });

  test("dequeue with a stale queuedAt token is a no-op and returns false", async () => {
    const e1 = await store.enqueue("t1", "b1", { type: "build", op: "put" });
    const e2 = await store.enqueue("t1", "b1", { type: "build", op: "put" }); // replaces e1
    expect(await store.dequeue("t1", "b1", { queuedAt: e1.queuedAt })).toBe(false);
    expect((await store.listOutbox("t1"))[0]).toMatchObject({ itemId: "b1" });
    expect((await store.listOutbox("t1"))[0].queuedAt).toBe(e2.queuedAt);
    expect(await store.dequeue("t1", "b1", { queuedAt: e2.queuedAt })).toBe(true);
    expect(await store.listOutbox("t1")).toEqual([]);
  });

  test("patchOutbox with a stale queuedAt token is a no-op and returns false", async () => {
    const e1 = await store.enqueue("t1", "b1", { type: "build", op: "put" });
    await store.enqueue("t1", "b1", { type: "build", op: "put" }); // replaces e1
    expect(await store.patchOutbox("t1", "b1", { attempts: 9 }, { queuedAt: e1.queuedAt })).toBe(false);
    expect((await store.listOutbox("t1"))[0].attempts).toBe(0);
  });

  test("removeTeam / listTeamIds; concurrent writes do not lose entries", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.enqueue("t1", `b${i}`, { type: "build", op: "put" })));
    expect((await store.listOutbox("t1")).length).toBe(20);
    await store.setCursor("t2", 1);
    expect((await store.listTeamIds()).sort()).toEqual(["t1", "t2"]);
    await store.removeTeam("t1");
    expect(await store.listTeamIds()).toEqual(["t2"]);
  });
});
