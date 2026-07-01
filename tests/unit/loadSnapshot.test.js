"use strict";

/**
 * Tests for loadSnapshot — the remote-first data loader (relicFacts / upgradeIds).
 * Verifies it trusts valid remote data, but falls back to the baked copy on a
 * truncated/invalid payload, an HTTP error, or an offline network — and prefers
 * a stale-but-valid cache over the baked copy when the network later fails.
 */

const validate = (v) => v && Array.isArray(v.items) && v.items.length >= 3;
const baked = { items: [1, 2, 3, 4], baked: true };

let loadSnapshot;
let key = 0;
function freshKey() {
  return `test:snapshot:${key++}`;
}

beforeEach(() => {
  jest.resetModules();
  ({ loadSnapshot } = require("../../src/main/gw2Data/fetch"));
});

afterEach(() => {
  delete global.fetch;
});

test("returns remote data when valid", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [9, 9, 9, 9] }) }));
  const r = await loadSnapshot(freshKey(), "http://x", 10000, { validate, fallback: () => baked });
  expect(r.source).toBe("remote");
  expect(r.value.items).toEqual([9, 9, 9, 9]);
});

test("falls back to baked when the remote payload fails validation (truncated)", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [1] }) }));
  const r = await loadSnapshot(freshKey(), "http://x", 10000, { validate, fallback: () => baked });
  expect(r.source).toBe("baked");
  expect(r.value).toBe(baked);
});

test("falls back to baked on HTTP error", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  const r = await loadSnapshot(freshKey(), "http://x", 10000, { validate, fallback: () => baked });
  expect(r.source).toBe("baked");
});

test("falls back to baked when offline", async () => {
  global.fetch = jest.fn(async () => { throw new Error("offline"); });
  const r = await loadSnapshot(freshKey(), "http://x", 10000, { validate, fallback: () => baked });
  expect(r.source).toBe("baked");
  expect(r.value.baked).toBe(true);
});

test("prefers a stale-but-valid cache over baked when the network later fails", async () => {
  const k = freshKey();
  // First call caches a valid value with a 1ms TTL, then it expires.
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [7, 7, 7, 7] }) }));
  await loadSnapshot(k, "http://x", 1, { validate, fallback: () => baked });
  await new Promise((r) => setTimeout(r, 5));
  // Network now fails: should serve the stale cached value, not baked.
  global.fetch = jest.fn(async () => { throw new Error("offline"); });
  const r = await loadSnapshot(k, "http://x", 1, { validate, fallback: () => baked });
  expect(r.source).toBe("stale");
  expect(r.value.items).toEqual([7, 7, 7, 7]);
});
