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

  describe("getWikitextBatch", () => {
    test("fetches multiple pages in a single request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": { title: "Fireball", revisions: [{ "*": "fireball wikitext" }] },
              "2": { title: "Shelter", revisions: [{ "*": "shelter wikitext" }] },
              "3": { title: "Moa Stance", revisions: [{ "*": "moa wikitext" }] },
            },
          },
        }),
      });

      const result = await client.getWikitextBatch(["Fireball", "Shelter", "Moa Stance"]);
      expect(result.size).toBe(3);
      expect(result.get("Fireball")).toBe("fireball wikitext");
      expect(result.get("Shelter")).toBe("shelter wikitext");
      expect(result.get("Moa Stance")).toBe("moa wikitext");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("chunks at 50 titles per request", async () => {
      // Generate 51 titles
      const titles = Array.from({ length: 51 }, (_, i) => `Skill_${i}`);

      const makeBatchResponse = (batch) => ({
        ok: true,
        json: async () => ({
          query: {
            pages: Object.fromEntries(
              batch.map((t, i) => [String(i), { title: t, revisions: [{ "*": `${t} text` }] }])
            ),
          },
        }),
      });

      // First call: 50 titles, second call: 1 title
      mockFetch
        .mockResolvedValueOnce(makeBatchResponse(titles.slice(0, 50)))
        .mockResolvedValueOnce(makeBatchResponse(titles.slice(50)));

      const result = await client.getWikitextBatch(titles);
      expect(result.size).toBe(51);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.get("Skill_0")).toBe("Skill_0 text");
      expect(result.get("Skill_50")).toBe("Skill_50 text");
    });

    test("uses cached entries without fetching", async () => {
      // Pre-populate cache
      client._cache.set("wikitext:Fireball", "cached fireball", 60000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": { title: "Shelter", revisions: [{ "*": "shelter text" }] },
            },
          },
        }),
      });

      const result = await client.getWikitextBatch(["Fireball", "Shelter"]);
      expect(result.get("Fireball")).toBe("cached fireball");
      expect(result.get("Shelter")).toBe("shelter text");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // URL should only contain Shelter
      expect(mockFetch.mock.calls[0][0]).toContain("Shelter");
      expect(mockFetch.mock.calls[0][0]).not.toContain("Fireball");
    });

    test("returns null for missing pages", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "-1": { title: "Nonexistent Skill", missing: true },
              "1": { title: "Fireball", revisions: [{ "*": "fireball text" }] },
            },
          },
        }),
      });

      const result = await client.getWikitextBatch(["Fireball", "Nonexistent Skill"]);
      expect(result.get("Fireball")).toBe("fireball text");
      expect(result.get("Nonexistent Skill")).toBe(null);
    });

    test("handles failed HTTP response gracefully", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await client.getWikitextBatch(["Fireball", "Shelter"]);
      expect(result.get("Fireball")).toBe(null);
      expect(result.get("Shelter")).toBe(null);
    });

    test("returns empty map for empty input", async () => {
      const result = await client.getWikitextBatch([]);
      expect(result.size).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("caches missing pages so subsequent batch calls skip them", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "-1": { title: "Missing Skill", missing: true },
              "1": { title: "Fireball", revisions: [{ "*": "fireball text" }] },
            },
          },
        }),
      });

      const result1 = await client.getWikitextBatch(["Fireball", "Missing Skill"]);
      expect(result1.get("Missing Skill")).toBeNull();
      expect(result1.get("Fireball")).toBe("fireball text");

      // Second batch: "Missing Skill" should come from cache, only "Shelter" fetched
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": { title: "Shelter", revisions: [{ "*": "shelter text" }] },
            },
          },
        }),
      });

      const result2 = await client.getWikitextBatch(["Missing Skill", "Shelter"]);
      expect(result2.get("Missing Skill")).toBeNull();
      expect(result2.get("Shelter")).toBe("shelter text");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second fetch should only contain Shelter, not Missing Skill
      expect(mockFetch.mock.calls[1][0]).toContain("Shelter");
      expect(mockFetch.mock.calls[1][0]).not.toContain("Missing");
    });

    test("handles MediaWiki title normalization", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            normalized: [{ from: "fireball", to: "Fireball" }],
            pages: {
              "1": { title: "Fireball", revisions: [{ "*": "fireball text" }] },
            },
          },
        }),
      });

      const result = await client.getWikitextBatch(["fireball"]);
      expect(result.get("fireball")).toBe("fireball text");
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
    test("caches missing pages so subsequent calls skip the network", async () => {
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

      const result1 = await client.getWikitext("Nonexistent");
      expect(result1).toBeNull();

      // Second call should NOT hit the network
      const result2 = await client.getWikitext("Nonexistent");
      expect(result2).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

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
