# Wiki Caching Performance Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate redundant wiki API requests and catalog rebuilds by adding in-memory catalog caching and negative caching for missing wiki pages.

**Architecture:** Two-layer fix: (1) WikiClient caches "page missing" results so truly absent pages don't re-hit the network on subsequent calls, (2) getProfessionCatalog stores results in an in-memory Map so repeated calls return instantly. Follows the existing `_upgradeCatalogCache` pattern already in catalog.js.

**Tech Stack:** Node.js, Jest (existing test infrastructure)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/gw2-data/src/wiki/client.js` | Modify | Add negative caching for missing wiki pages |
| `packages/gw2-data/tests/wiki-client.test.js` | Modify | Test negative caching behavior |
| `src/main/gw2Data/catalog.js` | Modify | Add in-memory catalog cache + clearCatalogCache export |
| `src/main/gw2Data/index.js` | Modify | Re-export clearCatalogCache |
| `tests/unit/gw2Data.test.js` | Modify | Test catalog cache hit/miss behavior |

---

### Task 1: Negative Caching in WikiClient

**Files:**
- Modify: `packages/gw2-data/src/wiki/client.js:37-61` (getWikitext) and `71-148` (getWikitextBatch)
- Test: `packages/gw2-data/tests/wiki-client.test.js`

- [ ] **Step 1: Write failing test — getWikitext caches missing pages**

Add this test inside the existing `describe("getWikitext")` block (the second one, around line 222):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/wiki-client.test.js --testNamePattern "caches missing pages" -v`

Expected: FAIL — second call hits the network (mockFetch called twice).

- [ ] **Step 3: Write failing test — getWikitextBatch caches missing pages**

Add this test inside `describe("getWikitextBatch")`:

```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/wiki-client.test.js --testNamePattern "caches missing pages so subsequent batch" -v`

Expected: FAIL — "Missing Skill" appears in second fetch because null wasn't cached.

- [ ] **Step 5: Implement negative caching**

In `packages/gw2-data/src/wiki/client.js`, add a sentinel constant at the top (after line 12):

```js
const MISSING_SENTINEL = "__WIKI_MISSING__";
```

Modify `getWikitext()` (lines 37-61) — after `if (cached !== null) return cached;` add sentinel check, and cache missing pages:

```js
async getWikitext(title) {
  const cacheKey = `wikitext:${title}`;
  const cached = await this._cache.get(cacheKey);
  if (cached === MISSING_SENTINEL) return null;
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
  if (page.missing) {
    await this._cache.set(cacheKey, MISSING_SENTINEL, this._cacheTTL);
    return null;
  }

  const wikitext = page.revisions?.[0]?.["*"] || null;
  if (wikitext) {
    await this._cache.set(cacheKey, wikitext, this._cacheTTL);
  }
  return wikitext;
}
```

Modify `getWikitextBatch()` — in the cache-check loop (lines 76-84), handle sentinel:

```js
// Check cache first, collect uncached titles
const uncached = [];
for (const title of titles) {
  const cacheKey = `wikitext:${title}`;
  const cached = await this._cache.get(cacheKey);
  if (cached === MISSING_SENTINEL) {
    result.set(title, null);
  } else if (cached !== null) {
    result.set(title, cached);
  } else {
    uncached.push(title);
  }
}
```

And in the response processing loop (around line 139), cache null results:

```js
result.set(title, wikitext);
const cacheKey = `wikitext:${title}`;
if (wikitext !== null) {
  await this._cache.set(cacheKey, wikitext, this._cacheTTL);
} else {
  await this._cache.set(cacheKey, MISSING_SENTINEL, this._cacheTTL);
}
```

- [ ] **Step 6: Run all wiki-client tests**

Run: `npx jest packages/gw2-data/tests/wiki-client.test.js -v`

Expected: ALL PASS

- [ ] **Step 7: Run full gw2-data test suite**

Run: `npx jest packages/gw2-data/tests/ -v`

Expected: ALL PASS (no regressions in resolver, parser, etc.)

- [ ] **Step 8: Commit**

```bash
git add packages/gw2-data/src/wiki/client.js packages/gw2-data/tests/wiki-client.test.js
git commit -m "perf: cache missing wiki pages to avoid redundant network requests"
```

---

### Task 2: In-Memory Catalog Cache

**Files:**
- Modify: `src/main/gw2Data/catalog.js:109` (getProfessionCatalog) and `:882` (exports)
- Modify: `src/main/gw2Data/index.js`
- Test: `tests/unit/gw2Data.test.js`

- [ ] **Step 1: Write failing test — catalog returns cached result on second call**

Add this test at the end of the existing `describe("getProfessionCatalog")` block in `tests/unit/gw2Data.test.js`:

```js
describe("catalog caching", () => {
  beforeEach(() => {
    freshLoad();
    global.fetch = createGw2MockFetch();
  });
  afterEach(() => { delete global.fetch; });

  test("returns cached catalog on second call for same profession", async () => {
    const catalog1 = await gw2Data.getProfessionCatalog("Warrior", "en");
    const catalog2 = await gw2Data.getProfessionCatalog("Warrior", "en");
    expect(catalog1).toBe(catalog2); // same object reference
  });

  test("returns different catalogs for different professions", async () => {
    const warrior = await gw2Data.getProfessionCatalog("Warrior", "en");
    const necro = await gw2Data.getProfessionCatalog("Necromancer", "en");
    expect(warrior).not.toBe(necro);
    expect(warrior.profession.id).toBe("Warrior");
    expect(necro.profession.id).toBe("Necromancer");
  });

  test("clearCatalogCache forces rebuild on next call", async () => {
    const catalog1 = await gw2Data.getProfessionCatalog("Warrior", "en");
    gw2Data.clearCatalogCache();
    const catalog2 = await gw2Data.getProfessionCatalog("Warrior", "en");
    expect(catalog1).not.toBe(catalog2); // different object after cache clear
    expect(catalog2.profession.id).toBe("Warrior"); // still correct data
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gw2Data.test.js --testNamePattern "catalog caching" -v`

Expected: FAIL — `clearCatalogCache` is not a function, and `catalog1 !== catalog2` (not same reference) for the first test.

- [ ] **Step 3: Implement catalog cache**

In `src/main/gw2Data/catalog.js`, add after `let _wikiClient = null;` (line 25):

```js
const _catalogCache = new Map();
```

Add the cache clear function after `getWikiClient()`:

```js
function clearCatalogCache() {
  _catalogCache.clear();
}
```

At the top of `getProfessionCatalog()` (after the professionId check, around line 113), add cache lookup:

```js
const cacheKey = `${professionId}:${lang}`;
if (_catalogCache.has(cacheKey)) return _catalogCache.get(cacheKey);
```

At the bottom, just before `return { profession: ...` (line 754), wrap the return value:

```js
const catalog = {
  profession: { ... },
  // ... existing return object fields ...
};

_catalogCache.set(cacheKey, catalog);
return catalog;
```

(Assign the existing return object to `catalog`, cache it, then return it.)

Update the exports at line 882:

```js
module.exports = {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  _setStaticData,
  initWikiClient,
  getWikiClient,
  clearCatalogCache,
};
```

- [ ] **Step 4: Re-export clearCatalogCache from index.js**

In `src/main/gw2Data/index.js`, add `clearCatalogCache` to the require and module.exports:

```js
const { getProfessionList, getProfessionCatalog, getUpgradeCatalog, _setStaticData, initWikiClient, clearCatalogCache } = require("./catalog");

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
  clearCatalogCache,
};
```

- [ ] **Step 5: Run catalog caching tests**

Run: `npx jest tests/unit/gw2Data.test.js --testNamePattern "catalog caching" -v`

Expected: ALL PASS

- [ ] **Step 6: Run full test suite**

Run: `npx jest tests/unit/gw2Data.test.js -v`

Expected: ALL PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/main/gw2Data/catalog.js src/main/gw2Data/index.js tests/unit/gw2Data.test.js
git commit -m "perf: add in-memory catalog cache to avoid redundant wiki resolution"
```

---

### Task 3: Dedup Concurrent Catalog Requests

**Files:**
- Modify: `src/main/gw2Data/catalog.js`
- Test: `tests/unit/gw2Data.test.js`

The existing `getUpgradeCatalog` uses a `_upgradeCatalogPromise` guard to deduplicate concurrent in-flight requests. `getProfessionCatalog` needs the same pattern to prevent multiple simultaneous callers from triggering parallel rebuilds for the same profession.

- [ ] **Step 1: Write failing test — concurrent calls deduplicate**

Add to the `describe("catalog caching")` block:

```js
test("concurrent calls for same profession share a single build", async () => {
  const [cat1, cat2, cat3] = await Promise.all([
    gw2Data.getProfessionCatalog("Warrior", "en"),
    gw2Data.getProfessionCatalog("Warrior", "en"),
    gw2Data.getProfessionCatalog("Warrior", "en"),
  ]);
  expect(cat1).toBe(cat2);
  expect(cat2).toBe(cat3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gw2Data.test.js --testNamePattern "concurrent calls" -v`

Expected: May PASS if cache set happens before concurrent calls resolve, or FAIL if race condition causes multiple builds. Either way, the in-flight guard is needed for correctness.

- [ ] **Step 3: Implement in-flight promise dedup**

In `src/main/gw2Data/catalog.js`, add after the `_catalogCache` declaration:

```js
const _catalogInflight = new Map();
```

Update the top of `getProfessionCatalog()`:

```js
const cacheKey = `${professionId}:${lang}`;
if (_catalogCache.has(cacheKey)) return _catalogCache.get(cacheKey);
if (_catalogInflight.has(cacheKey)) return _catalogInflight.get(cacheKey);

const promise = _buildProfessionCatalog(professionId, lang);
_catalogInflight.set(cacheKey, promise);

try {
  const catalog = await promise;
  _catalogCache.set(cacheKey, catalog);
  return catalog;
} finally {
  _catalogInflight.delete(cacheKey);
}
```

Rename the existing `getProfessionCatalog` body to `_buildProfessionCatalog` (keeping all existing logic), and make the new `getProfessionCatalog` the cache/dedup wrapper.

Also update `clearCatalogCache`:

```js
function clearCatalogCache() {
  _catalogCache.clear();
}
```

- [ ] **Step 4: Run all gw2Data tests**

Run: `npx jest tests/unit/gw2Data.test.js -v`

Expected: ALL PASS

- [ ] **Step 5: Run integration tests to check for regressions**

Run: `npx jest tests/integration/ -v`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/gw2Data/catalog.js tests/unit/gw2Data.test.js
git commit -m "perf: deduplicate concurrent catalog requests with in-flight promise guard"
```
