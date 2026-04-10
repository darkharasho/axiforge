# Wiki Resolver Name Collision Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when the wiki resolver fetches the wrong page (name collision) and retry with profession-specific suffixes to find the actual skill/trait page.

**Architecture:** Add an `extractInfoboxId()` helper to extract the `| id = ` value from `{{Skill infobox` or `{{Trait infobox` templates. In `resolveEntityFacts()`, after the initial batch fetch, validate each page's infobox ID against the expected entity ID. Pages that don't match get queued for suffix retries (`"Name (profession skill)"`, then `"Name (skill)"`), batch-fetched and validated again.

**Tech Stack:** Node.js, Jest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/gw2-data/src/wiki/resolver.js` | Modify | Add `extractInfoboxId()` helper + suffix retry logic in `resolveEntityFacts()` |
| `packages/gw2-data/tests/resolver.test.js` | Modify | Tests for infobox ID extraction and name collision retries |

---

### Task 1: Add `extractInfoboxId()` Helper

**Files:**
- Modify: `packages/gw2-data/src/wiki/resolver.js`
- Test: `packages/gw2-data/tests/resolver.test.js`

- [ ] **Step 1: Write failing tests for extractInfoboxId**

Add a new `describe("extractInfoboxId")` block at the end of `packages/gw2-data/tests/resolver.test.js`. First, add `extractInfoboxId` to the require at the top (line 7):

```js
const {
  groupFactsByMode,
  parseFactsByMode,
  resolveEntityFacts,
  isDisambiguation,
  extractInfoboxId,
} = require("../src/wiki/resolver");
```

Then add the test block:

```js
describe("extractInfoboxId", () => {
  test("extracts single ID from skill infobox", () => {
    const wikitext = "{{Skill infobox\n| id = 5489\n| description = Launch a ball of fire.\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([5489]);
  });

  test("extracts multi-ID from skill infobox", () => {
    const wikitext = "{{Skill infobox\n| id = 5805,6020\n| description = Equip a kit.\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([5805, 6020]);
  });

  test("extracts ID from trait infobox", () => {
    const wikitext = "{{Trait infobox\n| line = Spite\n| id = 903\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([903]);
  });

  test("returns empty array for location infobox", () => {
    const wikitext = "{{Location infobox\n| name = Ring of Fire\n| id = 20\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([]);
  });

  test("returns empty array for weapon infobox", () => {
    const wikitext = "{{Weapon infobox\n| type = Sword\n| id = 29181\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([]);
  });

  test("returns empty array for page with no infobox", () => {
    const wikitext = "'''Some Page''' is about something.";
    expect(extractInfoboxId(wikitext)).toEqual([]);
  });

  test("handles whitespace variations", () => {
    const wikitext = "{{Skill infobox\n|id=5489\n}}";
    expect(extractInfoboxId(wikitext)).toEqual([5489]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest packages/gw2-data/tests/resolver.test.js --testNamePattern "extractInfoboxId" -v`

Expected: FAIL — `extractInfoboxId` is not exported.

- [ ] **Step 3: Implement extractInfoboxId**

Add this function to `packages/gw2-data/src/wiki/resolver.js`, before `resolveEntityFacts`:

```js
/**
 * Extract the GW2 API ID(s) from a {{Skill infobox}} or {{Trait infobox}} template.
 * Returns an array of numeric IDs, or empty array if no matching infobox found.
 *
 * @param {string} wikitext
 * @returns {number[]}
 */
function extractInfoboxId(wikitext) {
  // Match only Skill or Trait infoboxes (not Location, Weapon, NPC, etc.)
  const infoboxMatch = wikitext.match(/\{\{(?:Skill|Trait) infobox\b/i);
  if (!infoboxMatch) return [];

  // Find the | id = ... line within the infobox
  const idMatch = wikitext.match(/\|\s*id\s*=\s*([0-9,\s]+)/);
  if (!idMatch) return [];

  return idMatch[1]
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}
```

Add `extractInfoboxId` to the `module.exports` at the bottom of the file:

```js
module.exports = { groupFactsByMode, parseFactsByMode, resolveEntityFacts, isDisambiguation, extractInfoboxId };
```

- [ ] **Step 4: Run extractInfoboxId tests**

Run: `npx jest packages/gw2-data/tests/resolver.test.js --testNamePattern "extractInfoboxId" -v`

Expected: ALL PASS

- [ ] **Step 5: Run full resolver tests for regressions**

Run: `npx jest packages/gw2-data/tests/resolver.test.js -v`

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gw2-data/src/wiki/resolver.js packages/gw2-data/tests/resolver.test.js
git commit -m "feat: add extractInfoboxId helper to detect skill/trait infoboxes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add Name Collision Retry Logic to resolveEntityFacts

**Files:**
- Modify: `packages/gw2-data/src/wiki/resolver.js:120-188` (resolveEntityFacts)
- Test: `packages/gw2-data/tests/resolver.test.js`

- [ ] **Step 1: Write failing test — retries when page has wrong infobox (location page)**

Add this test inside the existing `describe("resolveEntityFacts")` block in `packages/gw2-data/tests/resolver.test.js`:

```js
test("retries with profession suffix when page has wrong infobox type", async () => {
  // "Ring of Fire" resolves to a location page, not the elementalist skill
  const locationWikitext = "{{Location infobox\n| name = Ring of Fire\n| id = 20\n}}";
  const skillWikitext = "{{Skill infobox\n| id = 5765\n}}\n{{skill fact|damage|1.0}}";

  // First fetch: returns location page
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "1": { title: "Ring of Fire", revisions: [{ "*": locationWikitext }] },
        },
      },
    }),
  });

  // Second fetch: retry with "Ring of Fire (elementalist skill)"
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "2": { title: "Ring of Fire (elementalist skill)", revisions: [{ "*": skillWikitext }] },
        },
      },
    }),
  });

  const titleToId = new Map([["Ring of Fire", 5765]]);
  const result = await resolveEntityFacts(client, titleToId, { profession: "Elementalist" });

  expect(result.size).toBe(1);
  expect(result.has(5765)).toBe(true);
  expect(result.get(5765).pve[0].type).toBe("Damage");
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(mockFetch.mock.calls[1][0]).toContain("Ring%20of%20Fire%20(elementalist%20skill)");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/resolver.test.js --testNamePattern "retries with profession suffix when page has wrong infobox" -v`

Expected: FAIL — resolver accepts the location page (no retry logic yet).

- [ ] **Step 3: Write failing test — retries with generic "(skill)" suffix as fallback**

```js
test("falls back to generic (skill) suffix when profession suffix fails", async () => {
  // "Zap" resolves to a weapon page
  const weaponWikitext = "{{Weapon infobox\n| type = Sword\n| id = 29181\n}}";
  const skillWikitext = "{{Skill infobox\n| id = 63281\n}}\n{{skill fact|damage|0.5}}";

  // First fetch: weapon page
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "1": { title: "Zap", revisions: [{ "*": weaponWikitext }] },
        },
      },
    }),
  });

  // Second fetch: "Zap (elementalist skill)" — missing
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "-1": { title: "Zap (elementalist skill)", missing: true },
        },
      },
    }),
  });

  // Third fetch: "Zap (skill)" — found
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "3": { title: "Zap (skill)", revisions: [{ "*": skillWikitext }] },
        },
      },
    }),
  });

  const titleToId = new Map([["Zap", 63281]]);
  const result = await resolveEntityFacts(client, titleToId, { profession: "Elementalist" });

  expect(result.size).toBe(1);
  expect(result.has(63281)).toBe(true);
  expect(result.get(63281).pve[0].type).toBe("Damage");
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 4: Write failing test — accepts page when infobox ID matches**

```js
test("accepts page directly when infobox ID matches expected entity", async () => {
  const skillWikitext = "{{Skill infobox\n| id = 5489\n}}\n{{skill fact|damage|0.8}}";

  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "1": { title: "Fireball", revisions: [{ "*": skillWikitext }] },
        },
      },
    }),
  });

  const titleToId = new Map([["Fireball", 5489]]);
  const result = await resolveEntityFacts(client, titleToId, { profession: "Elementalist" });

  expect(result.size).toBe(1);
  expect(result.has(5489)).toBe(true);
  // Should NOT have made a retry call
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Write failing test — both suffixes fail, falls back gracefully**

```js
test("falls back to API facts when all suffix retries fail", async () => {
  const locationWikitext = "{{Location infobox\n| name = Some Place\n| id = 99\n}}";

  // First fetch: wrong page
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: {
          "1": { title: "Some Place", revisions: [{ "*": locationWikitext }] },
        },
      },
    }),
  });

  // Second fetch: profession suffix — missing
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: { "-1": { title: "Some Place (warrior skill)", missing: true } },
      },
    }),
  });

  // Third fetch: generic suffix — missing
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: {
        pages: { "-1": { title: "Some Place (skill)", missing: true } },
      },
    }),
  });

  const titleToId = new Map([["Some Place", 12345]]);
  const result = await resolveEntityFacts(client, titleToId, { profession: "Warrior" });

  expect(result.size).toBe(0); // no wiki facts — API facts preserved
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 6: Run all new tests to verify they fail**

Run: `npx jest packages/gw2-data/tests/resolver.test.js --testNamePattern "retries with profession suffix when|falls back to generic|accepts page directly when infobox|falls back to API facts when all" -v`

Expected: FAIL for the retry tests (no retry logic yet). The "accepts page directly" test may pass since the existing code already processes matching pages.

- [ ] **Step 7: Implement name collision retry logic**

Replace the `resolveEntityFacts` function in `packages/gw2-data/src/wiki/resolver.js` with this updated version. The key changes are:
1. After fetching, check disambig (existing), then check infobox ID match (new)
2. Non-matching pages are queued for suffix retries
3. Suffix retries happen in two rounds: profession-specific first, then generic

```js
async function resolveEntityFacts(client, titleToId, options = {}) {
  const result = new Map();

  if (titleToId.size === 0) return result;

  const titles = [...titleToId.keys()];
  const wikitextMap = await client.getWikitextBatch(titles);

  // Collect pages that need retries
  const disambigRetries = new Map(); // alternative title → original title
  const nameCollisionRetries = new Map(); // original title → entity id (for suffix retry)
  const profession = options.profession ? options.profession.toLowerCase() : null;

  for (const [title, id] of titleToId) {
    const wikitext = wikitextMap.get(title);
    if (!wikitext) continue; // skip missing pages

    // If this is a disambiguation page, queue a retry with profession-specific suffix
    if (isDisambiguation(wikitext)) {
      if (profession) {
        disambigRetries.set(`${title} (${profession} skill)`, title);
      }
      continue;
    }

    // Check if this page's infobox ID matches the expected entity
    const infoboxIds = extractInfoboxId(wikitext);
    if (infoboxIds.length > 0 && infoboxIds.includes(id)) {
      // Correct page — parse facts
      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

      result.set(id, {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      });
      continue;
    }

    // If no matching infobox, check if the page has a Skill/Trait infobox at all
    // (could be same skill type but different entity, or no infobox = wrong page type)
    if (infoboxIds.length === 0) {
      // Wrong page type (location, weapon, NPC, etc.) — queue for suffix retry
      nameCollisionRetries.set(title, id);
      continue;
    }

    // Has a Skill/Trait infobox but wrong ID — also retry with suffix
    nameCollisionRetries.set(title, id);
  }

  // Retry disambiguation pages with profession-specific titles (existing logic)
  if (disambigRetries.size > 0) {
    const retryTitles = [...disambigRetries.keys()];
    const retryMap = await client.getWikitextBatch(retryTitles);

    for (const [retryTitle, originalTitle] of disambigRetries) {
      const wikitext = retryMap.get(retryTitle);
      if (!wikitext) continue;

      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

      const id = titleToId.get(originalTitle);
      result.set(id, {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      });
    }
  }

  // Retry name collisions with suffix variants
  if (nameCollisionRetries.size > 0 && profession) {
    const stillMissing = new Map(nameCollisionRetries); // title → id

    // Round 1: try "Name (profession skill)"
    const round1Titles = [...stillMissing.keys()].map((t) => `${t} (${profession} skill)`);
    const round1Map = await client.getWikitextBatch(round1Titles);

    for (const [title, id] of [...stillMissing]) {
      const retryTitle = `${title} (${profession} skill)`;
      const wikitext = round1Map.get(retryTitle);
      if (!wikitext) continue;

      const parsed = parseFactsByMode(wikitext);
      const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
      if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

      result.set(id, {
        pve: parsed.pve,
        wvw: parsed.hasSplit ? parsed.wvw : null,
        pvp: parsed.hasSplit ? parsed.pvp : null,
        hasSplit: parsed.hasSplit,
        recharge: parsed.recharge,
        activation: parsed.activation,
      });
      stillMissing.delete(title);
    }

    // Round 2: try "Name (skill)" for remaining
    if (stillMissing.size > 0) {
      const round2Titles = [...stillMissing.keys()].map((t) => `${t} (skill)`);
      const round2Map = await client.getWikitextBatch(round2Titles);

      for (const [title, id] of stillMissing) {
        const retryTitle = `${title} (skill)`;
        const wikitext = round2Map.get(retryTitle);
        if (!wikitext) continue;

        const parsed = parseFactsByMode(wikitext);
        const hasTimings = parsed.recharge.pve != null || parsed.activation.pve != null;
        if (parsed.pve.length === 0 && parsed.wvw.length === 0 && parsed.pvp.length === 0 && !hasTimings) continue;

        result.set(id, {
          pve: parsed.pve,
          wvw: parsed.hasSplit ? parsed.wvw : null,
          pvp: parsed.hasSplit ? parsed.pvp : null,
          hasSplit: parsed.hasSplit,
          recharge: parsed.recharge,
          activation: parsed.activation,
        });
      }
    }
  }

  return result;
}
```

- [ ] **Step 8: Run all resolver tests**

Run: `npx jest packages/gw2-data/tests/resolver.test.js -v`

Expected: ALL PASS

- [ ] **Step 9: Run full gw2-data test suite**

Run: `npx jest packages/gw2-data/tests/ -v`

Expected: ALL PASS

- [ ] **Step 10: Run integration tests**

Run: `npx jest tests/integration/ -v`

Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
git add packages/gw2-data/src/wiki/resolver.js packages/gw2-data/tests/resolver.test.js
git commit -m "feat: detect wiki name collisions and retry with profession-specific suffixes

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
