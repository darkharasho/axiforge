# @axi/gw2-data Phase 2: Stat Computation Engine

**Date:** 2026-04-09
**Status:** Approved
**Depends on:** Phase 1 (wiki parser, API client, fact merging) — merged to main

## Goal

Extract the stat computation logic from axiforge's renderer modules into `packages/gw2-data/src/engine/` as pure, state-free functions. The engine accepts a build context and catalog data, returns computed attributes, tooltip values, modifier stacks, boon coverage, and combo analysis.

## Approach

**Extract and decouple** the existing battle-tested code from `src/renderer/modules/stats.js` (991 lines), `src/renderer/modules/boon-coverage.js` (426 lines), and `src/renderer/modules/constants.js` (669 lines). Replace all `state.*` references with explicit function parameters. Preserve the proven math — formulas have edge cases (Celestial WvW exclusion, Notoriety Might, pet trait exclusion, underwater slot filtering) that are easy to miss in a rewrite.

## Architecture

### New files in `packages/gw2-data/src/engine/`

```
engine/
  constants.js    — Static GW2 game data (stat combos, slot weights, etc.)
  attributes.js   — Full attribute calculation pipeline
  modifiers.js    — Trait modifier collection and classification
  tooltips.js     — Skill tooltip value computation
  graph.js        — Trait/skill interaction graph (wraps Phase 1 relations)
  boons.js        — Boon/condition coverage analyzer
  combos.js       — Combo field/finisher analyzer
  overrides.js    — Load and apply data/overrides.json
  index.js        — StatEngine wrapper class + re-exports
```

### Build Context Object

Every engine function accepts a build context instead of reading global state:

```js
const ctx = {
  profession: "Warrior",
  specializations: [
    { id: 4, majorChoices: { 1: 1444, 2: 1449, 3: 1437 } },
    { id: 36, majorChoices: { 1: 1413, 2: 1489, 3: 1369 } },
    { id: 18, majorChoices: { 1: 2049, 2: 2011, 3: 1928 } },
  ],
  equipment: {
    slots: { head: "Berserker's", chest: "Berserker's", /* ... all 15 */ },
    weapons: { mainhand1: "greatsword", offhand1: null, mainhand2: "sword", offhand2: "torch" },
    runes: { head: 24836, shoulders: 24836, /* ... 6 armor slots */ },
    infusions: { head: [49431], back: [49431, 49431], /* ... */ },
    enrichment: 91805,
    food: 91805,
    utility: 8675,
  },
  gameMode: "wvw",
  underwaterMode: false,
  activeWeaponSet: 1,
  skills: { healId: 14401, utilityIds: [14405, 14407, 14409], eliteId: 14419 },
  assumedBoons: { might: 25, fury: true },
  sigilStacks: { bloodlust: 25 },
}
```

### Catalog Object

GW2 API structural data, passed separately from build context:

```js
const catalogs = {
  traitById: Map<number, { id, name, facts[], ... }>,
  skillById: Map<number, { id, name, facts[], description, ... }>,
  specializationById: Map<number, { id, name, minorTraits[], ... }>,
  runeById: Map<number, { name, bonuses[], ... }>,
  foodById: Map<number, { name, buff: string, ... }>,
  utilityById: Map<number, { name, buff: string, ... }>,
  infusionById: Map<number, { name, infixUpgrade: { attributes[] }, ... }>,
  enrichmentById: Map<number, { name, infixUpgrade: { attributes[] }, ... }>,
}
```

## Module Details

### 1. `constants.js` — Static Game Data

Extracted from `src/renderer/modules/constants.js`. Contains:

- **Stat combos**: 45+ preset combinations with stat arrays (Berserker's, Celestial, etc.)
- **Slot weights**: Per-slot stat multipliers (major, minor, celestial, 4-stat variants)
- **Two-handed weapon weights**: Override weights for 2H weapons
- **Profession base HP**: Per-profession health pools
- **Weapon strength midpoints**: Per-weapon-type average weapon strength
- **WvW Celestial exclusions**: Expertise and Concentration stripped from Celestial in WvW
- **Land/aquatic slot sets**: For underwater mode filtering
- **Stacking sigil definitions**: Stat per stack, max stacks
- **Boon/condition name lists**: For classification
- **Boon display order**: GW2 canonical sequence

Source: `STAT_COMBOS_BY_LABEL`, `SLOT_WEIGHTS`, `TWO_HAND_WEIGHTS`, `LAND_ONLY_SLOTS`, `AQUATIC_SLOTS`, `MIGHT_POWER_PER_STACK`, `MIGHT_CONDI_PER_STACK`, `STACKING_SIGIL_DEFS`, `GW2_WEAPONS_BY_ID`, `SIGNET_PASSIVE_BUFFS`, `BOON_NAMES`, `CONDITION_NAMES`, `BOON_DISPLAY_ORDER`, `PROFESSION_BASE_HP`.

### 2. `attributes.js` — Attribute Calculation Pipeline

**Source functions:**
- `computeEquipmentStats()` from `stats.js:271-505`
- `computeTraitConversions()` from `stats.js:60-87`
- `computePassiveTraitBonuses()` from `stats.js:180-208`
- `computeFuryStatBonuses()` from `stats.js:140-169`
- `computeFuryCritModifier()` from `stats.js:109-130`
- `computeMightPerStack()` from `stats.js:214-220`
- `computeSlotStats()` from `stats.js:244-269`
- Derived stat formulas from `equipment.js` (health, crit chance, crit damage, boon duration, condition duration, armor)

**Public API:**

```js
computeAttributes(ctx, catalogs) → {
  base: { Power: 1000, Precision: 1000, Toughness: 1000, Vitality: 1000, ... },
  equipment: { Power: 1500, Precision: 800, ... },
  runes: { Power: 175, ... },
  infusions: { Power: 90, ... },
  food: { Power: 100, ... },
  utility: { Power: 85, ... },
  signets: { Power: 180, ... },
  traits: { Power: 150, Vitality: 200, ... },
  conversions: { Power: 85, ... },
  boons: { Power: 750, ConditionDamage: 750, ... },
  sigils: { Power: 250, ... },
  total: { Power: 3190, Precision: 2100, ... },
  derived: {
    health: 26222,
    critChance: 62.4,
    critDamage: 220.0,
    boonDuration: 15.0,
    conditionDuration: 22.5,
    armor: 2271,
  },
}
```

**Calculation order** (matches existing `computeEquipmentStats`):
1. Base stats (1000 each for primary attributes)
2. Equipment slots (stat combo × slot weight, respecting 2H/underwater/active weapon set)
3. Food flat bonuses (parse `+N Stat` from buff text)
4. Rune bonuses (cumulative per piece, parse `+N Stat` from bonus lines)
5. Infusion/enrichment bonuses (API `infixUpgrade.attributes`)
6. Utility consumable bonuses (conversions, writs, flat)
7. Signet passive buffs (from constants lookup)
8. Passive trait flat bonuses (AttributeAdjust facts, non-Fury, respecting overrides)
9. Trait attribute conversions (BuffConversion facts: `floor(sourceVal * percent / 100)`)
10. Assumed boon contributions (Might stacks, Fury stat bonuses)
11. Stacking sigil contributions
12. Derived stats (health, crit, armor, durations)

**Edge cases preserved:**
- Celestial WvW: exclude Expertise and Concentration from stat array
- Pet stat traits: skip AttributeAdjust facts from traits in overrides `petStatOnly` list
- Notoriety: modify Might per-stack values (+40P/+20CD instead of +30P/+30CD)
- Implicit fury traits: treat as fury-gated even without Buff(Fury) fact
- Game mode indexing: when multiple AttributeAdjust facts exist for same target, index [0]=PvE, [1]=WvW

### 3. `modifiers.js` — Modifier Collection

**Source functions:**
- `collectActiveTraitIds()` from `stats.js:34-50`
- `isFuryTrait()` from `stats.js:92-95`
- Modifier classification logic implicit in existing trait processing

**Public API:**

```js
collectModifiers(ctx, catalogs, overrides) → [
  { source: "trait:1444", type: "flatBonus", target: "Power", value: 150, condition: null },
  { source: "trait:1719", type: "flatBonus", target: "Ferocity", value: 180, condition: "fury" },
  { source: "trait:214", type: "conversion", source_attr: "Power", target: "Ferocity", percent: 13, condition: null },
  { source: "trait:1444", type: "critChance", value: 15, condition: "fury" },
  { source: "trait:1765", type: "mightModifier", power: 40, condi: 20, condition: null },
]

collectActiveTraitIds(ctx, catalogs) → Set<number>
```

**Modifier types:**
- `flatBonus` — AttributeAdjust fact → flat stat increase
- `conversion` — BuffConversion fact → % of source attr added to target
- `critChance` — Percent fact with "Critical Chance Increase" text
- `damageMultiplier` — Percent fact with damage-related text
- `mightModifier` — Override for Notoriety-style Might changes
- `petStatOnly` — Flagged via overrides, excluded from player computation

### 4. `tooltips.js` — Tooltip Value Computation

**Public API:**

```js
computeTooltip(ctx, catalogs, skillId, modifiers) → {
  damage: 4521,
  coefficient: 0.75,
  hits: 1,
  weaponStrength: 1100,  // midpoint for equipped weapon type
  effectivePower: 3190,
  critMultiplier: 1.62,
  modifiers: [{ source: "trait:1444", type: "damageMultiplier", value: 1.20 }],
}
```

**Formula:**
```
damage = coefficient × weaponStrength × effectivePower / targetArmor
effectivePower = Power × (1 + critChance/100 × (critDamage/100 - 1)) × damageModifiers
```

Weapon strength comes from `constants.js` weapon midpoints, keyed by the weapon type equipped in the active weapon set.

### 5. `graph.js` — Interaction Graph

Wraps Phase 1's `relations.js` to build a scoped modifier application graph.

**Public API:**

```js
buildInteractionGraph(activeTraitIds, wikiClient) → Map<traitId, {
  relatedSkills: Set<skillId>,
  relatedTraits: Set<traitId>,
}>
```

Used by `modifiers.js` to determine which skills a trait's damage modifier applies to. If a trait has no relations data, its modifiers are treated as global (apply to all skills).

### 6. `boons.js` — Boon/Condition Coverage

**Source functions:**
- `computeBoonCoverage()` from `boon-coverage.js`
- `isAllyTargeted()` from `boon-coverage.js:22-55`
- `extractBuffFacts()` from `boon-coverage.js`
- `normalizeName()` from `boon-coverage.js`

**Public API:**

```js
analyzeBoons(skills, traits, overrides) → {
  boons: [
    { name: "Might", stacks: 3, duration: 8, allyTargeted: true, source: "For Great Justice!" },
  ],
  conditions: [
    { name: "Burning", stacks: 2, duration: 3, source: "Sword of Justice" },
  ],
}
```

**Ally classification** (preserved from existing heuristic):
1. If boon name appears in description sentence with "allies/ally" → ally
2. If boon appears in description but not in ally sentence → self
3. If boon not named but description has generic ally mention → ally (unless other specific boons claimed)
4. No ally mention → self
5. Override: Twisted Medicine (trait 2220) makes Elixir skills ally-targeted

### 7. `combos.js` — Combo Field/Finisher Analysis

**Source functions:**
- `extractComboFields()` from `boon-coverage.js`
- `extractComboFinishers()` from `boon-coverage.js`

**Public API:**

```js
analyzeCombos(skills, traits) → {
  fields: [{ type: "Fire", source: "Flame Wall", duration: 5, radius: 240 }],
  finishers: [{ type: "Blast", source: "Mighty Blow", percent: 100, hitCount: 1 }],
}
```

Deduplicates by (type, source name). Groups finishers by type. Pulls duration/radius from adjacent Duration/Radius facts on the same skill.

### 8. `overrides.js` — Manual Override Layer

Loads `data/overrides.json` and provides lookup functions.

**Initial `overrides.json` content** (migrated from hardcoded constants):

```json
{
  "trait:1719": {
    "implicitFury": true,
    "description": "Roiling Mists: has fury crit bonus but no Buff(Fury) fact in API"
  },
  "trait:1016": {
    "petStatOnly": true,
    "description": "Fang and Claw: AttributeAdjust facts apply to pets, not player"
  },
  "trait:1765": {
    "mightOverride": { "power": 40, "condi": 20 },
    "description": "Notoriety: modifies Might per-stack values"
  },
  "trait:2220": {
    "allyTargeted": ["elixir"],
    "description": "Twisted Medicine: elixir skills become ally-targeted"
  }
}
```

**Public API:**

```js
loadOverrides() → Map<string, Override>
getOverride(entityKey) → Override | null
```

### 9. `engine/index.js` — StatEngine Wrapper

Convenience class that wires the modules together:

```js
class StatEngine {
  constructor(catalogs, overrides)
  computeAttributes(ctx) → AttributeBreakdown
  computeTooltip(ctx, skillId) → TooltipResult
  collectModifiers(ctx) → Modifier[]
  analyzeBoons(ctx) → BoonResult
  analyzeCombos(ctx) → ComboResult
}
```

## Testing Strategy

### 1. Unit tests per module

Pure function tests for each module. Cover every edge case already encoded in the existing code:
- Celestial WvW stat exclusion
- Notoriety Might modification
- Pet trait exclusion
- Underwater slot filtering
- Two-handed weapon weight override
- Fury-gated vs passive trait separation
- Game mode fact indexing (PvE [0] vs WvW [1])
- Attribute conversion rounding (`floor`)
- Food/rune/utility text parsing patterns
- Ally classification heuristic edge cases
- Combo deduplication

### 2. Snapshot regression tests

Capture the existing renderer's computation results for representative builds:
- Power DPS Warrior (Berserker's, all offensive)
- Condi DPS (Viper's, expertise stacking)
- Healer (Minstrel's/Harrier's, concentration + healing power)
- Celestial build (9-stat, WvW exclusion)
- Mixed 4-stat (Diviner's, Commander's)
- Underwater build (aquatic weapon set)
- Build with assumed boons (25 Might + Fury)
- Build with signet passives
- Build with stacking sigils

Run the existing `stats.js` functions in a test harness to capture expected outputs. Then verify the extracted package produces identical results for each build.

### 3. Real-data integration tests

Extend Phase 1 fixtures. For skills with known damage coefficients, verify the tooltip engine produces correct values given a build context.

## Implementation Order

1. Constants extraction
2. Overrides (small, needed by other modules)
3. Attributes (core stat pipeline, biggest module)
4. Modifiers (trait fact parsing)
5. Tooltips (depends on attributes + modifiers)
6. Graph (wraps Phase 1 relations)
7. Boons (extracted from boon-coverage.js)
8. Combos (extracted from boon-coverage.js)
9. Public API (StatEngine wrapper, index.js exports)

Each step gets unit tests before moving to the next. Snapshot regression tests are built after attributes + modifiers are complete.

## What This Does NOT Include

- **Phase 3 migration**: Swapping axiforge's renderer to consume the package (separate phase)
- **DPS simulation**: Engine answers "what number appears on this tooltip," not "what's my DPS over a rotation"
- **Proc rate estimation**: No modeling of "on critical hit" frequency
- **UI rendering**: Package is data + computation only
