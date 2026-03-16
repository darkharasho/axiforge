# Assumed Boons Bar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Assumed Boons" section (Might, Fury, Alacrity) to the equipment panel that lets users toggle boons and see their stat impact in real time.

**Architecture:** Session-only boon state lives in equipment.js as module-level state. Boon stat contributions are passed as an optional parameter to existing stat functions in stats.js. UI renders as a new section above Attributes in the equipment panel's right column.

**Tech Stack:** Vanilla JS (imperative DOM), CSS modules, Jest for unit tests.

**Spec:** `docs/superpowers/specs/2026-03-16-assumed-boons-bar-design.md`

---

## Chunk 1: Stat Integration (Backend Logic)

### Task 1: Add boon constants to constants.js

**Files:**
- Modify: `src/renderer/modules/constants.js` (append at end)

- [ ] **Step 1: Add boon stat constants**

At the end of `src/renderer/modules/constants.js`, add:

```js
// Assumed boon stat effects (per GW2 wiki, level 80)
export const MIGHT_POWER_PER_STACK = 30;
export const MIGHT_CONDI_PER_STACK = 30;
export const MIGHT_MAX_STACKS = 25;
export const FURY_CRIT_CHANCE = 25; // percentage points
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/constants.js
git commit -m "feat: add boon stat effect constants"
```

### Task 2: Write failing tests for boon stat computation

**Files:**
- Create: `tests/unit/renderer/assumed-boons.test.js`

- [ ] **Step 1: Write the test file**

```js
"use strict";

const { computeEquipmentStats, computeStatBreakdown } = require("../../../src/renderer/modules/stats");
const { state } = require("../../../src/renderer/modules/state");

function makeEditor(slots = {}, food = "", utility = "") {
  return {
    profession: "Warrior",
    equipment: { slots, food, utility, weapons: {} },
    specializations: [],
    skills: { healId: 0, utilityIds: [0, 0, 0], eliteId: 0 },
  };
}

beforeEach(() => {
  state.editor = makeEditor();
  state.upgradeCatalog = null;
});

describe("computeEquipmentStats — assumed boons", () => {
  test("null assumedBoons matches baseline (no change)", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats(null);
    expect(result.Power).toBe(baseline.Power);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });

  test("zero Might matches baseline (no change)", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 0, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });

  test("25 Might adds +750 Power and +750 ConditionDamage", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 25, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 750);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 750);
  });

  test("10 Might adds +300 Power and +300 ConditionDamage", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 10, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 300);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 300);
  });

  test("Might stacks on top of equipment stats", () => {
    state.editor = makeEditor({ chest: "Berserker's" });
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 25, fury: false, alacrity: false });
    expect(result.Power).toBe(baseline.Power + 750);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage + 750);
  });

  test("Fury and Alacrity do not affect flat stats", () => {
    const baseline = computeEquipmentStats();
    const result = computeEquipmentStats({ might: 0, fury: true, alacrity: true });
    expect(result.Power).toBe(baseline.Power);
    expect(result.Precision).toBe(baseline.Precision);
    expect(result.ConditionDamage).toBe(baseline.ConditionDamage);
  });
});

describe("computeStatBreakdown — assumed boons", () => {
  test("Might appears as source in Power breakdown", () => {
    const entries = computeStatBreakdown("Power", { might: 10, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeDefined();
    expect(boonEntry.source).toBe("Boon (Might ×10)");
    expect(boonEntry.value).toBe(300);
  });

  test("Might appears as source in ConditionDamage breakdown", () => {
    const entries = computeStatBreakdown("ConditionDamage", { might: 5, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeDefined();
    expect(boonEntry.value).toBe(150);
  });

  test("no boon entry when Might is 0", () => {
    const entries = computeStatBreakdown("Power", { might: 0, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });

  test("no boon entry when assumedBoons is null", () => {
    const entries = computeStatBreakdown("Power", null);
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });

  test("Might does not appear in Precision breakdown", () => {
    const entries = computeStatBreakdown("Precision", { might: 25, fury: false, alacrity: false });
    const boonEntry = entries.find((e) => e.source.includes("Boon"));
    expect(boonEntry).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: FAIL — `computeEquipmentStats` does not accept a parameter yet, so boon tests will fail.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/unit/renderer/assumed-boons.test.js
git commit -m "test: add failing tests for assumed boons stat computation"
```

### Task 3: Implement boon stat contributions in stats.js

**Files:**
- Modify: `src/renderer/modules/stats.js:1-4` (imports)
- Modify: `src/renderer/modules/stats.js:26` (`computeEquipmentStats` signature)
- Modify: `src/renderer/modules/stats.js:193-196` (before `return totals`)
- Modify: `src/renderer/modules/stats.js:202` (`computeStatBreakdown` signature)
- Modify: `src/renderer/modules/stats.js:326` (internal `computeEquipmentStats` call)
- Modify: `src/renderer/modules/stats.js:352-354` (before `return entries` in breakdown)

- [ ] **Step 1: Add import for boon constants**

In `src/renderer/modules/stats.js`, update the imports at the top to include:

```js
import {
  STAT_COMBOS_BY_LABEL, SLOT_WEIGHTS, LAND_ONLY_SLOTS, AQUATIC_SLOTS,
  MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
} from "./constants.js";
```

- [ ] **Step 2: Add assumedBoons parameter to computeEquipmentStats**

Change the function signature from:

```js
export function computeEquipmentStats() {
```

to:

```js
export function computeEquipmentStats(assumedBoons = null) {
```

Then, just before `return totals;` (after the utility consumable block, around line 193), add:

```js
  // Assumed boon contributions (session-only, not persisted)
  if (assumedBoons) {
    totals.Power += (assumedBoons.might || 0) * MIGHT_POWER_PER_STACK;
    totals.ConditionDamage += (assumedBoons.might || 0) * MIGHT_CONDI_PER_STACK;
  }
```

- [ ] **Step 3: Add assumedBoons parameter to computeStatBreakdown**

Change the function signature from:

```js
export function computeStatBreakdown(statKey) {
```

to:

```js
export function computeStatBreakdown(statKey, assumedBoons = null) {
```

Find the internal call to `computeEquipmentStats()` inside `computeStatBreakdown` (around line 326) and forward the parameter:

```js
      const totals = computeEquipmentStats(assumedBoons);
```

Then, just before `return entries;` at the end of `computeStatBreakdown`, add:

```js
  // Assumed boon contributions
  if (assumedBoons) {
    const mightStacks = assumedBoons.might || 0;
    if (mightStacks > 0) {
      if (statKey === "Power") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * MIGHT_POWER_PER_STACK });
      }
      if (statKey === "ConditionDamage") {
        entries.push({ source: `Boon (Might ×${mightStacks})`, value: mightStacks * MIGHT_CONDI_PER_STACK });
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=assumed-boons`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still PASS (the new parameter defaults to `null`, so existing callers are unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/stats.js src/renderer/modules/constants.js
git commit -m "feat: add assumed boons stat contributions to computeEquipmentStats and computeStatBreakdown"
```

---

## Chunk 2: Equipment Panel UI

### Task 4: Add boon state management and exports to equipment.js

**Files:**
- Modify: `src/renderer/modules/equipment.js` (top-level module state, near line 20-35)

- [ ] **Step 1: Add module-level boon state and exports**

After the existing `let _readOnly = false;` line (around line 20), add:

```js
// Assumed boons — session-only, not persisted to builds.
let _assumedBoons = { might: 0, fury: false, alacrity: false };
export function getAssumedBoons() { return _assumedBoons; }
export function resetAssumedBoons() { _assumedBoons = { might: 0, fury: false, alacrity: false }; }
```

- [ ] **Step 2: Add FURY_CRIT_CHANCE and MIGHT_MAX_STACKS to the constants import**

Update the import from `"./constants.js"` at the top of equipment.js to include:

```js
  FURY_CRIT_CHANCE, MIGHT_MAX_STACKS, MIGHT_POWER_PER_STACK, MIGHT_CONDI_PER_STACK,
```

Add these to the existing import destructuring alongside `STAT_COMBOS`, `SLOT_WEIGHTS`, etc.

- [ ] **Step 3: Add BOON_CONDITION_ICONS to imports**

The equipment.js file needs boon icons. Add `BOON_CONDITION_ICONS` to the constants import:

```js
  BOON_CONDITION_ICONS,
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: add assumed boons state management in equipment module"
```

### Task 5: Wire boon state into stat computation and Fury crit chance

**Files:**
- Modify: `src/renderer/modules/equipment.js:1099-1110` (right column stat computation)

- [ ] **Step 1: Pass assumedBoons to computeEquipmentStats**

In `renderEquipmentPanel`, find the line (around 1101):

```js
  const computed = computeEquipmentStats();
```

Change it to:

```js
  const computed = computeEquipmentStats(_assumedBoons);
```

- [ ] **Step 2: Add Fury crit chance to the critChance calculation**

Find the line (around 1108):

```js
  const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0 + popMod("Critical Chance"));
```

Change it to:

```js
  const furyCrit = _assumedBoons.fury ? FURY_CRIT_CHANCE : 0;
  const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0 + popMod("Critical Chance") + furyCrit);
```

- [ ] **Step 3: Pass assumedBoons to computeStatBreakdown in the hover handler**

Find the stat row hover handler that calls `computeStatBreakdown(row.key)` (around line 1136). Change it to:

```js
      const breakdown = computeStatBreakdown(row.key, _assumedBoons);
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: wire assumed boons into stat computation and Fury crit chance"
```

### Task 6: Render the Assumed Boons section in the equipment panel

**Files:**
- Modify: `src/renderer/modules/equipment.js:1095-1100` (right column, before Attributes section)

- [ ] **Step 1: Add the boons section rendering**

In `renderEquipmentPanel`, right after the `rightCol` element is created (line 1097) and before the `// Attributes` comment (line 1099), insert the boons section. This is the largest code addition:

```js
  // Assumed Boons
  const boonsSection = document.createElement("div");
  boonsSection.className = "equip-boons";

  const boonsHeader = document.createElement("div");
  boonsHeader.className = "equip-section__head";

  const boonsTitle = document.createElement("span");
  boonsTitle.textContent = "Assumed Boons";
  boonsHeader.append(boonsTitle);

  // Help icon with tooltip
  const helpIcon = document.createElement("span");
  helpIcon.className = "equip-boons__help";
  helpIcon.textContent = "?";
  const helpTooltip = document.createElement("div");
  helpTooltip.className = "equip-boons__help-tooltip";
  helpTooltip.innerHTML =
    '<div class="equip-boons__help-section">Add stacks</div>' +
    '<div class="equip-boons__help-row"><kbd>Click</kbd> <span class="equip-boons__help-up">+1</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Shift+Click</kbd> <span class="equip-boons__help-up">+5</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Ctrl+Click</kbd> <span class="equip-boons__help-up">+25</span></div>' +
    '<div class="equip-boons__help-section">Remove stacks</div>' +
    '<div class="equip-boons__help-row"><kbd>Right Click</kbd> <span class="equip-boons__help-down">\u22121</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Shift+Right</kbd> <span class="equip-boons__help-down">\u22125</span></div>' +
    '<div class="equip-boons__help-row"><kbd>Ctrl+Right</kbd> <span class="equip-boons__help-down">\u221225</span></div>';
  helpIcon.append(helpTooltip);
  boonsHeader.append(helpIcon);
  boonsSection.append(boonsHeader);

  const boonsBar = document.createElement("div");
  boonsBar.className = "equip-boons__bar";

  const BOON_DEFS = [
    { key: "might", label: "Might", icon: BOON_CONDITION_ICONS.Might, stackable: true },
    { key: "fury", label: "Fury", icon: BOON_CONDITION_ICONS.Fury, stackable: false },
    { key: "alacrity", label: "Alacrity", icon: BOON_CONDITION_ICONS.Alacrity, stackable: false },
  ];

  function getDelta(event) {
    if (event.ctrlKey || event.metaKey) return 25;
    if (event.shiftKey) return 5;
    return 1;
  }

  function buildBoonTooltipHTML(def) {
    const val = _assumedBoons[def.key];
    if (def.key === "might") {
      if (val > 0) {
        const power = val * MIGHT_POWER_PER_STACK;
        const condi = val * MIGHT_CONDI_PER_STACK;
        return `<div class="equip-boons__tip-title">Might \u00d7${val}</div>` +
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
    // alacrity
    return val
      ? '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-effect">\u221225% Skill Cooldown</div><div class="equip-boons__tip-note">Cooldown reduction \u2014 not reflected in stat totals</div>'
      : '<div class="equip-boons__tip-title">Alacrity</div><div class="equip-boons__tip-note">Click to enable. Reduces skill cooldowns by 25%.</div>';
  }

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

    // Stack badge (Might only)
    let badge = null;
    if (def.stackable) {
      badge = document.createElement("div");
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
      iconWrap.addEventListener("click", (e) => {
        _assumedBoons[def.key] = Math.min(MIGHT_MAX_STACKS, Math.max(0, _assumedBoons[def.key] + getDelta(e)));
        _render();
      });
      iconWrap.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        _assumedBoons[def.key] = Math.min(MIGHT_MAX_STACKS, Math.max(0, _assumedBoons[def.key] - getDelta(e)));
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

    boonsBar.append(item);
  }

  boonsSection.append(boonsBar);
  rightCol.append(boonsSection);
```

- [ ] **Step 2: Add stat highlighting for boon-boosted values**

Find the stat row rendering loop (around line 1133) where `leftEl.innerHTML` is set. Modify the value span to add a gold highlight class when boosted by boons:

Change:
```js
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value">${(row.value || 0).toLocaleString()}</span>`;
```

To:
```js
    const isBoosted = (_assumedBoons.might > 0 && (row.key === "Power" || row.key === "ConditionDamage"));
    leftEl.innerHTML = `<span class="equip-stat-label">${row.stat}</span><span class="equip-stat-value${isBoosted ? " equip-stat-value--boosted" : ""}">${(row.value || 0).toLocaleString()}</span>`;
```

Similarly, for the crit chance derived stat, add highlighting when Fury is active. Find where `rightEl.innerHTML` is set for derived stats (around line 1158). After the existing line, detect if this is the Crit Chance row and Fury is on:

Change:
```js
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived">${row.derivedVal}</span>`;
```

To:
```js
      const isDerivedBoosted = (_assumedBoons.fury && row.derived === "Crit Chance");
      rightEl.innerHTML = `<span class="equip-stat-label">${row.derived}</span><span class="equip-stat-value equip-stat-value--derived${isDerivedBoosted ? " equip-stat-value--boosted" : ""}">${row.derivedVal}</span>`;
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: render assumed boons bar UI with click interactions and stat highlighting"
```

### Task 7: Add CSS styles for the boons bar

**Files:**
- Modify: `src/renderer/styles/equipment.css` (append at end)

- [ ] **Step 1: Add boon bar styles**

Append to the end of `src/renderer/styles/equipment.css`:

```css
/* Assumed Boons bar
   CSS variables reference (from base.css :root):
   --bg: #04070f    --bg-2: #070d1b
   --line: #223458  --line-soft: #1a2a49
   --text: #e8f0ff  --muted: #a6bbde
   --accent: #4fd897  --accent-2: #48a8ff
*/
.equip-boons {
  margin-bottom: 12px;
}

.equip-boons__bar {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-top: 8px;
}

.equip-boons__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 40px;
  position: relative;
}

.equip-boons__icon {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s, opacity 0.15s, box-shadow 0.15s, filter 0.15s;
  position: relative;
  border: 2px solid var(--line-soft);
  opacity: 0.45;
  filter: grayscale(0.7);
  user-select: none;
  -webkit-user-select: none;
}

.equip-boons__icon--on {
  border-color: #d4aa44;
  opacity: 1;
  filter: none;
  box-shadow: 0 0 8px rgba(212, 170, 68, 0.3);
}

.equip-boons__icon img {
  width: 28px;
  height: 28px;
  pointer-events: none;
}

/* Stack badge (top-right) */
.equip-boons__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  background: #d4aa44;
  color: var(--bg);
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  line-height: 1;
  animation: equip-boons-bump 0.15s ease-out;
}

@keyframes equip-boons-bump {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

.equip-boons__label {
  font-size: 9px;
  color: var(--muted);
  text-align: center;
}

.equip-boons__label--on {
  color: #d4aa44;
}

/* Help icon */
.equip-boons__help {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--muted);
  cursor: help;
  position: relative;
  flex-shrink: 0;
  line-height: 1;
  margin-left: 4px;
}

.equip-boons__help:hover {
  border-color: var(--text);
  color: var(--text);
}

.equip-boons__help-tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px 12px;
  width: 220px;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.equip-boons__help:hover .equip-boons__help-tooltip {
  display: block;
}

.equip-boons__help-section {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  padding: 4px 0 2px;
}

.equip-boons__help-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-size: 10px;
  color: var(--text);
}

.equip-boons__help-row + .equip-boons__help-row {
  border-top: 1px solid var(--line-soft);
  padding-top: 3px;
  margin-top: 1px;
}

.equip-boons__help-row kbd {
  background: var(--bg-2);
  color: var(--muted);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-family: monospace;
  border: 1px solid var(--line-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.equip-boons__help-up {
  color: #88cc88;
}

.equip-boons__help-down {
  color: #cc8888;
}

/* Boon hover tooltip */
.equip-boons__tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
  width: 200px;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.equip-boons__item:hover .equip-boons__tooltip {
  display: block;
}

.equip-boons__tip-title {
  font-weight: 600;
  color: #d4aa44;
  font-size: 12px;
  margin-bottom: 4px;
}

.equip-boons__tip-effect {
  color: #88cc88;
  font-size: 11px;
  margin-bottom: 2px;
}

.equip-boons__tip-note {
  color: var(--muted);
  font-size: 10px;
  font-style: italic;
  margin-top: 4px;
  line-height: 1.3;
}

/* Stat value boosted by boons */
.equip-stat-value--boosted {
  color: #d4aa44;
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/equipment.css
git commit -m "feat: add CSS styles for assumed boons bar, tooltips, and stat highlighting"
```

### Task 8: Add boon state reset on build/profession switch

**Files:**
- Modify: `src/renderer/modules/equipment.js` (inside `renderEquipmentPanel`)

- [ ] **Step 1: Track last build ID for reset detection**

After the existing `let _slotPickerCleanup = null;` line (around line 39), add:

```js
let _lastBoonResetBuildId = "";
```

Then, at the top of `renderEquipmentPanel()` (inside the function body, before any rendering), add:

```js
  // Reset assumed boons when switching builds
  const currentBuildId = state.editor.id || "";
  if (currentBuildId !== _lastBoonResetBuildId) {
    resetAssumedBoons();
    _lastBoonResetBuildId = currentBuildId;
  }
```

- [ ] **Step 2: Export resetAssumedBoons for external callers**

The `resetAssumedBoons` function was already exported in Task 4. No changes needed. The reset inside `renderEquipmentPanel` handles build switches. If additional reset points are needed later, callers can import `resetAssumedBoons`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: reset assumed boons on build switch"
```

### Task 9: Final integration test

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS with no regressions.

- [ ] **Step 2: Create final commit if any uncommitted changes remain**

```bash
git status
```

If there are uncommitted changes, stage and commit them with an appropriate message.
