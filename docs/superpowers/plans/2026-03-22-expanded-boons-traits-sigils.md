# Expanded Boons, Trait Conversions & Stacking Sigils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the "Assumed Boons" bar to include all 12 GW2 boons (collapsed by default), add trait AttributeConversion stat contributions, and add stacking sigil support with interactive stack controls.

**Architecture:** Three independent feature chunks that build on each other. Chunk 1 adds the remaining 9 boons behind an expand toggle. Chunk 2 reads active trait `AttributeConversion` facts from the catalog and applies them as a new stat source in `computeEquipmentStats`. Chunk 3 detects equipped stacking sigils from the upgrade catalog, surfaces them in the boons bar as stackable items, and feeds their stat contributions into the stat engine.

**Tech Stack:** Vanilla JS (imperative DOM), CSS (max-height transitions for expand), Jest unit tests.

---

## Chunk 1: Expand All Boons

### Task 1: Add new boon keys to state and constants

**Files:**
- Modify: `src/renderer/modules/equipment.js:27-29` (\_assumedBoons + resetAssumedBoons)
- Modify: `src/renderer/modules/constants.js` (add STABILITY_MAX_STACKS)

- [ ] **Step 1: Write failing test — new boons exist in assumedBoons and don't affect stats**

In `tests/unit/renderer/assumed-boons.test.js`, append after line 99:

```js
describe("computeEquipmentStats — extended boons", () => {
  test("toggling non-stat boons does not change any attribute", () => {
    const baseline = computeEquipmentStats();
    const extended = computeEquipmentStats({
      might: 0, fury: false, alacrity: false,
      quickness: false, protection: false, regeneration: false,
      resolution: false, resistance: false, stability: 0,
      swiftness: false, vigor: false, aegis: false,
    });
    for (const key of Object.keys(baseline)) {
      expect(extended[key]).toBe(baseline[key]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes (these boons have no stat effect, test should pass already)**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: PASS — `computeEquipmentStats` ignores unknown keys in the boons object.

- [ ] **Step 3: Expand \_assumedBoons state and reset function**

In `src/renderer/modules/equipment.js`, replace lines 27-29:

```js
let _assumedBoons = { might: 0, fury: false, alacrity: false };
export function getAssumedBoons() { return _assumedBoons; }
export function resetAssumedBoons() { _assumedBoons = { might: 0, fury: false, alacrity: false }; }
```

With:

```js
let _assumedBoons = {
  might: 0, fury: false, alacrity: false,
  quickness: false, protection: false, regeneration: false,
  resolution: false, resistance: false, stability: 0,
  swiftness: false, vigor: false, aegis: false,
};
export function getAssumedBoons() { return _assumedBoons; }
export function resetAssumedBoons() {
  _assumedBoons = {
    might: 0, fury: false, alacrity: false,
    quickness: false, protection: false, regeneration: false,
    resolution: false, resistance: false, stability: 0,
    swiftness: false, vigor: false, aegis: false,
  };
}
```

- [ ] **Step 4: Add STABILITY_MAX_STACKS constant**

In `src/renderer/modules/constants.js`, after line 504 (`export const FURY_CRIT_CHANCE = 25;`), add:

```js
export const STABILITY_MAX_STACKS = 25;
```

- [ ] **Step 5: Run tests to confirm nothing broke**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/equipment.js src/renderer/modules/constants.js tests/unit/renderer/assumed-boons.test.js
git commit -m "feat: expand assumedBoons state with all 12 GW2 boons"
```

### Task 2: Expand BOON_DEFS and add expand/collapse toggle

**Files:**
- Modify: `src/renderer/modules/equipment.js:1149-1153` (BOON_DEFS array)
- Modify: `src/renderer/modules/equipment.js:1119-1249` (boons section rendering — add expand toggle)
- Modify: `src/renderer/modules/constants.js:1` (import STABILITY_MAX_STACKS)

- [ ] **Step 1: Import STABILITY_MAX_STACKS in equipment.js**

In `src/renderer/modules/equipment.js`, update the constants import (line ~10) to add `STABILITY_MAX_STACKS`:

```js
  FURY_CRIT_CHANCE, MIGHT_MAX_STACKS, MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK, STABILITY_MAX_STACKS, BOON_CONDITION_ICONS,
```

- [ ] **Step 2: Expand BOON_DEFS array**

Replace the BOON_DEFS array at line ~1149:

```js
  const BOON_DEFS = [
    { key: "might", label: "Might", icon: BOON_CONDITION_ICONS.Might, stackable: true },
    { key: "fury", label: "Fury", icon: BOON_CONDITION_ICONS.Fury, stackable: false },
    { key: "alacrity", label: "Alacrity", icon: BOON_CONDITION_ICONS.Alacrity, stackable: false },
  ];
```

With:

```js
  const BOON_DEFS = [
    // Always-visible boons (core 3)
    { key: "might", label: "Might", icon: BOON_CONDITION_ICONS.Might, stackable: true, maxStacks: MIGHT_MAX_STACKS, core: true },
    { key: "fury", label: "Fury", icon: BOON_CONDITION_ICONS.Fury, stackable: false, core: true },
    { key: "alacrity", label: "Alacrity", icon: BOON_CONDITION_ICONS.Alacrity, stackable: false, core: true },
    // Expandable boons
    { key: "quickness", label: "Quickness", icon: BOON_CONDITION_ICONS.Quickness, stackable: false },
    { key: "protection", label: "Protection", icon: BOON_CONDITION_ICONS.Protection, stackable: false },
    { key: "regeneration", label: "Regen", icon: BOON_CONDITION_ICONS.Regeneration, stackable: false },
    { key: "resolution", label: "Resolution", icon: BOON_CONDITION_ICONS.Resolution, stackable: false },
    { key: "resistance", label: "Resistance", icon: BOON_CONDITION_ICONS.Resistance, stackable: false },
    { key: "stability", label: "Stability", icon: BOON_CONDITION_ICONS.Stability, stackable: true, maxStacks: STABILITY_MAX_STACKS },
    { key: "swiftness", label: "Swiftness", icon: BOON_CONDITION_ICONS.Swiftness, stackable: false },
    { key: "vigor", label: "Vigor", icon: BOON_CONDITION_ICONS.Vigor, stackable: false },
    { key: "aegis", label: "Aegis", icon: BOON_CONDITION_ICONS.Aegis, stackable: false },
  ];
```

- [ ] **Step 3: Add module-level expand state**

Near line 27 in equipment.js, after the `_assumedBoons` declaration, add:

```js
let _boonsExpanded = false;
```

- [ ] **Step 4: Add expand toggle button to boons header**

In the boons section rendering (after `boonsHeader.append(helpIcon)` at line ~1143), add an expand toggle button:

```js
  const expandBtn = document.createElement("button");
  expandBtn.className = "equip-boons__expand-btn";
  expandBtn.textContent = _boonsExpanded ? "Less ▲" : "More ▼";
  expandBtn.title = _boonsExpanded ? "Show core boons only" : "Show all boons";
  expandBtn.addEventListener("click", () => {
    _boonsExpanded = !_boonsExpanded;
    _render();
  });
  boonsHeader.append(expandBtn);
```

- [ ] **Step 5: Split boons bar into core + expandable sections**

Replace lines ~1146-1148 (the `boonsBar` creation, before BOON_DEFS which was already replaced in Step 2) and lines ~1186-1249 (from `for (const def of BOON_DEFS)` through `boonsSection.append(boonsBar)`) with the following. Keep the `getDelta` function (lines ~1155-1159) and `buildBoonTooltipHTML` function (lines ~1161-1184) intact — they sit between the BOON_DEFS array and the for loop, and `buildBoonTooltipHTML` will be replaced in Step 6:

```js
  const boonsBar = document.createElement("div");
  boonsBar.className = "equip-boons__bar";

  const boonsExpand = document.createElement("div");
  boonsExpand.className = "equip-boons__expand" + (_boonsExpanded ? " equip-boons__expand--open" : "");

  for (const def of BOON_DEFS) {
    const item = document.createElement("div");
    item.className = "equip-boons__item";

    const iconWrap = document.createElement("div");
    const isActive = def.stackable ? _assumedBoons[def.key] > 0 : _assumedBoons[def.key];
    iconWrap.className = "equip-boons__icon" + (isActive ? " equip-boons__icon--on" : "");

    const img = document.createElement("img");
    img.src = def.icon;
    img.alt = def.label;
    img.width = 28;
    img.height = 28;
    iconWrap.append(img);

    // Stack badge (stackable boons)
    if (def.stackable) {
      const badge = document.createElement("div");
      badge.className = "equip-boons__badge";
      badge.textContent = _assumedBoons[def.key] || "";
      if (!_assumedBoons[def.key]) badge.style.display = "none";
      iconWrap.append(badge);
    }

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "equip-boons__tooltip";
    tooltip.innerHTML = buildBoonTooltipHTML(def);
    item.append(tooltip);

    // Click handler
    if (def.stackable) {
      const max = def.maxStacks || MIGHT_MAX_STACKS;
      iconWrap.addEventListener("click", (e) => {
        _assumedBoons[def.key] = Math.min(max, Math.max(0, _assumedBoons[def.key] + getDelta(e)));
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _assumedBoons[def.key] = Math.min(max, Math.max(0, _assumedBoons[def.key] - getDelta(e)));
        _render();
      });
    } else {
      iconWrap.addEventListener("click", () => {
        _assumedBoons[def.key] = !_assumedBoons[def.key];
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _assumedBoons[def.key] = !_assumedBoons[def.key];
        _render();
      });
    }

    item.append(iconWrap);

    const label = document.createElement("div");
    label.className = "equip-boons__label" + (isActive ? " equip-boons__label--on" : "");
    label.textContent = def.label;
    item.append(label);

    // Core boons go in main bar, others in expandable section
    if (def.core) {
      boonsBar.append(item);
    } else {
      boonsExpand.append(item);
    }
  }

  boonsSection.append(boonsBar);
  boonsSection.append(boonsExpand);
```

- [ ] **Step 6: Update buildBoonTooltipHTML for new boons**

Replace the `buildBoonTooltipHTML` function with an expanded version that handles all boons:

```js
  function buildBoonTooltipHTML(def) {
    const val = _assumedBoons[def.key];
    if (def.key === "might") {
      if (val > 0) {
        const power = val * MIGHT_POWER_PER_STACK;
        const condi = val * MIGHT_CONDI_PER_STACK;
        return `<div class="equip-boons__tip-title">Might ×${val}</div>` +
          `<div class="equip-boons__tip-effect">+${power} Power</div>` +
          `<div class="equip-boons__tip-effect">+${condi} Condition Damage</div>` +
          `<div class="equip-boons__tip-note">+${MIGHT_POWER_PER_STACK} Power and +${MIGHT_CONDI_PER_STACK} Condition Damage per stack (max ${MIGHT_MAX_STACKS})</div>`;
      }
      return `<div class="equip-boons__tip-title">Might</div>` +
        `<div class="equip-boons__tip-note">Click to add stacks. +${MIGHT_POWER_PER_STACK} Power and +${MIGHT_CONDI_PER_STACK} Condition Damage per stack (max ${MIGHT_MAX_STACKS}).</div>`;
    }
    if (def.key === "fury") {
      return val
        ? '<div class="equip-boons__tip-title">Fury</div><div class="equip-boons__tip-effect">+25% Critical Chance</div><div class="equip-boons__tip-note">Added to Crit Chance derived stat</div>'
        : '<div class="equip-boons__tip-title">Fury</div><div class="equip-boons__tip-note">Click to enable. Grants +25% Critical Chance.</div>';
    }
    if (def.key === "alacrity") {
      return val
        ? '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-effect">\u221225% Skill Cooldown</div><div class="equip-boons__tip-note">Cooldown reduction shown in skill tooltips</div>'
        : '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-note">Click to enable. Reduces skill cooldowns by 25%.</div>';
    }
    if (def.key === "stability") {
      if (val > 0) {
        return `<div class="equip-boons__tip-title">Stability ×${val}</div>` +
          `<div class="equip-boons__tip-effect">Cannot be knocked down, pushed back, pulled, launched, stunned, dazed, floated, sunk, feared, or taunted</div>` +
          `<div class="equip-boons__tip-note">1 stack removed per incoming CC (max ${STABILITY_MAX_STACKS})</div>`;
      }
      return `<div class="equip-boons__tip-title">Stability</div>` +
        `<div class="equip-boons__tip-note">Click to add stacks. Prevents crowd control effects. 1 stack consumed per incoming CC (max ${STABILITY_MAX_STACKS}).</div>`;
    }
    // Simple toggle boons — generic tooltip
    const BOON_DESCRIPTIONS = {
      quickness: { effect: "+50% Animation Speed", note: "Actions and casts are faster" },
      protection: { effect: "\u221233% Incoming Strike Damage", note: "Reduces strike damage taken" },
      regeneration: { effect: "Heal Over Time", note: "Regenerates health every second" },
      resolution: { effect: "\u221233% Incoming Condition Damage", note: "Reduces condition damage taken" },
      resistance: { effect: "Negate Conditions", note: "Conditions have no effect while active" },
      swiftness: { effect: "+33% Movement Speed", note: "Increases movement speed" },
      vigor: { effect: "+50% Endurance Regeneration", note: "Dodge bar refills faster" },
      aegis: { effect: "Block Next Attack", note: "Blocks the next incoming strike" },
    };
    const info = BOON_DESCRIPTIONS[def.key];
    if (!info) return `<div class="equip-boons__tip-title">${def.label}</div>`;
    return val
      ? `<div class="equip-boons__tip-title">${def.label}</div><div class="equip-boons__tip-effect">${info.effect}</div><div class="equip-boons__tip-note">${info.note}</div>`
      : `<div class="equip-boons__tip-title">${def.label}</div><div class="equip-boons__tip-note">Click to enable. ${info.note}.</div>`;
  }
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/equipment.js src/renderer/modules/constants.js
git commit -m "feat: add all 12 boons to bar with expand/collapse toggle"
```

### Task 3: Add expand/collapse CSS

**Files:**
- Modify: `src/renderer/styles/equipment.css`

- [ ] **Step 1: Add CSS for expand button and expandable boon section**

After the `.equip-boons__tip-note` block (~line 1172) in `equipment.css`, add:

```css
.equip-boons__expand-btn {
  background: none;
  border: 1px solid var(--line-soft);
  border-radius: 4px;
  color: var(--muted);
  font-size: 9px;
  padding: 1px 6px;
  cursor: pointer;
  margin-left: auto;
  transition: color 0.15s, border-color 0.15s;
}

.equip-boons__expand-btn:hover {
  color: var(--text);
  border-color: var(--line);
}

.equip-boons__expand {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  flex-wrap: wrap;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease, margin-top 0.2s ease;
  margin-top: 0;
}

.equip-boons__expand--open {
  max-height: 200px;
  opacity: 1;
  margin-top: 8px;
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/equipment.css
git commit -m "feat: add expand/collapse CSS for boons bar"
```

---

## Chunk 2: Trait AttributeConversion Support

### Task 4: Add trait conversion computation to stats.js

**Files:**
- Modify: `src/renderer/modules/stats.js` (add `computeTraitConversions` function, integrate into `computeEquipmentStats`)
- Test: `tests/unit/renderer/assumed-boons.test.js` (add trait conversion tests)

The GW2 API provides `AttributeConversion` facts on traits: `{ source, target, percent }`. When a trait is active (selected in specializations), its conversions should apply to stat totals. The conversion reads the **base stat** (before conversions) and adds `floor(base * percent / 100)` to the target stat.

API target names differ from stat keys — mapping:
- `BoonDuration` → `Concentration`
- `ConditionDuration` → `Expertise`
- `CritDamage` → `Ferocity`
- `Healing` → `HealingPower`
- All others (Power, Precision, Toughness, Vitality, ConditionDamage) → direct match

- [ ] **Step 1: Write failing test — trait conversions affect stats**

In `tests/unit/renderer/assumed-boons.test.js`, add at the end of the file:

```js
const { computeTraitConversions } = require("../../../src/renderer/modules/stats");

describe("computeTraitConversions", () => {
  beforeEach(() => {
    state.editor = makeEditor({ chest: "Berserker's" });
    state.upgradeCatalog = null;
  });

  test("returns empty object when no specializations selected", () => {
    state.editor.specializations = [];
    state.catalog = { traitById: new Map() };
    const result = computeTraitConversions({});
    expect(result).toEqual({});
  });

  test("applies a simple Power → Vitality 10% conversion", () => {
    // Simulate a trait with AttributeConversion: 10% Power → Vitality
    const fakeTrait = {
      id: 9999,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[9999, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 9999 } },
    ];
    const baseStats = { Power: 1000, Vitality: 500 };
    const result = computeTraitConversions(baseStats);
    expect(result.Vitality).toBe(100); // floor(1000 * 10 / 100)
  });

  test("maps BoonDuration target to Concentration", () => {
    const fakeTrait = {
      id: 8888,
      facts: [{ type: "AttributeConversion", source: "Power", target: "BoonDuration", percent: 13 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[8888, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 2: 8888 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result.Concentration).toBe(130); // floor(1000 * 13 / 100)
  });

  test("maps CritDamage target to Ferocity", () => {
    const fakeTrait = {
      id: 7777,
      facts: [{ type: "AttributeConversion", source: "Precision", target: "CritDamage", percent: 10 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[7777, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 7777 } },
    ];
    const result = computeTraitConversions({ Precision: 2000 });
    expect(result.Ferocity).toBe(200);
  });

  test("maps ConditionDuration target to Expertise", () => {
    const fakeTrait = {
      id: 6666,
      facts: [{ type: "AttributeConversion", source: "Precision", target: "ConditionDuration", percent: 7 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[6666, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 6666 } },
    ];
    const result = computeTraitConversions({ Precision: 1000 });
    expect(result.Expertise).toBe(70);
  });

  test("maps Healing target to HealingPower", () => {
    const fakeTrait = {
      id: 5555,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Healing", percent: 7 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[5555, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 5555 } },
    ];
    const result = computeTraitConversions({ Power: 2000 });
    expect(result.HealingPower).toBe(140);
  });

  test("ignores traits not selected in majorChoices", () => {
    const fakeTrait = {
      id: 4444,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[4444, fakeTrait]]) };
    // Trait 4444 exists in catalog but is NOT selected
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 1111 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result).toEqual({});
  });

  test("multiple conversions from same trait stack additively", () => {
    const fakeTrait = {
      id: 3333,
      facts: [
        { type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 },
        { type: "AttributeConversion", source: "Power", target: "CritDamage", percent: 10 },
      ],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[3333, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 3333 } },
    ];
    const result = computeTraitConversions({ Power: 1000 });
    expect(result.Vitality).toBe(100);
    expect(result.Ferocity).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: FAIL — `computeTraitConversions` is not exported.

- [ ] **Step 3: Implement computeTraitConversions in stats.js**

In `src/renderer/modules/stats.js`, add the following function after the existing imports:

```js
/**
 * Map GW2 API AttributeConversion target names to our stat keys.
 * The API uses derived-stat names for some targets.
 */
const CONVERSION_TARGET_MAP = {
  BoonDuration: "Concentration",
  ConditionDuration: "Expertise",
  CritDamage: "Ferocity",
  Healing: "HealingPower",
};

/**
 * Compute stat bonuses from active trait AttributeConversion facts.
 * Reads base stats (before conversions) and returns a map of bonus stats to add.
 * Formula per conversion: floor(baseStatValue * percent / 100)
 *
 * @param {Object} baseStats - Current stat totals (before trait conversions)
 * @returns {Object} bonuses - Map of stat key → bonus value to add
 */
export function computeTraitConversions(baseStats) {
  const bonuses = {};
  const catalog = state.catalog;
  if (!catalog?.traitById) return bonuses;

  // Collect active trait IDs from selected specializations
  const activeTraitIds = new Set(
    (state.editor.specializations || [])
      .flatMap((s) => Object.values(s?.majorChoices || {}))
      .map(Number)
      .filter(Boolean)
  );
  if (!activeTraitIds.size) return bonuses;

  for (const traitId of activeTraitIds) {
    const trait = catalog.traitById.get(traitId);
    if (!trait?.facts) continue;
    for (const fact of trait.facts) {
      // Only process AttributeConversion facts — other fact types (Buff, etc.)
      // may coincidentally have source/target/percent fields.
      if (fact.type !== "AttributeConversion") continue;
      if (!fact.source || !fact.target || !fact.percent) continue;
      const sourceVal = baseStats[fact.source] || 0;
      if (!sourceVal) continue;
      const targetKey = CONVERSION_TARGET_MAP[fact.target] || fact.target;
      const bonus = Math.floor(sourceVal * fact.percent / 100);
      bonuses[targetKey] = (bonuses[targetKey] || 0) + bonus;
    }
  }

  return bonuses;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/stats.js tests/unit/renderer/assumed-boons.test.js
git commit -m "feat: add computeTraitConversions for trait AttributeConversion facts"
```

### Task 5: Integrate trait conversions into equipment stats and display

**Files:**
- Modify: `src/renderer/modules/stats.js:220-224` (apply trait conversions in computeEquipmentStats)
- Modify: `src/renderer/modules/stats.js:512-522` (add trait conversions to breakdown)
- Modify: `src/renderer/modules/equipment.js:1253-1286` (highlight trait-boosted stats)

- [ ] **Step 1: Write failing test — trait conversions appear in computeEquipmentStats totals**

In `tests/unit/renderer/assumed-boons.test.js`, add:

```js
describe("computeEquipmentStats — trait conversions integrated", () => {
  test("trait conversion adds to stat totals", () => {
    state.editor = makeEditor({ chest: "Berserker's" }); // Adds Power
    const fakeTrait = {
      id: 9999,
      facts: [{ type: "AttributeConversion", source: "Power", target: "Vitality", percent: 10 }],
      traitedFacts: [],
    };
    state.catalog = { traitById: new Map([[9999, fakeTrait]]) };
    state.editor.specializations = [
      { specializationId: 1, majorChoices: { 1: 9999 } },
    ];
    const withTrait = computeEquipmentStats();
    // Remove trait to get baseline
    state.editor.specializations = [];
    const baseline = computeEquipmentStats();
    // Vitality should be higher with the trait
    expect(withTrait.Vitality).toBeGreaterThan(baseline.Vitality);
    // Power should be the same (source is not increased by conversion)
    expect(withTrait.Power).toBe(baseline.Power);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: FAIL — trait conversions not yet integrated into `computeEquipmentStats`.

- [ ] **Step 3: Apply trait conversions in computeEquipmentStats**

In `src/renderer/modules/stats.js`, in the `computeEquipmentStats` function, after the assumed boons block (after line ~224, before `return totals;`), add:

```js
  // Trait AttributeConversion contributions
  const traitBonuses = computeTraitConversions(totals);
  for (const [key, bonus] of Object.entries(traitBonuses)) {
    totals[key] = (totals[key] || 0) + bonus;
  }
```

- [ ] **Step 4: Add trait conversions to stat breakdown**

In `computeStatBreakdown`, after the assumed boon contributions block (after line ~523, before `return entries;`), add:

```js
  // Trait conversion contributions
  // Compute full stat totals to use as the base for conversions.
  // The `totals` variable at line 484 is block-scoped inside the utility block
  // and not accessible here, so we call computeEquipmentStats directly.
  const traitBase = computeEquipmentStats(assumedBoons);
  const traitBonuses = computeTraitConversions(traitBase);
  if (traitBonuses[statKey]) {
    entries.push({ source: "Trait conversion", value: traitBonuses[statKey] });
  }
```

- [ ] **Step 5: Highlight trait-boosted stats in equipment panel**

In `src/renderer/modules/equipment.js`, update the `isBoosted` logic at line ~1286 to also highlight stats boosted by trait conversions. After `const computed = computeEquipmentStats(_assumedBoons);` (line ~1253), add:

```js
  const traitBonuses = computeTraitConversions(computed);
```

Then import `computeTraitConversions` at the top of the file by updating the stats import:

```js
import { computeSlotStats, computeEquipmentStats, computeUpgradeModifiers, computeStatBreakdown, computeTraitConversions } from "./stats.js";
```

And update the `isBoosted` check at line ~1286:

```js
    const isBoosted = (_assumedBoons.might > 0 && (row.key === "Power" || row.key === "ConditionDamage"))
      || (traitBonuses[row.key] > 0);
```

**Important:** The `traitBonuses` variable must be declared before the `for (const row of statRows)` loop, alongside the other computed values.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/stats.js src/renderer/modules/equipment.js tests/unit/renderer/assumed-boons.test.js
git commit -m "feat: integrate trait AttributeConversion into stat totals and breakdown"
```

---

## Chunk 3: Stacking Sigil Support

### Task 6: Add stacking sigil detection and constants

**Files:**
- Modify: `src/renderer/modules/constants.js` (add STACKING_SIGIL_DEFS)
- Test: `tests/unit/renderer/assumed-boons.test.js`

The four attribute-stacking sigils in GW2:
- **Sigil of Bloodlust** (ID 24575): +10 Power per stack, max 25
- **Sigil of Corruption** (ID 24578): +10 Condition Damage per stack, max 25
- **Sigil of Life** (ID 24582): +10 Healing Power per stack, max 25
- **Sigil of Perception** (ID 24580): +10 Precision per stack, max 25

Only one attribute-stacking sigil can be active at a time.

- [ ] **Step 1: Add stacking sigil definitions to constants.js**

At the end of `src/renderer/modules/constants.js`, after the `FURY_CRIT_CHANCE` / `STABILITY_MAX_STACKS` lines, add:

```js
// Attribute-stacking sigils (only one can be active at a time in-game)
export const STACKING_SIGIL_DEFS = [
  { id: 24575, key: "sigilBloodlust", label: "Bloodlust", stat: "Power", perStack: 10, maxStacks: 25 },
  { id: 24578, key: "sigilCorruption", label: "Corruption", stat: "ConditionDamage", perStack: 10, maxStacks: 25 },
  { id: 24582, key: "sigilLife", label: "Life", stat: "HealingPower", perStack: 10, maxStacks: 25 },
  { id: 24580, key: "sigilPerception", label: "Perception", stat: "Precision", perStack: 10, maxStacks: 25 },
];
export const STACKING_SIGIL_IDS = new Set(STACKING_SIGIL_DEFS.map((d) => d.id));
```

- [ ] **Step 2: Write failing test — stacking sigil stats**

In `tests/unit/renderer/assumed-boons.test.js`, add:

```js
describe("computeEquipmentStats — stacking sigils", () => {
  test("stacking sigil at max stacks adds to stat total", () => {
    state.editor = makeEditor();
    state.editor.equipment.weapons = { mainhand1: 1234 };
    state.editor.equipment.sigils = { mainhand1: ["24575", ""] }; // Bloodlust
    state.upgradeCatalog = null;
    state.catalog = { traitById: new Map() };

    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilBloodlust: 25 });
    expect(withSigil.Power).toBe(baseline.Power + 250); // 25 * 10
  });

  test("stacking sigil at 0 stacks has no effect", () => {
    state.editor = makeEditor();
    state.catalog = { traitById: new Map() };
    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilBloodlust: 0 });
    expect(withSigil.Power).toBe(baseline.Power);
  });

  test("Perception sigil adds to Precision", () => {
    state.editor = makeEditor();
    state.catalog = { traitById: new Map() };
    const baseline = computeEquipmentStats();
    const withSigil = computeEquipmentStats(null, { sigilPerception: 15 });
    expect(withSigil.Precision).toBe(baseline.Precision + 150);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: FAIL — `computeEquipmentStats` doesn't accept a second parameter for sigil stacks.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/constants.js tests/unit/renderer/assumed-boons.test.js
git commit -m "feat: add stacking sigil definitions and failing tests"
```

### Task 7: Implement stacking sigil stat contributions

**Files:**
- Modify: `src/renderer/modules/stats.js` (add sigil stacks parameter to computeEquipmentStats, add to breakdown)
- Modify: `src/renderer/modules/equipment.js` (pass sigil stacks to stat computation)

- [ ] **Step 1: Add sigil stacks parameter to computeEquipmentStats**

In `src/renderer/modules/stats.js`, update the function signature and add sigil computation.

Update import at top of stats.js:

```js
import {
  STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK, STACKING_SIGIL_DEFS,
} from "./constants.js";
```

Update function signature (line ~51):

```js
export function computeEquipmentStats(assumedBoons = null, sigilStacks = null) {
```

After the assumed boons block and before the trait conversions block, add:

```js
  // Stacking sigil contributions
  if (sigilStacks) {
    for (const def of STACKING_SIGIL_DEFS) {
      const stacks = sigilStacks[def.key] || 0;
      if (stacks > 0) {
        totals[def.stat] = (totals[def.stat] || 0) + stacks * def.perStack;
      }
    }
  }
```

- [ ] **Step 2: Update computeStatBreakdown to accept and report sigil stacks**

Update `computeStatBreakdown` signature (line ~354):

```js
export function computeStatBreakdown(statKey, assumedBoons = null, sigilStacks = null) {
```

After the trait conversion entries block (added in Task 5, which already calls `computeEquipmentStats`), add sigil stack entries. Update the `computeEquipmentStats` call in that block to pass `sigilStacks`:

```js
  const traitBase = computeEquipmentStats(assumedBoons, sigilStacks);
```

Then after the trait conversion entries, add:

```js
    // Stacking sigil contributions
    if (sigilStacks) {
      for (const def of STACKING_SIGIL_DEFS) {
        const stacks = sigilStacks[def.key] || 0;
        if (stacks > 0 && def.stat === statKey) {
          entries.push({ source: `Sigil (${def.label} ×${stacks})`, value: stacks * def.perStack });
        }
      }
    }
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/stats.js
git commit -m "feat: add stacking sigil stat contributions to computeEquipmentStats"
```

### Task 8: Add stacking sigil UI to equipment panel boons section

**Files:**
- Modify: `src/renderer/modules/equipment.js` (detect equipped stacking sigils, render in boons bar, pass stacks to stat functions)
- Modify: `src/renderer/styles/equipment.css` (sigil item styling)

- [ ] **Step 1: Add sigil stack state to equipment.js**

Import the new constants in equipment.js:

```js
  FURY_CRIT_CHANCE, MIGHT_MAX_STACKS, MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
  STABILITY_MAX_STACKS, STACKING_SIGIL_DEFS, STACKING_SIGIL_IDS,
  BOON_CONDITION_ICONS,
```

Add sigil stacks state near the `_assumedBoons` declaration:

```js
let _sigilStacks = {};
export function getSigilStacks() { return _sigilStacks; }
export function resetSigilStacks() { _sigilStacks = {}; }
```

In the build-switch block at line ~307 where `resetAssumedBoons()` is called, add `resetSigilStacks();` immediately after it.

- [ ] **Step 2: Detect equipped stacking sigils and render them in the boons section**

In the boons section rendering (after the `boonsExpand` element is appended to `boonsSection`), add sigil stack detection and rendering:

```js
  // Detect equipped stacking sigils from active weapon set
  const equippedSigils = state.editor.equipment?.sigils || {};
  const activeSet = Number(state.editor.activeWeaponSet) || 1;
  const isUnderwater = Boolean(state.editor.underwaterMode);
  let activeSigilIds;
  if (isUnderwater) {
    const aqKey = activeSet === 2 ? "aquatic2" : "aquatic1";
    activeSigilIds = [...(Array.isArray(equippedSigils[aqKey]) ? equippedSigils[aqKey] : [])].filter(Boolean);
  } else {
    const mhKey = activeSet === 2 ? "mainhand2" : "mainhand1";
    const ohKey = activeSet === 2 ? "offhand2" : "offhand1";
    activeSigilIds = [
      ...(Array.isArray(equippedSigils[mhKey]) ? equippedSigils[mhKey] : []),
      ...(Array.isArray(equippedSigils[ohKey]) ? equippedSigils[ohKey] : []),
    ].filter(Boolean);
  }

  const equippedStackingSigils = STACKING_SIGIL_DEFS.filter((def) =>
    activeSigilIds.some((id) => Number(id) === def.id)
  );

  // Clean up sigil stacks for unequipped sigils
  for (const key of Object.keys(_sigilStacks)) {
    if (!equippedStackingSigils.some((d) => d.key === key)) {
      delete _sigilStacks[key];
    }
  }

  if (equippedStackingSigils.length > 0) {
    const sigilBar = document.createElement("div");
    sigilBar.className = "equip-boons__bar equip-boons__bar--sigils";

    const sigilLabel = document.createElement("div");
    sigilLabel.className = "equip-boons__sigil-label";
    sigilLabel.textContent = "Sigil Stacks";
    boonsSection.append(sigilLabel);

    for (const def of equippedStackingSigils) {
      const stacks = _sigilStacks[def.key] || 0;
      const sigilDef = state.upgradeCatalog?.sigilById?.get(def.id);
      const icon = sigilDef?.icon || "";

      const item = document.createElement("div");
      item.className = "equip-boons__item";

      const iconWrap = document.createElement("div");
      iconWrap.className = "equip-boons__icon equip-boons__icon--sigil" + (stacks > 0 ? " equip-boons__icon--on" : "");

      if (icon) {
        const img = document.createElement("img");
        img.src = icon;
        img.alt = def.label;
        img.width = 28;
        img.height = 28;
        iconWrap.append(img);
      }

      // Stack badge
      const badge = document.createElement("div");
      badge.className = "equip-boons__badge";
      badge.textContent = stacks || "";
      if (!stacks) badge.style.display = "none";
      iconWrap.append(badge);

      // Tooltip
      const tooltip = document.createElement("div");
      tooltip.className = "equip-boons__tooltip";
      const statLabel = def.stat.replace(/([A-Z])/g, " $1").trim();
      if (stacks > 0) {
        tooltip.innerHTML =
          `<div class="equip-boons__tip-title">${def.label} ×${stacks}</div>` +
          `<div class="equip-boons__tip-effect">+${stacks * def.perStack} ${statLabel}</div>` +
          `<div class="equip-boons__tip-note">+${def.perStack} ${statLabel} per stack (max ${def.maxStacks})</div>`;
      } else {
        tooltip.innerHTML =
          `<div class="equip-boons__tip-title">Sigil of ${def.label}</div>` +
          `<div class="equip-boons__tip-note">Click to add stacks. +${def.perStack} ${statLabel} per stack (max ${def.maxStacks}).</div>`;
      }
      item.append(tooltip);

      // Click handlers (same as Might)
      iconWrap.addEventListener("click", (e) => {
        _sigilStacks[def.key] = Math.min(def.maxStacks, Math.max(0, (_sigilStacks[def.key] || 0) + getDelta(e)));
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _sigilStacks[def.key] = Math.min(def.maxStacks, Math.max(0, (_sigilStacks[def.key] || 0) - getDelta(e)));
        _render();
      });

      item.append(iconWrap);

      const label = document.createElement("div");
      label.className = "equip-boons__label" + (stacks > 0 ? " equip-boons__label--on" : "");
      label.textContent = def.label;
      item.append(label);

      sigilBar.append(item);
    }

    boonsSection.append(sigilBar);
  }
```

- [ ] **Step 3: Pass sigil stacks to stat computation**

Update the `computeEquipmentStats` call in the Attributes section (line ~1253):

```js
  const computed = computeEquipmentStats(_assumedBoons, _sigilStacks);
```

Update the `computeStatBreakdown` call in the hover preview (line ~1290):

```js
      const breakdown = computeStatBreakdown(row.key, _assumedBoons, _sigilStacks);
```

Update the `isBoosted` check to include sigil-boosted stats:

```js
    const sigilBoosted = equippedStackingSigils.some((d) => d.stat === row.key && (_sigilStacks[d.key] || 0) > 0);
    const isBoosted = (_assumedBoons.might > 0 && (row.key === "Power" || row.key === "ConditionDamage"))
      || (traitBonuses[row.key] > 0)
      || sigilBoosted;
```

**Important:** The `equippedStackingSigils` variable is used in both the boons section UI and the Attributes section (for `isBoosted` highlighting). To make it accessible to both, declare `let equippedStackingSigils = [];` at the start of the `// === RIGHT COLUMN ===` block (line ~1112), before both the boons section and Attributes section. Then assign it inside the sigil detection code in Step 2 (use `equippedStackingSigils = STACKING_SIGIL_DEFS.filter(...)` instead of `const equippedStackingSigils = ...`).

**Other callers note:** `computeEquipmentStats()` is also called by `skills.js`, `detail-panel.js`, and `updateHealthOrb()` without sigil stacks — this is intentional and consistent with how those callers also don't pass `assumedBoons`. Sigil stacks and assumed boons are equipment-panel-only session state.

- [ ] **Step 4: Add sigil-specific CSS**

In `src/renderer/styles/equipment.css`, add after the boons expand CSS:

```css
.equip-boons__bar--sigils {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line-soft);
}

.equip-boons__sigil-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  margin-top: 10px;
  margin-bottom: 2px;
}

.equip-boons__icon--sigil {
  border-radius: 2px;
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/equipment.js src/renderer/modules/constants.js src/renderer/styles/equipment.css
git commit -m "feat: add stacking sigil UI with interactive stack controls"
```

---

## Final Verification

### Task 9: Full test run and manual verification prep

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All PASS with no regressions.

- [ ] **Step 2: Verify no lint or build errors**

Run: `npm run build` (if available) or check for any module resolution issues.

- [ ] **Step 3: Final commit if any cleanup needed**

Only if there are adjustments from the test run.
