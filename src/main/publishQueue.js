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
