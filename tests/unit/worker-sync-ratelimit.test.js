"use strict";
const { checkRateLimit } = require("../../workers/sync/src/ratelimit");
const { createTestKV } = require("../helpers/d1Shim");

test("allows `limit` hits per window then rejects with retryAfter", async () => {
  let t = 1_000_000;
  const deps = { now: () => t };
  const kv = createTestKV({ now: () => t });
  for (let i = 0; i < 3; i++) expect((await checkRateLimit(kv, "u1", 3, 60, deps)).ok).toBe(true);
  const rejected = await checkRateLimit(kv, "u1", 3, 60, deps);
  expect(rejected.ok).toBe(false);
  expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  expect(rejected.retryAfterSeconds).toBeLessThanOrEqual(60);
  t += 61_000; // next window
  expect((await checkRateLimit(kv, "u1", 3, 60, deps)).ok).toBe(true);
});

test("keys are independent", async () => {
  const kv = createTestKV();
  await checkRateLimit(kv, "a", 1, 60);
  expect((await checkRateLimit(kv, "a", 1, 60)).ok).toBe(false);
  expect((await checkRateLimit(kv, "b", 1, 60)).ok).toBe(true);
});

test("a missing KV binding fails open (never blocks writes)", async () => {
  expect((await checkRateLimit(undefined, "a", 1, 60)).ok).toBe(true);
});

test("cost consumes multiple slots per call", async () => {
  const kv = createTestKV();
  expect((await checkRateLimit(kv, "c", 10, 60, {}, 4)).ok).toBe(true); // 4/10
  expect((await checkRateLimit(kv, "c", 10, 60, {}, 4)).ok).toBe(true); // 8/10
  const rejected = await checkRateLimit(kv, "c", 10, 60, {}, 4); // would be 12/10
  expect(rejected.ok).toBe(false);
  expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
});

test("a too-large cost is rejected without incrementing the counter", async () => {
  const kv = createTestKV();
  expect((await checkRateLimit(kv, "d", 5, 60, {}, 1)).ok).toBe(true); // 1/5
  expect((await checkRateLimit(kv, "d", 5, 60, {}, 10)).ok).toBe(false); // over limit, no increment
  // Counter should still be at 1, so 4 more single-cost calls succeed (up to 5 total).
  for (let i = 0; i < 4; i++) expect((await checkRateLimit(kv, "d", 5, 60, {}, 1)).ok).toBe(true);
  expect((await checkRateLimit(kv, "d", 5, 60, {}, 1)).ok).toBe(false);
});
