# @axi/gw2-data Phase 1: Monorepo + Wiki Data Layer + Fact Resolution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract axiforge's data pipeline into `@axi/gw2-data` workspace package — wiki client, GW2 API client, wikitext parser, fact matching, and fact merging — so axiforge and community tools can consume a single authoritative data source.

**Architecture:** Monorepo with npm workspaces. The package lives at `packages/gw2-data/` and is consumed by the root axiforge app as `@axi/gw2-data`. CommonJS initially (matching axiforge), with ESM build added later. Existing battle-tested code is extracted and refactored into clean module boundaries.

**Tech Stack:** Node.js, Jest, npm workspaces, CommonJS

**Spec:** `docs/superpowers/specs/2026-04-09-gw2-data-package-design.md`

---

## File Structure

### New files (packages/gw2-data/)

| File | Responsibility |
|------|---------------|
| `packages/gw2-data/package.json` | Package manifest, exports map |
| `packages/gw2-data/src/index.js` | Root entry point, re-exports all public API |
| `packages/gw2-data/src/api/client.js` | GW2 API client: fetch by IDs, request queue, retry logic |
| `packages/gw2-data/src/api/types.js` | JSDoc type definitions for GW2 API data structures |
| `packages/gw2-data/src/wiki/client.js` | Wiki API client: fetch wikitext, summaries, related data |
| `packages/gw2-data/src/wiki/parser.js` | Wikitext template parser: `{{skill fact}}`, `{{trait fact}}` |
| `packages/gw2-data/src/wiki/relations.js` | Related skills/traits graph builder from wiki sections |
| `packages/gw2-data/src/wiki/cache.js` | Pluggable cache: interface + memory/disk implementations |
| `packages/gw2-data/src/facts/match.js` | Three-pass fuzzy fact matching algorithm |
| `packages/gw2-data/src/facts/merge.js` | Merge API skeleton + wiki fact values |
| `packages/gw2-data/src/facts/normalize.js` | Fact type normalization, markup stripping |
| `packages/gw2-data/tests/cache.test.js` | Cache interface + implementations tests |
| `packages/gw2-data/tests/api-client.test.js` | GW2 API client tests |
| `packages/gw2-data/tests/wiki-client.test.js` | Wiki client tests |
| `packages/gw2-data/tests/parser.test.js` | Wikitext parser tests |
| `packages/gw2-data/tests/relations.test.js` | Relations graph tests |
| `packages/gw2-data/tests/match.test.js` | Fact matching tests |
| `packages/gw2-data/tests/merge.test.js` | Fact merge tests |
| `packages/gw2-data/tests/normalize.test.js` | Normalization tests |

### Files modified in axiforge root

| File | Change |
|------|--------|
| `package.json` | Add `workspaces` field, add `@axi/gw2-data` dependency |
| `jest.config` (in package.json) | Update `testMatch` to include workspace packages |

---

## Task 1: Monorepo Scaffolding

**Files:**
- Create: `packages/gw2-data/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Create packages directory**

```bash
mkdir -p packages/gw2-data/src packages/gw2-data/tests
```

- [ ] **Step 2: Create package.json for @axi/gw2-data**

Create `packages/gw2-data/package.json`:

```json
{
  "name": "@axi/gw2-data",
  "version": "0.1.0",
  "description": "GW2 data library — wiki-sourced facts, GW2 API structural data, and stat computation",
  "main": "src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./wiki": "./src/wiki/client.js",
    "./api": "./src/api/client.js",
    "./facts": "./src/facts/merge.js",
    "./engine": "./src/engine/index.js"
  },
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/packages/gw2-data/tests/**/*.test.js"],
    "clearMocks": true,
    "testTimeout": 15000
  },
  "license": "MIT",
  "keywords": ["gw2", "guild-wars-2", "wiki", "api", "build-editor"],
  "repository": {
    "type": "git",
    "url": "https://github.com/darkharasho/axiforge",
    "directory": "packages/gw2-data"
  },
  "devDependencies": {
    "jest": "^30.3.0"
  }
}
```

- [ ] **Step 3: Add workspaces to root package.json**

In the root `package.json`, add the `workspaces` field after the `version` field:

```json
"workspaces": ["packages/*"],
```

- [ ] **Step 4: Update root Jest config to exclude workspace packages**

In root `package.json`, update the Jest `testMatch` to avoid double-running package tests. Change:

```json
"testMatch": [
  "**/tests/**/*.test.js"
]
```

to:

```json
"testMatch": [
  "<rootDir>/tests/**/*.test.js"
]
```

This scopes root-level Jest to only axiforge's own tests. The package has its own Jest config.

- [ ] **Step 5: Create stub index.js**

Create `packages/gw2-data/src/index.js`:

```js
"use strict";

// @axi/gw2-data — GW2 data library
// Wiki-sourced facts, GW2 API structural data, and stat computation

module.exports = {};
```

- [ ] **Step 6: Install workspace dependencies**

```bash
npm install
```

Verify that `node_modules/@axi/gw2-data` symlinks to `packages/gw2-data/`.

- [ ] **Step 7: Run existing tests to verify nothing broke**

```bash
npm test
```

Expected: All existing axiforge tests pass. No regressions from workspace setup.

- [ ] **Step 8: Commit**

```bash
git add packages/gw2-data/package.json packages/gw2-data/src/index.js package.json package-lock.json
git commit -m "chore: scaffold @axi/gw2-data monorepo workspace"
```

---

## Task 2: Pluggable Cache Module

**Files:**
- Create: `packages/gw2-data/src/wiki/cache.js`
- Create: `packages/gw2-data/tests/cache.test.js`

- [ ] **Step 1: Write failing tests for MemoryCache**

Create `packages/gw2-data/tests/cache.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/cache.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/wiki/cache'`

- [ ] **Step 3: Implement MemoryCache**

Create `packages/gw2-data/src/wiki/cache.js`:

```js
"use strict";

/**
 * @typedef {Object} CacheAdapter
 * @property {(key: string) => any|null} get - Get value by key, null if missing/expired
 * @property {(key: string, value: any, ttlMs: number) => void} set - Set value with TTL in milliseconds
 * @property {(key: string) => void} invalidate - Remove a specific key
 * @property {() => void} clear - Remove all entries
 * @property {(key: string) => boolean} has - Check if key exists and is not expired
 */

class MemoryCache {
  constructor() {
    this._store = new Map();
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  has(key) {
    return this.get(key) !== null;
  }
}

module.exports = { MemoryCache };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/cache.test.js --verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Write failing tests for DiskCache**

Add to `packages/gw2-data/tests/cache.test.js`:

```js
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
```

- [ ] **Step 6: Run test to verify DiskCache tests fail**

```bash
cd packages/gw2-data && npx jest tests/cache.test.js --verbose
```

Expected: MemoryCache tests PASS, DiskCache tests FAIL — `DiskCache is not a constructor`

- [ ] **Step 7: Implement DiskCache**

Add to `packages/gw2-data/src/wiki/cache.js`:

```js
const fs = require("node:fs/promises");
const path = require("node:path");

class DiskCache {
  constructor(dir) {
    this._dir = dir;
  }

  _filePath(key) {
    // Sanitize key for filesystem safety
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this._dir, `${safeKey}.json`);
  }

  async get(key) {
    try {
      const raw = await fs.readFile(this._filePath(key), "utf-8");
      const entry = JSON.parse(raw);
      if (Date.now() >= entry.expiresAt) {
        await this.invalidate(key);
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  async set(key, value, ttlMs) {
    const entry = { value, expiresAt: Date.now() + ttlMs };
    await fs.mkdir(this._dir, { recursive: true });
    await fs.writeFile(this._filePath(key), JSON.stringify(entry), "utf-8");
  }

  async invalidate(key) {
    try {
      await fs.unlink(this._filePath(key));
    } catch {
      // File may not exist
    }
  }

  async clear() {
    try {
      const files = await fs.readdir(this._dir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => fs.unlink(path.join(this._dir, f)))
      );
    } catch {
      // Directory may not exist
    }
  }

  async has(key) {
    return (await this.get(key)) !== null;
  }
}

module.exports = { MemoryCache, DiskCache };
```

- [ ] **Step 8: Run all cache tests**

```bash
cd packages/gw2-data && npx jest tests/cache.test.js --verbose
```

Expected: All 12 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/gw2-data/src/wiki/cache.js packages/gw2-data/tests/cache.test.js
git commit -m "feat(gw2-data): add pluggable cache with memory and disk implementations"
```

---

## Task 3: GW2 API Client

**Files:**
- Create: `packages/gw2-data/src/api/client.js`
- Create: `packages/gw2-data/tests/api-client.test.js`

This extracts the core logic from `src/main/gw2Data/fetch.js` into a standalone module with no Electron dependencies.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/api-client.test.js`:

```js
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
      // The URL should have ids=1, not ids=1,1,1
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
      // Second call should use cache
      const result2 = await client.fetchCached("test-key", "https://example.com", 60000);
      expect(result2).toEqual({ fresh: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/api-client.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/api/client'`

- [ ] **Step 3: Implement Gw2ApiClient**

Create `packages/gw2-data/src/api/client.js`:

```js
"use strict";

const GW2_API_ROOT = "https://api.guildwars2.com";
const MAX_IDS_PER_REQUEST = 180;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 3;
const RATE_LIMIT_DELAY_MS = 2000;
const USER_AGENT = "@axi/gw2-data (https://github.com/darkharasho/axiforge)";

class Gw2ApiClient {
  /**
   * @param {Object} options
   * @param {import('../wiki/cache').CacheAdapter} options.cache - Cache adapter
   * @param {Function} [options.fetch] - Fetch implementation (defaults to global fetch)
   * @param {string} [options.apiRoot] - GW2 API root URL
   * @param {string} [options.lang] - Language code (default: "en")
   */
  constructor(options = {}) {
    this._cache = options.cache;
    this._fetch = options.fetch || globalThis.fetch;
    this._apiRoot = options.apiRoot || GW2_API_ROOT;
    this._lang = options.lang || "en";
    this._queue = [];
    this._activeRequests = 0;
  }

  async fetchJson(url) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await this._enqueue(() =>
        this._fetch(url, {
          headers: { "User-Agent": USER_AGENT },
        })
      );
      if (res.ok) {
        return res.json();
      }
      if (res.status === 429) {
        await this._delay(RATE_LIMIT_DELAY_MS);
        continue;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
      if (res.status >= 500) {
        await this._delay(500 * (attempt + 1));
        continue;
      }
      throw lastError;
    }
    throw lastError;
  }

  async fetchByIds(endpoint, ids, lang) {
    const dedupedIds = [...new Set(ids)];
    const chunks = this._chunk(dedupedIds, MAX_IDS_PER_REQUEST);
    const langParam = lang || this._lang;
    const results = [];

    for (const chunk of chunks) {
      const url = `${this._apiRoot}${endpoint}?ids=${chunk.join(",")}&lang=${langParam}`;
      const data = await this.fetchJson(url);
      results.push(...data);
    }

    return results;
  }

  async fetchCached(key, url, ttlMs) {
    const cached = this._cache.get(key);
    if (cached !== null) return cached;

    const data = await this.fetchJson(url);
    this._cache.set(key, data, ttlMs);
    return data;
  }

  _chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._queue.length > 0 && this._activeRequests < MAX_CONCURRENT) {
      const { fn, resolve, reject } = this._queue.shift();
      this._activeRequests++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this._activeRequests--;
          this._drain();
        });
    }
  }
}

module.exports = {
  Gw2ApiClient,
  GW2_API_ROOT,
  MAX_IDS_PER_REQUEST,
  USER_AGENT,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/api-client.test.js --verbose
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/api/client.js packages/gw2-data/tests/api-client.test.js
git commit -m "feat(gw2-data): add GW2 API client with request queue, retry, and caching"
```

---

## Task 4: JSDoc Type Definitions

**Files:**
- Create: `packages/gw2-data/src/api/types.js`

No tests needed — this is pure type documentation.

- [ ] **Step 1: Create type definitions**

Create `packages/gw2-data/src/api/types.js`:

```js
"use strict";

/**
 * @typedef {'pve'|'wvw'|'pvp'} GameMode
 */

/**
 * @typedef {Object} Fact
 * @property {string} type - Fact type (Damage, Buff, AttributeAdjust, Recharge, etc.)
 * @property {string} text - Display label
 * @property {string} [icon] - Icon URL
 * @property {number} [value] - Numeric value (AttributeAdjust, Number)
 * @property {number} [duration] - Duration in seconds (Buff, Time)
 * @property {number} [apply_count] - Stack count (Buff)
 * @property {string} [status] - Buff/condition name (Buff)
 * @property {number} [dmg_multiplier] - Damage coefficient (Damage)
 * @property {number} [hit_count] - Number of hits (Damage)
 * @property {number} [distance] - Distance/radius in units (Distance, Radius)
 * @property {number} [percent] - Percentage value (Percent)
 * @property {number} [coefficient] - Healing/barrier coefficient
 * @property {string} [target] - Target attribute (AttributeAdjust, BuffConversion)
 * @property {string} [source] - Source attribute (BuffConversion)
 * @property {string} [finisher_type] - Combo finisher type (ComboFinisher)
 * @property {string} [field_type] - Combo field type (ComboField)
 * @property {boolean} [_splitFact] - Marked true when fact value comes from a balance split
 * @property {boolean} [_traitedFact] - Marked true when fact is from traited_facts
 * @property {boolean} [_newFact] - Marked true when fact was added by split (not in API)
 */

/**
 * @typedef {Object} ResolvedSkill
 * @property {number} id - Skill ID
 * @property {string} name - Skill name
 * @property {string} description - Skill description
 * @property {string} icon - Icon URL
 * @property {string} [slot] - Slot type (Weapon_1-5, Heal, Utility, Elite, Profession_1-5)
 * @property {number} [specialization] - Required specialization ID
 * @property {string[]} [professions] - Professions that can use this skill
 * @property {Fact[]} facts - Resolved facts for the requested game mode
 * @property {Fact[]} [traited_facts] - Facts that change when specific traits are active
 * @property {boolean} [hasSplit] - True if facts differ from PvE in this game mode
 */

/**
 * @typedef {Object} ResolvedTrait
 * @property {number} id - Trait ID
 * @property {string} name - Trait name
 * @property {string} description - Trait description
 * @property {string} icon - Icon URL
 * @property {number} specialization - Specialization ID
 * @property {number} tier - Trait tier (1=minor adept, 2=major adept, etc.)
 * @property {number} order - Position in tier (0, 1, 2)
 * @property {Fact[]} facts - Resolved facts for the requested game mode
 * @property {Fact[]} [traited_facts] - Conditional facts
 * @property {boolean} [hasSplit] - True if facts differ from PvE
 */

/**
 * @typedef {Object} SplitEntry
 * @property {Fact[]} facts - Facts for this game mode
 * @property {boolean} [complete] - If true, this is the full fact set (not partial)
 */

/**
 * @typedef {Object} WikiRelation
 * @property {string} name - Related entity name
 * @property {string} [icon] - Icon URL
 * @property {string} [context] - Description of the relationship
 */

/**
 * @typedef {Object} CacheAdapter
 * @property {(key: string) => any|null} get
 * @property {(key: string, value: any, ttlMs: number) => void} set
 * @property {(key: string) => void} invalidate
 * @property {() => void} clear
 * @property {(key: string) => boolean} has
 */

module.exports = {};
```

- [ ] **Step 2: Commit**

```bash
git add packages/gw2-data/src/api/types.js
git commit -m "feat(gw2-data): add JSDoc type definitions for GW2 data structures"
```

---

## Task 5: Fact Normalization

**Files:**
- Create: `packages/gw2-data/src/facts/normalize.js`
- Create: `packages/gw2-data/tests/normalize.test.js`

This extracts type normalization and markup stripping used across the fact pipeline.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/normalize.test.js`:

```js
"use strict";

const {
  normalizeFactType,
  stripGw2Markup,
  stripWikiMarkup,
} = require("../src/facts/normalize");

describe("normalizeFactType", () => {
  test("normalizes Distance to Radius", () => {
    expect(normalizeFactType("Distance")).toBe("Radius");
  });

  test("normalizes PrefixedBuff to Buff", () => {
    expect(normalizeFactType("PrefixedBuff")).toBe("Buff");
  });

  test("normalizes ApplyBuffCondition to Buff", () => {
    expect(normalizeFactType("ApplyBuffCondition")).toBe("Buff");
  });

  test("passes through standard types unchanged", () => {
    expect(normalizeFactType("Damage")).toBe("Damage");
    expect(normalizeFactType("Buff")).toBe("Buff");
    expect(normalizeFactType("Recharge")).toBe("Recharge");
    expect(normalizeFactType("AttributeAdjust")).toBe("AttributeAdjust");
  });
});

describe("stripGw2Markup", () => {
  test("strips color tags", () => {
    expect(stripGw2Markup("<c=@abilitytype>Fireball</c>")).toBe("Fireball");
  });

  test("strips nested color tags", () => {
    expect(stripGw2Markup("Deals <c=@abilitytype>damage</c> to foes")).toBe(
      "Deals damage to foes"
    );
  });

  test("returns plain text unchanged", () => {
    expect(stripGw2Markup("No markup here")).toBe("No markup here");
  });
});

describe("stripWikiMarkup", () => {
  test("strips wiki links with display text", () => {
    expect(stripWikiMarkup("[[Burning|burning]]")).toBe("burning");
  });

  test("strips wiki links without display text", () => {
    expect(stripWikiMarkup("[[Burning]]")).toBe("Burning");
  });

  test("strips wiki links with anchors", () => {
    expect(stripWikiMarkup("[[Might#Effect|Might]]")).toBe("Might");
  });

  test("converts fraction templates to numbers", () => {
    expect(stripWikiMarkup("{{fraction|7.5}}")).toBe("7.5");
  });

  test("strips other templates", () => {
    expect(stripWikiMarkup("{{some template}}")).toBe("");
  });

  test("handles combined markup", () => {
    expect(
      stripWikiMarkup("Inflicts [[Bleeding|bleeding]] for {{fraction|2.5}}s")
    ).toBe("Inflicts bleeding for 2.5s");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/normalize.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/facts/normalize'`

- [ ] **Step 3: Implement normalization functions**

Create `packages/gw2-data/src/facts/normalize.js`:

```js
"use strict";

const TYPE_ALIASES = {
  Distance: "Radius",
  PrefixedBuff: "Buff",
  ApplyBuffCondition: "Buff",
};

/**
 * Normalizes GW2 API / wiki fact types to canonical names.
 * @param {string} type
 * @returns {string}
 */
function normalizeFactType(type) {
  return TYPE_ALIASES[type] || type;
}

/**
 * Strips GW2 API in-game markup (color tags like <c=@abilitytype>...</c>).
 * @param {string} text
 * @returns {string}
 */
function stripGw2Markup(text) {
  if (!text) return text;
  return text.replace(/<c[^>]*>(.*?)<\/c>/g, "$1");
}

/**
 * Strips wiki markup: [[links]], {{templates}}, converts {{fraction|N}} to N.
 * @param {string} text
 * @returns {string}
 */
function stripWikiMarkup(text) {
  if (!text) return text;
  // Convert {{fraction|N}} to N
  let result = text.replace(/\{\{fraction\|([^}]+)\}\}/g, "$1");
  // Strip remaining templates
  result = result.replace(/\{\{[^}]*\}\}/g, "");
  // Strip [[link#anchor|display]] → display
  result = result.replace(/\[\[[^\]]*\|([^\]]+)\]\]/g, "$1");
  // Strip [[link]] → link
  result = result.replace(/\[\[([^\]|]+)\]\]/g, "$1");
  return result;
}

module.exports = { normalizeFactType, stripGw2Markup, stripWikiMarkup };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/normalize.test.js --verbose
```

Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/facts/normalize.js packages/gw2-data/tests/normalize.test.js
git commit -m "feat(gw2-data): add fact type normalization and markup stripping"
```

---

## Task 6: Fact Matching Algorithm

**Files:**
- Create: `packages/gw2-data/src/facts/match.js`
- Create: `packages/gw2-data/tests/match.test.js`

This extracts the three-pass matching algorithm from `lib/gw2-balance-splits/match.js`.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/match.test.js`:

```js
"use strict";

const {
  buildMatchTables,
  splitGroupKey,
  valueChanged,
  VALUE_KEYS,
} = require("../src/facts/match");

describe("splitGroupKey", () => {
  test("uses normalized type and target for AttributeAdjust", () => {
    expect(splitGroupKey({ type: "AttributeAdjust", target: "Power" })).toBe(
      "AttributeAdjust:Power"
    );
  });

  test("uses normalized type and status for Buff", () => {
    expect(splitGroupKey({ type: "Buff", status: "Might" })).toBe("Buff:Might");
  });

  test("normalizes Distance to Radius", () => {
    expect(splitGroupKey({ type: "Distance", distance: 240 })).toBe("Radius:");
  });

  test("uses empty string when no target/status", () => {
    expect(splitGroupKey({ type: "Damage" })).toBe("Damage:");
  });
});

describe("valueChanged", () => {
  test("returns false when values are identical", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    const b = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    expect(valueChanged(a, b)).toBe(false);
  });

  test("returns true when dmg_multiplier differs", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0 };
    const b = { type: "Damage", dmg_multiplier: 0.5 };
    expect(valueChanged(a, b)).toBe(true);
  });

  test("returns true when duration differs", () => {
    const a = { type: "Buff", status: "Might", duration: 5 };
    const b = { type: "Buff", status: "Might", duration: 3 };
    expect(valueChanged(a, b)).toBe(true);
  });

  test("ignores hit_count if base does not have it", () => {
    const a = { type: "Damage", dmg_multiplier: 1.0 };
    const b = { type: "Damage", dmg_multiplier: 1.0, hit_count: 1 };
    expect(valueChanged(a, b)).toBe(false);
  });
});

describe("buildMatchTables", () => {
  test("pass 1: matches by exact text and type", () => {
    const base = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const split = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
      { type: "Buff", text: "Might", status: "Might", duration: 3 },
    ];
    const { baseToSplit, splitToBase } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
    expect(baseToSplit.get(1)).toBe(1);
    expect(splitToBase.get(0)).toBe(0);
    expect(splitToBase.get(1)).toBe(1);
  });

  test("pass 1.5: matches by exact text across different types", () => {
    const base = [{ type: "Number", text: "Maximum Count", value: 3 }];
    const split = [{ type: "Buff", text: "Maximum Count", value: 2 }];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
  });

  test("pass 2: positional match within same type group", () => {
    const base = [
      { type: "AttributeAdjust", text: "Healing", target: "Healing", value: 500 },
      { type: "AttributeAdjust", text: "Barrier", target: "Healing", value: 300 },
    ];
    const split = [
      { type: "AttributeAdjust", text: "Healing", target: "Healing", value: 400 },
      { type: "AttributeAdjust", text: "Barrier Strength", target: "Healing", value: 200 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    // First matched by text in pass 1, second by positional in pass 2
    expect(baseToSplit.get(0)).toBe(0);
    expect(baseToSplit.get(1)).toBe(1);
  });

  test("pass 3: keyword overlap match", () => {
    const base = [
      { type: "Buff", text: "Conditions Removed", status: "Conditions Removed", value: 3 },
    ];
    const split = [
      { type: "Number", text: "Conditions Successfully Removed", value: 2 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    expect(baseToSplit.get(0)).toBe(0);
  });

  test("returns empty maps when no matches", () => {
    const base = [{ type: "Damage", text: "Damage", dmg_multiplier: 1.0 }];
    const split = [{ type: "Buff", text: "Fury", status: "Fury", duration: 5 }];
    const { baseToSplit, splitToBase } = buildMatchTables(base, split);
    expect(baseToSplit.size).toBe(0);
    expect(splitToBase.size).toBe(0);
  });

  test("prevents double-matching", () => {
    const base = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8 },
    ];
    const split = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];
    const { baseToSplit } = buildMatchTables(base, split);
    // Only one base should match
    expect(baseToSplit.size).toBe(1);
    expect(baseToSplit.get(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/match.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/facts/match'`

- [ ] **Step 3: Implement fact matching**

Create `packages/gw2-data/src/facts/match.js`:

```js
"use strict";

const { normalizeFactType } = require("./normalize");

const VALUE_KEYS = [
  "value",
  "distance",
  "duration",
  "apply_count",
  "dmg_multiplier",
  "hit_count",
  "percent",
  "coefficient",
  "finisher_type",
  "field_type",
];

const STOP_WORDS = new Set([
  "the", "and", "per", "for", "with", "from", "based", "gain",
]);

/**
 * Generates a grouping key for positional matching (Pass 2).
 * @param {import('../api/types').Fact} fact
 * @returns {string}
 */
function splitGroupKey(fact) {
  const normType = normalizeFactType(fact.type);
  const qualifier = fact.target || fact.status || "";
  return `${normType}:${qualifier}`;
}

/**
 * Checks if any value key differs between two facts.
 * Ignores hit_count if the base fact doesn't have it
 * (wiki scraper always emits hit_count:1).
 * @param {import('../api/types').Fact} before
 * @param {import('../api/types').Fact} after
 * @returns {boolean}
 */
function valueChanged(before, after) {
  for (const key of VALUE_KEYS) {
    if (key === "hit_count" && before[key] === undefined) continue;
    if (before[key] !== after[key]) return true;
  }
  return false;
}

/**
 * Extracts words >= 3 chars from text, excluding stop words.
 * @param {string} text
 * @returns {Set<string>}
 */
function extractKeywords(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().split(/\s+/);
  return new Set(words.filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
}

/**
 * Three-pass fuzzy fact matching algorithm.
 *
 * Pass 1: Exact text + normalized type match
 * Pass 1.5: Cross-type exact text match
 * Pass 2: Type-group positional match
 * Pass 3: Keyword overlap (3+ char words, scored by count)
 *
 * @param {import('../api/types').Fact[]} baseFacts
 * @param {import('../api/types').Fact[]} splitFacts
 * @returns {{ baseToSplit: Map<number,number>, splitToBase: Map<number,number> }}
 */
function buildMatchTables(baseFacts, splitFacts) {
  const baseToSplit = new Map();
  const splitToBase = new Map();

  const baseMatched = new Set();
  const splitMatched = new Set();

  // Pass 1: Exact text + normalized type
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const sf = splitFacts[si];
    const normSplitType = normalizeFactType(sf.type);

    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const bf = baseFacts[bi];
      if (normalizeFactType(bf.type) === normSplitType && bf.text === sf.text) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        baseMatched.add(bi);
        splitMatched.add(si);
        break;
      }
    }
  }

  // Pass 1.5: Cross-type exact text match
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const sf = splitFacts[si];

    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const bf = baseFacts[bi];
      if (bf.text === sf.text) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        baseMatched.add(bi);
        splitMatched.add(si);
        break;
      }
    }
  }

  // Pass 2: Type-group positional match
  const baseGroups = new Map();
  const splitGroups = new Map();

  for (let bi = 0; bi < baseFacts.length; bi++) {
    if (baseMatched.has(bi)) continue;
    const key = splitGroupKey(baseFacts[bi]);
    if (!baseGroups.has(key)) baseGroups.set(key, []);
    baseGroups.get(key).push(bi);
  }

  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const key = splitGroupKey(splitFacts[si]);
    if (!splitGroups.has(key)) splitGroups.set(key, []);
    splitGroups.get(key).push(si);
  }

  for (const [key, splitIndices] of splitGroups) {
    const baseIndices = baseGroups.get(key);
    if (!baseIndices) continue;
    const pairs = Math.min(baseIndices.length, splitIndices.length);
    for (let i = 0; i < pairs; i++) {
      const bi = baseIndices[i];
      const si = splitIndices[i];
      baseToSplit.set(bi, si);
      splitToBase.set(si, bi);
      baseMatched.add(bi);
      splitMatched.add(si);
    }
  }

  // Pass 3: Keyword overlap
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitMatched.has(si)) continue;
    const splitWords = extractKeywords(splitFacts[si].text);
    if (splitWords.size === 0) continue;

    let bestBi = -1;
    let bestScore = 0;

    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseMatched.has(bi)) continue;
      const baseWords = extractKeywords(baseFacts[bi].text);
      let shared = 0;
      for (const w of splitWords) {
        if (baseWords.has(w)) shared++;
      }
      if (shared > bestScore) {
        bestScore = shared;
        bestBi = bi;
      }
    }

    if (bestBi >= 0 && bestScore >= 1) {
      baseToSplit.set(bestBi, si);
      splitToBase.set(si, bestBi);
      baseMatched.add(bestBi);
      splitMatched.add(si);
    }
  }

  return { baseToSplit, splitToBase };
}

module.exports = {
  buildMatchTables,
  splitGroupKey,
  valueChanged,
  VALUE_KEYS,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/match.test.js --verbose
```

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/facts/match.js packages/gw2-data/tests/match.test.js
git commit -m "feat(gw2-data): add three-pass fuzzy fact matching algorithm"
```

---

## Task 7: Wikitext Template Parser

**Files:**
- Create: `packages/gw2-data/src/wiki/parser.js`
- Create: `packages/gw2-data/tests/parser.test.js`

This extracts the wikitext fact parsing from `lib/gw2-balance-splits/scripts/seed.js`. The parser converts `{{skill fact|...}}` and `{{trait fact|...}}` templates into GW2 API fact format.

- [ ] **Step 1: Write failing tests for core parsing functions**

Create `packages/gw2-data/tests/parser.test.js`:

```js
"use strict";

const {
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,
  splitRespectingTemplates,
} = require("../src/wiki/parser");

describe("splitRespectingTemplates", () => {
  test("splits simple pipe-delimited string", () => {
    expect(splitRespectingTemplates("damage|0.8")).toEqual(["damage", "0.8"]);
  });

  test("preserves nested templates", () => {
    expect(splitRespectingTemplates("healing|{{fraction|7.5}}")).toEqual([
      "healing",
      "{{fraction|7.5}}",
    ]);
  });

  test("handles multiple nested templates", () => {
    const result = splitRespectingTemplates("damage|{{fraction|0.5}}|hits={{fraction|3}}");
    expect(result).toEqual(["damage", "{{fraction|0.5}}", "hits={{fraction|3}}"]);
  });
});

describe("parseSplitGrouping", () => {
  test("pve, wvw, pvp → WvW has its own split", () => {
    const result = parseSplitGrouping("pve, wvw, pvp");
    expect(result).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: false });
  });

  test("pve, wvw pvp → WvW grouped with PvP", () => {
    const result = parseSplitGrouping("pve, wvw pvp");
    expect(result).toEqual({ wvwHasSplit: true, wvwGroupedWithPvp: true });
  });

  test("pve wvw, pvp → WvW grouped with PvE (no actual WvW split)", () => {
    const result = parseSplitGrouping("pve wvw, pvp");
    expect(result).toEqual({ wvwHasSplit: false, wvwGroupedWithPvp: false });
  });
});

describe("mapWikiFactToApiFact", () => {
  test("damage with coefficient", () => {
    const fact = mapWikiFactToApiFact("damage", [], { coefficient: "0.8" }, true, false);
    expect(fact).toEqual({
      type: "Damage",
      text: "Damage",
      dmg_multiplier: 0.8,
      hit_count: 1,
    });
  });

  test("damage with coefficient and hits", () => {
    const fact = mapWikiFactToApiFact(
      "damage",
      [],
      { coefficient: "0.5", hits: "3" },
      true,
      false
    );
    expect(fact).toEqual({
      type: "Damage",
      text: "Damage",
      dmg_multiplier: 0.5,
      hit_count: 3,
    });
  });

  test("recharge with positional value", () => {
    const fact = mapWikiFactToApiFact("recharge", ["25"], {}, true, false);
    expect(fact).toEqual({ type: "Recharge", text: "Recharge", value: 25 });
  });

  test("buff with status, duration, and stacks", () => {
    const fact = mapWikiFactToApiFact(
      "might",
      ["5"],
      { stacks: "3" },
      true,
      false
    );
    expect(fact).toEqual({
      type: "Buff",
      text: "Might",
      status: "Might",
      duration: 5,
      apply_count: 3,
    });
  });

  test("buff defaults to 1 stack", () => {
    const fact = mapWikiFactToApiFact("fury", ["8"], {}, true, false);
    expect(fact).toEqual({
      type: "Buff",
      text: "Fury",
      status: "Fury",
      duration: 8,
      apply_count: 1,
    });
  });

  test("range with valid value", () => {
    const fact = mapWikiFactToApiFact("range", ["900"], {}, true, false);
    expect(fact).toEqual({ type: "Range", text: "Range", value: 900 });
  });

  test("range rejects value <= 1 (boolean flag artifact)", () => {
    const fact = mapWikiFactToApiFact("range", ["1"], {}, true, false);
    expect(fact).toBeNull();
  });

  test("targets with value", () => {
    const fact = mapWikiFactToApiFact("targets", ["5"], {}, true, false);
    expect(fact).toEqual({ type: "Number", text: "Number of Targets", value: 5 });
  });

  test("radius with distance value", () => {
    const fact = mapWikiFactToApiFact("radius", ["240"], {}, true, false);
    expect(fact).toEqual({ type: "Radius", text: "Radius", distance: 240 });
  });

  test("duration with seconds value", () => {
    const fact = mapWikiFactToApiFact("duration", ["5"], {}, true, false);
    expect(fact).toEqual({ type: "Time", text: "Duration", duration: 5 });
  });

  test("healing with base and coefficient", () => {
    const fact = mapWikiFactToApiFact(
      "healing",
      [],
      { base: "352", coefficient: "0.5" },
      true,
      false
    );
    expect(fact).toMatchObject({
      type: "AttributeAdjust",
      target: "Healing",
      value: 352,
      coefficient: 0.5,
    });
  });

  test("conditions removed", () => {
    const fact = mapWikiFactToApiFact("conditions removed", ["2"], {}, true, false);
    expect(fact).toEqual({
      type: "Number",
      text: "Conditions Removed",
      value: 2,
    });
  });

  test("combo finisher", () => {
    const fact = mapWikiFactToApiFact("combo", ["blast"], {}, true, false);
    expect(fact).toEqual({
      type: "ComboFinisher",
      text: "Combo Finisher",
      finisher_type: "Blast",
    });
  });

  test("stun break", () => {
    const fact = mapWikiFactToApiFact("stun break", [], {}, true, false);
    expect(fact).toEqual({ type: "StunBreak", text: "Stun Break", value: true });
  });

  test("percent with value", () => {
    const fact = mapWikiFactToApiFact("percent", ["20"], {}, true, false);
    expect(fact).toEqual({ type: "Percent", text: "Percent", percent: 20 });
  });

  test("attribute gain/conversion", () => {
    const fact = mapWikiFactToApiFact(
      "gain",
      [],
      { source: "Vitality", target: "Power", percent: "13" },
      true,
      false
    );
    expect(fact).toMatchObject({
      type: "BuffConversion",
      source: "Vitality",
      target: "Power",
      percent: 13,
    });
  });

  test("returns null for unknown fact type", () => {
    const fact = mapWikiFactToApiFact("text", [], {}, true, false);
    expect(fact).toBeNull();
  });

  test("returns null for combat-only/misc fact types", () => {
    expect(mapWikiFactToApiFact("combat", [], {}, true, false)).toBeNull();
    expect(mapWikiFactToApiFact("misc", [], {}, true, false)).toBeNull();
    expect(mapWikiFactToApiFact("pierces", [], {}, true, false)).toBeNull();
  });
});

describe("parseInfoboxParams", () => {
  test("extracts recharge wvw param", () => {
    const wikitext = "| recharge wvw = 25\n| recharge = 20";
    const result = parseInfoboxParams(wikitext, false);
    expect(result).toEqual([{ type: "Recharge", text: "Recharge", value: 25 }]);
  });

  test("extracts pvp params when WvW grouped with PvP", () => {
    const wikitext = "| recharge pvp = 30\n| recharge = 20";
    const result = parseInfoboxParams(wikitext, true);
    expect(result).toEqual([{ type: "Recharge", text: "Recharge", value: 30 }]);
  });

  test("returns empty array when no WvW params", () => {
    const wikitext = "| recharge = 20\n| activation = 0.5";
    const result = parseInfoboxParams(wikitext, false);
    expect(result).toEqual([]);
  });
});

describe("parseWikitextFacts", () => {
  test("extracts WvW-specific skill facts", () => {
    const wikitext = [
      "{{skill fact|damage|0.8|game mode=wvw}}",
      "{{skill fact|damage|1.2|game mode=pve}}",
    ].join("\n");
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.8);
  });

  test("extracts universal facts (no game mode)", () => {
    const wikitext = "{{skill fact|recharge|25}}";
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].value).toBe(25);
  });

  test("extracts PvP facts when WvW grouped with PvP", () => {
    const wikitext = "{{skill fact|damage|0.6|game mode=pvp}}";
    const result = parseWikitextFacts(wikitext, true);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.6);
  });

  test("detects PvE-only facts", () => {
    const wikitext = [
      "{{skill fact|damage|1.5|game mode=pve}}",
      "{{skill fact|recharge|20}}",
    ].join("\n");
    const result = parseWikitextFacts(wikitext, false);
    expect(result.hasPveOnly).toBe(true);
  });

  test("handles trait fact templates", () => {
    const wikitext = "{{trait fact|damage|0.5|game mode=wvw}}";
    const result = parseWikitextFacts(wikitext, false);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].dmg_multiplier).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/parser.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/wiki/parser'`

- [ ] **Step 3: Implement wikitext parser**

Create `packages/gw2-data/src/wiki/parser.js`:

```js
"use strict";

const { stripWikiMarkup } = require("../facts/normalize");

// Fact types that are wiki-specific and don't map to API format
const SKIP_TYPES = new Set([
  "text", "pierces", "explosion", "blocks missiles", "reflect", "block",
  "combat", "combat only", "enemy", "ally", "condition effect ignored",
  "condition removed", "breaks enemy targeting", "cannot critical hit",
  "capture", "dismounts", "misc", "blade", "launch", "knockback", "pull",
  "knockdown", "float", "sink", "daze", "stun",
]);

// Standard boons and conditions
const BOONS = new Set([
  "aegis", "alacrity", "fury", "might", "protection", "quickness",
  "regeneration", "resistance", "resolution", "stability", "swiftness", "vigor",
]);

const CONDITIONS = new Set([
  "bleeding", "blind", "burning", "chilled", "confusion", "crippled",
  "fear", "immobilize", "poison", "slow", "taunt", "torment", "vulnerability", "weakness",
]);

/**
 * Splits a string on `|` but respects `{{...}}` nesting depth.
 * @param {string} s
 * @returns {string[]}
 */
function splitRespectingTemplates(s) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      current += "{{";
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}") {
      depth--;
      current += "}}";
      i++;
    } else if (s[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += s[i];
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Capitalizes the first letter of a string.
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Analyzes the `| split = ...` infobox parameter to determine WvW grouping.
 * @param {string} splitField - Raw split field value (e.g. "pve, wvw, pvp")
 * @returns {{ wvwHasSplit: boolean, wvwGroupedWithPvp: boolean }}
 */
function parseSplitGrouping(splitField) {
  const normalized = splitField.toLowerCase().replace(/\s+/g, " ").trim();
  // "pve wvw, pvp" → WvW grouped with PvE (no split)
  // "pve, wvw pvp" → WvW grouped with PvP (use PvP values)
  // "pve, wvw, pvp" → WvW has its own split
  const groups = normalized.split(",").map((g) => g.trim());

  let wvwGroup = -1;
  let pveGroup = -1;
  let pvpGroup = -1;

  for (let i = 0; i < groups.length; i++) {
    const modes = groups[i].split(/\s+/);
    if (modes.includes("wvw")) wvwGroup = i;
    if (modes.includes("pve")) pveGroup = i;
    if (modes.includes("pvp")) pvpGroup = i;
  }

  const wvwHasSplit = wvwGroup !== pveGroup;
  const wvwGroupedWithPvp = wvwGroup === pvpGroup && wvwHasSplit;

  return { wvwHasSplit, wvwGroupedWithPvp };
}

/**
 * Converts a single wiki fact template to GW2 API fact format.
 *
 * @param {string} factType - Fact type from template (e.g., "damage", "might", "range")
 * @param {string[]} positional - Positional parameters after the type
 * @param {Object} params - Named parameters (key=value pairs)
 * @param {boolean} isWvw - Whether this fact is for WvW mode
 * @param {boolean} isUniversal - Whether this fact has no game mode tag
 * @returns {import('../api/types').Fact|null}
 */
function mapWikiFactToApiFact(factType, positional, params, isWvw, isUniversal) {
  const type = factType.toLowerCase().trim();

  if (SKIP_TYPES.has(type)) return null;

  const clean = (v) => stripWikiMarkup(String(v || "")).trim();
  const num = (v) => {
    const n = parseFloat(clean(v));
    return isNaN(n) ? undefined : n;
  };

  switch (type) {
    case "damage": {
      const coeff = num(params.coefficient || positional[0]);
      if (coeff === undefined) return null;
      return {
        type: "Damage",
        text: clean(params.text) || "Damage",
        dmg_multiplier: coeff,
        hit_count: num(params.hits) || 1,
      };
    }

    case "recharge":
    case "cooldown": {
      const val = num(positional[0] || params.recharge);
      if (val === undefined) return null;
      return { type: "Recharge", text: "Recharge", value: val };
    }

    case "recharge time": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      return {
        type: "Recharge",
        text: clean(params.text) || "Recharge",
        value: val,
      };
    }

    case "duration":
    case "alt": {
      const val = num(positional[0] || params.duration);
      if (val === undefined) return null;
      return { type: "Time", text: clean(params.text) || "Duration", duration: val };
    }

    case "range": {
      const val = num(positional[0]);
      if (val === undefined || val <= 1) return null; // reject boolean flag artifact
      return { type: "Range", text: "Range", value: val };
    }

    case "radius":
    case "blast radius":
    case "healing radius":
    case "barrier radius": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      const label = type === "radius" ? "Radius" : capitalize(type);
      return { type: "Radius", text: label, distance: val };
    }

    case "targets": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      return { type: "Number", text: "Number of Targets", value: val };
    }

    case "conditions removed": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      return { type: "Number", text: "Conditions Removed", value: val };
    }

    case "healing": {
      const base = num(params.base || positional[0]);
      const coeff = num(params.coefficient);
      const fact = {
        type: "AttributeAdjust",
        text: clean(params.text) || "Healing",
        target: "Healing",
      };
      if (base !== undefined) fact.value = base;
      if (coeff !== undefined) fact.coefficient = coeff;
      if (fact.value === undefined && fact.coefficient === undefined) return null;
      return fact;
    }

    case "barrier": {
      const base = num(params.base || positional[0]);
      const coeff = num(params.coefficient);
      const fact = {
        type: "AttributeAdjust",
        text: clean(params.text) || "Barrier",
        target: "Healing",
      };
      if (base !== undefined) fact.value = base;
      if (coeff !== undefined) fact.coefficient = coeff;
      if (fact.value === undefined && fact.coefficient === undefined) return null;
      return fact;
    }

    case "defiance break":
    case "defiance bar": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      return { type: "Number", text: "Defiance Break", value: val };
    }

    case "percent":
    case "recharge reduced": {
      const val = num(positional[0]);
      if (val === undefined) return null;
      return { type: "Percent", text: clean(params.text) || "Percent", percent: val };
    }

    case "combo": {
      const subtype = capitalize(clean(positional[0]));
      if (!subtype) return null;
      const finishers = ["Blast", "Whirl", "Projectile", "Leap"];
      if (finishers.includes(subtype)) {
        return { type: "ComboFinisher", text: "Combo Finisher", finisher_type: subtype };
      }
      return { type: "ComboField", text: "Combo Field", field_type: subtype };
    }

    case "stun break":
    case "breaks stun":
    case "breakstun": {
      return { type: "StunBreak", text: "Stun Break", value: true };
    }

    case "unblockable": {
      return { type: "Unblockable", text: "Unblockable", value: true };
    }

    case "effect": {
      const name = clean(positional[0] || params.effect);
      const dur = num(positional[1] || params.duration);
      if (!name) return null;
      const fact = { type: "Buff", text: name, status: name, apply_count: 1 };
      if (dur !== undefined) fact.duration = dur;
      return fact;
    }

    case "gain":
    case "attribute": {
      const source = clean(params.source);
      const target = clean(params.target);
      const pct = num(params.percent);
      if (!source || !target || pct === undefined) return null;
      return {
        type: "BuffConversion",
        text: `${source} → ${target}`,
        source,
        target,
        percent: pct,
      };
    }

    default: {
      // Check for boon/condition names
      if (BOONS.has(type) || CONDITIONS.has(type)) {
        const name = capitalize(type);
        const dur = num(positional[0] || params.duration);
        const stacks = num(params.stacks) || 1;
        const fact = {
          type: "Buff",
          text: name,
          status: name,
          duration: dur,
          apply_count: stacks,
        };
        if (dur === undefined) delete fact.duration;
        return fact;
      }
      return null;
    }
  }
}

/**
 * Extracts game-mode-specific facts from wikitext `{{skill fact|...}}` and
 * `{{trait fact|...}}` templates.
 *
 * @param {string} wikitext
 * @param {boolean} wvwGroupedWithPvp - If true, use PvP-tagged facts for WvW
 * @returns {{ facts: import('../api/types').Fact[], hasPveOnly: boolean }}
 */
function parseWikitextFacts(wikitext, wvwGroupedWithPvp) {
  const pattern = /\{\{(?:skill|trait) fact\|((?:[^{}]|\{\{[^}]*\}\})+)\}\}/gi;
  const facts = [];
  let hasPveOnly = false;
  let match;

  while ((match = pattern.exec(wikitext)) !== null) {
    const parts = splitRespectingTemplates(match[1]);
    const factType = parts[0].trim();
    const positional = [];
    const params = {};

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        const key = part.slice(0, eqIdx).trim().toLowerCase();
        const value = part.slice(eqIdx + 1).trim();
        params[key] = value;
      } else {
        positional.push(part);
      }
    }

    // Determine game mode
    const mode = (params["game mode"] || "").toLowerCase().trim();

    if (mode === "pve") {
      hasPveOnly = true;
      continue; // Skip PvE-only facts
    }

    const isWvw = mode === "wvw";
    const isPvp = mode === "pvp";
    const isUniversal = !mode;

    // Include fact if:
    // - Universal (no mode tag)
    // - WvW-specific
    // - PvP-specific AND WvW is grouped with PvP
    if (!isUniversal && !isWvw && !(isPvp && wvwGroupedWithPvp)) {
      continue;
    }

    const fact = mapWikiFactToApiFact(factType, positional, params, true, isUniversal);
    if (fact) {
      if (isWvw || (isPvp && wvwGroupedWithPvp)) {
        fact._wvwSpecific = true;
      }
      facts.push(fact);
    }
  }

  return { facts, hasPveOnly };
}

/**
 * Fallback parser for simple infobox params like `| recharge wvw = 25`.
 *
 * @param {string} wikitext
 * @param {boolean} wvwGroupedWithPvp
 * @returns {import('../api/types').Fact[]}
 */
function parseInfoboxParams(wikitext, wvwGroupedWithPvp) {
  const suffix = wvwGroupedWithPvp ? "pvp" : "wvw";
  const facts = [];

  const paramMap = {
    recharge: { type: "Recharge", text: "Recharge", field: "value" },
    energy: { type: "Number", text: "Energy Cost", field: "value" },
    initiative: { type: "Number", text: "Initiative", field: "value" },
    upkeep: { type: "Number", text: "Upkeep Cost", field: "value" },
  };

  for (const [param, factDef] of Object.entries(paramMap)) {
    const regex = new RegExp(`\\|\\s*${param}\\s+${suffix}\\s*=\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const match = wikitext.match(regex);
    if (match) {
      facts.push({ type: factDef.type, text: factDef.text, [factDef.field]: parseFloat(match[1]) });
    }
  }

  return facts;
}

module.exports = {
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,
  splitRespectingTemplates,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/parser.test.js --verbose
```

Expected: All tests PASS.

- [ ] **Step 5: Run existing scraper-parsing tests to verify parity**

The axiforge repo has existing parser tests at `tests/unit/scraper-parsing.test.js`. Run them to confirm the original code still works (no regressions from extraction):

```bash
npm test -- --testPathPattern=scraper-parsing --verbose
```

Expected: All existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gw2-data/src/wiki/parser.js packages/gw2-data/tests/parser.test.js
git commit -m "feat(gw2-data): add wikitext template parser for skill/trait facts"
```

---

## Task 8: Wiki Client

**Files:**
- Create: `packages/gw2-data/src/wiki/client.js`
- Create: `packages/gw2-data/tests/wiki-client.test.js`

The wiki client fetches wikitext from the wiki API, parses it into resolved facts, and handles caching + staleness detection.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/wiki-client.test.js`:

```js
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
      // Should have WvW damage (0.8) and universal recharge (25)
      const damageFact = result.facts.find((f) => f.type === "Damage");
      expect(damageFact.dmg_multiplier).toBe(0.8);
      const rechargeFact = result.facts.find((f) => f.type === "Recharge");
      expect(rechargeFact.value).toBe(25);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/wiki-client.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/wiki/client'`

- [ ] **Step 3: Implement WikiClient**

Create `packages/gw2-data/src/wiki/client.js`:

```js
"use strict";

const { MemoryCache } = require("./cache");
const {
  parseSplitGrouping,
  parseWikitextFacts,
  parseInfoboxParams,
} = require("./parser");

const WIKI_API_ROOT = "https://wiki.guildwars2.com/api.php";
const USER_AGENT = "@axi/gw2-data (https://github.com/darkharasho/axiforge)";
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const RATE_LIMIT_MS = 200;

class WikiClient {
  /**
   * @param {Object} [options]
   * @param {import('./cache').CacheAdapter} [options.cache] - Cache adapter (default: MemoryCache)
   * @param {Function} [options.fetch] - Fetch implementation (default: global fetch)
   * @param {string} [options.wikiApiRoot] - Wiki API root URL
   * @param {number} [options.cacheTTL] - Cache TTL in milliseconds
   * @param {boolean} [options.autoRefresh] - Check recentchanges on init
   */
  constructor(options = {}) {
    this._cache = options.cache || new MemoryCache();
    this._fetch = options.fetch || globalThis.fetch;
    this._wikiApiRoot = options.wikiApiRoot || WIKI_API_ROOT;
    this._cacheTTL = options.cacheTTL || DEFAULT_TTL_MS;
    this._lastFetchTimestamp = null;
    this._lastRequestTime = 0;
  }

  /**
   * Rate-limited fetch wrapper.
   * @param {string} url
   * @returns {Promise<Response>}
   */
  async _rateLimitedFetch(url) {
    const now = Date.now();
    const elapsed = now - this._lastRequestTime;
    if (elapsed < RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
    }
    this._lastRequestTime = Date.now();
    return this._fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
  }

  /**
   * Fetches raw wikitext for a page.
   * @param {string} title - Wiki page title
   * @returns {Promise<string|null>} Raw wikitext or null if page missing
   */
  async getWikitext(title) {
    const cacheKey = `wikitext:${title}`;
    const cached = this._cache.get(cacheKey);
    if (cached !== null) return cached;

    const url =
      `${this._wikiApiRoot}?action=query&titles=${encodeURIComponent(title)}` +
      `&prop=revisions&rvprop=content&format=json&formatversion=1`;

    const res = await this._rateLimitedFetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (page.missing) return null;

    const wikitext = page.revisions?.[0]?.["*"] || null;
    if (wikitext) {
      this._cache.set(cacheKey, wikitext, this._cacheTTL);
    }
    return wikitext;
  }

  /**
   * Fetches recently changed page titles from the wiki.
   * @param {string} since - ISO 8601 timestamp
   * @returns {Promise<string[]>} List of changed page titles
   */
  async getRecentChanges(since) {
    const url =
      `${this._wikiApiRoot}?action=query&list=recentchanges` +
      `&rcnamespace=0&rcprop=title|timestamp&rclimit=500` +
      `&rcend=${encodeURIComponent(since)}&format=json`;

    const res = await this._rateLimitedFetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    const changes = data.query?.recentchanges || [];
    return [...new Set(changes.map((c) => c.title))];
  }

  /**
   * Invalidates cached entries for recently changed wiki pages.
   * @returns {Promise<string[]>} List of invalidated page titles
   */
  async refresh() {
    if (!this._lastFetchTimestamp) {
      this._lastFetchTimestamp = new Date().toISOString();
      return [];
    }

    const changed = await this.getRecentChanges(this._lastFetchTimestamp);
    for (const title of changed) {
      this._cache.invalidate(`wikitext:${title}`);
      this._cache.invalidate(`facts:${title}`);
    }
    this._lastFetchTimestamp = new Date().toISOString();
    return changed;
  }

  /**
   * Parses wikitext into WvW facts using the template parser.
   * @param {string} wikitext
   * @returns {{ facts: import('../api/types').Fact[], hasPveOnly: boolean, splitGrouping: Object|null }}
   */
  parseFacts(wikitext) {
    // Determine split grouping from infobox
    const splitMatch = wikitext.match(/\|\s*split\s*=\s*(.+)/i);
    let splitGrouping = null;
    let wvwGroupedWithPvp = false;

    if (splitMatch) {
      splitGrouping = parseSplitGrouping(splitMatch[1].trim());
      wvwGroupedWithPvp = splitGrouping.wvwGroupedWithPvp;
    }

    // Parse {{skill fact}} / {{trait fact}} templates
    let { facts, hasPveOnly } = parseWikitextFacts(wikitext, wvwGroupedWithPvp);

    // Fallback to infobox params if no template facts found
    if (facts.length === 0 && splitGrouping?.wvwHasSplit) {
      facts = parseInfoboxParams(wikitext, wvwGroupedWithPvp);
    }

    return { facts, hasPveOnly, splitGrouping };
  }
}

module.exports = { WikiClient, WIKI_API_ROOT };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/wiki-client.test.js --verbose
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/wiki/client.js packages/gw2-data/tests/wiki-client.test.js
git commit -m "feat(gw2-data): add WikiClient with wikitext fetching, caching, and staleness detection"
```

---

## Task 9: Wiki Relations Graph

**Files:**
- Create: `packages/gw2-data/src/wiki/relations.js`
- Create: `packages/gw2-data/tests/relations.test.js`

Extracts the "Related skills/traits" parsing from `src/main/gw2Data/wiki.js`.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/relations.test.js`:

```js
"use strict";

const { parseRelatedItems, parseRelatedGroups } = require("../src/wiki/relations");

describe("parseRelatedItems", () => {
  test("extracts skill name from list item with link", () => {
    const html = '<li><span class="skill-icon"><a href="/wiki/Fireball" title="Fireball">Fireball</a></span></li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fireball");
  });

  test("extracts context from em-dash separated text", () => {
    const html = '<li><a href="/wiki/Fireball" title="Fireball">Fireball</a> \u2014 deals damage to foes</li>';
    const items = parseRelatedItems(html);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Fireball");
    expect(items[0].context).toBe("deals damage to foes");
  });

  test("returns empty array for empty HTML", () => {
    expect(parseRelatedItems("")).toEqual([]);
  });
});

describe("parseRelatedGroups", () => {
  test("groups traits by h4 headings", () => {
    const html = [
      '<h4>Strength</h4>',
      '<li><a title="Peak Performance">Peak Performance</a> \u2014 +20% strike damage</li>',
      '<h4>Arms</h4>',
      '<li><a title="Rending Strikes">Rending Strikes</a> \u2014 critical hits apply vulnerability</li>',
    ].join("");
    const groups = parseRelatedGroups(html);
    expect(groups).toHaveLength(2);
    expect(groups[0].groupName).toBe("Strength");
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].name).toBe("Peak Performance");
    expect(groups[1].groupName).toBe("Arms");
    expect(groups[1].items).toHaveLength(1);
  });

  test("returns single unnamed group if no headings", () => {
    const html = '<li><a title="Some Trait">Some Trait</a></li>';
    const groups = parseRelatedGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("");
    expect(groups[0].items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/relations.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/wiki/relations'`

- [ ] **Step 3: Implement relations parser**

Create `packages/gw2-data/src/wiki/relations.js`:

```js
"use strict";

/**
 * Parses `<li>` elements from wiki HTML to extract related skill/trait items.
 * Handles patterns: <a title="Name">Name</a> [— context]
 *
 * @param {string} html
 * @returns {{ name: string, icon?: string, context?: string }[]}
 */
function parseRelatedItems(html) {
  if (!html) return [];

  const items = [];
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liPattern.exec(html)) !== null) {
    const content = liMatch[1];

    // Extract name from last title-bearing link
    const linkPattern = /<a[^>]*title="([^"]+)"[^>]*>/g;
    let name = null;
    let linkMatch;
    while ((linkMatch = linkPattern.exec(content)) !== null) {
      name = linkMatch[1];
    }

    if (!name) continue;

    // Extract icon URL if present
    let icon = null;
    const imgMatch = content.match(/src="([^"]+)"/);
    if (imgMatch) {
      icon = imgMatch[1];
      if (icon.startsWith("//")) icon = `https:${icon}`;
    }

    // Extract context from em-dash separator
    let context = null;
    const dashIdx = content.indexOf("\u2014");
    if (dashIdx >= 0) {
      context = content
        .slice(dashIdx + 1)
        .replace(/<[^>]+>/g, "")
        .trim();
    }

    items.push({ name, ...(icon && { icon }), ...(context && { context }) });
  }

  return items;
}

/**
 * Groups related traits by `<h4>` headings (typically specialization names).
 *
 * @param {string} html
 * @returns {{ groupName: string, items: { name: string, icon?: string, context?: string }[] }[]}
 */
function parseRelatedGroups(html) {
  if (!html) return [];

  // Split by h4 headings
  const parts = html.split(/<h4[^>]*>/i);

  if (parts.length <= 1) {
    // No headings — single unnamed group
    const items = parseRelatedItems(html);
    return items.length ? [{ groupName: "", items }] : [];
  }

  const groups = [];

  for (let i = 1; i < parts.length; i++) {
    const headingEnd = parts[i].indexOf("</h4>");
    const groupName =
      headingEnd >= 0
        ? parts[i].slice(0, headingEnd).replace(/<[^>]+>/g, "").trim()
        : "";
    const body = headingEnd >= 0 ? parts[i].slice(headingEnd + 5) : parts[i];
    const items = parseRelatedItems(body);
    if (items.length) {
      groups.push({ groupName, items });
    }
  }

  return groups;
}

module.exports = { parseRelatedItems, parseRelatedGroups };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/relations.test.js --verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/wiki/relations.js packages/gw2-data/tests/relations.test.js
git commit -m "feat(gw2-data): add wiki relations parser for related skills/traits graph"
```

---

## Task 10: Fact Merge Module

**Files:**
- Create: `packages/gw2-data/src/facts/merge.js`
- Create: `packages/gw2-data/tests/merge.test.js`

This extracts the fact merging logic from `catalog.js`'s `applyBalanceSplit` function.

- [ ] **Step 1: Write failing tests**

Create `packages/gw2-data/tests/merge.test.js`:

```js
"use strict";

const { mergeFacts } = require("../src/facts/merge");

describe("mergeFacts", () => {
  test("replaces base fact values with split values (complete mode)", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 20 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 25 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(2);
    expect(result[0].dmg_multiplier).toBe(0.5);
    expect(result[0]._splitFact).toBe(true);
    expect(result[1].value).toBe(25);
    expect(result[1]._splitFact).toBe(true);
  });

  test("preserves base fact labels when merging split values", () => {
    const baseFacts = [
      { type: "Damage", text: "Base Damage Label", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Wiki Damage Label", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result[0].text).toBe("Base Damage Label");
    expect(result[0].dmg_multiplier).toBe(0.5);
  });

  test("drops unmatched base facts in complete mode", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("Damage");
  });

  test("keeps unmatched base facts in partial mode", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
      { type: "Buff", text: "Might", status: "Might", duration: 5 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: false });
    expect(result).toHaveLength(2);
    expect(result[0].dmg_multiplier).toBe(0.5);
    expect(result[0]._splitFact).toBe(true);
    expect(result[1].status).toBe("Might");
    expect(result[1]._splitFact).toBeUndefined();
  });

  test("adds unmatched split facts as new facts", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 3 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    expect(result).toHaveLength(2);
    const newFact = result.find((f) => f.status === "Fury");
    expect(newFact._newFact).toBe(true);
  });

  test("marks facts with changed values as split facts", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];
    const splitFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];

    const result = mergeFacts(baseFacts, splitFacts, { complete: true });
    // Same value — should NOT be marked as split
    expect(result[0]._splitFact).toBeUndefined();
  });

  test("returns base facts unchanged when split facts is empty", () => {
    const baseFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0 },
    ];

    const result = mergeFacts(baseFacts, [], { complete: false });
    expect(result).toEqual(baseFacts);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/gw2-data && npx jest tests/merge.test.js --verbose
```

Expected: FAIL — `Cannot find module '../src/facts/merge'`

- [ ] **Step 3: Implement fact merging**

Create `packages/gw2-data/src/facts/merge.js`:

```js
"use strict";

const { buildMatchTables, valueChanged, VALUE_KEYS } = require("./match");

/**
 * Merges base facts (from GW2 API) with split facts (from wiki) to produce
 * resolved facts for a specific game mode.
 *
 * Rules:
 * - Wiki is authoritative for values (numbers, durations, coefficients)
 * - API is authoritative for structure (labels, types, ordering, icons)
 * - complete=true: split is the full fact set; unmatched base facts are dropped
 * - complete=false: split only lists changed facts; unmatched base facts are kept
 *
 * @param {import('../api/types').Fact[]} baseFacts - Facts from GW2 API
 * @param {import('../api/types').Fact[]} splitFacts - Facts from wiki for this game mode
 * @param {Object} options
 * @param {boolean} options.complete - Whether the split is a complete fact set
 * @returns {import('../api/types').Fact[]}
 */
function mergeFacts(baseFacts, splitFacts, { complete = false } = {}) {
  if (!splitFacts || splitFacts.length === 0) {
    return baseFacts;
  }

  const { baseToSplit, splitToBase } = buildMatchTables(baseFacts, splitFacts);
  const result = [];

  // Process base facts
  for (let bi = 0; bi < baseFacts.length; bi++) {
    const si = baseToSplit.get(bi);

    if (si !== undefined) {
      // Matched — merge split values into base structure
      const merged = { ...baseFacts[bi] };

      // Copy value fields from split, keep base labels/structure
      const splitFact = splitFacts[si];
      let changed = false;

      for (const key of VALUE_KEYS) {
        if (splitFact[key] !== undefined) {
          if (merged[key] !== splitFact[key]) {
            changed = true;
          }
          merged[key] = splitFact[key];
        }
      }

      if (changed) {
        merged._splitFact = true;
      }
      result.push(merged);
    } else if (!complete) {
      // Unmatched in partial mode — keep base fact as-is
      result.push({ ...baseFacts[bi] });
    }
    // In complete mode, unmatched base facts are dropped
  }

  // Add unmatched split facts as new entries
  for (let si = 0; si < splitFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.push({ ...splitFacts[si], _newFact: true });
    }
  }

  return result;
}

module.exports = { mergeFacts };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/gw2-data && npx jest tests/merge.test.js --verbose
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/facts/merge.js packages/gw2-data/tests/merge.test.js
git commit -m "feat(gw2-data): add fact merge module combining API skeleton with wiki values"
```

---

## Task 11: Wire Up Package Exports

**Files:**
- Modify: `packages/gw2-data/src/index.js`

- [ ] **Step 1: Update the root index to export all public API**

Update `packages/gw2-data/src/index.js`:

```js
"use strict";

const { WikiClient, WIKI_API_ROOT } = require("./wiki/client");
const { MemoryCache, DiskCache } = require("./wiki/cache");
const { Gw2ApiClient, GW2_API_ROOT } = require("./api/client");
const {
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,
} = require("./wiki/parser");
const { parseRelatedItems, parseRelatedGroups } = require("./wiki/relations");
const { mergeFacts } = require("./facts/merge");
const { buildMatchTables, valueChanged, VALUE_KEYS } = require("./facts/match");
const { normalizeFactType, stripGw2Markup, stripWikiMarkup } = require("./facts/normalize");

module.exports = {
  // Wiki layer
  WikiClient,
  WIKI_API_ROOT,

  // GW2 API layer
  Gw2ApiClient,
  GW2_API_ROOT,

  // Cache
  MemoryCache,
  DiskCache,

  // Parser
  parseSplitGrouping,
  parseWikitextFacts,
  mapWikiFactToApiFact,
  parseInfoboxParams,

  // Relations
  parseRelatedItems,
  parseRelatedGroups,

  // Facts
  mergeFacts,
  buildMatchTables,
  valueChanged,
  VALUE_KEYS,
  normalizeFactType,
  stripGw2Markup,
  stripWikiMarkup,
};
```

- [ ] **Step 2: Verify the package loads correctly**

```bash
node -e "const gw2 = require('./packages/gw2-data'); console.log(Object.keys(gw2).join(', '))"
```

Expected: Prints all exported names without errors.

- [ ] **Step 3: Verify workspace resolution from axiforge root**

```bash
node -e "const gw2 = require('@axi/gw2-data'); console.log('WikiClient:', typeof gw2.WikiClient)"
```

Expected: `WikiClient: function`

- [ ] **Step 4: Run all package tests**

```bash
cd packages/gw2-data && npx jest --verbose
```

Expected: All tests across all test files PASS.

- [ ] **Step 5: Run root axiforge tests to confirm no regressions**

```bash
npm test
```

Expected: All existing axiforge tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/gw2-data/src/index.js
git commit -m "feat(gw2-data): wire up package exports for wiki, api, facts, and cache modules"
```

---

## Task 12: Integration Test — End-to-End Fact Resolution

**Files:**
- Create: `packages/gw2-data/tests/integration.test.js`

This test validates the full pipeline: wikitext → parse → match → merge, using realistic GW2 data fixtures.

- [ ] **Step 1: Write integration test**

Create `packages/gw2-data/tests/integration.test.js`:

```js
"use strict";

const { WikiClient } = require("../src/wiki/client");
const { mergeFacts } = require("../src/facts/merge");
const { MemoryCache } = require("../src/wiki/cache");

describe("End-to-end fact resolution", () => {
  test("resolves WvW facts for a skill with balance split", () => {
    // Simulate: Fireball has different damage in WvW
    const wikitext = [
      "{{skill infobox",
      "| id = 5489",
      "| name = Fireball",
      "| split = pve, wvw, pvp",
      "}}",
      "{{skill fact|damage|1.2|game mode=pve}}",
      "{{skill fact|damage|0.8|game mode=wvw}}",
      "{{skill fact|recharge|10}}",
      "{{skill fact|burning|3|stacks=2|game mode=wvw}}",
    ].join("\n");

    // API base facts (PvE values)
    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.2, hit_count: 1 },
      { type: "Recharge", text: "Recharge", value: 10 },
    ];

    // Parse wiki facts
    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping.wvwHasSplit).toBe(true);

    // Merge API + wiki
    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });

    // Damage should use WvW value
    const damageFact = resolved.find((f) => f.type === "Damage");
    expect(damageFact.dmg_multiplier).toBe(0.8);
    expect(damageFact._splitFact).toBe(true);
    expect(damageFact.text).toBe("Damage"); // Preserves API label

    // Recharge should be unchanged (universal fact)
    const rechargeFact = resolved.find((f) => f.type === "Recharge");
    expect(rechargeFact.value).toBe(10);

    // Burning is a new WvW-only fact
    const burnFact = resolved.find((f) => f.status === "Burning");
    expect(burnFact).toBeTruthy();
    expect(burnFact._newFact).toBe(true);
    expect(burnFact.duration).toBe(3);
    expect(burnFact.apply_count).toBe(2);
  });

  test("resolves facts for skill with WvW grouped with PvP", () => {
    const wikitext = [
      "{{skill infobox",
      "| split = pve, wvw pvp",
      "}}",
      "{{skill fact|damage|0.6|game mode=pvp}}",
      "{{skill fact|damage|1.0|game mode=pve}}",
    ].join("\n");

    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.0, hit_count: 1 },
    ];

    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping.wvwGroupedWithPvp).toBe(true);

    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });
    const damageFact = resolved.find((f) => f.type === "Damage");
    expect(damageFact.dmg_multiplier).toBe(0.6); // Uses PvP value for WvW
  });

  test("handles skill with no balance split (PvE only)", () => {
    const wikitext = [
      "{{skill infobox",
      "| id = 9999",
      "}}",
      "{{skill fact|damage|1.5}}",
    ].join("\n");

    const apiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 1.5, hit_count: 1 },
    ];

    const client = new WikiClient({ cache: new MemoryCache() });
    const parsed = client.parseFacts(wikitext);

    expect(parsed.splitGrouping).toBeNull();

    // No split — merge with universal facts
    const resolved = mergeFacts(apiFacts, parsed.facts, { complete: false });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].dmg_multiplier).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd packages/gw2-data && npx jest tests/integration.test.js --verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 3: Run the full package test suite**

```bash
cd packages/gw2-data && npx jest --verbose
```

Expected: All tests across all files PASS.

- [ ] **Step 4: Run root tests to confirm no regressions**

```bash
npm test
```

Expected: All axiforge tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/tests/integration.test.js
git commit -m "test(gw2-data): add end-to-end integration test for fact resolution pipeline"
```

---

## Summary

After completing all 12 tasks, the `@axi/gw2-data` package will have:

- **Monorepo workspace** set up with npm workspaces
- **Pluggable cache** (memory + disk) with a clean adapter interface
- **GW2 API client** with request queue, retry, and caching
- **Wikitext parser** that handles 30+ fact types, game mode splits, template nesting
- **Wiki client** with fetching, caching, and staleness detection via recentchanges
- **Relations parser** for building the trait/skill interaction graph
- **Fact matching** with the three-pass fuzzy algorithm
- **Fact merging** that combines API structure with wiki values
- **Full test suite** with unit and integration tests
- **Clean public API** consumable via `require('@axi/gw2-data')`

**Next plans:**
- **Phase 2:** Stat computation engine (modifiers, attributes, tooltips, combos, boons)
- **Phase 3:** Axiforge migration (swap existing modules to consume the package)
