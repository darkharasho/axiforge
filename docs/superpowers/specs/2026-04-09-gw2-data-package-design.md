# @axi/gw2-data Package Design

**Date:** 2026-04-09
**Status:** Draft
**Scope:** Extract axiforge's data pipeline into a standalone, community-facing npm package

## Problem

The GW2 API is inconsistent, missing balance splits, incomplete on facts, and unreliable as a sole data source. Axiforge has accumulated ~8 separate override systems and a fragile wiki scraper to compensate. Every API inconsistency becomes a manual whack-a-mole fix. This architecture doesn't scale, and the community lacks shared tooling for accurate GW2 data.

## Solution

Create `@axi/gw2-data` — a modular npm package that:

1. **Treats the GW2 Wiki as the source of truth** for fact values (damage coefficients, durations, ranges, buff counts, game mode splits)
2. **Uses the GW2 API for structural data** (skill/trait names, icons, descriptions, specialization trees, profession weapon mappings)
3. **Provides a stat computation engine** that produces tooltip-accurate values given a full build
4. **Lives in the axiforge monorepo** as a workspace package, extracted from existing code

## Architecture

### Monorepo Layout

```
axiforge/
├── packages/
│   └── gw2-data/                    # npm package: @axi/gw2-data
│       ├── package.json
│       ├── src/
│       │   ├── index.js             # Public API entry point
│       │   ├── wiki/                # Wiki data layer
│       │   │   ├── client.js        # Wiki API client (fetch wikitext via revisions API, sections via parse API)
│       │   │   ├── parser.js        # Template parser ({{skill fact}}, {{trait fact}})
│       │   │   ├── relations.js     # Related skills/traits graph builder
│       │   │   └── cache.js         # Pluggable cache (memory, disk, custom)
│       │   ├── api/                 # GW2 API layer (structural data)
│       │   │   ├── client.js        # GW2 API client (skills, traits, specs, etc.)
│       │   │   └── types.js         # Shared type definitions / JSDoc
│       │   ├── facts/               # Fact resolution
│       │   │   ├── merge.js         # Merge API structure + wiki values
│       │   │   ├── match.js         # Fact matching algorithm (from balance-splits)
│       │   │   └── normalize.js     # Fact type normalization
│       │   └── engine/              # Stat computation engine
│       │       ├── modifiers.js     # Modifier stack (auto-derived + manual)
│       │       ├── attributes.js    # Full attribute calculation (base → derived)
│       │       ├── tooltips.js      # Apply modifiers → final tooltip values
│       │       ├── graph.js         # Trait/skill interaction graph
│       │       ├── combos.js        # Combo field/finisher analyzer
│       │       ├── boons.js         # Boon/condition coverage analyzer
│       │       └── overrides.js     # Manual encodings for complex interactions
│       ├── data/
│       │   └── overrides.json       # Manual trigger conditions (small, community-contributable)
│       └── tests/
├── src/                             # Axiforge app (existing)
└── package.json                     # Workspace root: { "workspaces": ["packages/*", "."] }
```

### Module Responsibilities

**`wiki/`** — Data acquisition from GW2 Wiki and GW2 API.

- `client.js`: Fetches wikitext via `action=query&prop=revisions&rvprop=content` (batch-capable) and `action=parse&prop=sections` for targeted section access. Handles redirects, normalization, rate limiting.
- `parser.js`: Parses `{{skill fact|...}}` and `{{trait fact|...}}` templates from raw wikitext. Extracts game-mode-specific values (`game mode=wvw`), coefficients, infobox parameter fallbacks. Handles template nesting (`{{fraction|N}}`), wiki markup stripping, range validation.
- `relations.js`: Parses "Related skills" and "Related traits" wiki sections to build an interaction graph (trait X affects skills Y, Z).
- `cache.js`: Defines a cache interface with `get(key)`, `set(key, value, ttl)`, `invalidate(key)`. Ships with memory and disk implementations. Consumers can provide custom adapters (SQLite, Redis, etc.).

**`api/`** — GW2 API structural data.

- `client.js`: Fetches from `/v2/skills`, `/v2/traits`, `/v2/specializations`, `/v2/professions`, `/v2/legends`, `/v2/pets`, `/v2/items`. Request queuing (max 3 concurrent), batch by IDs (up to 180/request), retry with exponential backoff on 429/5xx.
- `types.js`: JSDoc type definitions for skills, traits, facts, specializations, etc.

**`facts/`** — Merging and resolution.

- `merge.js`: Combines API skeleton + wiki fact values. Rule: wiki is authoritative for values (numbers, durations, coefficients), API is authoritative for structure (labels, types, ordering, icons). For complete splits, API-only facts are dropped. For partial splits, API-only facts pass through.
- `match.js`: Three-pass fuzzy fact matching algorithm (extracted from existing `lib/gw2-balance-splits/match.js`). Pass 1: exact text + normalized type. Pass 1.5: cross-type exact text. Pass 2: type-group positional. Pass 3: keyword overlap.
- `normalize.js`: Fact type normalization (e.g., wiki type names → API type names), unit conversion, markup stripping.

**`engine/`** — Stat computation and analysis.

- `modifiers.js`: Collects modifiers from active traits by parsing their resolved facts. Auto-derives flat bonuses, percentage modifiers, attribute conversions. Checks `overrides.json` for trigger conditions on complex interactions. Consults the relations graph to determine what each modifier applies to.
- `attributes.js`: Computes full attribute breakdown from a build definition. Input: profession, equipment (stat combos, runes, sigils, food, infusions), active traits, game mode. Output: itemized stats (base, equipment, traits, conversions, food) + totals + derived stats (health, crit chance, crit damage, boon duration, condition duration, effective power).
- `tooltips.js`: Given a build context and a skill/trait ID, applies the modifier stack to produce the exact tooltip value. Factors in weapon strength, crit multiplier, applicable trait modifiers.
- `graph.js`: Trait/skill interaction graph built from wiki "Related" sections. Edges represent "trait X modifies skill/trait Y." Used by `modifiers.js` to scope modifier application.
- `combos.js` (`ComboAnalyzer`): Extracts combo fields and finishers from resolved skill/trait facts. Per-build analysis and party-level aggregation (field type → count + sources, finisher type → count + sources with hit count and proc chance).
- `boons.js` (`BoonAnalyzer`): Extracts boon/condition application from resolved facts. Classifies as ally-targeted vs self-only (heuristic from description text + overrides). Per-build and party-level aggregation with concentration bonus applied.
- `overrides.js`: Loads and applies `data/overrides.json` — manual trigger condition encodings for traits whose activation conditions can't be parsed from fact text (e.g., "after using a burst skill", "while above 90% health").

**`data/overrides.json`** — The manual layer. Contains only trigger conditions, not values (values always come from wiki). Structure:

```json
{
  "trait:1444": {
    "condition": "afterBurst",
    "description": "Peak Performance: applies after using a burst skill"
  },
  "trait:2220": {
    "allyTargeted": ["elixir"],
    "description": "Twisted Medicine: elixir skills become ally-targeted"
  }
}
```

Small, readable, community-contributable. Trigger conditions rarely change on balance patches — values do, and those come from wiki automatically.

## Data Flow

### Entity Resolution Pipeline

```
Consumer calls: getSkill(id, { mode: 'wvw' })
        │
        v
1. STRUCTURAL FETCH (GW2 API)
   → skill skeleton: name, icon, description, slot, specialization, raw facts[]
   → cache-first, 24hr TTL
        │
        v
2. WIKI FACT RESOLVE (Wiki API)
   → fetch wikitext for skill page
   → parse {{skill fact}} templates
   → extract facts per game mode (pve/wvw/pvp) + coefficients
   → cache-first, background refresh via recentchanges
        │
        v
3. FACT MERGE
   → API skeleton + wiki values = resolved entity
   → wiki wins on values, API wins on structure
   → facts not present in wiki for requested mode: dropped (complete) or kept (partial)
        │
        v
4. RELATION GRAPH (Wiki "Related" sections)
   → parse related skills/traits
   → build interaction edges: trait X modifies skill/trait Y
        │
        v
   Resolved Entity (ready for display or engine computation)
```

### Staleness Prevention

The wiki exposes `action=query&list=recentchanges&rcnamespace=0` — returns pages edited since a given timestamp.

**Refresh strategy (configurable by consumer):**
- On init / app launch: check recentchanges since last fetch timestamp
- Invalidate only stale cache entries (pages that were edited)
- Re-parse only those entities
- Periodic background refresh (default: every 4 hours, configurable)

This keeps refresh fast even with thousands of cached entities — only changed pages are re-fetched.

### Stat Computation Flow

```
BUILD CONTEXT
  - Profession
  - Selected specializations + trait choices (3 lines × 3 majors + 3 minors)
  - Equipment stats (stat combos, runes, sigils, food, infusions)
  - Game mode (pve/wvw/pvp)
  - Active buffs (optional: Fury, Might stacks, etc.)
        │
        v
1. COLLECT MODIFIERS
   For each active trait:
   a. Parse resolved facts → auto-derive modifiers (flat bonuses, % buffs, conversions)
   b. Check relations graph → scope what this trait affects
   c. Check overrides.json → trigger conditions for complex interactions
        │
        v
2. BUILD MODIFIER STACK
   Ordered by GW2's application order:
   - Flat stat bonuses
   - % stat conversions (attribute → attribute)
   - % damage modifiers
   - Buff/condition modifiers
        │
        v
3. COMPUTE
   Attributes: base + equipment + traits + conversions + food → totals + derived
   Tooltips: coefficient × weapon strength × effective power × applicable modifiers
   Combos: extract fields/finishers from resolved facts, aggregate per party
   Boons: extract buff/condition grants, classify ally/self, aggregate with concentration
```

## Public API

### Wiki Data Layer

```js
import { WikiClient } from '@axi/gw2-data/wiki'

const wiki = new WikiClient({
  cache: 'disk',           // 'memory' | 'disk' | custom CacheAdapter
  cacheTTL: 4 * 60 * 60,  // seconds (default: 4 hours)
  autoRefresh: true        // check recentchanges on init
})

await wiki.refresh()       // pull changes since last fetch

// Resolved entities (API structure + wiki values)
const skill = await wiki.getSkill(5489, { mode: 'wvw' })
const trait = await wiki.getTrait(1444, { mode: 'pve' })
const skills = await wiki.getSkills([5489, 5490, 5491], { mode: 'wvw' })
const traits = await wiki.getTraits([1444, 1449], { mode: 'pve' })

// Raw access for advanced consumers
const wikitext = await wiki.getWikitext('Fireball')
const relations = await wiki.getRelations('Peak Performance')
```

### Stat Computation Engine

```js
import { StatEngine } from '@axi/gw2-data/engine'

const engine = new StatEngine(wiki)

const build = {
  profession: 'Warrior',
  specializations: [
    { id: 4, traits: [1444, 1449, 1437] },
    { id: 36, traits: [1413, 1489, 1369] },
    { id: 18, traits: [2049, 2011, 1928] }
  ],
  equipment: { power: 2500, precision: 1800, ferocity: 800, /* ... */ },
  rune: { id: 24836 },
  sigils: [{ id: 24615 }, { id: 24868 }],
  food: { id: 91805 },
  mode: 'wvw'
}

// Full attribute breakdown
const attributes = engine.computeAttributes(build)
// → {
//   base: { power: 1000, precision: 1000, toughness: 1000, vitality: 1000 },
//   equipment: { power: 1500, precision: 800, ferocity: 800, ... },
//   traits: { power: 150, vitality: 200, ... },
//   conversions: { power: 85, ... },
//   food: { power: 100, ... },
//   total: { power: 2835, precision: 1800, ... },
//   derived: {
//     health: 15922,
//     critChance: 43.1,
//     critDamage: 203.3,
//     boonDuration: 22.5,
//     conditionDuration: 15.0,
//     effectivePower: 8421
//   }
// }

// Tooltip value for a specific skill
const tooltip = engine.computeTooltip(build, 5489)
// → { damage: 4521, coefficient: 0.75, hits: 1, modifiers: [...applied] }

// Modifier stack inspection
const modifiers = engine.getModifiers(build)
// → [{ source: 'trait:1444', type: 'strikeDamage', value: 1.20, condition: 'afterBurst' }, ...]
```

### Combo Analyzer

```js
import { ComboAnalyzer } from '@axi/gw2-data/engine'

// Per-build
const combos = ComboAnalyzer.analyze(resolvedSkills, resolvedTraits)
// → {
//   fields: [{ type: 'Fire', source: 'Flame Wall', duration: 5, radius: 240 }],
//   finishers: [{ type: 'Blast', source: 'Mighty Blow', percent: 100, hitCount: 1 }]
// }

// Party-level aggregation
const partyCombos = ComboAnalyzer.aggregateParty([build1, build2, build3, build4, build5])
// → { fields: Map<type, { count, sources[] }>, finishers: Map<type, { count, sources[] }> }
```

### Boon Analyzer

```js
import { BoonAnalyzer } from '@axi/gw2-data/engine'

// Per-build
const coverage = BoonAnalyzer.analyze(build, resolvedSkills, resolvedTraits)
// → {
//   boons: [{ name: 'Might', stacks: 3, duration: 8, allyTargeted: true, source: 'For Great Justice!' }],
//   conditions: [{ name: 'Bleeding', stacks: 2, duration: 6, source: 'Sword of Justice' }]
// }

// Party-level with concentration
const partyCoverage = BoonAnalyzer.aggregateParty(builds, { concentration: true })
// → { boons: Map<name, { count, providers[], effectiveDuration }> }
```

## Axiforge Integration

### Migration Strategy

Extract and replace module-by-module. Each swap is an independent PR. Axiforge consumes `@axi/gw2-data` as a workspace dependency.

| Current axiforge file | Replaced by | Migration order |
|---|---|---|
| `src/main/gw2Data/wiki.js` | `@axi/gw2-data/wiki` | Phase 1 |
| `src/main/gw2Data/fetch.js` | `@axi/gw2-data/wiki` (internal API client) | Phase 1 |
| `lib/gw2-balance-splits/` | `@axi/gw2-data/wiki` + `@axi/gw2-data/facts` | Phase 1 |
| `src/main/gw2Data/overrides.js` | `@axi/gw2-data/facts` + `data/overrides.json` | Phase 2 |
| `src/main/gw2Data/catalog.js` (fact merging) | `@axi/gw2-data/facts` | Phase 2 |
| `src/main/statsCompute.js` | `@axi/gw2-data/engine` | Phase 3 |
| `src/renderer/modules/stats.js` (trait conversions) | `@axi/gw2-data/engine` | Phase 3 |
| `src/renderer/modules/boon-coverage.js` (extraction) | `@axi/gw2-data/engine` BoonAnalyzer | Phase 3 |
| `src/renderer/modules/boon-coverage.js` (combos) | `@axi/gw2-data/engine` ComboAnalyzer | Phase 3 |

### What stays in axiforge

- `catalog.js` — assembles profession catalogs, but delegates fact resolution to the package
- `detail-panel.js` — renders tooltip HTML from engine-computed values
- `equipment.js` — UI panel for equipment selection
- All renderer UI code — the package is data + computation only, no rendering
- Comp manager UI — calls `BoonAnalyzer`/`ComboAnalyzer` from package, renders results itself

## Modifier Auto-Derivation

The engine minimizes manual encoding by automatically deriving modifiers from wiki fact data:

| Fact pattern | Auto-derived modifier | Example |
|---|---|---|
| `+N Attribute` | Flat stat bonus | `+150 Power` |
| `N% of X to Y` | Attribute conversion | `13% Vitality → Power` |
| `+N% damage` | Damage multiplier | `+20% strike damage` |
| `Duration: Ns` | Buff/condition duration | `Fury (5s)` |
| `N stacks` | Stack modifier | `3× Might` |
| `Coefficient: N` | Damage scaling | `0.75 coefficient` |

The **relations graph** (from wiki "Related skills/traits" sections) scopes which modifiers apply to which skills. If trait X lists skill Y as related and trait X has a damage modifier, the engine applies that modifier when computing skill Y's tooltip.

**Manual overrides (`overrides.json`)** are only needed for trigger conditions that can't be parsed from fact text:
- "after using a burst skill"
- "while above 90% health"
- "while in Celestial Avatar"
- "on critical hit"

Values always come from wiki. Trigger conditions rarely change on balance patches. This makes `overrides.json` small, stable, and community-contributable.

## Design Decisions

1. **Wiki as source of truth for values, not structure.** The wiki doesn't cleanly model which professions have which skills, trait tree layouts, or specialization assignments. The API handles this well. The wiki excels at accurate, up-to-date numeric values and game mode splits.

2. **Wikitext parsing, not rendered HTML.** The wiki API serves raw wikitext cleanly via `action=query&prop=revisions&rvprop=content`. Game mode splits and coefficients only exist in wikitext templates, not rendered output. This is more reliable than Playwright-based DOM scraping.

3. **Pluggable cache with smart invalidation.** Different consumers have different staleness tolerances. The wiki's `recentchanges` API enables efficient targeted invalidation instead of full re-fetches.

4. **Monorepo extraction, not clean-room rewrite.** Axiforge has battle-tested parsing and matching logic. Extracting it preserves that investment while enabling iterative improvement. Axiforge benefits from day one.

5. **Single package with modular imports.** One `@axi/gw2-data` package, but consumers import only what they need (`/wiki`, `/engine`, or both). Simpler to maintain than separate packages, flexible enough for different use cases.

6. **Minimal manual override surface.** By auto-deriving modifiers from facts and scoping via the relations graph, the manual layer is limited to trigger conditions (~10-15% of traits). This dramatically reduces maintenance burden on balance patches.

## Out of Scope

- **DPS simulation / rotation modeling** — the engine answers "what number appears on this tooltip," not "what's my DPS over a rotation"
- **Proc rate estimation** — no modeling of "on critical hit" frequency
- **UI rendering** — the package provides data and computation, axiforge handles display
- **Real-time game integration** — no mumble link, no live stat reading
