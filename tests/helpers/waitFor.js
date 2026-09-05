"use strict";

/**
 * Wait until `predicate()` is true, or fail with a useful message.
 *
 * Use this instead of spinning a fixed number of setImmediate ticks. The code
 * under test awaits the real stores, which are file-backed — those promises
 * resolve off the libuv threadpool, not the microtask queue, so "200 ticks" is
 * really a bet that N disk reads finish within 200 event-loop turns. That holds
 * on an idle laptop and fails on a loaded CI runner, which is exactly the shape
 * of a flake: green locally, red in CI, for no reason visible in the diff.
 *
 * The yield is still setImmediate — the check phase follows the poll phase, so
 * threadpool completions land between ticks. What changes is the bound: a
 * wall-clock deadline scales with how slow the machine actually is instead of
 * guessing. setTimeout is deliberately NOT used; several suites here run under
 * jest fake timers with only setImmediate/Date left real, and a setTimeout wait
 * would hang forever under those.
 */
async function waitFor(predicate, { timeoutMs = 5000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${label} still false after ${timeoutMs}ms`);
    }
    await new Promise((r) => setImmediate(r));
  }
}

/**
 * Yield for a while so any work that SHOULDN'T happen gets its chance to.
 *
 * The counterpart to waitFor, for negative assertions ("the repair is waiting,
 * not racing"). There is no condition to poll, so this is time-bounded on
 * purpose — but being wall-clock rather than tick-counted means it drains the
 * threadpool too, so it stays meaningful on a machine slower than this one.
 */
async function settle(ms = 50) {
  const until = Date.now() + ms;
  while (Date.now() < until) await new Promise((r) => setImmediate(r));
}

module.exports = { waitFor, settle };
