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

function rateLimitedError(at) {
  const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const err = new Error(`GitHub rate limit reached. Publishing again at ${time}.`);
  err.code = "GITHUB_RATE_LIMITED";
  err.retryAt = at;
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
    this._priority = new Set();    // keys an explicit publishNow asked for: next batch first
    this._arrived = new Set();     // keys enqueued while a drain runs: ride the next batch
    this._owed = new Set();        // explicit keys whose round failed transiently: first once the hold lifts
    this._timer = null;            // { id, firstAt }: the debounce
    this._retry = null;            // { id, at, reason: "offline" | "rate-limit" }
    this._attempt = 0;             // consecutive rounds with a network failure
    this._paused = null;           // null | "unauthorized" | "disconnected"
    this._blocked = new Set();     // keys whose own target isn't set up (a personal item, no personal site): held until resume or re-save
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

  /**
   * Enqueue and start a round now, skipping the debounce and any network backoff.
   * The item goes first in the next batch, even mid-drain. A GitHub rate limit
   * still holds it (another call would only hit the limit again); a waiter hears
   * that through awaitPublished.
   * `unpause` (an explicit publish) also lifts a pause, so the round carries this
   * item with everything else pending; an item still broken pauses it again.
   */
  publishNow(kind, id, { unpause = false } = {}) {
    const key = keyOf(kind, id);
    this._add(key);
    this._priority.add(key);
    if (unpause) this._paused = null;
    if (this._retry?.reason === "offline") this._clearRetry();
    this._changed();
    return this.flush();
  }

  /**
   * Sign-in, setup, focus or coming online: lift a pause and any network backoff.
   * `keepUnauthorized` (window focus) leaves an "unauthorized" pause in place:
   * only signing in again can fix bad credentials.
   */
  resume({ keepUnauthorized = false } = {}) {
    let changed = false;
    if (this._paused && !(keepUnauthorized && this._paused === "unauthorized")) { this._paused = null; changed = true; }
    if (this._blocked.size) { this._blocked.clear(); changed = true; }
    if (this._retry?.reason === "offline") { this._clearRetry(); changed = true; }
    if (changed) this._emit();
    return this._pending.size && !this._paused ? this.flush() : Promise.resolve();
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
    if (this._blocked.has(key)) return Promise.reject(pausedError("disconnected"));
    const deadline = this._now() + timeoutMs;
    // A rate limit that outlasts the wait can only end in a timeout: say why now.
    if (this._retry?.reason === "rate-limit" && this._retry.at > deadline) {
      return Promise.reject(rateLimitedError(this._retry.at));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null, deadline };
      waiter.timer = this._setTimeout(() => {
        const list = (this._waiters.get(key) || []).filter((w) => w !== waiter);
        if (list.length) this._waiters.set(key, list); else this._waiters.delete(key);
        if (this._retry?.reason === "rate-limit") {
          reject(rateLimitedError(this._retry.at));
          return;
        }
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
    return this._pending.size > this._blocked.size && !this._paused;
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
      else if (this._blocked.has(key)) items[key] = { state: "disconnected" };
      else if (this._retry) items[key] = { state: "waiting", reason: this._retry.reason, retryAt: this._retry.at };
      else items[key] = { state: "queued" };
    }
    return { items, paused: this._paused, published: [...this._justPublished] };
  }

  // ── internals ──────────────────────────────────────────────────────────

  _add(key) {
    this._failed.delete(key);
    this._blocked.delete(key);
    this._needsChoice.delete(key);
    this._pending.add(key);
    if (this._publishing.has(key)) this._resaved.add(key);
    if (this._running) this._arrived.add(key);
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

  /**
   * Rounds until the backlog (everything pending when the drain started) and
   * every explicit publishNow have had a round. Each batch is built fresh:
   * explicit items first, then saves made since the drain started, then the
   * backlog, up to batchSize. A save made mid-drain rides along in a batch that
   * has room; on its own it waits for its debounce timer, so a single item being
   * edited doesn't chase every keystroke.
   */
  async _drain() {
    const backlog = new Set([...this._pending].filter((k) => !this._blocked.has(k)));
    this._arrived.clear();
    for (;;) {
      if (this._paused) return;
      for (const k of this._priority) if (!this._pending.has(k)) this._priority.delete(k);
      for (const k of backlog) if (!this._pending.has(k)) backlog.delete(k);
      for (const k of this._owed) if (!this._pending.has(k)) this._owed.delete(k);
      // A backoff holds everything but an explicit publish; a rate limit holds all.
      const held = Boolean(this._retry);
      if (held && (this._retry.reason !== "offline" || !this._priority.size)) return;
      if (!this._priority.size && !backlog.size) return;
      const batch = new Set(this._priority);
      if (!held) {
        for (const source of [this._owed, this._arrived, backlog]) {
          for (const k of source) {
            if (batch.size >= this._batchSize) break;
            if (this._pending.has(k) && !this._blocked.has(k)) batch.add(k);
          }
        }
      }
      const keys = [...batch].slice(0, this._batchSize);
      const explicit = new Set(keys.filter((k) => this._priority.has(k) || this._owed.has(k)));
      for (const k of keys) {
        this._priority.delete(k);
        this._owed.delete(k);
        this._arrived.delete(k);
        backlog.delete(k);
      }
      await this._round(keys, explicit);
    }
  }

  async _round(batch, explicit = new Set()) {
    this._publishing = new Set(batch);
    this._resaved.clear();
    this._emit();
    let results;
    let roundFailed = false;
    try {
      results = (await this._runRound(batch.map(parseKey)))?.results || [];
    } catch (err) {
      roundFailed = true;
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
        // Committed but not live yet: published all the same; a waiter hears why
        // its link may not open yet.
        this._settle(key, r.notLive || null, r);
        continue;
      }
      const cls = classifyPublishError(r.error);
      if (cls === "transient" || cls === "rate-limited") {
        // An explicit item keeps its place at the front once the hold lifts.
        if (explicit.has(key)) this._owed.add(key);
      }
      if (cls === "transient") {
        transient = true;
        continue;
      }
      if (cls === "rate-limited") {
        const ms = Number(r.error?.retryAfterMs) || RATE_LIMIT_DEFAULT_MS;
        if (ms > wait) { wait = ms; waitReason = "rate-limit"; }
        continue;
      }
      if (cls === "disconnected" && !roundFailed) {
        // Only this item's target isn't set up (a personal build with no personal
        // site): hold it alone, so team items keep publishing.
        this._blocked.add(key);
        this._settle(key, pausedError(cls));
        continue;
      }
      if (cls === "unauthorized" || cls === "disconnected") {
        this._paused = cls;
        this._settle(key, pausedError(cls));
        continue;
      }
      if (this._resaved.has(key)) {
        // Saved again mid-round: this failure is about the old content. Keep the
        // newer save pending; its own debounce timer retries it.
        this._settle(key, r.error);
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
      // A rate limit keeps its reason even under a longer backoff, so an explicit
      // publish doesn't slip past the hold and hit the limit again.
      if (ms > wait) { wait = ms; if (!waitReason) waitReason = "offline"; }
    } else {
      this._attempt = 0;
    }
    this._publishing = new Set();
    if (wait && !this._paused) {
      this._setRetry(wait, waitReason);
      if (waitReason === "rate-limit") this._rejectOutlastedWaiters();
    }
    this._changed();
  }

  // A waiter whose deadline falls before the rate limit lifts hears why now,
  // instead of a generic timeout later. The item stays pending.
  _rejectOutlastedWaiters() {
    const at = this._retry.at;
    for (const [key, list] of this._waiters) {
      const keep = [];
      for (const w of list) {
        if (w.deadline < at) {
          this._clearTimeout(w.timer);
          w.reject(rateLimitedError(at));
        } else {
          keep.push(w);
        }
      }
      if (keep.length) this._waiters.set(key, keep); else this._waiters.delete(key);
    }
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
