# @axi/gw2-data Phase 3: Engine Wiring — Design Spec

## Goal

Wire the Phase 2 stat computation engine (`@axi/gw2-data/engine`) into axiforge's renderer alongside the existing `state.*`-dependent code. Validate results match via dev-mode assertions and snapshot fixtures. Once validated, Phase 3b removes the old code.

## Approach: Parallel Wiring + Validation

Phase 3 is split into two sub-phases:

- **Phase 3a**: Add adapter layer, wire engine in parallel at every call site, compare results, log mismatches. Zero production impact — all comparison code is gated behind `process.env.NODE_ENV !== 'production'`.
- **Phase 3b**: Once validated (no mismatches observed), delete old computation code from `stats.js` and `boon-coverage.js`, make engine the sole computation path.

This spec covers **Phase 3a only**. Phase 3b is a follow-up once 3a is validated.

---

## Architecture

### Adapter Module

**New file: `src/renderer/modules/engine-bridge.js`**

This is the only file that knows about both the renderer's `state.*` shapes and the engine's `ctx`/`catalogs` shapes. It provides:

#### `buildEngineCtx(state) → ctx`

Transforms `state.editor` into the engine's build context shape:

```js
{
  profession: state.editor.profession,
  specializations: state.editor.specializations.map(s => ({
    id: s.specializationId || s.id,
    specializationId: s.specializationId,
    majorChoices: s.majorChoices || {},
  })),
  equipment: {
    slots: state.editor.equipment?.slots || {},
    weapons: state.editor.equipment?.weapons || {},
    runes: state.editor.equipment?.runes || {},
    infusions: state.editor.equipment?.infusions || {},
    enrichment: state.editor.equipment?.enrichment || null,
    food: state.editor.equipment?.food || null,
    utility: state.editor.equipment?.utility || null,
  },
  gameMode: state.editor.gameMode || "pve",
  underwaterMode: state.editor.underwaterMode || false,
  activeWeaponSet: state.editor.activeWeaponSet || 1,
  skills: state.editor.underwaterMode ? state.editor.underwaterSkills : state.editor.skills,
  assumedBoons: null,  // overridden per call site
  sigilStacks: null,   // overridden per call site
}
```

#### `buildEngineCatalogs(state) → catalogs`

Merges `state.activeCatalog` and `state.upgradeCatalog` into the engine's catalogs shape:

```js
{
  traitById: state.activeCatalog?.traitById || new Map(),
  skillById: state.activeCatalog?.skillById || new Map(),
  specializationById: state.activeCatalog?.specializationById || new Map(),
  runeById: state.upgradeCatalog?.runeById || new Map(),
  foodById: state.upgradeCatalog?.foodById || new Map(),
  utilityById: state.upgradeCatalog?.utilityById || new Map(),
  infusionById: state.upgradeCatalog?.infusionById || new Map(),
  enrichmentById: state.upgradeCatalog?.enrichmentById || new Map(),
}
```

#### `validateStatResult(oldTotals, state, label, assumedBoons, sigilStacks)`

Runs engine computation, deep-compares `oldTotals` against `engine.total`, logs mismatches:

```
[ENGINE-MISMATCH] equipment.js:renderStats — Power: old=3542, new=3542 ✓ | Precision: old=2105, new=2100 ✗
```

Only runs when `process.env.NODE_ENV !== 'production'`.

#### `validateBoonResult(oldResult, state, label, catalog, editor, weaponSkills)`

Runs engine boon analysis, compares boon/condition names and source counts. Logs mismatches.

Only runs when `process.env.NODE_ENV !== 'production'`.

---

### Dev-Mode Assertion Pattern

At each call site, we add a validation call after the existing computation:

```js
// Existing code — unchanged:
const computed = computeEquipmentStats(assumedBoons, sigilStacks);

// New validation (dev-mode only):
if (process.env.NODE_ENV !== 'production') {
  import('./engine-bridge.js').then(({ validateStatResult }) => {
    validateStatResult(computed, state, 'equipment.js:renderStats', assumedBoons, sigilStacks);
  });
}
```

The `process.env.NODE_ENV` guard ensures the validation code is dead-code-eliminated in production builds. The validation is async and non-blocking — it doesn't affect the render path.

---

### Call Sites to Instrument

#### Stat Computation (`computeEquipmentStats`)

| File | Line | Context | Notes |
|------|------|---------|-------|
| `equipment.js` | ~1484 | `renderEquipmentPanel()` | Has `_assumedBoons` and `_sigilStacks` params |
| `equipment.js` | ~315 | `updateHealthOrb()` | No params (defaults) |
| `detail-panel.js` | ~91 | Skill damage rendering | No params |
| `detail-panel.js` | ~375 | Skill damage rendering | No params |
| `skills.js` | ~1774 | HP display | No params |

#### Boon Coverage (`computeBoonCoverage`)

| File | Line | Context | Notes |
|------|------|---------|-------|
| `skills.js` | ~1057 | `_renderBoonCoverage()` | Has `catalog, editor, weaponSkills` |
| `equipment.js` | ~1046 | Weapon skill panel | Has `catalog, editor, weaponSkills` |

#### Not Instrumented (out of scope)

- `stats.js:769,828` — Internal recursive calls within `computeUpgradeModifiers` and `computeStatBreakdown`. These are UI-specific breakdown functions, not core computation. They'll be addressed in Phase 3b.
- `comp-boon-coverage.js` — Party-level aggregation. Stays in renderer.
- `roleEstimator.js` — Only uses `computeSlotStats` which is trivial.

---

### Snapshot Test Fixtures

**Directory:** `packages/gw2-data/tests/engine/fixtures/`

5 fixture files, each a JSON file containing:

```json
{
  "name": "Berserker Warrior",
  "description": "Heavy armor, 3-stat, full ascended, signets, Might/Fury assumed",
  "ctx": { ... },
  "catalogs": { ... },
  "expected": {
    "total": { "Power": 3542, "Precision": 2365, ... },
    "derived": { "health": 19212, "critChance": 74.8, ... }
  }
}
```

#### Fixture Set

| # | Name | Coverage |
|---|------|----------|
| 1 | Berserker Warrior | Heavy, 3-stat, signets, Might+Fury assumed boons |
| 2 | Viper Mirage | Medium, 4-stat, trait conversions, food + utility |
| 3 | Celestial Firebrand WvW | Heavy, 9-stat, rune bonuses, WvW Celestial exclusion |
| 4 | Harrier Druid | Medium, 3-stat, healing stats, enrichment, infusions |
| 5 | Berserker Thief | Medium, sparse gear (testing empty slots gracefully) |

#### Fixture Generation

A one-time Node script (`packages/gw2-data/scripts/generate-fixtures.js`) that:
1. Loads a hardcoded build definition (profession, gear, traits, skills)
2. Manually constructs the `ctx` and `catalogs` with minimal trait/skill data
3. Runs `computeAttributes(ctx, catalogs)` from the engine
4. Writes `{ ctx, catalogs, expected: { total, derived } }` to the fixture JSON

The trait/skill data in catalogs is the minimum needed — just the facts arrays for traits that have conversions or flat bonuses. We don't need the full GW2 API response.

#### Snapshot Test

**`packages/gw2-data/tests/engine/snapshot.test.js`**

Catalogs contain Maps which can't be stored in JSON. Fixtures store catalog data as plain objects with arrays (e.g., `{ traits: [...], specializations: [...] }`). The test runner hydrates them into Maps before passing to the engine:

```js
const fs = require("fs");
const path = require("path");

const fixtureDir = path.join(__dirname, "fixtures");
const files = fs.readdirSync(fixtureDir).filter(f => f.endsWith(".json"));

for (const file of files) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), "utf-8"));
  test(`snapshot: ${fixture.name}`, () => {
    const catalogs = hydrateCatalogs(fixture.catalogs); // arrays → Maps
    const result = computeAttributes(fixture.ctx, catalogs);
    expect(result.total).toEqual(fixture.expected.total);
    for (const [key, val] of Object.entries(fixture.expected.derived)) {
      expect(result.derived[key]).toBeCloseTo(val, 1);
    }
  });
}
```

---

### What Changes vs. What Stays

| Component | Phase 3a | Phase 3b (future) |
|-----------|----------|--------------------|
| `engine-bridge.js` | **NEW** — adapter + validators | Becomes the production bridge (validators removed) |
| `stats.js` | Unchanged (old code stays) | Delete computation functions, keep UI-only functions |
| `boon-coverage.js` | Unchanged | Delete `computeBoonCoverage`, keep `computePartyCoverage` wrapper |
| `constants.js` | Unchanged | Remove constants duplicated in engine |
| `equipment.js` | Add validation calls (dev-only) | Replace `computeEquipmentStats()` calls with engine |
| `detail-panel.js` | Add validation calls (dev-only) | Replace calls |
| `skills.js` | Add validation calls (dev-only) | Replace calls |
| Snapshot fixtures | **NEW** | Keep as regression tests |

---

### Success Criteria

Phase 3a is complete when:
1. `engine-bridge.js` correctly transforms state → ctx/catalogs
2. All 7 call sites have dev-mode validation wired
3. 5 snapshot fixtures pass
4. Zero `[ENGINE-MISMATCH]` warnings during normal app usage across all 5 fixture-equivalent builds
5. All existing tests continue to pass
