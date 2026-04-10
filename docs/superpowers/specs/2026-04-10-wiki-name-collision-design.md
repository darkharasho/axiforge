# Wiki Resolver Name Collision Fix — Design Spec

## Problem

The wiki resolver fetches pages by exact skill/trait name from the GW2 API. Many names collide with non-skill wiki pages:

- "Ring of Fire" → location page (Ring of Fire region)
- "Zap" → weapon page (precursor sword)
- "Searing Slash" → disambiguation page (multiple skills)
- "Call Lightning" → disambiguation page

The resolver currently only detects explicit `{{disambig}}` pages. It silently falls back to API facts for name collisions with non-disambig pages (locations, weapons, NPCs), losing wiki-sourced fact data.

## Solution

After the initial batch fetch, validate each page by checking its infobox ID against the expected entity API ID. Non-matching pages get queued for suffix-based retries.

### Validation Logic

A fetched page is a "hit" if its wikitext contains a `{{Skill infobox` or `{{Trait infobox` with an `| id = ` value that includes the entity's API ID. Multi-ID infoboxes (e.g., `| id = 5805,6020`) are supported by checking if any comma-separated value matches.

### Retry Strategy

When validation fails (wrong page, no infobox, or mismatched ID), retry with suffixes in order:

1. `"Name (profession skill)"` — e.g., `"Ring of Fire (elementalist skill)"`
2. `"Name (skill)"` — generic fallback, e.g., `"Zap (skill)"`

For traits (detected by presence in the traits list, not skills), use:

1. `"Name (trait)"` — e.g., `"Spiteful Spirit (trait)"`

Retries are batch-fetched in a single request per suffix round.

### Integration with Existing Disambig Handling

The existing `{{disambig}}` detection stays as-is. The new ID validation runs first. A page that passes ID validation but is a disambig page would be unusual (disambig pages don't have skill infoboxes), so the two checks are complementary.

### Flow

1. Batch-fetch all titles
2. For each fetched page:
   - If `{{disambig}}` → queue for existing disambig retry (unchanged)
   - Else if infobox ID matches entity → parse facts (unchanged)
   - Else (no infobox, wrong infobox, wrong ID) → queue for suffix retry (new)
3. Batch-fetch suffix retries
4. Parse facts from successful retries

## Files

| File | Change |
|------|--------|
| `packages/gw2-data/src/wiki/resolver.js` | Add infobox ID validation + suffix retry logic |
| `packages/gw2-data/tests/resolver.test.js` | Test name collision detection and suffix retries |

## Testing

- Page with wrong infobox type (location) → retries with suffix → finds skill page
- Page with matching infobox ID → accepted directly (no retry)
- Multi-ID infobox match → accepted
- Suffix retry finds correct page on first try → uses it
- Suffix retry finds correct page on second try (generic) → uses it
- Both suffixes fail → falls back to API facts (existing behavior)
