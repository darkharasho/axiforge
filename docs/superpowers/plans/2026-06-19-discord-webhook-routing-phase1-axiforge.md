# Discord Webhook Routing — Phase 1 (AxiForge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AxiForge hold multiple comp **and** build Discord webhooks and expose them over the local HTTP API, so AxiVale can list them and post a share to chosen webhook(s).

**Architecture:** Generalize the existing comp-webhook module to a kind-agnostic `discordWebhooks.js` (kind = `comp | build`), make `discord:share-build` multi-webhook like `discord:share-comp`, then add the HTTP surface: `GET /discord/webhooks` and `webhook_ids` in the two `share-discord` POST bodies.

**Tech Stack:** Node/Electron main process (CommonJS), aiohttp-free local HTTP API (`localApi.js`), Jest.

## Global Constraints

- Webhook entry shape: `{ id, name, url, threadMode, threadId }`. Settings keys: `discord.compWebhooks`, `discord.buildWebhooks` (arrays).
- Legacy migration keys — comp: `discord.webhookUrl` / `discord.threadMode` / `discord.threadId`; build: `discord.buildWebhookUrl` / `discord.buildThreadMode` / `discord.buildThreadId`.
- `WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//`.
- `shareToWebhooks(webhooks, ids, shareOne)` returns `{ success, results: [{ id, name, success, error? }] }`; `ids` null/empty ⇒ all.
- Tests: `npx jest tests/unit/<file>`. Match existing `tests/unit/localApi.test.js` harness (stubOps + `req(port, token, method, path, body)`).

---

### Task 1: Generalize the webhook module to `discordWebhooks.js`

**Files:**
- Create: `src/main/discordWebhooks.js`
- Delete: `src/main/compWebhooks.js`
- Create: `tests/unit/discordWebhooks.test.js`
- Delete: `tests/unit/compWebhooks.test.js`
- Modify: `src/main/index.js:1441`, `src/main/index.js:1489` (require + call sites)

**Interfaces:**
- Produces: `getWebhooks(store, kind)` → `Promise<Array<{id,name,url,threadMode,threadId}>>` (kind `"comp"|"build"`, migrates that kind's legacy single webhook once); `shareToWebhooks(webhooks, ids, shareOne)` → `Promise<{success, results}>`; `WEBHOOK_RE`.

- [ ] **Step 1: Write `discordWebhooks.js`**

```javascript
"use strict";

const crypto = require("node:crypto");

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

// Per-kind legacy single-webhook settings (migrated into the list once).
const LEGACY = {
  comp: { url: "discord.webhookUrl", mode: "discord.threadMode", id: "discord.threadId" },
  build: { url: "discord.buildWebhookUrl", mode: "discord.buildThreadMode", id: "discord.buildThreadId" },
};
const LIST_KEY = { comp: "discord.compWebhooks", build: "discord.buildWebhooks" };

function makeId() {
  return crypto.randomUUID();
}

// Returns the webhook list for a kind, migrating that kind's legacy single
// webhook into a one-entry list the first time (then persisting; idempotent).
async function getWebhooks(store, kind) {
  const listKey = LIST_KEY[kind];
  if (!listKey) throw new Error(`unknown webhook kind: ${kind}`);
  const existing = await store.getSetting(listKey);
  if (Array.isArray(existing)) return existing;

  const legacy = LEGACY[kind];
  const url = await store.getSetting(legacy.url);
  if (url && WEBHOOK_RE.test(url)) {
    const [threadMode, threadId] = await Promise.all([
      store.getSetting(legacy.mode),
      store.getSetting(legacy.id),
    ]);
    const mode = threadMode || "none";
    const migrated = [{
      id: makeId(),
      name: "Default",
      url,
      threadMode: mode,
      threadId: mode === "custom" && threadId ? threadId : null,
    }];
    await store.setSetting(listKey, migrated);
    return migrated;
  }
  return [];
}

// Posts to multiple webhooks and aggregates results.
//   ids - target ids; null/empty means "all".
//   shareOne - async (webhook) => { success, error? }
async function shareToWebhooks(webhooks, ids, shareOne) {
  let targets = webhooks;
  if (Array.isArray(ids) && ids.length) {
    const idSet = new Set(ids);
    targets = webhooks.filter((w) => idSet.has(w.id));
  }
  if (!targets.length) {
    return { success: false, error: "No Discord webhook configured", results: [] };
  }
  const results = [];
  for (const w of targets) {
    if (!WEBHOOK_RE.test(w.url || "")) {
      results.push({ id: w.id, name: w.name, success: false, error: "Invalid webhook URL" });
      continue;
    }
    try {
      const r = await shareOne(w);
      const entry = { id: w.id, name: w.name, success: !!r.success };
      if (!r.success) entry.error = r.error;
      results.push(entry);
    } catch (err) {
      results.push({ id: w.id, name: w.name, success: false, error: err.message });
    }
  }
  return { success: results.some((r) => r.success), results };
}

module.exports = { WEBHOOK_RE, getWebhooks, shareToWebhooks };
```

- [ ] **Step 2: Write `tests/unit/discordWebhooks.test.js`**

```javascript
"use strict";
const { getWebhooks, shareToWebhooks } = require("../../src/main/discordWebhooks");

function memStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getSetting: async (k) => (k in data ? data[k] : undefined),
    setSetting: async (k, v) => { data[k] = v; },
  };
}
const URL_OK = "https://discord.com/api/webhooks/1/abc";

describe("getWebhooks", () => {
  test("returns an existing list as-is", async () => {
    const store = memStore({ "discord.compWebhooks": [{ id: "x", name: "A", url: URL_OK }] });
    expect(await getWebhooks(store, "comp")).toEqual([{ id: "x", name: "A", url: URL_OK }]);
  });

  test("migrates a legacy comp webhook once and persists", async () => {
    const store = memStore({ "discord.webhookUrl": URL_OK, "discord.threadMode": "none" });
    const list = await getWebhooks(store, "comp");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Default", url: URL_OK, threadMode: "none" });
    expect(store.data["discord.compWebhooks"]).toEqual(list); // persisted
  });

  test("migrates legacy build webhook from build-specific keys", async () => {
    const store = memStore({ "discord.buildWebhookUrl": URL_OK, "discord.buildThreadMode": "custom", "discord.buildThreadId": "55" });
    const list = await getWebhooks(store, "build");
    expect(list[0]).toMatchObject({ url: URL_OK, threadMode: "custom", threadId: "55" });
  });

  test("returns [] when nothing configured", async () => {
    expect(await getWebhooks(memStore(), "comp")).toEqual([]);
  });
});

describe("shareToWebhooks", () => {
  const hooks = [
    { id: "a", name: "DEFI", url: URL_OK },
    { id: "b", name: "EWW", url: URL_OK },
  ];

  test("targets selected ids and aggregates", async () => {
    const res = await shareToWebhooks(hooks, ["b"], async () => ({ success: true }));
    expect(res.success).toBe(true);
    expect(res.results).toEqual([{ id: "b", name: "EWW", success: true }]);
  });

  test("empty ids means all", async () => {
    const res = await shareToWebhooks(hooks, [], async () => ({ success: true }));
    expect(res.results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("invalid url fails that entry without calling shareOne", async () => {
    const res = await shareToWebhooks([{ id: "a", name: "Bad", url: "nope" }], null, async () => ({ success: true }));
    expect(res).toMatchObject({ success: false, results: [{ id: "a", success: false, error: "Invalid webhook URL" }] });
  });
});
```

- [ ] **Step 3: Run the new tests — expect PASS**

Run: `npx jest tests/unit/discordWebhooks.test.js`
Expected: PASS (module written before test runs).

- [ ] **Step 4: Repoint `index.js` call sites and delete the old module**

In `src/main/index.js` line ~1441 (inside `discord:share-comp`):
```javascript
    const { getWebhooks, shareToWebhooks } = require("./discordWebhooks");
```
and replace `getCompWebhooks(store)` → `getWebhooks(store, "comp")`, and `shareCompToWebhooks(webhooks, webhookIds, ...)` → `shareToWebhooks(webhooks, webhookIds, ...)`.

In `src/main/index.js` line ~1489 (`discord:list-comp-webhooks`):
```javascript
    const { getWebhooks } = require("./discordWebhooks");
    const webhooks = await getWebhooks(store, "comp");
```

Then:
```bash
git rm src/main/compWebhooks.js tests/unit/compWebhooks.test.js
```

- [ ] **Step 5: Run the full suite — expect PASS**

Run: `npx jest`
Expected: PASS (no remaining references to `compWebhooks`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(webhooks): kind-agnostic discordWebhooks module (comp + build)"
```

---

### Task 2: Multi-webhook `discord:share-build` + `discord:list-build-webhooks`

**Files:**
- Modify: `src/main/index.js` (`discord:share-build` ~1494; add `discord:list-build-webhooks` near `discord:list-comp-webhooks` ~1488)

**Interfaces:**
- Consumes: `getWebhooks`, `shareToWebhooks` (Task 1); existing `shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, webhookUrl, opts)` from `./discordWebhook`.
- Produces: IPC `discord:share-build(buildId, webhookIds)` → `{ success, results }`; `discord:list-build-webhooks()` → `[{id,name}]`.

- [ ] **Step 1: Read the current `discord:share-build` body**

Run: `sed -n '1494,1575p' src/main/index.js`
Expected: see how it loads the build, builds `buildUrl`/`chatLink`/`embedMeta`, and the single `shareBuildToDiscord(..., webhookUrl, { threadMode, threadId })` call.

- [ ] **Step 2: Rewrite the handler to load webhooks + post to each**

Replace the single-webhook load/guard/call with:
```javascript
  handle("discord:share-build", async (_e, buildId, webhookIds) => {
    const { shareBuildToDiscord } = require("./discordWebhook");
    const { getWebhooks, shareToWebhooks } = require("./discordWebhooks");
    const { generateChatLink } = require("./buildChatLink.js");

    const webhooks = await getWebhooks(store, "build");
    if (!webhooks.length) {
      return { success: false, error: "Build webhook URL is not configured or invalid" };
    }
    // ... keep the existing build load + buildUrl + chatLink + embedMeta setup ...
    return shareToWebhooks(webhooks, webhookIds, (w) =>
      shareBuildToDiscord(build, buildUrl, chatLink, embedMeta, w.url, {
        threadMode: w.threadMode || "none",
        threadId: w.threadMode === "custom" ? w.threadId : null,
      })
    );
  });
```
Keep every existing line that computes `build`, `buildUrl`, `chatLink`, `embedMeta` (between the webhook load and the return). Only the webhook load, the guard, and the final post are changed.

- [ ] **Step 3: Add `discord:list-build-webhooks` (next to the comp one)**

```javascript
  handle("discord:list-build-webhooks", async () => {
    const { getWebhooks } = require("./discordWebhooks");
    const webhooks = await getWebhooks(store, "build");
    return webhooks.map((w) => ({ id: w.id, name: w.name }));
  });
```

- [ ] **Step 4: Sanity-load the main module (syntax)**

Run: `node -e "require('@babel/core'); require('child_process').execSync('node --check src/main/index.js', {stdio:'inherit'})" || node --check src/main/index.js`
Expected: no syntax error.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js
git commit -m "feat(discord): multi-webhook share-build + list-build-webhooks"
```

---

### Task 3: HTTP API — `GET /discord/webhooks` + `webhook_ids` on the share routes

**Files:**
- Modify: `src/main/index.js` (ops object ~2030–2075: `shareBuildToDiscord`, `shareCompToDiscord`; add `listDiscordWebhooks`)
- Modify: `src/main/localApi.js` (add route; thread `body.webhook_ids` into the two share routes ~163 and ~219)
- Modify: `tests/unit/localApi.test.js` (stubOps + route tests)

**Interfaces:**
- Consumes: IPC handlers from Tasks 1–2 via `invokeLocal`.
- Produces: ops `listDiscordWebhooks()` → `{ comp:[{id,name}], build:[{id,name}] }`; `shareCompToDiscord(id, webhookIds)`; `shareBuildToDiscord(id, webhookIds)`. Route `GET /discord/webhooks`; `POST /(comps|builds)/:id/share-discord` accept `{ webhook_ids }`.

- [ ] **Step 1: Update ops in `index.js`**

Replace the two share ops and add the list op:
```javascript
      shareBuildToDiscord: (id, webhookIds) =>
        asHttpResult(invokeLocal("discord:share-build", id, webhookIds), { badInput: true }),
      shareCompToDiscord: (id, webhookIds) =>
        asHttpResult(invokeLocal("discord:share-comp", id, webhookIds), { badInput: true }),
      listDiscordWebhooks: async () => ({
        comp: await invokeLocal("discord:list-comp-webhooks"),
        build: await invokeLocal("discord:list-build-webhooks"),
      }),
```

- [ ] **Step 2: Add the list route + thread `webhook_ids` in `localApi.js`**

Add near the other `/discord`-ish routes (e.g. after the comp share route):
```javascript
    {
      method: "GET", pattern: "/discord/webhooks",
      handler: async () => ops.listDiscordWebhooks(),
    },
```
In `POST /comps/:id/share-discord` handler, change the call to:
```javascript
        return ops.shareCompToDiscord(params.id, body?.webhook_ids);
```
and add `body` to its handler args: `handler: async ({ params, body }) => {`.
Do the same for `POST /builds/:id/share-discord`:
```javascript
        return ops.shareBuildToDiscord(params.id, body?.webhook_ids);
```
with `handler: async ({ params, body }) => {`.

- [ ] **Step 3: Add tests to `tests/unit/localApi.test.js`**

In `stubOps`, add:
```javascript
    listDiscordWebhooks: async () => ({ comp: [], build: [] }),
```
In the builds `beforeEach` overrides, capture share ids:
```javascript
      shareBuildToDiscord: async (id, webhookIds) => { sharedBuilds.push({ id, webhookIds }); return { success: true }; },
```
(declare `const sharedBuilds = []` and reset it). Then:
```javascript
  test("GET /discord/webhooks returns comp + build lists", async () => {
    const { api: a, token: t, port: p } = await startApi({
      listDiscordWebhooks: async () => ({ comp: [{ id: "c1", name: "DEFI" }], build: [] }),
    });
    const res = await req(p, t, "GET", "/discord/webhooks");
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ comp: [{ id: "c1", name: "DEFI" }], build: [] });
    await a.stop();
  });

  test("POST /comps/:id/share-discord forwards webhook_ids", async () => {
    const created = await compStore.upsertComp({ name: "Pub" });
    const res = await req(port, token, "POST", `/comps/${created.id}/share-discord`, { webhook_ids: ["c1", "c2"] });
    expect(res.status).toBe(200);
    expect(sharedComps).toContainEqual({ id: created.id, webhookIds: ["c1", "c2"] });
  });
```
(For the comps test, update the comps `beforeEach` `shareCompToDiscord` stub to `async (id, webhookIds) => { sharedComps.push({ id, webhookIds }); return { success: true }; }` and declare/reset `sharedComps`.)

- [ ] **Step 4: Run localApi tests — expect PASS**

Run: `npx jest tests/unit/localApi.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite — expect PASS**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/main/localApi.js tests/unit/localApi.test.js
git commit -m "feat(local-api): GET /discord/webhooks + webhook_ids on share routes"
```

---

## Self-review

- **Spec coverage:** generalize module (T1), build multi-webhook + list (T2), HTTP list + share `webhook_ids` (T3) — covers the AxiForge section of the spec. ✓
- **Placeholders:** Task 2 Step 2 says "keep existing build/url/chatLink/embedMeta setup" — that's intentional (preserve real code between the changed lines), with exact line range to read in Step 1. ✓
- **Types:** `getWebhooks`/`shareToWebhooks`/`listDiscordWebhooks`/`share*ToDiscord(id, webhookIds)` names consistent across tasks. ✓

## Deploy (after all tasks)
- Land on `origin/main` (cherry-pick onto origin to avoid the local-only commit), then on piclock `git pull` + `pm2 restart axitools`… **no** — this is AxiForge, not the bot. AxiForge ships via its own tagged release (`npm version` + tag) once Phases are merged; coordinate release with the AxiVale phases.
