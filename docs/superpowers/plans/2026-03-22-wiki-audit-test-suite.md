# Wiki Audit Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually-run audit tool that crawls every GW2 skill/trait wiki page in WvW mode and compares the rendered facts against `splits.json`, reporting all discrepancies.

**Architecture:** Playwright crawls wiki pages sequentially, extracting facts from the rendered blockquote DOM. A comparison module (reusing extracted matching logic from `catalog.js`) diffs wiki facts against `splits.json` entries. Results are written as JSON with a self-contained HTML viewer.

**Tech Stack:** Node.js, Playwright (Chromium), existing `lib/gw2-balance-splits` module

**Spec:** `docs/superpowers/specs/2026-03-22-wiki-audit-test-suite-design.md`

---

### Task 1: Extract fact-matching functions into shared module

Extract the private balance-split matching functions from `catalog.js` into a shared module that both `catalog.js` and the new audit tool can import. This must not break any existing tests.

**Files:**
- Create: `lib/gw2-balance-splits/match.js`
- Modify: `src/main/gw2Data/catalog.js:54-228`
- Test: existing `tests/unit/catalog-splits.test.js` (must still pass)

- [ ] **Step 1: Create `lib/gw2-balance-splits/match.js`**

Cut these functions from `catalog.js` (lines 54-228) and paste into the new module:

```js
// lib/gw2-balance-splits/match.js

/**
 * Shared fact-matching utilities used by catalog.js (production) and
 * the wiki audit tool (validation). Extracted to avoid duplication.
 */

function splitNormalizeType(type) {
  if (type === "Distance") return "Radius";
  if (type === "PrefixedBuff" || type === "ApplyBuffCondition") return "Buff";
  return type || "";
}

function splitGroupKey(f) {
  return `${splitNormalizeType(f.type)}:${f.target || f.status || ""}`;
}

const SPLIT_VALUE_KEYS = ["value", "distance", "duration", "apply_count", "dmg_multiplier", "hit_count", "percent", "coefficient"];

function splitValueChanged(before, after) {
  return SPLIT_VALUE_KEYS.some((k) => {
    if (after[k] === undefined) return false;
    if (k === "hit_count" && before[k] === undefined) return false;
    return before[k] !== after[k];
  });
}

function buildSplitMatchTables(baseFacts, splitFacts) {
  const baseToSplit = new Map();
  const splitToBase = new Map();

  // Pass 1: text + normalized-type
  for (let si = 0; si < splitFacts.length; si++) {
    const sf = splitFacts[si];
    const sfText = (sf.text || "").toLowerCase().trim();
    if (!sfText) continue;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      const bf = baseFacts[bi];
      if (
        splitNormalizeType(bf.type) === splitNormalizeType(sf.type) &&
        (bf.text || "").toLowerCase().trim() === sfText
      ) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        break;
      }
    }
  }

  // Pass 1.5: cross-type exact text match
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const sfText = (splitFacts[si].text || "").toLowerCase().trim();
    if (!sfText) continue;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      if ((baseFacts[bi].text || "").toLowerCase().trim() === sfText) {
        baseToSplit.set(bi, si);
        splitToBase.set(si, bi);
        break;
      }
    }
  }

  // Pass 2: type-group positional for remaining unmatched facts
  const unmatchedByGroup = {};
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const key = splitGroupKey(splitFacts[si]);
    (unmatchedByGroup[key] = unmatchedByGroup[key] || []).push(si);
  }
  const groupCounters = {};
  for (let bi = 0; bi < baseFacts.length; bi++) {
    if (baseToSplit.has(bi)) continue;
    const key = splitGroupKey(baseFacts[bi]);
    const pool = unmatchedByGroup[key];
    if (!pool) continue;
    const idx = groupCounters[key] || 0;
    if (idx < pool.length) {
      baseToSplit.set(bi, pool[idx]);
      splitToBase.set(pool[idx], bi);
      groupCounters[key] = idx + 1;
    }
  }

  // Pass 3: keyword overlap
  const _stopWords = new Set(["the", "and", "per", "for", "with", "from", "based", "gain"]);
  function _keywords(text) {
    return (text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !_stopWords.has(w));
  }
  for (let si = 0; si < splitFacts.length; si++) {
    if (splitToBase.has(si)) continue;
    const sfKw = _keywords(splitFacts[si].text);
    if (!sfKw.length) continue;
    let bestBi = -1, bestScore = 0;
    for (let bi = 0; bi < baseFacts.length; bi++) {
      if (baseToSplit.has(bi)) continue;
      const bfKw = _keywords(baseFacts[bi].text);
      const shared = sfKw.filter((w) => bfKw.includes(w)).length;
      if (shared > bestScore) { bestScore = shared; bestBi = bi; }
    }
    if (bestScore > 0) {
      baseToSplit.set(bestBi, si);
      splitToBase.set(si, bestBi);
    }
  }

  return { baseToSplit, splitToBase };
}

module.exports = {
  splitNormalizeType,
  splitGroupKey,
  SPLIT_VALUE_KEYS,
  splitValueChanged,
  buildSplitMatchTables,
};
```

Note: the function names drop the leading underscore since they are now public exports.

- [ ] **Step 2: Update `catalog.js` to import from `match.js`**

Replace lines 54-182 in `src/main/gw2Data/catalog.js` with imports from the new shared module. Keep `_mergeSplitValues` and `_sanitiseUnmatchedSplitFact` in `catalog.js` since they are only used there.

At the top of the balance split helpers section (line 54), replace the function definitions with:

```js
// ── Balance split helpers ─────────────────────────────────────────────────────

const {
  splitNormalizeType: _splitNormalizeType,
  splitGroupKey: _splitGroupKey,
  SPLIT_VALUE_KEYS: _SPLIT_VALUE_KEYS,
  splitValueChanged: _splitValueChanged,
  buildSplitMatchTables: _buildSplitMatchTables,
} = require("../../../lib/gw2-balance-splits/match");
```

This aliases to the old underscore names so no other code in `catalog.js` needs to change.

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npx jest tests/unit/catalog-splits.test.js --verbose`
Expected: All 6 tests pass (3 skill, 2 trait, 1 weapon skill)

Also run the full suite to check for regressions:
Run: `npx jest --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add lib/gw2-balance-splits/match.js src/main/gw2Data/catalog.js
git commit -m "refactor: extract fact-matching functions into shared match.js module"
```

---

### Task 2: Scaffold the wiki-audit directory and dependencies

Set up the directory structure, install Playwright, and add the npm script.

**Files:**
- Create: `tests/wiki-audit/results/.gitignore`
- Modify: `package.json` (add `audit:wiki` script and `playwright` devDependency)

- [ ] **Step 1: Create results directory with `.gitignore`**

```bash
mkdir -p tests/wiki-audit/results
```

Write `tests/wiki-audit/results/.gitignore`:

```
*
!.gitignore
```

- [ ] **Step 2: Install Playwright**

```bash
npm install --save-dev playwright
npx playwright install chromium
```

- [ ] **Step 3: Add npm script to `package.json`**

Add to the `"scripts"` object in `package.json`:

```json
"audit:wiki": "node tests/wiki-audit/run-audit.js"
```

- [ ] **Step 4: Commit**

```bash
git add tests/wiki-audit/results/.gitignore package.json package-lock.json
git commit -m "chore: scaffold wiki-audit directory and add playwright dependency"
```

---

### Task 3: Implement the wiki fact parser

This module parses the text content of a rendered wiki fact row into a structured object. It is used by the crawler after extracting raw text from the DOM.

**Files:**
- Create: `tests/wiki-audit/parse-facts.js`
- Create: `tests/unit/wiki-audit-parse-facts.test.js`

- [ ] **Step 1: Write the failing tests**

Write `tests/unit/wiki-audit-parse-facts.test.js`:

```js
const { parseFactText } = require("../wiki-audit/parse-facts");

describe("parseFactText", () => {
  test("parses damage with coefficient", () => {
    expect(parseFactText("Damage", "269 (0.666)")).toEqual({
      type: "Damage", text: "Damage", dmg_multiplier: 0.666, hit_count: 1,
    });
  });

  test("parses damage with hit count", () => {
    expect(parseFactText("Damage", "269 (3×0.5)")).toEqual({
      type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 3,
    });
  });

  test("parses healing with coefficient", () => {
    expect(parseFactText("Healing", "1930 (0.5)")).toEqual({
      type: "AttributeAdjust", text: "Healing", target: "Healing",
      value: 1930, coefficient: 0.5, hit_count: 1,
    });
  });

  test("parses buff with duration", () => {
    expect(parseFactText("Fury", "4 s")).toEqual({
      type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1,
    });
  });

  test("parses buff with stacks and duration", () => {
    expect(parseFactText("Might", "3 stacks; 10 s")).toEqual({
      type: "Buff", text: "Might", status: "Might", duration: 10, apply_count: 3,
    });
  });

  test("parses condition with duration", () => {
    expect(parseFactText("Burning", "1 s")).toEqual({
      type: "Buff", text: "Burning", status: "Burning", duration: 1, apply_count: 1,
    });
  });

  test("parses number of targets", () => {
    expect(parseFactText("Number of Targets", "3")).toEqual({
      type: "Number", text: "Number of Targets", value: 3,
    });
  });

  test("parses radius", () => {
    expect(parseFactText("Radius", "180")).toEqual({
      type: "Radius", text: "Radius", distance: 180,
    });
  });

  test("parses range", () => {
    expect(parseFactText("Range", "1200")).toEqual({
      type: "Range", text: "Range", value: 1200,
    });
  });

  test("parses recharge", () => {
    expect(parseFactText("Recharge", "10")).toEqual({
      type: "Recharge", text: "Recharge", value: 10,
    });
  });

  test("parses conditions removed", () => {
    expect(parseFactText("Conditions Removed", "3")).toEqual({
      type: "Number", text: "Conditions Removed", value: 3,
    });
  });

  test("parses percent value", () => {
    expect(parseFactText("Damage Reduction", "33%")).toEqual({
      type: "Percent", text: "Damage Reduction", percent: 33,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/wiki-audit-parse-facts.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `parse-facts.js`**

Write `tests/wiki-audit/parse-facts.js`:

```js
/**
 * Parse rendered wiki fact text into structured fact objects.
 *
 * The GW2 wiki renders facts in the blockquote as rows like:
 *   "Damage: 269 (0.666)"
 *   "Burning (1s): 131 Damage"
 *   "Number of Targets: 3"
 *
 * This module takes the fact name (from the <a> link text) and the
 * remaining text (value portion) and returns a structured fact object
 * compatible with splits.json format for comparison.
 */

const KNOWN_BUFFS = new Set([
  "might", "fury", "quickness", "alacrity", "swiftness", "vigor", "regeneration",
  "protection", "resolution", "resistance", "stability", "aegis", "retaliation",
  "stealth", "superspeed", "revealed",
]);

const KNOWN_CONDITIONS = new Set([
  "bleeding", "burning", "confusion", "poison", "torment", "vulnerability",
  "weakness", "crippled", "chilled", "blinded", "immobile", "slow", "fear",
  "taunt", "daze", "stun", "knockdown", "knockback", "float", "pull", "sink",
]);

function isBuffOrCondition(name) {
  return KNOWN_BUFFS.has(name.toLowerCase()) || KNOWN_CONDITIONS.has(name.toLowerCase());
}

/**
 * @param {string} name  — the fact label (e.g. "Damage", "Fury", "Radius")
 * @param {string} value — the text after the label (e.g. "269 (0.666)", "4 s")
 * @returns {object|null} structured fact object or null if unparseable
 */
function parseFactText(name, value) {
  const nameLower = name.toLowerCase().trim();
  const val = (value || "").trim();

  // ── Damage ──
  if (nameLower === "damage") {
    return parseDamageFact(name, val);
  }

  // ── Healing ──
  if (nameLower === "healing") {
    return parseHealingFact(name, val);
  }

  // ── Recharge ──
  if (nameLower === "recharge" || nameLower === "recharge time") {
    const num = parseFloat(val);
    return !isNaN(num) ? { type: "Recharge", text: name, value: num } : null;
  }

  // ── Radius ──
  if (nameLower === "radius" || nameLower === "blast radius" || nameLower === "healing radius") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Radius", text: name, distance: num } : null;
  }

  // ── Range ──
  if (nameLower === "range") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Range", text: name, value: num } : null;
  }

  // ── Buffs and conditions ──
  if (isBuffOrCondition(name)) {
    return parseBuffFact(name, val);
  }

  // ── Number of targets, conditions removed, etc. ──
  if (nameLower === "number of targets" || nameLower === "conditions removed") {
    const num = parseInt(val, 10);
    return !isNaN(num) ? { type: "Number", text: name, value: num } : null;
  }

  // ── Percent ──
  const pctMatch = val.match(/^([\d.]+)\s*%/);
  if (pctMatch) {
    return { type: "Percent", text: name, percent: parseFloat(pctMatch[1]) };
  }

  // ── Generic number ──
  const num = parseFloat(val);
  if (!isNaN(num)) {
    return { type: "Number", text: name, value: num };
  }

  return null;
}

function parseDamageFact(name, val) {
  // "269 (3×0.5)" or "269 (0.666)"
  const hitMatch = val.match(/\((\d+)\s*[×x]\s*([\d.]+)\)/);
  if (hitMatch) {
    return {
      type: "Damage", text: name,
      dmg_multiplier: parseFloat(hitMatch[2]),
      hit_count: parseInt(hitMatch[1], 10),
    };
  }
  const coeffMatch = val.match(/\(([\d.]+)\)/);
  if (coeffMatch) {
    return {
      type: "Damage", text: name,
      dmg_multiplier: parseFloat(coeffMatch[1]),
      hit_count: 1,
    };
  }
  return { type: "Damage", text: name, dmg_multiplier: 0, hit_count: 1 };
}

function parseHealingFact(name, val) {
  // "1930 (0.5)" — base value with optional coefficient
  const parts = val.match(/^([\d,]+)\s*(?:\(([\d.]+)\))?/);
  const base = parts ? parseInt(parts[1].replace(/,/g, ""), 10) : 0;
  const coeff = parts?.[2] ? parseFloat(parts[2]) : 0;
  return {
    type: "AttributeAdjust", text: name, target: "Healing",
    value: base, coefficient: coeff, hit_count: 1,
  };
}

function parseBuffFact(name, val) {
  // "3 stacks; 10 s" or "4 s" or "10s"
  let duration = 0;
  let stacks = 1;

  const stackMatch = val.match(/(\d+)\s*stacks?/i);
  if (stackMatch) stacks = parseInt(stackMatch[1], 10);

  const durMatch = val.match(/([\d.]+)\s*s/);
  if (durMatch) duration = parseFloat(durMatch[1]);

  return {
    type: "Buff", text: name, status: name,
    duration, apply_count: stacks,
  };
}

module.exports = { parseFactText, isBuffOrCondition, KNOWN_BUFFS, KNOWN_CONDITIONS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/wiki-audit-parse-facts.test.js --verbose`
Expected: All 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/wiki-audit/parse-facts.js tests/unit/wiki-audit-parse-facts.test.js
git commit -m "feat(wiki-audit): add fact text parser with tests"
```

---

### Task 4: Implement the Playwright crawler

This module navigates to wiki pages, toggles game mode, and extracts fact data from the rendered DOM.

**Files:**
- Create: `tests/wiki-audit/crawl.js`

The wiki DOM structure (discovered via inspection):

- **Game mode toggle:** Buttons are generated by JS from a `div.widget-gamemodebuttons-placeholder`. After JS runs, buttons appear as `button.gmvbutton` with `data-mode` attribute (e.g. `data-mode="wvw pvp"` or `data-mode="pve"`). The `.active` class marks the selected button.
- **Fact rows:** Inside `blockquote > dl > dd`. Mode-specific facts are wrapped in `<div class="gamemode pve">` or `<div class="gamemode pvp wvw">`. Universal facts have no `.gamemode` wrapper.
- **Visibility:** Clicking a button modifies a dynamic stylesheet — inactive modes get `display: none`, active mode gets `display: unset`. No DOM swapping.
- **Fact format:** Each `<dd>` contains `<span class="inline-icon effect">` with an `<a>` (fact name) followed by text (value). Coefficient in gray `<span>`.

- [ ] **Step 1: Write `crawl.js`**

```js
/**
 * crawl.js — Playwright-based wiki page crawler.
 *
 * Navigates to GW2 wiki skill/trait pages, toggles WvW mode,
 * and extracts rendered fact data from the blockquote infobox.
 */

const { parseFactText } = require("./parse-facts");

// All wiki DOM selectors in one place for easy maintenance
const SELECTORS = {
  // Game mode toggle buttons (generated by wiki JS)
  gameModeButton: "button.gmvbutton",
  // WvW button: data-mode contains "wvw"
  wvwButton: 'button.gmvbutton[data-mode*="wvw"]',
  // The blockquote containing skill/trait description and facts
  blockquote: ".mw-parser-output blockquote",
  // Fact rows inside the blockquote
  factRow: "blockquote dl > dd",
  // Game-mode-tagged content wrapper
  gameModeDiv: ".gamemode",
  // Disambiguation page indicator
  disambigBox: ".disambig, .dmbox",
  // "Page does not exist" indicator
  noArticle: ".noarticle",
  // Skill/trait infobox
  infobox: ".infobox.skill, .infobox.trait",
};

const WIKI_BASE = "https://wiki.guildwars2.com/wiki/";
const PAGE_TIMEOUT = 10_000;
const RETRY_DELAY = 2_000;

/**
 * Crawl a single entity's wiki page and extract WvW facts.
 * Retries once on network error after a 2-second delay.
 *
 * @param {import('playwright').Page} page — reusable Playwright page
 * @param {object} entity — { id, name, professions }
 * @param {string} entityType — "skill" or "trait"
 * @returns {object} { hasToggle, wvwFacts, error, wiki_url }
 */
async function crawlEntity(page, entity, entityType) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await _crawlEntityOnce(page, entity, entityType);
    if (!result.error || attempt === 1) return result;
    // Retry after delay on first failure
    await new Promise((r) => setTimeout(r, RETRY_DELAY));
  }
}

async function _crawlEntityOnce(page, entity, entityType) {
  const wikiName = entity.name.replace(/ /g, "_");
  // Use encodeURI (not encodeURIComponent) to preserve valid URL chars like ()
  const url = `${WIKI_BASE}${encodeURI(wikiName)}`;
  let finalUrl = url;

  try {
    await page.goto(url, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" });

    // Wait for wiki JS to potentially generate toggle buttons
    await page.waitForTimeout(500);

    // Check for disambiguation page
    const isDisambig = await page.$(SELECTORS.disambigBox);
    if (isDisambig) {
      // Try profession-qualified URL
      const profession = entity.professions?.[0];
      if (profession) {
        const qualifiedUrl = `${WIKI_BASE}${encodeURI(wikiName + "_(" + profession + ")")}`;
        await page.goto(qualifiedUrl, { timeout: PAGE_TIMEOUT, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);
        finalUrl = qualifiedUrl;
        const stillDisambig = await page.$(SELECTORS.disambigBox);
        if (stillDisambig) {
          return { hasToggle: false, wvwFacts: [], error: "Disambiguation page (even with profession qualifier)" };
        }
      } else {
        return { hasToggle: false, wvwFacts: [], error: "Disambiguation page" };
      }
    }

    // Check for missing page
    const noArticle = await page.$(".mw-newarticletext");
    if (noArticle) {
      return { hasToggle: false, wvwFacts: [], error: "Page does not exist" };
    }

    // Check for game mode toggle
    const wvwButton = await page.$(SELECTORS.wvwButton);
    const hasToggle = !!wvwButton;

    if (wvwButton) {
      await wvwButton.click();
      // Wait for CSS visibility changes to apply
      await page.waitForTimeout(300);
    }

    // Extract facts from blockquote
    const wvwFacts = await extractFacts(page, hasToggle);

    return { hasToggle, wvwFacts, error: null, wiki_url: finalUrl };
  } catch (err) {
    return { hasToggle: false, wvwFacts: [], error: err.message };
  }
}

/**
 * Extract fact data from the rendered blockquote.
 *
 * After WvW mode is selected, only WvW-tagged facts and universal facts
 * are visible (PvE facts have display:none). We read all visible <dd> rows.
 */
async function extractFacts(page, hasToggle) {
  return page.$$eval("blockquote dl > dd", (rows, _hasToggle) => {
    const facts = [];

    for (const dd of rows) {
      // Skip hidden elements — the wiki uses a dynamic stylesheet to set
      // display:none on inactive game modes, so check computed style
      const ddStyle = window.getComputedStyle(dd);
      if (ddStyle.display === "none") continue;

      // Check for gamemode wrapper — if it exists and is hidden, skip
      const gmDiv = dd.querySelector(".gamemode");
      if (gmDiv) {
        const style = window.getComputedStyle(gmDiv);
        if (style.display === "none") continue;
      }

      // Extract the fact name from the <a> tag
      const link = dd.querySelector("a[title]");
      if (!link) continue;
      const name = link.textContent.trim();
      if (!name) continue;

      // Extract the full text content after the link
      // Get the text of the dd (or the visible gamemode div)
      const container = gmDiv || dd;
      const fullText = container.textContent.trim();

      // The value portion is everything after "Name:" or "Name (Ns):"
      // Remove the fact name from the beginning, and strip the "?" tooltip
      let valueText = fullText;
      const nameIdx = valueText.indexOf(name);
      if (nameIdx >= 0) {
        valueText = valueText.slice(nameIdx + name.length);
      }
      // Strip leading colon and whitespace
      valueText = valueText.replace(/^\s*:\s*/, "").replace(/\?\s*$/, "").trim();

      facts.push({ name, valueText });
    }

    return facts;
  }, hasToggle);
}

module.exports = { crawlEntity, SELECTORS, WIKI_BASE };
```

Note: `extractFacts` returns raw `{ name, valueText }` pairs. The caller runs them through `parseFactText` to get structured facts. This separation keeps browser-evaluated code minimal.

- [ ] **Step 2: Commit**

```bash
git add tests/wiki-audit/crawl.js
git commit -m "feat(wiki-audit): add Playwright wiki page crawler"
```

---

### Task 5: Implement the comparison module

Diffs wiki facts against splits.json facts using the shared matching logic.

**Files:**
- Create: `tests/wiki-audit/compare.js`
- Create: `tests/unit/wiki-audit-compare.test.js`

- [ ] **Step 1: Write the failing tests**

Write `tests/unit/wiki-audit-compare.test.js`:

```js
const { compareEntity } = require("../wiki-audit/compare");

describe("compareEntity", () => {
  test("returns match when facts agree", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("match");
    expect(result.fact_diffs).toHaveLength(0);
  });

  test("returns mismatch when coefficient differs", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.8, hit_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.fact_diffs[0].fields.dmg_multiplier).toEqual({ wiki: 0.8, splits: 0.5 });
  });

  test("flags wiki-only facts for complete entries", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    expect(result.category).toBe("mismatch");
    expect(result.wiki_only_facts).toHaveLength(1);
    expect(result.wiki_only_facts[0].text).toBe("Fury");
  });

  test("does not flag missing wiki facts for partial entries", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
      { type: "Buff", text: "Fury", status: "Fury", duration: 4, apply_count: 1 },
    ];
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: false,
    };
    const result = compareEntity(wikiFacts, splitEntry);
    // Partial entry: only compare listed facts, don't flag extra wiki facts
    expect(result.category).toBe("match");
    expect(result.wiki_only_facts).toHaveLength(0);
  });

  test("returns missing_from_splits when splitEntry is null but wiki has toggle", () => {
    const wikiFacts = [
      { type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 },
    ];
    const result = compareEntity(wikiFacts, null, { hasToggle: true });
    expect(result.category).toBe("missing_from_splits");
  });

  test("returns missing_from_wiki when splitEntry exists but wiki has no toggle", () => {
    const splitEntry = {
      facts: [{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 1 }],
      complete: true,
    };
    const result = compareEntity([], splitEntry, { hasToggle: false });
    expect(result.category).toBe("missing_from_wiki");
    expect(result.splits_only_facts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/wiki-audit-compare.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `compare.js`**

Write `tests/wiki-audit/compare.js`:

```js
/**
 * compare.js — Diff wiki facts against splits.json facts.
 */

const { buildSplitMatchTables, SPLIT_VALUE_KEYS } = require("../../lib/gw2-balance-splits/match");

/**
 * Compare wiki-extracted facts against a splits.json entry.
 *
 * @param {object[]} wikiFacts — structured facts from the wiki
 * @param {object|null} splitEntry — splits.json entry ({ facts, complete }) or null
 * @param {object} opts — { hasToggle: boolean }
 * @returns {object} { category, fact_diffs, wiki_only_facts, splits_only_facts }
 */
function compareEntity(wikiFacts, splitEntry, opts = {}) {
  const result = {
    category: "match",
    fact_diffs: [],
    wiki_only_facts: [],
    splits_only_facts: [],
  };

  // Case: splits.json has entry but wiki has no toggle (stale split)
  if (splitEntry && !opts.hasToggle) {
    result.category = "missing_from_wiki";
    result.splits_only_facts = splitEntry.facts || [];
    return result;
  }

  // Case: wiki has toggle but splits.json has no entry
  if (!splitEntry && opts.hasToggle && wikiFacts.length > 0) {
    result.category = "missing_from_splits";
    result.wiki_only_facts = wikiFacts;
    return result;
  }

  // Case: no split data on either side
  if (!splitEntry) {
    result.category = "no_split";
    return result;
  }

  const splitFacts = splitEntry.facts || [];
  const isComplete = splitEntry.complete === true;

  if (splitFacts.length === 0 && wikiFacts.length === 0) {
    return result; // both empty = match
  }

  // Build match tables: wiki facts as "base", split facts as "split"
  const { baseToSplit, splitToBase } = buildSplitMatchTables(wikiFacts, splitFacts);

  // Compare matched pairs
  for (let wi = 0; wi < wikiFacts.length; wi++) {
    const si = baseToSplit.get(wi);
    if (si === undefined) continue;
    const wf = wikiFacts[wi];
    const sf = splitFacts[si];
    const fields = {};

    for (const key of SPLIT_VALUE_KEYS) {
      const wVal = wf[key];
      const sVal = sf[key];
      // Skip if both undefined or both the same
      if (wVal === undefined && sVal === undefined) continue;
      if (wVal === sVal) continue;
      // Skip hit_count if wiki didn't report it
      if (key === "hit_count" && wVal === undefined) continue;
      fields[key] = { wiki: wVal, splits: sVal };
    }

    if (Object.keys(fields).length > 0) {
      result.fact_diffs.push({ text: wf.text || sf.text, type: wf.type || sf.type, fields });
    }
  }

  // Unmatched wiki facts (wiki has, splits doesn't) — only flag for complete entries
  if (isComplete) {
    for (let wi = 0; wi < wikiFacts.length; wi++) {
      if (!baseToSplit.has(wi)) {
        result.wiki_only_facts.push(wikiFacts[wi]);
      }
    }
  }

  // Unmatched split facts (splits has, wiki doesn't)
  for (let si = 0; si < splitFacts.length; si++) {
    if (!splitToBase.has(si)) {
      result.splits_only_facts.push(splitFacts[si]);
    }
  }

  // Determine category
  if (result.fact_diffs.length > 0 || result.wiki_only_facts.length > 0 || result.splits_only_facts.length > 0) {
    result.category = "mismatch";
  }

  return result;
}

module.exports = { compareEntity };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/wiki-audit-compare.test.js --verbose`
Expected: All 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/wiki-audit/compare.js tests/unit/wiki-audit-compare.test.js
git commit -m "feat(wiki-audit): add fact comparison module with tests"
```

---

### Task 6: Implement the report generator

Writes the JSON report and copies the HTML viewer.

**Files:**
- Create: `tests/wiki-audit/report.js`

- [ ] **Step 1: Write `report.js`**

```js
/**
 * report.js — Generate JSON audit report and copy HTML viewer.
 */

const path = require("path");
const fs = require("fs/promises");

const RESULTS_DIR = path.join(__dirname, "results");

/**
 * Write the audit report to disk.
 *
 * @param {object} report — { timestamp, duration_ms, summary, discrepancies, errors }
 * @returns {string} path to the written JSON file
 */
async function writeReport(report) {
  const ts = report.timestamp.replace(/[:.]/g, "-");
  const jsonPath = path.join(RESULTS_DIR, `${ts}-audit.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  // Copy viewer.html alongside the report
  const viewerSrc = path.join(__dirname, "viewer.html");
  const viewerDst = path.join(RESULTS_DIR, "viewer.html");
  await fs.copyFile(viewerSrc, viewerDst);

  return jsonPath;
}

module.exports = { writeReport };
```

- [ ] **Step 2: Commit**

```bash
git add tests/wiki-audit/report.js
git commit -m "feat(wiki-audit): add report generator"
```

---

### Task 7: Implement the HTML viewer

A self-contained HTML file with inline CSS and JS for viewing audit reports.

**Files:**
- Create: `tests/wiki-audit/viewer.html`

- [ ] **Step 1: Write `viewer.html`**

Create a single self-contained HTML file. Key features:
- File input via drag-and-drop or file picker to load a JSON report
- Summary bar showing total checked, matches, mismatches, missing, errors
- Filter buttons for each category
- Text search by entity name
- Expandable rows showing per-fact diffs with wiki vs splits values
- Entity names link to wiki pages

The HTML should contain all CSS and JS inline (no external dependencies). Use a clean, minimal design. The viewer reads the JSON entirely client-side.

This file will be relatively large (~200-300 lines of HTML/CSS/JS). The key DOM structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wiki Audit Report</title>
  <style>
    /* Dark theme, monospace, clean table layout */
    /* Summary bar with colored stat boxes */
    /* Filter buttons, search input */
    /* Expandable detail rows with fact diff table */
  </style>
</head>
<body>
  <h1>Wiki Audit Report</h1>
  <div id="drop-zone">Drop JSON report here or <input type="file" id="file-input" accept=".json"></div>
  <div id="summary" style="display:none"><!-- filled by JS --></div>
  <div id="filters" style="display:none"><!-- filter buttons + search --></div>
  <table id="results" style="display:none"><!-- discrepancy rows --></table>
  <script>
    // File loading, rendering, filtering, search, expand/collapse logic
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add tests/wiki-audit/viewer.html
git commit -m "feat(wiki-audit): add HTML report viewer"
```

---

### Task 8: Implement the main orchestrator (`run-audit.js`)

Wire everything together: fetch entities from GW2 API, load splits, crawl, compare, report.

**Files:**
- Create: `tests/wiki-audit/run-audit.js`

- [ ] **Step 1: Write `run-audit.js`**

```js
#!/usr/bin/env node
/**
 * run-audit.js — Main entry point for the wiki audit tool.
 *
 * Usage:
 *   npm run audit:wiki
 *   npm run audit:wiki -- --skip 100
 *   npm run audit:wiki -- --limit 10
 *   npm run audit:wiki -- --skip 100 --limit 50
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs/promises");
const { crawlEntity } = require("./crawl");
const { compareEntity } = require("./compare");
const { parseFactText } = require("./parse-facts");
const { writeReport } = require("./report");

const GW2_API = "https://api.guildwars2.com/v2";
const SPLITS_PATH = path.join(__dirname, "../../lib/gw2-balance-splits/data/splits.json");

// ── CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  let skip = 0, limit = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip" && args[i + 1]) skip = parseInt(args[i + 1], 10);
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[i + 1], 10);
  }
  return { skip, limit };
}

// ── Progress bar (matches seed.js style) ──

function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
  const pctStr = (pct * 100).toFixed(1).padStart(5);
  return `  ${bar} ${pctStr}% (${current}/${total})`;
}

// ── GW2 API fetching ──

async function fetchAllIds(endpoint) {
  const res = await fetch(`${GW2_API}/${endpoint}`);
  if (!res.ok) throw new Error(`GW2 API ${endpoint}: HTTP ${res.status}`);
  return res.json(); // returns array of IDs
}

async function fetchByIds(endpoint, ids) {
  const results = [];
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = await fetch(`${GW2_API}/${endpoint}?ids=${chunk.join(",")}`);
    if (!res.ok) throw new Error(`GW2 API ${endpoint}?ids=...: HTTP ${res.status}`);
    const data = await res.json();
    results.push(...data);
  }
  return results;
}

// ── Main ──

async function main() {
  const { skip, limit } = parseArgs();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`Wiki Audit — ${timestamp}`);

  // 1. Fetch entity list
  process.stdout.write("Fetching skills from GW2 API... ");
  const skillIds = await fetchAllIds("skills");
  const skills = await fetchByIds("skills", skillIds);
  const skillEntities = skills.map((s) => ({
    id: s.id, name: s.name, professions: s.professions || [], type: "skill",
  }));
  console.log(`${skillEntities.length} skills`);

  process.stdout.write("Fetching traits from GW2 API... ");
  const traitIds = await fetchAllIds("traits");
  const traits = await fetchByIds("traits", traitIds);
  const traitEntities = traits.map((t) => ({
    id: t.id, name: t.name, professions: [], specialization: t.specialization, type: "trait",
  }));
  console.log(`${traitEntities.length} traits`);

  // 2. Load splits.json
  const splitsRaw = JSON.parse(await fs.readFile(SPLITS_PATH, "utf-8"));
  const splitsIndex = {
    skill: splitsRaw.skills || {},
    trait: splitsRaw.traits || {},
  };
  const skillSplitCount = Object.keys(splitsIndex.skill).length;
  const traitSplitCount = Object.keys(splitsIndex.trait).length;
  console.log(`Loaded splits.json (${skillSplitCount} skills, ${traitSplitCount} traits)`);

  // 3. Build entity list with skip/limit
  const allEntities = [...skillEntities, ...traitEntities];
  const entities = allEntities.slice(skip, skip + limit);
  console.log(`Crawling ${entities.length} entities (skip=${skip}, limit=${limit === Infinity ? "all" : limit})\n`);

  // 4. Launch browser
  console.log("Launching browser...\n");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 5. Crawl and compare
  const summary = {
    skills_checked: 0, traits_checked: 0, total_checked: 0,
    matches: 0, mismatches: 0, missing_from_splits: 0,
    missing_from_wiki: 0, no_split: 0, errors: 0,
  };
  const discrepancies = [];
  const errors = [];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const entityType = entity.type;

    // Progress
    process.stdout.write(`\r  Crawling: ${progressBar(i + 1, entities.length)}`);

    // Crawl
    const crawlResult = await crawlEntity(page, entity, entityType);

    if (entityType === "skill") summary.skills_checked++;
    else summary.traits_checked++;
    summary.total_checked++;

    // Handle errors
    if (crawlResult.error) {
      summary.errors++;
      errors.push({
        entity_type: entityType, id: entity.id, name: entity.name,
        error: crawlResult.error,
      });
      continue;
    }

    // Parse raw facts through parseFactText
    const wikiFacts = crawlResult.wvwFacts
      .map((f) => parseFactText(f.name, f.valueText))
      .filter(Boolean);

    // Look up splits.json entry
    const splitEntry = splitsIndex[entityType]?.[String(entity.id)]?.modes?.wvw || null;

    // Compare
    const cmp = compareEntity(wikiFacts, splitEntry, { hasToggle: crawlResult.hasToggle });

    switch (cmp.category) {
      case "match": summary.matches++; break;
      case "mismatch": summary.mismatches++; break;
      case "missing_from_splits": summary.missing_from_splits++; break;
      case "missing_from_wiki": summary.missing_from_wiki++; break;
      case "no_split": summary.no_split++; break;
    }

    // Record discrepancies (skip matches and no_split)
    if (cmp.category !== "match" && cmp.category !== "no_split") {
      const record = {
        entity_type: entityType,
        id: entity.id,
        name: entity.name,
        wiki_url: crawlResult.wiki_url || `https://wiki.guildwars2.com/wiki/${entity.name.replace(/ /g, "_")}`,
        category: cmp.category,
      };
      if (cmp.fact_diffs.length) record.fact_diffs = cmp.fact_diffs;
      if (cmp.wiki_only_facts.length) record.wiki_only_facts = cmp.wiki_only_facts;
      if (cmp.splits_only_facts.length) record.splits_only_facts = cmp.splits_only_facts;
      if (cmp.category === "missing_from_splits") record.wiki_facts = wikiFacts;
      discrepancies.push(record);
    }
  }

  console.log("\n");

  // 6. Close browser
  await browser.close();

  // 7. Write report
  const report = {
    timestamp,
    duration_ms: Date.now() - startTime,
    summary,
    discrepancies,
    errors,
  };

  const reportPath = await writeReport(report);

  // 8. Print summary
  console.log("── Summary ──");
  console.log(`  Checked:             ${summary.total_checked}`);
  console.log(`  Matches:             ${summary.matches}`);
  console.log(`  Mismatches:          ${summary.mismatches}`);
  console.log(`  Missing from splits: ${summary.missing_from_splits}`);
  console.log(`  Missing from wiki:   ${summary.missing_from_wiki}`);
  console.log(`  No split:            ${summary.no_split}`);
  console.log(`  Errors:              ${summary.errors}`);
  console.log("");
  console.log(`Report written to ${reportPath}`);
  console.log(`Open tests/wiki-audit/results/viewer.html to review.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/wiki-audit/run-audit.js
git commit -m "feat(wiki-audit): add main orchestrator with CLI flags"
```

---

### Task 9: Smoke test with `--limit`

Run the audit on a small set of entities to verify end-to-end functionality.

- [ ] **Step 1: Run smoke test**

```bash
npm run audit:wiki -- --limit 5
```

Expected: The tool fetches GW2 API data, launches Chromium, crawls 5 pages, and writes a JSON report to `tests/wiki-audit/results/`. No crashes.

- [ ] **Step 2: Inspect the report**

```bash
cat tests/wiki-audit/results/*-audit.json | head -50
```

Verify the JSON structure matches the spec schema (timestamp, summary, discrepancies, errors).

- [ ] **Step 3: Open viewer**

Open `tests/wiki-audit/results/viewer.html` in a browser and load the JSON report. Verify the summary bar, table, and expandable rows render correctly.

- [ ] **Step 4: Fix any issues found during smoke test**

If the selectors don't match the current wiki DOM, update `SELECTORS` in `crawl.js`. If fact parsing produces unexpected results, add test cases and fix `parse-facts.js`. If comparison logic has false positives, adjust `compare.js`.

- [ ] **Step 5: Run full test suite to ensure no regressions**

```bash
npx jest --verbose
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A tests/wiki-audit/ tests/unit/wiki-audit-*.test.js
git commit -m "fix(wiki-audit): address issues found during smoke test"
```

---

### Task 10: Run a broader test and finalize

Run with a larger limit to validate stability and performance.

- [ ] **Step 1: Run with --limit 50**

```bash
npm run audit:wiki -- --limit 50
```

Expected: Completes without crashes. Takes ~2-5 minutes. Report has reasonable data.

- [ ] **Step 2: Verify --skip works**

```bash
npm run audit:wiki -- --skip 25 --limit 5
```

Expected: Starts from entity 25, crawls 5 entities.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(wiki-audit): complete wiki audit test suite"
```
