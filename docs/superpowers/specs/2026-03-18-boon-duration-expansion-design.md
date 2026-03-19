# Boon Duration Expansion — Design Spec

**Date:** 2026-03-18
**Feature:** Click a boon icon in a party line to expand an inline panel showing every source of that boon across all builds in that line, with effective (post-Concentration) duration per source.

---

## Overview

In the comp view, the boon coverage section shows per-line boon icons (P1, P2, …). Clicking a covered boon icon in a party line row opens an inline accordion panel directly below that row, listing each build's contributing skill/trait sources and their effective boon application duration.

---

## Scope

- **In scope:** Per-line (P1, P2, …) boon icons only.
- **Out of scope:** The SQUAD row boon icons (no expansion for now).
- **One expansion at a time:** Only one panel is open at any moment across all lines.

---

## UX Behavior

1. **Click covered boon icon (line scope)** → expand panel below that line row; boon icon gets active/highlighted state.
2. **Click same active icon** → collapse panel (toggle).
3. **Click a different boon** (any line, any boon) → close current expansion, open new one.
4. **Click ✕ in panel** → collapse panel.
5. **Hover tooltip** is suppressed on a boon icon while its expansion is open (to avoid overlap). All other hover tooltips continue to work normally.
6. **Toggle-boon-coverage collapse** (the chevron header) → closes any open expansion before collapsing the section.
7. **Uncovered boon icons** are not clickable (no expansion).

---

## Data Layer

### New function: `computeBuildConcentration(build, upgradeCatalog)`

**Location:** `src/renderer/modules/stats.js`

Extracts the Concentration-computing logic from the existing `computeEquipmentStats()` (which is coupled to `state.editor`) into a standalone, parameter-driven function. Takes a `build` object and `upgradeCatalog` and returns total Concentration as a number.

Sources it sums:
- Stat combo slots (`build.equipment.slots`) via `STAT_COMBOS_BY_LABEL` and `SLOT_WEIGHTS`
- Rune bonuses (`build.equipment.runes`) — up to 6 bonuses per rune, regex-parsed
- Food (`build.equipment.food`) — regex-parsed from `foodDef.buff`
- Utility consumable (`build.equipment.utility`) — regex-parsed from `utilityDef.buff`
- Infusions/enrichment — via `infixUpgrade.attributes`

### Changes to `computeCompBoonCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog)`

**Location:** `src/renderer/modules/comps/comp-boon-coverage.js`

- Accepts a new 5th parameter: `upgradeCatalog`.
- For each build in each line, calls `computeBuildConcentration(build, upgradeCatalog)` to get Concentration.
- Derives `boonDurationPct = Concentration / 15` (no artificial cap; the formula naturally results in 0 for builds without Concentration gear).
- For each boon a build provides, finds the matching entry in `coverage.boons` and stores its sources with effective durations applied:

```js
sources: boon.sources
  .filter(s => s.duration > 0)
  .map(s => ({
    type: s.type,           // "skill" | "trait"
    name: s.name,
    stacks: s.stacks,
    duration: s.duration,
    effectiveDuration: +(s.duration * (1 + boonDurationPct / 100)).toFixed(1),
  }))
```

- Line-scope providers now include `sources` (squad-scope providers remain unchanged).

### Call-site change in `comp-detail.js`

Pass `state.upgradeCatalog` as the 5th argument when calling `computeCompBoonCoverage`.

---

## HTML Structure

### `buildBoonCoverageHTML()` change

After each `.comp-boon-cov__line-row`, emit a sibling expansion div:

```html
<div class="comp-boon-cov__line-row" data-line-id="…">
  <span class="comp-boon-cov__line-label">P1</span>
  <div class="comp-boon-cov__icons">…</div>
</div>
<div class="comp-boon-cov__duration-expand" data-line-id="…" hidden></div>
```

The expansion div is empty at render time and populated on first click.

### `_renderIconRow()` change

Line-scope icons get `data-clickable="true"` so the click handler and CSS can target them without affecting squad icons:

```html
<div class="comp-boon-cov__icon"
     data-scope="line"
     data-clickable="true"
     data-boon-name="Might"
     data-count="3"
     data-providers="[…]"
     data-line-label="P1">
  …
</div>
```

### Expansion panel inner HTML (populated on click)

```html
<div class="comp-boon-cov__dur-header">
  <img class="comp-boon-cov__dur-boon-icon" src="…" width="18" height="18" alt="Might">
  <span class="comp-boon-cov__dur-boon-name">Might</span>
  <span class="comp-boon-cov__dur-line-label">P1</span>
  <button class="comp-boon-cov__dur-close" aria-label="Close">✕</button>
</div>

<!-- Per build -->
<div class="comp-boon-cov__dur-build">
  <div class="comp-boon-cov__dur-build-header">
    <span class="comp-boon-cov__dur-prof"><!-- profession SVG --></span>
    <span class="comp-boon-cov__dur-build-name">Virtuoso DPS</span>
  </div>
  <div class="comp-boon-cov__dur-sources">
    <div class="comp-boon-cov__dur-source">
      <span class="comp-boon-cov__dur-type comp-boon-cov__dur-type--skill">SKILL</span>
      <span class="comp-boon-cov__dur-source-name">Echo of Memory</span>
      <span class="comp-boon-cov__dur-duration">11.2s</span>
      <span class="comp-boon-cov__dur-stacks">×5</span>
    </div>
    <!-- …more sources -->
  </div>
</div>

<!-- Separator between builds (if more than one) -->
<div class="comp-boon-cov__dur-sep"></div>
```

Duration display:
- Shows `effectiveDuration` (post-Concentration), formatted as `Xs` or `X.Xs` (1 decimal if not whole).
- Stacks shown as `×N` if `stacks > 1`, omitted if `stacks === 1`.
- Sources with `duration === 0` are filtered out.

---

## Event Handling

All logic lives in `bindBoonCoverageEvents()` in `comp-boon-coverage.js`.

```
click on [data-clickable="true"][data-scope="line"] boon icon:
  - if this icon is already active → close expansion, deactivate icon, return
  - close any currently open expansion + deactivate its icon
  - populate expansion div (sibling of the icon's parent line row)
  - show expansion div (remove `hidden`)
  - mark icon as active

click on .comp-boon-cov__dur-close:
  - close expansion + deactivate icon

mouseenter on active icon:
  - suppress tooltip (skip _closeBoonTooltip / tip creation)

toggle-boon-coverage click (chevron):
  - close any open expansion before toggling section collapse
```

Module-level state: a single `_activeDurationExpand` reference (the currently open expand div + active icon element) replaces or extends the existing `_activeBoonTooltip` pattern.

---

## CSS

New classes added to the comp stylesheet:

| Class | Purpose |
|---|---|
| `.comp-boon-cov__duration-expand` | Wrapper for expansion panel; `border-left: 2px solid accent; background: slightly-darker; padding: 8px 12px 10px` |
| `.comp-boon-cov__dur-header` | Flex row: boon icon + name + line label + close button |
| `.comp-boon-cov__dur-boon-icon` | 18×18 boon icon |
| `.comp-boon-cov__dur-boon-name` | Bold boon name |
| `.comp-boon-cov__dur-line-label` | Dimmed line label (P1, P2…) pushed to right |
| `.comp-boon-cov__dur-close` | ✕ close button, unstyled, right-aligned |
| `.comp-boon-cov__dur-build` | Per-build block |
| `.comp-boon-cov__dur-build-header` | Flex row: profession SVG + build name |
| `.comp-boon-cov__dur-prof` | 16×16 profession icon |
| `.comp-boon-cov__dur-build-name` | Build title |
| `.comp-boon-cov__dur-sources` | Indented column of source rows |
| `.comp-boon-cov__dur-source` | Flex row: type pill + name + duration + stacks |
| `.comp-boon-cov__dur-type` | Small uppercase pill |
| `.comp-boon-cov__dur-type--skill` | Green tint |
| `.comp-boon-cov__dur-type--trait` | Purple tint |
| `.comp-boon-cov__dur-source-name` | Source name, flex-grow |
| `.comp-boon-cov__dur-duration` | Gold/highlighted duration value |
| `.comp-boon-cov__dur-stacks` | Dimmed stacks count |
| `.comp-boon-cov__dur-sep` | 1px horizontal rule between builds |
| `.comp-boon-cov__icon--active` | Active state for clicked boon icon (accent border + glow) |

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/modules/stats.js` | Export `computeBuildConcentration(build, upgradeCatalog)` |
| `src/renderer/modules/comps/comp-boon-coverage.js` | Data layer, HTML rendering, event handling (all changes) |
| `src/renderer/modules/comps/comp-detail.js` | Pass `state.upgradeCatalog` as 5th arg |
| `src/renderer/css/comp.css` (or equivalent) | New `.comp-boon-cov__duration-expand` and child classes |

---

## Non-goals

- No expansion for the SQUAD row (future work).
- No sorting of sources (rendered in the order returned by `computeBoonCoverage`).
- No animation beyond `hidden` toggle (keep it simple).
