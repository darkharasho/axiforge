# Publish on Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saving a build or comp publishes it in the background, so shared links show the latest save within seconds. The Publish button becomes a "Copy link" status button.

**Architecture:** The main process gets a persistent, debounced `PublishQueue` (`src/main/publishQueue.js`). It feeds rounds of up to 50 items to a batch publisher (`src/main/publishBatch.js`), which makes one commit per owner and replaces the bodies of `publishBuildImpl`/`publishCompImpl`. The save handlers decide whether to enqueue (`src/main/autoPublish.js`). The viewer reads data pinned to the newest commit SHA (`src/site/rawBase.js`), so a new commit shows without the 5-minute raw CDN lag. The renderer draws one pure state function, `publishButtonState`, onto the editor and comp board buttons.

**Tech Stack:** Electron (main CJS, renderer ESM through Vite), Jest (node and jsdom environments, babel-jest for ESM under `src/renderer`/`src/site`), GitHub Git Data API (already wrapped in `src/main/githubApi.js`).

**Spec:** `docs/superpowers/specs/2026-10-07-publish-on-save-design.md`

## Global Constraints

- Debounce: a round starts 5 s after the last enqueue and no later than 30 s after the first enqueue since the previous round.
- Up to 50 items per round. One commit per owner per round. Rounds go through the existing `enqueuePublish` chain.
- Pending set persisted to `userData/publish-queue.json` on every change.
- Backoff on network errors: 30 s, 1 min, 2 min, then every 5 min. `GITHUB_RATE_LIMITED` waits `retryAfterMs`. `GITHUB_UNAUTHORIZED` pauses until sign-in.
- Quit flush: at most 10 s.
- Discord share waits at most 15 s for an in-flight upload.
- Live check: poll `raw.githubusercontent.com/<owner>/axibuilds/<commitSha>/<filePath>` (3 s interval, 90 s timeout). Pages wait (180 s) only for a new `/r/<fileId>` page or `shellChanged`.
- Viewer SHA lookup: `GET https://api.github.com/repos/<owner>/<repo>/commits/main`, `Accept: application/vnd.github.sha`, `cache: "no-store"`, 3 s timeout, body must match `/^[0-9a-f]{40}$/`, fall back to `/main/`, honor `remoteBase`, memoize per owner per page load.
- Settings key for the bulk prompt: `bulkPublishPrompted`.
- Prompt copy (verbatim from the spec):
  - Bulk prompt: "**Publish your library?** Builds and comps now publish automatically when you save. You have N that have never been published. Publish them all now? *(It runs in the background, 50 at a time.)*" Buttons: [Publish all] [Not now].
  - Foreign-owner prompt: "**This build was published by @owner.** Publish your own copy? Your link will point at your account; their link keeps working but stops updating." Buttons: [Publish my copy] [Keep theirs].
- Jest only. Run single files with `npm test -- <path>`. Do not run Playwright/E2E. Vitest is not used here.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Deviations from the spec (decided while planning; flag in review)

1. **`publishChoice` is stored by the queue, not on the build record.**
   - The spec says "stored on the build". A build field would have to survive `normalizeBuild` (an allowlist that drops unknown fields), stay out of `BUILD_NON_CONTENT`, stay out of team sync (`BUILD_LOCAL_FIELDS`), and be carried across every upsert.
   - Instead the queue persists `choices: {"build:<id>": "mine"|"theirs"}` in `publish-queue.json`. It is the only writer, it lives on this machine (which is correct for a personal choice), and nothing about the build's content changes.
2. **The owner choice also applies to comps.** `publishCompImpl` already throws `PUBLISHED_BY_OTHER` for comps, so comps get the same prompt.
3. **`publishButtonState` takes one object**, `{ queueItem, receipt, connection, now }`. `publishChoice` reaches it through the queue snapshot (`declined`) instead of a third argument.
4. **No CJS mirror of `resolvePinnedBase`.** Nothing CommonJS reads the viewer's data base. `src/main/axiLinkImport.js` `dataBases()` is a separate desktop import path; it goes to BACKLOG.
5. **Untitled builds are no longer renamed in the store when they publish.** The page uses the default name, but the record is untouched. Renaming in the background would fight the open editor on every save.
6. **"Connected" means signed in with GitHub *and* `onboarding.repoReady || forkReady`.** That matches today's `canPublish` rule. A personal-target item without it reports `disconnected`. Team-target items need only the session.

## Review Focus

1. **An item deleted or trashed while pending.** Its round must drop it quietly. It must not sit in `failed` forever or block the round. Test: Task 3, "a record that no longer exists is dropped, not failed".
2. **An untitled build saved over and over.** The publish must not write a new title into the store, because that would overwrite the editor's state on the next save. Test: Task 3, "an untitled build publishes under its default name without renaming the record".
3. **Quit while a round hangs** (no network, or an update restart). `before-quit` must still exit within 10 s. Test: Task 1, "flushForQuit gives up after 10 s and keeps the item persisted".
4. **A missing, corrupt or hand-edited `publish-queue.json`.** Launch must not fail. Valid keys are kept and garbage is ignored. Test: Task 1, "load survives garbage and keeps only valid keys".
5. **A never-published build saved in the same round as a comp that contains it.** Both must use one fileId. Otherwise the comp links a file that the build's own receipt doesn't name. Test: Task 3, "a member shared by two comps and queued itself is uploaded once".

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/publishQueue.js` | create | Pending set, debounce, rounds, backoff, pause, waiters, persistence, owner choices, status snapshot |
| `src/main/autoPublish.js` | create | Pure decision: should this save enqueue, skip, or ask about the owner; bulk candidates |
| `src/main/publishBatch.js` | create | One round: group by owner, prepare files, one commit per owner, live check, receipts |
| `src/main/index.js` | modify | Construct the queue, hook the saves, add IPC, replace the old publish bodies, quit flush, resume triggers, Discord share wait |
| `src/preload/index.js` | modify | Bridge the new IPC and the two events |
| `src/web/webApi/stubs.js` | modify | No-op the new bridge methods in the web Playground |
| `src/site/rawBase.js` | modify | `pinnedRawBase`, `resolvePinnedBase` |
| `src/site/comp-members.js` | modify | `baseForOwner` option |
| `src/site/main.js` | modify | Use pinned bases |
| `src/renderer/modules/publish-button.js` | create | `publishButtonState`, `applyPublishButton`, `runPublishButtonAction`, helpers |
| `src/renderer/modules/publish-prompts.js` | create | Bulk prompt and owner-choice prompt |
| `src/renderer/modules/publish-actions.js` | create | Live deps (desktopApi, modal, toast, settings, login) for the button |
| `src/renderer/modules/share-gate.js` | modify | Queue-aware tooltips |
| `src/renderer/modules/state.js` | modify | `publishQueue` slice |
| `src/renderer/modules/render-pages.js` | modify | Editor button render |
| `src/renderer/renderer.js` | modify | Status listener, click handler, prompt hooks |
| `src/renderer/index.html` | modify | Button label |
| `src/renderer/styles/buttons.css` | modify | Button tones and icons |
| `src/renderer/modules/comps/comp-detail.js` | modify | Comp board button |
| `src/renderer/modules/library/context-menu.js`, `library.js` | modify | "Copy link" entry |
| `docs/BACKLOG.md` | modify | Two out-of-scope entries |

---

### Task 1: PublishQueue

**Files:**
- Create: `src/main/publishQueue.js`
- Test: `tests/unit/publishQueue.test.js`

**Interfaces:**
- Consumes: nothing (all I/O injected).
- Produces:
  - `class PublishQueue({ runRound, load, persist, emit, now, setTimeoutImpl, clearTimeoutImpl, debounceMs, maxDelayMs, batchSize })`
    - `runRound(items: {kind,id}[]) → Promise<{ results: {kind,id,ok:boolean,error?:Error,pagesUrl?,slug?,fileId?,changed?,skippedForeignBuilds?,skipped?}[] }>` may also reject; a rejection applies to every item in the round.
    - `load() → Promise<object|null>`, `persist(data) → Promise`, `emit(snapshot)`.
  - Methods:
    - `load(): Promise<void>`
    - `enqueue(kind, id)`
    - `enqueueMany(items)`
    - `publishNow(kind, id): Promise`
    - `flush(): Promise`
    - `resume(): Promise`
    - `awaitPublished(kind, id, { timeoutMs = 15000 }): Promise<result|null>`
    - `flushForQuit(timeoutMs = 10000): Promise<void>`
    - `stop()`
    - `hasPending(): boolean`
    - `choiceOf(kind, id): "mine"|"theirs"|null`
    - `setChoice(kind, id, choice)`
    - `markNeedsChoice(kind, id, owner): boolean`
    - `snapshot(): { items: {[key]: {state, error?, reason?, retryAt?, owner?}}, paused: null|"unauthorized"|"disconnected", published: string[] }`
  - `classifyPublishError(err) → "transient"|"rate-limited"|"unauthorized"|"disconnected"|"needs-choice"|"fatal"`
  - Constants: `DEBOUNCE_MS=5000`, `MAX_DELAY_MS=30000`, `BATCH_SIZE=50`, `BACKOFF_MS=[30000,60000,120000,300000]`.
  - Item states:
    - `queued | publishing | waiting | failed | unauthorized | disconnected | declined`.
    - `current` is not emitted. The renderer reads it from the receipt when an item is absent from the snapshot.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/publishQueue.test.js`:

```js
"use strict";

const { PublishQueue, classifyPublishError, BACKOFF_MS } = require("../../src/main/publishQueue");

const adv = (ms) => jest.advanceTimersByTimeAsync(ms);
const ok = async (items) => ({ results: items.map((i) => ({ ...i, ok: true })) });
const coded = (message, extra) => Object.assign(new Error(message), extra);
const offline = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeQueue(opts = {}) {
  const rounds = [];
  const emitted = [];
  const store = { data: null };
  const impl = opts.runRound || ok;
  const runRound = jest.fn(async (items) => {
    rounds.push(items.map((i) => `${i.kind}:${i.id}`));
    return impl(items);
  });
  const q = new PublishQueue({
    runRound,
    persist: async (d) => { store.data = d; },
    emit: (s) => emitted.push(s),
    load: opts.load,
  });
  return { q, rounds, emitted, store, runRound };
}

beforeEach(() => { jest.useFakeTimers({ now: 0 }); });
afterEach(() => { jest.useRealTimers(); });

describe("debounce", () => {
  test("a round starts 5 s after the last enqueue", async () => {
    const { q, rounds } = makeQueue();
    q.enqueue("build", "a");
    await adv(4999);
    expect(rounds).toHaveLength(0);
    await adv(1);
    expect(rounds).toEqual([["build:a"]]);
  });

  test("another save restarts the quiet period", async () => {
    const { q, rounds } = makeQueue();
    q.enqueue("build", "a");
    await adv(4000);
    q.enqueue("comp", "c");
    await adv(4999);
    expect(rounds).toHaveLength(0);
    await adv(1);
    expect(rounds).toEqual([["build:a", "comp:c"]]);
  });

  test("steady saving still publishes 30 s after the first save", async () => {
    const { q, rounds } = makeQueue();
    q.enqueue("build", "a");
    for (let i = 0; i < 7; i += 1) {
      await adv(4000);
      q.enqueue("build", "a");
    }
    // t = 28 000: the last enqueue may only wait until 30 000.
    await adv(1999);
    expect(rounds).toHaveLength(0);
    await adv(1);
    expect(rounds).toHaveLength(1);
  });
});

describe("rounds", () => {
  test("more than 50 pending items run in back-to-back rounds of at most 50", async () => {
    const { q, rounds } = makeQueue();
    for (let i = 0; i < 120; i += 1) q.enqueue("build", `b${i}`);
    await adv(5000);
    expect(rounds.map((r) => r.length)).toEqual([50, 50, 20]);
  });

  test("a save made while its round is uploading stays pending for the next round", async () => {
    const gate = deferred();
    const { q, rounds } = makeQueue({ runRound: async (items) => { await gate.promise; return ok(items); } });
    q.enqueue("build", "a");
    await adv(5000);
    expect(rounds).toEqual([["build:a"]]);
    expect(q.snapshot().items["build:a"].state).toBe("publishing");
    q.enqueue("build", "a");
    q.enqueue("build", "b");
    gate.resolve();
    await adv(0);
    expect(q.snapshot().items["build:a"].state).toBe("queued");
    await adv(5000);
    expect(rounds[1].sort()).toEqual(["build:a", "build:b"]);
  });

  test("a successful item leaves the snapshot and is reported as published once", async () => {
    const { q, emitted } = makeQueue();
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot().items["build:a"]).toBeUndefined();
    const withPublished = emitted.filter((s) => s.published.length);
    expect(withPublished).toHaveLength(1);
    expect(withPublished[0].published).toEqual(["build:a"]);
  });

  test("an item that fails to prepare fails alone; the rest publish", async () => {
    const { q } = makeQueue({
      runRound: async () => ({ results: [
        { kind: "build", id: "a", ok: false, error: new Error("Build must have a profession selected.") },
        { kind: "build", id: "b", ok: true },
      ] }),
    });
    q.enqueue("build", "a");
    q.enqueue("build", "b");
    await adv(5000);
    expect(q.snapshot().items).toEqual({
      "build:a": { state: "failed", error: "Build must have a profession selected." },
    });
    await expect(q.awaitPublished("build", "a")).rejects.toThrow(/profession/);
    q.enqueue("build", "a");
    expect(q.snapshot().items["build:a"].state).toBe("queued");
  });

  test("an item the round did not report is treated as failed", async () => {
    const { q } = makeQueue({ runRound: async () => ({ results: [] }) });
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot().items["build:a"].state).toBe("failed");
  });
});

describe("failures", () => {
  test("network errors back off 30 s, 1 min, 2 min, then every 5 min", async () => {
    const { q, rounds } = makeQueue({ runRound: async () => { throw offline(); } });
    q.enqueue("build", "a");
    await adv(5000);
    expect(rounds).toHaveLength(1);
    const item = q.snapshot().items["build:a"];
    expect(item).toMatchObject({ state: "waiting", reason: "offline", retryAt: 5000 + 30000 });
    for (const [i, ms] of [...BACKOFF_MS, 300000].entries()) {
      await adv(ms - 1);
      expect(rounds).toHaveLength(i + 1);
      await adv(1);
      expect(rounds).toHaveLength(i + 2);
    }
  });

  test("a successful round resets the backoff", async () => {
    let fail = true;
    const { q, rounds } = makeQueue({ runRound: async (items) => { if (fail) throw offline(); return ok(items); } });
    q.enqueue("build", "a");
    await adv(5000);
    fail = false;
    await adv(30000);
    expect(rounds).toHaveLength(2);
    fail = true;
    q.enqueue("build", "b");
    await adv(5000);
    expect(q.snapshot().items["build:b"].retryAt).toBe(Date.now() + 30000);
  });

  test("a rate limit waits retryAfterMs", async () => {
    const { q, rounds } = makeQueue({
      runRound: async () => { throw coded("rate limited", { code: "GITHUB_RATE_LIMITED", retryAfterMs: 90000 }); },
    });
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot().items["build:a"]).toMatchObject({ state: "waiting", reason: "rate-limit", retryAt: 95000 });
    await adv(89999);
    expect(rounds).toHaveLength(1);
    await adv(1);
    expect(rounds).toHaveLength(2);
  });

  test("unauthorized pauses the queue until resume()", async () => {
    let unauthorized = true;
    const { q, rounds } = makeQueue({
      runRound: async (items) => {
        if (unauthorized) throw coded("Bad credentials", { code: "GITHUB_UNAUTHORIZED", status: 401 });
        return ok(items);
      },
    });
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot()).toMatchObject({ paused: "unauthorized", items: { "build:a": { state: "unauthorized" } } });
    q.enqueue("build", "b");
    await adv(600000);
    expect(rounds).toHaveLength(1);
    await expect(q.awaitPublished("build", "a")).rejects.toMatchObject({ code: "GITHUB_UNAUTHORIZED" });
    unauthorized = false;
    await q.resume();
    expect(rounds[1].sort()).toEqual(["build:a", "build:b"]);
    expect(q.snapshot().paused).toBeNull();
  });

  test("disconnected pauses the same way", async () => {
    const { q, rounds } = makeQueue({
      runRound: async () => { throw coded("Set up publishing to publish.", { code: "PUBLISH_DISCONNECTED" }); },
    });
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot().items["build:a"].state).toBe("disconnected");
    await adv(600000);
    expect(rounds).toHaveLength(1);
  });

  test("an item owned by someone else leaves the queue and is declined until a choice", async () => {
    const { q, rounds } = makeQueue({
      runRound: async () => ({ results: [{ kind: "build", id: "a", ok: false, error: new Error("PUBLISHED_BY_OTHER:mate") }] }),
    });
    q.enqueue("build", "a");
    await adv(5000);
    expect(q.snapshot().items["build:a"]).toEqual({ state: "declined", owner: "mate" });
    await adv(600000);
    expect(rounds).toHaveLength(1);
    expect(q.markNeedsChoice("build", "a", "mate")).toBe(false);
  });
});

describe("choices", () => {
  test("markNeedsChoice is true once per item per launch", () => {
    const { q } = makeQueue();
    expect(q.markNeedsChoice("build", "a", "mate")).toBe(true);
    expect(q.markNeedsChoice("build", "a", "mate")).toBe(false);
    expect(q.snapshot().items["build:a"]).toEqual({ state: "declined", owner: "mate" });
  });

  test("a choice is persisted; theirs reads as declined", async () => {
    const { q, store } = makeQueue();
    q.setChoice("build", "a", "theirs");
    q.setChoice("comp", "c", "mine");
    await adv(0);
    expect(store.data.choices).toEqual({ "build:a": "theirs", "comp:c": "mine" });
    expect(q.choiceOf("comp", "c")).toBe("mine");
    expect(q.snapshot().items["build:a"]).toEqual({ state: "declined" });
    expect(q.snapshot().items["comp:c"]).toBeUndefined();
  });
});

describe("persistence", () => {
  test("pending items, failures and choices survive a restart", async () => {
    const first = makeQueue({ runRound: async () => ({ results: [{ kind: "build", id: "x", ok: false, error: new Error("boom") }] }) });
    first.q.enqueue("build", "x");
    await adv(5000);
    first.q.enqueue("build", "a");
    first.q.enqueue("comp", "c");
    first.q.setChoice("build", "z", "mine");
    first.q.stop();
    await adv(0);
    const saved = first.store.data;
    expect(saved.pending.sort()).toEqual(["build:a", "comp:c"]);

    const second = makeQueue({ load: async () => saved });
    await second.q.load();
    expect(second.q.snapshot().items["build:x"]).toEqual({ state: "failed", error: "boom" });
    expect(second.q.choiceOf("build", "z")).toBe("mine");
    await adv(5000);
    expect(second.rounds[0].sort()).toEqual(["build:a", "comp:c"]);
  });

  test("load survives garbage and keeps only valid keys", async () => {
    for (const bad of [null, "garbage", 42, { pending: "nope" }]) {
      const { q } = makeQueue({ load: async () => bad });
      await expect(q.load()).resolves.toBeUndefined();
      expect(q.snapshot().items).toEqual({});
    }
    const thrower = makeQueue({ load: async () => { throw new SyntaxError("Unexpected token"); } });
    await expect(thrower.q.load()).resolves.toBeUndefined();

    const { q } = makeQueue({ load: async () => ({ pending: [123, "nope", "build:", "build:ok", "comp:c1"], choices: { "build:a": "maybe", "build:b": "mine" } }) });
    await q.load();
    expect(Object.keys(q.snapshot().items).sort()).toEqual(["build:ok", "comp:c1"]);
    expect(q.choiceOf("build", "a")).toBeNull();
    expect(q.choiceOf("build", "b")).toBe("mine");
  });
});

describe("awaitPublished", () => {
  test("resolves with the item's result when its round succeeds", async () => {
    const { q } = makeQueue({ runRound: async (items) => ({ results: items.map((i) => ({ ...i, ok: true, pagesUrl: "https://x" })) }) });
    q.enqueue("build", "a");
    const waiting = q.awaitPublished("build", "a");
    await adv(5000);
    await expect(waiting).resolves.toMatchObject({ pagesUrl: "https://x" });
  });

  test("resolves null for an item that is not queued", async () => {
    const { q } = makeQueue();
    await expect(q.awaitPublished("build", "nope")).resolves.toBeNull();
  });

  test("rejects with PUBLISH_TIMEOUT when the round outlasts the timeout", async () => {
    const { q } = makeQueue({ runRound: () => new Promise(() => {}) });
    q.enqueue("build", "a");
    const waiting = q.awaitPublished("build", "a", { timeoutMs: 15000 });
    const assertion = expect(waiting).rejects.toMatchObject({ code: "PUBLISH_TIMEOUT" });
    await adv(15000);
    await assertion;
  });
});

describe("publishNow and resume", () => {
  test("publishNow skips the debounce", async () => {
    const { q, rounds } = makeQueue();
    await q.publishNow("build", "a");
    expect(rounds).toEqual([["build:a"]]);
  });

  test("publishNow skips a network backoff", async () => {
    let fail = true;
    const { q, rounds } = makeQueue({ runRound: async (items) => { if (fail) throw offline(); return ok(items); } });
    q.enqueue("build", "a");
    await adv(5000);
    fail = false;
    await q.publishNow("build", "a");
    expect(rounds).toHaveLength(2);
    expect(q.snapshot().items["build:a"]).toBeUndefined();
  });

  test("resume with nothing to do emits nothing", async () => {
    const { q, emitted } = makeQueue();
    await q.resume();
    expect(emitted).toHaveLength(0);
  });

  test("enqueueMany persists and emits once", async () => {
    const { q, emitted } = makeQueue();
    q.enqueueMany([{ kind: "build", id: "a" }, { kind: "comp", id: "c" }]);
    expect(emitted).toHaveLength(1);
    expect(Object.keys(emitted[0].items).sort()).toEqual(["build:a", "comp:c"]);
  });
});

describe("flushForQuit", () => {
  test("runs a round right away and resolves when it lands", async () => {
    const { q, rounds } = makeQueue();
    q.enqueue("build", "a");
    await q.flushForQuit();
    expect(rounds).toEqual([["build:a"]]);
    expect(q.hasPending()).toBe(false);
  });

  test("flushForQuit gives up after 10 s and keeps the item persisted", async () => {
    const { q, store } = makeQueue({ runRound: () => new Promise(() => {}) });
    q.enqueue("build", "a");
    let done = false;
    q.flushForQuit().then(() => { done = true; });
    await adv(9999);
    expect(done).toBe(false);
    await adv(1);
    expect(done).toBe(true);
    expect(store.data.pending).toEqual(["build:a"]);
  });

  test("with nothing pending it resolves without a round", async () => {
    const { q, runRound } = makeQueue();
    await q.flushForQuit();
    expect(runRound).not.toHaveBeenCalled();
  });
});

describe("classifyPublishError", () => {
  test.each([
    [coded("x", { code: "GITHUB_UNAUTHORIZED" }), "unauthorized"],
    [coded("x", { code: "GITHUB_RATE_LIMITED" }), "rate-limited"],
    [coded("x", { code: "PUBLISH_DISCONNECTED" }), "disconnected"],
    [coded("x", { code: "PUBLISH_NOT_LIVE" }), "transient"],
    [new Error("PUBLISHED_BY_OTHER:mate"), "needs-choice"],
    [offline(), "transient"],
    [coded("x", { code: "ECONNRESET" }), "transient"],
    [coded("wrapped", { cause: offline() }), "transient"],
    [coded("x", { status: 502 }), "transient"],
    [coded("x", { status: 404 }), "fatal"],
    [new Error("Build must have a profession selected."), "fatal"],
  ])("%p → %s", (err, expected) => {
    expect(classifyPublishError(err)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/publishQueue.test.js`
Expected: FAIL with "Cannot find module '../../src/main/publishQueue'".

- [ ] **Step 3: Write the implementation**

Create `src/main/publishQueue.js`:

```js
"use strict";

// Publish on save (docs/superpowers/specs/2026-10-07-publish-on-save-design.md).
// Saved builds and comps wait here until a commit carrying them lands. Rounds
// are debounced like TeamSync.scheduleFlush, hold at most BATCH_SIZE items, and
// never lose one: an item leaves the pending set only when a round publishes
// it, fails it for good, or finds it needs an owner choice first.

const DEBOUNCE_MS = 5000;
const MAX_DELAY_MS = 30000;
const BATCH_SIZE = 50;
const BACKOFF_MS = [30000, 60000, 120000, 300000];
const DEFAULT_AWAIT_MS = 15000;
const QUIT_FLUSH_MS = 10000;
const RATE_LIMIT_DEFAULT_MS = 60000;

const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN",
  "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

const keyOf = (kind, id) => `${kind}:${id}`;
const isKey = (key) => typeof key === "string" && /^(build|comp):./.test(key);
function parseKey(key) {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i), id: key.slice(i + 1) };
}

/** @returns {"transient"|"rate-limited"|"unauthorized"|"disconnected"|"needs-choice"|"fatal"} */
function classifyPublishError(err) {
  const code = err?.code;
  if (code === "GITHUB_UNAUTHORIZED") return "unauthorized";
  if (code === "GITHUB_RATE_LIMITED") return "rate-limited";
  if (code === "PUBLISH_DISCONNECTED") return "disconnected";
  if (code === "PUBLISH_NOT_LIVE") return "transient";
  if (/^PUBLISHED_BY_OTHER:/.test(String(err?.message || ""))) return "needs-choice";
  if (NETWORK_CODES.has(code)) return "transient";
  if (err?.name === "TypeError" && /fetch failed/i.test(String(err?.message || ""))) return "transient";
  if (typeof err?.status === "number" && err.status >= 500) return "transient";
  if (err?.cause && err.cause !== err && classifyPublishError(err.cause) === "transient") return "transient";
  return "fatal";
}

function pausedError(reason) {
  const err = reason === "unauthorized"
    ? new Error("Sign in to GitHub again to publish.")
    : new Error("Set up publishing to publish.");
  err.code = reason === "unauthorized" ? "GITHUB_UNAUTHORIZED" : "PUBLISH_DISCONNECTED";
  return err;
}

class PublishQueue {
  constructor({
    runRound,
    load = async () => null,
    persist = async () => {},
    emit = () => {},
    now = () => Date.now(),
    setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutImpl = (id) => clearTimeout(id),
    debounceMs = DEBOUNCE_MS,
    maxDelayMs = MAX_DELAY_MS,
    batchSize = BATCH_SIZE,
  }) {
    this._runRound = runRound;
    this._loadImpl = load;
    this._persistImpl = persist;
    this._emitImpl = emit;
    this._now = now;
    this._setTimeout = setTimeoutImpl;
    this._clearTimeout = clearTimeoutImpl;
    this._debounceMs = debounceMs;
    this._maxDelayMs = maxDelayMs;
    this._batchSize = batchSize;

    this._pending = new Set();     // keys a commit has yet to carry
    this._failed = new Map();      // key → message; out of pending until re-saved or retried
    this._choices = new Map();     // key → "mine" | "theirs"
    this._needsChoice = new Map(); // key → foreign owner login; asked once per launch
    this._publishing = new Set();  // keys in the round in flight
    this._resaved = new Set();     // keys enqueued again while their round was in flight
    this._timer = null;            // { id, firstAt }: the debounce
    this._retry = null;            // { id, at, reason: "offline" | "rate-limit" }
    this._attempt = 0;             // consecutive rounds with a network failure
    this._paused = null;           // null | "unauthorized" | "disconnected"
    this._running = null;
    this._again = false;
    this._waiters = new Map();     // key → [{ resolve, reject, timer }]
    this._justPublished = [];
    this._saving = Promise.resolve();
  }

  async load() {
    let data = null;
    try {
      data = await this._loadImpl();
    } catch (err) {
      console.warn("[publish-queue] load failed:", err?.message || err);
    }
    const d = data && typeof data === "object" ? data : {};
    for (const key of Array.isArray(d.pending) ? d.pending : []) {
      if (isKey(key)) this._pending.add(key);
    }
    for (const [key, msg] of Object.entries(d.failed && typeof d.failed === "object" ? d.failed : {})) {
      if (isKey(key)) this._failed.set(key, String(msg));
    }
    for (const [key, choice] of Object.entries(d.choices && typeof d.choices === "object" ? d.choices : {})) {
      if (isKey(key) && (choice === "mine" || choice === "theirs")) this._choices.set(key, choice);
    }
    if (this._pending.size) this._schedule();
    if (this._pending.size || this._failed.size || this._choices.size) this._emit();
  }

  enqueue(kind, id) {
    this._add(keyOf(kind, id));
    this._changed();
    this._schedule();
  }

  enqueueMany(items) {
    if (!items.length) return;
    for (const { kind, id } of items) this._add(keyOf(kind, id));
    this._changed();
    this._schedule();
  }

  /** Enqueue and start a round now, skipping the debounce and any network backoff. */
  publishNow(kind, id) {
    this._add(keyOf(kind, id));
    if (this._retry?.reason === "offline") this._clearRetry();
    this._changed();
    return this.flush();
  }

  /** Sign-in, setup, focus or coming online: lift a pause and any network backoff. */
  resume() {
    let changed = false;
    if (this._paused) { this._paused = null; changed = true; }
    if (this._retry?.reason === "offline") { this._clearRetry(); changed = true; }
    if (changed) this._emit();
    return this._pending.size ? this.flush() : Promise.resolve();
  }

  flush() {
    if (this._running) {
      this._again = true;
      return this._running;
    }
    this._clearTimer();
    this._running = this._drain().finally(() => {
      this._running = null;
      if (this._again) {
        this._again = false;
        if (this._pending.size) this.flush();
      }
    });
    return this._running;
  }

  awaitPublished(kind, id, { timeoutMs = DEFAULT_AWAIT_MS } = {}) {
    const key = keyOf(kind, id);
    if (!this._pending.has(key)) {
      if (this._failed.has(key)) return Promise.reject(new Error(this._failed.get(key)));
      return Promise.resolve(null);
    }
    if (this._paused) return Promise.reject(pausedError(this._paused));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = this._setTimeout(() => {
        const list = (this._waiters.get(key) || []).filter((w) => w !== waiter);
        if (list.length) this._waiters.set(key, list); else this._waiters.delete(key);
        const err = new Error("Publishing is taking longer than expected. Try again in a moment.");
        err.code = "PUBLISH_TIMEOUT";
        reject(err);
      }, timeoutMs);
      this._waiters.set(key, [...(this._waiters.get(key) || []), waiter]);
    });
  }

  /** Quit: one round, at most `timeoutMs`; anything unfinished stays persisted. */
  async flushForQuit(timeoutMs = QUIT_FLUSH_MS) {
    if (!this.hasPending()) return;
    this._clearRetry();
    let timer = null;
    const cap = new Promise((resolve) => { timer = this._setTimeout(resolve, timeoutMs); });
    try {
      await Promise.race([this.flush().catch(() => {}), cap]);
    } finally {
      this._clearTimeout(timer);
      await this._saving.catch(() => {});
    }
  }

  stop() {
    this._clearTimer();
    this._clearRetry();
  }

  hasPending() {
    return this._pending.size > 0 && !this._paused;
  }

  choiceOf(kind, id) {
    return this._choices.get(keyOf(kind, id)) || null;
  }

  setChoice(kind, id, choice) {
    const key = keyOf(kind, id);
    if (choice !== "mine" && choice !== "theirs") throw new Error(`Unknown publish choice: ${choice}`);
    this._choices.set(key, choice);
    this._needsChoice.delete(key);
    this._changed();
  }

  /** True the first time this launch that an item owned by someone else asks for a choice. */
  markNeedsChoice(kind, id, owner) {
    const key = keyOf(kind, id);
    if (this._needsChoice.has(key)) return false;
    this._needsChoice.set(key, owner || "");
    this._emit();
    return true;
  }

  snapshot() {
    const items = {};
    for (const [key, choice] of this._choices) if (choice === "theirs") items[key] = { state: "declined" };
    for (const [key, owner] of this._needsChoice) items[key] = { state: "declined", owner };
    for (const [key, error] of this._failed) items[key] = { state: "failed", error };
    for (const key of this._pending) {
      if (this._publishing.has(key)) items[key] = { state: "publishing" };
      else if (this._paused) items[key] = { state: this._paused };
      else if (this._retry) items[key] = { state: "waiting", reason: this._retry.reason, retryAt: this._retry.at };
      else items[key] = { state: "queued" };
    }
    return { items, paused: this._paused, published: [...this._justPublished] };
  }

  // ── internals ──────────────────────────────────────────────────────────

  _add(key) {
    this._failed.delete(key);
    this._needsChoice.delete(key);
    this._pending.add(key);
    if (this._publishing.has(key)) this._resaved.add(key);
  }

  _schedule() {
    if (this._paused || this._retry) return;
    const now = this._now();
    const firstAt = this._timer ? this._timer.firstAt : now;
    if (this._timer) this._clearTimeout(this._timer.id);
    const wait = Math.max(0, Math.min(this._debounceMs, firstAt + this._maxDelayMs - now));
    const id = this._setTimeout(() => {
      this._timer = null;
      this.flush();
    }, wait);
    this._timer = { id, firstAt };
  }

  _clearTimer() {
    if (!this._timer) return;
    this._clearTimeout(this._timer.id);
    this._timer = null;
  }

  _setRetry(ms, reason) {
    this._clearRetry();
    const id = this._setTimeout(() => {
      this._retry = null;
      this._emit();
      this.flush();
    }, ms);
    this._retry = { id, at: this._now() + ms, reason };
  }

  _clearRetry() {
    if (!this._retry) return;
    this._clearTimeout(this._retry.id);
    this._retry = null;
  }

  async _drain() {
    // Items due now. A save made mid-round has its own debounce timer, so it
    // waits for a quiet period instead of chasing every keystroke.
    const due = new Set(this._pending);
    while (!this._paused && !this._retry) {
      const batch = [...due].filter((k) => this._pending.has(k)).slice(0, this._batchSize);
      if (!batch.length) return;
      for (const k of batch) due.delete(k);
      await this._round(batch);
    }
  }

  async _round(batch) {
    this._publishing = new Set(batch);
    this._resaved.clear();
    this._emit();
    let results;
    try {
      results = (await this._runRound(batch.map(parseKey)))?.results || [];
    } catch (err) {
      results = batch.map((k) => ({ ...parseKey(k), ok: false, error: err }));
    }
    const byKey = new Map(results.map((r) => [keyOf(r.kind, r.id), r]));
    let wait = 0;
    let waitReason = null;
    let transient = false;
    for (const key of batch) {
      const r = byKey.get(key) || { ok: false, error: new Error("The publish round did not report this item.") };
      if (r.ok) {
        if (!this._resaved.has(key)) this._pending.delete(key);
        this._justPublished.push(key);
        this._settle(key, null, r);
        continue;
      }
      const cls = classifyPublishError(r.error);
      if (cls === "transient") {
        transient = true;
        continue;
      }
      if (cls === "rate-limited") {
        const ms = Number(r.error?.retryAfterMs) || RATE_LIMIT_DEFAULT_MS;
        if (ms > wait) { wait = ms; waitReason = "rate-limit"; }
        continue;
      }
      if (cls === "unauthorized" || cls === "disconnected") {
        this._paused = cls;
        this._settle(key, pausedError(cls));
        continue;
      }
      this._pending.delete(key);
      if (cls === "needs-choice") {
        this._needsChoice.set(key, String(r.error.message).slice("PUBLISHED_BY_OTHER:".length));
      } else {
        this._failed.set(key, r.error?.message || String(r.error));
      }
      this._settle(key, r.error);
    }
    if (transient) {
      const ms = BACKOFF_MS[Math.min(this._attempt, BACKOFF_MS.length - 1)];
      this._attempt += 1;
      if (ms > wait) { wait = ms; waitReason = "offline"; }
    } else {
      this._attempt = 0;
    }
    this._publishing = new Set();
    if (wait && !this._paused) this._setRetry(wait, waitReason);
    this._changed();
  }

  _settle(key, err, result = null) {
    const list = this._waiters.get(key);
    if (!list) return;
    this._waiters.delete(key);
    for (const w of list) {
      this._clearTimeout(w.timer);
      if (err) w.reject(err); else w.resolve(result);
    }
  }

  _changed() {
    const data = {
      version: 1,
      pending: [...this._pending],
      failed: Object.fromEntries(this._failed),
      choices: Object.fromEntries(this._choices),
    };
    this._saving = this._saving
      .then(() => this._persistImpl(data))
      .catch((err) => console.warn("[publish-queue] persist failed:", err?.message || err));
    this._emit();
  }

  _emit() {
    try {
      this._emitImpl(this.snapshot());
    } catch (err) {
      console.warn("[publish-queue] emit failed:", err?.message || err);
    }
    this._justPublished = [];
  }
}

module.exports = {
  PublishQueue,
  classifyPublishError,
  DEBOUNCE_MS,
  MAX_DELAY_MS,
  BATCH_SIZE,
  BACKOFF_MS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/publishQueue.test.js`
Expected: PASS.
- If "a save made while its round is uploading" fails because `rounds[1]` is missing, the mid-round enqueue's debounce timer did not fire. Check that `_schedule` runs while `_running` is set; it must, because only `_paused`/`_retry` block it.
- If the backoff test is off by one round, check that `_attempt` increments only when `transient` is true.

- [ ] **Step 5: Commit**

```bash
git add src/main/publishQueue.js tests/unit/publishQueue.test.js
git commit -m "feat(publish): debounced, persistent publish queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Auto-publish decision

**Files:**
- Create: `src/main/autoPublish.js`
- Test: `tests/unit/autoPublish.test.js`

**Interfaces:**
- Consumes: `publishStatus(record)` from `src/shared/publishState.js` (`"never"|"current"|"stale"`; needs `contentHash` on the record, which `annotateBuild`/`annotateComp` add).
- Produces:
  - `autoPublishDecision(kind, annotatedRecord, { targetOwner: string|null, choice: "mine"|"theirs"|null }) → "skip"|"enqueue"|"ask-owner"`
  - `isPublishable(kind, record) → boolean`
  - `bulkPublishCandidates({ builds, comps }) → {kind,id}[]` (never-published, publishable, not trashed)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/autoPublish.test.js`:

```js
"use strict";

const { autoPublishDecision, isPublishable, bulkPublishCandidates } = require("../../src/main/autoPublish");
const { annotateBuild, annotateComp, buildReceipt, compReceipt } = require("../../src/main/publishFingerprint");

const build = (over = {}) => annotateBuild({ id: "b1", title: "Heal FB", profession: "Guardian", ...over });
const published = (over = {}) => {
  const base = { id: "b1", title: "Heal FB", profession: "Guardian", publishedFileId: "f", publishedKey: "k", publishedOwner: "me", ...over };
  return base;
};

describe("autoPublishDecision", () => {
  test("a never-published build is enqueued", () => {
    expect(autoPublishDecision("build", build(), { targetOwner: "me" })).toBe("enqueue");
  });

  test("a save that did not change the published content is skipped", () => {
    const rec = published();
    const current = annotateBuild({ ...rec, ...buildReceipt(rec) });
    expect(autoPublishDecision("build", current, { targetOwner: "me" })).toBe("skip");
  });

  test("a changed published build is enqueued", () => {
    const rec = published();
    const stale = annotateBuild({ ...rec, ...buildReceipt(rec), notes: "edited" });
    expect(autoPublishDecision("build", stale, { targetOwner: "me" })).toBe("enqueue");
  });

  test("a build published by someone else asks first", () => {
    const rec = published({ publishedOwner: "mate", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me" })).toBe("ask-owner");
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me", choice: "mine" })).toBe("enqueue");
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "me", choice: "theirs" })).toBe("skip");
  });

  test("a team build whose target is the team owner is not foreign", () => {
    const rec = published({ publishedOwner: "guild", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: "guild" })).toBe("enqueue");
  });

  test("an unknown target (signed out) never asks", () => {
    const rec = published({ publishedOwner: "mate", publishedHash: "old" });
    expect(autoPublishDecision("build", annotateBuild(rec), { targetOwner: null })).toBe("enqueue");
  });

  test("unpublishable or trashed records are skipped", () => {
    expect(autoPublishDecision("build", build({ profession: "" }), {})).toBe("skip");
    expect(autoPublishDecision("build", build({ deletedAt: "2026-10-07T00:00:00.000Z" }), {})).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ id: "c", name: "Untitled Comp" }), {})).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ id: "c", name: "  " }), {})).toBe("skip");
    expect(autoPublishDecision("build", null, {})).toBe("skip");
  });

  test("comps follow the same rules", () => {
    const comp = { id: "c", name: "Raid", publishedFileId: "cf", publishedKey: "ck", publishedOwner: "me" };
    const current = annotateComp({ ...comp, ...compReceipt(comp, []) });
    expect(autoPublishDecision("comp", current, { targetOwner: "me" })).toBe("skip");
    expect(autoPublishDecision("comp", annotateComp({ ...current, notes: "x" }), { targetOwner: "me" })).toBe("enqueue");
  });
});

describe("isPublishable", () => {
  test.each([
    ["build", { profession: "Guardian" }, true],
    ["build", { profession: "" }, false],
    ["comp", { name: "Raid" }, true],
    ["comp", { name: "Untitled Comp" }, false],
    ["comp", {}, false],
  ])("%s %j → %s", (kind, rec, expected) => {
    expect(isPublishable(kind, rec)).toBe(expected);
  });
});

describe("bulkPublishCandidates", () => {
  test("lists never-published, publishable, live records only", () => {
    const builds = [
      build({ id: "new" }),
      build({ id: "pub", publishedFileId: "f" }),
      build({ id: "noprof", profession: "" }),
      build({ id: "trash", deletedAt: "2026-10-07T00:00:00.000Z" }),
    ];
    const comps = [annotateComp({ id: "c1", name: "Raid" }), annotateComp({ id: "c2", name: "Untitled Comp" })];
    expect(bulkPublishCandidates({ builds, comps })).toEqual([
      { kind: "build", id: "new" },
      { kind: "comp", id: "c1" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/autoPublish.test.js`
Expected: FAIL with "Cannot find module '../../src/main/autoPublish'".

- [ ] **Step 3: Write the implementation**

Create `src/main/autoPublish.js`:

```js
"use strict";

const { publishStatus } = require("../shared/publishState");

/** Whether a record can be published at all (the same rules the publish path enforces). */
function isPublishable(kind, record) {
  if (!record) return false;
  if (kind === "build") return Boolean(record.profession);
  const name = String(record.name || "").trim();
  return Boolean(name) && name !== "Untitled Comp";
}

/**
 * What a save should do about publishing.
 *
 * `record` must be annotated (annotateBuild / annotateComp): an unchanged
 * fingerprint reads "current" and is skipped. A record whose receipt names
 * another owner than the one it would publish to is asked about once, unless a
 * choice was already made. An unknown target (signed out) never asks: the round
 * checks again when it runs.
 *
 * @param {"build"|"comp"} kind
 * @param {object|null} record
 * @param {{targetOwner?: string|null, choice?: "mine"|"theirs"|null}} ctx
 * @returns {"skip"|"enqueue"|"ask-owner"}
 */
function autoPublishDecision(kind, record, { targetOwner = null, choice = null } = {}) {
  if (!record || record.deletedAt) return "skip";
  if (!isPublishable(kind, record)) return "skip";
  if (choice === "theirs") return "skip";
  if (publishStatus(record) === "current") return "skip";
  const foreign = Boolean(record.publishedOwner && targetOwner && record.publishedOwner !== targetOwner);
  if (foreign && choice !== "mine") return "ask-owner";
  return "enqueue";
}

/** Records the one-time bulk prompt offers to publish. */
function bulkPublishCandidates({ builds = [], comps = [] }) {
  const out = [];
  for (const b of builds) {
    if (!b.deletedAt && !b.publishedFileId && isPublishable("build", b)) out.push({ kind: "build", id: b.id });
  }
  for (const c of comps) {
    if (!c.deletedAt && !c.publishedFileId && isPublishable("comp", c)) out.push({ kind: "comp", id: c.id });
  }
  return out;
}

module.exports = { autoPublishDecision, isPublishable, bulkPublishCandidates };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/autoPublish.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/autoPublish.js tests/unit/autoPublish.test.js
git commit -m "feat(publish): decide whether a save publishes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Batch publish routine

**Files:**
- Create: `src/main/publishBatch.js`
- Test: `tests/unit/publishBatch.test.js`

**Interfaces:**
- Consumes (real modules, required directly):
  - `buildEncryptedBuildFile`, `buildEncryptedCompFile`, `buildRedirectFile` (`./siteBundle`)
  - `serializeCompForPublish`, `getCompPublishBuildIds`, `planCompMembers` (`./compPublish`)
  - `slugifyBuildName`, `generateFileId`, `generateEncryptionKey`, `getDefaultBuildName` (`./buildEncryption`)
  - `buildReceipt`, `compReceipt` (`./publishFingerprint`)
  - `formatStamp` (`./formatMigration`)
  - `memberStampTargets` (`./teamGuards`)
  - `PROFESSION_ACCENTS` (`./accents`)
- Consumes (injected deps, all from `index.js`): see the `createPublishBatch` destructuring below.
- Produces:
  - `createPublishBatch(deps) → publishBatch(items: {kind,id}[]) → Promise<{results}>`. The results match Task 1's `runRound` contract.
    - Each ok result carries `{ pagesUrl, slug, fileId, changed: true }`, and comps also carry `skippedForeignBuilds`.
    - A deleted or missing record yields `{ ok: true, skipped: "gone" }`.
    - It throws `PUBLISH_DISCONNECTED` when there is no session.
  - `publishedPageUrl({ kind, owner, slug, fileId, key, theme, repo }) → string`
  - `displayTitle(build) → string` (the default name for untitled builds)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/publishBatch.test.js`:

```js
"use strict";

const { createPublishBatch, publishedPageUrl, displayTitle } = require("../../src/main/publishBatch");
const { resolvePublishTarget } = require("../../src/main/publishTarget");
const { buildFingerprint } = require("../../src/main/publishFingerprint");
const { generateEncryptionKey } = require("../../src/main/buildEncryption");

const SHA = "a".repeat(40);
const AUTH = { token: "tok", viewer: { login: "me" }, onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true } };
const TEAM_ROOT = { id: "team", teamId: "T1", shared: true, publishOwner: "guild", publishOwnerType: "org" };

function setup({ builds = [], comps = [], auth = AUTH, choice = {}, upload = {}, live = true, publishImpl = null } = {}) {
  const calls = { bundles: [], polls: [], marks: [], onboarding: [] };
  let n = 0;
  const deps = {
    getSession: jest.fn(async () => ({ token: "tok", viewer: { login: "me" } })),
    getAuthRecord: async () => auth,
    patchAuthRecord: async (p) => { calls.onboarding.push(p); },
    findTeamRoot: async (folderId) => (folderId === "team" ? TEAM_ROOT : null),
    resolvePublishTarget,
    listBuilds: async () => builds,
    listComps: async () => comps,
    markBuildPublished: async (id, patch) => { calls.marks.push({ kind: "build", id, patch }); return { ...builds.find((b) => b.id === id), ...patch }; },
    markCompPublished: async (id, patch) => { calls.marks.push({ kind: "comp", id, patch }); return { ...comps.find((c) => c.id === id), ...patch }; },
    getSetting: async () => null,
    enrichBuildForPublish: jest.fn(async (b) => ({ title: b.title, profession: b.profession })),
    buildSpaBundle: jest.fn(() => ({ "site/index.html": "<!doctype html>" })),
    addFormatMigrations: jest.fn(async () => ({ builds: [], comps: [] })),
    stampFormatMigrations: jest.fn(async () => {}),
    ensurePublishInfra: jest.fn(async () => {}),
    invalidatePublishInfra: jest.fn(),
    publishSiteBundle: jest.fn(publishImpl || (async (token, owner, bundle) => {
      calls.bundles.push({ owner, bundle });
      return { commitSha: SHA, changed: true, shellChanged: false, ...upload };
    })),
    triggerPagesWorkflow: jest.fn(async () => {}),
    pollUrlLive: jest.fn(async (url, opts) => { calls.polls.push({ url, opts }); return live; }),
    teamPut: jest.fn(async () => {}),
    choiceOf: (kind, id) => choice[`${kind}:${id}`] || null,
    newFileId: () => `new${++n}`,
    newKey: generateEncryptionKey,
  };
  return { publishBatch: createPublishBatch(deps), deps, calls };
}

const b = (over) => ({ title: "Heal FB", profession: "Guardian", folderId: null, updatedAt: "t1", ...over });
const pub = (over) => b({ publishedFileId: `f-${over.id}`, publishedKey: generateEncryptionKey(), publishedSlug: "heal-fb", publishedOwner: "me", ...over });
const encFiles = (bundle) => Object.keys(bundle).filter((p) => /^site\/builds\/.+\.enc$/.test(p));

describe("grouping", () => {
  test("one commit per owner", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" }), b({ id: "t", folderId: "team" })] });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "t" }]);
    expect(calls.bundles.map((x) => x.owner).sort()).toEqual(["guild", "me"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("several items for one owner share one commit", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" }), b({ id: "c" })] });
    await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "c" }]);
    expect(calls.bundles).toHaveLength(1);
    expect(encFiles(calls.bundles[0].bundle)).toHaveLength(2);
  });

  test("no session is a round-level PUBLISH_DISCONNECTED", async () => {
    const { publishBatch, deps } = setup({ builds: [b({ id: "a" })] });
    deps.getSession.mockResolvedValue(null);
    await expect(publishBatch([{ kind: "build", id: "a" }])).rejects.toMatchObject({ code: "PUBLISH_DISCONNECTED" });
  });

  test("a personal target that was never set up reports PUBLISH_DISCONNECTED", async () => {
    const auth = { ...AUTH, onboarding: { targetOwner: "me", branch: "main" } };
    const { publishBatch, calls } = setup({ auth, builds: [b({ id: "a" }), b({ id: "t", folderId: "team" })] });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "build", id: "t" }]);
    expect(results.find((r) => r.id === "a").error).toMatchObject({ code: "PUBLISH_DISCONNECTED" });
    expect(results.find((r) => r.id === "t").ok).toBe(true);
    expect(calls.bundles.map((x) => x.owner)).toEqual(["guild"]);
  });
});

describe("ownership", () => {
  test("a build published by someone else needs a choice", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "x", publishedOwner: "mate" })] });
    const { results } = await publishBatch([{ kind: "build", id: "x" }]);
    expect(results[0].ok).toBe(false);
    expect(results[0].error.message).toBe("PUBLISHED_BY_OTHER:mate");
    expect(calls.bundles).toHaveLength(0);
  });

  test("\"mine\" republishes it under this owner", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "x", publishedOwner: "mate" })], choice: { "build:x": "mine" } });
    const { results } = await publishBatch([{ kind: "build", id: "x" }]);
    expect(results[0].ok).toBe(true);
    expect(calls.marks[0].patch.publishedOwner).toBe("me");
  });
});

describe("preparing", () => {
  test("an item that fails to prepare fails alone", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "bad", profession: "" }), b({ id: "good" })] });
    const { results } = await publishBatch([{ kind: "build", id: "bad" }, { kind: "build", id: "good" }]);
    expect(results.find((r) => r.id === "bad")).toMatchObject({ ok: false });
    expect(results.find((r) => r.id === "bad").error.message).toMatch(/profession/);
    expect(results.find((r) => r.id === "good").ok).toBe(true);
    expect(calls.bundles).toHaveLength(1);
  });

  test("a record that no longer exists is dropped, not failed", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "trashed", deletedAt: "2026-10-07T00:00:00.000Z" })] });
    const { results } = await publishBatch([{ kind: "build", id: "gone" }, { kind: "build", id: "trashed" }]);
    expect(results).toEqual([
      { kind: "build", id: "gone", ok: true, skipped: "gone" },
      { kind: "build", id: "trashed", ok: true, skipped: "gone" },
    ]);
    expect(calls.bundles).toHaveLength(0);
  });

  test("an untitled build publishes under its default name without renaming the record", async () => {
    const untitled = b({ id: "u", title: "", profession: "Warrior", specializations: [] });
    const { publishBatch, deps, calls } = setup({ builds: [untitled] });
    const { results } = await publishBatch([{ kind: "build", id: "u" }]);
    expect(deps.enrichBuildForPublish).toHaveBeenCalledWith(expect.objectContaining({ title: "Core Warrior" }));
    expect(results[0].slug).toBe("core-warrior");
    expect(calls.marks[0].patch.publishedHash).toBe(buildFingerprint(untitled));
    expect(deps).not.toHaveProperty("upsertBuild");
    expect(displayTitle({ title: "Untitled Build", profession: "Thief" })).toBe("Core Thief");
  });

  test("a member shared by two comps and queued itself is uploaded once", async () => {
    const member = b({ id: "m" });
    const comps = [
      { id: "c1", name: "Raid A", buildIds: ["m"], partyLines: [], updatedAt: "t1" },
      { id: "c2", name: "Raid B", buildIds: ["m"], partyLines: [], updatedAt: "t1" },
    ];
    const { publishBatch, deps, calls } = setup({ builds: [member], comps });
    const { results } = await publishBatch([{ kind: "comp", id: "c1" }, { kind: "build", id: "m" }, { kind: "comp", id: "c2" }]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(encFiles(calls.bundles[0].bundle)).toEqual(["site/builds/new1.enc"]);
    expect(deps.enrichBuildForPublish).toHaveBeenCalledTimes(1);
    expect(calls.marks.filter((m) => m.kind === "build")).toEqual([
      expect.objectContaining({ id: "m", patch: expect.objectContaining({ publishedFileId: "new1" }) }),
    ]);
  });

  test("a never-published member that is not itself queued is stamped by the comp", async () => {
    const comps = [{ id: "c1", name: "Raid", buildIds: ["m"], partyLines: [], updatedAt: "t1" }];
    const { publishBatch, calls } = setup({ builds: [b({ id: "m" })], comps });
    await publishBatch([{ kind: "comp", id: "c1" }]);
    expect(calls.marks.map((m) => `${m.kind}:${m.id}`)).toEqual(["build:m", "comp:c1"]);
  });
});

describe("upload", () => {
  test("format migrations ride along and are stamped after the upload", async () => {
    const { publishBatch, deps } = setup({ builds: [b({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(deps.addFormatMigrations).toHaveBeenCalledWith(expect.any(Object), "me", ["a"]);
    expect(deps.stampFormatMigrations).toHaveBeenCalledTimes(1);
  });

  test("receipts carry the hash of the snapshot that was uploaded", async () => {
    const builds = [b({ id: "a" })];
    const original = builds[0];
    const { publishBatch, calls } = setup({
      builds,
      publishImpl: async (token, owner, bundle) => {
        builds[0] = { ...builds[0], notes: "edited mid-upload" };
        calls.bundles.push({ owner, bundle });
        return { commitSha: SHA, changed: true, shellChanged: false };
      },
    });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.marks[0].patch.publishedHash).toBe(buildFingerprint(original));
    expect(calls.marks[0].patch.publishedHash).not.toBe(buildFingerprint(builds[0]));
  });

  test("a 404 clears the infra cache and retries once", async () => {
    let attempts = 0;
    const { publishBatch, deps } = setup({
      builds: [b({ id: "a" })],
      publishImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("Not Found"), { status: 404 });
        return { commitSha: SHA, changed: true, shellChanged: false };
      },
    });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0].ok).toBe(true);
    expect(deps.invalidatePublishInfra).toHaveBeenCalledWith("me", "main");
    expect(deps.ensurePublishInfra).toHaveBeenCalledTimes(2);
  });

  test("a second 404 fails the owner's items", async () => {
    const { publishBatch } = setup({
      builds: [b({ id: "a" })],
      publishImpl: async () => { throw Object.assign(new Error("Not Found"), { status: 404 }); },
    });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0].error.status).toBe(404);
  });
});

describe("live check", () => {
  test("polls the data file pinned to the new commit", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.polls).toEqual([{ url: `https://raw.githubusercontent.com/me/axibuilds/${SHA}/site/builds/f-a.enc`, opts: undefined }]);
  });

  test("a first publish also waits for its /r/ page", async () => {
    const { publishBatch, calls } = setup({ builds: [b({ id: "a" })] });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(calls.polls[1]).toEqual({ url: "https://me.github.io/axibuilds/r/new1/", opts: { timeoutMs: 180000 } });
  });

  test("a viewer change waits for the site and triggers Pages", async () => {
    const { publishBatch, deps, calls } = setup({ builds: [pub({ id: "a" })], upload: { shellChanged: true } });
    await publishBatch([{ kind: "build", id: "a" }]);
    expect(deps.triggerPagesWorkflow).toHaveBeenCalledWith("tok", "me", "main", "axibuilds");
    expect(calls.polls[1]).toEqual({ url: "https://me.github.io/axibuilds/", opts: { timeoutMs: 180000 } });
  });

  test("a link that never goes live leaves items unstamped with PUBLISH_NOT_LIVE", async () => {
    const { publishBatch, calls } = setup({ builds: [pub({ id: "a" })], live: false });
    const { results } = await publishBatch([{ kind: "build", id: "a" }]);
    expect(results[0].error).toMatchObject({ code: "PUBLISH_NOT_LIVE" });
    expect(calls.marks).toHaveLength(0);
  });
});

describe("results and side effects", () => {
  test("results carry the old publish handlers' response shape", async () => {
    const comps = [{ id: "c1", name: "Raid Night", buildIds: [], partyLines: [], updatedAt: "t1" }];
    const { publishBatch } = setup({ builds: [b({ id: "a" })], comps });
    const { results } = await publishBatch([{ kind: "build", id: "a" }, { kind: "comp", id: "c1" }]);
    const build = results.find((r) => r.kind === "build");
    expect(build).toMatchObject({ ok: true, slug: "heal-fb", fileId: "new1", changed: true });
    expect(build.pagesUrl).toMatch(/^https:\/\/me\.github\.io\/axibuilds\/\?n=heal-fb&b=new1\./);
    const comp = results.find((r) => r.kind === "comp");
    expect(comp).toMatchObject({ ok: true, slug: "raid-night", skippedForeignBuilds: [] });
    expect(comp.pagesUrl).toMatch(/&c=new2\./);
  });

  test("team items are pushed to their team; only a personal publish touches onboarding", async () => {
    const { publishBatch, deps, calls } = setup({ builds: [b({ id: "t", folderId: "team" })] });
    await publishBatch([{ kind: "build", id: "t" }]);
    expect(deps.teamPut).toHaveBeenCalledWith("T1", "t", "build");
    expect(calls.onboarding).toHaveLength(0);

    const personal = setup({ builds: [b({ id: "a" })] });
    await personal.publishBatch([{ kind: "build", id: "a" }]);
    expect(personal.calls.onboarding[0].onboarding).toMatchObject({ targetOwner: "me", repoReady: true, repoName: "axibuilds" });
  });
});

test("publishedPageUrl", () => {
  expect(publishedPageUrl({ kind: "build", owner: "me", slug: "a b", fileId: "f", key: "k", theme: "" }))
    .toBe("https://me.github.io/axibuilds/?n=a%20b&b=f.k");
  expect(publishedPageUrl({ kind: "comp", owner: "me", slug: "r", fileId: "f", key: "k", theme: "dark" }))
    .toBe("https://me.github.io/axibuilds/?n=r&c=f.k&t=dark");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/publishBatch.test.js`
Expected: FAIL with "Cannot find module '../../src/main/publishBatch'".

- [ ] **Step 3: Write the implementation**

Create `src/main/publishBatch.js`. The logic is ported from `publishBuildImpl` and `publishCompImpl` in `src/main/index.js`; keep their comments' intent where the code moved.

```js
"use strict";

// One publish round: every queued item, grouped by the owner it publishes to,
// one commit per owner. Ported from the per-item publishBuildImpl /
// publishCompImpl in index.js, which now go through the queue.

const { buildEncryptedBuildFile, buildEncryptedCompFile, buildRedirectFile } = require("./siteBundle");
const { serializeCompForPublish, getCompPublishBuildIds, planCompMembers } = require("./compPublish");
const { slugifyBuildName, generateFileId, generateEncryptionKey, getDefaultBuildName } = require("./buildEncryption");
const { buildReceipt, compReceipt } = require("./publishFingerprint");
const { formatStamp } = require("./formatMigration");
const { memberStampTargets } = require("./teamGuards");
const { PROFESSION_ACCENTS: PROFESSION_THEME_IDS } = require("./accents");

const REPO = "axibuilds";
const PAGES_TIMEOUT_MS = 180000;

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function publishedPageUrl({ kind, owner, slug, fileId, key, theme, repo = REPO }) {
  const param = kind === "comp" ? "c" : "b";
  return `https://${owner}.github.io/${repo}/?n=${encodeURIComponent(slug)}&${param}=${fileId}.${key}${theme ? `&t=${theme}` : ""}`;
}

// The page of an untitled build carries its default name. The record keeps its
// own title: renaming it from a background publish would fight the editor.
function displayTitle(build) {
  const title = String(build?.title || "").trim();
  return title && title !== "Untitled Build" ? title : getDefaultBuildName(build?.specializations, build?.profession);
}

function prepareError(build, err) {
  const wrapped = new Error(`Couldn't prepare "${build.title || build.profession || "Build"}": ${err?.message || err}`);
  wrapped.cause = err;
  if (err?.code) wrapped.code = err.code;
  if (err?.status) wrapped.status = err.status;
  return wrapped;
}

function createPublishBatch(deps) {
  const {
    getSession, getAuthRecord, patchAuthRecord, findTeamRoot, resolvePublishTarget,
    listBuilds, listComps, markBuildPublished, markCompPublished, getSetting,
    enrichBuildForPublish, buildSpaBundle, addFormatMigrations, stampFormatMigrations,
    ensurePublishInfra, invalidatePublishInfra, publishSiteBundle, triggerPagesWorkflow, pollUrlLive,
    teamPut, choiceOf,
    newFileId = generateFileId, newKey = generateEncryptionKey, repo = REPO,
  } = deps;

  async function themes() {
    const appTheme = (await getSetting("appearance.theme")) || "";
    const themedBuilds = await getSetting("appearance.themedBuildPages");
    return {
      comp: appTheme,
      build: (build) => (themedBuilds && build.profession && PROFESSION_THEME_IDS[build.profession]) || appTheme,
    };
  }

  return async function publishBatch(items) {
    const session = await getSession();
    if (!session) throw coded("Sign in with GitHub to publish.", "PUBLISH_DISCONNECTED");
    const auth = await getAuthRecord();
    const branch = auth?.onboarding?.branch || "main";
    const personalReady = Boolean(auth?.onboarding?.repoReady || auth?.onboarding?.forkReady);
    const [builds, comps] = await Promise.all([listBuilds(), listComps()]);
    const buildsById = new Map(builds.map((x) => [x.id, x]));
    const compsById = new Map(comps.map((x) => [x.id, x]));
    const theme = await themes();
    const results = [];

    const groups = new Map();
    for (const { kind, id } of items) {
      const record = kind === "comp" ? compsById.get(id) : buildsById.get(id);
      if (!record || record.deletedAt) {
        results.push({ kind, id, ok: true, skipped: "gone" });
        continue;
      }
      try {
        const teamRoot = await findTeamRoot(record.folderId);
        const target = resolvePublishTarget(auth, session.viewer.login, teamRoot);
        if (target.scope === "personal" && !personalReady) {
          throw coded("Set up publishing to publish.", "PUBLISH_DISCONNECTED");
        }
        if (record.publishedOwner && record.publishedOwner !== target.owner && choiceOf(kind, id) !== "mine") {
          throw new Error(`PUBLISHED_BY_OTHER:${record.publishedOwner}`);
        }
        const group = groups.get(target.owner) || { owner: target.owner, ownerType: target.ownerType, personal: false, entries: [] };
        if (target.scope === "personal") group.personal = true;
        group.entries.push({ kind, id, record, teamRoot });
        groups.set(target.owner, group);
      } catch (err) {
        results.push({ kind, id, ok: false, error: err });
      }
    }

    for (const group of groups.values()) {
      results.push(...await publishGroup(group, { session, branch, buildsById, theme }));
    }
    return { results };
  };

  async function publishGroup({ owner, ownerType, personal, entries }, { session, branch, buildsById, theme }) {
    const results = [];
    const bundle = {};
    const prepared = [];
    // Builds uploaded in this commit, so a build queued itself AND linked from
    // one or more comps is uploaded once and every link names the same file.
    const uploaded = new Map();      // buildId → { fileId, key, slug, filePath, isNew }
    const memberPatches = new Map(); // buildId → receipt for a member uploaded only through a comp

    const uploadBuild = async (build, ids) => {
      if (uploaded.has(build.id)) return uploaded.get(build.id);
      const title = displayTitle(build);
      let enriched;
      try {
        enriched = await enrichBuildForPublish({ ...build, title });
      } catch (err) {
        throw prepareError(build, err);
      }
      const file = buildEncryptedBuildFile(enriched, ids.fileId, ids.key);
      const redirect = buildRedirectFile(ids.fileId, ids.key, "b");
      bundle[file.filePath] = file.content;
      bundle[redirect.filePath] = redirect.content;
      const upload = { fileId: ids.fileId, key: ids.key, slug: ids.slug, filePath: file.filePath, isNew: !build.publishedFileId };
      uploaded.set(build.id, upload);
      return upload;
    };

    const buildPatch = (build, upload) => {
      const receipt = buildReceipt(build);
      return {
        publishedSlug: upload.slug,
        publishedFileId: upload.fileId,
        publishedKey: upload.key,
        publishedOwner: owner,
        // The snapshot that was serialized: a save made during the upload
        // leaves the build reading out of date, and it is already queued.
        snapshotUpdatedAt: build.updatedAt,
        ...receipt,
        publishedFormat: formatStamp("build", receipt.publishedHash),
      };
    };

    const prepareBuild = async (build) => {
      if (!build.profession) throw new Error("Build must have a profession selected.");
      const upload = await uploadBuild(build, {
        fileId: build.publishedFileId || newFileId(),
        key: build.publishedKey || newKey(),
        slug: slugifyBuildName(displayTitle(build)),
      });
      return { ...upload, patch: buildPatch(build, upload) };
    };

    const prepareComp = async (comp) => {
      const name = String(comp.name || "").trim();
      if (!name || name === "Untitled Comp") throw new Error("Comp name is required for publishing.");
      const memberIds = getCompPublishBuildIds(comp);
      // A member already uploaded in this commit is planned under the ids it
      // was uploaded with, so planCompMembers links it instead of minting new ones.
      const compBuilds = memberIds.map((id) => buildsById.get(id)).filter(Boolean).map((build) => {
        const up = uploaded.get(build.id);
        return up ? { ...build, publishedFileId: up.fileId, publishedKey: up.key, publishedSlug: up.slug, publishedOwner: owner } : build;
      });
      const plan = planCompMembers({
        compBuilds, owner, force: choiceOf("comp", comp.id) === "mine",
        slugOf: (build) => uploaded.get(build.id)?.slug || slugifyBuildName(displayTitle(build)),
        themeOf: theme.build,
        newFileId, newKey,
      });
      for (const u of plan.uploads) {
        const original = buildsById.get(u.build.id);
        const upload = await uploadBuild(original, u);
        if (memberPatches.has(original.id)) continue;
        const patch = buildPatch(original, upload);
        if (u.needsRecord || upload.isNew || original.publishedHash !== patch.publishedHash || original.publishedFormat !== patch.publishedFormat) {
          memberPatches.set(original.id, patch);
        }
      }
      const fileId = comp.publishedFileId || newFileId();
      const key = comp.publishedKey || newKey();
      const slug = slugifyBuildName(comp.name);
      const file = buildEncryptedCompFile(serializeCompForPublish(comp, plan.members), fileId, key);
      const redirect = buildRedirectFile(fileId, key, "c");
      bundle[file.filePath] = file.content;
      bundle[redirect.filePath] = redirect.content;
      // v2 links members, so the comp page can't go stale through them: no
      // member hashes. A member's own staleness shows on the member.
      const receipt = compReceipt(comp, []);
      return {
        fileId, key, slug, filePath: file.filePath, isNew: !comp.publishedFileId,
        skippedForeignBuilds: plan.foreign,
        patch: {
          publishedFileId: fileId,
          publishedKey: key,
          publishedSlug: slug,
          publishedOwner: owner,
          boonCoverageHtml: "",
          snapshotUpdatedAt: comp.updatedAt,
          ...receipt,
          publishedFormat: formatStamp("comp", receipt.publishedHash),
        },
      };
    };

    // Builds first, so a comp in the same commit links the files they wrote.
    const ordered = [...entries.filter((e) => e.kind === "build"), ...entries.filter((e) => e.kind === "comp")];
    for (const entry of ordered) {
      try {
        const prep = entry.kind === "build" ? await prepareBuild(entry.record) : await prepareComp(entry.record);
        prepared.push({ ...entry, ...prep });
      } catch (err) {
        results.push({ kind: entry.kind, id: entry.id, ok: false, error: err });
      }
    }
    if (!prepared.length) return results;
    const failAll = (err) => [...results, ...prepared.map(({ kind, id }) => ({ kind, id, ok: false, error: err }))];

    let migrated;
    let upload;
    try {
      const fullBundle = { ...buildSpaBundle(), ...bundle };
      const excludeIds = [...new Set([...prepared.map((p) => p.id), ...uploaded.keys()])];
      migrated = await addFormatMigrations(fullBundle, owner, excludeIds);
      const attempt = async () => {
        await ensurePublishInfra(session.token, owner, ownerType, branch);
        return publishSiteBundle(session.token, owner, fullBundle, branch, repo);
      };
      try {
        upload = await attempt();
      } catch (err) {
        if (err?.status !== 404) throw err;
        // Repo or Pages went missing: re-verify the infrastructure once.
        invalidatePublishInfra(owner, branch);
        upload = await attempt();
      }
    } catch (err) {
      return failAll(err);
    }

    if (upload.shellChanged) {
      await triggerPagesWorkflow(session.token, owner, branch, repo).catch(() => null);
    }
    // Pinned to the new commit: an older copy of the file can't answer, so a
    // republish no longer passes before its own upload is readable.
    const dataUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${upload.commitSha}/${prepared[0].filePath}`;
    if (!(await pollUrlLive(dataUrl))) {
      return failAll(coded("Uploaded, but the link did not go live in time.", "PUBLISH_NOT_LIVE"));
    }
    // Only a new /r/ page or a new viewer waits for the Pages deploy; a
    // republish is served from raw as soon as the commit lands.
    const fresh = prepared.find((p) => p.isNew);
    if (fresh || upload.shellChanged) {
      const pageUrl = fresh ? `https://${owner}.github.io/${repo}/r/${fresh.fileId}/` : `https://${owner}.github.io/${repo}/`;
      if (!(await pollUrlLive(pageUrl, { timeoutMs: PAGES_TIMEOUT_MS }))) {
        return failAll(coded("Uploaded, but the site did not go live in time.", "PUBLISH_NOT_LIVE"));
      }
    }

    // Receipts patch publish fields only. Re-upserting the snapshot would
    // clobber a save made while the upload was in flight.
    const stampedMembers = [];
    const itemBuildIds = new Set(prepared.filter((p) => p.kind === "build").map((p) => p.id));
    for (const [id, patch] of memberPatches) {
      if (itemBuildIds.has(id)) continue;
      try {
        const saved = await markBuildPublished(id, patch);
        if (saved) stampedMembers.push(saved);
      } catch (err) {
        console.warn("[publish] member stamp failed", id, err?.message || err);
      }
    }
    for (const p of prepared) {
      try {
        const saved = p.kind === "build" ? await markBuildPublished(p.id, p.patch) : await markCompPublished(p.id, p.patch);
        if (saved && p.teamRoot) await teamPut(p.teamRoot.teamId, p.id, p.kind);
        results.push({
          kind: p.kind,
          id: p.id,
          ok: true,
          pagesUrl: publishedPageUrl({
            kind: p.kind, owner, slug: p.slug, fileId: p.fileId, key: p.key, repo,
            theme: p.kind === "comp" ? theme.comp : theme.build(p.record),
          }),
          slug: p.slug,
          fileId: p.fileId,
          changed: true,
          ...(p.kind === "comp" ? { skippedForeignBuilds: p.skippedForeignBuilds } : {}),
        });
      } catch (err) {
        results.push({ kind: p.kind, id: p.id, ok: false, error: err });
      }
    }
    // Each member goes to ITS OWN team, or nowhere if personal.
    for (const { teamId, buildId } of await memberStampTargets(stampedMembers, findTeamRoot)) {
      await teamPut(teamId, buildId, "build");
    }
    await stampFormatMigrations(migrated);

    // Only a personal publish updates this machine's own publishing setup; a
    // team publish stamped here would repoint the personal target at the team.
    if (personal) {
      await patchAuthRecord({
        onboarding: {
          repoReady: true,
          forkReady: true,
          repoName: repo,
          pagesReady: false,
          pagesBuildStatus: "queued",
          pagesBuildUpdatedAt: new Date().toISOString(),
          pagesBuildError: null,
          pagesUrl: `https://${owner}.github.io/${repo}/`,
          branch,
          targetOwner: owner,
          targetOwnerType: ownerType,
        },
      });
    }
    return results;
  }
}

module.exports = { createPublishBatch, publishedPageUrl, displayTitle, PAGES_TIMEOUT_MS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/publishBatch.test.js`
Expected: PASS.
- If "a member shared by two comps…" fails with two `.enc` files, the second comp did not see the overlay. Check that `prepareComp` reads `uploaded` *before* calling `planCompMembers`.
- If the onboarding test fails on the team case, the group's `personal` flag was set for a team-scope item. Check `target.scope`.
- If `resolvePublishTarget` reads different team-root fields than `publishOwner`/`publishOwnerType`, open `src/main/publishTarget.js` and match `TEAM_ROOT` in the test to it. Don't change `publishTarget.js`.

- [ ] **Step 5: Commit**

```bash
git add src/main/publishBatch.js tests/unit/publishBatch.test.js
git commit -m "feat(publish): batch publish, one commit per owner per round

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the queue into the main process

**Files:**
- Modify: `src/main/index.js`. The anchors below are exact strings from the current file.
- Modify: `src/preload/index.js`
- Modify: `src/web/webApi/stubs.js`
- Test: `tests/unit/teamsIpc.test.js`. It boots the real main process with mocked `githubApi`; add a new `describe` block and update one fixture.
- Test: `tests/unit/preloadPublish.test.js` (create)

**Interfaces:**
- Consumes:
  - `PublishQueue`, `classifyPublishError` (Task 1)
  - `autoPublishDecision`, `bulkPublishCandidates` (Task 2)
  - `createPublishBatch`, `publishedPageUrl` (Task 3)
- Produces: IPC channels and bridge methods.

  | Channel | Args | Returns | Bridge method |
  |---|---|---|---|
  | `publish:snapshot` | — | queue snapshot | `getPublishSnapshot()` |
  | `publish:retry` | `kind, id` | `true` | `retryPublish(kind, id)` |
  | `publish:set-choice` | `kind, id, "mine"\|"theirs"` | `true` | `setPublishChoice(kind, id, choice)` |
  | `publish:get-link` | `kind, id` | `string\|null`; publishes first if never published (waits up to 5 min) | `getPublishLink(kind, id)` |
  | `publish:bulk-candidates` | — | `number` | `getBulkPublishCount()` |
  | `publish:bulk-enqueue` | — | `number` | `bulkPublish()` |
  | `publish:resume` | — | `true` | `resumePublishing()` |

  - Events: `publish:status` (snapshot), bridged as `onPublishStatus(cb)`; and `publish:needs-owner-choice` `{kind, id, owner}`, bridged as `onPublishOwnerChoice(cb)`.
  - `builds:publish-build` and `comps:publish-comp` keep their signatures and response shapes, so the local API (`localApi.js` → `invokeLocal`) is unchanged.

- [ ] **Step 1: Write the failing tests**

**(a)** In `tests/unit/teamsIpc.test.js`, inside `describe("publishing inside a team", …)`, change `AUTH.onboarding` so publishing counts as set up. The renderer has never allowed a publish without it:

```js
    onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true },
```

**(b)** Append a new block at the end of `tests/unit/teamsIpc.test.js`:

```js
// ─── Publish on save ────────────────────────────────────────────────────────

describe("publish on save", () => {
  const AUTH = {
    sync: SESSION,
    token: "gh-token",
    viewer: { login: "me" },
    onboarding: { targetOwner: "me", targetOwnerType: "user", branch: "main", repoReady: true },
  };
  const github = () => require("../../src/main/githubApi");
  const statuses = () => mockCtx.sent.filter((m) => m.channel === "publish:status").map((m) => m.data);
  const lastStatus = () => statuses().at(-1);
  const queueFile = () => path.join(mockCtx.userData, "publish-queue.json");
  const mine = (over) => build({ id: "p1", title: "Mine", folderId: "solo", publishedFileId: "pf", publishedKey: "pk", publishedSlug: "mine", publishedOwner: "me", publishedHash: "OLD", ...over });
  const tree = (builds) => ({ ...teamTree(), builds, auth: AUTH });

  test("saving a changed build queues it and persists the queue", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Mine, edited", profession: "Warrior" });
    expect(lastStatus().items["build:p1"]).toEqual({ state: "queued" });
    await waitFor(() => fs.existsSync(queueFile()), { label: "queue persisted" });
    expect(JSON.parse(fs.readFileSync(queueFile(), "utf8")).pending).toEqual(["build:p1"]);
  });

  test("a save that leaves the published content alone is not queued", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:publish-build", "p1", {});
    const [stored] = (await invoke("builds:list")).filter((x) => x.id === "p1");
    mockCtx.sent.length = 0;
    await invoke("builds:save", stored);
    expect(statuses().some((s) => s.items["build:p1"])).toBe(false);
  });

  test("builds:publish-build keeps its response shape (local API)", async () => {
    await loadMain(tree([mine()]));
    const res = await invoke("builds:publish-build", "p1", {});
    expect(res).toMatchObject({ slug: "mine", fileId: "pf", changed: true });
    expect(res.pagesUrl).toMatch(/^https:\/\/me\.github\.io\/axibuilds\/\?n=mine&b=pf\.pk/);
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });

  test("a build owned by someone else asks once, then publishes after \"mine\"", async () => {
    await loadMain(tree([mine({ publishedOwner: "mate" })]));
    await invoke("builds:save", { id: "p1", title: "Edit 1", profession: "Warrior" });
    await invoke("builds:save", { id: "p1", title: "Edit 2", profession: "Warrior" });
    const asks = mockCtx.sent.filter((m) => m.channel === "publish:needs-owner-choice");
    expect(asks.map((m) => m.data)).toEqual([{ kind: "build", id: "p1", owner: "mate" }]);
    expect(lastStatus().items["build:p1"]).toEqual({ state: "declined", owner: "mate" });
    await invoke("publish:set-choice", "build", "p1", "mine");
    await waitFor(() => github().publishSiteBundle.mock.calls.length === 1, { label: "published after choice" });
    expect(github().publishSiteBundle.mock.calls[0][1]).toBe("me");
  });

  test("\"theirs\" stops further saves from publishing", async () => {
    await loadMain(tree([mine({ publishedOwner: "mate" })]));
    await invoke("publish:set-choice", "build", "p1", "theirs");
    await invoke("builds:save", { id: "p1", title: "Edit", profession: "Warrior" });
    expect(lastStatus().items["build:p1"]).toEqual({ state: "declined" });
    expect(mockCtx.sent.some((m) => m.channel === "publish:needs-owner-choice")).toBe(false);
  });

  test("publishing is refused, and the queue paused, until setup is done", async () => {
    await loadMain({ ...tree([mine()]), auth: { ...AUTH, onboarding: { targetOwner: "me", branch: "main" } } });
    await expect(invoke("builds:publish-build", "p1", {})).rejects.toThrow(/Set up publishing/);
    expect((await invoke("publish:snapshot")).paused).toBe("disconnected");
  });

  test("publish:get-link returns a published item's link without publishing", async () => {
    await loadMain(tree([mine()]));
    const url = await invoke("publish:get-link", "build", "p1");
    expect(url).toBe("https://me.github.io/axibuilds/?n=mine&b=pf.pk");
    expect(github().publishSiteBundle).not.toHaveBeenCalled();
  });

  test("publish:bulk-candidates counts never-published items; bulk-enqueue queues them", async () => {
    await loadMain(tree([mine(), build({ id: "n1", title: "New", folderId: "solo" }), build({ id: "n2", title: "", profession: "" })]));
    // tree() replaces teamTree's builds: p1 is published, n2 has no profession.
    expect(await invoke("publish:bulk-candidates")).toBe(1);
    expect(await invoke("publish:bulk-enqueue")).toBe(1);
    expect(Object.keys(lastStatus().items)).toEqual(["build:n1"]);
  });

  test("quitting with saves pending runs one round, then quits", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Edited", profession: "Warrior" });
    const event = { preventDefault: jest.fn() };
    fireAppEvent("before-quit", event);
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => mockCtx.quit === true, { label: "quit after flush" });
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });

  test("a Discord share of a queued build waits for its upload", async () => {
    await loadMain(tree([mine()]));
    await invoke("builds:save", { id: "p1", title: "Edited", profession: "Warrior" });
    await invoke("discord:share-build", "p1", []);
    expect(github().publishSiteBundle).toHaveBeenCalledTimes(1);
  });
});
```

The Discord test only asserts that the upload happened before the share continued. The share itself fails later because no webhook is configured, and that's fine.

**(c)** Create `tests/unit/preloadPublish.test.js`:

```js
"use strict";

let exposed = null;
const ipcRenderer = { invoke: jest.fn(async () => true), on: jest.fn(), removeAllListeners: jest.fn() };
jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_key, api) => { exposed = api; } },
  ipcRenderer,
}));

require("../../src/preload/index.js");

test.each([
  ["getPublishSnapshot", [], "publish:snapshot"],
  ["retryPublish", ["build", "b1"], "publish:retry"],
  ["setPublishChoice", ["build", "b1", "mine"], "publish:set-choice"],
  ["getPublishLink", ["comp", "c1"], "publish:get-link"],
  ["getBulkPublishCount", [], "publish:bulk-candidates"],
  ["bulkPublish", [], "publish:bulk-enqueue"],
  ["resumePublishing", [], "publish:resume"],
])("%s invokes %s", async (method, args, channel) => {
  await exposed[method](...args);
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(channel, ...args);
});

test.each([
  ["onPublishStatus", "publish:status"],
  ["onPublishOwnerChoice", "publish:needs-owner-choice"],
])("%s subscribes to %s, replacing any earlier listener", (method, channel) => {
  const cb = jest.fn();
  exposed[method](cb);
  expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith(channel);
  const handler = ipcRenderer.on.mock.calls.find(([c]) => c === channel)[1];
  handler({}, { x: 1 });
  expect(cb).toHaveBeenCalledWith({ x: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/teamsIpc.test.js tests/unit/preloadPublish.test.js`
Expected: FAIL. The new `publish on save` tests fail with "No handler registered for publish:snapshot" or missing `publish:status` messages. The preload tests fail with "exposed[method] is not a function". The existing team publishing tests should still pass.

- [ ] **Step 3: Implement the main-process wiring**

**3a. Requires** (top of `src/main/index.js`). Change line 48 from `const { snapshotDaily } = require("./jsonFile");` to:

```js
const { snapshotDaily, readJsonFile, writeJsonAtomic } = require("./jsonFile");
```

Then add these next to the other publish requires (after `const { resolvePublishTarget } = require("./publishTarget");`):

```js
const { PublishQueue } = require("./publishQueue");
const { autoPublishDecision, bulkPublishCandidates } = require("./autoPublish");
const { createPublishBatch, publishedPageUrl } = require("./publishBatch");
```

**3b. Module-level ref.** After `let teamSyncRef = null;`:

```js
// Set once the publish queue is constructed in the ready handler, for the
// app-level quit hooks.
let publishQueueRef = null;
```

**3c. Construct the queue.** In the ready handler, find:

```js
  app.on("browser-window-focus", () => { teamSync.onFocus(); });
```

Replace it with:

```js
  // Publish on save (publishQueue.js / publishBatch.js). Rounds go through
  // enqueuePublish, so a round, a Retry and a local API publish never race.
  const publishBatch = createPublishBatch({
    getSession, getAuthRecord, patchAuthRecord, findTeamRoot, resolvePublishTarget,
    listBuilds: () => store.listBuilds(),
    listComps: () => compStore.listComps(),
    markBuildPublished: (id, patch) => store.markPublished(id, patch),
    markCompPublished: (id, patch) => compStore.markPublished(id, patch),
    getSetting: (key) => store.getSetting(key),
    enrichBuildForPublish, buildSpaBundle, addFormatMigrations, stampFormatMigrations,
    ensurePublishInfra, invalidatePublishInfra, publishSiteBundle, triggerPagesWorkflow, pollUrlLive,
    teamPut: (teamId, id, kind) => safeEnqueue(() => teamSync.enqueue(teamId, id, kind, "put"), { type: kind, id }),
    choiceOf: (kind, id) => publishQueue.choiceOf(kind, id),
    repo: TARGET_REPO,
  });
  const publishQueueFile = path.join(app.getPath("userData"), "publish-queue.json");
  const publishQueue = new PublishQueue({
    runRound: (items) => enqueuePublish(() => publishBatch(items)),
    load: () => readJsonFile(publishQueueFile, null),
    persist: (data) => writeJsonAtomic(publishQueueFile, data, { backup: false }),
    emit: (snapshot) => broadcast("publish:status", snapshot),
  });
  publishQueueRef = publishQueue;
  publishQueue.load().catch((err) => console.warn("[publish-queue] load failed:", err.message));

  app.on("browser-window-focus", () => {
    teamSync.onFocus();
    publishQueue.resume().catch(() => {});
  });
```

`enrichBuildForPublish`, `addFormatMigrations` and `stampFormatMigrations` are `async function` declarations later in the same ready handler, so they are hoisted. `publishQueue` is referenced inside `choiceOf` only at round time, after initialization.

**3d. Save hooks and helpers.** Directly above `handle("builds:list", …)`, add:

```js
  // Where a record publishes, from the stored auth only: a save must never wait
  // on a network round trip. null when signed out (the round decides later).
  async function publishTargetOwner(record) {
    const auth = await getAuthRecord();
    if (!auth?.token || !auth?.viewer?.login) return null;
    return resolvePublishTarget(auth, auth.viewer.login, await findTeamRoot(record.folderId)).owner;
  }

  // Never fails the save: publishing is best-effort on top of a local write.
  async function autoPublishAfterSave(kind, saved) {
    try {
      const annotated = kind === "comp" ? annotateComp(saved) : annotateBuild(saved);
      const decision = autoPublishDecision(kind, annotated, {
        targetOwner: await publishTargetOwner(saved),
        choice: publishQueue.choiceOf(kind, saved.id),
      });
      if (decision === "enqueue") {
        publishQueue.enqueue(kind, saved.id);
      } else if (decision === "ask-owner" && publishQueue.markNeedsChoice(kind, saved.id, saved.publishedOwner)) {
        broadcast("publish:needs-owner-choice", { kind, id: saved.id, owner: saved.publishedOwner });
      }
    } catch (err) {
      console.warn("[publish-queue] auto-publish skipped:", kind, saved?.id, err?.message || err);
    }
  }
```

In `handle("builds:save", …)`, change the final `return annotateBuild(saved);` to:

```js
    await autoPublishAfterSave("build", saved);
    return annotateBuild(saved);
```

In `handle("comps:save", …)`, change the final `return annotateComp(saved);` to:

```js
    await autoPublishAfterSave("comp", saved);
    return annotateComp(saved);
```

**3e. Replace the old publish handlers.**
- Delete everything from `handle("builds:publish-build", (event, buildId, opts) => enqueuePublish(() => publishBuildImpl(event, buildId, opts || {})));` through the closing `}` of `async function publishBuildImpl`.
- Delete everything from `handle("comps:publish-comp", …` through the closing `}` of `async function publishCompImpl` (it ends just before `handle("gw2:list-professions", …)`).
- In the place of the build handler, insert:

```js
  // Explicit publishes (old IPC, local API, Copy link on a never-published
  // item) go through the queue too: same round, same receipts, same wait.
  const PUBLISH_FULL_WAIT_MS = 5 * 60 * 1000;
  const SHARE_PUBLISH_WAIT_MS = 15 * 1000;

  async function findPublishRecord(kind, id) {
    const list = kind === "comp" ? await compStore.listComps() : await store.listBuilds();
    return list.find((r) => r.id === id) || null;
  }

  function publishAndWait(kind, id, timeoutMs = PUBLISH_FULL_WAIT_MS) {
    publishQueue.publishNow(kind, id).catch(() => {});
    return publishQueue.awaitPublished(kind, id, { timeoutMs });
  }

  async function publishViaQueue(kind, id, opts = {}) {
    if (!(await findPublishRecord(kind, id))) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    if (opts.force) publishQueue.setChoice(kind, id, "mine");
    const result = await publishAndWait(kind, id);
    if (!result?.pagesUrl) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    const { pagesUrl, slug, fileId, changed, skippedForeignBuilds } = result;
    return kind === "comp" ? { pagesUrl, slug, fileId, changed, skippedForeignBuilds } : { pagesUrl, slug, fileId, changed };
  }

  // The link a published record answers on. Owner from its receipt, theme the
  // way publishBatch writes it.
  async function publishedLinkFor(kind, record) {
    if (!record?.publishedFileId || !record?.publishedKey) return null;
    const auth = await getAuthRecord();
    const owner = publishedOwnerFor(record, auth?.onboarding?.targetOwner);
    if (!owner) return null;
    const appTheme = (await store.getSetting("appearance.theme")) || "";
    const themed = await store.getSetting("appearance.themedBuildPages");
    const theme = kind === "comp" ? appTheme : ((themed && record.profession && PROFESSION_THEME_IDS[record.profession]) || appTheme);
    return publishedPageUrl({ kind, owner, slug: record.publishedSlug || "", fileId: record.publishedFileId, key: record.publishedKey, theme, repo: TARGET_REPO });
  }

  // A save still on its way up is waited for, so sharing right after saving
  // shares the new version instead of refusing. Returns an error message or null.
  async function settlePendingPublish(kind, id) {
    const state = publishQueue.snapshot().items[`${kind}:${id}`]?.state;
    if (state !== "queued" && state !== "publishing") return null;
    if (state === "queued") publishQueue.publishNow(kind, id).catch(() => {});
    try {
      await publishQueue.awaitPublished(kind, id, { timeoutMs: SHARE_PUBLISH_WAIT_MS });
      return null;
    } catch (err) {
      return err?.message || String(err);
    }
  }

  handle("builds:publish-build", (event, buildId, opts) => publishViaQueue("build", buildId, opts || {}));
  handle("comps:publish-comp", (event, compId, opts) => publishViaQueue("comp", compId, opts || {}));

  handle("publish:snapshot", async () => publishQueue.snapshot());
  handle("publish:retry", async (_e, kind, id) => {
    publishQueue.publishNow(kind, id).catch(() => {});
    return true;
  });
  handle("publish:set-choice", async (_e, kind, id, choice) => {
    publishQueue.setChoice(kind, id, choice);
    if (choice === "mine") publishQueue.publishNow(kind, id).catch(() => {});
    return true;
  });
  handle("publish:get-link", async (_e, kind, id) => {
    let record = await findPublishRecord(kind, id);
    if (!record) throw new Error(`${kind === "comp" ? "Comp" : "Build"} not found.`);
    if (!record.publishedFileId) {
      await publishAndWait(kind, id);
      record = await findPublishRecord(kind, id);
    }
    return publishedLinkFor(kind, record);
  });
  async function bulkCandidates() {
    const [builds, comps] = await Promise.all([store.listBuilds(), compStore.listComps()]);
    return bulkPublishCandidates({ builds, comps });
  }
  handle("publish:bulk-candidates", async () => (await bulkCandidates()).length);
  handle("publish:bulk-enqueue", async () => {
    const items = await bulkCandidates();
    publishQueue.enqueueMany(items);
    return items.length;
  });
  handle("publish:resume", async () => {
    publishQueue.resume().catch(() => {});
    return true;
  });
```

Remove now-unused names from the index.js requires only if nothing else in the file uses them. Check each with `grep -n "<name>" src/main/index.js`:
- `planCompMembers`
- `memberStampTargets`
- `generateFileId`
- `generateEncryptionKey`
- `getDefaultBuildName`
- `slugifyBuildName`
- `buildRedirectFile`
- `buildReceipt`
- `compReceipt`

Keep `buildEncryptedBuildFile`, `buildEncryptedCompFile`, `serializeCompForPublish`, `formatStamp`, `getCompPublishBuildIds` and `PROFESSION_THEME_IDS`. They are still used by `addFormatMigrations`, `stampFormatMigrations` and `publishedLinkFor`.

**3f. Resume on sign-in and setup.** In `handle("auth:complete-login", …)`, after `recheckAccess();` add:

```js
    publishQueueRef?.resume().catch(() => {});
```

Replace the two setup handlers:

```js
  // Finishing setup resumes anything saved while publishing wasn't connected.
  async function afterPublishSetup(result) {
    publishQueue.resume().catch(() => {});
    return result;
  }

  handle("onboarding:setup-repo-pages", async (_e, targetOwner, ownerType = "user") =>
    afterPublishSetup(await setupRepoPages(targetOwner, ownerType))
  );

  handle("onboarding:setup-fork-pages", async (_e, targetOwner, ownerType = "user") =>
    afterPublishSetup(await setupRepoPages(targetOwner, ownerType))
  );
```

**3g. Discord share waits for an in-flight upload.** Put the wait on the first line inside each handler body, before the webhook lookup. A share with no webhooks then still waits, which is harmless, and the test harness, which configures no webhooks, can observe it.

In `handle("discord:share-comp", async (_e, compId, webhookIds) => {`, the first lines become:

```js
    const compWaitError = await settlePendingPublish("comp", compId);
    if (compWaitError) return { success: false, error: compWaitError };
```

In `handle("discord:share-build", async (_e, buildId, webhookIds) => {`, the first lines become:

```js
    const buildWaitError = await settlePendingPublish("build", buildId);
    if (buildWaitError) return { success: false, error: buildWaitError };
```

**3h. Quit.** Directly above `app.on("will-quit", () => {`, add:

```js
// Saves still waiting to publish get one round (10 s at most) before the app
// exits. Anything unfinished stays in publish-queue.json for the next launch.
let publishFlushedForQuit = false;
app.on("before-quit", (event) => {
  if (publishFlushedForQuit || !publishQueueRef?.hasPending()) return;
  event.preventDefault();
  publishFlushedForQuit = true;
  publishQueueRef.flushForQuit().finally(() => app.quit());
});
```

Inside the `will-quit` handler, after `if (teamSyncRef) teamSyncRef.stopPolling();`, add:

```js
  if (publishQueueRef) publishQueueRef.stop();
```

- [ ] **Step 4: Bridge the new IPC**

In `src/preload/index.js`, after the `getCompPublishedUrl:` line, add:

```js
  getPublishSnapshot: () => invoke("publish:snapshot"),
  retryPublish: (kind, id) => invoke("publish:retry", kind, id),
  setPublishChoice: (kind, id, choice) => invoke("publish:set-choice", kind, id, choice),
  getPublishLink: (kind, id) => invoke("publish:get-link", kind, id),
  getBulkPublishCount: () => invoke("publish:bulk-candidates"),
  bulkPublish: () => invoke("publish:bulk-enqueue"),
  resumePublishing: () => invoke("publish:resume"),
```

After the `onPublishProgress` block, add:

```js
  onPublishStatus: (cb) => {
    ipcRenderer.removeAllListeners("publish:status");
    ipcRenderer.on("publish:status", (_e, snapshot) => cb(snapshot));
  },
  onPublishOwnerChoice: (cb) => {
    ipcRenderer.removeAllListeners("publish:needs-owner-choice");
    ipcRenderer.on("publish:needs-owner-choice", (_e, ask) => cb(ask));
  },
```

In `src/web/webApi/stubs.js`, after `getCompPublishedUrl: async () => null,`, add:

```js
    getPublishSnapshot: async () => ({ items: {}, paused: null, published: [] }),
    retryPublish: noop,
    setPublishChoice: noop,
    getPublishLink: async () => null,
    getBulkPublishCount: async () => 0,
    bulkPublish: async () => 0,
    resumePublishing: noop,
```

After `onPublishProgress: onEvent,`, add:

```js
    onPublishStatus: onEvent,
    onPublishOwnerChoice: onEvent,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/unit/teamsIpc.test.js tests/unit/preloadPublish.test.js tests/unit/publishWiring.test.js tests/unit/localApi.test.js tests/web/stubs.test.js tests/unit/preload`
Expected: PASS.
- If `publishWiring.test.js` fails on `handle\("comps:publish-comp", \(event, compId, opts\)`, the new handler's parameter names drifted. They must be exactly `(event, compId, opts)`.
- If "a save that leaves the published content alone" fails, the stored record from `builds:list` carries `contentHash`. `withoutReceiptHashes` keeps it, but `normalizeBuild` drops it. Check `autoPublishDecision` gets `annotateBuild(saved)`, not the payload.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.js src/preload/index.js src/web/webApi/stubs.js tests/unit/teamsIpc.test.js tests/unit/preloadPublish.test.js
git commit -m "feat(publish): saving publishes through the queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Viewer reads data pinned to the latest commit

**Files:**
- Modify: `src/site/rawBase.js`
- Modify: `src/site/comp-members.js:34-45`
- Modify: `src/site/main.js:4,77-93`
- Test: `tests/unit/site/rawBase.test.js`, `tests/unit/site/comp-members.test.js`

**Interfaces:**
- Produces:
  - `pinnedRawBase(owner, repo, fetchImpl?, { timeoutMs = 3000 }?) → Promise<string>` (memoized per `owner/repo`)
  - `resolvePinnedBase(location, searchParams, fetchImpl?) → Promise<string>`
  - `_resetPinnedBases()` (tests only)
  - `resolveDataBase` is unchanged.
  - `loadCompMembers(comp, { fallbackBase, loc, fetchImpl, baseForOwner? })`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/site/rawBase.test.js`:

```js
const { resolvePinnedBase, pinnedRawBase, _resetPinnedBases } = require("../../../src/site/rawBase");

describe("resolvePinnedBase", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const loc = { hostname: "me.github.io", pathname: "/axibuilds/" };
  const textRes = (body, ok = true, status = 200) => ({ ok, status, text: async () => body });
  beforeEach(() => _resetPinnedBases());

  test("pins the base to the commit the API names", async () => {
    const fetchImpl = jest.fn(async () => textRes(`${SHA}\n`));
    await expect(resolvePinnedBase(loc, sp(""), fetchImpl))
      .resolves.toBe(`https://raw.githubusercontent.com/me/axibuilds/${SHA}/site/`);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/repos/me/axibuilds/commits/main", expect.objectContaining({
      headers: { Accept: "application/vnd.github.sha" },
      cache: "no-store",
    }));
  });

  test.each([
    ["a 403", () => textRes("rate limited", false, 403)],
    ["a 429", () => textRes("slow down", false, 429)],
    ["a malformed body", () => textRes("<html>")],
    ["a network error", () => { throw new TypeError("Failed to fetch"); }],
  ])("falls back to main on %s", async (_label, respond) => {
    const fetchImpl = jest.fn(async () => respond());
    await expect(resolvePinnedBase(loc, sp(""), fetchImpl))
      .resolves.toBe("https://raw.githubusercontent.com/me/axibuilds/main/site/");
  });

  test("falls back to main after 3 s without an answer", async () => {
    jest.useFakeTimers();
    try {
      const pending = resolvePinnedBase(loc, sp(""), () => new Promise(() => {}));
      await jest.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toBe("https://raw.githubusercontent.com/me/axibuilds/main/site/");
    } finally {
      jest.useRealTimers();
    }
  });

  test("remoteBase wins and makes no lookup", async () => {
    const fetchImpl = jest.fn();
    await expect(resolvePinnedBase(loc, sp("remoteBase=http://x/site/"), fetchImpl)).resolves.toBe("http://x/site/");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("off github.io the base stays relative", async () => {
    await expect(resolvePinnedBase({ hostname: "localhost", pathname: "/" }, sp(""), jest.fn())).resolves.toBe("");
  });

  test("one lookup per owner per page load, even in parallel", async () => {
    const fetchImpl = jest.fn(async () => textRes(SHA));
    await Promise.all([pinnedRawBase("mate", "axibuilds", fetchImpl), pinnedRawBase("mate", "axibuilds", fetchImpl), pinnedRawBase("me", "axibuilds", fetchImpl)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

Append to `tests/unit/site/comp-members.test.js`, inside the top-level `describe("comp members", …)`:

```js
  test("a member's data is read from the base its owner resolves to", async () => {
    const kA = generateEncryptionKey();
    const comp = { members: { a: { fileId: "aaaa1111", key: kA, owner: "mate" } } };
    const fetchImpl = jest.fn(async () => okBytes({ title: "A", profession: "Guardian" }, kA));
    const baseForOwner = jest.fn(async (owner) => `https://raw.githubusercontent.com/${owner}/axibuilds/SHA/site/`);
    await loadCompMembers(comp, { fallbackBase: "BASE/", loc, fetchImpl, baseForOwner });
    expect(baseForOwner).toHaveBeenCalledWith("mate");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://raw.githubusercontent.com/mate/axibuilds/SHA/site/builds/aaaa1111.enc");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/site/rawBase.test.js tests/unit/site/comp-members.test.js`
Expected: FAIL. `resolvePinnedBase is not a function`, and the member URL still uses `/main/`.

- [ ] **Step 3: Implement**

Replace `src/site/rawBase.js` with:

```js
// The viewer reads published data from raw.githubusercontent.com. raw's CDN
// serves /main/ up to ~5 minutes stale, so a page resolves the newest commit
// first and reads files pinned to it; a pinned URL can't answer with an older
// copy. Any failure falls back to /main/.

const SHA = /^[0-9a-f]{40}$/;
const LOOKUP_TIMEOUT_MS = 3000;
const TIMED_OUT = Symbol("timed out");
const pinned = new Map(); // "owner/repo" → Promise<base>, for this page load

function ownerRepo(location) {
  const m = (location.hostname || "").match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const repo = (location.pathname || "/").split("/").filter(Boolean)[0] || "";
  return repo ? { owner: m[1], repo } : null;
}

export function resolveDataBase(location, searchParams) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const where = ownerRepo(location);
  return where ? `https://raw.githubusercontent.com/${where.owner}/${where.repo}/main/site/` : "";
}

async function lookupPinnedBase(owner, repo, fetchImpl, timeoutMs) {
  const fallback = `https://raw.githubusercontent.com/${owner}/${repo}/main/site/`;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/main`, {
        headers: { Accept: "application/vnd.github.sha" },
        cache: "no-store",
        signal: controller?.signal,
      }),
      timedOut,
    ]);
    if (res === TIMED_OUT || !res?.ok) return fallback;
    const body = await Promise.race([res.text(), timedOut]);
    if (body === TIMED_OUT) return fallback;
    const sha = String(body).trim();
    return SHA.test(sha) ? `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/site/` : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** Data base for one owner's repo, pinned to its newest commit; one lookup per page load. */
export function pinnedRawBase(owner, repo, fetchImpl = globalThis.fetch, { timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const key = `${owner}/${repo}`;
  if (!pinned.has(key)) pinned.set(key, lookupPinnedBase(owner, repo, fetchImpl, timeoutMs));
  return pinned.get(key);
}

/** resolveDataBase, pinned to the newest commit when the page is on github.io. */
export async function resolvePinnedBase(location, searchParams, fetchImpl = globalThis.fetch) {
  const explicit = searchParams.get("remoteBase");
  if (explicit) return explicit;
  const where = ownerRepo(location);
  return where ? pinnedRawBase(where.owner, where.repo, fetchImpl) : "";
}

export function _resetPinnedBases() {
  pinned.clear();
}
```

In `src/site/comp-members.js`, change `loadCompMembers` so that:
- the signature becomes `export async function loadCompMembers(comp, { fallbackBase, loc, fetchImpl, baseForOwner = null })`;
- the URL line becomes:

```js
      const base = m?.owner && baseForOwner ? await baseForOwner(m.owner) : memberDataBase(m, fallbackBase);
      const url = `${base}builds/${encodeURIComponent(m.fileId)}.enc`;
```

Also add to its doc comment: "`baseForOwner(owner)` resolves an owner's data base (pinned to its newest commit in the viewer); without it, `memberDataBase`."

In `src/site/main.js`:
- Change the import on line 4 to `import { resolvePinnedBase, pinnedRawBase } from "./rawBase.js";`.
- In `loadBuild` and `loadComp`, replace `const base = resolveDataBase(location, new URLSearchParams(location.search));` with:

```js
    const base = await resolvePinnedBase(location, new URLSearchParams(location.search));
```

- Change the `loadCompMembers` call to:

```js
      const builds = await loadCompMembers(comp, {
        fallbackBase: base,
        loc: location,
        baseForOwner: (owner) => pinnedRawBase(owner, "axibuilds"),
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/site`
Expected: PASS, including the existing `resolveDataBase` and comp-members tests.

- [ ] **Step 5: Commit**

```bash
git add src/site/rawBase.js src/site/comp-members.js src/site/main.js tests/unit/site/rawBase.test.js tests/unit/site/comp-members.test.js
git commit -m "feat(viewer): read published data pinned to the newest commit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer publish logic (pure modules)

**Files:**
- Create: `src/renderer/modules/publish-button.js`
- Create: `src/renderer/modules/publish-prompts.js`
- Modify: `src/renderer/modules/share-gate.js`
- Test: `tests/unit/renderer/publish-button.test.js`, `tests/unit/renderer/publish-prompts.test.js`, `tests/unit/renderer/share-gate.test.js`

**Interfaces:**
- Consumes: the snapshot shape from Task 1 and the bridge methods from Task 4.
- Produces:
  - `publishButtonState({ queueItem, receipt, connection, now }) → { label, action, tone, icon, title }`
    - `action ∈ "setup"|"sign-in"|"retry"|"choose-owner"|"copy"|"publish-and-copy"`
    - `tone ∈ ""|"busy"|"warn"|"ok"`
    - `icon ∈ ""|"spinner"|"check"|"clock"`
  - `queueItemFor(snapshot, kind, id) → item|null`
  - `connectionFrom(onboarding) → { signedIn, connected }`
  - `applyPublishButton(btn, view)`
  - `runPublishButtonAction(action, { kind, id, owner }, deps)` with `deps = { api, openSetup, signIn, askOwnerChoice, notify }`
  - `ownerChoiceBody(kind, login)`, `askOwnerChoice(kind, id, owner, { confirm, api }) → Promise<boolean>`
  - `bulkPromptBody(count)`, `maybeShowBulkPublishPrompt({ api, onboarding, confirm }) → Promise<boolean>`, `BULK_PROMPT_SETTING = "bulkPublishPrompted"`
  - `shareDisabledTooltip(build, editorDirty, queueState = null)`, `compShareDisabledTooltip(comp, builds, queueState = null)`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/publish-button.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

const {
  publishButtonState, queueItemFor, connectionFrom, applyPublishButton, runPublishButtonAction,
} = require("../../../src/renderer/modules/publish-button.js");

const CONNECTED = { signedIn: true, connected: true };

describe("publishButtonState — every row of the spec's table", () => {
  test("disconnected → Set up publishing", () => {
    expect(publishButtonState({ receipt: "current", connection: { signedIn: false, connected: false } }))
      .toMatchObject({ label: "Set up publishing", action: "setup" });
    expect(publishButtonState({ queueItem: { state: "disconnected" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Set up publishing", action: "setup" });
  });

  test.each(["queued", "publishing"])("%s → Publishing… with a spinner, copies", (state) => {
    expect(publishButtonState({ queueItem: { state }, receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Publishing…", action: "copy", tone: "busy", icon: "spinner" });
  });

  test("current → Copy link ✓", () => {
    expect(publishButtonState({ receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "copy", tone: "ok", icon: "check" });
  });

  test("waiting → Copy link with a clock and the reason and retry time", () => {
    const view = publishButtonState({
      queueItem: { state: "waiting", reason: "rate-limit", retryAt: 61000 },
      receipt: "stale", connection: CONNECTED, now: 1000,
    });
    expect(view).toMatchObject({ label: "Copy link", action: "copy", icon: "clock" });
    expect(view.title).toMatch(/rate limit/i);
    expect(view.title).toMatch(/60s/);
    expect(publishButtonState({ queueItem: { state: "waiting", reason: "offline", retryAt: 0 }, receipt: "stale", connection: CONNECTED, now: 0 }).title)
      .toMatch(/offline/i);
  });

  test("failed → Retry, warning tone, error in the tooltip", () => {
    expect(publishButtonState({ queueItem: { state: "failed", error: "Not Found" }, receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Retry", action: "retry", tone: "warn", title: "Publishing failed: Not Found" });
  });

  test("unauthorized → Sign in to publish, even though onboarding still says connected", () => {
    expect(publishButtonState({ queueItem: { state: "unauthorized" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Sign in to publish", action: "sign-in" });
  });

  test("declined → Publish my copy", () => {
    expect(publishButtonState({ queueItem: { state: "declined", owner: "mate" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Publish my copy", action: "choose-owner", title: "Published by @mate" });
  });

  test("never published and not queued → Copy link (publishes, then copies)", () => {
    expect(publishButtonState({ receipt: "never", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "copy", icon: "" });
  });

  test("stale and not queued → Copy link that also publishes", () => {
    expect(publishButtonState({ receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "publish-and-copy" });
  });
});

describe("helpers", () => {
  test("queueItemFor", () => {
    const snap = { items: { "build:a": { state: "queued" } } };
    expect(queueItemFor(snap, "build", "a")).toEqual({ state: "queued" });
    expect(queueItemFor(snap, "comp", "a")).toBeNull();
    expect(queueItemFor(null, "build", "a")).toBeNull();
  });

  test("connectionFrom", () => {
    expect(connectionFrom(null)).toEqual({ signedIn: false, connected: false });
    expect(connectionFrom({ isAuthenticated: true })).toEqual({ signedIn: true, connected: false });
    expect(connectionFrom({ isAuthenticated: true, repoReady: true })).toEqual({ signedIn: true, connected: true });
  });

  test("applyPublishButton draws label, tone, icon, action and tooltip; the label is text", () => {
    const btn = document.createElement("button");
    applyPublishButton(btn, { label: "<b>x</b>", action: "copy", tone: "busy", icon: "spinner", title: "t" });
    expect(btn.dataset.action).toBe("copy");
    expect(btn.title).toBe("t");
    expect(btn.classList.contains("publish-btn--busy")).toBe(true);
    expect(btn.querySelector(".publish-btn__icon--spinner")).not.toBeNull();
    expect(btn.querySelector(".publish-btn__label").textContent).toBe("<b>x</b>");
    applyPublishButton(btn, { label: "Copy link", action: "copy", tone: "", icon: "", title: "" });
    expect(btn.classList.contains("publish-btn--busy")).toBe(false);
    expect(btn.querySelector(".publish-btn__icon")).toBeNull();
  });
});

describe("runPublishButtonAction", () => {
  const deps = () => ({
    api: {
      retryPublish: jest.fn(async () => true),
      getPublishLink: jest.fn(async () => "https://me.github.io/axibuilds/?n=x&b=f.k"),
      writeClipboardText: jest.fn(async () => {}),
    },
    openSetup: jest.fn(),
    signIn: jest.fn(),
    askOwnerChoice: jest.fn(),
    notify: jest.fn(),
  });

  test("copy fetches the link and copies it", async () => {
    const d = deps();
    await runPublishButtonAction("copy", { kind: "build", id: "a" }, d);
    expect(d.api.getPublishLink).toHaveBeenCalledWith("build", "a");
    expect(d.api.writeClipboardText).toHaveBeenCalledWith("https://me.github.io/axibuilds/?n=x&b=f.k");
    expect(d.notify).toHaveBeenCalledWith("Link copied!");
    expect(d.api.retryPublish).not.toHaveBeenCalled();
  });

  test("publish-and-copy queues a publish first", async () => {
    const d = deps();
    await runPublishButtonAction("publish-and-copy", { kind: "comp", id: "c" }, d);
    expect(d.api.retryPublish).toHaveBeenCalledWith("comp", "c");
    expect(d.api.writeClipboardText).toHaveBeenCalled();
  });

  test("a missing link is an error, not an empty clipboard", async () => {
    const d = deps();
    d.api.getPublishLink.mockResolvedValue(null);
    await expect(runPublishButtonAction("copy", { kind: "build", id: "a" }, d)).rejects.toThrow(/link/i);
    expect(d.api.writeClipboardText).not.toHaveBeenCalled();
  });

  test.each([
    ["setup", "openSetup"],
    ["sign-in", "signIn"],
  ])("%s calls %s", async (action, dep) => {
    const d = deps();
    await runPublishButtonAction(action, { kind: "build", id: "a" }, d);
    expect(d[dep]).toHaveBeenCalled();
  });

  test("retry and choose-owner", async () => {
    const d = deps();
    await runPublishButtonAction("retry", { kind: "build", id: "a" }, d);
    expect(d.api.retryPublish).toHaveBeenCalledWith("build", "a");
    await runPublishButtonAction("choose-owner", { kind: "build", id: "a", owner: "mate" }, d);
    expect(d.askOwnerChoice).toHaveBeenCalledWith("build", "a", "mate");
  });
});
```

Create `tests/unit/renderer/publish-prompts.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

const {
  ownerChoiceBody, askOwnerChoice, bulkPromptBody, maybeShowBulkPublishPrompt, BULK_PROMPT_SETTING,
} = require("../../../src/renderer/modules/publish-prompts.js");

describe("owner choice prompt", () => {
  test("the login is escaped", () => {
    const html = ownerChoiceBody("build", "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Your link will point at your account; their link keeps working but stops updating.");
  });

  test.each([[true, "mine"], [false, "theirs"]])("confirm %s stores %s", async (answer, choice) => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    const confirm = jest.fn(async () => answer);
    await expect(askOwnerChoice("comp", "c1", "mate", { confirm, api })).resolves.toBe(answer);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Publish my copy", cancelLabel: "Keep theirs" }));
    expect(api.setPublishChoice).toHaveBeenCalledWith("comp", "c1", choice);
  });
});

describe("bulk prompt", () => {
  const api = (over = {}) => ({
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
    getBulkPublishCount: jest.fn(async () => 7),
    bulkPublish: jest.fn(async () => 7),
    ...over,
  });
  const CONNECTED = { isAuthenticated: true, repoReady: true };

  test("asks once, remembers the answer, publishes on yes", async () => {
    const a = api();
    const confirm = jest.fn(async () => true);
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm })).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Publish your library?", confirmLabel: "Publish all", cancelLabel: "Not now" }));
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).toHaveBeenCalled();
  });

  test("\"Not now\" is remembered and publishes nothing", async () => {
    const a = api();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm: async () => false });
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).not.toHaveBeenCalled();
  });

  test("never shown twice", async () => {
    const a = api({ getSetting: jest.fn(async () => true) });
    const confirm = jest.fn();
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm })).resolves.toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("waits for setup: nothing happens while disconnected", async () => {
    const a = api();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: { isAuthenticated: true }, confirm: jest.fn() });
    expect(a.getSetting).not.toHaveBeenCalled();
  });

  test("with nothing unpublished it is marked done without asking", async () => {
    const a = api({ getBulkPublishCount: jest.fn(async () => 0) });
    const confirm = jest.fn();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
  });

  test("body text", () => {
    expect(bulkPromptBody(7)).toContain("You have 7 that have never been published.");
    expect(bulkPromptBody(1)).toContain("You have 1 that has never been published.");
    expect(bulkPromptBody(7)).toContain("It runs in the background, 50 at a time.");
  });
});
```

In `tests/unit/renderer/share-gate.test.js`, replace the first two `describe` blocks with:

```js
describe("shareDisabledTooltip", () => {
  test("never published", () => {
    expect(shareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }, false))
      .toBe("Not published yet — Copy link publishes it");
  });
  test("stale", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false))
      .toBe("Your latest changes aren't published yet");
  });
  test("editor dirty even if published+fresh", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, true))
      .toBe("Save your changes first");
  });
  test("shareable and clean → enabled (null)", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }, false))
      .toBeNull();
  });
  test.each(["queued", "publishing"])("an upload in flight does not block (main waits for it): %s", (state) => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false, state)).toBeNull();
  });
  test("a failed upload blocks with its own reason", () => {
    expect(shareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }, false, "failed"))
      .toBe("Publishing failed — retry it first");
  });
});

const { compShareDisabledTooltip } = require("../../../src/renderer/modules/share-gate");

describe("compShareDisabledTooltip", () => {
  test("never published", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "", updatedAt: "t", publishedAt: null }))
      .toBe("Not published yet — Copy link publishes it");
  });
  test("stale", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" }))
      .toBe("Your latest changes aren't published yet");
  });
  test("shareable → null", () => {
    expect(compShareDisabledTooltip({ publishedFileId: "x", updatedAt: "t1", publishedAt: "t1" }))
      .toBeNull();
  });
  test("queued → null; failed → blocked", () => {
    const stale = { publishedFileId: "x", updatedAt: "t2", publishedAt: "t1" };
    expect(compShareDisabledTooltip(stale, [], "queued")).toBeNull();
    expect(compShareDisabledTooltip(stale, [], "failed")).toBe("Publishing failed — retry it first");
  });
});
```

Leave the parity block and the member-builds block as they are. If the member-builds block asserts the old stale string, update it to `"Your latest changes aren't published yet"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/renderer/publish-button.test.js tests/unit/renderer/publish-prompts.test.js tests/unit/renderer/share-gate.test.js`
Expected: FAIL. The first two fail with "Cannot find module"; share-gate fails on the new strings.

- [ ] **Step 3: Implement**

Create `src/renderer/modules/publish-button.js`:

```js
// The "Copy link" button that replaced Publish (publish on save). One pure
// function decides what it says and does; the editor and the comp board draw
// the same view with applyPublishButton.

const ICONS = {
  spinner: '<span class="publish-btn__icon publish-btn__icon--spinner" aria-hidden="true"></span>',
  check: '<svg class="publish-btn__icon publish-btn__icon--check" viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clip-rule="evenodd"/></svg>',
  clock: '<svg class="publish-btn__icon publish-btn__icon--clock" viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .2.08.39.22.53l3 3a.75.75 0 1 0 1.06-1.06l-2.78-2.78V5Z" clip-rule="evenodd"/></svg>',
};
const TONES = ["busy", "warn", "ok"];

function view(label, action, { tone = "", icon = "", title = "" } = {}) {
  return { label, action, tone, icon, title };
}

function waitingTitle(item, now) {
  const why = item.reason === "rate-limit" ? "GitHub rate limit reached" : "Offline";
  const secs = item.retryAt ? Math.max(0, Math.ceil((item.retryAt - now) / 1000)) : null;
  return `${why} — the link shows your previous save.${secs !== null ? ` Retrying in ${secs}s.` : ""}`;
}

/**
 * @param {{queueItem?: {state: string, error?: string, reason?: string, retryAt?: number, owner?: string}|null,
 *          receipt?: "never"|"current"|"stale", connection?: {signedIn: boolean, connected: boolean}, now?: number}} input
 */
export function publishButtonState({ queueItem = null, receipt = "never", connection = {}, now = Date.now() } = {}) {
  const state = queueItem?.state || null;
  if (state === "unauthorized") {
    return view("Sign in to publish", "sign-in", { tone: "warn", title: "Your GitHub sign-in expired. Sign in again to keep publishing." });
  }
  if (!connection.connected || state === "disconnected") {
    return view("Set up publishing", "setup", { title: connection.signedIn ? "Choose where your builds publish" : "Sign in with GitHub to publish" });
  }
  if (state === "failed") {
    return view("Retry", "retry", { tone: "warn", title: `Publishing failed: ${queueItem.error || "unknown error"}` });
  }
  if (state === "declined") {
    return view("Publish my copy", "choose-owner", { title: queueItem.owner ? `Published by @${queueItem.owner}` : "Published by someone else" });
  }
  if (state === "queued" || state === "publishing") {
    return view("Publishing…", "copy", {
      tone: "busy", icon: "spinner",
      title: receipt === "never" ? "Uploading — the link is copied once it's live" : "Uploading your latest save — the link already works",
    });
  }
  if (state === "waiting") return view("Copy link", "copy", { icon: "clock", title: waitingTitle(queueItem, now) });
  if (receipt === "current") return view("Copy link", "copy", { tone: "ok", icon: "check", title: "Up to date" });
  if (receipt === "stale") return view("Copy link", "publish-and-copy", { title: "Your latest save isn't published yet — copying publishes it" });
  return view("Copy link", "copy", { title: "Not published yet — copying publishes it" });
}

export function queueItemFor(snapshot, kind, id) {
  return snapshot?.items?.[`${kind}:${id}`] || null;
}

export function connectionFrom(onboarding) {
  const signedIn = Boolean(onboarding?.isAuthenticated);
  return { signedIn, connected: Boolean(signedIn && onboarding?.repoReady) };
}

export function applyPublishButton(btn, v) {
  btn.dataset.action = v.action;
  btn.title = v.title || "";
  for (const tone of TONES) btn.classList.toggle(`publish-btn--${tone}`, v.tone === tone);
  btn.classList.add("publish-btn");
  btn.innerHTML = `${ICONS[v.icon] || ""}<span class="publish-btn__label"></span>`;
  btn.querySelector(".publish-btn__label").textContent = v.label;
}

/**
 * @param {string} action from publishButtonState
 * @param {{kind: "build"|"comp", id: string, owner?: string}} target
 * @param {{api: object, openSetup: Function, signIn: Function, askOwnerChoice: Function, notify: Function}} deps
 */
export async function runPublishButtonAction(action, { kind, id, owner = "" }, deps) {
  const { api, openSetup, signIn, askOwnerChoice, notify } = deps;
  if (action === "setup") return openSetup();
  if (action === "sign-in") return signIn();
  if (action === "retry") return api.retryPublish(kind, id);
  if (action === "choose-owner") return askOwnerChoice(kind, id, owner);
  if (action === "publish-and-copy") await api.retryPublish(kind, id);
  const url = await api.getPublishLink(kind, id);
  if (!url) throw new Error("This link isn't available yet. Try again once publishing finishes.");
  await api.writeClipboardText(url);
  notify("Link copied!");
  return undefined;
}
```

Create `src/renderer/modules/publish-prompts.js`:

```js
import { escapeHtml } from "./utils.js";

export const BULK_PROMPT_SETTING = "bulkPublishPrompted";

/** `login` is teammate-controlled and the body goes to innerHTML: escaped here. */
export function ownerChoiceBody(kind, login) {
  const noun = kind === "comp" ? "comp" : "build";
  const who = login ? `<strong>@${escapeHtml(login)}</strong>` : "someone else";
  return `<p>This ${noun} was published by ${who}.</p><p>Your link will point at your account; their link keeps working but stops updating.</p>`;
}

/** The once-per-item foreign-owner prompt. Resolves true for "Publish my copy". */
export async function askOwnerChoice(kind, id, owner, { confirm, api }) {
  const mine = await confirm({
    title: "Publish your own copy?",
    body: ownerChoiceBody(kind, owner),
    confirmLabel: "Publish my copy",
    cancelLabel: "Keep theirs",
  });
  await api.setPublishChoice(kind, id, mine ? "mine" : "theirs");
  return mine;
}

export function bulkPromptBody(count) {
  const n = Number(count) || 0;
  return `<p>Builds and comps now publish automatically when you save. You have ${n} that ${n === 1 ? "has" : "have"} never been published. Publish them all now?</p><p><em>It runs in the background, 50 at a time.</em></p>`;
}

let inFlight = false;

/**
 * The one-time bulk-publish prompt. Shown only once publishing is connected;
 * the answer (either one) is remembered so it never shows again.
 */
export async function maybeShowBulkPublishPrompt({ api, onboarding, confirm }) {
  if (inFlight) return false;
  if (!(onboarding?.isAuthenticated && onboarding?.repoReady)) return false;
  inFlight = true;
  try {
    if (await api.getSetting(BULK_PROMPT_SETTING)) return false;
    const count = await api.getBulkPublishCount();
    if (!count) {
      await api.setSetting(BULK_PROMPT_SETTING, true);
      return false;
    }
    const yes = await confirm({
      title: "Publish your library?",
      body: bulkPromptBody(count),
      confirmLabel: "Publish all",
      cancelLabel: "Not now",
    });
    await api.setSetting(BULK_PROMPT_SETTING, true);
    if (yes) await api.bulkPublish();
    return yes;
  } finally {
    inFlight = false;
  }
}
```

Replace `src/renderer/modules/share-gate.js`'s two functions (keep its imports):

```js
// queueState: this record's state in the publish queue. An upload in flight
// doesn't block: the main process waits for it before sharing.
const IN_FLIGHT = new Set(["queued", "publishing"]);
const FAILED = "Publishing failed — retry it first";
const NEVER = "Not published yet — Copy link publishes it";
const STALE = "Your latest changes aren't published yet";

export function compShareDisabledTooltip(comp, builds, queueState = null) {
  if (IN_FLIGHT.has(queueState)) return null;
  if (queueState === "failed") return FAILED;
  const { status } = compPublishStatus(comp, buildLookup(builds));
  if (status === "never") return NEVER;
  if (status === "stale") return STALE;
  return null;
}

export function shareDisabledTooltip(build, editorDirty, queueState = null) {
  if (editorDirty) return "Save your changes first";
  if (IN_FLIGHT.has(queueState)) return null;
  if (queueState === "failed") return FAILED;
  const status = publishStatus(build);
  if (status === "never") return NEVER;
  if (status === "stale") return STALE;
  return null;
}
```

Check that `escapeHtml` is exported from `src/renderer/modules/utils.js`; `publish-guard.js` already imports it from there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/renderer/publish-button.test.js tests/unit/renderer/publish-prompts.test.js tests/unit/renderer/share-gate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/publish-button.js src/renderer/modules/publish-prompts.js src/renderer/modules/share-gate.js tests/unit/renderer/publish-button.test.js tests/unit/renderer/publish-prompts.test.js tests/unit/renderer/share-gate.test.js
git commit -m "feat(publish): copy-link button state, prompts, queue-aware share gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Build editor button, status listener and prompts

**Files:**
- Create: `src/renderer/modules/publish-actions.js`
- Modify: `src/renderer/modules/state.js` (`publishProgress: {},` line)
- Modify: `src/renderer/modules/render-pages.js:502-511` (canPublish block), `:595-601` (share tooltip)
- Modify: `src/renderer/renderer.js` (online listener ~739, `refreshOnboardingStatus` ~1133, publish-progress listener 1630-1641, publish click handler 1644-1731, discord-embed ~1552)
- Modify: `src/renderer/index.html:86`
- Modify: `src/renderer/styles/buttons.css`
- Test: `tests/unit/renderer/publish-actions.test.js` (create), `tests/unit/renderer/editor-publish-button.test.js` (create)

**Interfaces:**
- Consumes: Task 6's exports and Task 4's bridge.
- Produces:
  - `publishButtonDeps() → deps` for `runPublishButtonAction`
  - `applyPublishSnapshot(snapshot) → Promise<boolean>` (true when lists were reloaded)
  - `isPublishInFlight(kind, id) → boolean`
  - `renderEditorPublishButton()` (exported from render-pages.js)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/publish-actions.test.js`:

```js
/** @jest-environment jsdom */
"use strict";

jest.mock("../../../src/renderer/modules/settings-modal.js", () => ({ openSettingsModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/render-pages.js", () => ({ startLoginFlow: jest.fn(async () => {}) }));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../../src/renderer/modules/library/toast.js", () => ({ showToast: jest.fn() }));

const { state } = require("../../../src/renderer/modules/state.js");
const { applyPublishSnapshot, isPublishInFlight, publishButtonDeps } = require("../../../src/renderer/modules/publish-actions.js");
const { openSettingsModal } = require("../../../src/renderer/modules/settings-modal.js");

beforeEach(() => {
  window.desktopApi = {
    listBuilds: jest.fn(async () => [{ id: "b1", publishedFileId: "f", publishedHash: "h" }]),
    listComps: jest.fn(async () => [{ id: "c1", name: "Raid", publishedFileId: "cf", notes: "stored" }]),
    getOnboardingStatus: jest.fn(async () => ({ isAuthenticated: true, repoReady: true })),
  };
  state.builds = [{ id: "b1" }];
  state.comps = [];
  state.activeComp = { id: "c1", name: "Raid", notes: "typing…" };
});

test("a snapshot is stored; lists reload only when something was published", async () => {
  await expect(applyPublishSnapshot({ items: { "build:b1": { state: "queued" } }, paused: null, published: [] })).resolves.toBe(false);
  expect(state.publishQueue.items["build:b1"].state).toBe("queued");
  expect(window.desktopApi.listBuilds).not.toHaveBeenCalled();

  await expect(applyPublishSnapshot({ items: {}, paused: null, published: ["build:b1", "comp:c1"] })).resolves.toBe(true);
  expect(state.builds[0].publishedFileId).toBe("f");
});

test("the open comp takes the new receipt but keeps its unsaved fields", async () => {
  await applyPublishSnapshot({ items: {}, paused: null, published: ["comp:c1"] });
  expect(state.activeComp).toMatchObject({ publishedFileId: "cf", notes: "typing…" });
});

test("isPublishInFlight", async () => {
  await applyPublishSnapshot({ items: { "build:a": { state: "publishing" }, "build:b": { state: "failed" } }, paused: null, published: [] });
  expect(isPublishInFlight("build", "a")).toBe(true);
  expect(isPublishInFlight("build", "b")).toBe(false);
  expect(isPublishInFlight("comp", "x")).toBe(false);
});

test("setup opens the Publishing settings pane", async () => {
  await publishButtonDeps().openSetup();
  expect(openSettingsModal).toHaveBeenCalledWith({ initialPane: "publishing" });
});
```

Create `tests/unit/renderer/editor-publish-button.test.js`. `render-pages.js` loads under jsdom without mocks; `share-accent.test.js` already requires it directly.

```js
/** @jest-environment jsdom */
"use strict";

const { editorPublishView } = require("../../../src/renderer/modules/render-pages.js");
const { state } = require("../../../src/renderer/modules/state.js");

beforeEach(() => {
  state.onboarding = { isAuthenticated: true, repoReady: true };
  state.editor = { id: "b1", title: "X" };
  state.builds = [{ id: "b1", publishedFileId: "f", publishedHash: "h", contentHash: "h" }];
  state.publishQueue = { items: {}, paused: null, published: [] };
});

test("an upload in flight for the open build reads Publishing…", () => {
  state.publishQueue = { items: { "build:b1": { state: "publishing" } }, paused: null, published: [] };
  expect(editorPublishView()).toMatchObject({ label: "Publishing…", action: "copy" });
});

test("a current build reads Copy link ✓", () => {
  expect(editorPublishView()).toMatchObject({ label: "Copy link", tone: "ok", icon: "check" });
});

test("another build's queue state does not leak onto the open one", () => {
  state.publishQueue = { items: { "build:other": { state: "failed", error: "x" } }, paused: null, published: [] };
  expect(editorPublishView()).toMatchObject({ label: "Copy link", tone: "ok" });
});

test("a new, unsaved build reads as never published", () => {
  state.editor = { id: null };
  expect(editorPublishView()).toMatchObject({ label: "Copy link", action: "copy", icon: "" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/renderer/publish-actions.test.js tests/unit/renderer/editor-publish-button.test.js`
Expected: FAIL. "Cannot find module …/publish-actions.js", and "editorPublishView is not a function".

- [ ] **Step 3: Implement**

**State.** In `src/renderer/modules/state.js`, after `publishProgress: {},`, add:

```js
  // Publish queue snapshot from the main process (publishQueue.js).
  publishQueue: { items: {}, paused: null, published: [] },
```

**Live deps.** Create `src/renderer/modules/publish-actions.js`:

```js
import { state } from "./state.js";
import { openSettingsModal } from "./settings-modal.js";
import { startLoginFlow } from "./render-pages.js";
import { showConfirmModal } from "./confirm-modal.js";
import { showToast } from "./library/toast.js";
import { askOwnerChoice } from "./publish-prompts.js";
import { queueItemFor } from "./publish-button.js";
import { PUBLISH_RECEIPT_FIELDS } from "./publish-status.js";

/** What the Copy link button needs from the app, for runPublishButtonAction. */
export function publishButtonDeps() {
  return {
    api: window.desktopApi,
    openSetup: () => openSettingsModal({ initialPane: "publishing" }),
    signIn: async () => {
      await startLoginFlow();
      state.onboarding = await window.desktopApi.getOnboardingStatus();
    },
    askOwnerChoice: (kind, id, owner) => askOwnerChoice(kind, id, owner, { confirm: showConfirmModal, api: window.desktopApi }),
    notify: (message) => showToast(message),
  };
}

export function isPublishInFlight(kind, id) {
  const s = queueItemFor(state.publishQueue, kind, id)?.state;
  return s === "queued" || s === "publishing";
}

/**
 * Store a queue snapshot. When items just published, reload the lists so their
 * receipts (status dots, links) are current. The open comp takes only the
 * receipt: it may hold edits newer than the stored record.
 * @returns {Promise<boolean>} whether the lists were reloaded
 */
export async function applyPublishSnapshot(snapshot) {
  state.publishQueue = snapshot || { items: {}, paused: null, published: [] };
  if (!snapshot?.published?.length) return false;
  const [builds, comps] = await Promise.all([window.desktopApi.listBuilds(), window.desktopApi.listComps()]);
  state.builds = builds;
  state.comps = comps;
  if (state.activeComp) {
    const fresh = comps.find((c) => c.id === state.activeComp.id);
    if (fresh) {
      const receipt = {};
      for (const key of PUBLISH_RECEIPT_FIELDS) if (key in fresh) receipt[key] = fresh[key];
      state.activeComp = { ...state.activeComp, ...receipt };
    }
  }
  return true;
}
```

`PUBLISH_RECEIPT_FIELDS` is exported from `publish-status.js:8` and lists `publishedSlug, publishedFileId, publishedKey, publishedAt, publishedOwner, publishedHash, publishedMemberHashes, publishedFormat`.

**Editor render.** In `src/renderer/modules/render-pages.js`:
- Add imports:

```js
import { publishButtonState, queueItemFor, connectionFrom, applyPublishButton } from "./publish-button.js";
```

  `publishStatus` is already imported from `./publish-status.js` for `publishBadgeHtml` callers. If it isn't, add it to that import.
- Replace the block from `const status = state.onboarding;` through the closing `}` of the `else { _el.publishSiteBtn.title = ""; }` with:

```js
  renderEditorPublishButton();
```

- Add the exported function near `resolvePublishedUrl`:

```js
// The editor's Copy link button (publish on save): queue state for the open
// build, else its receipt.
export function editorPublishView() {
  const id = state.editor?.id || null;
  const build = id ? state.builds.find((b) => b.id === id) : null;
  return publishButtonState({
    queueItem: queueItemFor(state.publishQueue, "build", id),
    receipt: build ? publishStatus(build) : "never",
    connection: connectionFrom(state.onboarding),
  });
}

export function renderEditorPublishButton() {
  const id = state.editor?.id || null;
  applyPublishButton(_el.publishSiteBtn, editorPublishView());
  _el.publishSiteBtn.disabled = !id;
  if (!id) _el.publishSiteBtn.title = "Save the build first";
}
```

- At the share-tooltip call (around line 595), change `shareDisabledTooltip(_shareBuild, state.editorDirty)` to:

```js
shareDisabledTooltip(_shareBuild, state.editorDirty, queueItemFor(state.publishQueue, "build", _shareBuild?.id)?.state || null)
```

**Renderer.** In `src/renderer/renderer.js`:
- Add imports:

```js
import { runPublishButtonAction, queueItemFor } from "./modules/publish-button.js";
import { maybeShowBulkPublishPrompt, askOwnerChoice } from "./modules/publish-prompts.js";
import { publishButtonDeps, applyPublishSnapshot, isPublishInFlight } from "./modules/publish-actions.js";
```

  `renderEditorMeta()` (render-pages.js) now draws the button, so renderer.js needs no new render-pages import.
- Delete the `// Listen for publish progress events from main process` block (`window.desktopApi.onPublishProgress(...)`). Main no longer sends `publish-progress`.
- Replace the whole `el.publishSiteBtn.addEventListener("click", async () => { … });` handler with:

```js
  // Copy link (publish on save): what a click does comes from the button's
  // current state, drawn by renderEditorPublishButton.
  el.publishSiteBtn.addEventListener("click", () => {
    const id = state.editor.id;
    if (!id) return;
    const owner = queueItemFor(state.publishQueue, "build", id)?.owner
      || state.builds.find((b) => b.id === id)?.publishedOwner || "";
    runPublishButtonAction(el.publishSiteBtn.dataset.action, { kind: "build", id, owner }, publishButtonDeps())
      .catch(showError);
  });

  // The comp board and the library request Copy link actions through this
  // event, so those modules don't import the app-level deps (settings modal,
  // login flow). That keeps them loadable in node-env tests.
  window.addEventListener("axi:publish-action", (e) => {
    const { action, kind, id, owner = "" } = e.detail || {};
    if (!action || !kind || !id) return;
    runPublishButtonAction(action, { kind, id, owner }, publishButtonDeps()).catch(showError);
  });

  window.desktopApi.onPublishStatus(async (snapshot) => {
    if (await applyPublishSnapshot(snapshot)) renderBuildList();
    renderEditorMeta();
    window.dispatchEvent(new CustomEvent("axi:publish-status"));
  });
  window.desktopApi.onPublishOwnerChoice(({ kind, id, owner }) => {
    askOwnerChoice(kind, id, owner, { confirm: showConfirmModal, api: window.desktopApi }).catch(showError);
  });
  window.desktopApi.getPublishSnapshot().then(applyPublishSnapshot).then(() => renderEditorMeta()).catch(() => {});
```

- In the existing `window.addEventListener("online", () => { … })` body, add:

```js
    window.desktopApi.resumePublishing?.().catch(() => {});
```

- At the end of `refreshOnboardingStatus()`, add:

```js
  // Once publishing is connected (startup or right after setup), offer to
  // publish the never-published library, once.
  maybeShowBulkPublishPrompt({ api: window.desktopApi, onboarding: state.onboarding, confirm: showConfirmModal }).catch(showError);
```

- In the editor's `discord-embed` click handler (around line 1552), just before `await window.desktopApi.shareBuildToDiscord(...)`, add:

```js
        if (isPublishInFlight("build", buildId)) showToast("Waiting for your latest save to upload…", "loading");
```

  If `showToast` isn't imported in renderer.js, import it from `./modules/library/toast.js`. Also, that handler's catch block re-enables `el.publishSiteBtn`; delete that line, because the button no longer disables during a share.

**Markup.** In `src/renderer/index.html:86`, change the button to:

```html
            <button id="publishSiteBtn" class="axi-btn axi-btn--ghost publish-btn" type="button">Copy link</button>
```

**Styles.** Append to `src/renderer/styles/buttons.css`:

```css
/* Copy link button (publish on save) */
.publish-btn { display: inline-flex; align-items: center; gap: 6px; }
.publish-btn__icon { flex: none; }
.publish-btn__icon--spinner {
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: publish-btn-spin 0.8s linear infinite;
}
.publish-btn--busy { opacity: 0.85; }
.publish-btn--warn { color: var(--axi-warn); }
.publish-btn--ok .publish-btn__icon--check { color: var(--axi-accent); }
@keyframes publish-btn-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/renderer`
Expected: PASS.
- If `publish-progress.test.js` or `publish-by-other.test.js` fail because they drove the deleted handler, read them. Delete only the assertions about the removed click handler. Keep the ones that test `render-pages.js` progress helpers or `publish-guard.js`, which still exist.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/publish-actions.js src/renderer/modules/state.js src/renderer/modules/render-pages.js src/renderer/renderer.js src/renderer/index.html src/renderer/styles/buttons.css tests/unit/renderer
git commit -m "feat(publish): editor Copy link button, live status, bulk and owner prompts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Comp board button, library menu and share tooltips

**Files:**
- Modify: `src/renderer/modules/comps/comp-detail.js` (markup ~491-498, share tip ~465, badge 420-425, publish handler 1407-1452, progress restore 1454-1460)
- Modify: `src/renderer/modules/library/context-menu.js:198,217`
- Modify: `src/renderer/modules/library/library.js:1583-1586,1931`
- Test: `tests/unit/renderer/comp-publish-button.test.js` (create), `tests/unit/renderer/library-context-menu-teams.test.js` (update the label, if it asserts "Publish")

**Interfaces:**
- Consumes:
  - Task 6: `publishButtonState`, `applyPublishButton`, `queueItemFor`, `connectionFrom`.
  - Task 7: the `axi:publish-action` window event (`detail: {action, kind, id, owner}`) and the `axi:publish-status` event.
- Produces: `compPublishView(comp, snapshot, onboarding) → view` (exported from comp-detail.js, pure).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/comp-publish-button.test.js`. `comp-detail.js` loads without mocks; `comp-move-slot.test.js` already requires it directly.

```js
/** @jest-environment jsdom */
"use strict";

const { compPublishView } = require("../../../src/renderer/modules/comps/comp-detail.js");

const CONNECTED = { isAuthenticated: true, repoReady: true };
const comp = { id: "c1", name: "Raid", publishedFileId: "cf", publishedHash: "h", contentHash: "h" };

test("queued comp → Publishing…", () => {
  expect(compPublishView(comp, { items: { "comp:c1": { state: "queued" } } }, CONNECTED))
    .toMatchObject({ label: "Publishing…", action: "copy" });
});

test("current comp → Copy link ✓", () => {
  expect(compPublishView(comp, { items: {} }, CONNECTED)).toMatchObject({ label: "Copy link", icon: "check" });
});

test("not connected → Set up publishing", () => {
  expect(compPublishView(comp, { items: {} }, { isAuthenticated: false })).toMatchObject({ action: "setup" });
});

test("a comp's receipt is judged on its own fields (v2 links members)", () => {
  expect(compPublishView({ ...comp, contentHash: "other" }, { items: {} }, CONNECTED)).toMatchObject({ action: "publish-and-copy" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/renderer/comp-publish-button.test.js`
Expected: FAIL with "compPublishView is not a function".

- [ ] **Step 3: Implement**

In `src/renderer/modules/comps/comp-detail.js`:

- Add imports:

```js
import { publishButtonState, queueItemFor, connectionFrom, applyPublishButton } from "../publish-button.js";
```

  `compPublishStatus`/`buildLookup` are already imported for the badge.
- Add next to `renderCompPublishBadge`:

```js
// The comp board's Copy link button (publish on save).
export function compPublishView(comp, snapshot, onboarding) {
  const { status } = compPublishStatus(comp, buildLookup(state.builds || []));
  return publishButtonState({
    queueItem: queueItemFor(snapshot, "comp", comp?.id),
    receipt: status,
    connection: connectionFrom(onboarding),
  });
}

function renderCompPublishButton() {
  const btn = document.getElementById("compPublishBtn");
  if (!btn || !state.activeComp) return;
  applyPublishButton(btn, compPublishView(state.activeComp, state.publishQueue, state.onboarding));
}
```

- At the end of `renderCompPublishBadge()`, add `renderCompPublishButton();` so every redraw of the badge redraws the button.
- In the markup, replace `<button type="button" class="axi-btn axi-btn--ghost" data-action="publish">Publish</button>` with:

```js
<button type="button" class="axi-btn axi-btn--ghost publish-btn" id="compPublishBtn" data-action="copy">Copy link</button>
```

- At the share tip (~465), change `compShareDisabledTooltip(comp, state.builds)` to:

```js
compShareDisabledTooltip(comp, state.builds, queueItemFor(state.publishQueue, "comp", comp.id)?.state || null)
```

- Replace the whole `container.querySelector("[data-action='publish']")?.addEventListener("click", async () => { … });` handler (1407-1452), and the `state.publishProgress[comp.id]` restore block right after it (1454-1460), with:

```js
  // renderer.js runs the action (axi:publish-action), with the app-level deps.
  container.querySelector("#compPublishBtn")?.addEventListener("click", (e) => {
    const action = e.currentTarget.dataset.action;
    const owner = queueItemFor(state.publishQueue, "comp", comp.id)?.owner || comp.publishedOwner || "";
    window.dispatchEvent(new CustomEvent("axi:publish-action", { detail: { action, kind: "comp", id: comp.id, owner } }));
  });
  renderCompPublishButton();
```

  If an unused-import check fails because `publishWithOwnerCheck`, `publishedByOtherBody`, `setPublishStatusEl`, `showPublishProgress`, `advancePublishStep`, `showPublishResult`, `failPublishStep`, `clearPublishProgress`, `completeAllPublishSteps` or `restorePublishProgress` are no longer used in this file, remove them from its imports.
- Redraw on queue events. Register the listener once, at module level, directly below `renderCompPublishButton`. Task 7 dispatches the event:

```js
// renderer.js dispatches this after every publish-queue snapshot. Both
// renderers return early when the comp view isn't open. Guarded: node-env
// tests (comp-move-slot.test.js) require this module without a window.
if (typeof window !== "undefined") {
  window.addEventListener("axi:publish-status", () => renderCompPublishBadge());
}
```

In `src/renderer/modules/library/context-menu.js`:
- Line 217 becomes:

```js
    _item(linkIcon, "Copy link", null, () => _callbacks.onPublish?.(buildId)),
```

  Use the file's existing link icon if there is one (`grep -n "Icon" context-menu.js`); otherwise keep `globeAltIcon`.
- At line 198, change `shareDisabledTooltip(build, false)` to:

```js
shareDisabledTooltip(build, false, queueItemFor(state.publishQueue, "build", build.id)?.state || null)
```

  Import `queueItemFor` from `../publish-button.js`, and `state` if it isn't already imported.

In `src/renderer/modules/library/library.js`, replace `handlePublish`:

```js
// Copy link from the library (publish on save): publishes first when the
// build has never been published. renderer.js runs the action.
function handlePublish(buildId) {
  window.dispatchEvent(new CustomEvent("axi:publish-action", { detail: { action: "copy", kind: "build", id: buildId } }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/renderer`
Expected: PASS. If `library-context-menu-teams.test.js` asserts a "Publish" label, update it to "Copy link".

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/comps/comp-detail.js src/renderer/modules/library/context-menu.js src/renderer/modules/library/library.js tests/unit/renderer
git commit -m "feat(publish): Copy link on the comp board and in the library menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Backlog entries and full Jest run

**Files:**
- Modify: `docs/BACKLOG.md` (append under `## Bugs`, at the bottom of that section)

- [ ] **Step 1: Add the two out-of-scope entries**

Run `grep -n "folder.shared\|axiLinkImport" docs/BACKLOG.md` first. If either entry already exists, don't add it again. Otherwise append:

```markdown
- [ ] **Renderer build links ignore `publishedOwner`.** `resolvePublishedUrl`
  (`src/renderer/modules/render-pages.js`) builds the owner from the folder's
  `shared`/`orgName` walk and `onboarding.targetOwner`, while the main process
  (`publishedOwnerFor`, `shortUrl.js`) and the publish queue's
  `publish:get-link` use the receipt's `publishedOwner`. A build published by
  a team or another account can get a link to the wrong site from the editor's
  share dropdown. Copy link already goes through `publish:get-link`; the share
  dropdown's "Published Link" item still uses the renderer path. Out of scope
  for publish on save (spec 2026-10-07).

- [ ] **Desktop import of a published link still reads `/main/`.**
  `dataBases()` in `src/main/axiLinkImport.js` mirrors the old
  `resolveDataBase`, so importing a link right after its owner saved can get
  the version from up to ~5 minutes earlier. The viewer now pins to the newest
  commit (`pinnedRawBase`, `src/site/rawBase.js`); the importer could do the
  same.
```

- [ ] **Step 2: Run the whole Jest suite**

Run: `npm test`
Expected: all suites PASS. Don't run Playwright.
- If a suite outside the files this plan touched fails, check whether it read `publishBuildImpl`/`publishCompImpl` text, or the "Publish" label, before changing anything.
- Fix the root cause in the code this plan added. Don't loosen the assertion.

- [ ] **Step 3: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs(backlog): publish-on-save follow-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
