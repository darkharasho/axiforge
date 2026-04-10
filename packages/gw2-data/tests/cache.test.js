"use strict";

const { MemoryCache } = require("../src/wiki/cache");

describe("MemoryCache", () => {
  let cache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  test("get returns null for missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  test("set and get round-trips a value", () => {
    cache.set("key1", { data: "hello" }, 60000);
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  test("get returns null for expired entry", () => {
    cache.set("key1", "value", 1); // 1ms TTL
    // Advance past TTL
    jest.useFakeTimers();
    jest.advanceTimersByTime(10);
    expect(cache.get("key1")).toBeNull();
    jest.useRealTimers();
  });

  test("invalidate removes a specific key", () => {
    cache.set("key1", "value1", 60000);
    cache.set("key2", "value2", 60000);
    cache.invalidate("key1");
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBe("value2");
  });

  test("clear removes all entries", () => {
    cache.set("key1", "value1", 60000);
    cache.set("key2", "value2", 60000);
    cache.clear();
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBeNull();
  });

  test("has returns true for valid entry, false for missing/expired", () => {
    cache.set("key1", "value", 60000);
    expect(cache.has("key1")).toBe(true);
    expect(cache.has("missing")).toBe(false);
  });
});

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { DiskCache } = require("../src/wiki/cache");

describe("DiskCache", () => {
  let cache;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gw2-data-cache-"));
    cache = new DiskCache(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("get returns null for missing key", async () => {
    expect(await cache.get("missing")).toBeNull();
  });

  test("set and get round-trips a value", async () => {
    await cache.set("key1", { data: "hello" }, 60000);
    expect(await cache.get("key1")).toEqual({ data: "hello" });
  });

  test("get returns null for expired entry", async () => {
    await cache.set("key1", "value", 1);
    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10));
    expect(await cache.get("key1")).toBeNull();
  });

  test("invalidate removes a specific key", async () => {
    await cache.set("key1", "value1", 60000);
    await cache.set("key2", "value2", 60000);
    await cache.invalidate("key1");
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBe("value2");
  });

  test("clear removes all entries", async () => {
    await cache.set("key1", "value1", 60000);
    await cache.set("key2", "value2", 60000);
    await cache.clear();
    expect(await cache.get("key1")).toBeNull();
    expect(await cache.get("key2")).toBeNull();
  });

  test("persists across instances", async () => {
    await cache.set("key1", "value1", 60000);
    const cache2 = new DiskCache(tmpDir);
    expect(await cache2.get("key1")).toBe("value1");
  });
});
