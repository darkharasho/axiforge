# Wiki Audit: Relic Facts Crawler & Per-Type Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ICD-only `relicOverrides.js` with a comprehensive `relicFacts.json` maintained by a wiki crawler, and add per-type `--type` flag to the audit CLI.

**Architecture:** The existing wiki audit worker pool, reporting, and fix infrastructure are extended with a `--type` flag. A new `crawl-relic.js` module handles relic wiki page scraping. A new `compareRelicFacts()` function handles the simpler relic comparison (no WvW toggle semantics). `relicFacts.json` replaces `relicOverrides.js` as the single source of truth for relic tooltip facts.

**Tech Stack:** Node.js, Playwright (browser automation), GW2 Wiki MediaWiki HTML scraping, Jest (unit tests)

**Spec:** `docs/superpowers/specs/2026-03-24-wiki-audit-relics-design.md`

---

### Task 1: Create `relicFacts.json` seed data

Seed the JSON file from the existing `relicOverrides.js` ICD data. The crawler will later fill in the rest.

**Files:**
- Create: `tests/wiki-audit/data/relicFacts.json`

- [ ] **Step 1: Create the data directory and seed file**

```bash
mkdir -p tests/wiki-audit/data
```

Write a script to generate `tests/wiki-audit/data/relicFacts.json` from existing data:

```bash
node -e "
const { RELIC_ITEM_IDS } = require('./src/main/gw2Data/upgradeIds');
const { RELIC_ICD_OVERRIDES } = require('./src/main/gw2Data/relicOverrides');
const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

(async () => {
  const relics = {};
  for (let i = 0; i < RELIC_ITEM_IDS.length; i += 200) {
    const batch = RELIC_ITEM_IDS.slice(i, i + 200);
    const items = await fetch('https://api.guildwars2.com/v2/items?ids=' + batch.join(','));
    for (const item of items) {
      const cd = RELIC_ICD_OVERRIDES.get(item.id);
      relics[String(item.id)] = {
        name: item.name,
        facts: cd != null ? [{ type: 'Recharge', text: 'Cooldown', value: cd }] : [],
      };
    }
  }
  const data = { updatedAt: new Date().toISOString(), relics };
  require('fs').writeFileSync(
    'tests/wiki-audit/data/relicFacts.json',
    JSON.stringify(data, null, 2) + '\n'
  );
  console.log('Wrote', Object.keys(relics).length, 'relics');
})();
"
```

- [ ] **Step 2: Verify the seed file**

```bash
node -e "
const data = require('./tests/wiki-audit/data/relicFacts.json');
const ids = Object.keys(data.relics);
const withFacts = ids.filter(id => data.relics[id].facts.length > 0);
console.log('Total relics:', ids.length);
console.log('With facts:', withFacts.length);
console.log('Sample:', JSON.stringify(data.relics['100074'], null, 2));
"
```

Expected: ~107 total relics, ~61 with Recharge facts, sample shows Relic of Cerus with `[{ type: "Recharge", text: "Cooldown", value: 30 }]`.

- [ ] **Step 3: Commit**

```bash
git add tests/wiki-audit/data/relicFacts.json
git commit -m "feat: seed relicFacts.json from existing ICD overrides"
```

---

### Task 2: Switch `catalog.js` from `relicOverrides.js` to `relicFacts.json`

**Files:**
- Modify: `src/main/gw2Data/catalog.js:855-917`
- Delete: `src/main/gw2Data/relicOverrides.js`
- Modify: `tests/unit/renderer/relic-cooldowns.test.js:114-126`

- [ ] **Step 1: Update the test to load from `relicFacts.json`**

In `tests/unit/renderer/relic-cooldowns.test.js`, replace the "Relic override data" describe block (lines 114-126):

```js
describe("Relic facts data", () => {
  test("relicFacts.json contains expected relic entries with facts", () => {
    const data = require("../../../tests/wiki-audit/data/relicFacts.json");

    expect(data.relics).toBeDefined();
    // Relic of Cerus should have a Cooldown fact
    const cerus = data.relics["100074"];
    expect(cerus).toBeDefined();
    expect(cerus.facts.find(f => f.type === "Recharge")).toEqual(
      { type: "Recharge", text: "Cooldown", value: 30 }
    );
    // Relic of Speed has no ICD
    const speed = data.relics["100148"];
    expect(speed).toBeDefined();
    expect(speed.facts.find(f => f.type === "Recharge")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes with seed data**

```bash
npx jest tests/unit/renderer/relic-cooldowns.test.js --no-coverage
```

Expected: All 5 tests pass.

- [ ] **Step 3: Update `catalog.js` to load from `relicFacts.json`**

In `src/main/gw2Data/catalog.js`:

Replace line 857:
```js
// OLD:
const { RELIC_ICD_OVERRIDES } = require("./relicOverrides");

// NEW:
const _relicFactsPath = require("path").join(__dirname, "../../../tests/wiki-audit/data/relicFacts.json");
const _relicFactsData = JSON.parse(require("fs").readFileSync(_relicFactsPath, "utf8"));
const _relicFactsIndex = _relicFactsData.relics || {};
```

Note: `__dirname` is `src/main/gw2Data/`, so `../../../` reaches the repo root.

Replace lines 912-917 (the relic mapping):
```js
// OLD:
relics: relicItems.map((item) => {
  const mapped = mapItem(item);
  const cd = RELIC_ICD_OVERRIDES.get(item.id);
  if (cd != null) mapped.facts = [{ type: "Recharge", text: "Cooldown", value: cd }];
  return mapped;
}).sort((a, b) => a.name.localeCompare(b.name)),

// NEW:
relics: relicItems.map((item) => {
  const mapped = mapItem(item);
  const relicData = _relicFactsIndex[String(item.id)];
  if (relicData?.facts?.length) mapped.facts = relicData.facts;
  return mapped;
}).sort((a, b) => a.name.localeCompare(b.name)),
```

- [ ] **Step 4: Delete `relicOverrides.js`**

```bash
rm src/main/gw2Data/relicOverrides.js
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/gw2Data/catalog.js tests/unit/renderer/relic-cooldowns.test.js
git rm src/main/gw2Data/relicOverrides.js
git commit -m "refactor: replace relicOverrides.js with relicFacts.json"
```

---

### Task 3: Add `compareRelicFacts()` to `compare.js`

**Files:**
- Modify: `tests/wiki-audit/compare.js`
- Modify: `tests/unit/wiki-audit-compare.test.js`

- [ ] **Step 1: Write failing tests for `compareRelicFacts`**

Append to `tests/unit/wiki-audit-compare.test.js`:

```js
const { compareRelicFacts } = require("../wiki-audit/compare");

describe("compareRelicFacts", () => {
  test("returns match when wiki facts equal stored facts", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
      { type: "Number", text: "Number of Targets", value: 5 },
    ];
    const storedFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
      { type: "Number", text: "Number of Targets", value: 5 },
    ];
    const result = compareRelicFacts(wikiFacts, storedFacts);
    expect(result.category).toBe("match");
  });

  test("returns mismatch when a fact value differs", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 20 },
    ];
    const storedFacts = [
      { type: "Recharge", text: "Cooldown", value: 30 },
    ];
    const result = compareRelicFacts(wikiFacts, storedFacts);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.value).toEqual({ wiki: 20, splits: 30 });
  });

  test("returns missing_from_splits when wiki has facts but stored is empty", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 10 },
    ];
    const result = compareRelicFacts(wikiFacts, []);
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns missing_from_splits when stored is null", () => {
    const wikiFacts = [
      { type: "Recharge", text: "Cooldown", value: 10 },
    ];
    const result = compareRelicFacts(wikiFacts, null);
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns no_split when both wiki and stored are empty", () => {
    const result = compareRelicFacts([], []);
    expect(result.category).toBe("no_split");
  });

  test("returns no_split when wiki is empty and stored is null", () => {
    const result = compareRelicFacts([], null);
    expect(result.category).toBe("no_split");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/unit/wiki-audit-compare.test.js --no-coverage
```

Expected: New tests fail with `compareRelicFacts is not a function`.

- [ ] **Step 3: Implement `compareRelicFacts` in `compare.js`**

Add before `module.exports` in `tests/wiki-audit/compare.js`:

```js
/**
 * Compare wiki-scraped relic facts against stored relicFacts.json data.
 * Simpler than compareEntity — no WvW toggle semantics, just direct fact comparison.
 * Uses the same buildSplitMatchTables and SPLIT_VALUE_KEYS already imported at the top.
 */
function compareRelicFacts(wikiFacts, storedFacts) {
  const result = {
    category: "match",
    fact_diffs: [],
    wiki_only_facts: [],
    splits_only_facts: [],
  };

  const wFacts = Array.isArray(wikiFacts) ? wikiFacts : [];
  const sFacts = Array.isArray(storedFacts) ? storedFacts : [];

  // Both empty — nothing to compare
  if (wFacts.length === 0 && sFacts.length === 0) {
    result.category = "no_split";
    return result;
  }

  // Wiki has facts but stored is empty/null — new data available
  if (wFacts.length > 0 && sFacts.length === 0) {
    result.category = "missing_from_splits";
    result.wiki_only_facts = wFacts;
    return result;
  }

  // Use existing match infrastructure (baseToSplit/splitToBase are Map<index, index>)
  const { baseToSplit, splitToBase } = buildSplitMatchTables(wFacts, sFacts);

  // Compare matched pairs
  for (let wi = 0; wi < wFacts.length; wi++) {
    const si = baseToSplit.get(wi);
    if (si === undefined) continue;
    const wf = wFacts[wi];
    const sf = sFacts[si];
    const fields = {};

    for (const key of SPLIT_VALUE_KEYS) {
      const wVal = wf[key];
      const sVal = sf[key];
      if (wVal === undefined && sVal === undefined) continue;
      if (wVal === sVal) continue;
      fields[key] = { wiki: wVal, splits: sVal };
    }

    if (Object.keys(fields).length > 0) {
      result.fact_diffs.push({ text: wf.text || sf.text, type: wf.type || sf.type, fields });
    }
  }

  // Unmatched wiki facts (always flag for relics — we have complete data)
  for (let wi = 0; wi < wFacts.length; wi++) {
    if (!baseToSplit.has(wi)) {
      result.wiki_only_facts.push(wFacts[wi]);
    }
  }

  // Unmatched stored facts
  for (let si = 0; si < sFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.splits_only_facts.push(sFacts[si]);
    }
  }

  if (result.fact_diffs.length || result.wiki_only_facts.length || result.splits_only_facts.length) {
    result.category = "mismatch";
  }

  return result;
}
```

Update `module.exports`:

```js
module.exports = { compareEntity, compareRelicFacts };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/unit/wiki-audit-compare.test.js --no-coverage
```

Expected: All tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add tests/wiki-audit/compare.js tests/unit/wiki-audit-compare.test.js
git commit -m "feat: add compareRelicFacts for relic audit comparison"
```

---

### Task 4: Create `crawl-relic.js`

Relic wiki pages use the same `blockquote dl > dd` structure as skills/traits. The recharge is in a `.statistics` div inside the blockquote. Some relics have `div.gamemode.pvp` wrappers on facts (PvP-split relics like Cerus); we want the PvE/WvW facts.

Note: The fact extraction function uses Playwright's `page.$$eval()` which evaluates in the browser context — DOM APIs like `querySelectorAll`, `closest`, `textContent` are available. Unit testing this requires either integration tests with Playwright or mocking at the `crawlEntity` level.

**Files:**
- Create: `tests/wiki-audit/crawl-relic.js`
- Create: `tests/unit/wiki-audit-crawl-relic.test.js`

- [ ] **Step 1: Write unit tests for `crawlEntity` at the module level**

Since the `extractRelicFacts` function runs inside `page.$$eval()` (browser context), we test at the `crawlEntity` level by mocking the Playwright page object. Create `tests/unit/wiki-audit-crawl-relic.test.js`:

```js
"use strict";

const { crawlEntity, SELECTORS } = require("../wiki-audit/crawl-relic");

// Mock a Playwright page that returns pre-canned results
function mockPage(opts = {}) {
  const { facts = [], recharge = null, missing = false, error = null } = opts;
  return {
    goto: jest.fn(async () => { if (error) throw new Error(error); }),
    url: jest.fn(() => "https://wiki.guildwars2.com/wiki/Test_Relic"),
    $: jest.fn(async (sel) => {
      if (sel === SELECTORS.noArticle) return missing ? {} : null;
      return null;
    }),
    $$eval: jest.fn(async () => facts),
    $eval: jest.fn(async (sel, fn) => {
      if (sel === SELECTORS.statistics && recharge != null) {
        // Simulate browser eval: fn receives an element with textContent
        return recharge;
      }
      throw new Error("not found");
    }),
  };
}

describe("crawl-relic crawlEntity", () => {
  test("returns facts and recharge for a valid relic page", async () => {
    const page = mockPage({
      facts: [
        { name: "Damage", valueText: "266 (1.0)" },
        { name: "Number of Targets", valueText: "5" },
      ],
      recharge: 30,
    });

    const result = await crawlEntity(page, { id: 100074, name: "Relic of Cerus", type: "relic" }, "relic");

    expect(result.error).toBeNull();
    expect(result.facts).toHaveLength(3); // 2 facts + recharge
    expect(result.facts[2]).toEqual({ name: "Recharge", valueText: "30" });
  });

  test("returns empty facts for a missing wiki page", async () => {
    const page = mockPage({ missing: true });

    const result = await crawlEntity(page, { id: 99999, name: "Fake Relic", type: "relic" }, "relic");

    expect(result.error).toBe("Wiki page not found");
    expect(result.facts).toEqual([]);
  });

  test("returns facts without recharge when no statistics div", async () => {
    const page = mockPage({
      facts: [{ name: "Range", valueText: "600" }],
      recharge: null,
    });

    const result = await crawlEntity(page, { id: 100148, name: "Relic of Speed", type: "relic" }, "relic");

    expect(result.error).toBeNull();
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].name).toBe("Range");
  });

  test("retries once on navigation error", async () => {
    let callCount = 0;
    const page = mockPage({});
    page.goto = jest.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("timeout");
    });
    page.$$eval = jest.fn(async () => []);

    const result = await crawlEntity(page, { id: 100001, name: "Test Relic", type: "relic" }, "relic");

    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/unit/wiki-audit-crawl-relic.test.js --no-coverage
```

Expected: Fail with `Cannot find module '../wiki-audit/crawl-relic'`.

- [ ] **Step 3: Implement `crawl-relic.js`**

Create `tests/wiki-audit/crawl-relic.js`:

```js
"use strict";

const { WIKI_BASE } = require("./crawl");

const PAGE_TIMEOUT = 10_000;
const RETRY_DELAY = 2_000;

const SELECTORS = {
  blockquote: ".mw-parser-output blockquote",
  factRow: "blockquote dl > dd",
  statistics: "blockquote .statistics",
  noArticle: ".mw-newarticletext",
};

/**
 * Extract structured fact rows from the relic wiki page blockquote.
 * Runs inside page.$$eval (browser context) — DOM APIs are available.
 */
function _extractRelicFactsBrowser(dds) {
  return dds
    .filter((dd) => {
      // Skip PvP-only gamemode facts (we want PvE/WvW)
      const pvpOnly = dd.closest(".gamemode.pvp:not(.pve):not(.wvw)");
      if (pvpOnly) return false;
      return true;
    })
    .map((dd) => {
      const links = dd.querySelectorAll("a[title]");
      let name = "";
      for (const a of links) {
        const text = (a.textContent || "").trim();
        if (text) { name = text; break; }
      }
      const fullText = (dd.textContent || "").trim();
      const nameIdx = fullText.indexOf(name);
      let valueText = "";
      if (nameIdx >= 0 && name) {
        valueText = fullText.slice(nameIdx + name.length).replace(/^\s*[:;]\s*/, "").trim();
      }
      return { name, valueText };
    })
    .filter((f) => f.name);
}

async function _crawlRelicOnce(page, entity) {
  const pageName = entity.name.replace(/ /g, "_");
  const url = WIKI_BASE + encodeURIComponent(pageName);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
  } catch (err) {
    return { facts: [], error: `Navigation failed: ${err.message}`, wiki_url: url };
  }

  // Check for missing page
  const missing = await page.$(SELECTORS.noArticle);
  if (missing) {
    return { facts: [], error: "Wiki page not found", wiki_url: url };
  }

  const finalUrl = page.url();

  try {
    const facts = await page.$$eval(SELECTORS.factRow, _extractRelicFactsBrowser);

    // Extract recharge from statistics div
    let recharge = null;
    try {
      recharge = await page.$eval(SELECTORS.statistics, (el) => {
        const text = (el.textContent || "").trim();
        const match = text.match(/^([\d.]+)/);
        return match ? parseFloat(match[1]) : null;
      });
    } catch {
      // No statistics div — relic has no ICD
    }

    if (recharge != null) {
      facts.push({ name: "Recharge", valueText: String(recharge) });
    }

    return { facts, error: null, wiki_url: finalUrl };
  } catch (err) {
    return { facts: [], error: err.message, wiki_url: finalUrl };
  }
}

async function crawlEntity(page, entity, _entityType) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await _crawlRelicOnce(page, entity);
    if (!result.error || attempt === 1) return result;
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
}

module.exports = { crawlEntity, SELECTORS };
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/unit/wiki-audit-crawl-relic.test.js --no-coverage
```

Expected: All 4 tests pass. The mock page matches the function's call patterns (`page.goto`, `page.$`, `page.$$eval`, `page.$eval`).

- [ ] **Step 5: Commit**

```bash
git add tests/wiki-audit/crawl-relic.js tests/unit/wiki-audit-crawl-relic.test.js
git commit -m "feat: add crawl-relic.js for wiki relic fact extraction"
```

---

### Task 5: Add `--type` flag and relic entity loading to `run-audit.js`

**Files:**
- Modify: `tests/wiki-audit/run-audit.js`

- [ ] **Step 1: Add `--type` argument parsing**

Near the top where CLI args are parsed (around lines 14-20), add:

```js
const typeArg = args.find(a => a.startsWith("--type"));
const typeVal = typeArg ? (typeArg.includes("=") ? typeArg.split("=")[1] : args[args.indexOf(typeArg) + 1]) : null;
const VALID_TYPES = new Set(["skills", "traits", "relics"]);
if (typeVal && !VALID_TYPES.has(typeVal)) {
  console.error(`Invalid --type: ${typeVal}. Must be one of: skills, traits, relics`);
  process.exit(1);
}
```

- [ ] **Step 2: Guard skill/trait loading with `typeVal` and add relic loading**

Wrap the existing skill entity loading (around lines 189-195) with:
```js
let skillEntities = [];
if (!typeVal || typeVal === "skills") {
  // ... existing skill fetch code ...
}
```

Wrap the existing trait entity loading (around lines 197-203) with:
```js
let traitEntities = [];
if (!typeVal || typeVal === "traits") {
  // ... existing trait fetch code ...
}
```

Add relic entity loading after:
```js
let relicEntities = [];
if (!typeVal || typeVal === "relics") {
  const { RELIC_ITEM_IDS } = require("../src/main/gw2Data/upgradeIds");
  const relicItems = await fetchByIds("items", RELIC_ITEM_IDS);
  relicEntities = relicItems.map(item => ({
    id: item.id,
    name: item.name,
    type: "relic",
  }));
}
```

Note: Uses `fetchByIds` (the local function defined at line 47), NOT `fetchGw2ByIds`.

Update entity list:
```js
const allEntities = [...skillEntities, ...traitEntities, ...relicEntities];
```

- [ ] **Step 3: Add `relics_checked` to summary and update counter branching**

In `crawlWithWorkers` (line 68-71), add `relics_checked: 0` to the summary object.

Update counter branching (lines 98-99):
```js
// OLD:
if (entityType === "skill") summary.skills_checked++;
else summary.traits_checked++;

// NEW:
if (entityType === "skill") summary.skills_checked++;
else if (entityType === "trait") summary.traits_checked++;
else if (entityType === "relic") summary.relics_checked++;
```

- [ ] **Step 4: Commit CLI and entity loading changes**

```bash
git add tests/wiki-audit/run-audit.js
git commit -m "feat: add --type flag and relic entity loading to run-audit.js"
```

---

### Task 6: Add relic crawl + comparison path to `run-audit.js` worker loop

**Files:**
- Modify: `tests/wiki-audit/run-audit.js`
- Modify: `package.json`

- [ ] **Step 1: Import relic crawler and comparator**

At the top of `run-audit.js`, alongside the existing imports:

```js
const { crawlEntity: crawlRelic } = require("./crawl-relic");
const { compareRelicFacts } = require("./compare");
```

- [ ] **Step 2: Load `relicFacts.json` before the worker loop**

In the main function, before `crawlWithWorkers` is called, load relic data alongside `splitsIndex`:

```js
const relicFactsData = require("./data/relicFacts.json");
```

Pass it into `crawlWithWorkers` as a new parameter.

- [ ] **Step 3: Branch crawl function and comparison by entityType**

In the worker loop, replace the crawl call (line 95):

```js
// OLD:
const crawlResult = await crawlEntity(page, entity, entityType);

// NEW:
const crawlResult = entityType === "relic"
  ? await crawlRelic(page, entity, entityType)
  : await crawlEntity(page, entity, entityType);
```

After the error check (line 112), branch the fact parsing and comparison:

```js
if (entityType === "relic") {
  // Relic comparison path
  const storedEntry = relicFactsData.relics[String(entity.id)];
  const wikiFacts = crawlResult.facts
    .map((f) => parseFactText(f.name, f.valueText))
    .filter(Boolean);
  const cmp = compareRelicFacts(wikiFacts, storedEntry?.facts || null);

  switch (cmp.category) {
    case "match": summary.matches++; break;
    case "mismatch": summary.mismatches++; break;
    case "missing_from_splits": summary.missing_from_splits++; break;
    case "no_split": summary.no_split++; break;
  }

  display.addCompleted(cmp.category === "match" ? "matches"
    : cmp.category === "no_split" ? "no_split"
    : cmp.category === "mismatch" ? "mismatches"
    : cmp.category === "missing_from_splits" ? "missing_from_splits"
    : "errors");

  if (cmp.category !== "match" && cmp.category !== "no_split") {
    const record = {
      entity_type: entityType,
      id: entity.id,
      name: entity.name,
      wiki_url: crawlResult.wiki_url || `${WIKI_BASE}${entity.name.replace(/ /g, "_")}`,
      category: cmp.category,
      wiki_wvw_facts: wikiFacts,
      splits_wvw_facts: storedEntry?.facts || [],
    };
    if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
    if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
    if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
    discrepancies.push(record);
    incremental.writeDiscrepancy(record);
    const tag = `${entity.name} (${entityType} #${entity.id})`;
    if (cmp.category === "mismatch") {
      display.addRecent("\u2717", "\x1b[31m", "MISMATCH", tag);
    } else if (cmp.category === "missing_from_splits") {
      display.addRecent("\u25cc", "\x1b[33m", "MISSING(S)", tag);
    }
  }
} else {
  // Existing skill/trait comparison path (unchanged)
  const wikiFacts = crawlResult.wvwFacts
    .map((f) => parseFactText(f.name, f.valueText))
    .filter(Boolean);
  // ... rest of existing code ...
}
```

Note: The relic discrepancy record uses `wiki_wvw_facts` (same key as skills/traits) for fix-script compatibility. The field name is a misnomer for relics but keeps the report format consistent.

- [ ] **Step 4: Add npm scripts to `package.json`**

In `package.json`, after the existing `"audit:wiki:fix"` line, add:

```json
"audit:wiki:skills": "node tests/wiki-audit/run-audit.js --type skills",
"audit:wiki:traits": "node tests/wiki-audit/run-audit.js --type traits",
"audit:wiki:relics": "node tests/wiki-audit/run-audit.js --type relics",
```

- [ ] **Step 5: Smoke test all three types**

```bash
node tests/wiki-audit/run-audit.js --type relics --limit 3
node tests/wiki-audit/run-audit.js --type skills --limit 3
node tests/wiki-audit/run-audit.js --type traits --limit 3
```

Expected: All three run without crashes.

- [ ] **Step 6: Commit**

```bash
git add tests/wiki-audit/run-audit.js package.json
git commit -m "feat: wire relic crawl + comparison into audit worker loop"
```

---

### Task 7: Extend `fix-splits.js` for relic patching

**Files:**
- Modify: `tests/wiki-audit/fix-splits.js`

- [ ] **Step 1: Add relic routing to the fix script**

In `fix-splits.js`, update the main discrepancy loop (around line 79). Add a guard before the existing `const collection = ...` line (line 80):

```js
if (d.entity_type === "relic") {
  // Handled in the relic-specific loop below
  continue;
}
```

Add a second loop after the existing skills/traits loop:

```js
// ── Relic patching ──
const relicFactsPath = path.join(__dirname, "data/relicFacts.json");
let relicFacts;
try {
  relicFacts = JSON.parse(fs.readFileSync(relicFactsPath, "utf8"));
} catch {
  relicFacts = { updatedAt: "", relics: {} };
}

let relicChanged = false;
for (const d of discrepancies.filter(d => d.entity_type === "relic")) {
  const idStr = String(d.id);
  const wikiFacts = (d.wiki_wvw_facts || []).filter(f => f && f.type);

  if (d.category === "mismatch") {
    if (wikiFacts.length === 0) { stats.skipped++; continue; }
    relicFacts.relics[idStr] = relicFacts.relics[idStr] || { name: d.name, facts: [] };
    relicFacts.relics[idStr].facts = wikiFacts;
    relicChanged = true;
    stats.updated++;
  } else if (d.category === "missing_from_splits") {
    if (wikiFacts.length === 0) { stats.skipped++; continue; }
    relicFacts.relics[idStr] = { name: d.name, facts: wikiFacts };
    relicChanged = true;
    stats.added++;
  } else {
    stats.skipped++;
  }
}

if (relicChanged && !dryRun) {
  relicFacts.updatedAt = new Date().toISOString();
  fs.writeFileSync(relicFactsPath, JSON.stringify(relicFacts, null, 2) + "\n");
  console.log(`Wrote ${relicFactsPath}`);
}
```

- [ ] **Step 2: Verify fix script doesn't crash on dry-run**

```bash
node tests/wiki-audit/fix-splits.js --dry-run
```

Expected: Runs without error.

- [ ] **Step 3: Commit**

```bash
git add tests/wiki-audit/fix-splits.js
git commit -m "feat: extend fix-splits.js to patch relicFacts.json"
```

---

### Task 8: Update `viewer.html` for relic display

**Files:**
- Modify: `tests/wiki-audit/viewer.html`

- [ ] **Step 1: Add relics_checked to summary display**

Find the summary rendering section (search for `skills_checked`) and add:

```js
if (s.relics_checked) html += `<li>Relics checked: ${s.relics_checked}</li>`;
```

The entity_type badge already renders dynamically (`entry.type`), so no other changes needed.

- [ ] **Step 2: Commit**

```bash
git add tests/wiki-audit/viewer.html
git commit -m "feat: add relic support to wiki audit viewer"
```

---

### Task 9: Run full relic audit and populate `relicFacts.json`

This is the integration step — crawl all relics and auto-fix.

**Files:**
- Updates: `tests/wiki-audit/data/relicFacts.json` (via fix script)

- [ ] **Step 1: Run the full relic audit**

```bash
npm run audit:wiki:relics
```

Expected: Crawls all ~107 relics. Most will be `missing_from_splits` or `mismatch`.

- [ ] **Step 2: Run the fix script to populate `relicFacts.json`**

```bash
npm run audit:wiki:fix
```

Expected: Updates `relicFacts.json` with full facts from wiki.

- [ ] **Step 3: Run app tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Re-run relic audit to verify convergence**

```bash
npm run audit:wiki:relics
```

Expected: Mostly `match` or `no_split` now.

- [ ] **Step 5: Commit the populated data**

```bash
git add tests/wiki-audit/data/relicFacts.json
git commit -m "feat: populate relicFacts.json with full wiki-scraped relic facts"
```

---

### Task 10: Final integration test

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Verify all three audit types work**

```bash
node tests/wiki-audit/run-audit.js --type skills --limit 5
node tests/wiki-audit/run-audit.js --type traits --limit 5
node tests/wiki-audit/run-audit.js --type relics --limit 5
```

Expected: All three run without errors.

- [ ] **Step 3: Verify the app shows relic facts in tooltips**

Launch the app and hover over relics. Verify:
- Relic of Cerus shows: Damage, Number of Targets, Range, Cooldown: 30s
- Relic of the Aristocracy shows: effect fact, Maximum Stacks, Cooldown: 1s
- Relic of Speed (no wiki facts) shows only description
