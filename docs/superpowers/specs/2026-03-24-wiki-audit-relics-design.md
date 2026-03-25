# Wiki Audit: Relic Facts Crawler & Per-Type Audit Commands

**Date:** 2026-03-24
**Issue context:** Follow-up from #53 (relic inner cooldowns)

## Problem

The GW2 API `/v2/items` endpoint returns almost no structured data for relics — just a text description. The wiki has rich structured facts (damage coefficients, buff durations, target counts, ranges, ICDs) that we need to display in relic tooltips. Currently we only have manually curated ICD values in `relicOverrides.js`. We need a crawler to keep this data current and expand it to all available facts.

Additionally, the existing `npm run audit:wiki` command only audits skills and traits. We want per-type commands (`audit:wiki:skills`, `audit:wiki:traits`, `audit:wiki:relics`).

## Design Decisions

1. **Full facts file over ICD-only overrides** — Replace `relicOverrides.js` with a comprehensive `relicFacts.json` storing all wiki-sourced facts per relic.
2. **Parameterized single script** — Add `--type` flag to `run-audit.js` rather than separate entry scripts. npm scripts pass flags.
3. **Auto-fix for relics** — `audit:wiki:fix` patches `relicFacts.json` the same way it patches `splits.json`.
4. **Delete `relicOverrides.js`** — Single source of truth in `relicFacts.json`.

## Data File: `relicFacts.json`

Location: `tests/wiki-audit/data/relicFacts.json`. Co-located with the audit tooling that maintains it, not in `lib/gw2-balance-splits/data/` — relics don't have WvW balance splits, they have universal wiki-sourced facts. Keeping them separate avoids conceptual conflation.

```json
{
  "updatedAt": "2026-03-24T...",
  "relics": {
    "100074": {
      "name": "Relic of Cerus",
      "facts": [
        { "type": "Damage", "text": "Damage", "dmg_multiplier": 1.0, "hit_count": 1 },
        { "type": "Number", "text": "Boons Converted to Conditions", "value": 1 },
        { "type": "Number", "text": "Number of Targets", "value": 5 },
        { "type": "Range", "text": "Range", "value": 600 },
        { "type": "Recharge", "text": "Cooldown", "value": 30 }
      ]
    },
    "100148": {
      "name": "Relic of Speed",
      "facts": []
    }
  }
}
```

Facts use the same schema as GW2 API facts: `type`, `text`, plus type-specific fields (`dmg_multiplier`, `hit_count`, `duration`, `apply_count`, `value`, `distance`, `percent`, `status`, `coefficient`). The Recharge fact with `text: "Cooldown"` replaces what was in `relicOverrides.js`.

## Catalog Integration

`catalog.js` changes:

- Remove `require("./relicOverrides")` import
- Load `relicFacts.json` at startup (path resolved via `path.join(__dirname, "../../tests/wiki-audit/data/relicFacts.json")` or via a constant)
- When mapping relics, look up by item ID and attach the full `facts` array:

```js
const relicData = relicFactsIndex[String(item.id)];
if (relicData?.facts?.length) mapped.facts = relicData.facts;
```

## Audit CLI: `--type` Flag

`run-audit.js` accepts `--type skills|traits|relics`. npm scripts:

```json
"audit:wiki": "node tests/wiki-audit/run-audit.js",
"audit:wiki:skills": "node tests/wiki-audit/run-audit.js --type skills",
"audit:wiki:traits": "node tests/wiki-audit/run-audit.js --type traits",
"audit:wiki:relics": "node tests/wiki-audit/run-audit.js --type relics",
"audit:wiki:fix": "node tests/wiki-audit/fix-splits.js"
```

When `--type relics`:
1. Load relic IDs from `upgradeIds.js` (curated list of relics the app displays — not all relics in the game), fetch names from GW2 API `/v2/items`
2. Crawl each relic's wiki page via `crawl-relic.js`
3. Parse facts via existing `parse-facts.js`
4. Compare against `relicFacts.json` using a relic-specific comparison path (see Comparison Adaptation below)
5. Write report to `results/`

When no `--type` flag: run all three types sequentially (skills → traits → relics).

Worker pool, status display, and reporting infrastructure are shared — only the entity list, crawl function, and comparison lookup vary by type.

### Summary counters

Add `relics_checked` to the summary object. The counter logic branches on `entity_type` (currently hardcoded as skills/traits else). Add explicit `"relic"` branch.

## Comparison Adaptation

The existing `compare.js` is built around WvW toggle semantics (`hasToggle`, `modes.wvw.facts`). Relics don't have WvW splits — they have universal facts. Rather than contorting the WvW-oriented `compareEntity()`, the relic audit uses a **simpler direct comparison**:

1. `run-audit.js` looks up the stored entry from `relicFacts.json` as `relicFactsIndex[id]`
2. Wiki-crawled facts are parsed into the same structured format
3. Comparison uses a new `compareRelicFacts(wikiFacts, storedFacts)` function in `compare.js` that returns the same `{ category, fact_diffs, ... }` shape as `compareEntity()`. Categories reuse existing names for counter/display compatibility:
   - `"match"` — wiki facts and stored facts are equivalent
   - `"mismatch"` — both exist but differ
   - `"missing_from_splits"` — wiki has facts but no stored entry exists (or stored entry has empty facts)
   - `"no_split"` — wiki page has no extractable facts and stored is also empty

This avoids the `hasToggle`/`wvwFacts` semantics entirely. The report output uses the same discrepancy format so the viewer and fix script can handle it.

## Relic Crawler: `crawl-relic.js`

New module: relic wiki pages use `{{Relic infobox}}` templates with different DOM structure than skill/trait pages.

Exports: `crawlEntity(page, entity, entityType)` — same interface as `crawl.js`.

Process:
1. Navigate to `https://wiki.guildwars2.com/wiki/{Relic_Name}`
2. Handle disambiguation/missing pages — relic names are generally unique (e.g., "Relic of Cerus") so disambiguation is rare. Implement basic missing-page detection. If disambiguation is encountered, score candidates by "relic" keyword presence rather than profession matching.
3. Extract facts from rendered relic infobox fact rows
4. Extract recharge value from infobox header (clock icon area)
5. Append recharge as `{ name: "Recharge", valueText: "<seconds>" }` to the raw facts list
6. Return `{ facts: [{ name, valueText }], error, wiki_url }` — note this uses `facts` not `wvwFacts` since there's no WvW toggle concept. `run-audit.js` checks `entityType` to read the correct key.

DOM selectors to be determined during implementation by inspecting rendered relic pages.

## Fix Script Extension

`fix-splits.js` extended to also patch `relicFacts.json`:

- Routes by `entity_type` field in the audit report: `"relic"` discrepancies target `relicFacts.json`, `"skill"`/`"trait"` target `splits.json` as before
- **`mismatch`**: Replace relic's `facts` array with wiki's version
- **`missing_from_data`**: Add new entry `{ name, facts }`
- **Wiki page missing/empty**: Skip, keep existing data
- Updates `updatedAt` timestamp on write
- Same `--dry-run` support

## `viewer.html` Updates

Add relic support to the interactive report viewer:
- Handle `entity_type: "relic"` in display logic
- Adjust column labels (no WvW toggle info for relics)
- Display relic fact comparisons (stored vs. wiki)

## Relic-Specific Fact Patterns

The existing `parse-facts.js` handles most relic fact patterns via its generic fallbacks:
- Damage with coefficients: `"269 (0.666)"` → Damage fact (existing)
- Buff/condition durations: `"Fury", "4 s"` → Buff fact (existing)
- Numeric values: `"Number of Targets", "5"` → Number fact (existing)
- Ranges: `"Range", "600"` → Range fact (existing)
- Recharge: `"Recharge", "30"` → Recharge fact (existing)
- Percentage values: `"33%"` → Percent fact (existing)

Patterns that may need new branches (to be confirmed during implementation by sampling rendered relic pages):
- "Maximum Stacks" — likely falls through to Number (acceptable)
- Relic-specific effect text — may need NoData-style passthrough

If new patterns are discovered during implementation, add parser branches and corresponding test cases.

## Files Changed

| Change | File | Description |
|---|---|---|
| New | `tests/wiki-audit/data/relicFacts.json` | Full relic facts, crawler-maintained |
| Delete | `src/main/gw2Data/relicOverrides.js` | Replaced by relicFacts.json |
| Modify | `src/main/gw2Data/catalog.js` | Load facts from relicFacts.json |
| Modify | `tests/wiki-audit/run-audit.js` | Add `--type` flag, relic entity loading, summary counters |
| New | `tests/wiki-audit/crawl-relic.js` | Relic wiki page crawler |
| Modify | `tests/wiki-audit/compare.js` | Add `compareRelicFacts()` function |
| Modify | `tests/wiki-audit/fix-splits.js` | Route relic discrepancies to relicFacts.json |
| Modify | `tests/wiki-audit/viewer.html` | Handle relic entity type display |
| Modify | `package.json` | Add per-type audit npm scripts |
| Update | `tests/unit/renderer/relic-cooldowns.test.js` | Load from relicFacts.json, test all fact types |
| New | `tests/unit/wiki-audit-crawl-relic.test.js` | Unit test for relic DOM fact extraction |

## Testing

- **`relic-cooldowns.test.js`**: Update to load from `relicFacts.json`. Test rendering of all relic fact types (Recharge, Damage, Buff, Number, Range).
- **`wiki-audit-parse-facts.test.js`**: Add test cases for any new relic-specific patterns discovered during implementation.
- **`wiki-audit-compare.test.js`**: Add tests for `compareRelicFacts()`.
- **New `wiki-audit-crawl-relic.test.js`**: Unit test for DOM fact extraction from relic infobox HTML.
