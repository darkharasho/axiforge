# Team Sync — Plan 2 of 3: Client Engine (Electron main) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-org `SharedLibrary` engine with `TeamSync`: an outbox-backed push, a cursor-based pull, real conflict handling, and `teams:*` IPC — wired into every handler that mutates team items — and delete the GitHub sync code.

**Architecture:** `syncApi.js` is a thin typed fetch client for `/api/sync/*` (Plan 1). `teamSync.js` owns the outbox (persisted in `syncState.json` *before* the IPC handler returns), serialized per-team flushes with backoff, paged pulls applied through the write-queued stores, and conflict resolution. `index.js` swaps `SharedLibrary` for `TeamSync` and routes save/delete/move/folder mutations through `teamSync.enqueue`. Preload exposes `teams:*`; legacy `shared-library` bindings become explicit compat shims that Plan 3 removes.

**Tech Stack:** Node 24 / Electron main, Jest 30 (real stores in temp dirs, fake `api` objects), existing `jsonFile.js` atomic stores.

**Spec:** `docs/superpowers/specs/2026-08-21-team-sync-design.md` (sections 2, 2.1–2.9, 5, 6)

## Global Constraints

- Base URL: `process.env.AXIFORGE_SYNC_BASE || "https://build.axi.link/api/sync"`.
- Flush debounce **1 s** per item, **max 5 s**; one in-flight request chain per team.
- Backoff on offline/5xx/429: `min(5s · 2^attempts, 5 min)`, or `Retry-After` when given.
- Poll every **30 s**; focus pull with **10 s** cooldown; third consecutive pull failure → one `{status:"error", error:"pull"}` event (UI toasts once); counter resets on success.
- `changes` page size **200**.
- Build body excludes `folderId`, `pinned`, `sortOrder`, `compIds`; comp body excludes `folderId`, `sortOrder`, `boonCoverageHtml`; folder body is `{ name, sortOrder }`.
- `sync-status` events keep the existing shape `{ status, type?, id?, folderId, item? }`; new `status` values `pending` and `conflict`; `sync-conflict` event payload `{ teamId, itemId, type, title, current }`.
- Never release or push without approval; commit after each task.
- Run tests with `npx jest <file> --maxWorkers=2`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/main/syncApi.js` | HTTP client + `SyncApiError` |
| `src/main/syncStore.js` | Team-scoped persisted state: cursor, versions, outbox (rewritten) |
| `src/main/folderStore.js` | Persist `teamId` / `role` on root folders |
| `src/main/buildStore.js`, `src/main/compStore.js` | `publishedOwner` field |
| `src/main/teamSync.js` | Engine: session, teams, outbox/flush, pull/apply, conflicts, share/stop-sharing |
| `src/main/index.js` | Wiring: `TeamSync`, `teams:*` IPC, mutation handlers call `enqueue`, publish stores `publishedOwner` |
| `src/preload/index.js` | `teams:*` bindings + compat shims |
| deleted | `src/main/sharedLibrary.js`, `tests/unit/sharedLibrary.test.js`, shared-repo functions in `githubApi.js` + their tests |

---

### Task 1: `publishedOwner` — record where a build/comp was published; use it for share links

**Files:**
- Modify: `src/main/buildStore.js` (`normalizeBuild`, `upsertBuild` preserve block, `markPublished`)
- Modify: `src/main/compStore.js` (`upsertComp` publishedPatch, `markPublished`)
- Modify: `src/main/index.js` — `publishBuildImpl`, `publishCompImpl`, the four `shortUrl(owner, …)` call sites (`discord:share-comp`, `discord:share-build`, and the two around lines 1653/1674/1787)
- Test: `tests/unit/buildStore.test.js`, `tests/unit/compStore.test.js` (append), `tests/unit/publishedOwner.test.js`

**Interfaces:**
- Produces: `build.publishedOwner` / `comp.publishedOwner` (GitHub login, `""`/undefined when never published); `markPublished(id, { …, publishedOwner })`; helper `publishedOwnerFor(record, fallbackOwner)` exported from `src/main/shortUrl.js`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/buildStore.test.js`:

```js
describe("publishedOwner", () => {
  test("normalizes, preserves across saves, and is stamped by markPublished", async () => {
    const { store, dir: d } = await makeTempStore();
    dir = d;
    const saved = await store.upsertBuild({ title: "B", publishedOwner: "gw2eww" });
    expect(saved.publishedOwner).toBe("gw2eww");
    const again = await store.upsertBuild({ ...saved, publishedOwner: "" });
    expect(again.publishedOwner).toBe("gw2eww");
    const stamped = await store.markPublished(saved.id, { publishedFileId: "f", publishedKey: "k", publishedSlug: "b", publishedOwner: "darkharasho", snapshotUpdatedAt: again.updatedAt });
    expect(stamped.publishedOwner).toBe("darkharasho");
  });
});
```

Append to `tests/unit/compStore.test.js`:

```js
describe("publishedOwner", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("upsert keeps it and markPublished sets it", async () => {
    const c = await store.upsertComp({ name: "C", publishedOwner: "gw2eww" });
    expect(c.publishedOwner).toBe("gw2eww");
    const stamped = await store.markPublished(c.id, { publishedFileId: "f", publishedKey: "k", publishedSlug: "c", publishedOwner: "other", snapshotUpdatedAt: c.updatedAt });
    expect(stamped.publishedOwner).toBe("other");
  });
});
```

Create `tests/unit/publishedOwner.test.js`:

```js
"use strict";
const { publishedOwnerFor, shortUrl } = require("../../src/main/shortUrl");

test("publishedOwnerFor prefers the record's owner, falls back to the account owner", () => {
  expect(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me")).toBe("gw2eww");
  expect(publishedOwnerFor({ publishedOwner: "" }, "me")).toBe("me");
  expect(publishedOwnerFor({}, "me")).toBe("me");
  expect(shortUrl(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me"), "axibuilds", "abc")).toBe("https://gw2eww.github.io/axibuilds/r/abc");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/publishedOwner.test.js --maxWorkers=2`
Expected: FAIL (publishedOwner undefined / `publishedOwnerFor` not a function)

- [ ] **Step 3: Implement**

`src/main/shortUrl.js`:

```js
"use strict";

function shortUrl(owner, repo, fileId) {
  return `https://${owner}.github.io/${repo}/r/${fileId}`;
}

// Links must point at the account the item was actually published under, not
// whatever the current user's publishing target is (a teammate's build is on
// the teammate's Pages site).
function publishedOwnerFor(record, fallbackOwner) {
  return (record && record.publishedOwner) || fallbackOwner;
}

module.exports = { shortUrl, publishedOwnerFor };
```

`src/main/buildStore.js` — in `normalizeBuild` after `publishedAt`:
```js
    publishedOwner: asString(input.publishedOwner, 80),
```
in `upsertBuild` preserve block after the `publishedAt` line:
```js
        if (!next.publishedOwner && existing.publishedOwner) next.publishedOwner = existing.publishedOwner;
```
in `markPublished` signature add `publishedOwner` and after `publishedSlug:` line:
```js
        publishedOwner: publishedOwner || existing.publishedOwner || "",
```

`src/main/compStore.js` — in `publishedPatch` add:
```js
      ...(typeof input.publishedOwner === "string" ? { publishedOwner: input.publishedOwner } : {}),
```
in `markPublished` signature add `publishedOwner` and after the `publishedSlug` line:
```js
      if (publishedOwner) existing.publishedOwner = publishedOwner;
```

`src/main/index.js`:
- `publishBuildImpl`: the `markPublished` call gains `publishedOwner: owner,`.
- `publishCompImpl`: `updatedBuildRecords.push({ id: build.id, publishedFileId: fileId, publishedKey: encKey, publishedSlug: slug, publishedOwner: owner, snapshotUpdatedAt: build.updatedAt })`; the comp `markPublished` gains `publishedOwner: owner,`.
- At the top with the other requires: `const { shortUrl, publishedOwnerFor } = require("./shortUrl");` and delete the inline `const { shortUrl } = require("./shortUrl");` / `require("./shortUrl").shortUrl` usages.
- Every `shortUrl(owner, repo, X.publishedFileId)` becomes `shortUrl(publishedOwnerFor(X, owner), repo, X.publishedFileId)` (comp and each build in the loops).
- `comps:get-published-url` (≈line 880): `const owner = publishedOwnerFor(comp, auth?.onboarding?.targetOwner);` — so the "Published Link" button also points at the account the comp was actually published under.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/publishedOwner.test.js tests/unit/shareGate.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/shortUrl.js src/main/buildStore.js src/main/compStore.js src/main/index.js tests/unit/buildStore.test.js tests/unit/compStore.test.js tests/unit/publishedOwner.test.js
git commit -m "feat(publish): record publishedOwner and build share links from it"
```

---

### Task 2: `syncApi.js` — typed client for `/api/sync/*`

**Files:**
- Create: `src/main/syncApi.js`
- Test: `tests/unit/syncApi.test.js`

**Interfaces:**
- Produces: `class SyncApi { constructor({ baseUrl?, getToken, fetchImpl?, userAgent? }) }` with methods `loginGithub(githubToken)`, `logout()`, `createTeam(name)`, `joinTeam(inviteCode)`, `listTeams()`, `listMembers(teamId)`, `removeMember(teamId, userId)`, `rotateInvite(teamId)`, `renameTeam(teamId, name)`, `deleteTeam(teamId)`, `changes(teamId, since, limit = 200)`, `putItem(teamId, itemId, { type, parentId, body, baseVersion })`, `deleteItem(teamId, itemId, baseVersion)`, `bulk(teamId, items)`; `class SyncApiError extends Error { code, status, current, retryAfterMs, message }` with `code ∈ SYNC_UNAUTHORIZED | SYNC_FORBIDDEN | SYNC_NOT_FOUND | SYNC_CONFLICT | SYNC_TOO_LARGE | SYNC_RATE_LIMITED | SYNC_INVALID | SYNC_OFFLINE`; `DEFAULT_BASE_URL`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/syncApi.test.js
"use strict";
const { SyncApi, SyncApiError, DEFAULT_BASE_URL } = require("../../src/main/syncApi");

function res(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}
function makeApi(fetchImpl, token = "sess") {
  return new SyncApi({ baseUrl: "http://x/api/sync", getToken: async () => token, fetchImpl });
}

describe("SyncApi", () => {
  test("default base url", () => {
    expect(DEFAULT_BASE_URL).toBe("https://build.axi.link/api/sync");
  });

  test("sends bearer token, JSON body, and parses JSON", async () => {
    const fetchImpl = jest.fn(async () => res(201, { version: 1, seq: 9 }));
    const api = makeApi(fetchImpl);
    const out = await api.putItem("t1", "b1", { type: "build", parentId: null, body: { a: 1 }, baseVersion: null });
    expect(out).toEqual({ version: 1, seq: 9 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://x/api/sync/teams/t1/items/b1");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer sess");
    expect(JSON.parse(init.body)).toEqual({ type: "build", parentId: null, body: { a: 1 }, baseVersion: null });
  });

  test("loginGithub does not send a session token; logout returns on 204", async () => {
    const fetchImpl = jest.fn(async (url) => String(url).endsWith("/auth/github") ? res(200, { sessionToken: "s", user: { id: "u" } }) : res(204));
    const api = makeApi(fetchImpl, null);
    expect(await api.loginGithub("gh")).toEqual({ sessionToken: "s", user: { id: "u" } });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ token: "gh" });
    expect(await api.logout()).toBeNull();
  });

  test("maps HTTP errors to SyncApiError codes and carries current / retryAfterMs", async () => {
    const cases = [
      [401, { error: { code: "unauthorized", message: "x" } }, "SYNC_UNAUTHORIZED"],
      [403, { error: { code: "forbidden", message: "x" } }, "SYNC_FORBIDDEN"],
      [404, { error: { code: "not_found", message: "x" } }, "SYNC_NOT_FOUND"],
      [413, { error: { code: "too_large", message: "x" } }, "SYNC_TOO_LARGE"],
      [400, { error: { code: "invalid", message: "x" } }, "SYNC_INVALID"],
      [500, { error: { code: "internal", message: "x" } }, "SYNC_OFFLINE"],
      [502, undefined, "SYNC_OFFLINE"],
    ];
    for (const [status, body, code] of cases) {
      const api = makeApi(async () => res(status, body));
      await expect(api.listTeams()).rejects.toMatchObject({ code, status });
    }
    const conflict = makeApi(async () => res(409, { error: { code: "conflict", message: "changed" }, current: { id: "b1", version: 3 } }));
    const err = await conflict.putItem("t", "b1", {}).catch((e) => e);
    expect(err).toBeInstanceOf(SyncApiError);
    expect(err.code).toBe("SYNC_CONFLICT");
    expect(err.current).toEqual({ id: "b1", version: 3 });
    expect(err.message).toBe("changed");

    const limited = makeApi(async () => res(429, { error: { code: "rate_limited", message: "slow" } }, { "retry-after": "7" }));
    await expect(limited.listTeams()).rejects.toMatchObject({ code: "SYNC_RATE_LIMITED", retryAfterMs: 7000 });
  });

  test("network failure → SYNC_OFFLINE with status 0", async () => {
    const api = makeApi(async () => { throw new TypeError("fetch failed"); });
    await expect(api.listTeams()).rejects.toMatchObject({ code: "SYNC_OFFLINE", status: 0 });
  });

  test("query building for changes and deleteItem", async () => {
    const fetchImpl = jest.fn(async () => res(200, { items: [], nextSeq: 0, hasMore: false }));
    const api = makeApi(fetchImpl);
    await api.changes("t", 41, 50);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://x/api/sync/teams/t/changes?since=41&limit=50");
    await api.deleteItem("t", "b 1", 3);
    expect(fetchImpl.mock.calls[1][0]).toBe("http://x/api/sync/teams/t/items/b%201?baseVersion=3");
    expect(fetchImpl.mock.calls[1][1].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/syncApi.test.js --maxWorkers=2`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```js
// src/main/syncApi.js
"use strict";
// Thin client for the team-sync Worker (workers/sync). Every failure is a
// SyncApiError with a stable `code` so the engine can branch without parsing
// messages. Network errors and 5xx are both SYNC_OFFLINE: "retry later".

const DEFAULT_BASE_URL = "https://build.axi.link/api/sync";

const CODE_BY_STATUS = {
  400: "SYNC_INVALID",
  401: "SYNC_UNAUTHORIZED",
  403: "SYNC_FORBIDDEN",
  404: "SYNC_NOT_FOUND",
  409: "SYNC_CONFLICT",
  413: "SYNC_TOO_LARGE",
  429: "SYNC_RATE_LIMITED",
};

class SyncApiError extends Error {
  constructor(code, message, { status = 0, current = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = "SyncApiError";
    this.code = code;
    this.status = status;
    this.current = current;
    this.retryAfterMs = retryAfterMs;
  }
}

class SyncApi {
  constructor({ baseUrl, getToken, fetchImpl, userAgent } = {}) {
    this.baseUrl = (baseUrl || process.env.AXIFORGE_SYNC_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.getToken = getToken || (async () => null);
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.userAgent = userAgent || "AxiForge";
  }

  async #request(method, path, { body, auth = true, query } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Accept: "application/json", "User-Agent": this.userAgent };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = await this.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await this.fetchImpl(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new SyncApiError("SYNC_OFFLINE", `Network error: ${err.message}`, { status: 0 });
    }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = null; } }
    if (res.ok) return data;
    const code = CODE_BY_STATUS[res.status] || "SYNC_OFFLINE";
    const message = (data && data.error && data.error.message) || `Sync server error ${res.status}`;
    const retryAfter = res.headers && res.headers.get ? res.headers.get("retry-after") : null;
    throw new SyncApiError(code, message, {
      status: res.status,
      current: data && data.current ? data.current : null,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
    });
  }

  loginGithub(githubToken) { return this.#request("POST", "/auth/github", { body: { token: githubToken }, auth: false }); }
  logout() { return this.#request("DELETE", "/auth/session"); }

  createTeam(name) { return this.#request("POST", "/teams", { body: { name } }); }
  joinTeam(inviteCode) { return this.#request("POST", "/teams/join", { body: { inviteCode } }); }
  listTeams() { return this.#request("GET", "/teams"); }
  listMembers(teamId) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/members`); }
  removeMember(teamId, userId) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`); }
  rotateInvite(teamId) { return this.#request("POST", `/teams/${encodeURIComponent(teamId)}/invite/rotate`); }
  renameTeam(teamId, name) { return this.#request("PATCH", `/teams/${encodeURIComponent(teamId)}`, { body: { name } }); }
  deleteTeam(teamId) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}`); }

  changes(teamId, since, limit = 200) { return this.#request("GET", `/teams/${encodeURIComponent(teamId)}/changes`, { query: { since, limit } }); }
  putItem(teamId, itemId, payload) { return this.#request("PUT", `/teams/${encodeURIComponent(teamId)}/items/${encodeURIComponent(itemId)}`, { body: payload }); }
  deleteItem(teamId, itemId, baseVersion) { return this.#request("DELETE", `/teams/${encodeURIComponent(teamId)}/items/${encodeURIComponent(itemId)}`, { query: { baseVersion } }); }
  bulk(teamId, items) { return this.#request("POST", `/teams/${encodeURIComponent(teamId)}/items:bulk`, { body: { items } }); }
}

module.exports = { SyncApi, SyncApiError, DEFAULT_BASE_URL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/syncApi.test.js --maxWorkers=2`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/syncApi.js tests/unit/syncApi.test.js
git commit -m "feat(sync): typed client for the team-sync API"
```

---

### Task 3: `SyncStore` — team-scoped cursor, versions, outbox; `FolderStore` persists `teamId`/`role`

**Files:**
- Modify: `src/main/syncStore.js` (add methods; keep the SHA methods until Task 9 deletes them)
- Modify: `src/main/folderStore.js:38-41, 67-69, 89-91`
- Test: `tests/unit/syncStore.test.js` (append), `tests/unit/folderStore.test.js` (append)

**Interfaces:**
- Produces on `SyncStore`: `getTeam(teamId) → { cursor, versions, outbox, failures }`, `setCursor(teamId, seq)`, `getVersion(teamId, itemId) → { version, createdBy } | null`, `setVersion(teamId, itemId, { version, createdBy })`, `removeVersion(teamId, itemId)`, `enqueue(teamId, itemId, { type, op }) → entry`, `dequeue(teamId, itemId)`, `patchOutbox(teamId, itemId, patch)`, `listOutbox(teamId) → Array<{ itemId, type, op, queuedAt, attempts, nextAttemptAt, conflict }>`, `setFailures(teamId, n)`, `removeTeam(teamId)`, `listTeamIds()`.
- Produces on `FolderStore.upsertFolder`: accepts/persists `teamId` (string | null) and `role` (`"owner"|"member"|null`); `null` clears.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/syncStore.test.js`:

```js
describe("SyncStore — team scope (cursor / versions / outbox)", () => {
  let store, dir;
  beforeEach(async () => ({ store, dir } = await makeTempStore()));
  afterEach(async () => cleanupDir(dir));

  test("getTeam defaults", async () => {
    expect(await store.getTeam("t1")).toEqual({ cursor: 0, versions: {}, outbox: {}, failures: 0 });
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

  test("removeTeam / listTeamIds; concurrent writes do not lose entries", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.enqueue("t1", `b${i}`, { type: "build", op: "put" })));
    expect((await store.listOutbox("t1")).length).toBe(20);
    await store.setCursor("t2", 1);
    expect((await store.listTeamIds()).sort()).toEqual(["t1", "t2"]);
    await store.removeTeam("t1");
    expect(await store.listTeamIds()).toEqual(["t2"]);
  });
});
```

Append to `tests/unit/folderStore.test.js`:

```js
describe("team fields", () => {
  test("persists teamId/role on create and update; null clears", async () => {
    const store = new FolderStore(dir);
    await store.init();
    const f = await store.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    expect(f).toMatchObject({ shared: true, teamId: "team-1", role: "owner" });
    const kept = await store.upsertFolder({ id: "team-1", name: "EWW renamed", shared: true });
    expect(kept).toMatchObject({ teamId: "team-1", role: "owner" });
    const cleared = await store.upsertFolder({ id: "team-1", name: "EWW", shared: false, teamId: null, role: null });
    expect(cleared.teamId).toBeUndefined();
    expect(cleared.role).toBeUndefined();
    expect(cleared.shared).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/syncStore.test.js tests/unit/folderStore.test.js --maxWorkers=2`
Expected: FAIL (`getTeam is not a function`; teamId undefined)

- [ ] **Step 3: Implement — `SyncStore` additions**

Add to `src/main/syncStore.js` inside the class (keep existing methods):

```js
  // ─── Team scope ────────────────────────────────────────────────────────────
  // syncState.json: { "<teamId>": { cursor, versions: { id: {version, createdBy} }, outbox: { id: entry }, failures } }

  #teamOf(state, teamId) {
    const t = state[teamId] && typeof state[teamId] === "object" ? state[teamId] : {};
    return {
      cursor: Number.isInteger(t.cursor) ? t.cursor : 0,
      versions: t.versions && typeof t.versions === "object" ? t.versions : {},
      outbox: t.outbox && typeof t.outbox === "object" ? t.outbox : {},
      failures: Number.isInteger(t.failures) ? t.failures : 0,
    };
  }

  async getTeam(teamId) {
    return this.#teamOf(await this.getState(), teamId);
  }

  #mutateTeam(teamId, fn) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      const team = this.#teamOf(state, teamId);
      const out = fn(team);
      state[teamId] = team;
      await this.#write(state);
      return out;
    });
  }

  setCursor(teamId, seq) { return this.#mutateTeam(teamId, (t) => { t.cursor = seq; }); }
  setFailures(teamId, n) { return this.#mutateTeam(teamId, (t) => { t.failures = n; }); }

  async getVersion(teamId, itemId) {
    const t = await this.getTeam(teamId);
    return t.versions[itemId] || null;
  }
  setVersion(teamId, itemId, { version, createdBy }) {
    return this.#mutateTeam(teamId, (t) => { t.versions[itemId] = { version, createdBy: createdBy || null }; });
  }
  removeVersion(teamId, itemId) { return this.#mutateTeam(teamId, (t) => { delete t.versions[itemId]; }); }

  // A new op for an item replaces any pending one (delete supersedes put; a put
  // after a delete is a re-create) and resets retry/conflict state.
  enqueue(teamId, itemId, { type, op }) {
    return this.#mutateTeam(teamId, (t) => {
      const entry = { type, op, queuedAt: new Date().toISOString(), attempts: 0, nextAttemptAt: null, conflict: null };
      t.outbox[itemId] = entry;
      return { ...entry };
    });
  }
  dequeue(teamId, itemId) { return this.#mutateTeam(teamId, (t) => { delete t.outbox[itemId]; }); }
  patchOutbox(teamId, itemId, patch) {
    return this.#mutateTeam(teamId, (t) => { if (t.outbox[itemId]) Object.assign(t.outbox[itemId], patch); });
  }
  async listOutbox(teamId) {
    const t = await this.getTeam(teamId);
    return Object.entries(t.outbox)
      .map(([itemId, e]) => ({ itemId, ...e }))
      .sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0));
  }

  removeTeam(teamId) {
    return this.#enqueue(async () => {
      const state = await this.getState();
      delete state[teamId];
      await this.#write(state);
    });
  }
  async listTeamIds() {
    const state = await this.getState();
    return Object.keys(state).filter((k) => state[k] && typeof state[k] === "object" && ("cursor" in state[k] || "outbox" in state[k]));
  }
```

- [ ] **Step 4: Implement — `FolderStore` team fields**

In `upsertFolder`, after the `lastSyncedAt` const:
```js
      const teamId = typeof input.teamId === "string" ? input.teamId : (input.teamId === null ? null : undefined);
      const role = input.role === "owner" || input.role === "member" ? input.role : (input.role === null ? null : undefined);
```
In the `existing` branch after the `lastSyncedAt` line:
```js
        if (teamId !== undefined) { if (teamId === null) delete existing.teamId; else existing.teamId = teamId; }
        if (role !== undefined) { if (role === null) delete existing.role; else existing.role = role; }
```
In the create branch after `if (lastSyncedAt) …`:
```js
      if (teamId) folder.teamId = teamId;
      if (role) folder.role = role;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/syncStore.test.js tests/unit/folderStore.test.js --maxWorkers=2`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/syncStore.js src/main/folderStore.js tests/unit/syncStore.test.js tests/unit/folderStore.test.js
git commit -m "feat(sync): team-scoped sync state (cursor, versions, outbox) and teamId/role on folders"
```

---

### Task 4: `TeamSync` — session, team list reconciliation, folder mapping, body builders

**Files:**
- Create: `src/main/teamSync.js`
- Test: `tests/unit/teamSync.test.js`

**Interfaces:**
- Produces: `class TeamSync` constructed with `{ buildStore, compStore, folderStore, syncStore, historyStore, api, emit, now?, setTimeoutImpl?, clearTimeoutImpl? }`. This task adds: `getSession()`, `enableWithGithub(githubToken)`, `disable()`, `listTeams()`, `createTeam(name)`, `joinTeam(inviteCode)`, `leaveTeam(teamId)`, `deleteTeam(teamId)`, `renameTeam(teamId, name)`, `listMembers`, `removeMember`, `rotateInvite` (pass-through), `teamRootFor(folderId, folders)`, `rootFolderForTeam(teamId, folders)`, `parentIdFor(folderId, rootId)`, static `buildBody(build)`, `compBody(comp)`, `folderBody(folder)`, `stopPolling()` (no-op until Task 6).
- Test helper (shared by Tasks 4–7): `tests/helpers/teamSyncHarness.js` exporting `makeHarness()`.

- [ ] **Step 1: Write the harness and failing tests**

```js
// tests/helpers/teamSyncHarness.js
"use strict";
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { BuildStore } = require("../../src/main/buildStore");
const { CompStore } = require("../../src/main/compStore");
const { FolderStore } = require("../../src/main/folderStore");
const { SyncStore } = require("../../src/main/syncStore");
const { BuildHistoryStore } = require("../../src/main/buildHistoryStore");
const { SyncApiError } = require("../../src/main/syncApi");
const { TeamSync } = require("../../src/main/teamSync");

function apiError(code, extra = {}) {
  const status = { SYNC_UNAUTHORIZED: 401, SYNC_FORBIDDEN: 403, SYNC_NOT_FOUND: 404, SYNC_CONFLICT: 409, SYNC_TOO_LARGE: 413, SYNC_RATE_LIMITED: 429, SYNC_INVALID: 400, SYNC_OFFLINE: 0 }[code];
  return new SyncApiError(code, extra.message || code, { status, current: extra.current || null, retryAfterMs: extra.retryAfterMs || null });
}

function fakeApi() {
  const api = {};
  for (const m of ["loginGithub", "logout", "createTeam", "joinTeam", "listTeams", "listMembers", "removeMember", "rotateInvite", "renameTeam", "deleteTeam", "changes", "putItem", "deleteItem", "bulk"]) {
    api[m] = jest.fn(async () => { throw new Error(`unexpected api.${m}`); });
  }
  api.changes.mockImplementation(async () => ({ items: [], nextSeq: 0, hasMore: false }));
  return api;
}

async function makeHarness({ session = { sessionToken: "sess", userId: "me", login: "me" } } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "axiforge-teamsync-"));
  const buildStore = new BuildStore(dir);
  const compStore = new CompStore(dir);
  const folderStore = new FolderStore(dir);
  const syncStore = new SyncStore(dir);
  const historyStore = new BuildHistoryStore(dir);
  await Promise.all([buildStore.init(), compStore.init(), folderStore.init(), syncStore.init(), historyStore.init()]);
  if (session) await buildStore.saveAuth({ token: "gh", viewer: { login: "me" }, sync: session });
  const api = fakeApi();
  const events = [];
  const emit = (channel, data) => events.push({ channel, ...data });
  let nowMs = Date.parse("2026-08-21T12:00:00Z");
  const timers = [];
  const setTimeoutImpl = (fn, ms) => { const t = { fn, at: nowMs + ms, cleared: false }; timers.push(t); return t; };
  const clearTimeoutImpl = (t) => { if (t) t.cleared = true; };
  const sync = new TeamSync({ buildStore, compStore, folderStore, syncStore, historyStore, api, emit, now: () => nowMs, setTimeoutImpl, clearTimeoutImpl });
  // Fire every timer due at or before nowMs+ms (in order), awaiting async callbacks.
  async function advance(ms) {
    nowMs += ms;
    for (;;) {
      const due = timers.filter((t) => !t.cleared && !t.fired && t.at <= nowMs).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.fired = true;
      await due.fn();
    }
  }
  const cleanup = () => { sync.stopPolling(); return fs.rm(dir, { recursive: true, force: true }); };
  return { dir, buildStore, compStore, folderStore, syncStore, historyStore, api, events, sync, advance, now: () => nowMs, cleanup, apiError };
}

module.exports = { makeHarness, fakeApi, apiError };
```

```js
// tests/unit/teamSync.test.js
"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { TeamSync } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

describe("TeamSync — session", () => {
  test("getSession reads auth.sync; enableWithGithub stores it; disable clears it and calls logout", async () => {
    h = await makeHarness({ session: null });
    expect(await h.sync.getSession()).toBeNull();
    h.api.loginGithub.mockResolvedValue({ sessionToken: "s1", user: { id: "u1", login: "vette", displayName: "V", avatarUrl: null } });
    const user = await h.sync.enableWithGithub("gh-token");
    expect(user.login).toBe("vette");
    expect(h.api.loginGithub).toHaveBeenCalledWith("gh-token");
    expect(await h.sync.getSession()).toEqual({ sessionToken: "s1", userId: "u1", login: "vette" });
    h.api.logout.mockResolvedValue(null);
    await h.sync.disable();
    expect(h.api.logout).toHaveBeenCalled();
    expect(await h.sync.getSession()).toBeNull();
  });

  test("disable tolerates a failing logout", async () => {
    h = await makeHarness();
    h.api.logout.mockRejectedValue(apiError("SYNC_OFFLINE"));
    await h.sync.disable();
    expect(await h.sync.getSession()).toBeNull();
  });
});

describe("TeamSync — teams ↔ root folders", () => {
  test("createTeam makes a root folder with id = team id", async () => {
    h = await makeHarness();
    h.api.createTeam.mockResolvedValue({ team: { id: "team-1", name: "EWW", inviteCode: "ABCDEFGHJK", seq: 0 }, role: "owner" });
    const out = await h.sync.createTeam("EWW");
    expect(out.team.inviteCode).toBe("ABCDEFGHJK");
    const folders = await h.folderStore.listFolders();
    expect(folders).toEqual([expect.objectContaining({ id: "team-1", name: "EWW", parentId: null, shared: true, teamId: "team-1", role: "owner" })]);
  });

  test("joinTeam makes the root folder and pulls once", async () => {
    h = await makeHarness();
    h.api.joinTeam.mockResolvedValue({ team: { id: "team-2", name: "Guild", seq: 0 }, role: "member" });
    await h.sync.joinTeam("abcdefghjk");
    expect(h.api.joinTeam).toHaveBeenCalledWith("abcdefghjk");
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ id: "team-2", teamId: "team-2", role: "member", shared: true });
    expect(h.api.changes).toHaveBeenCalledWith("team-2", 0, 200);
  });

  test("listTeams reconciles: creates missing roots, updates name/role, detaches teams no longer listed", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "old", name: "Old", shared: true, teamId: "old", role: "member" });
    await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "old" });
    await h.syncStore.setCursor("old", 5);
    h.api.listTeams.mockResolvedValue([
      { team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 3 }, role: "owner" },
    ]);
    const list = await h.sync.listTeams();
    expect(list).toEqual([{ team: { id: "team-1", name: "EWW", inviteCode: "X", seq: 3 }, role: "owner" }]);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "team-1")).toMatchObject({ shared: true, teamId: "team-1", role: "owner", name: "EWW" });
    const old = folders.find((f) => f.id === "old");
    expect(old.shared).toBe(false);
    expect(old.teamId).toBeUndefined();
    expect(folders.find((f) => f.id === "sub").parentId).toBe("old"); // subtree kept as personal
    expect(await h.syncStore.listTeamIds()).not.toContain("old");
    expect(h.events).toContainEqual(expect.objectContaining({ channel: "sync-status", status: "detached", folderId: "old" }));
  });

  test("leaveTeam / deleteTeam detach locally (data kept as personal)", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "t" });
    h.api.removeMember.mockResolvedValue(null);
    await h.sync.leaveTeam("t");
    expect(h.api.removeMember).toHaveBeenCalledWith("t", "me");
    expect((await h.folderStore.listFolders())[0]).toMatchObject({ shared: false });
    expect((await h.buildStore.listBuilds())[0].folderId).toBe("t");
    h.api.deleteTeam.mockResolvedValue(null);
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    await h.sync.deleteTeam("t");
    expect(h.api.deleteTeam).toHaveBeenCalledWith("t");
    expect((await h.folderStore.listFolders())[0].teamId).toBeUndefined();
  });

  test("renameTeam renames the root folder too", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "owner" });
    h.api.renameTeam.mockResolvedValue({ team: { id: "t", name: "New" }, role: "owner" });
    await h.sync.renameTeam("t", "New");
    expect((await h.folderStore.listFolders())[0].name).toBe("New");
  });
});

describe("TeamSync — mapping helpers and bodies", () => {
  test("teamRootFor walks parents; parentIdFor maps root → null", () => {
    const folders = [
      { id: "t", name: "T", parentId: null, shared: true, teamId: "t" },
      { id: "a", name: "A", parentId: "t" },
      { id: "b", name: "B", parentId: "a" },
      { id: "p", name: "P", parentId: null },
    ];
    const sync = new TeamSync({});
    expect(sync.teamRootFor("b", folders).id).toBe("t");
    expect(sync.teamRootFor("t", folders).id).toBe("t");
    expect(sync.teamRootFor("p", folders)).toBeNull();
    expect(sync.teamRootFor(null, folders)).toBeNull();
    expect(sync.rootFolderForTeam("t", folders).id).toBe("t");
    expect(sync.parentIdFor("t", "t")).toBeNull();
    expect(sync.parentIdFor("a", "t")).toBe("a");
  });

  test("bodies strip local-only fields and keep publish metadata", () => {
    const build = { id: "b", title: "B", folderId: "f", pinned: true, sortOrder: 3, compIds: ["c"], publishedFileId: "x", publishedOwner: "me", equipment: {} };
    expect(TeamSync.buildBody(build)).toEqual({ id: "b", title: "B", publishedFileId: "x", publishedOwner: "me", equipment: {} });
    const comp = { id: "c", name: "C", folderId: "f", sortOrder: 1, boonCoverageHtml: "<div/>", partyLines: [] };
    expect(TeamSync.compBody(comp)).toEqual({ id: "c", name: "C", partyLines: [] });
    expect(TeamSync.folderBody({ id: "f", name: "F", sortOrder: 2, parentId: "t", updatedAt: "x" })).toEqual({ name: "F", sortOrder: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/teamSync.test.js --maxWorkers=2`
Expected: FAIL — cannot find module `teamSync`.

- [ ] **Step 3: Implement the first slice of `teamSync.js`**

```js
// src/main/teamSync.js
"use strict";
// Team sync engine (replaces the GitHub-org SharedLibrary). See
// docs/superpowers/specs/2026-08-21-team-sync-design.md §2.
//
// Invariants:
//   * A local change to a team item is persisted to the outbox BEFORE the IPC
//     handler that made it returns (callers await enqueue()).
//   * Outbox entries are never dropped on transient failure; only on success,
//     403/413 (with a user-visible error), or explicit conflict resolution.
//   * Pull never overwrites an item that has a pending outbox entry.

const { SyncApi } = require("./syncApi");

const POLL_INTERVAL_MS = 30_000;
const FOCUS_COOLDOWN_MS = 10_000;
const FLUSH_DEBOUNCE_MS = 1_000;
const FLUSH_MAX_DELAY_MS = 5_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const PAGE_SIZE = 200;
const FAILURES_BEFORE_TOAST = 3;

const BUILD_LOCAL_FIELDS = ["folderId", "pinned", "sortOrder", "compIds"];
const COMP_LOCAL_FIELDS = ["folderId", "sortOrder", "boonCoverageHtml"];

function omit(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

class TeamSync {
  constructor({ buildStore, compStore, folderStore, syncStore, historyStore, api, emit, now, setTimeoutImpl, clearTimeoutImpl } = {}) {
    this.buildStore = buildStore;
    this.compStore = compStore;
    this.folderStore = folderStore;
    this.syncStore = syncStore;
    this.historyStore = historyStore || null;
    this.api = api || new SyncApi({ getToken: async () => (await this.getSession())?.sessionToken || null });
    this._emit = typeof emit === "function" ? emit : () => {};
    this._now = now || Date.now;
    this._setTimeout = setTimeoutImpl || setTimeout;
    this._clearTimeout = clearTimeoutImpl || clearTimeout;
    this._flushTimers = new Map();   // teamId → { id, scheduledAt }
    this._inflight = new Map();      // teamId → Promise (flush)
    this._pullInProgress = new Set();
    this._pollTimer = null;
    this._lastFocusPullAt = 0;
    this._stopped = false;
  }

  // ─── Session ────────────────────────────────────────────────────────────────

  async getSession() {
    const auth = await this.buildStore.getAuth();
    const s = auth && auth.sync;
    if (!s || !s.sessionToken) return null;
    return { sessionToken: s.sessionToken, userId: s.userId, login: s.login };
  }

  async enableWithGithub(githubToken) {
    const { sessionToken, user } = await this.api.loginGithub(githubToken);
    const auth = await this.buildStore.getAuth();
    await this.buildStore.saveAuth({ ...auth, sync: { sessionToken, userId: user.id, login: user.login } });
    return user;
  }

  async disable() {
    this.stopPolling();
    try { await this.api.logout(); } catch { /* best effort — the session expires on its own */ }
    const auth = await this.buildStore.getAuth();
    const next = { ...auth };
    delete next.sync;
    await this.buildStore.saveAuth(next);
  }

  // Called on SYNC_UNAUTHORIZED: forget the session but keep outbox + cursors so
  // a re-login resumes where we left off.
  async _handleUnauthorized() {
    this.stopPolling();
    const auth = await this.buildStore.getAuth();
    if (auth && auth.sync) {
      const next = { ...auth };
      delete next.sync;
      await this.buildStore.saveAuth(next);
    }
    this._emit("sync-status", { status: "error", error: "auth" });
  }

  // ─── Teams ↔ root folders ───────────────────────────────────────────────────

  teamRootFor(folderId, folders) {
    let current = folderId ? folders.find((f) => f.id === folderId) : null;
    while (current) {
      if (current.teamId) return current;
      if (!current.parentId) return null;
      current = folders.find((f) => f.id === current.parentId);
    }
    return null;
  }

  rootFolderForTeam(teamId, folders) {
    return folders.find((f) => f.teamId === teamId) || null;
  }

  parentIdFor(folderId, rootId) {
    return folderId && folderId !== rootId ? folderId : null;
  }

  async _ensureRootFolder(team, role) {
    const folders = await this.folderStore.listFolders();
    const existing = this.rootFolderForTeam(team.id, folders) || folders.find((f) => f.id === team.id);
    if (existing && existing.parentId) {
      // A migrated/old folder that is nested cannot be a team root — re-root it.
      await this.folderStore.upsertFolder({ id: existing.id, name: team.name, parentId: null, shared: true, teamId: team.id, role });
      return existing.id;
    }
    await this.folderStore.upsertFolder({
      id: existing ? existing.id : team.id, name: team.name, parentId: null,
      sortOrder: existing ? existing.sortOrder : 0, shared: true, teamId: team.id, role,
    });
    return existing ? existing.id : team.id;
  }

  // Root folder becomes a personal folder; its contents stay on disk.
  async _detachTeam(teamId) {
    const timer = this._flushTimers.get(teamId);
    if (timer) { this._clearTimeout(timer.id); this._flushTimers.delete(teamId); }
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (root) {
      await this.folderStore.upsertFolder({ id: root.id, name: root.name, parentId: null, shared: false, teamId: null, role: null, orgName: undefined, lastSyncedAt: undefined });
      this._emit("sync-status", { status: "detached", folderId: root.id });
    }
    await this.syncStore.removeTeam(teamId);
  }

  async createTeam(name) {
    const out = await this.api.createTeam(name);
    await this._ensureRootFolder(out.team, out.role);
    return out;
  }

  async joinTeam(inviteCode) {
    const out = await this.api.joinTeam(inviteCode);
    await this._ensureRootFolder(out.team, out.role);
    await this.pullTeam(out.team.id);
    return out;
  }

  async listTeams() {
    let list;
    try {
      list = await this.api.listTeams();
    } catch (err) {
      if (err.code === "SYNC_UNAUTHORIZED") await this._handleUnauthorized();
      throw err;
    }
    const seen = new Set();
    for (const { team, role } of list) {
      seen.add(team.id);
      await this._ensureRootFolder(team, role);
    }
    const folders = await this.folderStore.listFolders();
    for (const f of folders) {
      if (f.teamId && !seen.has(f.teamId)) await this._detachTeam(f.teamId);
    }
    return list;
  }

  async leaveTeam(teamId) {
    const session = await this.getSession();
    if (!session) throw new Error("Team sync is not enabled.");
    await this.api.removeMember(teamId, session.userId);
    await this._detachTeam(teamId);
  }

  async deleteTeam(teamId) {
    await this.api.deleteTeam(teamId);
    await this._detachTeam(teamId);
  }

  async renameTeam(teamId, name) {
    const out = await this.api.renameTeam(teamId, name);
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (root) await this.folderStore.upsertFolder({ id: root.id, name: out.team.name, parentId: null, shared: true, teamId, role: root.role });
    return out;
  }

  listMembers(teamId) { return this.api.listMembers(teamId); }
  removeMember(teamId, userId) { return this.api.removeMember(teamId, userId); }
  rotateInvite(teamId) { return this.api.rotateInvite(teamId); }

  // ─── Bodies ─────────────────────────────────────────────────────────────────

  static buildBody(build) { return omit(build, BUILD_LOCAL_FIELDS); }
  static compBody(comp) { return omit(comp, COMP_LOCAL_FIELDS); }
  static folderBody(folder) { return { name: folder.name, sortOrder: folder.sortOrder || 0 }; }

  // ─── Placeholders completed in later tasks ──────────────────────────────────
  async pullTeam(_teamId) {}
  stopPolling() {
    if (this._pollTimer) { this._clearTimeout(this._pollTimer); this._pollTimer = null; }
  }
}

module.exports = {
  TeamSync,
  POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS,
  BACKOFF_BASE_MS, BACKOFF_MAX_MS, PAGE_SIZE, FAILURES_BEFORE_TOAST,
};
```

For this task only, make the `joinTeam` test pass by having the placeholder `pullTeam` call `this.api.changes(teamId, 0, PAGE_SIZE)`:

```js
  async pullTeam(teamId) { await this.api.changes(teamId, 0, PAGE_SIZE); } // replaced in Task 6
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/teamSync.test.js --maxWorkers=2`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/teamSync.js tests/helpers/teamSyncHarness.js tests/unit/teamSync.test.js
git commit -m "feat(sync): TeamSync session, team/root-folder reconciliation, body builders"
```

---

### Task 5: `TeamSync` — outbox enqueue + debounced, serialized flush with backoff

**Files:**
- Modify: `src/main/teamSync.js`
- Test: `tests/unit/teamSync.outbox.test.js`

**Interfaces:**
- Produces: `enqueue(teamId, itemId, type, op)` (resolves after the outbox is on disk; schedules a flush), `scheduleFlush(teamId, delayMs?)`, `flushTeam(teamId) → Promise`, `flushAll()`, `_flushEntry(teamId, root, entry)`.
- Consumes: `SyncStore` outbox API (Task 3), `SyncApi.putItem/deleteItem` (Task 2).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/teamSync.outbox.test.js
"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS, FLUSH_MAX_DELAY_MS, BACKOFF_BASE_MS } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

async function seedTeam(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
  await h.folderStore.upsertFolder({ id: "sub", name: "Sub", parentId: "t" });
}

describe("TeamSync — outbox", () => {
  test("enqueue persists before resolving and does not call the API until the debounce fires", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.sync.enqueue("t", "b1", "build", "put");
    expect((await h.syncStore.listOutbox("t"))[0]).toMatchObject({ itemId: "b1", op: "put" });
    expect(h.api.putItem).not.toHaveBeenCalled();
    expect(h.events).toContainEqual(expect.objectContaining({ status: "syncing", type: "build", id: "b1", folderId: "t" }));
  });

  test("flush reads the LATEST body from the store and sends parentId relative to the team root", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "v1", folderId: "sub" });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.buildStore.upsertBuild({ id: "b1", title: "v2", folderId: "sub" });
    await h.sync.enqueue("t", "b1", "build", "put"); // debounce reset, still one entry
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
    const [teamId, itemId, payload] = h.api.putItem.mock.calls[0];
    expect([teamId, itemId]).toEqual(["t", "b1"]);
    expect(payload.type).toBe("build");
    expect(payload.parentId).toBe("sub");
    expect(payload.baseVersion).toBeNull();
    expect(payload.body.title).toBe("v2");
    expect(payload.body.folderId).toBeUndefined();
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 1, createdBy: "me" });
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", folderId: "t" }));
  });

  test("debounce respects the 5s max delay under continuous edits", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    for (let i = 0; i < 12; i++) { await h.sync.enqueue("t", "b1", "build", "put"); await h.advance(500); }
    // 6s of edits every 500ms: the max-delay rule must have fired at least once
    expect(h.api.putItem.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(h.api.putItem.mock.calls.length).toBeLessThanOrEqual(2);
    void FLUSH_MAX_DELAY_MS;
  });

  test("update sends the known version; delete sends DELETE with baseVersion; delete with no version is a local no-op", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.syncStore.setVersion("t", "b1", { version: 4, createdBy: "me" });
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockResolvedValue({ version: 5, seq: 10 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem.mock.calls[0][2].baseVersion).toBe(4);

    h.api.deleteItem.mockResolvedValue({ version: 6, seq: 11 });
    await h.sync.enqueue("t", "b1", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.deleteItem).toHaveBeenCalledWith("t", "b1", 5);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();

    await h.sync.enqueue("t", "never-synced", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.deleteItem).toHaveBeenCalledTimes(1);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("a put whose item vanished locally is dropped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.sync.enqueue("t", "ghost", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem).not.toHaveBeenCalled();
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("offline: entry kept, attempts++, exponential backoff, pending event; succeeds on a later flush", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_OFFLINE")).mockRejectedValueOnce(apiError("SYNC_OFFLINE")).mockResolvedValue({ version: 1, seq: 1 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    let [e] = await h.syncStore.listOutbox("t");
    expect(e.attempts).toBe(1);
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(BACKOFF_BASE_MS * 2);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "pending", type: "build", id: "b1" }));
    await h.sync.flushTeam("t"); // too early — skipped
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
    await h.advance(BACKOFF_BASE_MS * 2);
    await h.sync.flushTeam("t");
    [e] = await h.syncStore.listOutbox("t");
    expect(e.attempts).toBe(2);
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(BACKOFF_BASE_MS * 4);
    await h.advance(BACKOFF_BASE_MS * 4);
    await h.sync.flushTeam("t");
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
  });

  test("rate limited uses Retry-After", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_RATE_LIMITED", { retryAfterMs: 42_000 }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    const [e] = await h.syncStore.listOutbox("t");
    expect(Date.parse(e.nextAttemptAt) - h.now()).toBe(42_000);
  });

  test("forbidden: dequeued, error event with server message, item re-pulled", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "someone-else" });
    h.api.deleteItem.mockRejectedValueOnce(apiError("SYNC_FORBIDDEN", { message: "Only the team owner or the item's creator can delete it." }));
    await h.sync.enqueue("t", "b1", "build", "delete");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", type: "build", id: "b1", error: "forbidden", message: expect.stringMatching(/creator/) }));
    expect(h.api.changes).toHaveBeenCalled(); // re-pull requested
  });

  test("too large: dequeued with a user-facing error naming the item", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Huge", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_TOO_LARGE", { message: "This build (build b1) is too large to sync (limit 1.5 MB)." }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", id: "b1", error: "too_large" }));
  });

  test("conflict: entry marked, conflict event emitted, entry skipped by later flushes", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "me" });
    const current = { id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Theirs" }, version: 2, seq: 9, deleted: false, createdBy: { userId: "me", login: "me" }, updatedBy: { userId: "u2", login: "vette" }, updatedAt: "2026-08-21T11:59:00.000Z" };
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    const [e] = await h.syncStore.listOutbox("t");
    expect(e.conflict).toEqual(current);
    expect(h.events).toContainEqual({ channel: "sync-conflict", teamId: "t", itemId: "b1", type: "build", title: "Mine", current });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "conflict", type: "build", id: "b1" }));
    await h.sync.flushTeam("t");
    expect(h.api.putItem).toHaveBeenCalledTimes(1);
  });

  test("unauthorized: session cleared, outbox preserved, auth error event, polling stopped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_UNAUTHORIZED"));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(await h.sync.getSession()).toBeNull();
    expect((await h.syncStore.listOutbox("t")).length).toBe(1);
    expect(h.events).toContainEqual(expect.objectContaining({ status: "error", error: "auth" }));
  });

  test("flushes are serialized per team and concurrent flushTeam calls coalesce", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "A", folderId: "t" });
    await h.buildStore.upsertBuild({ id: "b2", title: "B", folderId: "t" });
    let inFlight = 0, maxInFlight = 0;
    h.api.putItem.mockImplementation(async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setImmediate(r)); inFlight--; return { version: 1, seq: 1 }; });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.sync.enqueue("t", "b2", "build", "put");
    await Promise.all([h.sync.flushTeam("t"), h.sync.flushTeam("t"), h.sync.flushTeam("t")]);
    expect(h.api.putItem).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  test("folder items: put sends {name, sortOrder} with the folder's parent; root-level subfolder parentId is null", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    await h.sync.enqueue("t", "sub", "folder", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    expect(h.api.putItem.mock.calls[0][2]).toEqual({ type: "folder", parentId: null, body: { name: "Sub", sortOrder: 0 }, baseVersion: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/teamSync.outbox.test.js --maxWorkers=2`
Expected: FAIL — `enqueue is not a function`.

- [ ] **Step 3: Implement — add to `teamSync.js`** (replace the "Placeholders" block; keep `pullTeam` placeholder and `stopPolling`)

```js
  // ─── Outbox ─────────────────────────────────────────────────────────────────

  async enqueue(teamId, itemId, type, op) {
    await this.syncStore.enqueue(teamId, itemId, { type, op });
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    const folderId = root ? root.id : teamId;
    this._emit("sync-status", { status: "syncing", folderId });
    if (type !== "folder") this._emit("sync-status", { status: "syncing", type, id: itemId, folderId });
    this.scheduleFlush(teamId);
  }

  // Debounce per team: reset on each call, but never push the deadline past
  // FLUSH_MAX_DELAY_MS from the first call (continuous edits still sync).
  scheduleFlush(teamId, delayMs = FLUSH_DEBOUNCE_MS) {
    const existing = this._flushTimers.get(teamId);
    const now = this._now();
    let firstScheduledAt = now;
    if (existing) {
      firstScheduledAt = existing.firstScheduledAt;
      if (now - firstScheduledAt >= FLUSH_MAX_DELAY_MS - delayMs) return; // let it fire
      this._clearTimeout(existing.id);
    }
    const id = this._setTimeout(async () => {
      this._flushTimers.delete(teamId);
      await this.flushTeam(teamId).catch((err) => console.error("[team-sync] flush failed:", err.message));
    }, delayMs);
    this._flushTimers.set(teamId, { id, firstScheduledAt });
  }

  flushTeam(teamId) {
    if (this._inflight.has(teamId)) return this._inflight.get(teamId);
    const p = this._flushTeamInner(teamId).finally(() => this._inflight.delete(teamId));
    this._inflight.set(teamId, p);
    return p;
  }

  async flushAll() {
    for (const teamId of await this.syncStore.listTeamIds()) {
      await this.flushTeam(teamId).catch(() => {});
    }
  }

  async _flushTeamInner(teamId) {
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    const nowMs = this._now();
    const entries = (await this.syncStore.listOutbox(teamId))
      .filter((e) => !e.conflict && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= nowMs));
    for (const entry of entries) {
      if (!root) { await this.syncStore.dequeue(teamId, entry.itemId); continue; } // team detached
      const stop = await this._flushEntry(teamId, root, entry, session);
      if (stop) return;
    }
    if (root && !(await this.syncStore.listOutbox(teamId)).length) {
      this._emit("sync-status", { status: "synced", folderId: root.id });
    }
  }

  async _loadLocal(type, itemId) {
    if (type === "build") return (await this.buildStore.listBuilds()).find((b) => b.id === itemId) || null;
    if (type === "comp") return (await this.compStore.listComps()).find((c) => c.id === itemId) || null;
    if (type === "folder") return (await this.folderStore.listFolders()).find((f) => f.id === itemId) || null;
    return null;
  }

  _payloadFor(type, local, root) {
    if (type === "build") return { body: TeamSync.buildBody(local), parentId: this.parentIdFor(local.folderId, root.id) };
    if (type === "comp") return { body: TeamSync.compBody(local), parentId: this.parentIdFor(local.folderId, root.id) };
    return { body: TeamSync.folderBody(local), parentId: this.parentIdFor(local.parentId, root.id) };
  }

  // Returns true if the flush loop must stop (auth lost).
  async _flushEntry(teamId, root, entry, session) {
    const { itemId, type, op } = entry;
    const known = await this.syncStore.getVersion(teamId, itemId);
    const baseVersion = known ? known.version : null;
    const title = async () => { const l = await this._loadLocal(type, itemId); return (l && (l.title || l.name)) || itemId; };
    try {
      if (op === "put") {
        const local = await this._loadLocal(type, itemId);
        if (!local) { await this.syncStore.dequeue(teamId, itemId); return false; }
        const { body, parentId } = this._payloadFor(type, local, root);
        const res = await this.api.putItem(teamId, itemId, { type, parentId, body, baseVersion });
        await this.syncStore.setVersion(teamId, itemId, { version: res.version, createdBy: known ? known.createdBy : session.userId });
        await this.syncStore.dequeue(teamId, itemId);
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id, item: local });
      } else {
        if (baseVersion === null) { await this.syncStore.dequeue(teamId, itemId); return false; } // never reached the server
        try {
          await this.api.deleteItem(teamId, itemId, baseVersion);
        } catch (err) {
          if (err.code !== "SYNC_NOT_FOUND") throw err; // already gone = success
        }
        await this.syncStore.removeVersion(teamId, itemId);
        await this.syncStore.dequeue(teamId, itemId);
        if (type !== "folder") this._emit("sync-status", { status: "synced", type, id: itemId, folderId: root.id });
      }
      return false;
    } catch (err) {
      const code = err && err.code;
      if (code === "SYNC_CONFLICT") {
        await this.syncStore.patchOutbox(teamId, itemId, { conflict: err.current || { deleted: true } });
        this._emit("sync-conflict", { teamId, itemId, type, title: await title(), current: err.current || null });
        if (type !== "folder") this._emit("sync-status", { status: "conflict", type, id: itemId, folderId: root.id });
        return false;
      }
      if (code === "SYNC_FORBIDDEN" || code === "SYNC_TOO_LARGE" || code === "SYNC_INVALID") {
        await this.syncStore.dequeue(teamId, itemId);
        const error = code === "SYNC_FORBIDDEN" ? "forbidden" : code === "SYNC_TOO_LARGE" ? "too_large" : "invalid";
        this._emit("sync-status", { status: "error", type, id: itemId, folderId: root.id, error, message: err.message });
        if (code === "SYNC_FORBIDDEN") this.pullTeam(teamId).catch(() => {}); // restore server state locally
        return false;
      }
      if (code === "SYNC_UNAUTHORIZED") {
        await this._handleUnauthorized();
        return true;
      }
      // SYNC_OFFLINE / SYNC_RATE_LIMITED / unknown: keep and back off
      const attempts = (entry.attempts || 0) + 1;
      const delay = err.retryAfterMs || Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS);
      await this.syncStore.patchOutbox(teamId, itemId, { attempts, nextAttemptAt: new Date(this._now() + delay).toISOString() });
      if (type !== "folder") this._emit("sync-status", { status: "pending", type, id: itemId, folderId: root.id });
      this._emit("sync-status", { status: "pending", folderId: root.id });
      return false;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/teamSync.outbox.test.js tests/unit/teamSync.test.js --maxWorkers=2`
Expected: PASS. If the backoff test's first delay is not `BACKOFF_BASE_MS * 2`, check that `attempts` is incremented *before* computing `2 ** attempts`.

- [ ] **Step 5: Commit**

```bash
git add src/main/teamSync.js tests/unit/teamSync.outbox.test.js
git commit -m "feat(sync): persisted outbox with debounced, serialized flush and backoff"
```

---

### Task 6: `TeamSync` — pull, apply, tombstones, polling, focus, failure counting

**Files:**
- Modify: `src/main/teamSync.js`
- Test: `tests/unit/teamSync.pull.test.js`

**Interfaces:**
- Produces: `pullTeam(teamId)` (real), `pullAll()`, `startPolling(intervalMs = POLL_INTERVAL_MS)`, `onFocus()`, `_applyItem(teamId, root, item, session)`.
- Consumes: `SyncApi.changes` paging `{ items, nextSeq, hasMore }` (Plan 1 §1.4).

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/teamSync.pull.test.js
"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { POLL_INTERVAL_MS, FOCUS_COOLDOWN_MS, FAILURES_BEFORE_TOAST } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
function item(over) {
  return { id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Remote" }, version: 1, seq: 1, deleted: false, createdBy: who("vette"), updatedBy: who("vette"), updatedAt: "2026-08-21T11:00:00.000Z", ...over };
}
async function seedTeam(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
}

describe("TeamSync — pull", () => {
  test("applies builds/comps/folders into the stores with folderId restored, records history, stores versions and cursor", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "f1", type: "folder", body: { name: "Raids", sortOrder: 2 }, seq: 1 }),
      item({ id: "b1", parentId: "f1", seq: 2 }),
      item({ id: "c1", type: "comp", body: { id: "c1", name: "Comp", buildIds: ["b1"], partyLines: [] }, seq: 3 }),
    ], nextSeq: 3, hasMore: false });
    await h.sync.pullTeam("t");
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "f1")).toMatchObject({ name: "Raids", parentId: "t", sortOrder: 2 });
    const b = (await h.buildStore.listBuilds()).find((x) => x.id === "b1");
    expect(b).toMatchObject({ title: "Remote", folderId: "f1" });
    expect((await h.compStore.listComps())[0]).toMatchObject({ name: "Comp", folderId: "t" });
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 1, createdBy: "u-vette" });
    expect((await h.syncStore.getTeam("t")).cursor).toBe(3);
    const hist = await h.historyStore.getHistory("b1");
    expect(hist[0]).toMatchObject({ source: "team-sync", authorLogin: "vette", summary: "Created" });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", folderId: "t", item: expect.objectContaining({ title: "Remote" }) }));
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", folderId: "t" }));
  });

  test("pages until hasMore is false, persisting the cursor after each page", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes
      .mockResolvedValueOnce({ items: [item({ id: "b1", seq: 1 })], nextSeq: 1, hasMore: true })
      .mockRejectedValueOnce(apiError("SYNC_OFFLINE"));
    await expect(h.sync.pullTeam("t")).rejects.toMatchObject({ code: "SYNC_OFFLINE" });
    expect((await h.syncStore.getTeam("t")).cursor).toBe(1); // first page was persisted
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b2", seq: 2 })], nextSeq: 2, hasMore: false });
    await h.sync.pullTeam("t");
    expect(h.api.changes).toHaveBeenLastCalledWith("t", 1, 200);
    expect((await h.buildStore.listBuilds()).map((b) => b.id).sort()).toEqual(["b1", "b2"]);
  });

  test("skips echoes of our own writes and items with a pending outbox entry", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Local", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 3, createdBy: "me" });
    await h.buildStore.upsertBuild({ id: "b2", title: "Editing", folderId: "t" });
    await h.syncStore.enqueue("t", "b2", { type: "build", op: "put" });
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "b1", version: 3, seq: 5, body: { id: "b1", title: "Echo" } }),
      item({ id: "b2", version: 9, seq: 6, body: { id: "b2", title: "Theirs" } }),
    ], nextSeq: 6, hasMore: false });
    await h.sync.pullTeam("t");
    const builds = await h.buildStore.listBuilds();
    expect(builds.find((b) => b.id === "b1").title).toBe("Local");
    expect(builds.find((b) => b.id === "b2").title).toBe("Editing");
    expect(await h.syncStore.getVersion("t", "b2")).toBeNull(); // not recorded — flush will 409 and resolve it
  });

  test("tombstones delete locally: build removed from comps, folder cascade, versions dropped", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.folderStore.upsertFolder({ id: "f1", name: "F", parentId: "t" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "f1" });
    await h.compStore.upsertComp({ id: "c1", name: "C", folderId: "t", buildIds: ["b1"], partyLines: [{ id: "l", capacity: 5, slots: ["b1"] }] });
    for (const id of ["f1", "b1", "c1"]) await h.syncStore.setVersion("t", id, { version: 1, createdBy: "x" });
    h.api.changes.mockResolvedValueOnce({ items: [
      item({ id: "b1", deleted: true, body: null, version: 2, seq: 7 }),
      item({ id: "f1", type: "folder", deleted: true, body: null, version: 2, seq: 8 }),
    ], nextSeq: 8, hasMore: false });
    await h.sync.pullTeam("t");
    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect((await h.compStore.listComps())[0].buildIds).toEqual([]);
    expect((await h.folderStore.listFolders()).map((f) => f.id)).toEqual(["t"]);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();
    expect(await h.syncStore.getVersion("t", "f1")).toBeNull();
  });

  test("remote update of a build records a history entry with the remote author", async () => {
    h = await makeHarness();
    await seedTeam(h);
    await h.buildStore.upsertBuild({ id: "b1", title: "Old", folderId: "t" });
    h.api.changes.mockResolvedValueOnce({ items: [item({ id: "b1", version: 2, seq: 2, body: { id: "b1", title: "New" }, updatedBy: who("iruixos") })], nextSeq: 2, hasMore: false });
    await h.sync.pullTeam("t");
    const hist = await h.historyStore.getHistory("b1");
    expect(hist[0]).toMatchObject({ source: "team-sync", authorLogin: "iruixos" });
    expect(hist[0].summary).not.toBe("Created");
  });

  test("pullAll flushes first, pulls every team, isolates failures, counts consecutive failures and emits once at 3", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "a", name: "A", shared: true, teamId: "a", role: "member" });
    await h.folderStore.upsertFolder({ id: "b", name: "B", shared: true, teamId: "b", role: "member" });
    await h.buildStore.upsertBuild({ id: "x", title: "X", folderId: "a" });
    await h.syncStore.enqueue("a", "x", { type: "build", op: "put" });
    h.api.putItem.mockResolvedValue({ version: 1, seq: 1 });
    h.api.changes.mockImplementation(async (teamId) => { if (teamId === "a") throw apiError("SYNC_OFFLINE"); return { items: [], nextSeq: 0, hasMore: false }; });
    for (let i = 0; i < FAILURES_BEFORE_TOAST; i++) await h.sync.pullAll();
    expect(h.api.putItem).toHaveBeenCalledTimes(1); // outbox flushed before pulling
    expect(h.api.changes).toHaveBeenCalledWith("b", 0, 200);
    const errs = h.events.filter((e) => e.status === "error" && e.error === "pull");
    expect(errs).toHaveLength(1);
    expect((await h.syncStore.getTeam("a")).failures).toBe(FAILURES_BEFORE_TOAST);
    h.api.changes.mockResolvedValue({ items: [], nextSeq: 0, hasMore: false });
    await h.sync.pullAll();
    expect((await h.syncStore.getTeam("a")).failures).toBe(0);
  });

  test("401 during pull clears the session and stops polling", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.api.changes.mockRejectedValueOnce(apiError("SYNC_UNAUTHORIZED"));
    h.sync.startPolling();
    await h.sync.pullAll();
    expect(await h.sync.getSession()).toBeNull();
    expect(h.sync._pollTimer).toBeNull();
  });

  test("startPolling pulls every POLL_INTERVAL_MS; onFocus honours the cooldown; concurrent pullTeam coalesces", async () => {
    h = await makeHarness();
    await seedTeam(h);
    h.sync.startPolling();
    await h.advance(POLL_INTERVAL_MS);
    await h.advance(POLL_INTERVAL_MS);
    expect(h.api.changes).toHaveBeenCalledTimes(2);
    await h.sync.onFocus();
    await h.sync.onFocus();
    expect(h.api.changes).toHaveBeenCalledTimes(3);
    await h.advance(FOCUS_COOLDOWN_MS);
    await h.sync.onFocus();
    expect(h.api.changes).toHaveBeenCalledTimes(4);
    let resolve;
    h.api.changes.mockImplementationOnce(() => new Promise((r) => { resolve = () => r({ items: [], nextSeq: 0, hasMore: false }); }));
    const p1 = h.sync.pullTeam("t"); const p2 = h.sync.pullTeam("t");
    resolve();
    await Promise.all([p1, p2]);
    expect(h.api.changes).toHaveBeenCalledTimes(5);
    h.sync.stopPolling();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/teamSync.pull.test.js --maxWorkers=2`
Expected: FAIL (pullTeam placeholder does not apply anything).

- [ ] **Step 3: Implement — replace the `pullTeam` placeholder and add polling**

```js
  // ─── Pull ───────────────────────────────────────────────────────────────────

  pullTeam(teamId) {
    const key = `pull:${teamId}`;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const p = this._pullTeamInner(teamId).finally(() => this._inflight.delete(key));
    this._inflight.set(key, p);
    return p;
  }

  async _pullTeamInner(teamId) {
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) return;
    let { cursor } = await this.syncStore.getTeam(teamId);
    for (;;) {
      let page;
      try {
        page = await this.api.changes(teamId, cursor, PAGE_SIZE);
      } catch (err) {
        if (err.code === "SYNC_UNAUTHORIZED") { await this._handleUnauthorized(); }
        throw err;
      }
      for (const item of page.items) {
        this._emit("sync-status", { status: "syncing", type: item.type, id: item.id, folderId: root.id });
        try {
          await this._applyItem(teamId, root, item, session);
        } catch (err) {
          console.error(`[team-sync] apply ${item.type} ${item.id} failed:`, err.message);
        }
      }
      cursor = page.nextSeq;
      await this.syncStore.setCursor(teamId, cursor);
      if (!page.hasMore) break;
    }
    await this.folderStore.upsertFolder({ id: root.id, name: root.name, parentId: null, shared: true, teamId, role: root.role, lastSyncedAt: new Date(this._now()).toISOString() });
    this._emit("sync-status", { status: "synced", folderId: root.id });
  }

  async _applyItem(teamId, root, item, session) {
    const known = await this.syncStore.getVersion(teamId, item.id);
    if (known && known.version === item.version) return;                 // our own write echoed back
    const team = await this.syncStore.getTeam(teamId);
    if (team.outbox[item.id]) return;                                     // local change pending — flush decides
    const createdBy = item.createdBy ? item.createdBy.userId : null;
    const author = (item.updatedBy && item.updatedBy.login) || "teammate";
    const folderId = item.parentId || root.id;

    if (item.deleted) {
      if (item.type === "build") {
        await this.buildStore.deleteBuild(item.id);
        await this.compStore.removeBuildFromComps(item.id);
        if (this.historyStore) this.historyStore.deleteHistory(item.id).catch(() => {});
      } else if (item.type === "comp") {
        await this.compStore.deleteComp(item.id);
        await this.buildStore.clearCompFromBuilds([item.id]);
      } else if (item.type === "folder") {
        const removed = await this.folderStore.deleteFolder(item.id);
        if (removed.length) await this.buildStore.clearFolderFromBuilds(removed);
      }
      await this.syncStore.removeVersion(teamId, item.id);
      this._emit("sync-status", { status: "synced", type: item.type, id: item.id, folderId: root.id, removed: true });
      return;
    }

    const body = item.body || {};
    let saved = null;
    if (item.type === "folder") {
      saved = await this.folderStore.upsertFolder({ id: item.id, name: body.name, sortOrder: body.sortOrder, parentId: folderId });
    } else if (item.type === "build") {
      if (this.historyStore) {
        const { summarizeBuildChange } = require("./buildHistoryStore");
        const existing = (await this.buildStore.listBuilds()).find((b) => b.id === item.id);
        this.historyStore.addEntry({
          buildId: item.id, authorLogin: author, source: "team-sync",
          summary: existing ? summarizeBuildChange(existing, { ...body, folderId }) : "Created",
          snapshot: existing || { ...body, id: item.id, folderId },
        }).catch((err) => console.warn("[history] team-sync addEntry failed:", err.message));
      }
      saved = await this.buildStore.upsertBuild({ ...body, id: item.id, folderId });
    } else if (item.type === "comp") {
      saved = await this.compStore.upsertComp({ ...body, id: item.id, folderId });
    }
    await this.syncStore.setVersion(teamId, item.id, { version: item.version, createdBy });
    this._emit("sync-status", { status: "synced", type: item.type, id: item.id, folderId: root.id, item: saved });
  }

  async pullAll() {
    await this.flushAll();
    const session = await this.getSession();
    if (!session) return;
    const folders = await this.folderStore.listFolders();
    for (const root of folders.filter((f) => f.teamId)) {
      const teamId = root.teamId;
      try {
        await this.pullTeam(teamId);
        await this.syncStore.setFailures(teamId, 0);
      } catch (err) {
        if (err.code === "SYNC_UNAUTHORIZED") return;
        const failures = (await this.syncStore.getTeam(teamId)).failures + 1;
        await this.syncStore.setFailures(teamId, failures);
        console.warn(`[team-sync] pull ${teamId} failed (${failures}):`, err.message);
        if (failures === FAILURES_BEFORE_TOAST) this._emit("sync-status", { status: "error", error: "pull", folderId: root.id });
      }
    }
  }

  startPolling(intervalMs = POLL_INTERVAL_MS) {
    this.stopPolling();
    const tick = async () => {
      this._pollTimer = null;
      try { await this.pullAll(); } catch (err) { console.error("[team-sync] poll error:", err.message); }
      if (!(await this.getSession())) return; // unauthorized mid-poll: stay stopped
      this._pollTimer = this._setTimeout(tick, intervalMs);
    };
    this._pollTimer = this._setTimeout(tick, intervalMs);
  }

  async onFocus() {
    const now = this._now();
    if (now - this._lastFocusPullAt < FOCUS_COOLDOWN_MS) return;
    this._lastFocusPullAt = now;
    await this.pullAll().catch(() => {});
  }
```

Note `stopPolling` from Task 4 already clears `_pollTimer`. `_handleUnauthorized` calls `stopPolling`, which is why the 401 test expects `_pollTimer === null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/teamSync.pull.test.js tests/unit/teamSync.outbox.test.js tests/unit/teamSync.test.js --maxWorkers=2`
Expected: PASS. The Task 4 `joinTeam` test still passes because the real `pullTeam` calls `changes("team-2", 0, 200)`.

- [ ] **Step 5: Commit**

```bash
git add src/main/teamSync.js tests/unit/teamSync.pull.test.js
git commit -m "feat(sync): cursor-based pull with tombstones, history, polling and failure counting"
```

---

### Task 7: `TeamSync` — conflict resolution, share folder to team, stop sharing, delete permission helper

**Files:**
- Modify: `src/main/teamSync.js`
- Test: `tests/unit/teamSync.conflicts.test.js`

**Interfaces:**
- Produces: `resolveConflict(teamId, itemId, "mine" | "theirs")`, `shareFolderToTeam(folderId, teamId, onProgress?) → { uploaded, failed: [{ itemId, status, message }] }`, `stopSharing(folderId)`, `canDelete(teamId, itemId) → Promise<boolean>`, `collectFolderTree(folderId, folders) → folderIds[]`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/teamSync.conflicts.test.js
"use strict";
const { makeHarness, apiError } = require("../helpers/teamSyncHarness");
const { FLUSH_DEBOUNCE_MS } = require("../../src/main/teamSync");

let h;
afterEach(async () => { if (h) await h.cleanup(); h = null; });

const who = (login) => ({ userId: `u-${login}`, login });
const current = (over) => ({ id: "b1", type: "build", parentId: null, body: { id: "b1", title: "Theirs" }, version: 2, seq: 9, deleted: false, createdBy: who("me"), updatedBy: who("vette"), updatedAt: "2026-08-21T11:59:00.000Z", ...over });

async function conflicted(h) {
  await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
  await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
  await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
  h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current() }));
  await h.sync.enqueue("t", "b1", "build", "put");
  await h.advance(FLUSH_DEBOUNCE_MS);
  expect((await h.syncStore.listOutbox("t"))[0].conflict.version).toBe(2);
}

describe("TeamSync — conflicts", () => {
  test("keep mine: re-PUTs with the server's version and clears the conflict", async () => {
    h = await makeHarness();
    await conflicted(h);
    h.api.putItem.mockResolvedValueOnce({ version: 3, seq: 10 });
    await h.sync.resolveConflict("t", "b1", "mine");
    expect(h.api.putItem).toHaveBeenCalledTimes(2);
    expect(h.api.putItem.mock.calls[1][2]).toMatchObject({ baseVersion: 2, body: expect.objectContaining({ title: "Mine" }) });
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 3, createdBy: "u-me" });
  });

  test("take theirs: applies the remote item, dequeues, records version", async () => {
    h = await makeHarness();
    await conflicted(h);
    await h.sync.resolveConflict("t", "b1", "theirs");
    expect((await h.buildStore.listBuilds())[0].title).toBe("Theirs");
    expect(await h.syncStore.listOutbox("t")).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toEqual({ version: 2, createdBy: "u-me" });
    expect(h.events).toContainEqual(expect.objectContaining({ status: "synced", type: "build", id: "b1", item: expect.objectContaining({ title: "Theirs" }) }));
  });

  test("take theirs when the remote is a tombstone deletes locally", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current({ deleted: true, body: null, version: 2 }) }));
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    await h.sync.resolveConflict("t", "b1", "theirs");
    expect(await h.buildStore.listBuilds()).toEqual([]);
    expect(await h.syncStore.getVersion("t", "b1")).toBeNull();
  });

  test("keep mine when the remote is a tombstone re-creates (baseVersion null)", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.buildStore.upsertBuild({ id: "b1", title: "Mine", folderId: "t" });
    await h.syncStore.setVersion("t", "b1", { version: 1, createdBy: "u-me" });
    h.api.putItem.mockRejectedValueOnce(apiError("SYNC_CONFLICT", { current: current({ deleted: true, body: null, version: 2 }) })).mockResolvedValueOnce({ version: 3, seq: 11 });
    await h.sync.enqueue("t", "b1", "build", "put");
    await h.advance(FLUSH_DEBOUNCE_MS);
    await h.sync.resolveConflict("t", "b1", "mine");
    expect(h.api.putItem.mock.calls[1][2].baseVersion).toBeNull();
  });

  test("resolveConflict on a non-conflicted entry is a no-op", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "t", name: "T", shared: true, teamId: "t", role: "member" });
    await h.sync.resolveConflict("t", "nope", "mine");
    expect(h.api.putItem).not.toHaveBeenCalled();
  });
});

describe("TeamSync — share folder to team / stop sharing", () => {
  test("shareFolderToTeam uploads folders first, then builds and comps in ≤50-item batches, flips the root, records versions", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "Personal" });
    await h.folderStore.upsertFolder({ id: "p-sub", name: "Sub", parentId: "p" });
    for (let i = 0; i < 60; i++) await h.buildStore.upsertBuild({ id: `b${i}`, title: `B${i}`, folderId: i % 2 ? "p" : "p-sub" });
    await h.compStore.upsertComp({ id: "c1", name: "C", folderId: "p", boonCoverageHtml: "<big/>" });
    h.api.bulk.mockImplementation(async (_teamId, items) => ({ results: items.map((it) => ({ itemId: it.itemId, status: 201, version: 1, seq: 1 })) }));
    const progress = [];
    const out = await h.sync.shareFolderToTeam("p", "team-1", (p) => progress.push(p));
    expect(out.failed).toEqual([]);
    expect(out.uploaded).toBe(63); // 2 folders + 60 builds + 1 comp
    const calls = h.api.bulk.mock.calls;
    expect(calls.every(([, items]) => items.length <= 50)).toBe(true);
    expect(calls[0][1][0]).toEqual({ itemId: "p", type: "folder", parentId: null, body: { name: "Personal", sortOrder: 0 }, baseVersion: null });
    expect(calls[0][1][1]).toEqual({ itemId: "p-sub", type: "folder", parentId: "p", body: { name: "Sub", sortOrder: 0 }, baseVersion: null });
    const allItems = calls.flatMap(([, items]) => items);
    expect(allItems.find((i) => i.itemId === "c1").body.boonCoverageHtml).toBeUndefined();
    expect(allItems.find((i) => i.itemId === "b1").parentId).toBe("p");
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "p")).toMatchObject({ parentId: "team-1", shared: undefined });
    expect(await h.syncStore.getVersion("team-1", "b1")).toEqual({ version: 1, createdBy: "me" });
    expect(progress[progress.length - 1]).toEqual({ done: 63, total: 63 });
  });

  test("shareFolderToTeam reports per-item failures and still moves the folder under the team", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P" });
    await h.buildStore.upsertBuild({ id: "big", title: "Big", folderId: "p" });
    h.api.bulk.mockImplementation(async (_t, items) => ({ results: items.map((it) => it.itemId === "big" ? { itemId: "big", status: 413, message: "too large" } : { itemId: it.itemId, status: 201, version: 1, seq: 1 }) }));
    const out = await h.sync.shareFolderToTeam("p", "team-1");
    expect(out.failed).toEqual([{ itemId: "big", status: 413, message: "too large" }]);
    expect(await h.syncStore.getVersion("team-1", "big")).toBeNull();
  });

  test("stopSharing (owner): deletes the folder item remotely, keeps data locally as personal", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "team-1", name: "EWW", shared: true, teamId: "team-1", role: "owner" });
    await h.folderStore.upsertFolder({ id: "p", name: "P", parentId: "team-1" });
    await h.buildStore.upsertBuild({ id: "b1", title: "B", folderId: "p" });
    await h.syncStore.setVersion("team-1", "p", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("team-1", "b1", { version: 1, createdBy: "me" });
    h.api.deleteItem.mockResolvedValue({ version: 2, seq: 5 });
    await h.sync.stopSharing("p");
    expect(h.api.deleteItem).toHaveBeenCalledWith("team-1", "p", 1);
    const folders = await h.folderStore.listFolders();
    expect(folders.find((f) => f.id === "p").parentId).toBeNull();
    expect((await h.buildStore.listBuilds())[0].folderId).toBe("p");
    expect(await h.syncStore.getVersion("team-1", "b1")).toBeNull();
  });

  test("canDelete: owner always; member only for items they created or that are not yet on the server", async () => {
    h = await makeHarness();
    await h.folderStore.upsertFolder({ id: "own", name: "O", shared: true, teamId: "own", role: "owner" });
    await h.folderStore.upsertFolder({ id: "mem", name: "M", shared: true, teamId: "mem", role: "member" });
    await h.syncStore.setVersion("mem", "mine", { version: 1, createdBy: "me" });
    await h.syncStore.setVersion("mem", "theirs", { version: 1, createdBy: "u-vette" });
    await h.syncStore.setVersion("own", "theirs", { version: 1, createdBy: "u-vette" });
    expect(await h.sync.canDelete("own", "theirs")).toBe(true);
    expect(await h.sync.canDelete("mem", "mine")).toBe(true);
    expect(await h.sync.canDelete("mem", "theirs")).toBe(false);
    expect(await h.sync.canDelete("mem", "unsynced")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/teamSync.conflicts.test.js --maxWorkers=2`
Expected: FAIL — `resolveConflict is not a function`.

- [ ] **Step 3: Implement — add to `teamSync.js`**

```js
  // ─── Conflicts ──────────────────────────────────────────────────────────────

  async resolveConflict(teamId, itemId, choice) {
    const team = await this.syncStore.getTeam(teamId);
    const entry = team.outbox[itemId];
    if (!entry || !entry.conflict) return;
    const remote = entry.conflict;
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) { await this.syncStore.dequeue(teamId, itemId); return; }
    if (choice === "theirs") {
      await this.syncStore.dequeue(teamId, itemId);
      if (remote && remote.id) {
        await this.syncStore.removeVersion(teamId, itemId); // force apply even if versions matched
        await this._applyItem(teamId, root, remote, await this.getSession());
      }
      return;
    }
    // "mine": adopt the server's version as our base and push again now.
    if (remote && !remote.deleted && remote.version) {
      await this.syncStore.setVersion(teamId, itemId, { version: remote.version, createdBy: remote.createdBy ? remote.createdBy.userId : null });
    } else {
      await this.syncStore.removeVersion(teamId, itemId); // re-create over a tombstone
    }
    await this.syncStore.patchOutbox(teamId, itemId, { conflict: null, attempts: 0, nextAttemptAt: null });
    await this.flushTeam(teamId);
  }

  // ─── Sharing folders ────────────────────────────────────────────────────────

  collectFolderTree(folderId, folders) {
    const out = [folderId];
    const queue = [folderId];
    while (queue.length) {
      const id = queue.shift();
      for (const f of folders) if (f.parentId === id) { out.push(f.id); queue.push(f.id); }
    }
    return out;
  }

  async shareFolderToTeam(folderId, teamId, onProgress) {
    const session = await this.getSession();
    if (!session) throw new Error("Team sync is not enabled.");
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) throw new Error("Team not found locally.");
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found.");
    if (folder.teamId) throw new Error("This folder is a team root.");

    const treeIds = this.collectFolderTree(folderId, folders);
    const treeSet = new Set(treeIds);
    const builds = (await this.buildStore.listBuilds()).filter((b) => treeSet.has(b.folderId));
    const comps = (await this.compStore.listComps()).filter((c) => treeSet.has(c.folderId));

    // Folders first (parents before children — collectFolderTree is BFS), then items.
    const items = [];
    for (const id of treeIds) {
      const f = folders.find((x) => x.id === id);
      const parentId = id === folderId ? null : f.parentId;
      items.push({ itemId: id, type: "folder", parentId, body: TeamSync.folderBody(f), baseVersion: null });
    }
    for (const b of builds) items.push({ itemId: b.id, type: "build", parentId: b.folderId, body: TeamSync.buildBody(b), baseVersion: null });
    for (const c of comps) items.push({ itemId: c.id, type: "comp", parentId: c.folderId, body: TeamSync.compBody(c), baseVersion: null });

    const failed = [];
    let done = 0;
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50);
      const { results } = await this.api.bulk(teamId, batch);
      for (const r of results) {
        if (r.status === 200 || r.status === 201) {
          await this.syncStore.setVersion(teamId, r.itemId, { version: r.version, createdBy: session.userId });
        } else {
          failed.push({ itemId: r.itemId, status: r.status, message: r.message || (r.status === 409 ? "Already exists in the team." : "Rejected.") });
        }
      }
      done += batch.length;
      if (onProgress) onProgress({ done, total: items.length });
    }

    // Re-parent the folder under the team root. Its subtree keeps its structure.
    await this.folderStore.upsertFolder({ id: folderId, name: folder.name, parentId: root.id, sortOrder: folder.sortOrder });
    this._emit("sync-status", { status: "synced", folderId: root.id });
    return { uploaded: items.length - failed.length, failed };
  }

  // Owner only (enforced by the caller / server). The folder tree stays on disk
  // as personal data; teammates receive tombstones.
  async stopSharing(folderId) {
    const folders = await this.folderStore.listFolders();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("Folder not found.");
    const root = this.teamRootFor(folderId, folders);
    if (!root || root.id === folderId) throw new Error("Not a shared sub-folder of a team.");
    const teamId = root.teamId;
    const known = await this.syncStore.getVersion(teamId, folderId);
    if (known) {
      try {
        await this.api.deleteItem(teamId, folderId, known.version);
      } catch (err) {
        if (err.code !== "SYNC_NOT_FOUND") throw err;
      }
    }
    const treeIds = this.collectFolderTree(folderId, folders);
    const treeSet = new Set(treeIds);
    const itemIds = [
      ...treeIds,
      ...(await this.buildStore.listBuilds()).filter((b) => treeSet.has(b.folderId)).map((b) => b.id),
      ...(await this.compStore.listComps()).filter((c) => treeSet.has(c.folderId)).map((c) => c.id),
    ];
    for (const id of itemIds) {
      await this.syncStore.removeVersion(teamId, id);
      await this.syncStore.dequeue(teamId, id);
    }
    await this.folderStore.upsertFolder({ id: folderId, name: folder.name, parentId: null, sortOrder: folder.sortOrder });
    this._emit("sync-status", { status: "synced", folderId: root.id });
  }

  // Client-side mirror of the server rule, for UX (the server is the authority).
  async canDelete(teamId, itemId) {
    const folders = await this.folderStore.listFolders();
    const root = this.rootFolderForTeam(teamId, folders);
    if (!root) return true;
    if (root.role === "owner") return true;
    const known = await this.syncStore.getVersion(teamId, itemId);
    if (!known) return true; // never synced — nothing to protect
    const session = await this.getSession();
    return !!session && known.createdBy === session.userId;
  }
```

`_applyItem` must not skip when `versions` were just removed — `resolveConflict("theirs")` removes the version first, so the echo check passes, and it dequeues first so the outbox check passes. (`canDelete` compares `createdBy` against `session.userId`; the harness session is `userId: "me"`, and Task 5 stores `createdBy: session.userId` on first push.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/teamSync*.test.js --maxWorkers=2`
Expected: PASS (all four TeamSync suites)

- [ ] **Step 5: Commit**

```bash
git add src/main/teamSync.js tests/unit/teamSync.conflicts.test.js
git commit -m "feat(sync): conflict resolution, share-folder-to-team bulk upload, stop sharing, delete guard"
```

---

### Task 8: Wire `TeamSync` into `index.js`, add `teams:*` IPC + preload, route all mutations through the outbox

**Files:**
- Modify: `src/main/index.js` (requires; startup block ~346-400; handlers `builds:save`, `builds:delete`, `builds:revert`, `folders:save`, `folders:delete`, `folders:reorder`, `builds:move`, `comps:save`, `comps:delete`, `comps:delete-batch`, `builds:publish-build`, `comps:publish-comp`; replace the `shared-library:*` block ~1920-2110)
- Modify: `src/preload/index.js:131-141`
- Test: `tests/unit/teamsIpc.test.js` (static assertions on wiring, like `mainProcessDeps.test.js`)

**Interfaces:**
- Consumes: `TeamSync` (Tasks 4–7).
- Produces IPC channels: `teams:get-session`, `teams:enable`, `teams:disable`, `teams:list`, `teams:create`, `teams:join`, `teams:leave`, `teams:delete`, `teams:rename`, `teams:members`, `teams:remove-member`, `teams:rotate-invite`, `teams:share-folder`, `teams:stop-sharing`, `teams:pull`, `teams:pull-all`, `teams:resolve-conflict`, `teams:outbox` (for badges on startup). Preload names: `getTeamSession, enableTeamSync, disableTeamSync, listTeams, createTeam, joinTeam, leaveTeam, deleteTeam, renameTeam, listTeamMembers, removeTeamMember, rotateInvite, shareFolderToTeam, stopSharingFolder, pullTeam, pullAllTeams, resolveConflict, listOutbox`. New event `team-share-progress` `{ done, total }`.
- Publish: `builds:publish-build(buildId, opts = {})` / `comps:publish-comp(compId, boonCoverageHtml, opts = {})` — when the record has a `publishedOwner` different from the current publisher and `!opts.force`, throw `Error("PUBLISHED_BY_OTHER:<login>")`.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/teamsIpc.test.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MAIN = fs.readFileSync(path.join(__dirname, "../../src/main/index.js"), "utf8");
const PRELOAD = fs.readFileSync(path.join(__dirname, "../../src/preload/index.js"), "utf8");

const CHANNELS = ["teams:get-session", "teams:enable", "teams:disable", "teams:list", "teams:create", "teams:join", "teams:leave", "teams:delete", "teams:rename", "teams:members", "teams:remove-member", "teams:rotate-invite", "teams:share-folder", "teams:stop-sharing", "teams:pull", "teams:pull-all", "teams:resolve-conflict", "teams:outbox"];

test("every teams:* channel is handled in main and exposed in preload", () => {
  for (const ch of CHANNELS) {
    expect(MAIN).toContain(`handle("${ch}"`);
    expect(PRELOAD).toContain(`"${ch}"`);
  }
});

test("main no longer references the GitHub-org engine or its IPC", () => {
  expect(MAIN).not.toMatch(/require\("\.\/sharedLibrary"\)/);
  expect(MAIN).not.toMatch(/handle\("shared-library:/);
  expect(MAIN).not.toMatch(/sharedLibrary\.isOwner/);
  expect(MAIN).not.toMatch(/schedulePush\(|deleteBuildRemote\(|deleteCompRemote\(|schedulePushFolderMeta\(/);
});

test("mutating handlers enqueue outbox ops", () => {
  for (const needle of ['"build", "put"', '"build", "delete"', '"comp", "put"', '"comp", "delete"', '"folder", "put"', '"folder", "delete"']) {
    expect(MAIN).toContain(needle);
  }
});

test("publish handlers guard against publishing a teammate's item without force", () => {
  expect(MAIN.match(/PUBLISHED_BY_OTHER:/g).length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/teamsIpc.test.js --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Implement — requires and startup**

In `src/main/index.js`:

Replace `const { SharedLibrary } = require("./sharedLibrary");` with `const { TeamSync } = require("./teamSync");`.

In the `readyWork` block, replace everything from `// Walk up parentId chain to find the closest ancestor with shared:true` through the `app.on("browser-window-focus", …)` block with:

```js
  // Team root for a folder (walks parentId). Null for personal folders.
  async function findTeamRoot(folderId) {
    if (!folderId) return null;
    return teamSync.teamRootFor(folderId, await folderStore.listFolders());
  }

  const teamSync = new TeamSync({
    buildStore: store, compStore, folderStore, syncStore,
    historyStore: buildHistoryStore,
    emit: (channel, data) => {
      const wins = BrowserWindow.getAllWindows();
      if (wins.length) wins[0].webContents.send(channel, data);
    },
  });
  teamSync.startPolling();
  // Flush anything left in the outbox from a previous run, then pull.
  teamSync.pullAll().catch((err) => console.error("[startup-pull] error:", err.message));
  app.on("browser-window-focus", () => { teamSync.onFocus(); });
```

Also replace the module-level `_findRootSharedFolder` helper (near line 104) with:

```js
// Team root for a folder from an already-loaded folder list (walks parentId).
function _findTeamRoot(folderId, folders) {
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    if (current.teamId) return current;
    if (!current.parentId) return null;
    current = folders.find((f) => f.id === current.parentId);
  }
  return null;
}
```

- [ ] **Step 4: Implement — mutation handlers**

`builds:save` — replace from `const rootShared = await findRootSharedFolder(saved.folderId);` to the end of the move-out block with:

```js
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put");
    // Moved out of a team (or into a different one): tombstone it there.
    if (oldFolderId && oldFolderId !== saved.folderId) {
      const oldRoot = await findTeamRoot(oldFolderId);
      if (oldRoot && oldRoot.id !== teamRoot?.id) {
        if (!(await teamSync.canDelete(oldRoot.teamId, saved.id))) {
          throw new Error("Only the team owner or the build's creator can move it out of the team.");
        }
        await teamSync.enqueue(oldRoot.teamId, saved.id, "build", "delete");
      }
    }
```

`builds:delete` — replace the owner guard + remote delete with:

```js
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the build's creator can delete it from the team.");
    }
    await store.deleteBuild(id);
    await compStore.removeBuildFromComps(id);
    buildHistoryStore.deleteHistory(id).catch((err) => console.warn("[history] deleteHistory failed:", err.message));
    if (folderId) await folderStore.touchFolders([folderId]);
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, id, "build", "delete");
    return true;
```

`builds:revert` — replace the `rootShared` block with:

```js
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, saved.id, "build", "put");
```

`folders:save`:

```js
  handle("folders:save", async (_e, folder) => {
    const saved = await folderStore.upsertFolder(folder);
    if (saved.parentId) {
      const teamRoot = await findTeamRoot(saved.parentId);
      if (teamRoot) await teamSync.enqueue(teamRoot.teamId, saved.id, "folder", "put");
    }
    return saved;
  });
```

`folders:delete`:

```js
  handle("folders:delete", async (_e, id) => {
    const allFolders = await folderStore.listFolders();
    const target = allFolders.find((f) => f.id === id);
    if (target?.teamId) throw new Error("Leave or delete the team from Settings → Teams instead.");
    const teamRoot = target?.parentId ? _findTeamRoot(target.parentId, allFolders) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the folder's creator can delete it from the team.");
    }
    const deletedIds = await folderStore.deleteFolder(id);
    if (deletedIds.length) await store.clearFolderFromBuilds(deletedIds);
    // One tombstone for the folder; the server cascades to descendants.
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, id, "folder", "delete");
    return deletedIds;
  });
```

`folders:reorder` — after `reorderFolders`, enqueue a folder put for any reordered folder inside a team:

```js
  handle("folders:reorder", async (_e, updates) => {
    await folderStore.reorderFolders(updates);
    const folders = await folderStore.listFolders();
    for (const { id } of updates) {
      const f = folders.find((x) => x.id === id);
      const teamRoot = f?.parentId ? _findTeamRoot(f.parentId, folders) : null;
      if (teamRoot) await teamSync.enqueue(teamRoot.teamId, id, "folder", "put");
    }
  });
```

`builds:move` — replace the owner check and both sync blocks with:

```js
    const destRoot = await findTeamRoot(folderId);
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRoot = await findTeamRoot(srcId);
      if (srcRoot && srcRoot.id !== destRoot?.id) {
        for (const id of ids) {
          if (!(await teamSync.canDelete(srcRoot.teamId, id))) {
            throw new Error("Only the team owner or the build's creator can move it out of the team.");
          }
        }
      }
    }

    await store.moveBuilds(ids, folderId);

    if (destRoot) {
      for (const id of ids) await teamSync.enqueue(destRoot.teamId, id, "build", "put");
    }
    for (const srcId of sourceFolderIds) {
      if (srcId === folderId) continue;
      const srcRoot = await findTeamRoot(srcId);
      if (srcRoot && srcRoot.id !== destRoot?.id) {
        for (const id of ids) await teamSync.enqueue(srcRoot.teamId, id, "build", "delete");
      }
    }
```

`comps:save`:

```js
  handle("comps:save", async (_e, comp) => {
    const existing = comp.id ? (await compStore.listComps()).find((c) => c.id === comp.id) : null;
    const oldFolderId = existing?.folderId ?? null;
    const saved = await compStore.upsertComp(comp);
    const teamRoot = await findTeamRoot(saved.folderId);
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, saved.id, "comp", "put");
    if (oldFolderId && oldFolderId !== saved.folderId) {
      const oldRoot = await findTeamRoot(oldFolderId);
      if (oldRoot && oldRoot.id !== teamRoot?.id) {
        if (!(await teamSync.canDelete(oldRoot.teamId, saved.id))) {
          throw new Error("Only the team owner or the comp's creator can move it out of the team.");
        }
        await teamSync.enqueue(oldRoot.teamId, saved.id, "comp", "delete");
      }
    }
    return saved;
  });
```

`comps:delete`:

```js
  handle("comps:delete", async (_e, id) => {
    const comps = await compStore.listComps();
    const comp = comps.find((c) => c.id === id);
    const folderId = comp?.folderId;
    const teamRoot = folderId ? await findTeamRoot(folderId) : null;
    if (teamRoot && !(await teamSync.canDelete(teamRoot.teamId, id))) {
      throw new Error("Only the team owner or the comp's creator can delete it from the team.");
    }
    await compStore.deleteComp(id);
    await store.clearCompFromBuilds([id]);
    if (teamRoot) await teamSync.enqueue(teamRoot.teamId, id, "comp", "delete");
  });
```

`comps:delete-batch`:

```js
  handle("comps:delete-batch", async (_e, ids) => {
    const comps = await compStore.listComps();
    const folders = await folderStore.listFolders();
    const teamOps = [];
    for (const id of ids) {
      const comp = comps.find((c) => c.id === id);
      const teamRoot = comp?.folderId ? _findTeamRoot(comp.folderId, folders) : null;
      if (!teamRoot) continue;
      if (!(await teamSync.canDelete(teamRoot.teamId, id))) {
        throw new Error(`Only the team owner or the comp's creator can delete "${comp.name}" from the team.`);
      }
      teamOps.push([teamRoot.teamId, id]);
    }
    await compStore.deleteComps(ids);
    if (ids.length) await store.clearCompFromBuilds(ids);
    for (const [teamId, id] of teamOps) await teamSync.enqueue(teamId, id, "comp", "delete");
  });
```

`builds:publish-build` / `comps:publish-comp` registration lines become:

```js
  handle("builds:publish-build", (event, buildId, opts) => enqueuePublish(() => publishBuildImpl(event, buildId, opts || {})));
  handle("comps:publish-comp", (event, compId, boonCoverageHtml, opts) => enqueuePublish(() => publishCompImpl(event, compId, boonCoverageHtml, opts || {})));
```

Publish — in `publishBuildImpl` replace the `sharedRoot`/`owner`/`ownerType` block with:

```js
    const owner = personalOwner;
    const ownerType = "user";
    if (build.publishedOwner && build.publishedOwner !== owner && !opts.force) {
      throw new Error(`PUBLISHED_BY_OTHER:${build.publishedOwner}`);
    }
    const teamRoot = await findTeamRoot(build.folderId);
```

(signature becomes `publishBuildImpl(event, buildId, opts = {})`, and the `handle` passes `opts` through), replace `if (sharedRoot) { sharedLibrary.schedulePush("build", savedBuild); }` with `if (teamRoot) await teamSync.enqueue(teamRoot.teamId, savedBuild.id, "build", "put");`, and the `if (!sharedRoot)` around `patchAuthRecord` becomes unconditional. Same edits in `publishCompImpl` (`compSharedRoot` → `compTeamRoot`, `PUBLISHED_BY_OTHER` check on `comp.publishedOwner`, enqueue `"comp", "put"` for the comp and `"build", "put"` for each `updatedBuildRecords` entry when `compTeamRoot`).

- [ ] **Step 5: Implement — `teams:*` IPC (replaces the whole `shared-library:*` block)**

```js
  // ─── Teams (team sync) ─────────────────────────────────────────────────────
  handle("teams:get-session", () => teamSync.getSession());
  handle("teams:enable", async () => {
    const session = await getSession();
    if (!session) throw new Error("Log in with GitHub first.");
    const user = await teamSync.enableWithGithub(session.token);
    teamSync.startPolling();
    teamSync.pullAll().catch(() => {});
    return user;
  });
  handle("teams:disable", () => teamSync.disable());
  handle("teams:list", () => teamSync.listTeams());
  handle("teams:create", (_e, name) => teamSync.createTeam(name));
  handle("teams:join", (_e, code) => teamSync.joinTeam(code));
  handle("teams:leave", (_e, teamId) => teamSync.leaveTeam(teamId));
  handle("teams:delete", (_e, teamId) => teamSync.deleteTeam(teamId));
  handle("teams:rename", (_e, teamId, name) => teamSync.renameTeam(teamId, name));
  handle("teams:members", (_e, teamId) => teamSync.listMembers(teamId));
  handle("teams:remove-member", (_e, teamId, userId) => teamSync.removeMember(teamId, userId));
  handle("teams:rotate-invite", (_e, teamId) => teamSync.rotateInvite(teamId));
  handle("teams:share-folder", (_e, folderId, teamId) =>
    teamSync.shareFolderToTeam(folderId, teamId, (p) => _e.sender.send("team-share-progress", { folderId, ...p })));
  handle("teams:stop-sharing", async (_e, folderId) => {
    const root = await findTeamRoot(folderId);
    if (root?.role !== "owner") throw new Error("Only the team owner can stop sharing a folder.");
    return teamSync.stopSharing(folderId);
  });
  handle("teams:pull", (_e, teamId) => teamSync.pullTeam(teamId));
  handle("teams:pull-all", () => teamSync.pullAll());
  handle("teams:resolve-conflict", (_e, teamId, itemId, choice) => teamSync.resolveConflict(teamId, itemId, choice));
  handle("teams:outbox", async () => {
    const out = {};
    for (const teamId of await syncStore.listTeamIds()) out[teamId] = await syncStore.listOutbox(teamId);
    return out;
  });
```

Delete the old `shared-library:list-orgs`, `:setup`, `:share-folder`, `:unshare-folder`, `:pull-folder`, `:pull-all`, `:connect`, `:disconnect`, `:get-config`, `:force-push` handlers and their `require("./githubApi")` lines for `getRepoTree/getFileContents/getOrgRole/ensureSharedRepo`.

- [ ] **Step 6: Implement — preload**

Replace the `// Shared Library` block in `src/preload/index.js` with:

```js
  // Teams (team sync)
  getTeamSession: () => ipcRenderer.invoke("teams:get-session"),
  enableTeamSync: () => ipcRenderer.invoke("teams:enable"),
  disableTeamSync: () => ipcRenderer.invoke("teams:disable"),
  listTeams: () => ipcRenderer.invoke("teams:list"),
  createTeam: (name) => ipcRenderer.invoke("teams:create", name),
  joinTeam: (code) => ipcRenderer.invoke("teams:join", code),
  leaveTeam: (teamId) => ipcRenderer.invoke("teams:leave", teamId),
  deleteTeam: (teamId) => ipcRenderer.invoke("teams:delete", teamId),
  renameTeam: (teamId, name) => ipcRenderer.invoke("teams:rename", teamId, name),
  listTeamMembers: (teamId) => ipcRenderer.invoke("teams:members", teamId),
  removeTeamMember: (teamId, userId) => ipcRenderer.invoke("teams:remove-member", teamId, userId),
  rotateInvite: (teamId) => ipcRenderer.invoke("teams:rotate-invite", teamId),
  shareFolderToTeam: (folderId, teamId) => ipcRenderer.invoke("teams:share-folder", folderId, teamId),
  stopSharingFolder: (folderId) => ipcRenderer.invoke("teams:stop-sharing", folderId),
  pullTeam: (teamId) => ipcRenderer.invoke("teams:pull", teamId),
  pullAllTeams: () => ipcRenderer.invoke("teams:pull-all"),
  resolveConflict: (teamId, itemId, choice) => ipcRenderer.invoke("teams:resolve-conflict", teamId, itemId, choice),
  listOutbox: () => ipcRenderer.invoke("teams:outbox"),
  onTeamShareProgress: (cb) => {
    ipcRenderer.removeAllListeners("team-share-progress");
    ipcRenderer.on("team-share-progress", (_e, p) => cb(p));
  },
  // Compat shims — removed in Plan 3 when the renderer moves to teams:*.
  getSharedLibraryConfig: () => Promise.resolve(null),
  pullAllShared: () => ipcRenderer.invoke("teams:pull-all"),
  pullFolder: () => ipcRenderer.invoke("teams:pull-all"),
  shareFolder: () => Promise.reject(new Error("Use Share to team…")),
  unshareFolder: () => Promise.reject(new Error("Use Stop sharing")),
  listOrgs: () => Promise.resolve([]),
  setupSharedLibrary: () => Promise.reject(new Error("Shared libraries are now Teams — see Settings → Teams.")),
  connectSharedLibrary: () => Promise.resolve(true),
  disconnectSharedLibrary: () => Promise.resolve(true),
  forcePush: () => Promise.resolve({ conflict: false }),
```

Keep `onSyncConflict` / `onSyncStatus` as they are.

- [ ] **Step 7: Syntax-check, run the test and the full unit suite**

Run: `node --check src/main/index.js && npx jest tests/unit/teamsIpc.test.js tests/unit --maxWorkers=2`
Expected: `teamsIpc` PASS; `sharedLibrary.test.js` still passes (module still exists until Task 9).

- [ ] **Step 8: Smoke-run the app against `wrangler dev`**

```bash
npx wrangler dev --local &        # Plan 1 must be applied
AXIFORGE_SYNC_BASE=http://localhost:8787/api/sync npm run dev
```
In DevTools console: `await window.desktopApi.enableTeamSync(); await window.desktopApi.createTeam("Smoke")` → a root folder appears after `reloadBuilds`; saving a build into it produces a `PUT` in the wrangler log within ~1s.

- [ ] **Step 9: Commit**

```bash
git add src/main/index.js src/preload/index.js tests/unit/teamsIpc.test.js
git commit -m "feat(sync): wire TeamSync into main — teams:* IPC, outbox on every team mutation, publishedOwner guard"
```

---

### Task 9: Remove the GitHub-org sync code

**Files:**
- Delete: `src/main/sharedLibrary.js`, `tests/unit/sharedLibrary.test.js`
- Modify: `src/main/githubApi.js` (remove `SHARED_REPO`, `ensureSharedRepo`, `getHeadSha`, `getRepoTree`, `getFileContents`, `putSharedFile`, `deleteSharedFile`, `getOrgRole` and their exports), `tests/unit/githubApi.test.js` (remove their tests), `src/main/syncStore.js` (remove `getShas/setShas/setSha/removeSha/removeFolder`), `tests/unit/syncStore.test.js` (remove those describes)
- Test: `tests/unit/teamsIpc.test.js` (extend)

- [ ] **Step 1: Extend the test**

Append to `tests/unit/teamsIpc.test.js`:

```js
test("GitHub-org sync code is gone", () => {
  expect(fs.existsSync(path.join(__dirname, "../../src/main/sharedLibrary.js"))).toBe(false);
  const gh = fs.readFileSync(path.join(__dirname, "../../src/main/githubApi.js"), "utf8");
  for (const fn of ["ensureSharedRepo", "getRepoTree", "putSharedFile", "deleteSharedFile", "getOrgRole", "getHeadSha", "SHARED_REPO"]) {
    expect(gh).not.toContain(fn);
  }
  const ss = fs.readFileSync(path.join(__dirname, "../../src/main/syncStore.js"), "utf8");
  expect(ss).not.toMatch(/remoteShas/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/teamsIpc.test.js --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Delete and trim**

```bash
git rm src/main/sharedLibrary.js tests/unit/sharedLibrary.test.js
```
In `githubApi.js` delete the "Shared Library API" section (from `const SHARED_REPO` through `deleteSharedFile`, keeping `pollUrlLive`) and the corresponding names in `module.exports`. In `tests/unit/githubApi.test.js` remove the imports and `describe` blocks for those functions. In `syncStore.js` remove the five SHA methods; in `tests/unit/syncStore.test.js` remove the SHA `describe` blocks (keep `init` and the team-scope block). `getFileContents` is also used nowhere else — verify with `grep -rn "getFileContents\|getRepoTree" src/` (expect no hits).

- [ ] **Step 4: Run the full unit + integration suites**

Run: `npx jest tests/unit tests/integration --maxWorkers=2`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A src/main/githubApi.js src/main/syncStore.js tests/unit/githubApi.test.js tests/unit/syncStore.test.js tests/unit/teamsIpc.test.js
git commit -m "chore(sync): remove GitHub-org shared library engine and shared-repo API"
```

---

## Self-review

**Spec coverage (§2, §5):** 2.1 modules → T2/T4 (+ removal T9); 2.2 local state → T3 (`auth.sync` in T4, `teamId/role` on folders in T3); 2.3 outbox invariants, debounce 1s/max 5s, body read at flush, delete-supersedes-put, per-team serialization, every error branch incl. 401 preserving the outbox, flush triggers (enqueue/startup/focus/online/poll) → T5 + T6 (`pullAll` flushes first; startup/focus wired in T8; the `online` trigger is the renderer's job in Plan 3 via `pullAllTeams`) ; 2.4 pull rules, paging, cursor per page, history, triggers, 3-strike toast → T6; 2.5 conflicts incl. tombstone cases and dirty-editor handling (the `item` is delivered in the `synced` event and the renderer keeps its existing "don't clobber dirty editor" logic) → T7; 2.6 payloads → T4; 2.7 folder/move ops → T8 (+ `shareFolderToTeam`/`stopSharing` T7); 2.8 `publishedOwner` + warning → T1 + T8; 2.9 history → T6; §5 table: offline/5xx/429 → T5, 401 → T5/T6, 409 → T7, 403 → T5, 413 → T5, pull failures → T6, crash mid-flush → outbox on disk (T3/T5), team deleted by owner → `listTeams` detaches (T4; Plan 3 calls `listTeams` on settings open and on the `detached` event).

**Placeholder scan:** none. The `joinTeam` test in T4 depends on a temporary `pullTeam` stub that T6 replaces — documented inline.

**Type consistency:** `enqueue(teamId, itemId, type, op)` is the signature used in T5 tests and every T8 call; `SyncStore.enqueue(teamId, itemId, { type, op })` (T3) is what `TeamSync.enqueue` calls; `getVersion → { version, createdBy }` used identically in T5/T6/T7; `sync-status` payloads always include `folderId` = root folder id; `SyncApiError.code` strings match between T2 and the harness in T4.
