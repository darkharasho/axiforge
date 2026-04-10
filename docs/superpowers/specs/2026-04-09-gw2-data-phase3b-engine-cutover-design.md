# @axi/gw2-data Phase 3b: Engine Cutover — Design Spec

## Goal

Make `@axi/gw2-data/engine` the sole stat computation path. Delete the old computation code from the renderer (~900 lines). Rewire UI-specific functions to call the engine via `engine-bridge.js`.

## Scope

Phase 3a validated that the engine produces identical results to the old code. Phase 3b removes the old code and makes the engine authoritative.

---

## Architecture

### engine-bridge.js — Production Bridge

`engine-bridge.js` becomes the production bridge (no longer dev-only). Changes:

**Delete:**
- `validateStatResult()` (lines 76–98)
- `validateBoonResult()` (lines 104–160)

**Add:**

#### `computeStats(state, assumedBoons, sigilStacks) → result`

Wraps `computeAttributes(ctx, catalogs)` from the engine. Returns the engine's full result object:

```js
{
  base: { Power: 1000, ... },
  equipment: { Power: 1205, ... },
  food: { ... },
  runes: { ... },
  infusions: { ... },
  enrichment: { ... },
  utility: { ... },
  signets: { ... },
  traits: { ... },
  conversions: { ... },
  boons: { ... },
  sigils: { ... },
  total: { Power: 3542, ... },
  derived: { health: 19212, critChance: 74.8, critDamage: 225.3, armor: 2514, ... },
}
```

#### `computeBoons(state, catalog, editor, weaponSkills) → { boons, conditions }`

Wraps `analyzeBoons()` from the engine. Returns boon/condition arrays in the same shape the renderer expects.

#### `computeCombos(state, catalog, editor, weaponSkills) → { fields, finishers }`

Wraps `analyzeCombos()` from the engine. Returns combo field/finisher arrays.

#### Retained from Phase 3a:
- `buildEngineCtx(state, assumedBoons, sigilStacks)` — state → ctx transform
- `buildEngineCatalogs(state)` — state → catalogs transform

---

### stats.js — Gut Core, Keep UI

**Delete (lines 34–629):**
- `collectActiveTraitIds()` (34–50)
- `computeTraitConversions()` (60–87)
- `isFuryTrait()` (92–107)
- `computeFuryCritModifier()` (109–130)
- `computeFuryStatBonuses()` (140–169)
- `computePassiveTraitBonuses()` (180–208)
- `computeMightPerStack()` (214–220)
- `getExcludedSlots()` (226–242)
- `computeSlotStats()` (244–269)
- `computeEquipmentStats()` (271–504)
- `computeBuildConcentration()` (512–629)

**Keep and rewire:**

#### `computeStatBreakdown(statKey, assumedBoons, sigilStacks)` (635–847)

This function builds a per-stat source breakdown for hover tooltips. It currently calls `computeEquipmentStats()` at lines 769 and 828 to get baseline values for percentage conversions.

Rewire: import `computeStats` from `engine-bridge.js` and call that instead. The engine returns a full breakdown by source category (equipment, food, traits, etc.), which `computeStatBreakdown()` can use directly.

Functions it calls that are being deleted:
- `computeEquipmentStats()` → replace with `computeStats()`
- `computeSlotStats()` → import from engine via bridge
- `computeMightPerStack()` → import from engine constants or compute from engine result
- `computeFuryStatBonuses()` → derive from engine result
- `computePassiveTraitBonuses()` → derive from engine result

#### `computeUpgradeModifiers()` (854–991)

This function collects percentage modifiers (Might Duration, Burst Recharge, etc.) from upgrades for display. It reads directly from `state.*` and the upgrade catalog — it does NOT call `computeEquipmentStats()`.

It does reference constants (`STACKING_SIGIL_DEFS`, `SIGNET_PASSIVE_BUFFS`) that are being moved to the engine. Rewire those imports.

#### Exported helper functions used by other renderer modules:

- `computeSlotStats()` — re-exported by `equipment.js`, used by `roleEstimator.js` and `equipment.js` for per-slot stat tooltips. Replace with a thin wrapper that calls the engine's `computeSlotStats(comboLabel, slotKey, weapons, gameMode)`.
- `computeFuryCritModifier()` — used by `equipment.js` for Fury crit % display. Replace with engine's `collectModifiers()` or compute from constants.
- `computeMightPerStack()` — used by `equipment.js` for Might per-stack display. Replace with engine constants.
- `computeBuildConcentration()` — used by `comp-boon-coverage.js` for party comp boon duration. Replace with a thin wrapper calling the engine.

---

### boon-coverage.js — Gut Core, Keep Party Wrapper

**Delete (lines 8–349):**
- `normalizeName()` (8–10)
- `isAllyTargeted()` (22–56)
- `extractBuffFacts()` (63–92)
- `extractComboFields()` (98–132)
- `extractComboFinishers()` (138–170)
- `collectSkillIds()` (172–223)
- `collectTraitIds()` (225–243)
- `computeBoonCoverage()` (245–349)

**Keep and rewire:**

#### `computePartyCoverage(catalog, editor, weaponSkills)` (356–426)

Currently calls `computeBoonCoverage()` at line 358. Rewire to call `computeBoons()` from `engine-bridge.js` for boon/condition data, and `computeCombos()` for combo fields/finishers. The rest of the party-level aggregation logic stays.

---

### constants.js — Delete Duplicates

Delete constants that now live in `@axi/gw2-data/engine/constants.js`:

| Constant | Line | Replacement |
|----------|------|-------------|
| `MIGHT_POWER_PER_STACK` | 548 | Import from engine |
| `MIGHT_CONDI_PER_STACK` | 549 | Import from engine |
| `FURY_CRIT_CHANCE` | 551 | Import from engine |
| `FURY_CRIT_CHANCE_WVW` | 552 | Import from engine |
| `STACKING_SIGIL_DEFS` | 559 | Import from engine |
| `STACKING_SIGIL_IDS` | 570 | Import from engine |
| `SIGNET_PASSIVE_BUFFS` | 575 | Import from engine |
| `BOON_NAMES` | 598 | Import from engine |
| `CONDITION_NAMES` | 603 | Import from engine |
| `CONDITION_NAME_NORMALIZE` | 610 | Import from engine |
| `BUFF_FACT_TYPES` | 545 | Import from engine |

**Keep (UI-only):**
- `BOON_CONDITION_ICONS` (506) — icon URLs for rendering
- `BOON_DISPLAY_ORDER` (615) — display ordering for UI

Consumers of deleted constants must update their imports. The renderer uses ES modules, so they'll import from `@axi/gw2-data/engine` via a re-export from `engine-bridge.js` or directly (using `import * as` for CJS interop).

---

### Call Site Updates

#### equipment.js

| Line | Current | New |
|------|---------|-----|
| 13 | `import { computeSlotStats, computeEquipmentStats, ... } from "./stats.js"` | Import `computeStats` from `engine-bridge.js`; keep `computeSlotStats` import (now a thin wrapper); keep `computeUpgradeModifiers`, `computeStatBreakdown` |
| 21 | `import { validateStatResult, validateBoonResult } from "./engine-bridge.js"` | `import { computeStats, computeBoons } from "./engine-bridge.js"` |
| 23 | `export { computeSlotStats, computeEquipmentStats, ... } from "./stats.js"` | Update re-exports to match new source |
| 316 | `computeEquipmentStats()` + validation guard | `computeStats(state)` (direct call, no guard) |
| 1050 | `computeBoonCoverage(...)` + validation guard | `computeBoons(state, catalog, editor, weaponSkills)` (direct call) |
| 1221 | `computeMightPerStack()` | Import constant from engine |
| 1235 | `computeFuryCritModifier(gm)` | Compute from engine or import helper |
| 1491 | `computeEquipmentStats(boons, sigils)` + validation guard | `computeStats(state, boons, sigils)` (direct call) |
| 1503 | `computeFuryCritModifier(gm)` | Same as 1235 |

#### detail-panel.js

| Line | Current | New |
|------|---------|-----|
| 6 | `import { validateStatResult } from "./engine-bridge.js"` | `import { computeStats } from "./engine-bridge.js"` |
| 92 | `computeEquipmentStats()` + validation guard | `computeStats(state)` |
| 379 | `computeEquipmentStats()` + validation guard | `computeStats(state)` |

#### skills.js

| Line | Current | New |
|------|---------|-----|
| 20 | `import { validateStatResult, validateBoonResult } from "./engine-bridge.js"` | `import { computeStats, computeBoons } from "./engine-bridge.js"` |
| 1058 | `computeBoonCoverage(...)` + validation guard | `computeBoons(state, catalog, editor, weaponSkills)` |
| 1778 | `computeEquipmentStats()` + validation guard | `computeStats(state)` |

#### comp-boon-coverage.js

| Line | Current | New |
|------|---------|-----|
| 14 | `import { computeBuildConcentration } from "../stats.js"` | Import thin wrapper from `stats.js` (which calls engine) |

#### roleEstimator.js

| Line | Current | New |
|------|---------|-----|
| 2 | `import { computeSlotStats } from './stats.js'` | No change needed — `computeSlotStats` stays exported from `stats.js` as a thin wrapper around the engine |

---

### CJS/ESM Interop

Same pattern as Phase 3a: `import * as engine from "@axi/gw2-data/engine"` in `engine-bridge.js`. All other renderer modules import from `engine-bridge.js` (ES module), never directly from the CJS package.

For constants, `engine-bridge.js` re-exports what the renderer needs:

```js
export const {
  MIGHT_POWER_PER_STACK,
  FURY_CRIT_CHANCE,
  // etc.
} = engine;
```

---

### What Changes vs. What Stays

| Component | Phase 3b Action |
|-----------|-----------------|
| `engine-bridge.js` | Remove validators, add `computeStats()`, `computeBoons()`, `computeCombos()`, constant re-exports |
| `stats.js` | Delete ~600 lines of core computation. Keep `computeStatBreakdown()`, `computeUpgradeModifiers()`, thin wrappers. Rewire to use engine |
| `boon-coverage.js` | Delete ~340 lines. Keep `computePartyCoverage()`. Rewire to use engine |
| `constants.js` | Delete ~70 lines of duplicated constants |
| `equipment.js` | Replace `computeEquipmentStats`/`computeBoonCoverage` calls with engine bridge calls. Remove validation guards |
| `detail-panel.js` | Replace calls, remove validation guards |
| `skills.js` | Replace calls, remove validation guards |
| `comp-boon-coverage.js` | Update `computeBuildConcentration` import |
| `roleEstimator.js` | No change (uses `computeSlotStats` which stays as thin wrapper) |

---

### Success Criteria

Phase 3b is complete when:
1. All `computeEquipmentStats()` and `computeBoonCoverage()` calls are replaced with engine bridge calls
2. Old computation code is deleted from `stats.js` and `boon-coverage.js`
3. Duplicated constants are deleted from `constants.js`
4. All validation guards (`process.env.NODE_ENV`) are removed
5. All 1554+ existing tests pass
6. Production build succeeds
7. Dev mode smoke test — app loads, stats display correctly
