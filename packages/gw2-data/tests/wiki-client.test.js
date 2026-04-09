"use strict";

const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("WikiClient", () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new WikiClient({
      cache: new MemoryCache(),
      fetch: mockFetch,
    });
  });

  describe("getWikitext", () => {
    test("fetches and returns raw wikitext for a page", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "123": {
                title: "Fireball",
                revisions: [{ "*": "{{skill infobox\n| id = 5489\n}}" }],
              },
            },
          },
        }),
      });

      const result = await client.getWikitext("Fireball");
      expect(result).toBe("{{skill infobox\n| id = 5489\n}}");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain("action=query");
      expect(mockFetch.mock.calls[0][0]).toContain("rvprop=content");
    });

    test("returns null for missing page", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "-1": { missing: true },
            },
          },
        }),
      });

      const result = await client.getWikitext("Nonexistent");
      expect(result).toBeNull();
    });

    test("caches wikitext on subsequent calls", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "123": {
                title: "Fireball",
                revisions: [{ "*": "wikitext content" }],
              },
            },
          },
        }),
      });

      await client.getWikitext("Fireball");
      const result2 = await client.getWikitext("Fireball");
      expect(result2).toBe("wikitext content");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRecentChanges", () => {
    test("returns list of recently changed page titles", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            recentchanges: [
              { title: "Fireball", timestamp: "2026-04-09T10:00:00Z" },
              { title: "Ice Spike", timestamp: "2026-04-09T09:00:00Z" },
            ],
          },
        }),
      });

      const changes = await client.getRecentChanges("2026-04-08T00:00:00Z");
      expect(changes).toEqual(["Fireball", "Ice Spike"]);
    });
  });

  describe("getWikitext", () => {
    test("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await client.getWikitext("Fireball");
      expect(result).toBeNull();
    });

    test("returns null when query.pages is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: {} }),
      });
      const result = await client.getWikitext("Fireball");
      expect(result).toBeNull();
    });
  });

  describe("getRecentChanges", () => {
    test("returns empty array on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await client.getRecentChanges("2026-04-08T00:00:00Z");
      expect(result).toEqual([]);
    });

    test("deduplicates changed page titles", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            recentchanges: [
              { title: "Fireball", timestamp: "2026-04-09T10:00:00Z" },
              { title: "Fireball", timestamp: "2026-04-09T09:00:00Z" },
              { title: "Ice Spike", timestamp: "2026-04-09T08:00:00Z" },
            ],
          },
        }),
      });
      const result = await client.getRecentChanges("2026-04-08T00:00:00Z");
      expect(result).toEqual(["Fireball", "Ice Spike"]);
    });
  });

  describe("refresh", () => {
    test("first call records timestamp and returns empty array", async () => {
      const result = await client.refresh();
      expect(result).toEqual([]);
    });

    test("second call fetches recent changes and invalidates cache", async () => {
      // First call sets the timestamp
      await client.refresh();

      // Pre-populate cache
      const cache = client._cache;
      cache.set("wikitext:Fireball", "old content", 60000);
      cache.set("facts:Fireball", [{ type: "Damage" }], 60000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            recentchanges: [
              { title: "Fireball", timestamp: "2026-04-09T10:00:00Z" },
            ],
          },
        }),
      });

      const changed = await client.refresh();
      expect(changed).toEqual(["Fireball"]);
      expect(cache.get("wikitext:Fireball")).toBeNull();
      expect(cache.get("facts:Fireball")).toBeNull();
    });
  });

  describe("rate limiting", () => {
    test("delays subsequent requests within rate limit window", async () => {
      const response = {
        ok: true,
        json: async () => ({
          query: {
            pages: { "1": { title: "A", revisions: [{ "*": "a" }] } },
          },
        }),
      };
      mockFetch.mockResolvedValue(response);

      const start = Date.now();
      await client.getWikitext("A");
      await client.getWikitext("B"); // different key, forces second fetch
      const elapsed = Date.now() - start;

      // Should have waited ~200ms between requests
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("parseFacts", () => {
    test("parses wikitext into facts for a game mode", () => {
      const wikitext = [
        "{{skill infobox",
        "| id = 5489",
        "| split = pve, wvw, pvp",
        "}}",
        "{{skill fact|damage|0.8|game mode=wvw}}",
        "{{skill fact|damage|1.2|game mode=pve}}",
        "{{skill fact|recharge|25}}",
      ].join("\n");

      const result = client.parseFacts(wikitext);
      expect(result.facts.length).toBeGreaterThanOrEqual(2);
      const damageFact = result.facts.find((f) => f.type === "Damage");
      expect(damageFact.dmg_multiplier).toBe(0.8);
      const rechargeFact = result.facts.find((f) => f.type === "Recharge");
      expect(rechargeFact.value).toBe(25);
    });

    test("falls back to parseInfoboxParams when no skill fact templates found", () => {
      const wikitext = [
        "{{skill infobox",
        "| id = 1234",
        "| split = pve, wvw, pvp",
        "| recharge wvw = 30",
        "}}",
      ].join("\n");

      const result = client.parseFacts(wikitext);
      expect(result.splitGrouping.wvwHasSplit).toBe(true);
      const rechargeFact = result.facts.find((f) => f.type === "Recharge");
      expect(rechargeFact).toBeTruthy();
      expect(rechargeFact.value).toBe(30);
    });

    test("returns null splitGrouping when no split field present", () => {
      const wikitext = [
        "{{skill infobox",
        "| id = 1234",
        "}}",
        "{{skill fact|damage|1.0}}",
      ].join("\n");

      const result = client.parseFacts(wikitext);
      expect(result.splitGrouping).toBeNull();
    });
  });
});
