# @axi/gw2-data Phase 3a: Engine Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 2 stat computation engine alongside the renderer's existing code, validate results match via dev-mode assertions and snapshot fixtures.

**Architecture:** A thin adapter module (`engine-bridge.js`) transforms renderer `state.*` into engine `ctx`/`catalogs`, runs the engine in parallel at every stat/boon call site, and logs mismatches. Snapshot fixtures provide deterministic CI regression tests.

**Tech Stack:** ES modules (renderer), CommonJS (@axi/gw2-data engine), Jest for snapshot tests, Electron renderer process.

**Spec:** `docs/superpowers/specs/2026-04-09-gw2-data-phase3-engine-wiring-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/renderer/modules/engine-bridge.js` | Adapter: state → ctx/catalogs, validation functions, dev-mode comparison |
| `src/renderer/modules/equipment.js` | Modify: add validation calls at 3 call sites (~315, ~1046, ~1484) |
| `src/renderer/modules/detail-panel.js` | Modify: add validation calls at 2 call sites (~91, ~375) |
| `src/renderer/modules/skills.js` | Modify: add validation calls at 2 call sites (~1057, ~1774) |
| `packages/gw2-data/tests/engine/fixtures/berserker-warrior.json` | Snapshot fixture: heavy 3-stat build |
| `packages/gw2-data/tests/engine/fixtures/viper-mirage.json` | Snapshot fixture: medium 4-stat with conversions |
| `packages/gw2-data/tests/engine/fixtures/celestial-firebrand-wvw.json` | Snapshot fixture: 9-stat WvW |
| `packages/gw2-data/tests/engine/fixtures/harrier-druid.json` | Snapshot fixture: healing + infusions |
| `packages/gw2-data/tests/engine/fixtures/berserker-thief.json` | Snapshot fixture: sparse gear |
| `packages/gw2-data/tests/engine/snapshot.test.js` | Snapshot test runner |

---

### Task 1: Engine Bridge — Adapter Functions

**Files:**
- Create: `src/renderer/modules/engine-bridge.js`

- [ ] **Step 1: Create the adapter module with buildEngineCtx and buildEngineCatalogs**

```js
// src/renderer/modules/engine-bridge.js
import { computeAttributes, collectModifiers, analyzeBoons, loadOverrides } from "@axi/gw2-data/engine";

// Cache overrides — loaded once, immutable
let _overrides = null;
function getOverrides() {
  if (!_overrides) _overrides = loadOverrides();
  return _overrides;
}

/**
 * Transform renderer state.editor into the engine's build context shape.
 * @param {Object} state - Renderer state object
 * @param {Object|null} assumedBoons - Optional assumed boons override
 * @param {Object|null} sigilStacks - Optional sigil stacks override
 * @returns {Object} Engine ctx
 */
export function buildEngineCtx(state, assumedBoons = null, sigilStacks = null) {
  const editor = state.editor || {};
  const equipment = editor.equipment || {};
  const isUnderwater = Boolean(editor.underwaterMode);

  return {
    profession: editor.profession || "",
    specializations: (editor.specializations || []).map((s) => ({
      id: s?.specializationId || s?.id,
      specializationId: s?.specializationId,
      majorChoices: s?.majorChoices || {},
    })),
    equipment: {
      slots: equipment.slots || {},
      weapons: equipment.weapons || {},
      runes: equipment.runes || {},
      infusions: equipment.infusions || {},
      enrichment: equipment.enrichment || null,
      food: equipment.food || null,
      utility: equipment.utility || null,
    },
    gameMode: editor.gameMode || "pve",
    underwaterMode: isUnderwater,
    activeWeaponSet: editor.activeWeaponSet || 1,
    skills: isUnderwater ? (editor.underwaterSkills || {}) : (editor.skills || {}),
    assumedBoons,
    sigilStacks,
  };
}

/**
 * Merge activeCatalog + upgradeCatalog into the engine's catalogs shape.
 * @param {Object} state - Renderer state object
 * @returns {Object} Engine catalogs
 */
export function buildEngineCatalogs(state) {
  const ac = state.activeCatalog || {};
  const uc = state.upgradeCatalog || {};
  return {
    traitById: ac.traitById || new Map(),
    skillById: ac.skillById || new Map(),
    specializationById: ac.specializationById || new Map(),
    runeById: uc.runeById || new Map(),
    foodById: uc.foodById || new Map(),
    utilityById: uc.utilityById || new Map(),
    infusionById: uc.infusionById || new Map(),
    enrichmentById: uc.enrichmentById || new Map(),
  };
}
```

- [ ] **Step 2: Verify file is syntactically valid**

Run: `node -e "import('./src/renderer/modules/engine-bridge.js')" --input-type=module 2>&1 || echo "expected — renderer module, will work in Electron"`

This file uses ES module imports of a CommonJS package. It will work in Electron's renderer but may not parse in bare Node without additional config. That's expected.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/engine-bridge.js
git commit -m "feat: add engine-bridge adapter module (Phase 3a, Task 1)"
```

---

### Task 2: Engine Bridge — Validation Functions

**Files:**
- Modify: `src/renderer/modules/engine-bridge.js`

- [ ] **Step 1: Add validateStatResult function**

Append to `src/renderer/modules/engine-bridge.js`:

```js
const ALL_STAT_KEYS = [
  "Power", "Precision", "Toughness", "Vitality", "Ferocity",
  "ConditionDamage", "Expertise", "Concentration", "HealingPower",
];

/**
 * Run engine computation and compare against old code's result.
 * Logs mismatches to console. Only call in dev mode.
 *
 * @param {Object} oldTotals - Result from old computeEquipmentStats() (flat stat object)
 * @param {Object} state - Renderer state
 * @param {string} label - Call site label for logging
 * @param {Object|null} assumedBoons - Optional assumed boons
 * @param {Object|null} sigilStacks - Optional sigil stacks
 */
export function validateStatResult(oldTotals, state, label, assumedBoons = null, sigilStacks = null) {
  try {
    const ctx = buildEngineCtx(state, assumedBoons, sigilStacks);
    const catalogs = buildEngineCatalogs(state);
    const engineResult = computeAttributes(ctx, catalogs);
    const newTotals = engineResult.total;

    const mismatches = [];
    for (const key of ALL_STAT_KEYS) {
      const oldVal = oldTotals[key] || 0;
      const newVal = newTotals[key] || 0;
      if (oldVal !== newVal) {
        mismatches.push(`${key}: old=${oldVal}, new=${newVal}`);
      }
    }

    if (mismatches.length > 0) {
      console.warn(`[ENGINE-MISMATCH] ${label} —`, mismatches.join(" | "));
    }
  } catch (err) {
    console.error(`[ENGINE-ERROR] ${label} —`, err.message);
  }
}
```

- [ ] **Step 2: Add validateBoonResult function**

Append to `src/renderer/modules/engine-bridge.js`:

```js
/**
 * Run engine boon analysis and compare against old code's result.
 * Logs mismatches to console. Only call in dev mode.
 *
 * @param {Object} oldResult - Result from old computeBoonCoverage() ({ boons, conditions })
 * @param {Object} state - Renderer state
 * @param {string} label - Call site label for logging
 * @param {Object} catalog - The active catalog passed to old computeBoonCoverage
 * @param {Object} editor - The editor object passed to old computeBoonCoverage
 * @param {Object[]} weaponSkills - Weapon skills passed to old computeBoonCoverage
 */
export function validateBoonResult(oldResult, state, label, catalog, editor, weaponSkills) {
  try {
    // Resolve skills and traits the same way the old code does
    const resolvedSkills = (weaponSkills || []).filter(Boolean);
    const resolvedTraits = [];

    // Collect active trait objects
    const ctx = buildEngineCtx(state);
    const catalogs = buildEngineCatalogs(state);

    for (const spec of ctx.specializations || []) {
      const specId = Number(spec.specializationId || spec.id) || 0;
      const specData = catalogs.specializationById.get(specId);
      const allTraitIds = [
        ...Object.values(spec.majorChoices || {}),
        ...(specData?.minorTraits || []),
      ].map(Number).filter(Boolean);
      for (const tid of allTraitIds) {
        const trait = catalogs.traitById.get(tid);
        if (trait) resolvedTraits.push(trait);
      }
    }

    // Resolve heal/utility/elite skills
    const skills = ctx.skills || {};
    const skillIds = [skills.healId, ...(skills.utilityIds || []), skills.eliteId].filter(Boolean);
    for (const id of skillIds) {
      const skill = catalogs.skillById.get(Number(id));
      if (skill) resolvedSkills.push(skill);
    }

    const overrides = getOverrides();
    const activeTraitIds = new Set(resolvedTraits.map((t) => t.id));
    const engineResult = analyzeBoons(resolvedSkills, resolvedTraits, overrides, activeTraitIds);

    // Compare boon names
    const oldBoonNames = new Set((oldResult.boons || []).map((b) => b.name));
    const newBoonNames = new Set((engineResult.boons || []).map((b) => b.name));
    const missingBoons = [...oldBoonNames].filter((n) => !newBoonNames.has(n));
    const extraBoons = [...newBoonNames].filter((n) => !oldBoonNames.has(n));

    const oldCondNames = new Set((oldResult.conditions || []).map((c) => c.name));
    const newCondNames = new Set((engineResult.conditions || []).map((c) => c.name));
    const missingConds = [...oldCondNames].filter((n) => !newCondNames.has(n));
    const extraConds = [...newCondNames].filter((n) => !oldCondNames.has(n));

    const issues = [];
    if (missingBoons.length) issues.push(`missing boons: ${missingBoons.join(", ")}`);
    if (extraBoons.length) issues.push(`extra boons: ${extraBoons.join(", ")}`);
    if (missingConds.length) issues.push(`missing conditions: ${missingConds.join(", ")}`);
    if (extraConds.length) issues.push(`extra conditions: ${extraConds.join(", ")}`);

    if (issues.length > 0) {
      console.warn(`[ENGINE-MISMATCH] ${label} —`, issues.join(" | "));
    }
  } catch (err) {
    console.error(`[ENGINE-ERROR] ${label} —`, err.message);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/engine-bridge.js
git commit -m "feat: add validation functions to engine-bridge (Phase 3a, Task 2)"
```

---

### Task 3: Instrument equipment.js Stat Call Sites

**Files:**
- Modify: `src/renderer/modules/equipment.js`

- [ ] **Step 1: Add engine-bridge import**

Add this import at the top of `src/renderer/modules/equipment.js`, after the existing imports:

```js
import { validateStatResult, validateBoonResult } from "./engine-bridge.js";
```

- [ ] **Step 2: Instrument updateHealthOrb (~line 315)**

After the existing `computeEquipmentStats()` call in `updateHealthOrb()`, add:

```js
  const computed = computeEquipmentStats();
  // --- Engine validation (dev-mode only) ---
  if (process.env.NODE_ENV !== "production") {
    validateStatResult(computed, state, "equipment.js:updateHealthOrb");
  }
  // --- End engine validation ---
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
```

- [ ] **Step 3: Instrument renderEquipmentPanel stat computation (~line 1483-1484)**

After the existing `computeEquipmentStats(_assumedBoons, _sigilStacks)` call, add:

```js
  const computed = computeEquipmentStats(_assumedBoons, _sigilStacks);
  // --- Engine validation (dev-mode only) ---
  if (process.env.NODE_ENV !== "production") {
    validateStatResult(computed, state, "equipment.js:renderStats", _assumedBoons, _sigilStacks);
  }
  // --- End engine validation ---
  const traitBonuses = computeTraitConversions(computed);
```

- [ ] **Step 4: Instrument renderEquipmentPanel boon coverage (~line 1046)**

After the existing `computeBoonCoverage(catalog, state.editor, weaponSkills)` call, add:

```js
      const coverage = computeBoonCoverage(catalog, state.editor, weaponSkills);
      // --- Engine validation (dev-mode only) ---
      if (process.env.NODE_ENV !== "production") {
        validateBoonResult(coverage, state, "equipment.js:boonCoverage", catalog, state.editor, weaponSkills);
      }
      // --- End engine validation ---
      const hasBoons = coverage.boons.length > 0;
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: instrument equipment.js with engine validation (Phase 3a, Task 3)"
```

---

### Task 4: Instrument detail-panel.js Call Sites

**Files:**
- Modify: `src/renderer/modules/detail-panel.js`

- [ ] **Step 1: Add engine-bridge import**

Add this import at the top of `src/renderer/modules/detail-panel.js`, after the existing imports:

```js
import { validateStatResult } from "./engine-bridge.js";
```

- [ ] **Step 2: Instrument selectDetail (~line 91)**

After the `computeEquipmentStats()` call in `selectDetail()`, add:

```js
    const computed = computeEquipmentStats();
    // --- Engine validation (dev-mode only) ---
    if (process.env.NODE_ENV !== "production") {
      validateStatResult(computed, state, "detail-panel.js:selectDetail");
    }
    // --- End engine validation ---
    const power = computed.Power || 1000;
```

- [ ] **Step 3: Instrument showHoverPreview (~line 376)**

After the `computeEquipmentStats()` call in `showHoverPreview()`, add:

```js
    const computed = computeEquipmentStats();
    // --- Engine validation (dev-mode only) ---
    if (process.env.NODE_ENV !== "production") {
      validateStatResult(computed, state, "detail-panel.js:showHoverPreview");
    }
    // --- End engine validation ---
    const power = computed.Power || 1000;
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/detail-panel.js
git commit -m "feat: instrument detail-panel.js with engine validation (Phase 3a, Task 4)"
```

---

### Task 5: Instrument skills.js Call Sites

**Files:**
- Modify: `src/renderer/modules/skills.js`

- [ ] **Step 1: Add engine-bridge import**

Add this import at the top of `src/renderer/modules/skills.js`, after the existing imports:

```js
import { validateStatResult, validateBoonResult } from "./engine-bridge.js";
```

- [ ] **Step 2: Instrument _renderBoonCoverage (~line 1056)**

After the `computeBoonCoverage(catalog, editor, weaponSkills)` call, add:

```js
  const coverage = computeBoonCoverage(catalog, editor, weaponSkills);
  // --- Engine validation (dev-mode only) ---
  if (process.env.NODE_ENV !== "production") {
    validateBoonResult(coverage, state, "skills.js:renderBoonCoverage", catalog, editor, weaponSkills);
  }
  // --- End engine validation ---
  const hasBoons = coverage.boons.length > 0;
```

Note: `_renderBoonCoverage` receives `catalog` and `editor` as parameters. The `state` import is needed for `buildEngineCtx`/`buildEngineCatalogs`. Verify `state` is already imported in this file — it should be, since other functions in `skills.js` use `state.editor`.

- [ ] **Step 3: Instrument _renderSkillBar HP display (~line 1774)**

After the `computeEquipmentStats()` call in `_renderSkillBar()`, add:

```js
  const computed = computeEquipmentStats();
  // --- Engine validation (dev-mode only) ---
  if (process.env.NODE_ENV !== "production") {
    validateStatResult(computed, state, "skills.js:renderSkillBar");
  }
  // --- End engine validation ---
  const totalHp = baseHp > 0 ? baseHp + (computed.Vitality || 0) * 10 : 0;
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skills.js
git commit -m "feat: instrument skills.js with engine validation (Phase 3a, Task 5)"
```

---

### Task 6: Snapshot Fixtures — Build Data

**Files:**
- Create: `packages/gw2-data/tests/engine/fixtures/berserker-warrior.json`
- Create: `packages/gw2-data/tests/engine/fixtures/viper-mirage.json`
- Create: `packages/gw2-data/tests/engine/fixtures/celestial-firebrand-wvw.json`
- Create: `packages/gw2-data/tests/engine/fixtures/harrier-druid.json`
- Create: `packages/gw2-data/tests/engine/fixtures/berserker-thief.json`

Each fixture is a JSON file with this shape:

```json
{
  "name": "...",
  "description": "...",
  "ctx": { ... },
  "catalogs": {
    "traits": [...],
    "specializations": [...],
    "skills": [],
    "runes": [],
    "foods": [],
    "utilities": [],
    "infusions": [],
    "enrichments": []
  },
  "expected": {
    "total": { "Power": ..., ... },
    "derived": { "health": ..., "critChance": ..., ... }
  }
}
```

Catalogs are stored as arrays (JSON-serializable). The test runner hydrates them into Maps.

- [ ] **Step 1: Create fixture generation script**

Create `packages/gw2-data/scripts/generate-fixtures.js`:

```js
"use strict";

const fs = require("fs");
const path = require("path");
const { computeAttributes } = require("../src/engine/attributes");

const FIXTURE_DIR = path.join(__dirname, "../tests/engine/fixtures");

function hydrateCatalogs(raw) {
  return {
    traitById: new Map((raw.traits || []).map((t) => [t.id, t])),
    skillById: new Map((raw.skills || []).map((s) => [s.id, s])),
    specializationById: new Map((raw.specializations || []).map((s) => [s.id, s])),
    runeById: new Map((raw.runes || []).map((r) => [r.id, r])),
    foodById: new Map((raw.foods || []).map((f) => [f.id, f])),
    utilityById: new Map((raw.utilities || []).map((u) => [u.id, u])),
    infusionById: new Map((raw.infusions || []).map((i) => [i.id, i])),
    enrichmentById: new Map((raw.enrichments || []).map((e) => [e.id, e])),
  };
}

const fixtures = [
  {
    name: "Berserker Warrior",
    description: "Heavy armor, 3-stat, full ascended, signets, Might+Fury assumed",
    ctx: {
      profession: "Warrior",
      specializations: [
        { id: 4, majorChoices: { 1: 1444, 2: 1449, 3: 1437 } },
      ],
      equipment: {
        slots: {
          head: "Berserker's", shoulders: "Berserker's", chest: "Berserker's",
          gloves: "Berserker's", legs: "Berserker's", boots: "Berserker's",
          mainhand1: "Berserker's", offhand1: "Berserker's",
          back: "Berserker's", accessory1: "Berserker's", accessory2: "Berserker's",
          amulet: "Berserker's", ring1: "Berserker's", ring2: "Berserker's",
        },
        weapons: { mainhand1: "greatsword" },
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [9093], eliteId: null },
      assumedBoons: { might: 25, fury: true },
      sigilStacks: null,
    },
    catalogs: {
      traits: [
        { id: 1444, facts: [{ type: "AttributeAdjust", target: "Power", value: 120 }] },
        { id: 1449, facts: [] },
        { id: 1437, facts: [] },
      ],
      specializations: [{ id: 4, minorTraits: [] }],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Viper Mirage",
    description: "Medium armor, 4-stat, trait conversions, food + utility",
    ctx: {
      profession: "Mesmer",
      specializations: [
        { id: 24, majorChoices: { 1: 700 } },
      ],
      equipment: {
        slots: {
          head: "Viper's", shoulders: "Viper's", chest: "Viper's",
          gloves: "Viper's", legs: "Viper's", boots: "Viper's",
          mainhand1: "Viper's",
          back: "Viper's", accessory1: "Viper's", accessory2: "Viper's",
          amulet: "Viper's", ring1: "Viper's", ring2: "Viper's",
        },
        weapons: { mainhand1: "axe" },
        runes: {},
        infusions: {},
        enrichment: null,
        food: 91805,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [
        { id: 700, facts: [{ type: "BuffConversion", source: "Vitality", target: "ConditionDamage", percent: 10 }] },
      ],
      specializations: [{ id: 24, minorTraits: [] }],
      skills: [],
      runes: [],
      foods: [{ id: 91805, name: "Plate of Beef Rendang", buff: "+100 Expertise\n+70 Condition Damage" }],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Celestial Firebrand WvW",
    description: "Heavy armor, 9-stat, WvW Celestial exclusion, rune bonuses",
    ctx: {
      profession: "Guardian",
      specializations: [],
      equipment: {
        slots: {
          head: "Celestial", shoulders: "Celestial", chest: "Celestial",
          gloves: "Celestial", legs: "Celestial", boots: "Celestial",
          mainhand1: "Celestial",
          back: "Celestial", accessory1: "Celestial", accessory2: "Celestial",
          amulet: "Celestial", ring1: "Celestial", ring2: "Celestial",
        },
        weapons: { mainhand1: "axe" },
        runes: {
          head: 24836, shoulders: 24836, chest: 24836,
          gloves: 24836, legs: 24836, boots: 24836,
        },
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "wvw",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [{ id: 24836, name: "Superior Rune of the Scholar", bonuses: ["+25 Power", "+35 Ferocity", "+50 Power", "+65 Ferocity", "+100 Power", "+125 Ferocity"] }],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
  {
    name: "Harrier Druid",
    description: "Medium armor, 3-stat healing, enrichment, infusions",
    ctx: {
      profession: "Ranger",
      specializations: [],
      equipment: {
        slots: {
          head: "Harrier's", shoulders: "Harrier's", chest: "Harrier's",
          gloves: "Harrier's", legs: "Harrier's", boots: "Harrier's",
          mainhand1: "Harrier's",
          back: "Harrier's", accessory1: "Harrier's", accessory2: "Harrier's",
          amulet: "Harrier's", ring1: "Harrier's", ring2: "Harrier's",
        },
        weapons: { mainhand1: "staff" },
        runes: {},
        infusions: {
          head: [49432], shoulders: [49432], chest: [49432],
          gloves: [49432], legs: [49432], boots: [49432],
        },
        enrichment: 78061,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [{ id: 49432, name: "+5 Healing Power Infusion", infixUpgrade: { attributes: [{ attribute: "Healing", modifier: 5 }] } }],
      enrichments: [{ id: 78061, name: "+10 Concentration Enrichment", infixUpgrade: { attributes: [{ attribute: "BoonDuration", modifier: 10 }] } }],
    },
  },
  {
    name: "Berserker Thief",
    description: "Medium armor, sparse gear (testing empty slots gracefully)",
    ctx: {
      profession: "Thief",
      specializations: [],
      equipment: {
        slots: { chest: "Berserker's", legs: "Berserker's" },
        weapons: {},
        runes: {},
        infusions: {},
        enrichment: null,
        food: null,
        utility: null,
      },
      gameMode: "pve",
      underwaterMode: false,
      activeWeaponSet: 1,
      skills: { healId: null, utilityIds: [], eliteId: null },
      assumedBoons: null,
      sigilStacks: null,
    },
    catalogs: {
      traits: [],
      specializations: [],
      skills: [],
      runes: [],
      foods: [],
      utilities: [],
      infusions: [],
      enrichments: [],
    },
  },
];

// Generate fixtures
if (!fs.existsSync(FIXTURE_DIR)) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
}

for (const fixture of fixtures) {
  const catalogs = hydrateCatalogs(fixture.catalogs);
  const result = computeAttributes(fixture.ctx, catalogs);
  const output = {
    name: fixture.name,
    description: fixture.description,
    ctx: fixture.ctx,
    catalogs: fixture.catalogs,
    expected: {
      total: result.total,
      derived: result.derived,
    },
  };
  const filename = fixture.name.toLowerCase().replace(/\s+/g, "-") + ".json";
  const filepath = path.join(FIXTURE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Generated: ${filename}`);
}
```

- [ ] **Step 2: Run the fixture generation script**

Run: `node packages/gw2-data/scripts/generate-fixtures.js`
Expected: 5 files created in `packages/gw2-data/tests/engine/fixtures/`

- [ ] **Step 3: Verify fixture files were created**

Run: `ls packages/gw2-data/tests/engine/fixtures/`
Expected: `berserker-thief.json  berserker-warrior.json  celestial-firebrand-wvw.json  harrier-druid.json  viper-mirage.json`

- [ ] **Step 4: Commit**

```bash
git add packages/gw2-data/scripts/generate-fixtures.js packages/gw2-data/tests/engine/fixtures/
git commit -m "feat(gw2-data): add snapshot fixture generation and 5 build fixtures (Phase 3a, Task 6)"
```

---

### Task 7: Snapshot Test Runner

**Files:**
- Create: `packages/gw2-data/tests/engine/snapshot.test.js`

- [ ] **Step 1: Write the snapshot test**

```js
// packages/gw2-data/tests/engine/snapshot.test.js
"use strict";

const fs = require("fs");
const path = require("path");
const { computeAttributes } = require("../../src/engine/attributes");

const FIXTURE_DIR = path.join(__dirname, "fixtures");

function hydrateCatalogs(raw) {
  return {
    traitById: new Map((raw.traits || []).map((t) => [t.id, t])),
    skillById: new Map((raw.skills || []).map((s) => [s.id, s])),
    specializationById: new Map((raw.specializations || []).map((s) => [s.id, s])),
    runeById: new Map((raw.runes || []).map((r) => [r.id, r])),
    foodById: new Map((raw.foods || []).map((f) => [f.id, f])),
    utilityById: new Map((raw.utilities || []).map((u) => [u.id, u])),
    infusionById: new Map((raw.infusions || []).map((i) => [i.id, i])),
    enrichmentById: new Map((raw.enrichments || []).map((e) => [e.id, e])),
  };
}

const fixtureFiles = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));

describe("snapshot fixtures", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf-8"));

    describe(fixture.name, () => {
      let result;

      beforeAll(() => {
        const catalogs = hydrateCatalogs(fixture.catalogs);
        result = computeAttributes(fixture.ctx, catalogs);
      });

      test("total stats match expected", () => {
        expect(result.total).toEqual(fixture.expected.total);
      });

      test("derived health matches", () => {
        expect(result.derived.health).toBe(fixture.expected.derived.health);
      });

      test("derived critChance matches", () => {
        expect(result.derived.critChance).toBeCloseTo(fixture.expected.derived.critChance, 1);
      });

      test("derived critDamage matches", () => {
        expect(result.derived.critDamage).toBeCloseTo(fixture.expected.derived.critDamage, 1);
      });

      test("derived armor matches", () => {
        expect(result.derived.armor).toBe(fixture.expected.derived.armor);
      });

      test("derived conditionDuration matches", () => {
        expect(result.derived.conditionDuration).toBeCloseTo(fixture.expected.derived.conditionDuration, 1);
      });

      test("derived boonDuration matches", () => {
        expect(result.derived.boonDuration).toBeCloseTo(fixture.expected.derived.boonDuration, 1);
      });
    });
  }
});
```

- [ ] **Step 2: Run the snapshot tests**

Run: `npx jest --config packages/gw2-data/package.json packages/gw2-data/tests/engine/snapshot.test.js --no-coverage`
Expected: PASS — all 35 tests (7 per fixture × 5 fixtures)

- [ ] **Step 3: Run full engine test suite to verify no regressions**

Run: `npx jest --config packages/gw2-data/package.json packages/gw2-data/tests/engine/ --no-coverage`
Expected: All tests pass (previous 163 + 35 snapshot = 198 total)

- [ ] **Step 4: Commit**

```bash
git add packages/gw2-data/tests/engine/snapshot.test.js
git commit -m "feat(gw2-data): add snapshot test runner for build fixtures (Phase 3a, Task 7)"
```

---

### Task 8: Smoke Test — Build and Launch

**Files:**
- No file changes — manual verification

- [ ] **Step 1: Run the full gw2-data test suite**

Run: `npx jest --config packages/gw2-data/package.json packages/gw2-data/tests/ --no-coverage`
Expected: All tests pass

- [ ] **Step 2: Build the app**

Run: `npm run build` (or the project's build command)
Expected: Build succeeds with no errors

- [ ] **Step 3: Launch in dev mode and check for ENGINE-MISMATCH warnings**

Run: `npm start` (or the project's dev command)
Expected:
- App launches successfully
- Open DevTools console
- Load a build (e.g., select Warrior, equip some Berserker's gear)
- Check console for any `[ENGINE-MISMATCH]` or `[ENGINE-ERROR]` messages
- If none appear, the engine matches the old code

- [ ] **Step 4: Document any mismatches found**

If mismatches are found, note the call site, stat, and old vs new values. These indicate bugs in the engine that need fixing before Phase 3b.

---
