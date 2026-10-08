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

  test("a save made during a round that then fails for good stays queued", async () => {
    const gate = deferred();
    const { q, rounds } = makeQueue({
      runRound: async (items) => {
        if (rounds.length === 1) {
          await gate.promise;
          return { results: items.map((i) => ({ ...i, ok: false, error: new Error("Build must have a profession selected.") })) };
        }
        return ok(items);
      },
    });
    q.enqueue("build", "a");
    await adv(5000);
    q.enqueue("build", "a");
    gate.resolve();
    await adv(0);
    expect(q.snapshot().items["build:a"]).toEqual({ state: "queued" });
    await adv(5000);
    expect(rounds[1]).toEqual(["build:a"]);
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

  test("resume({ keepUnauthorized }) leaves an unauthorized pause alone", async () => {
    const { q, rounds } = makeQueue({
      runRound: async () => { throw coded("Bad credentials", { code: "GITHUB_UNAUTHORIZED", status: 401 }); },
    });
    q.enqueue("build", "a");
    await adv(5000);
    await q.resume({ keepUnauthorized: true });
    expect(q.snapshot().paused).toBe("unauthorized");
    expect(rounds).toHaveLength(1);
  });

  test("resume({ keepUnauthorized }) lifts a disconnected pause and an offline backoff", async () => {
    let fail = "disconnected";
    const { q, rounds } = makeQueue({
      runRound: async (items) => {
        if (fail === "disconnected") throw coded("Set up publishing to publish.", { code: "PUBLISH_DISCONNECTED" });
        if (fail === "offline") throw offline();
        return ok(items);
      },
    });
    q.enqueue("build", "a");
    await adv(5000);
    fail = "offline";
    await q.resume({ keepUnauthorized: true });
    expect(q.snapshot().paused).toBeNull();
    expect(q.snapshot().items["build:a"]).toMatchObject({ state: "waiting", reason: "offline" });
    fail = null;
    await q.resume({ keepUnauthorized: true });
    expect(rounds).toHaveLength(3);
    expect(q.snapshot().items["build:a"]).toBeUndefined();
  });

  test("publishNow({ unpause }) runs the item in one round with the paused ones", async () => {
    const { q, rounds } = makeQueue({
      runRound: async (items) => ({
        results: items.map((i) => (i.id === "broken"
          ? { ...i, ok: false, error: coded("Set up publishing to publish.", { code: "PUBLISH_DISCONNECTED" }) }
          : { ...i, ok: true })),
      }),
    });
    q.enqueue("build", "broken");
    await adv(5000);
    expect(q.snapshot().paused).toBe("disconnected");
    q.publishNow("build", "team", { unpause: true });
    await expect(q.awaitPublished("build", "team")).resolves.toMatchObject({ id: "team", ok: true });
    expect(rounds[1].sort()).toEqual(["build:broken", "build:team"]);
    expect(q.snapshot().paused).toBe("disconnected");
  });

  test("publishNow without unpause leaves a pause alone", async () => {
    const { q, rounds } = makeQueue({
      runRound: async () => { throw coded("Set up publishing to publish.", { code: "PUBLISH_DISCONNECTED" }); },
    });
    q.enqueue("build", "a");
    await adv(5000);
    await q.publishNow("build", "b");
    expect(rounds).toHaveLength(1);
    expect(q.snapshot().paused).toBe("disconnected");
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
