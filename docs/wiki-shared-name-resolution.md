# Wiki Shared-Name Resolution

## Problem

Many GW2 entities share the same display name but live on different wiki pages. The current resolver deduplicates by name — it fetches one wiki page per unique name and applies the same parsed facts to every entity with that name. This means only one entity gets correct wiki facts; the rest get the wrong data or nothing.

### Examples

- **"Function Gyro"** — both a trait (`Function Gyro`) and a tool belt skill (`Function Gyro (tool belt skill)`). The main page is the trait; the tool belt skill gets the trait's facts.
- **"Maul"** — ranger greatsword skill, but also pet skills for feline, porcine, soulbeast porcine, soulbeast feline, beastmode greatsword, and wallow. Each has its own wiki page with different facts (e.g. `Maul (feline)`, `Maul (ranger greatsword skill)`).
- Any skill that shares a name with a pet skill, racial skill, or bundle skill.

### Current Flow

```
catalog.js builds titleToIds: Map<name, id[]>
  └─ "Maul" → [skill_id_1, pet_skill_id_2, pet_skill_id_3, ...]

catalog.js builds titleToFirstId: Map<name, id>
  └─ "Maul" → skill_id_1  (first one wins)

resolveEntityFacts(client, titleToFirstId)
  └─ fetches wiki page "Maul" once
  └─ parses facts from that one page

catalog.js expands: all IDs sharing the name get the same facts
  └─ skill_id_1, pet_skill_id_2, pet_skill_id_3 all get "Maul" page facts
```

The resolver's prefix search only kicks in when the initial page has the **wrong infobox type** (e.g. a location page). When the initial page *does* have a Skill/Trait infobox, it's accepted — even if it's the wrong *specific* skill.

## Proposed Fix

### 1. Catalog: Build per-entity title hints

Instead of deduplicating to one ID per name, the catalog should detect name collisions and produce disambiguated wiki titles where possible:

- If only one entity has a given name → use the bare name (existing behavior)
- If multiple entities share a name → use entity metadata to construct likely wiki titles:
  - Pet skills: `"Name (family)"` e.g. `"Maul (feline)"`, or `"Name (soulbeast family)"` for soulbeast merged skills
  - Tool belt skills: `"Name (tool belt skill)"`
  - Weapon skills with profession context: `"Name (ranger greatsword skill)"`
  - Trait skills: `"Name (trait skill)"`
  - Fallback: use the bare name + prefix search (existing behavior)

This requires the catalog to know entity *type* metadata (pet skill, tool belt, weapon skill, etc.) which it already has from the API data.

### 2. Resolver: Accept per-entity title map

Change `resolveEntityFacts` to accept `Map<number, string>` (id → wiki title) instead of `Map<string, number>` (title → id). Each entity gets its own wiki title, and the resolver fetches/deduplicates at the title level.

### 3. Resolver: Keep prefix search as fallback

When a constructed title doesn't resolve (page doesn't exist or has no facts), fall back to prefix search — same as today's name collision handling.

## Scope

| File | Change |
|------|--------|
| `src/main/gw2Data/catalog.js` | Build per-entity wiki titles using entity metadata |
| `packages/gw2-data/src/wiki/resolver.js` | Accept id→title map, deduplicate fetches by title |
| `packages/gw2-data/tests/resolver.test.js` | Update tests for new map direction |

## Open Questions

- What entity metadata is available from the GW2 API to distinguish pet skills, tool belt skills, etc.? Need to audit the API response shape.
- Are there wiki naming conventions beyond the ones listed above? A quick audit of disambiguation pages would help.
- Should we batch prefix searches (MediaWiki `generator=prefixsearch`) instead of one request per title?
