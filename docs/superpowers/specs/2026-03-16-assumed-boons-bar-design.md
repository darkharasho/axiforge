# Assumed Boons Bar

**Issue:** [#25 — Abilities and boons bar](https://github.com/darkharasho/axiforge/issues/25)
**Date:** 2026-03-16

## Problem

Users want to theorycraft with assumed boons active — e.g. "what are my stats with 25 Might and Fury?" — similar to gw2skills. Currently the app shows what boons a build *provides* (boon coverage) but not what boons the player *assumes they'll have* during combat.

## Solution

Add an "Assumed Boons" section to the equipment panel's right column, above the Attributes section. Three boons: Might, Fury, Alacrity. Their stat contributions fold into the existing `computeEquipmentStats()` totals and stat breakdown tooltips.

This state is **session-only** — not persisted to saved builds. It resets on page reload or build switch.

## Boons and Effects

| Boon | Stacking | Max | Stat Effect |
|---|---|---|---|
| Might | Intensity | 25 | +30 Power, +30 Condition Damage per stack |
| Fury | Duration (toggle) | 1 | +25% Critical Chance (derived stat) |
| Alacrity | Duration (toggle) | 1 | −25% Skill Cooldown (display only, no stat impact) |

Alacrity is included because builds are often designed around having permanent Alacrity (it affects rotation and DPS uptime). Showing it in the boons bar lets users document this assumption alongside the stat-affecting boons, even though it doesn't change any numbers.

## UI Design

### Layout

Position: right column of equipment panel, above the existing "Attributes" section. New section header: "Assumed Boons" with a `?` help icon.

Three boon icons in a horizontal row, each in a 40px-wide column:
- 36×36px icon with 2px border
- Active: gold border (`#d4aa44`), full opacity, gold glow shadow
- Inactive: dim border (`#333355`), 0.45 opacity, grayscale filter
- Label below each icon (9px, gold when active, gray when inactive)

### Stack Badge

Might shows a top-right badge (gold pill, 16px tall) displaying the current stack count. Hidden when count is 0. Badge animates with a scale-bump on change.

### Click Interactions

For Might (stackable):
- Left click: +1 stack
- Shift+click: +5 stacks
- Ctrl+click: +25 stacks (instant max)
- Right click: −1 stack
- Shift+right: −5 stacks
- Ctrl+right: −25 stacks (instant zero)
- Clamped to 0–25 range

For Fury and Alacrity (toggles):
- Left click or right click: toggle on/off

### Help Tooltip

A `?` icon next to the "Assumed Boons" section header. On hover, shows a tooltip with the click modifier legend (add stacks / remove stacks rows with keyboard shortcut labels).

### Boon Hover Tooltips

Each boon icon shows a tooltip on hover:
- **Title**: boon name (+ stack count for Might)
- **Effect lines**: green text showing stat contributions (e.g. "+750 Power")
- **Note**: gray italic text with per-stack formula or clarifying info
- When inactive: shows "Click to enable/add stacks" with the boon's effect description

### Stat Highlighting

Stats affected by active boons display in gold (`#d4aa44`) instead of the default white. This applies to:
- Power and Condition Damage values when Might > 0
- Crit Chance derived stat when Fury is active

Boosted values appear in the existing stat breakdown hover tooltip with a "Boon (Might ×N)" source line.

## State Management

Add `assumedBoons` to the module-level state in equipment.js (not in `state.editor` — this is session-only):

```js
let _assumedBoons = { might: 0, fury: false, alacrity: false };
```

Expose a `getAssumedBoons()` getter and a `resetAssumedBoons()` function. The equipment rendering code passes `getAssumedBoons()` to the stat functions as a parameter.

**Reset hooks:** Call `resetAssumedBoons()` inside `renderEquipmentPanel()` when the profession has changed (compare against a cached value), and at the top of `loadBuildIntoEditor()` in editor.js (which is the entry point for build switching). Since `renderEquipmentPanel` is called on every build load and profession switch, the reset can also be triggered there by detecting a build ID change.

## Stat Integration

### Constants

Define named constants for boon values (in constants.js or at the top of stats.js):

```js
export const MIGHT_POWER_PER_STACK = 30;
export const MIGHT_CONDI_PER_STACK = 30;
export const FURY_CRIT_CHANCE = 25; // percentage points
```

### `computeEquipmentStats(assumedBoons)` in stats.js

Add an optional `assumedBoons` parameter (defaults to `null`). The function already reads global `state.editor` for equipment data — this follows the same pattern, adding one parameter for the new boon data. After computing all equipment/upgrade stats, apply boon contributions if provided:

```js
if (assumedBoons) {
  totals.Power += (assumedBoons.might || 0) * MIGHT_POWER_PER_STACK;
  totals.ConditionDamage += (assumedBoons.might || 0) * MIGHT_CONDI_PER_STACK;
}
```

Fury does not affect flat stats — its +25% crit chance is handled separately.

### `computeStatBreakdown(statKey, assumedBoons)` in stats.js

Add an optional `assumedBoons` parameter. Add boon source entries when applicable:
- `{ source: "Boon (Might ×N)", value: N * 30 }` for Power and ConditionDamage
- Fury appears in the crit chance derived stat display, not in breakdown

**Important:** `computeStatBreakdown` calls `computeEquipmentStats()` internally (line 327) for utility percentage conversions. This internal call must also forward the `assumedBoons` parameter so the utility conversion operates on boon-inclusive totals.

### Fury crit chance in equipment.js

Fury's +25% is added as a separate addend in the existing `critChance` calculation (equipment.js ~line 1108), after the `popMod("Critical Chance")` call:

```js
const furyCrit = _assumedBoons.fury ? FURY_CRIT_CHANCE : 0;
const critChance = Math.min(100, 5 + ((computed.Precision || 1000) - 895) / 21.0
  + popMod("Critical Chance") + furyCrit);
```

This keeps it explicit and separate from the upgrade modifier pipeline.

## Files to Modify

1. **`src/renderer/modules/equipment.js`** — Add boons section rendering above Attributes, manage `_assumedBoons` state, wire click handlers, pass boons to stat functions, reset on build load
2. **`src/renderer/modules/stats.js`** — Accept optional `assumedBoons` parameter in `computeEquipmentStats()` and `computeStatBreakdown()`, apply Might stat contributions
3. **`src/renderer/styles/equipment.css`** — Add styles for `.equip-boons` section (icon states, badge, tooltips, help icon)
4. **`tests/unit/renderer/assumed-boons.test.js`** — Test stat computation with boons, stack clamping

## Files NOT Modified

- `state.js` — no changes, boons are session-only module state
- `editor.js` — no serialization/deserialization needed
- `constants.js` — boon icons already exist in `BOON_CONDITION_ICONS`

## Testing

Test file: `tests/unit/renderer/assumed-boons.test.js`. Tests set up `state.editor` with known equipment in `beforeEach` (same pattern as existing stats.test.js), then call stat functions with an `assumedBoons` parameter:

- `computeEquipmentStats({ might: 25, fury: false, alacrity: false })` returns Power and ConditionDamage each increased by 750 vs. baseline
- `computeEquipmentStats(null)` and `computeEquipmentStats({ might: 0, fury: false, alacrity: false })` match baseline (no change)
- `computeStatBreakdown("Power", { might: 10 })` includes a `{ source: "Boon (Might ×10)", value: 300 }` entry
- `computeStatBreakdown` internal `computeEquipmentStats` call forwards boons (utility % conversion uses boon-inclusive totals)
- Stack clamping logic: values stay within 0–25 (tested via the clamp helper or direct state manipulation)

## Mockup Reference

Interactive mockup: `.superpowers/brainstorm/141561-1773698124/boons-bar-v4.html`
