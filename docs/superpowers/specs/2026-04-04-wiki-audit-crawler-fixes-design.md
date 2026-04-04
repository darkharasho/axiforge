# Wiki Audit Crawler Fixes — Design Spec

**Date:** 2026-04-04
**Issue:** #137 (Berserk skill missing tooltip info) — root cause investigation
**Branch:** `fix/issue-137-berserk-skill-missing-tooltip`

## Problem

The wiki audit Playwright crawler (`tests/wiki-audit/crawl.js`) fails to extract two categories of skill data from GW2 wiki pages, and the auto-fix tool (`fix-splits.js`) destructively replaces good data with incomplete crawl results.

This caused the Berserk skill's WvW balance split to lose Attack Speed Increase, Duration, and correct Recharge facts — which went undetected by subsequent audit runs because the split then "matched" the (incomplete) wiki extraction.

## Root Causes

### 1. Crawler misses facts without named links

`extractFacts()` in `crawl.js` iterates `<dd>` fact rows and requires an `<a>` tag with non-empty `textContent` to identify the fact name. Facts like "Attack Speed Increase: 15%" and "Duration: 15 seconds" only have icon-only `<a>` tags (the image has alt text but the anchor's `textContent` is empty). The crawler hits `if (!name) continue;` and skips the row.

### 2. Crawler doesn't extract recharge from `.statistics` div

Recharge values live in `blockquote .statistics`, not in `<dd>` fact rows. The relic crawler (`crawl-relic.js` lines 66-80) already extracts this using `blockquote .statistics`, but the skill/trait crawler does not. The `.statistics` div contains gamemode-tagged children:

```html
<div class="gmvdivinline gamemode pve">8 <a>...recharge icon...</a></div>
<div class="gmvdivinline gamemode wvw pvp">15 <a>...recharge icon...</a></div>
```

After the WvW toggle is clicked, only the WvW div is visible.

### 3. `fix-splits.js` blindly replaces splits with incomplete data

When a mismatch is found, line 104 unconditionally replaces split facts with wiki facts:
```javascript
entry.modes.wvw.facts = wikiFacts;
```
When the crawler returns fewer facts than the split has (due to bugs 1 and 2), this erases correct data.

## Changes

### `tests/wiki-audit/crawl.js`

**`extractFacts()` — fallback for facts without named links:**

When no `<a>` with non-empty text is found in a `<dd>` row, fall back to parsing the row's full text content. Extract the fact label as the text before the first `:`, trimming whitespace and any leading image alt text artifacts. This handles:
- `Attack Speed Increase: 15%`
- `Duration: 15 seconds`
- Any other facts rendered without a text link

The existing `parseFactText()` in `parse-facts.js` already converts these text strings into structured fact objects, so no parser changes are needed.

**Recharge extraction from `blockquote .statistics`:**

After extracting `<dd>` facts, check for a `blockquote .statistics` element. Inside it, find the visible gamemode div (using `getComputedStyle` to check `display !== "none"`, matching how `<dd>` visibility is already checked). Parse the leading number from its text content and prepend `{ name: "Recharge", valueText: "<number>" }` to the facts array.

This mirrors the pattern proven in `crawl-relic.js` but adds gamemode awareness — the relic crawler doesn't need this since relics don't have WvW splits.

### `tests/wiki-audit/fix-splits.js`

**Safety guard against fact count regression:**

In the `category === "mismatch"` branch, before replacing split facts: if the existing split has `complete: true` and the wiki has **fewer** facts than the existing split, skip the replacement. Log it as a `"review"` action (new action type alongside `"update"`, `"add"`, `"skip"`) so the operator can see which entries need manual attention.

When the wiki has equal or more facts, the replacement proceeds normally — those cases represent the wiki having newer/better data.

## Files Modified

| File | Change |
|---|---|
| `tests/wiki-audit/crawl.js` | `extractFacts()`: add fallback name extraction; add recharge extraction from `.statistics` |
| `tests/wiki-audit/fix-splits.js` | Add fact-count regression guard for `complete: true` mismatch replacements |

## Testing

- Unit tests for the new `extractFacts` fallback behavior using mock DOM structures
- Run `npm run audit:wiki -- --limit 20` against live wiki to verify Berserk and similar skills now extract all facts
- Run `fix-splits.js --dry-run` against an audit report to verify the safety guard triggers correctly
