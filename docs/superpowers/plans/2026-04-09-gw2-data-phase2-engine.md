# @axi/gw2-data Phase 2: Stat Computation Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract axiforge's stat computation logic into pure, state-free functions in `packages/gw2-data/src/engine/`.

**Architecture:** Extract and decouple existing battle-tested code from `src/renderer/modules/stats.js`, `boon-coverage.js`, and `constants.js`. Replace all `state.*` references with explicit function parameters. Every engine function is pure — build context and catalogs passed in, computed results returned.

**Tech Stack:** Node.js, CommonJS (`require`), Jest for testing. No external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-09-gw2-data-phase2-engine-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/gw2-data/src/engine/constants.js` | Static GW2 game data (stat combos, slot weights, profession HP, weapon strengths, boon/condition names) |
| `packages/gw2-data/src/engine/overrides.js` | Load and query `data/overrides.json` for trait trigger conditions |
| `packages/gw2-data/data/overrides.json` | Manual trait overrides (fury, pet stats, Notoriety, Twisted Medicine) |
| `packages/gw2-data/src/engine/attributes.js` | Full attribute calculation pipeline (base → equipment → upgrades → traits → derived) |
| `packages/gw2-data/src/engine/modifiers.js` | Collect active trait IDs, classify trait facts into typed modifiers |
| `packages/gw2-data/src/engine/tooltips.js` | Compute skill tooltip damage values from attributes + modifiers |
| `packages/gw2-data/src/engine/graph.js` | Trait/skill interaction graph from wiki relations data |
| `packages/gw2-data/src/engine/boons.js` | Boon/condition coverage extraction and ally classification |
| `packages/gw2-data/src/engine/combos.js` | Combo field/finisher extraction and deduplication |
| `packages/gw2-data/src/engine/index.js` | StatEngine wrapper class + re-exports |
| `packages/gw2-data/src/index.js` | Update: add engine exports |
| `packages/gw2-data/tests/engine/constants.test.js` | Tests for constants |
| `packages/gw2-data/tests/engine/overrides.test.js` | Tests for overrides |
| `packages/gw2-data/tests/engine/attributes.test.js` | Tests for attribute computation |
| `packages/gw2-data/tests/engine/modifiers.test.js` | Tests for modifier collection |
| `packages/gw2-data/tests/engine/tooltips.test.js` | Tests for tooltip computation |
| `packages/gw2-data/tests/engine/graph.test.js` | Tests for interaction graph |
| `packages/gw2-data/tests/engine/boons.test.js` | Tests for boon analysis |
| `packages/gw2-data/tests/engine/combos.test.js` | Tests for combo analysis |
| `packages/gw2-data/tests/engine/integration.test.js` | End-to-end StatEngine tests |

---

### Task 1: Constants Extraction

**Files:**
- Create: `packages/gw2-data/src/engine/constants.js`
- Create: `packages/gw2-data/tests/engine/constants.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/constants.test.js
"use strict";

const {
  STAT_COMBOS, getStatCombo, getEffectiveStats,
  SLOT_WEIGHTS, TWO_HAND_WEIGHTS,
  PROFESSION_BASE_HP, PROFESSION_WEIGHT, ARMOR_DEFENSE_BY_WEIGHT,
  WEAPON_STRENGTH_MIDPOINT,
  LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  FURY_CRIT_CHANCE, FURY_CRIT_CHANCE_WVW,
  STACKING_SIGIL_DEFS, SIGNET_PASSIVE_BUFFS,
  BOON_NAMES, CONDITION_NAMES, CONDITION_NAME_NORMALIZE,
  BOON_DISPLAY_ORDER, BUFF_FACT_TYPES,
  ALL_STAT_KEYS, CONVERSION_TARGET_MAP,
} = require("../../src/engine/constants");

describe("constants", () => {
  test("getStatCombo returns Berserker's stats", () => {
    const combo = getStatCombo("Berserker's");
    expect(combo).toBeDefined();
    expect(combo.stats).toEqual(["Power", "Precision", "Ferocity"]);
  });

  test("getStatCombo strips apostrophe for aliases", () => {
    expect(getStatCombo("Berserker")).toBeDefined();
    expect(getStatCombo("Wanderer")).toBeDefined();
  });

  test("getEffectiveStats returns all stats for PvE Celestial", () => {
    const combo = getStatCombo("Celestial");
    const stats = getEffectiveStats(combo, "pve");
    expect(stats).toContain("Expertise");
    expect(stats).toContain("Concentration");
  });

  test("getEffectiveStats excludes Expertise/Concentration for WvW Celestial", () => {
    const combo = getStatCombo("Celestial");
    const stats = getEffectiveStats(combo, "wvw");
    expect(stats).not.toContain("Expertise");
    expect(stats).not.toContain("Concentration");
  });

  test("SLOT_WEIGHTS has correct keys for all 19 slots", () => {
    const expected = [
      "head", "shoulders", "chest", "hands", "legs", "feet",
      "mainhand1", "offhand1", "mainhand2", "offhand2",
      "back", "amulet", "ring1", "ring2", "accessory1", "accessory2",
      "breather", "aquatic1", "aquatic2",
    ];
    for (const key of expected) {
      expect(SLOT_WEIGHTS[key]).toBeDefined();
      expect(SLOT_WEIGHTS[key]).toHaveProperty("p");
      expect(SLOT_WEIGHTS[key]).toHaveProperty("s");
      expect(SLOT_WEIGHTS[key]).toHaveProperty("p4");
      expect(SLOT_WEIGHTS[key]).toHaveProperty("s4");
      expect(SLOT_WEIGHTS[key]).toHaveProperty("c");
    }
  });

  test("TWO_HAND_WEIGHTS matches aquatic weapon weights", () => {
    expect(TWO_HAND_WEIGHTS.p).toBe(SLOT_WEIGHTS.aquatic1.p);
  });

  test("PROFESSION_BASE_HP covers all professions and elite specs", () => {
    expect(PROFESSION_BASE_HP.Warrior).toBe(9212);
    expect(PROFESSION_BASE_HP.Guardian).toBe(1645);
    expect(PROFESSION_BASE_HP.Ranger).toBe(5922);
    expect(PROFESSION_BASE_HP.Berserker).toBe(9212);
    expect(PROFESSION_BASE_HP.Weaver).toBe(1645);
  });

  test("WEAPON_STRENGTH_MIDPOINT has all weapon types", () => {
    expect(WEAPON_STRENGTH_MIDPOINT.greatsword).toBe(1047.5);
    expect(WEAPON_STRENGTH_MIDPOINT.dagger).toBe(952.5);
    expect(WEAPON_STRENGTH_MIDPOINT.staff).toBe(1048);
  });

  test("LAND_ONLY_SLOTS and AQUATIC_SLOTS are disjoint", () => {
    for (const s of LAND_ONLY_SLOTS) {
      expect(AQUATIC_SLOTS.has(s)).toBe(false);
    }
  });

  test("MIGHT constants are correct", () => {
    expect(MIGHT_POWER_PER_STACK).toBe(30);
    expect(MIGHT_CONDI_PER_STACK).toBe(30);
  });

  test("FURY constants for PvE and WvW", () => {
    expect(FURY_CRIT_CHANCE).toBe(25);
    expect(FURY_CRIT_CHANCE_WVW).toBe(20);
  });

  test("STACKING_SIGIL_DEFS has expected structure", () => {
    expect(STACKING_SIGIL_DEFS.length).toBeGreaterThan(0);
    const bloodlust = STACKING_SIGIL_DEFS.find((d) => d.key === "sigilBloodlust");
    expect(bloodlust).toMatchObject({ stat: "Power", perStack: 10, maxStacks: 25 });
  });

  test("SIGNET_PASSIVE_BUFFS has Bane Signet", () => {
    expect(SIGNET_PASSIVE_BUFFS.get(9093)).toEqual({ stat: "Power", value: 180 });
  });

  test("BOON_NAMES contains all 12 boons", () => {
    expect(BOON_NAMES.size).toBe(12);
    expect(BOON_NAMES.has("Might")).toBe(true);
    expect(BOON_NAMES.has("Fury")).toBe(true);
  });

  test("CONDITION_NAME_NORMALIZE maps variants to canonical", () => {
    expect(CONDITION_NAME_NORMALIZE.Blind).toBe("Blinded");
    expect(CONDITION_NAME_NORMALIZE.Cripple).toBe("Crippled");
    expect(CONDITION_NAME_NORMALIZE.Immobilize).toBe("Immobile");
  });

  test("ALL_STAT_KEYS has 9 stats", () => {
    expect(ALL_STAT_KEYS).toHaveLength(9);
    expect(ALL_STAT_KEYS).toContain("Power");
    expect(ALL_STAT_KEYS).toContain("HealingPower");
  });

  test("CONVERSION_TARGET_MAP normalizes API target names", () => {
    expect(CONVERSION_TARGET_MAP.BoonDuration).toBe("Concentration");
    expect(CONVERSION_TARGET_MAP.ConditionDuration).toBe("Expertise");
    expect(CONVERSION_TARGET_MAP.CritDamage).toBe("Ferocity");
    expect(CONVERSION_TARGET_MAP.Healing).toBe("HealingPower");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/constants.test.js --no-coverage`
Expected: FAIL — cannot find module `../../src/engine/constants`

- [ ] **Step 3: Write the constants module**

Create `packages/gw2-data/src/engine/constants.js` — extract all static data from `src/renderer/modules/constants.js`. This is a pure data module, no imports from renderer code.

Key data to extract (refer to `src/renderer/modules/constants.js` for exact values):
- `STAT_COMBOS` — array of `[label, { stats: [...] }]` entries (lines 6–48), built into a Map with label+alias lookup via `getStatCombo(label)`. Each combo needs a `.label` property added for `getEffectiveStats` to check.
- `getEffectiveStats(combo, gameMode)` — returns `combo.stats` normally; for WvW Celestial, filters out Expertise and Concentration (line 68–74).
- `SLOT_WEIGHTS` — object with 19 slot keys, each having `{ p, s, p4, s4, c }` (lines 88–108).
- `TWO_HAND_WEIGHTS` — `{ p: 251, s: 179, p4: 215, s4: 118, c: 118 }` (line 111).
- `PROFESSION_BASE_HP` — object mapping profession/elite spec names to base HP (lines 389–399). High=9212, Medium=5922, Low=1645.
- `PROFESSION_WEIGHT` — `{ Elementalist: "light", ..., Warrior: "heavy" }` (lines 195–199).
- `ARMOR_DEFENSE_BY_WEIGHT` — `{ light: 967, medium: 1118, heavy: 1271 }` (line 203).
- `WEAPON_STRENGTH_MIDPOINT` — object mapping weapon type → midpoint (lines 150–155).
- `LAND_ONLY_SLOTS` — Set of slots excluded in underwater mode (line 192).
- `AQUATIC_SLOTS` — Set of slots excluded in land mode (line 193).
- `MIGHT_POWER_PER_STACK` (30), `MIGHT_CONDI_PER_STACK` (30) (lines 548–549).
- `FURY_CRIT_CHANCE` (25), `FURY_CRIT_CHANCE_WVW` (20) (lines 551–552).
- `STACKING_SIGIL_DEFS` — array of sigil definitions (lines 559–569). Use `ALL_STAT_KEYS` array instead of the renderer's internal `_ALL_STATS`.
- `SIGNET_PASSIVE_BUFFS` — Map of skill ID → `{ stat, value }` (lines 575–596).
- `BOON_NAMES` — Set of 12 boon names (lines 598–601).
- `CONDITION_NAMES` — Set of condition names including variants (lines 603–608).
- `CONDITION_NAME_NORMALIZE` — object mapping variant → canonical (lines 610–613).
- `BOON_DISPLAY_ORDER` — array of boon names in display order (lines 615–618).
- `BUFF_FACT_TYPES` — Set of fact types that represent buffs: `["Buff", "ApplyBuffCondition", "PrefixedBuff"]` (line 545).
- `ALL_STAT_KEYS` — `["Power", "Precision", "Toughness", "Vitality", "Ferocity", "ConditionDamage", "HealingPower", "Expertise", "Concentration"]`.
- `CONVERSION_TARGET_MAP` — `{ BoonDuration: "Concentration", ConditionDuration: "Expertise", CritDamage: "Ferocity", Healing: "HealingPower" }` (from `stats.js` lines 13–18).

Do NOT include icon URLs (BOON_CONDITION_ICONS), render URLs, or any UI-related constants. Those stay in the renderer.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/constants.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/constants.js packages/gw2-data/tests/engine/constants.test.js
git commit -m "feat(gw2-data): extract game constants for stat engine (Phase 2, Task 1)"
```

---

### Task 2: Overrides Module

**Files:**
- Create: `packages/gw2-data/data/overrides.json`
- Create: `packages/gw2-data/src/engine/overrides.js`
- Create: `packages/gw2-data/tests/engine/overrides.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/overrides.test.js
"use strict";

const { loadOverrides, getOverride } = require("../../src/engine/overrides");

describe("overrides", () => {
  test("loadOverrides returns a Map", () => {
    const overrides = loadOverrides();
    expect(overrides).toBeInstanceOf(Map);
  });

  test("loadOverrides includes Roiling Mists implicit fury", () => {
    const overrides = loadOverrides();
    const entry = overrides.get("trait:1719");
    expect(entry).toBeDefined();
    expect(entry.implicitFury).toBe(true);
  });

  test("loadOverrides includes Fang and Claw pet stat", () => {
    const overrides = loadOverrides();
    const entry = overrides.get("trait:1016");
    expect(entry).toBeDefined();
    expect(entry.petStatOnly).toBe(true);
  });

  test("loadOverrides includes Notoriety might override", () => {
    const overrides = loadOverrides();
    const entry = overrides.get("trait:1765");
    expect(entry).toBeDefined();
    expect(entry.mightOverride).toEqual({ power: 40, condi: 20 });
  });

  test("loadOverrides includes Twisted Medicine ally targeting", () => {
    const overrides = loadOverrides();
    const entry = overrides.get("trait:2220");
    expect(entry).toBeDefined();
    expect(entry.allyTargeted).toEqual(["elixir"]);
  });

  test("loadOverrides includes Primal Rage missing burst recharge fact", () => {
    const overrides = loadOverrides();
    const entry = overrides.get("trait:1831");
    expect(entry).toBeDefined();
    expect(entry.burstRechargeReduction).toBe(10);
  });

  test("getOverride returns entry for known trait", () => {
    const overrides = loadOverrides();
    const entry = getOverride(overrides, "trait:1719");
    expect(entry.implicitFury).toBe(true);
  });

  test("getOverride returns null for unknown key", () => {
    const overrides = loadOverrides();
    expect(getOverride(overrides, "trait:99999")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/overrides.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Create overrides.json**

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
    "description": "Notoriety: modifies Might per-stack values (+40P/+20CD instead of +30P/+30CD)"
  },
  "trait:2220": {
    "allyTargeted": ["elixir"],
    "description": "Twisted Medicine: elixir skills become ally-targeted"
  },
  "trait:1831": {
    "burstRechargeReduction": 10,
    "description": "Primal Rage: API omits 10% burst recharge reduction fact"
  }
}
```

- [ ] **Step 4: Write overrides.js**

```js
// packages/gw2-data/src/engine/overrides.js
"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Load overrides from data/overrides.json into a Map.
 * @returns {Map<string, Object>}
 */
function loadOverrides() {
  const filePath = path.join(__dirname, "../../data/overrides.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return new Map(Object.entries(raw));
}

/**
 * Get override for a specific entity key.
 * @param {Map<string, Object>} overrides
 * @param {string} key - e.g. "trait:1719"
 * @returns {Object|null}
 */
function getOverride(overrides, key) {
  return overrides.get(key) || null;
}

module.exports = { loadOverrides, getOverride };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/overrides.test.js --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gw2-data/data/overrides.json packages/gw2-data/src/engine/overrides.js packages/gw2-data/tests/engine/overrides.test.js
git commit -m "feat(gw2-data): add overrides module and data file (Phase 2, Task 2)"
```

---

### Task 3: Modifiers Module

**Files:**
- Create: `packages/gw2-data/src/engine/modifiers.js`
- Create: `packages/gw2-data/tests/engine/modifiers.test.js`

Building modifiers before attributes because attributes needs `collectActiveTraitIds` and modifier classification to separate fury-gated vs passive traits.

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/modifiers.test.js
"use strict";

const { collectActiveTraitIds, collectModifiers, isFuryTrait } = require("../../src/engine/modifiers");
const { loadOverrides } = require("../../src/engine/overrides");

// Minimal catalog and context helpers
function makeCatalog(traits = [], specs = []) {
  return {
    traitById: new Map(traits.map((t) => [t.id, t])),
    specializationById: new Map(specs.map((s) => [s.id, s])),
  };
}

function makeCtx(specializations = []) {
  return { specializations };
}

describe("collectActiveTraitIds", () => {
  test("collects major trait choices", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 1444, 2: 1449, 3: 1437 } }]);
    const catalog = makeCatalog([], [{ id: 4, minorTraits: [] }]);
    const ids = collectActiveTraitIds(ctx, catalog);
    expect(ids).toEqual(new Set([1444, 1449, 1437]));
  });

  test("collects minor traits from specialization data", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: {} }]);
    const catalog = makeCatalog([], [{ id: 4, minorTraits: [100, 101, 102] }]);
    const ids = collectActiveTraitIds(ctx, catalog);
    expect(ids).toEqual(new Set([100, 101, 102]));
  });

  test("supports specializationId key (editor format)", () => {
    const ctx = makeCtx([{ specializationId: 4, majorChoices: { 1: 1444 } }]);
    const catalog = makeCatalog([], [{ id: 4, minorTraits: [100] }]);
    const ids = collectActiveTraitIds(ctx, catalog);
    expect(ids).toEqual(new Set([1444, 100]));
  });

  test("returns empty set with no specializations", () => {
    const ids = collectActiveTraitIds(makeCtx(), makeCatalog());
    expect(ids.size).toBe(0);
  });
});

describe("isFuryTrait", () => {
  test("returns true for trait with Buff(Fury) fact", () => {
    const trait = { facts: [{ type: "Buff", status: "Fury" }] };
    expect(isFuryTrait(trait, 999, new Map())).toBe(true);
  });

  test("returns true for implicit fury trait via overrides", () => {
    const overrides = loadOverrides();
    const trait = { facts: [] };
    expect(isFuryTrait(trait, 1719, overrides)).toBe(true);
  });

  test("returns false for non-fury trait", () => {
    const trait = { facts: [{ type: "Buff", status: "Might" }] };
    expect(isFuryTrait(trait, 999, new Map())).toBe(false);
  });
});

describe("collectModifiers", () => {
  test("collects flat bonus from AttributeAdjust fact", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 500 } }]);
    const catalog = makeCatalog(
      [{ id: 500, facts: [{ type: "AttributeAdjust", target: "Power", value: 150 }] }],
      [{ id: 4, minorTraits: [] }]
    );
    const overrides = new Map();
    const mods = collectModifiers(ctx, catalog, overrides);
    expect(mods).toContainEqual(expect.objectContaining({
      source: "trait:500", type: "flatBonus", target: "Power", value: 150, condition: null,
    }));
  });

  test("classifies fury-gated flat bonus with condition: fury", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 600 } }]);
    const catalog = makeCatalog(
      [{
        id: 600, facts: [
          { type: "Buff", status: "Fury" },
          { type: "AttributeAdjust", target: "Ferocity", value: 180 },
        ],
      }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, new Map());
    const ferocityMod = mods.find((m) => m.target === "Ferocity");
    expect(ferocityMod.condition).toBe("fury");
  });

  test("excludes pet stat traits", () => {
    const overrides = loadOverrides();
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 1016 } }]);
    const catalog = makeCatalog(
      [{ id: 1016, facts: [{ type: "AttributeAdjust", target: "Power", value: 100 }] }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, overrides);
    const petMod = mods.find((m) => m.source === "trait:1016" && m.type === "flatBonus");
    expect(petMod).toBeUndefined();
  });

  test("collects conversion from BuffConversion fact", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 700 } }]);
    const catalog = makeCatalog(
      [{ id: 700, facts: [{ type: "BuffConversion", source: "Vitality", target: "Power", percent: 13 }] }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, new Map());
    expect(mods).toContainEqual(expect.objectContaining({
      source: "trait:700", type: "conversion", sourceAttr: "Vitality", target: "Power", percent: 13,
    }));
  });

  test("collects critChance modifier from Percent fact", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 800 } }]);
    const catalog = makeCatalog(
      [{
        id: 800, facts: [
          { type: "Buff", status: "Fury" },
          { type: "Percent", text: "Critical Chance Increase", percent: 15 },
        ],
      }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, new Map());
    expect(mods).toContainEqual(expect.objectContaining({
      source: "trait:800", type: "critChance", value: 15, condition: "fury",
    }));
  });

  test("collects mightModifier from overrides", () => {
    const overrides = loadOverrides();
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 1765 } }]);
    const catalog = makeCatalog(
      [{ id: 1765, facts: [] }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, overrides);
    expect(mods).toContainEqual(expect.objectContaining({
      source: "trait:1765", type: "mightModifier", power: 40, condi: 20,
    }));
  });

  test("handles game mode indexing for WvW (second fact value)", () => {
    const ctx = makeCtx([{ id: 4, majorChoices: { 1: 900 } }]);
    ctx.gameMode = "wvw";
    const catalog = makeCatalog(
      [{
        id: 900, facts: [
          { type: "AttributeAdjust", target: "Power", value: 150 },
          { type: "AttributeAdjust", target: "Power", value: 100 },
        ],
      }],
      [{ id: 4, minorTraits: [] }]
    );
    const mods = collectModifiers(ctx, catalog, new Map());
    const powerMod = mods.find((m) => m.target === "Power");
    expect(powerMod.value).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/modifiers.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the modifiers module**

Create `packages/gw2-data/src/engine/modifiers.js`. Extract logic from:
- `collectActiveTraitIds()` in `stats.js:34-50` — takes `(ctx, catalogs)` instead of reading `state`
- `isFuryTrait()` in `stats.js:92-95` — takes `(trait, traitId, overrides)`, checks both Buff(Fury) facts AND `overrides.get("trait:" + traitId)?.implicitFury`
- New `collectModifiers(ctx, catalogs, overrides)` that iterates active traits and classifies each fact into modifier objects:

```js
"use strict";

const { CONVERSION_TARGET_MAP } = require("./constants");

function collectActiveTraitIds(ctx, catalogs) {
  const ids = new Set();
  for (const spec of ctx.specializations || []) {
    for (const id of Object.values(spec?.majorChoices || {})) {
      const n = Number(id);
      if (n) ids.add(n);
    }
    const specId = Number(spec?.specializationId || spec?.id) || 0;
    const specData = specId ? catalogs.specializationById?.get(specId) : null;
    for (const minorId of specData?.minorTraits || []) {
      if (minorId) ids.add(Number(minorId));
    }
  }
  return ids;
}

function isFuryTrait(trait, traitId, overrides) {
  if (overrides.get(`trait:${traitId}`)?.implicitFury) return true;
  return trait.facts?.some((f) => f.type === "Buff" && f.status === "Fury") || false;
}

function collectModifiers(ctx, catalogs, overrides) {
  const modifiers = [];
  const activeTraitIds = collectActiveTraitIds(ctx, catalogs);
  const gameMode = (ctx.gameMode || "pve").toLowerCase();

  for (const traitId of activeTraitIds) {
    const trait = catalogs.traitById?.get(traitId);
    if (!trait) continue;
    const key = `trait:${traitId}`;
    const override = overrides.get(key);

    // Skip pet-only stat traits
    if (override?.petStatOnly) continue;

    // Might modifier from overrides
    if (override?.mightOverride) {
      modifiers.push({
        source: key, type: "mightModifier",
        power: override.mightOverride.power,
        condi: override.mightOverride.condi,
        condition: null,
      });
    }

    // Burst recharge from overrides
    if (override?.burstRechargeReduction) {
      modifiers.push({
        source: key, type: "burstRecharge",
        value: override.burstRechargeReduction,
        condition: null,
      });
    }

    const isFury = isFuryTrait(trait, traitId, overrides);
    const condition = isFury ? "fury" : null;
    const facts = trait.facts || [];

    // Group AttributeAdjust facts by target for game-mode selection
    const adjByTarget = new Map();
    for (const fact of facts) {
      if (fact.type !== "AttributeAdjust" || !fact.target || !fact.value) continue;
      if (!adjByTarget.has(fact.target)) adjByTarget.set(fact.target, []);
      adjByTarget.get(fact.target).push(fact.value);
    }
    for (const [target, values] of adjByTarget) {
      const statKey = CONVERSION_TARGET_MAP[target] || target;
      const idx = gameMode === "wvw" ? Math.min(1, values.length - 1) : 0;
      modifiers.push({
        source: key, type: "flatBonus",
        target: statKey, value: values[idx], condition,
      });
    }

    // Conversions (BuffConversion / AttributeConversion)
    for (const fact of facts) {
      if (fact.type !== "AttributeConversion" && fact.type !== "BuffConversion") continue;
      if (!fact.source || !fact.target || !fact.percent) continue;
      modifiers.push({
        source: key, type: "conversion",
        sourceAttr: fact.source,
        target: CONVERSION_TARGET_MAP[fact.target] || fact.target,
        percent: fact.percent,
        condition: null,
      });
    }

    // Crit chance percent (from fury-gated traits)
    if (isFury) {
      const critFacts = facts.filter(
        (f) => f.type === "Percent" && f.text === "Critical Chance Increase" && f.percent
      );
      if (critFacts.length > 0) {
        const idx = gameMode === "wvw" ? Math.min(1, critFacts.length - 1) : 0;
        modifiers.push({
          source: key, type: "critChance",
          value: critFacts[idx].percent, condition: "fury",
        });
      }
    }

    // Burst recharge from Minor trait facts (Versatile Power pattern)
    if (trait.slot === "Minor") {
      const desc = (trait.description || "").toLowerCase();
      if (desc.includes("burst")) {
        for (const fact of facts) {
          if (fact.type === "Percent" && fact.text === "Recharge Reduced" && fact.percent > 0) {
            modifiers.push({
              source: key, type: "burstRecharge",
              value: fact.percent, condition: null,
            });
          }
        }
      }
    }
  }

  return modifiers;
}

module.exports = { collectActiveTraitIds, collectModifiers, isFuryTrait };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/modifiers.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/modifiers.js packages/gw2-data/tests/engine/modifiers.test.js
git commit -m "feat(gw2-data): add modifiers module for trait fact classification (Phase 2, Task 3)"
```

---

### Task 4: Attributes Module

**Files:**
- Create: `packages/gw2-data/src/engine/attributes.js`
- Create: `packages/gw2-data/tests/engine/attributes.test.js`

This is the largest module — the core stat pipeline. Extract from `computeEquipmentStats()` in `stats.js:271-505` plus derived stat formulas from `equipment.js:1487-1498`.

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/attributes.test.js
"use strict";

const { computeAttributes, computeSlotStats, getExcludedSlots } = require("../../src/engine/attributes");

// Minimal catalog/context builders
function makeCtx(overrides = {}) {
  return {
    profession: "Warrior",
    specializations: [],
    equipment: {
      slots: {},
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
    skills: {},
    assumedBoons: null,
    sigilStacks: null,
    ...overrides,
  };
}

function makeCatalogs(overrides = {}) {
  return {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    infusionById: new Map(),
    enrichmentById: new Map(),
    ...overrides,
  };
}

describe("getExcludedSlots", () => {
  test("excludes aquatic slots in land mode", () => {
    const excluded = getExcludedSlots(false, 1);
    expect(excluded.has("breather")).toBe(true);
    expect(excluded.has("aquatic1")).toBe(true);
    expect(excluded.has("aquatic2")).toBe(true);
    expect(excluded.has("head")).toBe(false);
  });

  test("excludes land weapon slots in land mode for inactive set", () => {
    const excluded = getExcludedSlots(false, 1);
    expect(excluded.has("mainhand2")).toBe(true);
    expect(excluded.has("offhand2")).toBe(true);
    expect(excluded.has("mainhand1")).toBe(false);
  });

  test("excludes land-only slots in underwater mode", () => {
    const excluded = getExcludedSlots(true, 1);
    expect(excluded.has("head")).toBe(true);
    expect(excluded.has("mainhand1")).toBe(true);
    expect(excluded.has("breather")).toBe(false);
  });
});

describe("computeSlotStats", () => {
  test("3-stat combo returns major + minor stats", () => {
    const result = computeSlotStats("Berserker's", "chest", {}, "pve");
    expect(result).toEqual([
      { stat: "Power", value: 141 },
      { stat: "Precision", value: 101 },
      { stat: "Ferocity", value: 101 },
    ]);
  });

  test("4-stat combo returns 2 major + 2 minor stats", () => {
    const result = computeSlotStats("Marauder's", "chest", {}, "pve");
    expect(result).toEqual([
      { stat: "Power", value: 121 },
      { stat: "Precision", value: 121 },
      { stat: "Vitality", value: 66 },
      { stat: "Ferocity", value: 66 },
    ]);
  });

  test("Celestial uses c weight for all stats", () => {
    const result = computeSlotStats("Celestial", "chest", {}, "pve");
    expect(result.every((r) => r.value === 66)).toBe(true);
    expect(result).toHaveLength(9);
  });

  test("WvW Celestial excludes Expertise and Concentration", () => {
    const result = computeSlotStats("Celestial", "chest", {}, "wvw");
    expect(result.find((r) => r.stat === "Expertise")).toBeUndefined();
    expect(result.find((r) => r.stat === "Concentration")).toBeUndefined();
    expect(result).toHaveLength(7);
  });

  test("two-handed weapon uses TWO_HAND_WEIGHTS", () => {
    const weapons = { mainhand1: "greatsword" };
    const result = computeSlotStats("Berserker's", "mainhand1", weapons, "pve");
    expect(result[0]).toEqual({ stat: "Power", value: 251 });
  });
});

describe("computeAttributes", () => {
  test("empty build returns base stats only", () => {
    const result = computeAttributes(makeCtx(), makeCatalogs());
    expect(result.base.Power).toBe(1000);
    expect(result.base.Precision).toBe(1000);
    expect(result.base.Toughness).toBe(1000);
    expect(result.base.Vitality).toBe(1000);
    expect(result.base.Ferocity).toBe(0);
    expect(result.total.Power).toBe(1000);
  });

  test("equipment slots contribute to total", () => {
    const ctx = makeCtx({
      equipment: { slots: { chest: "Berserker's" }, weapons: {}, runes: {}, infusions: {} },
    });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.equipment.Power).toBe(141);
    expect(result.total.Power).toBe(1141);
  });

  test("food flat bonuses parsed from buff text", () => {
    const catalogs = makeCatalogs({
      foodById: new Map([[100, { name: "Steak", buff: "+100 Power" }]]),
    });
    const ctx = makeCtx({ equipment: { slots: {}, weapons: {}, runes: {}, infusions: {}, food: 100 } });
    const result = computeAttributes(ctx, catalogs);
    expect(result.food.Power).toBe(100);
  });

  test("food 'to All Attributes' adds to all stats", () => {
    const catalogs = makeCatalogs({
      foodById: new Map([[101, { name: "Feast", buff: "+50 to All Attributes" }]]),
    });
    const ctx = makeCtx({ equipment: { slots: {}, weapons: {}, runes: {}, infusions: {}, food: 101 } });
    const result = computeAttributes(ctx, catalogs);
    expect(result.food.Power).toBe(50);
    expect(result.food.Ferocity).toBe(50);
    expect(result.food.HealingPower).toBe(50);
  });

  test("rune bonuses are cumulative per piece", () => {
    const catalogs = makeCatalogs({
      runeById: new Map([[24836, { name: "Scholar", bonuses: ["+25 Power", "+35 Ferocity", "+50 Power"] }]]),
    });
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: {}, runes: { head: 24836, shoulders: 24836, chest: 24836 }, infusions: {} },
    });
    const result = computeAttributes(ctx, catalogs);
    // 3 pieces = first 3 bonuses: +25 Power, +35 Ferocity, +50 Power
    expect(result.runes.Power).toBe(75);
    expect(result.runes.Ferocity).toBe(35);
  });

  test("infusion attributes added", () => {
    const catalogs = makeCatalogs({
      infusionById: new Map([[49431, { name: "+5 Power", infixUpgrade: { attributes: [{ attribute: "Power", modifier: 5 }] } }]]),
    });
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: {}, infusions: { chest: [49431, 49431] }, runes: {} },
    });
    const result = computeAttributes(ctx, catalogs);
    expect(result.infusions.Power).toBe(10);
  });

  test("assumed Might boons add Power and ConditionDamage", () => {
    const ctx = makeCtx({ assumedBoons: { might: 25 } });
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.boons.Power).toBe(750);
    expect(result.boons.ConditionDamage).toBe(750);
  });

  test("derived health uses profession base HP", () => {
    const ctx = makeCtx({ profession: "Warrior" });
    const result = computeAttributes(ctx, makeCatalogs());
    // Warrior base HP = 9212, base Vitality = 1000, health = 9212 + 1000*10 = 19212
    expect(result.derived.health).toBe(19212);
  });

  test("derived crit chance formula", () => {
    const ctx = makeCtx();
    const result = computeAttributes(ctx, makeCatalogs());
    // Base precision 1000: critChance = 5 + (1000 - 895) / 21 = 5 + 5 = 10
    expect(result.derived.critChance).toBeCloseTo(10, 0);
  });

  test("derived armor includes weight class defense", () => {
    const ctx = makeCtx({ profession: "Warrior" });
    const result = computeAttributes(ctx, makeCatalogs());
    // Warrior = heavy = 1271 defense, base toughness 1000
    expect(result.derived.armor).toBe(2271);
  });

  test("trait conversions applied after base stats", () => {
    const catalogs = makeCatalogs({
      traitById: new Map([[500, {
        id: 500,
        facts: [{ type: "BuffConversion", source: "Vitality", target: "Power", percent: 10 }],
      }]]),
      specializationById: new Map([[4, { id: 4, minorTraits: [] }]]),
    });
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 500 } }],
    });
    const result = computeAttributes(ctx, catalogs);
    // base Vitality = 1000, 10% = floor(100) = 100
    expect(result.conversions.Power).toBe(100);
    expect(result.total.Power).toBe(1100);
  });

  test("signet passive buffs added", () => {
    const ctx = makeCtx({
      skills: { healId: null, utilityIds: [], eliteId: null },
      equipment: { slots: {}, weapons: {}, runes: {}, infusions: {} },
    });
    // Bane Signet (9093) = +180 Power
    ctx.skills.utilityIds = [9093];
    const result = computeAttributes(ctx, makeCatalogs());
    expect(result.signets.Power).toBe(180);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/attributes.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the attributes module**

Create `packages/gw2-data/src/engine/attributes.js`. Extract from `stats.js:271-505` and `equipment.js:1487-1498`.

The main function `computeAttributes(ctx, catalogs)` follows this flow:
1. Initialize `base` stats (Power/Precision/Toughness/Vitality = 1000, rest = 0)
2. Calculate `equipment` — iterate `ctx.equipment.slots`, look up combo in constants, apply slot weights (handle 2H, 3-stat, 4-stat, celestial)
3. Calculate `food` — parse `+N Stat` and `+N to All Attributes` from `catalogs.foodById.get(ctx.equipment.food)?.buff`
4. Calculate `runes` — count per rune ID, apply cumulative bonuses, parse `+N Stat` and `+N to All Stats`
5. Calculate `infusions` + `enrichment` — read `infixUpgrade.attributes`
6. Calculate `utility` — parse conversion, writ, and flat patterns from buff text
7. Calculate `signets` — look up `SIGNET_PASSIVE_BUFFS` for equipped skills
8. Compute pre-conversion totals
9. Calculate `traits` — use `collectModifiers` from modifiers module, apply non-fury flat bonuses (or all if boons assumed)
10. Calculate `conversions` — apply BuffConversion modifiers: `floor(preConvTotal[source] * percent / 100)`
11. Calculate `boons` — Might stacks × per-stack values (check for Notoriety mightModifier), fury stat bonuses
12. Calculate `sigils` — stacking sigil contributions
13. Compute `total` — sum all categories
14. Calculate `derived` — health, critChance, critDamage, conditionDuration, boonDuration, armor

Import `collectActiveTraitIds`, `collectModifiers`, `isFuryTrait` from `./modifiers`. Import constants from `./constants`. Import `loadOverrides` from `./overrides`.

Key: use `getExcludedSlots(ctx.underwaterMode, ctx.activeWeaponSet)` as a pure helper (extracted from `stats.js:226-242`).

Export: `computeAttributes`, `computeSlotStats`, `getExcludedSlots`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/attributes.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/attributes.js packages/gw2-data/tests/engine/attributes.test.js
git commit -m "feat(gw2-data): add attributes module for stat calculation pipeline (Phase 2, Task 4)"
```

---

### Task 5: Tooltips Module

**Files:**
- Create: `packages/gw2-data/src/engine/tooltips.js`
- Create: `packages/gw2-data/tests/engine/tooltips.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/tooltips.test.js
"use strict";

const { computeTooltip } = require("../../src/engine/tooltips");
const { WEAPON_STRENGTH_MIDPOINT } = require("../../src/engine/constants");

describe("computeTooltip", () => {
  const baseAttrs = {
    total: { Power: 3000, Precision: 2000, Ferocity: 900 },
    derived: { critChance: 57.6, critDamage: 210.0 },
  };

  test("computes damage from coefficient and weapon strength", () => {
    const skill = {
      id: 5489, name: "Fireball",
      facts: [{ type: "Damage", dmg_multiplier: 0.75, hit_count: 1 }],
    };
    const result = computeTooltip(baseAttrs, skill, "staff", []);
    expect(result.coefficient).toBe(0.75);
    expect(result.hits).toBe(1);
    expect(result.weaponStrength).toBe(WEAPON_STRENGTH_MIDPOINT.staff);
    expect(result.damage).toBeGreaterThan(0);
  });

  test("multi-hit skill multiplies by hit count", () => {
    const skill = {
      id: 100, name: "Multi",
      facts: [{ type: "Damage", dmg_multiplier: 0.5, hit_count: 3 }],
    };
    const result = computeTooltip(baseAttrs, skill, "sword", []);
    expect(result.hits).toBe(3);
    expect(result.totalDamage).toBe(result.damage * 3);
  });

  test("applies damage multiplier modifiers", () => {
    const skill = {
      id: 101, name: "Big Hit",
      facts: [{ type: "Damage", dmg_multiplier: 1.0, hit_count: 1 }],
    };
    const mods = [{ source: "trait:500", type: "damageMultiplier", value: 10, condition: null }];
    const withMods = computeTooltip(baseAttrs, skill, "greatsword", mods);
    const withoutMods = computeTooltip(baseAttrs, skill, "greatsword", []);
    expect(withMods.damage).toBeGreaterThan(withoutMods.damage);
  });

  test("returns null for skill with no Damage fact", () => {
    const skill = { id: 102, name: "Heal", facts: [{ type: "AttributeAdjust" }] };
    const result = computeTooltip(baseAttrs, skill, "staff", []);
    expect(result).toBeNull();
  });

  test("uses correct weapon strength for weapon type", () => {
    const skill = {
      id: 103, name: "Shot",
      facts: [{ type: "Damage", dmg_multiplier: 1.0, hit_count: 1 }],
    };
    const rifle = computeTooltip(baseAttrs, skill, "rifle", []);
    const dagger = computeTooltip(baseAttrs, skill, "dagger", []);
    expect(rifle.weaponStrength).toBe(1095.5);
    expect(dagger.weaponStrength).toBe(952.5);
    expect(rifle.damage).toBeGreaterThan(dagger.damage);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/tooltips.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the tooltips module**

```js
// packages/gw2-data/src/engine/tooltips.js
"use strict";

const { WEAPON_STRENGTH_MIDPOINT } = require("./constants");

/**
 * Compute tooltip damage for a skill.
 *
 * @param {Object} attributes - Result from computeAttributes() (needs .total and .derived)
 * @param {Object} skill - Skill object with facts array
 * @param {string} weaponType - Equipped weapon type (e.g. "greatsword", "staff")
 * @param {Object[]} modifiers - Active modifiers from collectModifiers()
 * @returns {Object|null} Tooltip result or null if skill has no Damage fact
 */
function computeTooltip(attributes, skill, weaponType, modifiers) {
  const facts = skill.facts || [];
  const damageFact = facts.find((f) => f.type === "Damage");
  if (!damageFact) return null;

  const coefficient = damageFact.dmg_multiplier || 0;
  const hits = damageFact.hit_count || 1;
  const weaponStrength = WEAPON_STRENGTH_MIDPOINT[weaponType] || 0;
  const power = attributes.total.Power || 0;

  // Target armor (standard PvE target: 2597)
  const targetArmor = 2597;

  // Collect applicable damage multipliers
  let damageMultiplier = 1;
  const appliedModifiers = [];
  for (const mod of modifiers) {
    if (mod.type === "damageMultiplier" && mod.condition === null) {
      damageMultiplier *= (1 + mod.value / 100);
      appliedModifiers.push(mod);
    }
  }

  // Effective power with crit
  const critChance = Math.min(100, attributes.derived.critChance || 0) / 100;
  const critDamage = (attributes.derived.critDamage || 150) / 100;
  const critMultiplier = 1 + critChance * (critDamage - 1);

  const damage = Math.round(
    coefficient * weaponStrength * power * damageMultiplier * critMultiplier / targetArmor
  );

  return {
    damage,
    totalDamage: damage * hits,
    coefficient,
    hits,
    weaponStrength,
    power,
    critMultiplier,
    damageMultiplier,
    modifiers: appliedModifiers,
  };
}

module.exports = { computeTooltip };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/tooltips.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/tooltips.js packages/gw2-data/tests/engine/tooltips.test.js
git commit -m "feat(gw2-data): add tooltips module for skill damage computation (Phase 2, Task 5)"
```

---

### Task 6: Interaction Graph

**Files:**
- Create: `packages/gw2-data/src/engine/graph.js`
- Create: `packages/gw2-data/tests/engine/graph.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/graph.test.js
"use strict";

const { buildInteractionGraph } = require("../../src/engine/graph");

describe("buildInteractionGraph", () => {
  test("builds graph from relations data", () => {
    const relations = new Map([
      [1444, { skills: [5489, 5507], traits: [] }],
      [1449, { skills: [], traits: [1444] }],
    ]);
    const graph = buildInteractionGraph(new Set([1444, 1449]), relations);
    expect(graph.get(1444).relatedSkills).toEqual(new Set([5489, 5507]));
    expect(graph.get(1449).relatedTraits).toEqual(new Set([1444]));
  });

  test("returns empty sets for traits with no relations", () => {
    const relations = new Map();
    const graph = buildInteractionGraph(new Set([100]), relations);
    expect(graph.get(100).relatedSkills.size).toBe(0);
    expect(graph.get(100).relatedTraits.size).toBe(0);
  });

  test("ignores traits not in activeTraitIds", () => {
    const relations = new Map([
      [999, { skills: [100], traits: [] }],
    ]);
    const graph = buildInteractionGraph(new Set([1444]), relations);
    expect(graph.has(999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/graph.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the graph module**

```js
// packages/gw2-data/src/engine/graph.js
"use strict";

/**
 * Build a trait/skill interaction graph from wiki relations data.
 *
 * @param {Set<number>} activeTraitIds - Currently active trait IDs
 * @param {Map<number, { skills: number[], traits: number[] }>} relations - Relations data per trait
 * @returns {Map<number, { relatedSkills: Set<number>, relatedTraits: Set<number> }>}
 */
function buildInteractionGraph(activeTraitIds, relations) {
  const graph = new Map();

  for (const traitId of activeTraitIds) {
    const rel = relations.get(traitId);
    graph.set(traitId, {
      relatedSkills: new Set(rel?.skills || []),
      relatedTraits: new Set(rel?.traits || []),
    });
  }

  return graph;
}

module.exports = { buildInteractionGraph };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/graph.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/graph.js packages/gw2-data/tests/engine/graph.test.js
git commit -m "feat(gw2-data): add interaction graph module (Phase 2, Task 6)"
```

---

### Task 7: Boons Module

**Files:**
- Create: `packages/gw2-data/src/engine/boons.js`
- Create: `packages/gw2-data/tests/engine/boons.test.js`

Extract from `src/renderer/modules/boon-coverage.js`.

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/boons.test.js
"use strict";

const { analyzeBoons, isAllyTargeted, normalizeName } = require("../../src/engine/boons");

describe("normalizeName", () => {
  test("normalizes Blind to Blinded", () => {
    expect(normalizeName("Blind")).toBe("Blinded");
  });

  test("normalizes Cripple to Crippled", () => {
    expect(normalizeName("Cripple")).toBe("Crippled");
  });

  test("returns unknown names unchanged", () => {
    expect(normalizeName("Might")).toBe("Might");
  });
});

describe("isAllyTargeted", () => {
  test("returns true when boon name appears in ally sentence", () => {
    expect(isAllyTargeted("Grant Might to nearby allies.", "Might", [])).toBe(true);
  });

  test("returns false when boon is in description but not with ally word", () => {
    expect(isAllyTargeted("Gain Might. Attack enemies.", "Might", [])).toBe(false);
  });

  test("returns false with no description", () => {
    expect(isAllyTargeted(null, "Might", [])).toBe(false);
  });

  test("returns true for generic ally mention when boon not named", () => {
    expect(isAllyTargeted("Grant boons to allies.", "Fury", [])).toBe(true);
  });

  test("returns false for unnamed boon when specific boons named with allies", () => {
    expect(isAllyTargeted("Grant might to allies.", "Fury", ["Might"])).toBe(false);
  });
});

describe("analyzeBoons", () => {
  test("extracts boon from skill with Buff fact", () => {
    const skills = [{
      name: "For Great Justice!",
      description: "Grant Might and Fury to yourself and allies.",
      icon: "",
      facts: [
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
        { type: "Buff", status: "Fury", apply_count: 1, duration: 8 },
      ],
    }];
    const result = analyzeBoons(skills, [], new Map());
    expect(result.boons.length).toBe(2);
    expect(result.boons.find((b) => b.name === "Might")).toBeDefined();
    expect(result.boons.find((b) => b.name === "Fury")).toBeDefined();
  });

  test("extracts condition from skill", () => {
    const skills = [{
      name: "Sword of Justice",
      description: "Create a Sword of Justice.",
      icon: "",
      facts: [{ type: "Buff", status: "Burning", apply_count: 2, duration: 3 }],
    }];
    const result = analyzeBoons(skills, [], new Map());
    expect(result.conditions.length).toBe(1);
    expect(result.conditions[0].name).toBe("Burning");
  });

  test("deduplicates by source + stacks + duration + context", () => {
    const skill = {
      name: "Skill A", description: "", icon: "",
      facts: [
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
        { type: "Buff", status: "Might", apply_count: 3, duration: 8 },
      ],
    };
    const result = analyzeBoons([skill], [], new Map());
    const might = result.boons.find((b) => b.name === "Might");
    expect(might.sources).toHaveLength(1);
  });

  test("handles NoData section context for conditional facts", () => {
    const skill = {
      name: "Skill B", description: "", icon: "",
      facts: [
        { type: "NoData", text: "On Critical Hit" },
        { type: "Buff", status: "Fury", apply_count: 1, duration: 4 },
      ],
    };
    const result = analyzeBoons([skill], [], new Map());
    const fury = result.boons.find((b) => b.name === "Fury");
    expect(fury.sources[0].context).toBe("On Critical Hit");
  });

  test("applies Twisted Medicine ally override for Elixir skills", () => {
    const overrides = new Map([
      ["trait:2220", { allyTargeted: ["elixir"] }],
    ]);
    const skills = [{
      name: "Elixir B", description: "Drink Elixir B.", icon: "",
      categories: ["Elixir"],
      facts: [{ type: "Buff", status: "Fury", apply_count: 1, duration: 5 }],
    }];
    const traits = [{ id: 2220, name: "Twisted Medicine", facts: [] }];
    const result = analyzeBoons(skills, traits, overrides, new Set([2220]));
    const fury = result.boons.find((b) => b.name === "Fury");
    expect(fury.sources[0].isAlly).toBe(true);
  });

  test("sorts boons by display order, conditions alphabetically", () => {
    const skills = [{
      name: "Multi", description: "", icon: "",
      facts: [
        { type: "Buff", status: "Vigor", apply_count: 1, duration: 5 },
        { type: "Buff", status: "Aegis", apply_count: 1, duration: 3 },
        { type: "Buff", status: "Weakness", apply_count: 1, duration: 3 },
        { type: "Buff", status: "Burning", apply_count: 1, duration: 3 },
      ],
    }];
    const result = analyzeBoons(skills, [], new Map());
    // Aegis comes before Vigor in GW2 display order
    const boonNames = result.boons.map((b) => b.name);
    expect(boonNames.indexOf("Aegis")).toBeLessThan(boonNames.indexOf("Vigor"));
    // Conditions sorted alphabetically
    const condNames = result.conditions.map((c) => c.name);
    expect(condNames).toEqual([...condNames].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/boons.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the boons module**

Create `packages/gw2-data/src/engine/boons.js`. Extract from `boon-coverage.js` lines 1-348.

Key functions to extract and make pure:
- `normalizeName(status)` — uses `CONDITION_NAME_NORMALIZE` from constants
- `isAllyTargeted(description, statusName, allBoonNames)` — pure function, no changes needed (already pure in source)
- `extractBuffFacts(entity, sourceType)` — iterates facts, checks BUFF_FACT_TYPES, normalizes names, classifies ally targeting
- `analyzeBoons(skills, traits, overrides, activeTraitIds)` — replaces `computeBoonCoverage`. Takes arrays of resolved skill/trait objects instead of catalog + editor. Handles Twisted Medicine via overrides. Groups, deduplicates, sorts.

Do NOT extract `collectSkillIds`, `collectTraitIds`, or `computePartyCoverage` — those involve build context resolution which stays in the StatEngine wrapper (Task 9).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/boons.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/boons.js packages/gw2-data/tests/engine/boons.test.js
git commit -m "feat(gw2-data): add boons module for buff/condition analysis (Phase 2, Task 7)"
```

---

### Task 8: Combos Module

**Files:**
- Create: `packages/gw2-data/src/engine/combos.js`
- Create: `packages/gw2-data/tests/engine/combos.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/combos.test.js
"use strict";

const { analyzeCombos } = require("../../src/engine/combos");

describe("analyzeCombos", () => {
  test("extracts combo field from skill facts", () => {
    const skills = [{
      name: "Flame Wall", icon: "", description: "", facts: [
        { type: "ComboField", field_type: "Fire" },
        { type: "Time", duration: 5 },
        { type: "Radius", distance: 240 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]).toMatchObject({
      fieldType: "Fire", sourceName: "Flame Wall", duration: 5, radius: 240,
    });
  });

  test("extracts combo finisher from skill facts", () => {
    const skills = [{
      name: "Mighty Blow", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Blast", percent: 100 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers).toHaveLength(1);
    expect(result.finishers[0]).toMatchObject({
      finisherType: "Blast", sourceName: "Mighty Blow", hitCount: 1, percent: 100,
    });
  });

  test("groups multiple finishers of same type on one skill", () => {
    const skills = [{
      name: "Whirling Strike", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Whirl" },
        { type: "ComboFinisher", finisher_type: "Whirl" },
        { type: "ComboFinisher", finisher_type: "Whirl" },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers).toHaveLength(1);
    expect(result.finishers[0].hitCount).toBe(3);
  });

  test("deduplicates fields by (type, sourceName)", () => {
    const skills = [
      { name: "Flame Wall", icon: "", description: "", facts: [{ type: "ComboField", field_type: "Fire" }] },
      { name: "Flame Wall", icon: "", description: "", facts: [{ type: "ComboField", field_type: "Fire" }] },
    ];
    const result = analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
  });

  test("extracts fields from traits too", () => {
    const traits = [{
      name: "Healing Trait", icon: "", description: "", facts: [
        { type: "ComboField", field_type: "Water" },
      ],
    }];
    const result = analyzeCombos([], traits);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].fieldType).toBe("Water");
  });

  test("tracks finisher percent below 100", () => {
    const skills = [{
      name: "Leap", icon: "", description: "", facts: [
        { type: "ComboFinisher", finisher_type: "Leap", percent: 50 },
      ],
    }];
    const result = analyzeCombos(skills, []);
    expect(result.finishers[0].percent).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/combos.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the combos module**

```js
// packages/gw2-data/src/engine/combos.js
"use strict";

/**
 * Extract combo field facts from an entity.
 * Pulls Duration and Radius from adjacent facts for metadata.
 */
function extractComboFields(entity, sourceType) {
  const results = [];
  const facts = entity.facts || [];
  let duration = 0;
  let radius = 0;

  for (const fact of facts) {
    if ((fact.type === "Duration" || fact.type === "Time") && fact.duration) {
      duration = fact.duration;
    }
    if (fact.type === "Radius" && fact.distance) {
      radius = fact.distance;
    }
  }

  for (const fact of facts) {
    if (fact.type !== "ComboField" || !fact.field_type) continue;
    results.push({
      fieldType: fact.field_type,
      sourceType,
      sourceName: entity.name || "",
      duration,
      radius,
    });
  }
  return results;
}

/**
 * Extract combo finisher facts from an entity.
 * Groups by finisher type, counts hits.
 */
function extractComboFinishers(entity, sourceType) {
  const results = [];
  const facts = entity.facts || [];

  const byType = new Map();
  for (const fact of facts) {
    if (fact.type !== "ComboFinisher" || !fact.finisher_type) continue;
    const ft = fact.finisher_type;
    if (!byType.has(ft)) byType.set(ft, { count: 0, percent: 100 });
    const entry = byType.get(ft);
    entry.count++;
    if (fact.percent != null && fact.percent < 100) {
      entry.percent = fact.percent;
    }
  }

  for (const [finisherType, data] of byType) {
    results.push({
      finisherType,
      sourceType,
      sourceName: entity.name || "",
      hitCount: data.count,
      percent: data.percent,
    });
  }
  return results;
}

/**
 * Analyze combo fields and finishers from resolved skills and traits.
 *
 * @param {Object[]} skills - Resolved skill objects with facts
 * @param {Object[]} traits - Resolved trait objects with facts
 * @returns {{ fields: Object[], finishers: Object[] }}
 */
function analyzeCombos(skills, traits) {
  const allFields = [];
  const allFinishers = [];

  for (const skill of skills) {
    if (!skill) continue;
    allFields.push(...extractComboFields(skill, "skill"));
    allFinishers.push(...extractComboFinishers(skill, "skill"));
  }

  for (const trait of traits) {
    if (!trait) continue;
    allFields.push(...extractComboFields(trait, "trait"));
    allFinishers.push(...extractComboFinishers(trait, "trait"));
  }

  // Deduplicate fields by (fieldType, sourceName)
  const fieldMap = new Map();
  for (const f of allFields) {
    const key = `${f.fieldType}|${f.sourceName}`;
    if (!fieldMap.has(key)) fieldMap.set(key, f);
  }

  // Deduplicate finishers by (finisherType, sourceName)
  const finisherMap = new Map();
  for (const f of allFinishers) {
    const key = `${f.finisherType}|${f.sourceName}`;
    if (!finisherMap.has(key)) finisherMap.set(key, f);
  }

  return {
    fields: [...fieldMap.values()],
    finishers: [...finisherMap.values()],
  };
}

module.exports = { analyzeCombos };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/combos.test.js --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gw2-data/src/engine/combos.js packages/gw2-data/tests/engine/combos.test.js
git commit -m "feat(gw2-data): add combos module for field/finisher analysis (Phase 2, Task 8)"
```

---

### Task 9: Public API (StatEngine + Exports)

**Files:**
- Create: `packages/gw2-data/src/engine/index.js`
- Modify: `packages/gw2-data/src/index.js`
- Create: `packages/gw2-data/tests/engine/integration.test.js`

- [ ] **Step 1: Write the failing test**

```js
// packages/gw2-data/tests/engine/integration.test.js
"use strict";

const { StatEngine } = require("../../src/engine");
const { loadOverrides } = require("../../src/engine/overrides");

function makeCatalogs() {
  return {
    traitById: new Map(),
    skillById: new Map(),
    specializationById: new Map(),
    runeById: new Map(),
    foodById: new Map(),
    utilityById: new Map(),
    infusionById: new Map(),
    enrichmentById: new Map(),
  };
}

function makeCtx(overrides = {}) {
  return {
    profession: "Warrior",
    specializations: [],
    equipment: { slots: {}, weapons: {}, runes: {}, infusions: {} },
    gameMode: "pve",
    underwaterMode: false,
    activeWeaponSet: 1,
    skills: {},
    assumedBoons: null,
    sigilStacks: null,
    ...overrides,
  };
}

describe("StatEngine", () => {
  test("constructs with catalogs", () => {
    const engine = new StatEngine(makeCatalogs());
    expect(engine).toBeDefined();
  });

  test("computeAttributes returns full breakdown", () => {
    const engine = new StatEngine(makeCatalogs());
    const result = engine.computeAttributes(makeCtx());
    expect(result.base.Power).toBe(1000);
    expect(result.total.Power).toBe(1000);
    expect(result.derived.health).toBe(19212);
  });

  test("collectModifiers returns array", () => {
    const engine = new StatEngine(makeCatalogs());
    const mods = engine.collectModifiers(makeCtx());
    expect(Array.isArray(mods)).toBe(true);
  });

  test("computeTooltip returns damage for valid skill", () => {
    const catalogs = makeCatalogs();
    const engine = new StatEngine(catalogs);
    const skill = { id: 1, name: "Slash", facts: [{ type: "Damage", dmg_multiplier: 0.8, hit_count: 1 }] };
    const ctx = makeCtx({
      equipment: { slots: {}, weapons: { mainhand1: "sword" }, runes: {}, infusions: {} },
    });
    const result = engine.computeTooltip(ctx, skill, "sword");
    expect(result).toBeDefined();
    expect(result.damage).toBeGreaterThan(0);
  });

  test("analyzeBoons returns boons and conditions arrays", () => {
    const engine = new StatEngine(makeCatalogs());
    const skills = [{
      name: "Shout", description: "Grant might to allies.", icon: "",
      facts: [{ type: "Buff", status: "Might", apply_count: 3, duration: 8 }],
    }];
    const result = engine.analyzeBoons(skills, []);
    expect(result.boons).toHaveLength(1);
    expect(result.boons[0].name).toBe("Might");
  });

  test("analyzeCombos returns fields and finishers arrays", () => {
    const engine = new StatEngine(makeCatalogs());
    const skills = [{
      name: "Flame Wall", icon: "", description: "",
      facts: [{ type: "ComboField", field_type: "Fire" }],
    }];
    const result = engine.analyzeCombos(skills, []);
    expect(result.fields).toHaveLength(1);
  });

  test("full pipeline: equip gear, compute attributes, get tooltip", () => {
    const catalogs = makeCatalogs();
    catalogs.specializationById.set(4, { id: 4, minorTraits: [] });
    catalogs.traitById.set(1444, {
      id: 1444, facts: [{ type: "AttributeAdjust", target: "Power", value: 150 }],
    });

    const engine = new StatEngine(catalogs);
    const ctx = makeCtx({
      specializations: [{ id: 4, majorChoices: { 1: 1444 } }],
      equipment: {
        slots: { chest: "Berserker's", legs: "Berserker's" },
        weapons: { mainhand1: "greatsword" },
        runes: {}, infusions: {},
      },
    });

    const attrs = engine.computeAttributes(ctx);
    expect(attrs.total.Power).toBeGreaterThan(1000);
    expect(attrs.traits.Power).toBe(150);

    const skill = { id: 5489, name: "Fireball", facts: [{ type: "Damage", dmg_multiplier: 0.75, hit_count: 1 }] };
    const tooltip = engine.computeTooltip(ctx, skill, "greatsword");
    expect(tooltip.damage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest packages/gw2-data/tests/engine/integration.test.js --no-coverage`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the engine index module**

```js
// packages/gw2-data/src/engine/index.js
"use strict";

const { computeAttributes, computeSlotStats, getExcludedSlots } = require("./attributes");
const { collectModifiers, collectActiveTraitIds, isFuryTrait } = require("./modifiers");
const { computeTooltip } = require("./tooltips");
const { buildInteractionGraph } = require("./graph");
const { analyzeBoons, isAllyTargeted, normalizeName } = require("./boons");
const { analyzeCombos } = require("./combos");
const { loadOverrides, getOverride } = require("./overrides");

class StatEngine {
  /**
   * @param {Object} catalogs - GW2 API catalog data
   * @param {Map} [overrides] - Override map (auto-loaded if not provided)
   */
  constructor(catalogs, overrides) {
    this._catalogs = catalogs;
    this._overrides = overrides || loadOverrides();
  }

  computeAttributes(ctx) {
    return computeAttributes(ctx, this._catalogs);
  }

  collectModifiers(ctx) {
    return collectModifiers(ctx, this._catalogs, this._overrides);
  }

  computeTooltip(ctx, skill, weaponType) {
    const attrs = this.computeAttributes(ctx);
    const mods = this.collectModifiers(ctx);
    return computeTooltip(attrs, skill, weaponType, mods);
  }

  analyzeBoons(skills, traits, activeTraitIds) {
    return analyzeBoons(skills, traits, this._overrides, activeTraitIds);
  }

  analyzeCombos(skills, traits) {
    return analyzeCombos(skills, traits);
  }
}

module.exports = {
  StatEngine,
  // Re-export individual modules for direct use
  computeAttributes,
  computeSlotStats,
  getExcludedSlots,
  collectModifiers,
  collectActiveTraitIds,
  isFuryTrait,
  computeTooltip,
  buildInteractionGraph,
  analyzeBoons,
  isAllyTargeted,
  normalizeName,
  analyzeCombos,
  loadOverrides,
  getOverride,
};
```

- [ ] **Step 4: Update package index.js to export engine**

Add engine exports to `packages/gw2-data/src/index.js`:

```js
// Add at the top with other requires:
const engine = require("./engine");

// Add to module.exports:
  // Engine
  StatEngine: engine.StatEngine,
  computeAttributes: engine.computeAttributes,
  computeSlotStats: engine.computeSlotStats,
  collectModifiers: engine.collectModifiers,
  computeTooltip: engine.computeTooltip,
  analyzeBoons: engine.analyzeBoons,
  analyzeCombos: engine.analyzeCombos,
  loadOverrides: engine.loadOverrides,
  buildInteractionGraph: engine.buildInteractionGraph,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest packages/gw2-data/tests/engine/integration.test.js --no-coverage`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass (previous Phase 1 tests + all new engine tests)

- [ ] **Step 7: Commit**

```bash
git add packages/gw2-data/src/engine/index.js packages/gw2-data/src/index.js packages/gw2-data/tests/engine/integration.test.js
git commit -m "feat(gw2-data): add StatEngine wrapper and public API (Phase 2, Task 9)"
```

---

### Task 10: Update Package Exports

**Files:**
- Modify: `packages/gw2-data/package.json`

- [ ] **Step 1: Add engine export path to package.json**

Add the engine subpath export to `packages/gw2-data/package.json` in the `"exports"` field:

```json
"./engine": "./src/engine/index.js"
```

This allows consumers to import via `require("@axi/gw2-data/engine")`.

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/gw2-data/package.json
git commit -m "feat(gw2-data): add engine subpath export (Phase 2, Task 10)"
```
