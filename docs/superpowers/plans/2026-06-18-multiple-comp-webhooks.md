# Multiple Comp Discord Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure multiple named Discord webhooks for comps and pick one or more destinations (multi-select) when sharing a comp's embed.

**Architecture:** A new pure module `src/main/compWebhooks.js` owns the webhook list (with lazy migration from the legacy single-webhook keys) and the multi-post aggregation logic, so both are unit-testable in isolation. The `discord:share-comp` IPC handler resolves the comp/builds once, then posts to each selected webhook via the existing `shareCompToDiscord` core function. The settings modal gets a dynamic list editor; the comp share button gets a multi-select picker.

**Tech Stack:** Electron (main + preload + renderer), plain JS, Jest for unit tests, `node:crypto` for IDs.

## Global Constraints

- Builds remain single-webhook (`discord.buildWebhookUrl`) — only comps get the list. Do not touch build sharing.
- Webhook URL validation regex (verbatim): `/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//`
- Thread modes: `"none" | "auto" | "custom"`; custom requires a numeric (`/^\d+$/`) thread ID.
- New setting key: `discord.compWebhooks` (array). Legacy keys `discord.webhookUrl` / `discord.threadMode` / `discord.threadId` stay in `settings.json` but are no longer read for comp sharing once the array exists.
- Webhook entry shape: `{ id, name, url, threadMode, threadId }` (threadId is `string | null`).
- Run tests with `--maxWorkers=2` per the repo's memory limits. The repo test runner is **Jest** (`npm test`), not vitest.
- Aggregate share result shape: `{ success: boolean, results: [{ id, name, success, error? }] }`.

---

### Task 1: `compWebhooks.js` module — migration + aggregation helpers

**Files:**
- Create: `src/main/compWebhooks.js`
- Test: `tests/unit/compWebhooks.test.js`

**Interfaces:**
- Consumes: a `store` object exposing `async getSetting(key)` and `async setSetting(key, value)` (this is the existing `BuildStore`).
- Produces:
  - `WEBHOOK_RE: RegExp`
  - `async getCompWebhooks(store): Promise<Array<{id,name,url,threadMode,threadId}>>` — returns the list, migrating the legacy single webhook into a one-entry list the first time if needed.
  - `async shareCompToWebhooks(webhooks, webhookIds, shareOne): Promise<{success, results}>` — `webhooks` is the full list, `webhookIds` is an array of ids to target (or null/empty = all), `shareOne(webhook)` is an async fn returning `{success, error?}`. Filters to valid targets, calls `shareOne` per target, aggregates.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/compWebhooks.test.js
"use strict";
const { getCompWebhooks, shareCompToWebhooks, WEBHOOK_RE } = require("../../src/main/compWebhooks");

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async getSetting(key) { return key in data ? data[key] : null; },
    async setSetting(key, value) { data[key] = value; },
  };
}

const VALID = "https://discord.com/api/webhooks/123/abc";

describe("getCompWebhooks", () => {
  test("returns existing compWebhooks array unchanged", async () => {
    const list = [{ id: "w1", name: "A", url: VALID, threadMode: "none", threadId: null }];
    const store = makeStore({ "discord.compWebhooks": list });
    expect(await getCompWebhooks(store)).toEqual(list);
  });

  test("migrates legacy single webhook into a one-entry list", async () => {
    const store = makeStore({
      "discord.webhookUrl": VALID,
      "discord.threadMode": "custom",
      "discord.threadId": "999",
    });
    const result = await getCompWebhooks(store);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Default", url: VALID, threadMode: "custom", threadId: "999" });
    expect(typeof result[0].id).toBe("string");
    expect(result[0].id.length).toBeGreaterThan(0);
    // persisted so it's idempotent
    expect(store.data["discord.compWebhooks"]).toEqual(result);
  });

  test("migration drops threadId when mode is not custom", async () => {
    const store = makeStore({ "discord.webhookUrl": VALID, "discord.threadMode": "auto", "discord.threadId": "999" });
    const result = await getCompWebhooks(store);
    expect(result[0]).toMatchObject({ threadMode: "auto", threadId: null });
  });

  test("returns empty array when nothing configured", async () => {
    expect(await getCompWebhooks(makeStore())).toEqual([]);
  });

  test("ignores legacy webhook that fails the regex", async () => {
    const store = makeStore({ "discord.webhookUrl": "https://example.com/not-a-webhook" });
    expect(await getCompWebhooks(store)).toEqual([]);
  });
});

describe("shareCompToWebhooks", () => {
  const webhooks = [
    { id: "w1", name: "A", url: VALID, threadMode: "none", threadId: null },
    { id: "w2", name: "B", url: VALID, threadMode: "none", threadId: null },
    { id: "w3", name: "C", url: "bad-url", threadMode: "none", threadId: null },
  ];

  test("posts to selected ids only", async () => {
    const called = [];
    const out = await shareCompToWebhooks(webhooks, ["w2"], async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual(["w2"]);
    expect(out).toEqual({ success: true, results: [{ id: "w2", name: "B", success: true, error: undefined }] });
  });

  test("empty/missing ids posts to all", async () => {
    const called = [];
    await shareCompToWebhooks(webhooks.slice(0, 2), null, async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual(["w1", "w2"]);
  });

  test("marks invalid-url webhook as failed without calling shareOne", async () => {
    const called = [];
    const out = await shareCompToWebhooks(webhooks, ["w3"], async (w) => { called.push(w.id); return { success: true }; });
    expect(called).toEqual([]);
    expect(out.success).toBe(false);
    expect(out.results[0]).toMatchObject({ id: "w3", success: false });
  });

  test("aggregates partial failure as overall success=true", async () => {
    const out = await shareCompToWebhooks(webhooks.slice(0, 2), ["w1", "w2"], async (w) =>
      w.id === "w1" ? { success: true } : { success: false, error: "boom" });
    expect(out.success).toBe(true);
    expect(out.results.map((r) => r.success)).toEqual([true, false]);
    expect(out.results[1].error).toBe("boom");
  });

  test("unknown ids resolve to no targets and overall failure", async () => {
    const out = await shareCompToWebhooks(webhooks, ["nope"], async () => ({ success: true }));
    expect(out.success).toBe(false);
    expect(out.results).toEqual([]);
  });

  test("WEBHOOK_RE matches discord webhook urls", () => {
    expect(WEBHOOK_RE.test(VALID)).toBe(true);
    expect(WEBHOOK_RE.test("https://discordapp.com/api/webhooks/1/x")).toBe(true);
    expect(WEBHOOK_RE.test("https://example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/compWebhooks.test.js --maxWorkers=2`
Expected: FAIL — `Cannot find module '../../src/main/compWebhooks'`.

- [ ] **Step 3: Implement the module**

```js
// src/main/compWebhooks.js
"use strict";

const crypto = require("node:crypto");

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//;

function makeId() {
  return crypto.randomUUID();
}

// Returns the comp webhook list, migrating the legacy single-webhook settings
// into a one-entry list the first time (then persisting so it's idempotent).
async function getCompWebhooks(store) {
  const existing = await store.getSetting("discord.compWebhooks");
  if (Array.isArray(existing) && existing.length) return existing;

  const url = await store.getSetting("discord.webhookUrl");
  if (url && WEBHOOK_RE.test(url)) {
    const [threadMode, threadId] = await Promise.all([
      store.getSetting("discord.threadMode"),
      store.getSetting("discord.threadId"),
    ]);
    const mode = threadMode || "none";
    const migrated = [{
      id: makeId(),
      name: "Default",
      url,
      threadMode: mode,
      threadId: mode === "custom" && threadId ? threadId : null,
    }];
    await store.setSetting("discord.compWebhooks", migrated);
    return migrated;
  }
  return [];
}

// Posts a comp to multiple webhooks and aggregates the results.
//   webhooks   - full list from getCompWebhooks()
//   webhookIds - ids to target; null/empty means "all"
//   shareOne   - async (webhook) => { success, error? }
async function shareCompToWebhooks(webhooks, webhookIds, shareOne) {
  let targets = webhooks;
  if (Array.isArray(webhookIds) && webhookIds.length) {
    const idSet = new Set(webhookIds);
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
      results.push({ id: w.id, name: w.name, success: !!r.success, error: r.success ? undefined : r.error });
    } catch (err) {
      results.push({ id: w.id, name: w.name, success: false, error: err.message });
    }
  }
  return { success: results.some((r) => r.success), results };
}

module.exports = { WEBHOOK_RE, makeId, getCompWebhooks, shareCompToWebhooks };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/compWebhooks.test.js --maxWorkers=2`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/main/compWebhooks.js tests/unit/compWebhooks.test.js
git commit -m "feat(discord): comp webhook list module with legacy migration and multi-post aggregation"
```

---

### Task 2: Wire `discord:share-comp` + add `discord:list-comp-webhooks` IPC

**Files:**
- Modify: `src/main/index.js:1439-1487` (the `discord:share-comp` handler)
- Modify: `src/main/index.js` (add a new handler next to it)

**Interfaces:**
- Consumes: `getCompWebhooks`, `shareCompToWebhooks` from `./compWebhooks`; existing `shareCompToDiscord` from `./discordWebhook`.
- Produces:
  - IPC `discord:share-comp` now accepts `(compId, webhookIds)` and returns `{ success, results }` (or `{ success:false, error }` on pre-flight failures).
  - IPC `discord:list-comp-webhooks` → returns `Array<{ id, name }>`.

- [ ] **Step 1: Replace the share-comp handler body**

Replace lines 1439-1487 (the whole `handle("discord:share-comp", ...)` block) with:

```js
  handle("discord:share-comp", async (_e, compId, webhookIds) => {
    const { shareCompToDiscord } = require("./discordWebhook");
    const { getCompWebhooks, shareCompToWebhooks } = require("./compWebhooks");

    // 1. Load configured comp webhooks (migrates legacy single webhook if needed)
    const webhooks = await getCompWebhooks(store);
    if (!webhooks.length) {
      return { success: false, error: "Discord webhook URL is not configured or invalid" };
    }

    // 2. Load and validate comp
    const allComps = await compStore.listComps();
    const comp = allComps.find((c) => c.id === compId);
    if (!comp) return { success: false, error: "Comp not found" };
    if (!comp.publishedFileId || !comp.publishedKey || !comp.publishedSlug) {
      return { success: false, error: "Comp must be published before sharing" };
    }

    // 3. Resolve owner for URL construction (matches existing publish pattern)
    const auth = await getAuthRecord();
    const session = await getSession();
    const owner = auth?.onboarding?.targetOwner || session?.viewer?.login;
    if (!owner) return { success: false, error: "GitHub publishing not configured" };
    const repo = auth?.onboarding?.repoName || TARGET_REPO;

    // 4. Build comp URL — use GitHub Pages short redirect
    const { shortUrl } = require("./shortUrl");
    const compUrl = shortUrl(owner, repo, comp.publishedFileId);

    // 5. Load builds and construct maps — use short URLs
    const allBuilds = await store.listBuilds();
    const buildsMap = {};
    const buildUrls = {};
    for (const build of allBuilds) {
      buildsMap[build.id] = build;
      if (build.publishedFileId) {
        buildUrls[build.id] = shortUrl(owner, repo, build.publishedFileId);
      }
    }

    // 6. Post to each selected webhook (or all when webhookIds is empty/omitted)
    return shareCompToWebhooks(webhooks, webhookIds, (w) =>
      shareCompToDiscord(comp, buildsMap, compUrl, buildUrls, w.url, {
        threadMode: w.threadMode || "none",
        threadId: w.threadMode === "custom" ? w.threadId : null,
      })
    );
  });

  handle("discord:list-comp-webhooks", async () => {
    const { getCompWebhooks } = require("./compWebhooks");
    const webhooks = await getCompWebhooks(store);
    return webhooks.map((w) => ({ id: w.id, name: w.name }));
  });
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/main/index.js`
Expected: no output (exit 0).

- [ ] **Step 3: Run the existing suite to confirm nothing broke**

Run: `npx jest tests/unit/discordWebhook.test.js --maxWorkers=2`
Expected: PASS (existing comp embed/share tests unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat(discord): share comps to multiple selected webhooks; add list-comp-webhooks IPC"
```

---

### Task 3: Preload bridge

**Files:**
- Modify: `src/preload/index.js:83` (the `shareCompToDiscord` line)

**Interfaces:**
- Consumes: IPC `discord:share-comp`, `discord:list-comp-webhooks`.
- Produces: `window.desktopApi.shareCompToDiscord(compId, webhookIds)` and `window.desktopApi.listCompWebhooks()`.

- [ ] **Step 1: Update the bridge**

Replace line 83:

```js
  shareCompToDiscord: (compId) => ipcRenderer.invoke("discord:share-comp", compId),
```

with:

```js
  shareCompToDiscord: (compId, webhookIds) => ipcRenderer.invoke("discord:share-comp", compId, webhookIds),
  listCompWebhooks: () => ipcRenderer.invoke("discord:list-comp-webhooks"),
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/preload/index.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(discord): expose webhookIds + listCompWebhooks over preload"
```

---

### Task 4: Settings UI — comp webhook list editor

**Files:**
- Modify: `src/renderer/modules/settings-modal.js` (HTML at lines 82-93; `_el` map ~153-157; listeners ~184-193; load at 211-229; `_save` at 570-627)
- Modify: `src/renderer/styles/settings-modal.css` (append new rules)

**Interfaces:**
- Consumes: `window.desktopApi.getSetting("discord.compWebhooks")`, `setSetting`, `WEBHOOK_RE` (already defined at top of file).
- Produces: persisted `discord.compWebhooks` array. No exported API change.

- [ ] **Step 1: Replace the comp webhook subsection HTML**

Replace lines 82-93 (the comp webhook `<div class="settings-modal__subsection">…</div>`, i.e. the block containing `id="sm-webhook-url"` through its closing `</div>` before the Build Webhook subsection) with:

```html
          <div class="settings-modal__subsection">
            <label class="settings-modal__sublabel">Comp Webhooks</label>
            <div id="sm-comp-webhooks"></div>
            <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-add-comp-webhook" type="button">+ Add Webhook</button>
          </div>
```

- [ ] **Step 2: Update the `_el` map**

In the `_el = { ... }` object (around lines 153-157), remove the four comp-only entries `webhookUrl`, `webhookError`, `threadMode`, `threadId`, `threadError` and replace with:

```js
    compWebhooks:      document.getElementById("sm-comp-webhooks"),
    addCompWebhook:    document.getElementById("sm-add-comp-webhook"),
```

(Leave all `build*` entries and everything else intact.)

- [ ] **Step 3: Replace comp webhook listeners**

Remove the two comp-webhook listeners (the `_el.webhookUrl.addEventListener` line and the `_el.threadId.addEventListener` line, ~184-185) and the comp `_el.threadMode.addEventListener("change", …)` block (~190-193). Add, right after the `const _debouncedSave = _debounce(_save, 600);` line:

```js
  _el.addCompWebhook.addEventListener("click", () => {
    _compWebhooks.push({ id: _newWebhookId(), name: "", url: "", threadMode: "none", threadId: null });
    _renderCompWebhooks();
    _saveCompWebhooks();
  });
```

- [ ] **Step 4: Add module state + render/save helpers**

Near the top of the file, after `let _callbacks = {};` (line 12), add:

```js
let _compWebhooks = [];
const _debouncedSaveWebhooks = null; // assigned in init; see below
```

Then add these functions (place them just above `async function _save() {`):

```js
function _newWebhookId() {
  return "wh-" + Math.abs(Date.now() ^ (Math.floor(Math.random() * 1e9))).toString(36);
}

function _renderCompWebhooks() {
  const c = _el.compWebhooks;
  if (!_compWebhooks.length) {
    c.innerHTML = `<p class="settings-modal__hint">No webhooks yet. Add one to share comps to Discord.</p>`;
    return;
  }
  c.innerHTML = _compWebhooks.map((w) => {
    const mode = w.threadMode || "none";
    const hidden = mode === "custom" ? "" : " settings-modal__thread-id-input--hidden";
    const checked = (m) => (mode === m ? " checked" : "");
    return `
      <div class="settings-modal__webhook-row" data-id="${escapeHtml(w.id)}">
        <div class="settings-modal__webhook-head">
          <input type="text" class="settings-modal__input settings-modal__webhook-name" data-field="name" placeholder="Name (e.g. WvW Guild)" value="${escapeHtml(w.name || "")}" autocomplete="off" spellcheck="false">
          <button class="settings-modal__btn settings-modal__btn--danger settings-modal__webhook-remove" type="button" title="Remove">✕</button>
        </div>
        <input type="text" class="settings-modal__input" data-field="url" placeholder="https://discord.com/api/webhooks/..." value="${escapeHtml(w.url || "")}" autocomplete="off" spellcheck="false">
        <span class="settings-modal__error" data-field="url-error"></span>
        <div class="settings-modal__thread-inline" data-field="thread-mode">
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="none"${checked("none")}><span>Channel</span></label>
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="auto"${checked("auto")}><span>New Post</span></label>
          <label class="settings-modal__pill"><input type="radio" name="wh-mode-${escapeHtml(w.id)}" value="custom"${checked("custom")}><span>Thread ID</span></label>
          <input type="text" class="settings-modal__input settings-modal__thread-id-input${hidden}" data-field="thread-id" placeholder="Thread ID" value="${escapeHtml(w.threadId || "")}" autocomplete="off" spellcheck="false">
        </div>
        <span class="settings-modal__error" data-field="thread-error"></span>
      </div>`;
  }).join("");

  // Wire each row
  c.querySelectorAll(".settings-modal__webhook-row").forEach((row) => {
    const id = row.getAttribute("data-id");
    row.querySelector("[data-field='name']").addEventListener("input", _debouncedSave);
    row.querySelector("[data-field='url']").addEventListener("input", _debouncedSave);
    row.querySelector("[data-field='thread-id']").addEventListener("input", _debouncedSave);
    row.querySelector("[data-field='thread-mode']").addEventListener("change", (e) => {
      const tid = row.querySelector("[data-field='thread-id']");
      tid.classList.toggle("settings-modal__thread-id-input--hidden", e.target.value !== "custom");
      _saveCompWebhooks();
    });
    row.querySelector(".settings-modal__webhook-remove").addEventListener("click", () => {
      _compWebhooks = _compWebhooks.filter((w) => w.id !== id);
      _renderCompWebhooks();
      _saveCompWebhooks();
    });
  });
}

// Reads the current DOM rows, validates, and persists the array.
async function _saveCompWebhooks() {
  const rows = Array.from(_el.compWebhooks.querySelectorAll(".settings-modal__webhook-row"));
  const next = [];
  for (const row of rows) {
    const id = row.getAttribute("data-id");
    const name = row.querySelector("[data-field='name']").value.trim();
    const url = row.querySelector("[data-field='url']").value.trim();
    const mode = row.querySelector("[data-field='thread-mode'] input:checked")?.value || "none";
    const threadId = row.querySelector("[data-field='thread-id']").value.trim();
    const urlErr = row.querySelector("[data-field='url-error']");
    const threadErr = row.querySelector("[data-field='thread-error']");
    urlErr.textContent = "";
    threadErr.textContent = "";

    if (url && !WEBHOOK_RE.test(url)) { urlErr.textContent = "Must be a Discord webhook URL"; return; }
    if (mode === "custom" && !threadId) { threadErr.textContent = "Thread ID is required"; return; }
    if (mode === "custom" && !/^\d+$/.test(threadId)) { threadErr.textContent = "Must be a numeric Discord ID"; return; }

    next.push({ id, name, url, threadMode: mode, threadId: mode === "custom" ? threadId : null });
  }
  _compWebhooks = next;
  try {
    await window.desktopApi.setSetting("discord.compWebhooks", next);
    _showSaved();
  } catch {
    _el.saveStatus.textContent = "Save failed — please try again";
    _el.saveStatus.className = "settings-modal__save-status settings-modal__save-status--error";
  }
}
```

- [ ] **Step 5: Load comp webhooks on open**

In `openSettingsModal()` (lines 211-229): remove `discord.webhookUrl`, `discord.threadMode`, `discord.threadId` from the `Promise.all` destructure and add `discord.compWebhooks`. Replace the "Comp webhook" population block (lines 221-229) with:

```js
  // Comp webhooks
  _compWebhooks = Array.isArray(compWebhooks) ? compWebhooks.map((w) => ({ ...w })) : [];
  _renderCompWebhooks();
```

The updated `Promise.all` (keep build/themed keys):

```js
  const [compWebhooks, buildWebhookUrl, buildThreadMode, buildThreadId, themedBuilds] = await Promise.all([
    window.desktopApi.getSetting("discord.compWebhooks"),
    window.desktopApi.getSetting("discord.buildWebhookUrl"),
    window.desktopApi.getSetting("discord.buildThreadMode"),
    window.desktopApi.getSetting("discord.buildThreadId"),
    window.desktopApi.getSetting("appearance.themedBuildPages"),
  ]);
```

- [ ] **Step 6: Drop comp keys from `_save`**

In `_save()` (lines 570-627): remove the comp-webhook reads (`url`, `mode`, `threadId`), the comp URL/thread validation blocks, and the three comp `setSetting` calls (`discord.webhookUrl`, `discord.threadMode`, `discord.threadId`). `_save` keeps handling only the **build** webhook. Resulting `_save`:

```js
async function _save() {
  const buildUrl = _el.buildWebhookUrl.value.trim();
  const bMode = _el.buildThreadMode.querySelector("input:checked")?.value || "none";
  const bThreadId = _el.buildThreadId.value.trim();

  if (buildUrl && !WEBHOOK_RE.test(buildUrl)) {
    _el.buildWebhookError.textContent = "Must be a Discord webhook URL";
    return;
  }
  if (bMode === "custom" && !bThreadId) {
    _el.buildThreadError.textContent = "Thread ID is required";
    return;
  }
  if (bMode === "custom" && !/^\d+$/.test(bThreadId)) {
    _el.buildThreadError.textContent = "Must be a numeric Discord ID";
    return;
  }

  _el.buildWebhookError.textContent = "";
  _el.buildThreadError.textContent = "";

  try {
    await Promise.all([
      window.desktopApi.setSetting("discord.buildWebhookUrl", buildUrl || null),
      window.desktopApi.setSetting("discord.buildThreadMode", bMode),
      window.desktopApi.setSetting("discord.buildThreadId", bMode === "custom" ? bThreadId : null),
    ]);
    _showSaved();
  } catch (err) {
    _el.saveStatus.textContent = "Save failed — please try again";
    _el.saveStatus.className = "settings-modal__save-status settings-modal__save-status--error";
  }
}
```

Also: in the `_debouncedSave` usage, the comp rows call `_debouncedSave` (which calls `_save` → build only) on input. That won't persist comp rows. Fix: change the row input listeners in Step 4 to use a debounced comp save. Add near the other `const _debouncedSave = _debounce(_save, 600);` line:

```js
  const _debouncedSaveWebhooks = _debounce(_saveCompWebhooks, 600);
```

and in `_renderCompWebhooks` replace the three `_debouncedSave` row-input listeners with `_debouncedSaveWebhooks`. (Because `_renderCompWebhooks` references `_debouncedSaveWebhooks`, declare it at module scope: replace the earlier `const _debouncedSaveWebhooks = null;` placeholder from Step 4 with `let _debouncedSaveWebhooks = () => {};` and assign it in init: `_debouncedSaveWebhooks = _debounce(_saveCompWebhooks, 600);`.)

- [ ] **Step 7: Append CSS**

Add to `src/renderer/styles/settings-modal.css`:

```css
.settings-modal__webhook-row {
  border: 1px solid var(--border, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.settings-modal__webhook-head {
  display: flex;
  gap: 8px;
  align-items: center;
}
.settings-modal__webhook-name { flex: 1; }
.settings-modal__webhook-remove {
  flex: 0 0 auto;
  padding: 4px 10px;
}
```

- [ ] **Step 8: Manual verify in the app**

Run the app (`npm run dev` or the project's run skill). Open Settings → Discord. Confirm:
- Existing single webhook (if any) appears as one "Default" row (migration).
- "+ Add Webhook" adds a row; name/url/thread mode/thread id persist after closing/reopening Settings.
- Invalid URL shows the inline error and blocks save.
- Remove deletes the row and persists.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/modules/settings-modal.js src/renderer/styles/settings-modal.css
git commit -m "feat(discord): settings UI for managing multiple comp webhooks"
```

---

### Task 5: Comp share — multi-select webhook picker

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js:1299-1322` (the embed share handler)
- Modify: `src/renderer/styles/comps.css` (append picker styles)

**Interfaces:**
- Consumes: `window.desktopApi.listCompWebhooks()`, `window.desktopApi.shareCompToDiscord(compId, webhookIds)`, existing `showDiscordStatus(msg, isError)` and `flashItem`.
- Produces: no exported API change.

- [ ] **Step 1: Add a picker helper**

Add this function near the top-level helpers of `comp-detail.js` (e.g. just after `showDiscordStatus` at line ~135). It renders a lightweight overlay and resolves to the chosen ids (or `null` if cancelled):

```js
// Multi-select webhook picker. Resolves to an array of selected ids, or null if cancelled.
function pickCompWebhooks(webhooks) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "comp-webhook-picker-overlay";
    overlay.innerHTML = `
      <div class="comp-webhook-picker" role="dialog" aria-label="Choose webhooks">
        <div class="comp-webhook-picker__title">Share to which Discord webhook(s)?</div>
        <div class="comp-webhook-picker__list">
          ${webhooks.map((w) => `
            <label class="comp-webhook-picker__item">
              <input type="checkbox" value="${w.id}" checked>
              <span>${escapeHtml(w.name || "(unnamed)")}</span>
            </label>`).join("")}
        </div>
        <div class="comp-webhook-picker__actions">
          <button class="comp-webhook-picker__btn" data-act="cancel" type="button">Cancel</button>
          <button class="comp-webhook-picker__btn comp-webhook-picker__btn--primary" data-act="post" type="button">Post</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    overlay.querySelector("[data-act='cancel']").addEventListener("click", () => close(null));
    overlay.querySelector("[data-act='post']").addEventListener("click", () => {
      const ids = Array.from(overlay.querySelectorAll("input[type='checkbox']:checked")).map((cb) => cb.value);
      if (!ids.length) return; // require at least one
      close(ids);
    });
  });
}
```

Confirm `escapeHtml` is imported in this file; if not, add it to the existing import from `../utils.js`.

- [ ] **Step 2: Replace the embed share handler body**

Replace the `embedBtn?.addEventListener("click", async () => { … })` block (lines 1299-1322) with:

```js
    embedBtn?.addEventListener("click", async () => {
      const webhooks = await window.desktopApi.listCompWebhooks();
      if (!webhooks || !webhooks.length) {
        showDiscordStatus("Add a Discord webhook in Settings first", true);
        return;
      }

      let webhookIds;
      if (webhooks.length === 1) {
        webhookIds = [webhooks[0].id];
      } else {
        webhookIds = await pickCompWebhooks(webhooks);
        if (!webhookIds) return; // cancelled
      }

      embedBtn.disabled = true;
      embedBtn.innerHTML = "Sharing...";
      try {
        const result = await window.desktopApi.shareCompToDiscord(comp.id, webhookIds);
        if (result.success) {
          const failed = (result.results || []).filter((r) => !r.success);
          flashItem(embedBtn, embedBtnDefault);
          showDiscordStatus(failed.length
            ? `Shared, but ${failed.length} failed: ${failed.map((r) => r.name).join(", ")}`
            : "Shared to Discord!", failed.length > 0);
        } else {
          const msg = (result.results && result.results.length)
            ? result.results.map((r) => `${r.name}: ${r.error}`).join("; ")
            : (result.error || "Failed to share");
          showDiscordStatus(msg, true);
          embedBtn.innerHTML = embedBtnDefault;
        }
      } catch (err) {
        showDiscordStatus(err.message || "Failed to share", true);
        embedBtn.innerHTML = embedBtnDefault;
      } finally {
        embedBtn.disabled = false;
      }
    });
```

- [ ] **Step 3: Append picker CSS**

Add to `src/renderer/styles/comps.css`:

```css
.comp-webhook-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.comp-webhook-picker {
  background: var(--bg-elevated, #1e1e24);
  border: 1px solid var(--border, rgba(255,255,255,0.12));
  border-radius: 10px;
  padding: 16px;
  min-width: 280px;
  max-width: 360px;
}
.comp-webhook-picker__title { font-weight: 600; margin-bottom: 10px; }
.comp-webhook-picker__list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
.comp-webhook-picker__item { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.comp-webhook-picker__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.comp-webhook-picker__btn { padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.comp-webhook-picker__btn--primary { background: var(--accent, #c89848); color: #1a1a1a; font-weight: 600; }
```

- [ ] **Step 4: Manual verify in the app**

With 2+ webhooks configured, share a published comp:
- Picker appears with all checked → Post sends to all selected; toast confirms.
- Uncheck one → only checked ones receive it.
- With exactly 1 webhook configured → no picker, posts directly.
- With 0 webhooks → toast prompts to configure in Settings.
- Verify the embed lands in each target Discord channel/thread.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/styles/comps.css
git commit -m "feat(discord): multi-select webhook picker when sharing a comp"
```

---

### Task 6: Full regression + finish

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all suites pass (including the new `compWebhooks.test.js` and unchanged `discordWebhook.test.js`).

- [ ] **Step 2: Syntax check changed main/preload files**

Run: `node --check src/main/index.js && node --check src/main/compWebhooks.js && node --check src/preload/index.js`
Expected: exit 0.

- [ ] **Step 3: Final manual smoke**

Confirm the local-api path still works: `POST /comps/:id/share-discord` posts to **all** configured comp webhooks (no UI selection), since the handler receives no `webhookIds`.

---

## Self-Review

**Spec coverage:**
- Data model `discord.compWebhooks` + entry shape → Task 1.
- Lazy migration from legacy keys → Task 1 (`getCompWebhooks`).
- `discord:list-comp-webhooks` IPC + changed `discord:share-comp(compId, webhookIds)` + aggregate result → Task 2.
- Preload bridge → Task 3.
- Settings list editor (name/url/thread per entry, add/remove, validation, auto-save) → Task 4.
- Share-time multi-select picker (0/1/2+ behavior, all-checked default) → Task 5.
- Local API posts to all → Task 2 (no webhookIds) + Task 6 Step 3.
- Builds unchanged → no task touches `discord.buildWebhookUrl` logic beyond leaving it in `_save`.
- Testing → Task 1 unit tests + Task 6 regression.

**Placeholder scan:** No TBD/TODO; every code step shows full code.

**Type consistency:** `getCompWebhooks(store)`, `shareCompToWebhooks(webhooks, webhookIds, shareOne)`, result `{success, results:[{id,name,success,error}]}`, preload `shareCompToDiscord(compId, webhookIds)` / `listCompWebhooks()`, setting key `discord.compWebhooks`, entry fields `{id,name,url,threadMode,threadId}` — consistent across Tasks 1-5.
