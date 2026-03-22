# Wiki Audit Test Suite — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

A manually-run audit tool that crawls every GW2 skill and trait wiki page using Playwright, switches to WvW mode, extracts the rendered facts from the blockquote/infobox, and compares them against `splits.json`. Produces a JSON discrepancy report with a lightweight HTML viewer.

The audit serves two purposes:
1. **Validate existing splits** — flag anywhere `splits.json` disagrees with the live wiki
2. **Discover missing splits** — find skills/traits where the wiki shows WvW differences but `splits.json` has no entry

This test suite does NOT run as part of `npm test`. It is invoked manually via `npm run audit:wiki`.

---

## File Structure

```
lib/gw2-balance-splits/
  match.js              # Extracted fact-matching logic (shared by catalog.js and compare.js)

tests/wiki-audit/
  run-audit.js          # Entry point — orchestrates the full audit
  crawl.js              # Playwright: navigate pages, toggle WvW, extract facts
  compare.js            # Diff wiki facts against splits.json facts
  report.js             # Generate JSON report + copy HTML viewer into results/
  viewer.html           # Static HTML file (inline CSS/JS) that loads JSON client-side
  results/              # gitignored output directory
    .gitignore          # Ignore everything in results/
```

**Important:** Files in `tests/wiki-audit/` must NOT use the `.test.js` suffix, since the Jest config (`testMatch: ["**/tests/**/*.test.js"]`) would pick them up during `npm test`.

Output files are written to `tests/wiki-audit/results/` and gitignored. Each run produces:
- `<timestamp>-audit.json` — the full report
- `viewer.html` — a copy of the viewer, placed alongside the JSON for convenience

---

## npm Script

Add to `package.json`:

```json
"audit:wiki": "node tests/wiki-audit/run-audit.js"
```

This is not wired into `npm test`. Playwright is added as a devDependency used only by this script.

---

## Dependencies

Add `playwright` as a devDependency:

```json
"playwright": "^1.52.0"
```

Run `npx playwright install chromium` once after install to download the browser binary. The audit script uses only Chromium.

---

## Audit Flow

### 1. Fetch entity list

Pull all skill and trait data from the GW2 API using a two-step approach (the GW2 API does not support `?ids=all` for skills/traits):

1. `GET /v2/skills` → returns an array of all skill IDs (e.g. `[1, 2, 3, ...]`)
2. Batch-fetch in chunks of 200: `GET /v2/skills?ids=1,2,3,...,200` → returns full skill objects
3. Repeat for traits: `GET /v2/traits` → ID list, then batch-fetch

Extract `{ id, name }` pairs from each response. This gives the complete universe of ~1500 skills and ~260 traits. ~8 batched requests for skills, ~2 for traits.

### 2. Load splits.json

Read `lib/gw2-balance-splits/data/splits.json` and index by entity type + ID for O(1) lookup.

### 3. Launch Playwright

Single Chromium instance, single page. No parallelism — sequential page loads.

### 4. Crawl each entity

For each skill and trait (by name from the GW2 API):

1. Navigate to `https://wiki.guildwars2.com/wiki/{name}` (URL-encoded, spaces → underscores)
2. Wait for page load
3. Detect if a game mode toggle exists on the page (the WvW/PvP/PvE buttons)
4. If toggle exists:
   - Click the WvW button
   - Wait for DOM update (fact elements to reflect WvW values)
   - Extract facts from the rendered skill/trait infobox
5. If no toggle exists:
   - Extract base facts (no WvW split on wiki for this entity)
   - Record that wiki shows no split

### 5. Compare

For each entity, diff the extracted wiki facts against the corresponding `splits.json` entry (if one exists). See **Comparison Logic** below.

### 6. Classify

Each entity falls into one of these categories:

| Category | Meaning |
|---|---|
| `match` | splits.json agrees with wiki — not included in report |
| `mismatch` | Both have WvW data but values differ |
| `missing_from_splits` | Wiki shows WvW differences but splits.json has no entry for this entity |
| `missing_from_wiki` | splits.json has an entry but wiki page not found or has no game mode toggle |
| `no_split` | Neither wiki nor splits.json has WvW data — not included in report |
| `error` | Page load failed, disambiguation page, or other crawl error |

### 7. Write report

Generate the JSON report file and copy `viewer.html` into the results directory. Print a console summary.

---

## Wiki Page Extraction

### Game mode toggle detection

The GW2 wiki renders game mode toggles as clickable elements (PvE / WvW / PvP buttons) on skill and trait pages that have balance splits. The audit script must:

1. Look for the toggle container element on the page
2. If found, click the WvW option
3. Wait for the visible facts to update

The exact selectors will be determined during implementation by inspecting live wiki pages. The first implementation task is to navigate to a few representative skill pages (one with splits, one without) and document the DOM structure. The crawl module should encapsulate all selector logic in a single `SELECTORS` constant object so it can be updated in one place if the wiki changes its markup.

### Fact extraction

After toggling to WvW (or reading base facts if no toggle), extract each visible fact row from the skill/trait infobox. For each fact, capture:

- `text` — the fact label (e.g. "Damage", "Healing", "Fury")
- `type` — inferred from the label and presentation (Damage, Buff, Recharge, etc.)
- Value fields as applicable: `value`, `duration`, `apply_count`, `dmg_multiplier`, `coefficient`, `distance`, `percent`

The extraction logic should parse the rendered text of each fact row. For example, a fact row showing "Damage (3x): 0.5" yields `{ type: "Damage", text: "Damage", dmg_multiplier: 0.5, hit_count: 3 }`.

### Name collisions and disambiguation

Many GW2 skills share the same name across professions or weapons (e.g. multiple "Fireball" skills, "Slash" on several classes). When navigating by name, this can land on a disambiguation page.

**Strategy:** After navigation, check whether the page is a disambiguation page (presence of disambiguation markers in the DOM). If so:
1. Check if the wiki uses the `Skill_name_(profession)` or `Skill_name_(weapon_type)` naming convention
2. Attempt the profession-qualified URL using the skill's profession from the GW2 API data
3. If still ambiguous, log as error with context and continue

This means the GW2 API fetch (Step 1) must also capture each skill's `professions` array and each trait's `specialization` ID, not just `{ id, name }`.

### Redirect and missing page handling

- **Redirects:** Playwright follows redirects naturally; no special handling needed.
- **Missing pages:** If the wiki returns a "page does not exist" state, log as error, continue.

---

## Comparison Logic

### Fact matching

Use the same matching strategy as `catalog.js` (`_buildSplitMatchTables`):

1. **Pass 1:** Exact text + normalized type match
2. **Pass 1.5:** Cross-type exact text match
3. **Pass 2:** Type-group positional match
4. **Pass 3:** Keyword overlap

To reuse this logic, extract the matching functions (`_buildSplitMatchTables`, `_splitNormalizeType`, `_splitGroupKey`, `_SPLIT_VALUE_KEYS`, `_splitValueChanged`) from `catalog.js` into a shared module at `lib/gw2-balance-splits/match.js`. Both `catalog.js` and `compare.js` import from this shared module. This avoids code duplication and ensures the audit uses the same matching behavior as production.

### Value comparison

For each matched fact pair (wiki vs splits.json), compare these fields:

- `value`
- `duration`
- `apply_count`
- `dmg_multiplier`
- `hit_count`
- `coefficient`
- `distance`
- `percent`

A fact is flagged as a mismatch if any of these fields differ between wiki and splits.json. Record which fields differ with both values.

### The `complete` flag

Each entry in `splits.json` has a `complete` field (`true` or `false`) that affects comparison semantics:

- **`complete: true`** — The split represents the FULL WvW fact set. PvE facts absent from the split were intentionally removed in WvW. When comparing, the wiki's WvW facts are the authoritative list. A fact in `splits.json` but absent on the wiki is a mismatch. A fact on the wiki but absent from `splits.json` is also a mismatch.

- **`complete: false`** — The split only lists CHANGED facts. Unlisted facts are expected to match PvE base values. When comparing, only compare the facts that `splits.json` explicitly lists; do not flag missing facts as mismatches.

### PvP/WvW grouping

Some wiki pages group WvW and PvP together (they share the same split values). When the Playwright toggle shows "WvW" mode, it may display the combined WvW+PvP values. This is expected and should not produce false mismatches — the audit compares whatever the WvW toggle shows.

### Missing fact detection

- Facts present on the wiki but not matched in splits.json → flagged as additions (only for `complete: true` entries)
- Facts present in splits.json but not matched on the wiki → flagged as removals

---

## Report Schema (JSON)

```json
{
  "timestamp": "2026-03-22T14:30:00.000Z",
  "duration_ms": 360000,
  "summary": {
    "skills_checked": 1500,
    "traits_checked": 260,
    "total_checked": 1760,
    "matches": 800,
    "mismatches": 12,
    "missing_from_splits": 5,
    "missing_from_wiki": 3,
    "no_split": 930,
    "errors": 10
  },
  "discrepancies": [
    {
      "entity_type": "skill",
      "id": 5503,
      "name": "Signet of Restoration",
      "wiki_url": "https://wiki.guildwars2.com/wiki/Signet_of_Restoration",
      "category": "mismatch",
      "fact_diffs": [
        {
          "text": "Healing",
          "type": "AttributeAdjust",
          "fields": {
            "coefficient": { "wiki": 0.8, "splits": 0.5 }
          }
        }
      ],
      "wiki_only_facts": [],
      "splits_only_facts": []
    },
    {
      "entity_type": "trait",
      "id": 999,
      "name": "Example Trait",
      "wiki_url": "https://wiki.guildwars2.com/wiki/Example_Trait",
      "category": "missing_from_splits",
      "wiki_facts": [
        { "type": "Damage", "text": "Damage", "dmg_multiplier": 1.2 }
      ]
    }
  ],
  "errors": [
    {
      "entity_type": "skill",
      "id": 9999,
      "name": "Ambiguous Skill",
      "error": "Disambiguation page detected"
    }
  ]
}
```

---

## HTML Viewer

A single self-contained `viewer.html` file with inline CSS and JS (no external dependencies). Functionality:

- **File input:** Drag-and-drop or file picker to load a JSON audit report
- **Summary bar:** Total checked, matches, mismatches, missing, errors — with counts
- **Filter buttons:** Filter the table by category (mismatch, missing_from_splits, missing_from_wiki, error)
- **Search:** Text search by entity name
- **Discrepancy table:** Sortable columns for entity type, name, category
- **Expandable rows:** Click a row to see fact-by-fact diff with wiki value vs splits value side-by-side
- **Links:** Each entity name links to its wiki page

The viewer reads the JSON entirely client-side. No server needed.

---

## Rate Limiting & Resilience

- **Rate limit:** No artificial delay between page loads. Playwright's page load already provides natural rate limiting (~2-5 seconds per page). This is slower than the lightweight JSON requests in `seed.js` that need the 200ms delay.
- **Retry:** On network error or timeout, retry once after 2 seconds. On second failure, log to errors and continue.
- **Progress:** Console progress bar using the `seed.js` style (`progressBar` function)
- **Resume support:** Accept `--skip N` CLI argument to start from entity N (useful if interrupted mid-run)
- **Limit support:** Accept `--limit N` CLI argument to crawl only the first N entities (useful for testing the audit tool itself)
- **Timeout:** 10-second page load timeout per entity. If exceeded, log as error and continue.
- **Expected runtime:** ~1-2 hours for a full run of ~1760 entities at ~2-5 seconds per page.

---

## Console Output

During the run, display:

```
Wiki Audit — 2026-03-22T14:30:00.000Z
Fetching skills from GW2 API... 1523 skills
Fetching traits from GW2 API... 267 traits
Loaded splits.json (702 skills, 173 traits)
Launching browser...

Crawling skills:
  ████████████████████░░░░░░░░░░ 67.3% (1025/1523)

Crawling traits:
  ██████████████████████████████ 100.0% (267/267)

── Summary ──
  Checked:  1790
  Matches:  802
  Mismatches: 12
  Missing from splits: 5
  Missing from wiki: 3
  No split: 958
  Errors: 10

Report written to tests/wiki-audit/results/2026-03-22T14-30-00-audit.json
Open tests/wiki-audit/results/viewer.html to review.
```

---

## Out of Scope

- PvP mode comparison (only WvW is audited)
- Automated fixing of splits.json (this tool reports; the developer decides what to update)
- Running as part of CI (this is a manual, on-demand tool)
- Buff pages (buffs are facts within skills/traits, not standalone wiki pages to crawl)
- Equipment, rune, or sigil pages
