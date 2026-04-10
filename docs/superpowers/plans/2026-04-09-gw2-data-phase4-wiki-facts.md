# @axi/gw2-data Phase 4: Wiki as Authoritative Fact Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GW2 Wiki the authoritative source for all skill/trait fact values. The API provides structure (IDs, names, icons, descriptions, specialization trees, traitedFacts structure). The wiki provides all fact data. No merging — wiki facts fully replace API facts. Delete the `lib/gw2-balance-splits/` system entirely.

**Architecture:** A new resolver module batch-fetches wiki pages, parses facts grouped by game mode, and injects them into catalog entities. The catalog returns API-skeleton data immediately, then resolves wiki facts in the background and pushes updates via IPC. The renderer listens for incremental updates and re-renders affected entities. Icons are injected from constant maps in the renderer (existing `BOON_CONDITION_ICONS` and `FACT_TYPE_ICONS`).

**Tech Stack:** CommonJS (main process, @axi/gw2-data package), ES modules (renderer via Vite), Jest for tests, Electron IPC for push updates.

**Spec:** `docs/superpowers/specs/2026-04-09-gw2-data-phase4-wiki-facts-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/gw2-data/src/wiki/parser.js` | Modify: enhance `parseWikitextFacts` to tag each fact with `_modes` |
| `packages/gw2-data/tests/parser.test.js` | Modify: add tests for `_modes` tagging |
| `packages/gw2-data/src/wiki/client.js` | Modify: add `getWikitextBatch(titles)` method |
| `packages/gw2-data/tests/wiki-client.test.js` | Modify: add batch fetch tests |
| `packages/gw2-data/src/wiki/resolver.js` | Create: batch wiki fact resolution — `resolveEntityFacts`, `groupFactsByMode` |
| `packages/gw2-data/tests/resolver.test.js` | Create: tests for batch resolution and mode grouping |
| `packages/gw2-data/tests/fixtures/wiki-snapshots/` | Create: pinned wiki page snapshots for regression testing |
| `packages/gw2-data/tests/wiki-snapshots.test.js` | Create: snapshot regression tests |
| `src/main/gw2Data/catalog.js` | Modify: remove balance split system, add wiki resolution flow, per-mode fact storage |
| `src/main/gw2Data/index.js` | Modify: export wiki resolver initialization |
| `src/main/index.js` | Modify: add IPC handlers for wiki fact push/request |
| `src/preload/index.js` | Modify: add IPC bridge for wiki facts channels |
| `src/renderer/modules/wiki-updates.js` | Create: renderer-side IPC listener for wiki fact updates |
| `src/renderer/modules/detail-panel.js` | Modify: update `resolveEntityFacts` for per-mode facts, add split delta comparison |
| `src/renderer/modules/state.js` | Modify: add wiki resolution status tracking |
| `src/renderer/renderer.js` | Modify: listen for wiki-facts-resolved, update catalogCache |
| `lib/gw2-balance-splits/` | Delete: entire directory |

---

### Task 1: Parser Enhancement — Mode-Tagged Facts

Enhance `parseWikitextFacts` to return ALL facts with a `_modes` array on each, instead of filtering to just the WvW set. This lets the resolver group facts by game mode without calling the parser multiple times.

**Files:**
- Modify: `packages/gw2-data/src/wiki/parser.js`
- Modify: `packages/gw2-data/tests/parser.test.js`

- [ ] **Step 1: Add parseAllFacts function to parser.js**

This new function returns every fact with a `_modes` tag. The existing `parseWikitextFacts` is left unchanged for backward compatibility.

```js
// packages/gw2-data/src/wiki/parser.js — add after parseWikitextFacts

/**
 * Parse all {{skill fact|...}} / {{trait fact|...}} templates, tagging each
 * with the game modes it applies to.
 *
 * @param {string} wikitext
 * @returns {{ facts: Object[], hasPveOnly: boolean }}
 *   Each fact has `_modes: string[]` — subset of ["pve", "wvw", "pvp"].
 *   An empty _modes means "universal" (applies to all modes).
 */
function parseAllTaggedFacts(wikitext) {
  const facts = [];
  let hasPveOnly = false;

  const templateRe = /\{\{(?:skill|trait) fact\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/gi;
  let match;

  while ((match = templateRe.exec(wikitext)) !== null) {
    const inner = match[1];
    const parts = splitRespectingTemplates(inner);

    const factType = (parts[0] || "").trim().toLowerCase();

    const positional = [];
    const params = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const val = part.slice(eqIdx + 1).trim();
        params[key] = val;
      } else {
        positional.push(part.trim());
      }
    }

    const gameMode = (params["game mode"] || "").toLowerCase().trim();
    const gameModeTokens = gameMode ? gameMode.split(/\s+/) : [];

    const mentionsWvw = gameModeTokens.includes("wvw");
    const mentionsPvp = gameModeTokens.includes("pvp");
    const mentionsPve = gameModeTokens.includes("pve");
    const isUniversal = gameModeTokens.length === 0;

    if (mentionsPve && !mentionsWvw && !mentionsPvp) {
      hasPveOnly = true;
    }

    // Build _modes array
    const modes = [];
    if (isUniversal) {
      // Universal — applies to all modes (empty array signals this)
    } else {
      if (mentionsPve) modes.push("pve");
      if (mentionsWvw) modes.push("wvw");
      if (mentionsPvp) modes.push("pvp");
    }

    const cleanPositionals = positional.map((p) => stripWikiMarkup(p));
    const fact = mapWikiFactToApiFact(factType, cleanPositionals, params, mentionsWvw, isUniversal);
    if (fact) {
      fact._modes = modes;
      facts.push(fact);
    }
  }

  return { facts, hasPveOnly };
}
```

- [ ] **Step 2: Export parseAllTaggedFacts**

```js
// packages/gw2-data/src/wiki/parser.js — update module.exports
module.exports = {
  splitRespectingTemplates,
  parseSplitGrouping,
  mapWikiFactToApiFact,
  parseWikitextFacts,
  parseInfoboxParams,
  parseAllTaggedFacts,
};
```

- [ ] **Step 3: Add tests for parseAllTaggedFacts**

```js
// packages/gw2-data/tests/parser.test.js — add new describe block

describe("parseAllTaggedFacts", () => {
  const { parseAllTaggedFacts } = require("../src/wiki/parser");

  test("universal facts have empty _modes array", () => {
    const wikitext = "{{skill fact|damage|0.8}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual([]);
    expect(facts[0].type).toBe("Damage");
  });

  test("pve-only fact tagged with ['pve']", () => {
    const wikitext = "{{skill fact|damage|0.8|game mode=pve}}";
    const { facts, hasPveOnly } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pve"]);
    expect(hasPveOnly).toBe(true);
  });

  test("wvw-only fact tagged with ['wvw']", () => {
    const wikitext = "{{skill fact|damage|0.5|game mode=wvw}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["wvw"]);
  });

  test("compound mode 'pvp wvw' tagged with both", () => {
    const wikitext = "{{skill fact|damage|0.5|game mode=pvp wvw}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["wvw", "pvp"]);
  });

  test("mixed universal and mode-specific facts", () => {
    const wikitext = [
      "{{skill fact|damage|1.0}}",
      "{{skill fact|burning|3|game mode=pve}}",
      "{{skill fact|burning|2|game mode=wvw pvp}}",
    ].join("\n");
    const { facts, hasPveOnly } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(3);
    expect(facts[0]._modes).toEqual([]);         // universal damage
    expect(facts[1]._modes).toEqual(["pve"]);     // pve burning
    expect(facts[2]._modes).toEqual(["wvw", "pvp"]); // wvw+pvp burning
    expect(hasPveOnly).toBe(true);
  });

  test("all three modes specified individually", () => {
    const wikitext = "{{skill fact|recharge|15|game mode=pve wvw pvp}}";
    const { facts } = parseAllTaggedFacts(wikitext);
    expect(facts).toHaveLength(1);
    expect(facts[0]._modes).toEqual(["pve", "wvw", "pvp"]);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/parser.test.js --no-coverage`

Expected: All existing tests pass plus the new `parseAllTaggedFacts` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/wiki/parser.js packages/gw2-data/tests/parser.test.js
git commit -m "feat(gw2-data): add parseAllTaggedFacts for mode-tagged fact parsing (Phase 4, Task 1)"
```

---

### Task 2: Wiki Client Batch Fetching

Add `getWikitextBatch(titles)` to `WikiClient` for fetching up to 50 pages per MediaWiki API request. No rate limiting between batches — MediaWiki's `action=query` with `titles=A|B|C` is a single request.

**Files:**
- Modify: `packages/gw2-data/src/wiki/client.js`
- Modify: `packages/gw2-data/tests/wiki-client.test.js`

- [ ] **Step 1: Add getWikitextBatch method to WikiClient**

```js
// packages/gw2-data/src/wiki/client.js — add inside WikiClient class, after getWikitext

  /**
   * Batch-fetch wikitext for multiple page titles.
   * Uses MediaWiki's multi-title query (up to 50 per request).
   * Checks cache first; only uncached titles are fetched.
   *
   * @param {string[]} titles
   * @returns {Promise<Map<string, string|null>>} title → wikitext (null if page missing)
   */
  async getWikitextBatch(titles) {
    const BATCH_SIZE = 50;
    const result = new Map();

    // Check cache first, collect uncached titles
    const uncached = [];
    for (const title of titles) {
      const cacheKey = `wikitext:${title}`;
      const cached = await this._cache.get(cacheKey);
      if (cached !== null) {
        result.set(title, cached);
      } else {
        uncached.push(title);
      }
    }

    // Fetch uncached in batches of 50
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
      const batch = uncached.slice(i, i + BATCH_SIZE);
      const titlesParam = batch.map((t) => encodeURIComponent(t)).join("|");
      const url =
        `${this._wikiApiRoot}?action=query&titles=${titlesParam}` +
        `&prop=revisions&rvprop=content&format=json&formatversion=1`;

      const res = await this._fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (!res.ok) {
        // Mark all in this batch as null
        for (const title of batch) {
          result.set(title, null);
        }
        continue;
      }

      const data = await res.json();
      const pages = data.query?.pages || {};

      // Build a normalized-title lookup from the API response
      const normalized = new Map();
      for (const n of data.query?.normalized || []) {
        normalized.set(n.to, n.from);
      }

      // Map response pages back to requested titles
      const responseByTitle = new Map();
      for (const page of Object.values(pages)) {
        const responseTitle = page.title;
        const wikitext = page.missing ? null : (page.revisions?.[0]?.["*"] || null);
        responseByTitle.set(responseTitle, wikitext);
      }

      for (const title of batch) {
        // MediaWiki may normalize the title (e.g. underscores → spaces)
        // Try exact match first, then check if our title was the "from" in normalized
        let wikitext = responseByTitle.get(title);
        if (wikitext === undefined) {
          // Check if this title was normalized to something else
          for (const [to, from] of normalized) {
            if (from === title) {
              wikitext = responseByTitle.get(to);
              break;
            }
          }
        }
        if (wikitext === undefined) wikitext = null;

        result.set(title, wikitext);
        if (wikitext !== null) {
          const cacheKey = `wikitext:${title}`;
          await this._cache.set(cacheKey, wikitext, this._cacheTTL);
        }
      }
    }

    return result;
  }
```

- [ ] **Step 2: Add tests for getWikitextBatch**

```js
// packages/gw2-data/tests/wiki-client.test.js — add inside describe("WikiClient")

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
```

- [ ] **Step 3: Run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/wiki-client.test.js --no-coverage`

Expected: All existing tests plus new batch tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/gw2-data/src/wiki/client.js packages/gw2-data/tests/wiki-client.test.js
git commit -m "feat(gw2-data): add getWikitextBatch for batch wiki page fetching (Phase 4, Task 2)"
```

---

### Task 3: Wiki Fact Resolver Module

Create `resolver.js` — the core module that batch-fetches wiki pages, parses facts, groups them by game mode, and returns structured per-mode fact sets for each entity.

**Files:**
- Create: `packages/gw2-data/src/wiki/resolver.js`
- Create: `packages/gw2-data/tests/resolver.test.js`

- [ ] **Step 1: Create resolver.js**

```js
// packages/gw2-data/src/wiki/resolver.js
"use strict";

const { parseAllTaggedFacts } = require("./parser");
const { parseSplitGrouping } = require("./parser");
const { parseInfoboxParams } = require("./parser");

/**
 * Group mode-tagged facts into per-mode arrays.
 *
 * @param {Object[]} taggedFacts - Facts with _modes arrays from parseAllTaggedFacts
 * @returns {{ pve: Object[], wvw: Object[], pvp: Object[] }}
 */
function groupFactsByMode(taggedFacts) {
  const pve = [];
  const wvw = [];
  const pvp = [];

  for (const fact of taggedFacts) {
    const modes = fact._modes;
    // Strip _modes from the output fact
    const { _modes, ...cleanFact } = fact;

    if (modes.length === 0) {
      // Universal — applies to all modes
      pve.push(cleanFact);
      wvw.push(cleanFact);
      pvp.push(cleanFact);
    } else {
      if (modes.includes("pve")) pve.push(cleanFact);
      if (modes.includes("wvw")) wvw.push(cleanFact);
      if (modes.includes("pvp")) pvp.push(cleanFact);
    }
  }

  return { pve, wvw, pvp };
}

/**
 * Parse wikitext and return per-mode fact sets.
 *
 * @param {string} wikitext
 * @returns {{ pve: Object[], wvw: Object[], pvp: Object[], hasSplit: boolean }}
 */
function parseFactsByMode(wikitext) {
  const { facts: taggedFacts, hasPveOnly } = parseAllTaggedFacts(wikitext);
  const { pve, wvw, pvp } = groupFactsByMode(taggedFacts);

  // Check for infobox recharge overrides (e.g. | recharge wvw = 25)
  const splitMatch = wikitext.match(/\|\s*split\s*=\s*(.+)/i);
  let splitGrouping = null;
  if (splitMatch) {
    splitGrouping = parseSplitGrouping(splitMatch[1].trim());
  }

  // If no template-based WvW facts were found but a split exists, try infobox params
  if (wvw.length === 0 && splitGrouping?.wvwHasSplit) {
    const infoboxFacts = parseInfoboxParams(wikitext, splitGrouping.wvwGroupedWithPvp);
    for (const f of infoboxFacts) {
      wvw.push(f);
      if (splitGrouping.wvwGroupedWithPvp) pvp.push(f);
    }
  }

  // Determine if there's actually a game mode split
  const hasSplit = hasPveOnly || (splitGrouping?.wvwHasSplit ?? false);

  return { pve, wvw, pvp, hasSplit };
}

/**
 * Batch-resolve wiki facts for a set of entities.
 *
 * @param {WikiClient} client - WikiClient instance
 * @param {Map<string, number>} titleToId - Map of wiki page title → entity ID
 * @returns {Promise<Map<number, { pve: Object[], wvw: Object[]|null, pvp: Object[]|null, hasSplit: boolean }>>}
 */
async function resolveEntityFacts(client, titleToId) {
  const titles = [...titleToId.keys()];
  if (titles.length === 0) return new Map();

  const wikitextMap = await client.getWikitextBatch(titles);
  const result = new Map();

  for (const [title, id] of titleToId) {
    const wikitext = wikitextMap.get(title);
    if (!wikitext) {
      // No wiki page found — will fall back to API facts
      continue;
    }

    const { pve, wvw, pvp, hasSplit } = parseFactsByMode(wikitext);

    result.set(id, {
      pve,
      wvw: hasSplit ? wvw : null,
      pvp: hasSplit ? pvp : null,
      hasSplit,
    });
  }

  return result;
}

module.exports = {
  groupFactsByMode,
  parseFactsByMode,
  resolveEntityFacts,
};
```

- [ ] **Step 2: Create resolver tests**

```js
// packages/gw2-data/tests/resolver.test.js
"use strict";

const { groupFactsByMode, parseFactsByMode, resolveEntityFacts } = require("../src/wiki/resolver");
const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("groupFactsByMode", () => {
  test("universal facts go to all three modes", () => {
    const facts = [{ type: "Damage", text: "Damage", dmg_multiplier: 1.0, _modes: [] }];
    const { pve, wvw, pvp } = groupFactsByMode(facts);
    expect(pve).toHaveLength(1);
    expect(wvw).toHaveLength(1);
    expect(pvp).toHaveLength(1);
    // _modes should be stripped from output
    expect(pve[0]._modes).toBeUndefined();
  });

  test("pve-only fact goes only to pve", () => {
    const facts = [{ type: "Damage", text: "Damage", dmg_multiplier: 0.8, _modes: ["pve"] }];
    const { pve, wvw, pvp } = groupFactsByMode(facts);
    expect(pve).toHaveLength(1);
    expect(wvw).toHaveLength(0);
    expect(pvp).toHaveLength(0);
  });

  test("wvw+pvp fact goes to both but not pve", () => {
    const facts = [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, _modes: ["wvw", "pvp"] }];
    const { pve, wvw, pvp } = groupFactsByMode(facts);
    expect(pve).toHaveLength(0);
    expect(wvw).toHaveLength(1);
    expect(pvp).toHaveLength(1);
  });

  test("mixed universal and mode-specific", () => {
    const facts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, _modes: [] },
      { type: "Buff", text: "Burning", status: "Burning", duration: 3, _modes: ["pve"] },
      { type: "Buff", text: "Burning", status: "Burning", duration: 2, _modes: ["wvw", "pvp"] },
    ];
    const { pve, wvw, pvp } = groupFactsByMode(facts);
    expect(pve).toHaveLength(2); // damage + pve burning
    expect(wvw).toHaveLength(2); // damage + wvw burning
    expect(pvp).toHaveLength(2); // damage + pvp burning
    expect(pve[1].duration).toBe(3);
    expect(wvw[1].duration).toBe(2);
  });
});

describe("parseFactsByMode", () => {
  test("simple skill with no split returns facts in pve, null wvw/pvp", () => {
    const wikitext = "{{skill fact|damage|0.8}}\n{{skill fact|burning|3}}";
    const result = parseFactsByMode(wikitext);
    expect(result.pve).toHaveLength(2);
    expect(result.wvw).toBeNull();
    expect(result.pvp).toBeNull();
    expect(result.hasSplit).toBe(false);
  });

  test("skill with pve/wvw split separates correctly", () => {
    const wikitext = [
      "| split = pve, wvw pvp",
      "{{skill fact|damage|1.0}}",
      "{{skill fact|burning|3|game mode=pve}}",
      "{{skill fact|burning|2|game mode=wvw pvp}}",
    ].join("\n");
    const result = parseFactsByMode(wikitext);
    expect(result.hasSplit).toBe(true);
    expect(result.pve).toHaveLength(2); // damage + pve burning
    expect(result.wvw).toHaveLength(2); // damage + wvw burning
    expect(result.pvp).toHaveLength(2); // damage + pvp burning
    expect(result.pve.find((f) => f.status === "Burning").duration).toBe(3);
    expect(result.wvw.find((f) => f.status === "Burning").duration).toBe(2);
  });

  test("skill with only universal facts has identical pve/wvw/pvp when split exists", () => {
    const wikitext = [
      "| split = pve, wvw pvp",
      "{{skill fact|damage|0.8}}",
    ].join("\n");
    const result = parseFactsByMode(wikitext);
    expect(result.hasSplit).toBe(true);
    // wvw/pvp are non-null because split exists, even though facts are identical
    expect(result.wvw).toHaveLength(1);
    expect(result.pvp).toHaveLength(1);
  });
});

describe("resolveEntityFacts", () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    client = new WikiClient({ cache: new MemoryCache(), fetch: mockFetch });
  });

  test("resolves facts for multiple entities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": {
              title: "Fireball",
              revisions: [{ "*": "{{skill fact|damage|0.8}}\n{{skill fact|burning|3}}" }],
            },
            "2": {
              title: "Shelter",
              revisions: [{ "*": "{{skill fact|healing|1000|coefficient=0.5}}" }],
            },
          },
        },
      }),
    });

    const titleToId = new Map([["Fireball", 5489], ["Shelter", 9124]]);
    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(2);
    expect(result.get(5489).pve).toHaveLength(2);
    expect(result.get(9124).pve).toHaveLength(1);
    expect(result.get(5489).hasSplit).toBe(false);
  });

  test("skips missing wiki pages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "-1": { title: "Missing Skill", missing: true },
            "1": { title: "Fireball", revisions: [{ "*": "{{skill fact|damage|0.8}}" }] },
          },
        },
      }),
    });

    const titleToId = new Map([["Fireball", 5489], ["Missing Skill", 9999]]);
    const result = await resolveEntityFacts(client, titleToId);

    expect(result.size).toBe(1);
    expect(result.has(5489)).toBe(true);
    expect(result.has(9999)).toBe(false);
  });

  test("returns empty map for empty input", async () => {
    const result = await resolveEntityFacts(client, new Map());
    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/resolver.test.js --no-coverage`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/gw2-data/src/wiki/resolver.js packages/gw2-data/tests/resolver.test.js
git commit -m "feat(gw2-data): add wiki fact resolver with per-mode grouping (Phase 4, Task 3)"
```

---

### Task 4: Snapshot Fixtures

Create pinned wiki page snapshots for representative skills/traits. These are used in regression tests to ensure parser output stays stable.

**Files:**
- Create: `packages/gw2-data/tests/fixtures/wiki-snapshots/` (directory + JSON files)
- Create: `packages/gw2-data/tests/wiki-snapshots.test.js`

- [ ] **Step 1: Create the fixture directory and snapshot script**

The snapshots are JSON files: `{ title, wikitext, expectedFacts: { pve, wvw, pvp, hasSplit } }`. Since we cannot fetch live wiki data during plan creation, the test file will include inline wikitext samples for skills covering all major fact types.

```js
// packages/gw2-data/tests/wiki-snapshots.test.js
"use strict";

const { parseFactsByMode } = require("../src/wiki/resolver");

/**
 * Snapshot test suite for wiki fact parsing.
 * Each case contains real-world-representative wikitext and expected parser output.
 * When wiki templates change format, update the wikitext + expectations together.
 */

const SNAPSHOTS = [
  {
    name: "Fireball (Elementalist) — simple damage + burning",
    wikitext: [
      "{{skill fact|damage|coefficient=0.9|hits=1}}",
      "{{skill fact|burning|3|stacks=1}}",
      "{{skill fact|targets|5}}",
      "{{skill fact|range|900}}",
      "{{skill fact|combo|projectile}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 5,
      wvwNull: true,
      pvpNull: true,
      pveTypes: ["Damage", "Buff", "Number", "Range", "ComboFinisher"],
    },
  },
  {
    name: "Shelter (Guardian) — healing + block, with WvW split",
    wikitext: [
      "| split = pve, wvw pvp",
      "{{skill fact|healing|4000|coefficient=0.75}}",
      "{{skill fact|healing|3200|coefficient=0.6|game mode=wvw pvp}}",
      "{{skill fact|recharge|30}}",
      "{{skill fact|stun break}}",
    ].join("\n"),
    expected: {
      hasSplit: true,
      pveCount: 3,  // healing(pve implicit via universal) + recharge + stun break
      wvwCount: 3,  // healing(wvw) + recharge + stun break
      pveHealingValue: 4000,
      wvwHealingValue: 3200,
    },
  },
  {
    name: "Signet of Inspiration (Mesmer) — boon application",
    wikitext: [
      "{{skill fact|quickness|2|stacks=1}}",
      "{{skill fact|fury|4|stacks=1}}",
      "{{skill fact|might|8|stacks=3}}",
      "{{skill fact|recharge|30}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 4,
      pveTypes: ["Buff", "Buff", "Buff", "Recharge"],
    },
  },
  {
    name: "Skill with all three mode variants",
    wikitext: [
      "| split = pve, wvw, pvp",
      "{{skill fact|damage|coefficient=1.0}}",
      "{{skill fact|burning|4|game mode=pve}}",
      "{{skill fact|burning|2|game mode=wvw}}",
      "{{skill fact|burning|1|game mode=pvp}}",
    ].join("\n"),
    expected: {
      hasSplit: true,
      pveCount: 2,
      wvwCount: 2,
      pvpCount: 2,
      pveBurningDuration: 4,
      wvwBurningDuration: 2,
      pvpBurningDuration: 1,
    },
  },
  {
    name: "Combo field skill",
    wikitext: [
      "{{skill fact|damage|coefficient=0.5}}",
      "{{skill fact|combo|fire}}",
      "{{skill fact|radius|240}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 3,
      pveTypes: ["Damage", "ComboField", "Radius"],
    },
  },
  {
    name: "Attribute conversion skill",
    wikitext: [
      "{{skill fact|gain|source=Power|target=Condition Damage|percent=10}}",
      "{{skill fact|duration|8}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 2,
      pveTypes: ["BuffConversion", "Time"],
    },
  },
  {
    name: "Defiance break + conditions removed",
    wikitext: [
      "{{skill fact|defiance break|200}}",
      "{{skill fact|conditions removed|3}}",
      "{{skill fact|range|600}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 3,
      pveTypes: ["Number", "Number", "Range"],
    },
  },
  {
    name: "Barrier skill",
    wikitext: [
      "{{skill fact|barrier|2000|coefficient=0.4}}",
      "{{skill fact|targets|5}}",
      "{{skill fact|radius|360}}",
    ].join("\n"),
    expected: {
      hasSplit: false,
      pveCount: 3,
    },
  },
];

describe("Wiki fact parsing snapshots", () => {
  for (const snapshot of SNAPSHOTS) {
    test(snapshot.name, () => {
      const result = parseFactsByMode(snapshot.wikitext);
      const { expected } = snapshot;

      if (expected.hasSplit !== undefined) {
        expect(result.hasSplit).toBe(expected.hasSplit);
      }
      if (expected.pveCount !== undefined) {
        expect(result.pve).toHaveLength(expected.pveCount);
      }
      if (expected.wvwNull) {
        expect(result.wvw).toBeNull();
      }
      if (expected.pvpNull) {
        expect(result.pvp).toBeNull();
      }
      if (expected.wvwCount !== undefined) {
        expect(result.wvw).toHaveLength(expected.wvwCount);
      }
      if (expected.pvpCount !== undefined) {
        expect(result.pvp).toHaveLength(expected.pvpCount);
      }
      if (expected.pveTypes) {
        expect(result.pve.map((f) => f.type)).toEqual(expected.pveTypes);
      }
      if (expected.pveHealingValue !== undefined) {
        const heal = result.pve.find((f) => f.text === "Healing" || f.target === "Healing");
        expect(heal.value).toBe(expected.pveHealingValue);
      }
      if (expected.wvwHealingValue !== undefined) {
        const heal = result.wvw.find((f) => f.text === "Healing" || f.target === "Healing");
        expect(heal.value).toBe(expected.wvwHealingValue);
      }
      if (expected.pveBurningDuration !== undefined) {
        const burn = result.pve.find((f) => f.status === "Burning");
        expect(burn.duration).toBe(expected.pveBurningDuration);
      }
      if (expected.wvwBurningDuration !== undefined) {
        const burn = result.wvw.find((f) => f.status === "Burning");
        expect(burn.duration).toBe(expected.wvwBurningDuration);
      }
      if (expected.pvpBurningDuration !== undefined) {
        const burn = result.pvp.find((f) => f.status === "Burning");
        expect(burn.duration).toBe(expected.pvpBurningDuration);
      }
    });
  }
});
```

- [ ] **Step 2: Run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/wiki-snapshots.test.js --no-coverage`

Expected: All snapshot tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/gw2-data/tests/wiki-snapshots.test.js
git commit -m "test(gw2-data): add wiki fact parsing snapshot tests (Phase 4, Task 4)"
```

---

### Task 5: Delete Balance Splits System

Remove `lib/gw2-balance-splits/` entirely. Remove all imports and usage from `catalog.js`. Keep `KNOWN_SKILL_FACTS_OVERRIDES` and `KNOWN_TRAIT_FACTS_OVERRIDES` as emergency overrides.

**Files:**
- Delete: `lib/gw2-balance-splits/` (entire directory)
- Modify: `src/main/gw2Data/catalog.js`

- [ ] **Step 1: Remove balance split imports from catalog.js**

Remove lines 54-62 (the two `require` blocks for `gw2-balance-splits` and `gw2-balance-splits/match`):

```js
// DELETE these lines from src/main/gw2Data/catalog.js:

const { getSkillSplit, getTraitSplit, getSkillPveFacts, getTraitPveFacts } = require("../../../lib/gw2-balance-splits");

const {
  splitNormalizeType: _splitNormalizeType,
  splitGroupKey: _splitGroupKey,
  SPLIT_VALUE_KEYS: _SPLIT_VALUE_KEYS,
  splitValueChanged: _splitValueChanged,
  buildSplitMatchTables: _buildSplitMatchTables,
} = require("../../../lib/gw2-balance-splits/match");
```

- [ ] **Step 2: Remove _mergeSplitValues, _sanitiseUnmatchedSplitFact, applyBalanceSplit, and applyPveFacts functions**

Delete the entire block from line ~78 (`function _mergeSplitValues`) through line ~227 (end of `applyPveFacts`). These are approximately 150 lines.

- [ ] **Step 3: Remove applyBalanceSplit and applyPveFacts calls from mapSkill**

In `mapSkill` (around line 626-627), remove:

```js
// DELETE from mapSkill:
    applyBalanceSplit(mapped, "skill", gameMode);
    if (gameMode === "pve") applyPveFacts(mapped, "skill");
```

Also remove the hasSplit/factsOverride merge block (lines ~631-639):

```js
// DELETE from mapSkill:
    const factsOverride = KNOWN_SKILL_FACTS_OVERRIDES.get(skill.id);
    if (factsOverride && mapped.hasSplit) {
      const splitStatuses = new Set(mapped.facts.map((f) => f.status).filter(Boolean));
      const missing = factsOverride.filter((f) => f.status && !splitStatuses.has(f.status));
      if (missing.length > 0) {
        mapped.facts = [...missing, ...mapped.facts];
      }
    }
```

- [ ] **Step 4: Remove applyBalanceSplit and applyPveFacts calls from trait mapping**

In the traits mapping (around line 831-832), remove:

```js
// DELETE from traits.map:
      applyBalanceSplit(mapped, "trait", gameMode);
      if (gameMode === "pve") applyPveFacts(mapped, "trait");
```

- [ ] **Step 5: Remove applyBalanceSplit and applyPveFacts calls from weaponSkills mapping**

In the weaponSkills mapping (around line 865-866), remove:

```js
// DELETE from weaponSkills.map:
      applyBalanceSplit(mapped, "skill", gameMode);
      if (gameMode === "pve") applyPveFacts(mapped, "skill");
```

- [ ] **Step 6: Update module.exports to remove applyBalanceSplit**

```js
// src/main/gw2Data/catalog.js — update exports
module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  _setStaticData,
};
```

- [ ] **Step 7: Delete lib/gw2-balance-splits/ directory**

Run: `rm -rf /var/home/mstephens/Documents/GitHub/axiforge/lib/gw2-balance-splits/`

- [ ] **Step 8: Remove or update test files that depend on balance splits**

Check and update these test files that import from `lib/gw2-balance-splits`:
- `tests/unit/balance-splits.test.js` — delete entirely
- `tests/unit/catalog-splits.test.js` — delete entirely
- `tests/unit/splits-data-integrity.test.js` — delete entirely
- `tests/unit/seed-parser.test.js` — delete entirely
- `tests/unit/scraper-parsing.test.js` — delete entirely
- `tests/unit/crawl-patches.test.js` — delete entirely

Run: `rm tests/unit/balance-splits.test.js tests/unit/catalog-splits.test.js tests/unit/splits-data-integrity.test.js tests/unit/seed-parser.test.js tests/unit/scraper-parsing.test.js tests/unit/crawl-patches.test.js`

Also check `tests/unit/trait-facts-overrides.test.js` — if it imports from balance splits, update it. If it only tests `KNOWN_TRAIT_FACTS_OVERRIDES`, keep it.

- [ ] **Step 9: Update package.json if gw2-balance-splits has any scripts**

Check `package.json` for any scripts referencing `lib/gw2-balance-splits` (e.g. `seed`, `crawl-patches`). Remove them.

- [ ] **Step 10: Verify the app still builds and existing tests pass**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest --no-coverage --passWithNoTests 2>&1 | tail -20`

Expected: Tests pass (balance split tests are deleted, catalog tests may need updating if they relied on split behavior — fix any failures).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: remove lib/gw2-balance-splits and all balance split logic from catalog (Phase 4, Task 5)"
```

---

### Task 6: Catalog Assembly — Wiki Fact Resolution

Add wiki resolution to `getProfessionCatalog`. After mapping entities from the API, collect all entity names and call `resolveEntityFacts` to get wiki facts. Wiki facts replace API facts. Emergency overrides (`KNOWN_SKILL_FACTS_OVERRIDES`, `KNOWN_TRAIT_FACTS_OVERRIDES`) take precedence over wiki facts.

**Files:**
- Modify: `src/main/gw2Data/catalog.js`
- Modify: `src/main/gw2Data/index.js`

- [ ] **Step 1: Add wiki resolver import and initialization to catalog.js**

```js
// src/main/gw2Data/catalog.js — add at top, after existing requires

const { WikiClient } = require("@axi/gw2-data/wiki/client");
const { DiskCache } = require("@axi/gw2-data/wiki/cache");
const { resolveEntityFacts } = require("@axi/gw2-data/wiki/resolver");
const path = require("node:path");

let _wikiClient = null;

/**
 * Initialize the wiki client with a disk cache.
 * Called once at app startup from main/index.js.
 * @param {string} cacheDir - Directory for wiki cache files
 */
function initWikiClient(cacheDir) {
  const cache = new DiskCache(path.join(cacheDir, "wiki-facts"));
  _wikiClient = new WikiClient({ cache });
}

/**
 * Get the wiki client, creating a default one if not initialized.
 * @returns {WikiClient}
 */
function getWikiClient() {
  if (!_wikiClient) {
    _wikiClient = new WikiClient();
  }
  return _wikiClient;
}
```

- [ ] **Step 2: Add applyWikiFacts helper function**

```js
// src/main/gw2Data/catalog.js — add after getWikiClient

/**
 * Apply wiki-resolved facts to a mapped entity.
 * Wiki facts fully replace API facts unless an emergency override exists.
 *
 * @param {Object} entity - Mapped entity (skill or trait) — mutated in place
 * @param {Map<number, Object>} wikiFactsById - Wiki facts keyed by entity ID
 * @param {Map<number, Object[]>} overridesMap - Emergency overrides map
 * @param {string} gameMode - Current game mode
 */
function applyWikiFacts(entity, wikiFactsById, overridesMap, gameMode) {
  // Emergency overrides always win
  if (overridesMap.has(entity.id)) return;

  const wikiFacts = wikiFactsById.get(entity.id);
  if (!wikiFacts) return; // No wiki page — keep API facts

  // Set per-mode facts
  entity.facts = wikiFacts.pve; // PvE is always populated
  entity.hasSplit = wikiFacts.hasSplit;

  if (wikiFacts.wvw) {
    entity.wvwFacts = wikiFacts.wvw;
  }
  if (wikiFacts.pvp) {
    entity.pvpFacts = wikiFacts.pvp;
  }
}
```

- [ ] **Step 3: Add wiki resolution call into getProfessionCatalog**

After the existing entity mapping (after `skills: skills.map(mapSkill)` and the traits/weaponSkills mapping), add a wiki resolution step before the return statement. Insert this just before the `return {` block (around line ~793):

```js
  // ── Wiki fact resolution ─────────────────────────────────────────────────
  // Collect all entity names for batch wiki lookup.
  // Skills and traits use their name as the wiki page title.
  const allMappedSkills = skills.map(mapSkill);
  const allMappedTraits = traits.map((trait) => {
    /* ... existing trait mapping ... */
  });
  const allMappedWeaponSkills = weaponSkillsRaw.map((skill) => {
    /* ... existing weapon skill mapping ... */
  });

  const titleToId = new Map();
  for (const s of allMappedSkills) {
    if (s.name) titleToId.set(s.name, s.id);
  }
  for (const t of allMappedTraits) {
    if (t.name) titleToId.set(t.name, t.id);
  }
  for (const ws of allMappedWeaponSkills) {
    if (ws.name) titleToId.set(ws.name, ws.id);
  }

  let wikiFactsById = new Map();
  try {
    const client = getWikiClient();
    wikiFactsById = await resolveEntityFacts(client, titleToId);
  } catch (err) {
    console.warn("[catalog] Wiki fact resolution failed, using API facts:", err.message);
  }

  // Apply wiki facts to all entities
  for (const s of allMappedSkills) {
    applyWikiFacts(s, wikiFactsById, KNOWN_SKILL_FACTS_OVERRIDES, gameMode);
  }
  for (const t of allMappedTraits) {
    applyWikiFacts(t, wikiFactsById, KNOWN_TRAIT_FACTS_OVERRIDES, gameMode);
  }
  for (const ws of allMappedWeaponSkills) {
    applyWikiFacts(ws, wikiFactsById, KNOWN_SKILL_FACTS_OVERRIDES, gameMode);
  }

  // Log missing pages for monitoring
  const resolved = wikiFactsById.size;
  const total = titleToId.size;
  if (resolved < total) {
    const missing = [...titleToId.keys()].filter((t) => !wikiFactsById.has(titleToId.get(t)));
    console.warn(`[catalog] Wiki facts: ${resolved}/${total} resolved. Missing: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10} more)` : ""}`);
  }
```

Note: The actual implementation needs to restructure the existing code so that `skills.map(mapSkill)`, `traits.map(...)`, and `weaponSkillsRaw.map(...)` are called first, stored in variables, then wiki facts are applied, and finally the return object references those variables. The existing code inlines these into the return statement — they need to be hoisted.

- [ ] **Step 4: Restructure the return statement**

The existing return block (around line ~790) inlines `traits.map(...)`, `skills.map(mapSkill)`, and `weaponSkillsRaw.map(...)` directly. Hoist these to variables so wiki facts can be applied between mapping and returning:

```js
  // Hoist entity mapping out of the return statement
  const mappedSpecializations = (profSpecIds.length > 0 ? specializations : []).map((spec) => ({
    id: spec.id,
    name: spec.name || "",
    profession: spec.profession || "",
    elite: Boolean(spec.elite),
    icon: spec.icon || "",
    background: spec.background || "",
    minorTraits: Array.isArray(spec.minor_traits) ? spec.minor_traits : [],
    majorTraits: Array.isArray(spec.major_traits) ? spec.major_traits : [],
  }));

  const mappedTraits = traits.map((trait) => {
    const mapped = {
      id: trait.id,
      name: trait.name || "",
      icon: trait.icon || "",
      iconFallback: "",
      description: trait.description || "",
      tier: Number(trait.tier) || 0,
      order: Number(trait.order) || 0,
      slot: trait.slot || "",
      specialization: Number(trait.specialization) || 0,
      facts: KNOWN_TRAIT_FACTS_OVERRIDES.get(trait.id) || (Array.isArray(trait.facts) ? trait.facts.filter((f) => !f.requires_trait) : []),
      traitedFacts: Array.isArray(trait.traited_facts) ? trait.traited_facts : [],
      traitSkillIds: Array.isArray(trait.skills)
        ? trait.skills.map((s) => Number(s?.id)).filter(Boolean)
        : [],
      traitSkillIcons: Array.isArray(trait.skills)
        ? Object.fromEntries(
            trait.skills
              .filter((s) => s?.id && s?.icon)
              .map((s) => [Number(s.id), String(s.icon)])
          )
        : {},
    };
    return mapped;
  });

  const mappedSkills = skills.map(mapSkill);

  const mappedWeaponSkills = weaponSkillsRaw.map((skill) => {
    const mapped = {
      id: skill.id,
      name: skill.name || "",
      icon: skill.icon || "",
      description: skill.description || "",
      slot: skill.slot || "",
      attunement: skill.attunement === "None" ? "" : (skill.attunement || ""),
      dualWield: skill.dual_attunement === "None" ? "" : (skill.dual_attunement || ""),
      weaponType: skill.weapon_type === "None" ? "" : (skill.weapon_type || ""),
      flags: Array.isArray(skill.flags) ? skill.flags : [],
      facts: Array.isArray(skill.facts) ? skill.facts : [],
      flipSkill: Number(skill.flip_skill) || 0,
    };
    return mapped;
  });

  // Wiki fact resolution (see Step 3)
  // ... titleToId collection + resolveEntityFacts + applyWikiFacts ...

  return {
    professionId,
    specializations: mappedSpecializations,
    traits: mappedTraits,
    skills: mappedSkills,
    professionWeapons: Object.fromEntries(/* ... existing code ... */),
    weaponSkills: mappedWeaponSkills,
    legends,
    pets,
    gameMode: gameMode || "pve",
    updatedAt: new Date().toISOString(),
  };
```

- [ ] **Step 5: Update index.js to export initWikiClient**

```js
// src/main/gw2Data/index.js
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, _setStaticData, initWikiClient } = require("./catalog");
const { getWikiSummary, getWikiRelatedData } = require("./wiki");
const { initDiskCache, clearDiskCache } = require("./fetch");

module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  getWikiSummary,
  getWikiRelatedData,
  initDiskCache,
  clearDiskCache,
  _setStaticData,
  initWikiClient,
};
```

- [ ] **Step 6: Verify build**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/ --no-coverage --passWithNoTests 2>&1 | tail -10`

Expected: All package tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/gw2Data/catalog.js src/main/gw2Data/index.js
git commit -m "feat: add wiki fact resolution to catalog assembly, per-mode fact storage (Phase 4, Task 6)"
```

---

### Task 7: IPC — Eager Warm-up with Lazy Fallback

Change catalog loading to return API-skeleton facts immediately, then resolve wiki facts in the background. The main process sends incremental updates via IPC. A lazy fallback lets the renderer request wiki facts for specific entities on demand.

**Files:**
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

- [ ] **Step 1: Initialize wiki client at app startup**

In `src/main/index.js`, after the existing `initDiskCache` call, add wiki client initialization:

```js
// src/main/index.js — after initDiskCache call
const { initWikiClient } = require("./gw2Data");

// Inside the app.whenReady() or initialization block:
initWikiClient(app.getPath("userData"));
```

- [ ] **Step 2: Add IPC push channel for wiki fact updates**

```js
// src/main/index.js — after existing gw2:get-profession-catalog handler

// Background wiki resolution — sends batched updates to the renderer
const _wikiResolutionInFlight = new Map(); // professionId → AbortController

ipcMain.handle("gw2:get-profession-catalog", async (_e, professionId, gameMode) => {
  const catalog = await getProfessionCatalog(professionId, "en", gameMode);

  // If wiki facts were resolved synchronously (cache hit), they're already in the catalog.
  // If not, schedule background resolution.
  // The catalog will have entities with API-only facts that need wiki enrichment.
  return catalog;
});

// Lazy fallback: renderer requests wiki facts for a specific entity
ipcMain.handle("wiki:resolve-entity-facts", async (_e, entityNames) => {
  const { WikiClient } = require("@axi/gw2-data/wiki/client");
  const { resolveEntityFacts } = require("@axi/gw2-data/wiki/resolver");
  const client = require("./gw2Data/catalog").getWikiClient?.() || new WikiClient();

  const titleToId = new Map(entityNames.map((n) => [n.name, n.id]));
  const result = await resolveEntityFacts(client, titleToId);

  // Convert Map to plain object for IPC serialization
  const serialized = {};
  for (const [id, facts] of result) {
    serialized[id] = facts;
  }
  return serialized;
});
```

- [ ] **Step 3: Add preload bridge for wiki facts channels**

```js
// src/preload/index.js — add after existing getProfessionCatalog entry
  resolveEntityFacts: (entityNames) =>
    ipcRenderer.invoke("wiki:resolve-entity-facts", entityNames),
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/preload/index.js
git commit -m "feat: add IPC handlers for wiki fact resolution (Phase 4, Task 7)"
```

---

### Task 8: Renderer — Wiki Update Listener and Per-Mode Facts

Create a renderer module that handles lazy wiki fact requests and updates the catalog cache. Update `detail-panel.js` to use per-mode facts.

**Files:**
- Create: `src/renderer/modules/wiki-updates.js`
- Modify: `src/renderer/modules/detail-panel.js`
- Modify: `src/renderer/modules/state.js`
- Modify: `src/renderer/renderer.js`

- [ ] **Step 1: Add wiki resolution state tracking**

```js
// src/renderer/modules/state.js — add to the state object
  wikiResolution: {
    pending: new Set(),    // entity IDs with pending wiki resolution
    resolved: new Set(),   // entity IDs with completed wiki resolution
  },
```

- [ ] **Step 2: Create wiki-updates.js**

```js
// src/renderer/modules/wiki-updates.js
import { state } from "./state.js";

/**
 * Request wiki fact resolution for entities missing wiki facts.
 * Called when the detail panel opens an entity that only has API facts.
 *
 * @param {Object[]} entities - Array of { id, name } for entities to resolve
 * @returns {Promise<Object>} - Map of id → { pve, wvw, pvp, hasSplit }
 */
export async function requestWikiFacts(entities) {
  const unresolved = entities.filter(
    (e) => !state.wikiResolution.resolved.has(e.id) && !state.wikiResolution.pending.has(e.id)
  );
  if (unresolved.length === 0) return {};

  for (const e of unresolved) {
    state.wikiResolution.pending.add(e.id);
  }

  try {
    const result = await window.desktopApi.resolveEntityFacts(unresolved);

    // Update catalog entities in place
    const catalog = state.activeCatalog;
    if (catalog) {
      for (const [idStr, facts] of Object.entries(result)) {
        const id = Number(idStr);
        const entity =
          catalog.skillById?.get(id) ||
          catalog.traitById?.get(id) ||
          catalog.weaponSkillById?.get(id);

        if (entity) {
          entity.facts = facts.pve;
          entity.hasSplit = facts.hasSplit;
          if (facts.wvw) entity.wvwFacts = facts.wvw;
          if (facts.pvp) entity.pvpFacts = facts.pvp;
        }

        state.wikiResolution.resolved.add(id);
        state.wikiResolution.pending.delete(id);
      }
    }

    return result;
  } catch (err) {
    console.warn("[wiki-updates] Failed to resolve wiki facts:", err.message);
    for (const e of unresolved) {
      state.wikiResolution.pending.delete(e.id);
    }
    return {};
  }
}

/**
 * Reset wiki resolution tracking (e.g. when switching professions).
 */
export function resetWikiResolution() {
  state.wikiResolution.pending.clear();
  state.wikiResolution.resolved.clear();
}
```

- [ ] **Step 3: Update resolveEntityFacts in detail-panel.js for per-mode facts**

Update the `resolveEntityFacts` function to check the current game mode and use the appropriate fact set:

```js
// src/renderer/modules/detail-panel.js — update resolveEntityFacts

export function resolveEntityFacts(entity) {
  const gameMode = state.editor?.gameMode || "pve";

  // Select the appropriate fact set based on game mode
  let baseFacts;
  if (gameMode === "wvw" && Array.isArray(entity.wvwFacts)) {
    baseFacts = entity.wvwFacts;
  } else if (gameMode === "pvp" && Array.isArray(entity.pvpFacts)) {
    baseFacts = entity.pvpFacts;
  } else {
    baseFacts = Array.isArray(entity.facts) ? entity.facts : [];
  }

  const traitedFacts = Array.isArray(entity.traitedFacts) ? entity.traitedFacts : [];

  // Apply traited_facts overrides when the required trait is active.
  let result = baseFacts;
  if (traitedFacts.length) {
    // ... existing traited facts logic (unchanged) ...
    const activeTraitIds = new Set();
    const catalog = state.activeCatalog;
    for (const spec of state.editor.specializations || []) {
      for (const id of Object.values(spec?.majorChoices || {})) {
        const n = Number(id);
        if (n) activeTraitIds.add(n);
      }
      const specId = Number(spec?.specializationId || spec?.id) || 0;
      const specData = specId ? catalog?.specializationById?.get(specId) : null;
      for (const minorId of specData?.minorTraits || []) {
        if (minorId) activeTraitIds.add(Number(minorId));
      }
    }
    if (activeTraitIds.size) {
      result = [...baseFacts];
      for (const tf of traitedFacts) {
        if (!activeTraitIds.has(Number(tf.requires_trait))) continue;
        const { requires_trait: _r, overrides, ...factData } = tf;
        factData._traitedFact = true;
        if (overrides !== undefined && overrides !== null && overrides >= 0 && overrides < result.length) {
          result[overrides] = factData;
        } else if (overrides === undefined || overrides === null) {
          result.push(factData);
        }
      }
    }
  }

  // ... existing dedup logic (unchanged) ...
  result = result.map((f) =>
    f.type === "NoData" && /breaks?\s*stun/i.test(f.text)
      ? { ...f, type: "StunBreak", text: "Stun Break", value: true }
      : f
  );

  const seen = new Set();
  return result.filter((f) => {
    if (f.type === "NoData") return true;
    const statusKey = (f.status || "").trim();
    if (statusKey) {
      const key = `status:${statusKey}|${f.apply_count || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    const text = (f.text || "").trim();
    if (!text) return true;
    const key = `${text}|${f.type || ""}|${f.target || ""}|${f.source || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 4: Add split delta highlighting**

In the game mode toggle handler in `renderer.js` (around line 1055-1093), update the fact annotation logic to compare PvE vs WvW/PvP facts for split highlighting:

```js
// src/renderer/renderer.js — update the game mode toggle fact annotation block

          if (freshEntity) {
            const oldFacts = state.detail.facts || [];
            const newFacts = resolveEntityFacts(freshEntity);

            // Delta comparison for split highlighting:
            // Compare current mode's facts against PvE facts to find changed values.
            if (mode !== "pve" && freshEntity.hasSplit) {
              const pveFacts = Array.isArray(freshEntity.facts) ? freshEntity.facts : [];
              const factKey = (f) => f.status
                ? `${f.type}:${f.status}`
                : `${f.type}:${(f.text || "").toLowerCase()}`;
              const pveByKey = new Map(pveFacts.map((f) => [factKey(f), f]));

              const annotatedFacts = newFacts.map((f) => {
                const key = factKey(f);
                const pveFact = pveByKey.get(key);
                if (!pveFact) return { ...f, _newFact: true }; // Fact exists only in this mode
                // Check if any value field differs
                const VALUE_KEYS = ["value", "duration", "percent", "distance", "dmg_multiplier", "hit_count", "apply_count", "coefficient"];
                const changed = VALUE_KEYS.some((k) => f[k] !== undefined && pveFact[k] !== undefined && f[k] !== pveFact[k]);
                if (changed) return { ...f, _splitFact: true };
                return f;
              });

              state.detail = {
                ...state.detail,
                facts: annotatedFacts,
                hasSplit: true,
              };
            } else {
              state.detail = {
                ...state.detail,
                facts: newFacts,
                hasSplit: Boolean(freshEntity.hasSplit),
              };
            }
          }
```

- [ ] **Step 5: Import wiki-updates in renderer.js**

```js
// src/renderer/renderer.js — add import
import { resetWikiResolution } from "./modules/wiki-updates.js";
```

Call `resetWikiResolution()` when switching professions (in the profession selector handler, before loading a new catalog).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/wiki-updates.js src/renderer/modules/detail-panel.js src/renderer/modules/state.js src/renderer/renderer.js
git commit -m "feat: add renderer wiki fact updates, per-mode fact resolution, split delta highlighting (Phase 4, Task 8)"
```

---

### Task 9: Integration Tests

Full pipeline test: mock API skeleton + mock wiki responses verify all entities have facts, game mode facts are separated correctly, traited facts have wiki values, icons can be injected, and missing pages are logged.

**Files:**
- Create: `packages/gw2-data/tests/wiki-integration.test.js`

- [ ] **Step 1: Create integration test**

```js
// packages/gw2-data/tests/wiki-integration.test.js
"use strict";

const { resolveEntityFacts, parseFactsByMode } = require("../src/wiki/resolver");
const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");

describe("Wiki fact resolution integration", () => {
  let client;
  let mockFetch;

  const MOCK_WIKI_PAGES = {
    Fireball: [
      "{{skill fact|damage|coefficient=0.9}}",
      "{{skill fact|burning|3|stacks=1}}",
      "{{skill fact|range|900}}",
    ].join("\n"),
    Shelter: [
      "| split = pve, wvw pvp",
      "{{skill fact|healing|4000|coefficient=0.75}}",
      "{{skill fact|healing|3200|coefficient=0.6|game mode=wvw pvp}}",
      "{{skill fact|recharge|30}}",
    ].join("\n"),
    "Searing Slash": [
      "| split = pve, wvw pvp",
      "{{skill fact|damage|coefficient=1.2}}",
      "{{skill fact|burning|4|stacks=2|game mode=pve}}",
      "{{skill fact|burning|2|stacks=1|game mode=wvw pvp}}",
      "{{skill fact|combo|fire}}",
    ].join("\n"),
  };

  beforeEach(() => {
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: Object.fromEntries(
            Object.entries(MOCK_WIKI_PAGES).map(([title, wikitext], i) => [
              String(i + 1),
              { title, revisions: [{ "*": wikitext }] },
            ])
          ),
        },
      }),
    });
    client = new WikiClient({ cache: new MemoryCache(), fetch: mockFetch });
  });

  test("resolves all entities with correct per-mode facts", async () => {
    const titleToId = new Map([
      ["Fireball", 5489],
      ["Shelter", 9124],
      ["Searing Slash", 12345],
    ]);

    const result = await resolveEntityFacts(client, titleToId);

    // Fireball: no split
    const fireball = result.get(5489);
    expect(fireball.hasSplit).toBe(false);
    expect(fireball.pve).toHaveLength(3);
    expect(fireball.wvw).toBeNull();
    expect(fireball.pvp).toBeNull();

    // Shelter: PvE vs WvW/PvP split
    const shelter = result.get(9124);
    expect(shelter.hasSplit).toBe(true);
    expect(shelter.pve).toHaveLength(2); // healing(universal) + recharge
    expect(shelter.wvw).toHaveLength(2); // healing(wvw) + recharge
    // PvE healing = 4000, WvW healing = 3200
    const pveHeal = shelter.pve.find((f) => f.target === "Healing");
    const wvwHeal = shelter.wvw.find((f) => f.target === "Healing");
    expect(pveHeal.value).toBe(4000);
    expect(wvwHeal.value).toBe(3200);

    // Searing Slash: split with different burning stacks
    const slash = result.get(12345);
    expect(slash.hasSplit).toBe(true);
    expect(slash.pve).toHaveLength(3); // damage + pve burning + combo
    expect(slash.wvw).toHaveLength(3); // damage + wvw burning + combo
    const pveBurn = slash.pve.find((f) => f.status === "Burning");
    const wvwBurn = slash.wvw.find((f) => f.status === "Burning");
    expect(pveBurn.duration).toBe(4);
    expect(pveBurn.apply_count).toBe(2);
    expect(wvwBurn.duration).toBe(2);
    expect(wvwBurn.apply_count).toBe(1);
  });

  test("missing wiki pages are not in result map", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            "1": { title: "Fireball", revisions: [{ "*": "{{skill fact|damage|0.8}}" }] },
            "-1": { title: "Unknown Skill", missing: true },
          },
        },
      }),
    });

    const titleToId = new Map([
      ["Fireball", 5489],
      ["Unknown Skill", 9999],
    ]);

    const result = await resolveEntityFacts(client, titleToId);
    expect(result.has(5489)).toBe(true);
    expect(result.has(9999)).toBe(false);
  });

  test("parseFactsByMode correctly separates all three modes", () => {
    const wikitext = [
      "| split = pve, wvw, pvp",
      "{{skill fact|damage|coefficient=1.0}}",
      "{{skill fact|recharge|20|game mode=pve}}",
      "{{skill fact|recharge|25|game mode=wvw}}",
      "{{skill fact|recharge|30|game mode=pvp}}",
    ].join("\n");

    const result = parseFactsByMode(wikitext);
    expect(result.hasSplit).toBe(true);

    // Damage is universal → all modes
    expect(result.pve).toHaveLength(2);
    expect(result.wvw).toHaveLength(2);
    expect(result.pvp).toHaveLength(2);

    // Recharge differs per mode
    const pveRecharge = result.pve.find((f) => f.type === "Recharge");
    const wvwRecharge = result.wvw.find((f) => f.type === "Recharge");
    const pvpRecharge = result.pvp.find((f) => f.type === "Recharge");
    expect(pveRecharge.value).toBe(20);
    expect(wvwRecharge.value).toBe(25);
    expect(pvpRecharge.value).toBe(30);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/wiki-integration.test.js --no-coverage`

Expected: All integration tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/gw2-data/tests/wiki-integration.test.js
git commit -m "test(gw2-data): add wiki fact resolution integration tests (Phase 4, Task 9)"
```

---

### Task 10: Live Validation Tests

Extend the existing real-data test infrastructure to validate wiki fact parsing against live wiki pages. Guarded by environment flag so CI skips them.

**Files:**
- Modify: `packages/gw2-data/tests/real-data.test.js` (or create `packages/gw2-data/tests/wiki-live-validation.test.js`)

- [ ] **Step 1: Create live validation test**

```js
// packages/gw2-data/tests/wiki-live-validation.test.js
"use strict";

const { WikiClient } = require("../src/wiki/client");
const { MemoryCache } = require("../src/wiki/cache");
const { parseFactsByMode } = require("../src/wiki/resolver");

const RUN_LIVE = process.env.GW2_LIVE_TESTS === "1";

const REPRESENTATIVE_SKILLS = [
  { title: "Fireball", expectedFactTypes: ["Damage"] },
  { title: "Shelter", expectedHasSplit: true },
  { title: "Signet of Inspiration", minFacts: 1 },
  { title: "Shattering Blow", minFacts: 1 },
  { title: "Moa Stance", minFacts: 1 },
];

(RUN_LIVE ? describe : describe.skip)("Live wiki fact validation", () => {
  let client;

  beforeAll(() => {
    client = new WikiClient({ cache: new MemoryCache() });
  });

  for (const skill of REPRESENTATIVE_SKILLS) {
    test(`${skill.title} — parses valid facts from live wiki`, async () => {
      const wikitext = await client.getWikitext(skill.title);
      expect(wikitext).not.toBeNull();

      const result = parseFactsByMode(wikitext);
      expect(result.pve.length).toBeGreaterThanOrEqual(skill.minFacts || 1);

      // Every fact should have a type and text
      for (const fact of result.pve) {
        expect(fact.type).toBeTruthy();
        expect(fact.text).toBeTruthy();
      }

      if (skill.expectedFactTypes) {
        for (const expectedType of skill.expectedFactTypes) {
          expect(result.pve.some((f) => f.type === expectedType)).toBe(true);
        }
      }

      if (skill.expectedHasSplit !== undefined) {
        expect(result.hasSplit).toBe(skill.expectedHasSplit);
      }
    }, 15000); // 15s timeout for live requests
  }

  test("batch fetch works with live wiki", async () => {
    const titles = REPRESENTATIVE_SKILLS.map((s) => s.title);
    const result = await client.getWikitextBatch(titles);
    expect(result.size).toBe(titles.length);
    for (const title of titles) {
      expect(result.has(title)).toBe(true);
      expect(result.get(title)).not.toBeNull();
    }
  }, 30000);
});
```

- [ ] **Step 2: Run live tests (manual)**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && GW2_LIVE_TESTS=1 npx jest packages/gw2-data/tests/wiki-live-validation.test.js --no-coverage`

Expected: All live tests pass (requires network access to wiki.guildwars2.com).

- [ ] **Step 3: Verify skipped in CI**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npx jest packages/gw2-data/tests/wiki-live-validation.test.js --no-coverage`

Expected: Tests are skipped (describe.skip) when `GW2_LIVE_TESTS` is not set.

- [ ] **Step 4: Commit**

```bash
git add packages/gw2-data/tests/wiki-live-validation.test.js
git commit -m "test(gw2-data): add live wiki fact validation tests (Phase 4, Task 10)"
```

---

## Execution Order and Dependencies

```
Task 1 (Parser Enhancement)
    └─→ Task 3 (Resolver Module) ←── Task 2 (Batch Fetching)
           └─→ Task 4 (Snapshot Fixtures)
           └─→ Task 5 (Delete Balance Splits)
                  └─→ Task 6 (Catalog Wiki Resolution)
                         └─→ Task 7 (IPC Handlers)
                                └─→ Task 8 (Renderer Updates)
           └─→ Task 9 (Integration Tests) — can run after Task 3
           └─→ Task 10 (Live Validation) — can run after Task 3
```

Tasks 1 and 2 are independent and can be done in parallel.
Tasks 4, 9, and 10 are independent test tasks that can be done in parallel after Task 3.
Tasks 5 through 8 are sequential (each depends on the previous).
