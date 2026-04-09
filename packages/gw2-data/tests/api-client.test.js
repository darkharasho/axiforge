"use strict";

const { Gw2ApiClient } = require("../src/api/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("Gw2ApiClient", () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new Gw2ApiClient({
      cache: new MemoryCache(),
      fetch: mockFetch,
    });
  });

  describe("fetchJson", () => {
    test("returns parsed JSON on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "Fireball" }),
      });
      const result = await client.fetchJson("https://api.guildwars2.com/v2/skills/5489");
      expect(result).toEqual({ name: "Fireball" });
    });

    test("retries on 429 with delay", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ name: "Fireball" }),
        });
      const result = await client.fetchJson("https://api.guildwars2.com/v2/skills/5489");
      expect(result).toEqual({ name: "Fireball" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("throws after max retries", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Server Error" });
      await expect(
        client.fetchJson("https://api.guildwars2.com/v2/skills/5489")
      ).rejects.toThrow("500");
    });

    test("throws immediately on 4xx (non-429) without retrying", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
      await expect(
        client.fetchJson("https://api.guildwars2.com/v2/skills/99999")
      ).rejects.toThrow("404");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchByIds", () => {
    test("fetches single chunk of IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, name: "Skill A" },
          { id: 2, name: "Skill B" },
        ],
      });
      const result = await client.fetchByIds("/v2/skills", [1, 2]);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Skill A");
    });

    test("chunks large ID lists into batches of 180", async () => {
      const ids = Array.from({ length: 200 }, (_, i) => i + 1);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ids.slice(0, 180).map((id) => ({ id })),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ids.slice(180).map((id) => ({ id })),
        });
      const result = await client.fetchByIds("/v2/skills", ids);
      expect(result).toHaveLength(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("deduplicates IDs before fetching", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 1, name: "Skill A" }],
      });
      const result = await client.fetchByIds("/v2/skills", [1, 1, 1]);
      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("ids=1");
      expect(mockFetch.mock.calls[0][0]).not.toContain("ids=1,1");
    });
  });

  describe("fetchCached", () => {
    test("returns cached value on hit", async () => {
      const cache = new MemoryCache();
      cache.set("test-key", { cached: true }, 60000);
      client = new Gw2ApiClient({ cache, fetch: mockFetch });

      const result = await client.fetchCached("test-key", "https://example.com", 60000);
      expect(result).toEqual({ cached: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("fetches and caches on miss", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ fresh: true }),
      });
      const result = await client.fetchCached("test-key", "https://example.com", 60000);
      expect(result).toEqual({ fresh: true });
      const result2 = await client.fetchCached("test-key", "https://example.com", 60000);
      expect(result2).toEqual({ fresh: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("constructor defaults", () => {
    test("defaults to MemoryCache when no cache provided", async () => {
      const defaultClient = new Gw2ApiClient({ fetch: mockFetch });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1 }),
      });
      const result = await defaultClient.fetchCached("k", "https://example.com", 60000);
      expect(result).toEqual({ id: 1 });
      // Second call should hit cache
      const result2 = await defaultClient.fetchCached("k", "https://example.com", 60000);
      expect(result2).toEqual({ id: 1 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
