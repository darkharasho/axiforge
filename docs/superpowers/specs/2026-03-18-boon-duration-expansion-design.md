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
5. **Hover tooltip** is suppressed on a boon icon while its expansion is open (to avoid overlap). All other hover tooltips continue to work normally. Implementation: in the `mouseenter` handler, if `_activeDurationExpand` is set and the hovered icon is the currently active icon, return early without creating a tooltip.
6. **Toggle-boon-coverage collapse** (the chevron header) → closes any open expansion before collapsing the section. The `toggle-boon-coverage` click handler in `comp-detail.js` must call a `closeDurationExpand()` helper exported from `comp-boon-coverage.js` before toggling collapse.
7. **Uncovered boon icons** are not clickable (no expansion).
8. **Only contributing builds shown** in the expansion panel — only builds in the line that actually provide this boon appear. Builds in the line that don't provide this boon are omitted entirely.

---

## Data Layer

### New function: `computeBuildConcentration(build, upgradeCatalog)`

**Location:** `src/renderer/modules/stats.js`

Refactors the Concentration-computing logic from `computeEquipmentStats()` (which is tightly coupled to `state.editor` and `state.upgradeCatalog`) into a standalone parameter-driven function.

**Signature:** `computeBuildConcentration(build, upgradeCatalog) → number`

**Implementation notes:**
- All references to `state.editor.*` become `build.*` (e.g. `state.editor.equipment?.slots` → `build.equipment?.slots`).
- All references to `state.upgradeCatalog` become the passed `upgradeCatalog` parameter.
- Returns only the Concentration value (a plain number); does not return the full `totals` object.
- **Underwater mode:** always assumes land mode (aquatic-only slots are excluded via the existing `EXCLUDED_SLOTS` list, same as the land path in `computeEquipmentStats`).
- **Guard — missing equipment:** if `build.equipment` is absent or null, return `0`.
- **Guard — null upgradeCatalog:** if `upgradeCatalog` is null/undefined, return the Concentration derived from stat combo slots only (runes/food/utility/infusions require catalog lookups and are skipped). This matches the fallback behavior implied by the existing guard in `computeEquipmentStats`.

**Sources summed (in order):**
1. Stat combo slots (`build.equipment.slots`) via `STAT_COMBOS_BY_LABEL` and `SLOT_WEIGHTS` — no catalog needed
2. Rune bonuses (`build.equipment.runes`) — regex-parsed from `upgradeCatalog.runeById`
3. Food (`build.equipment.food`) — regex-parsed from `upgradeCatalog.foodById`
4. Utility consumable (`build.equipment.utility`) — regex-parsed from `upgradeCatalog.utilityById`
5. Infusions/enrichment — via `infixUpgrade.attributes` from `upgradeCatalog.infusionById` / `upgradeCatalog.enrichmentById`

### Changes to `computeCompBoonCoverage(comp, builds, catalogCache, getCatalog, upgradeCatalog)`

**Location:** `src/renderer/modules/comps/comp-boon-coverage.js`

- Accepts a new 5th parameter: `upgradeCatalog`.
- For each build in each line, calls `computeBuildConcentration(build, upgradeCatalog)` to get Concentration.
- Derives `concentrationBonus = Concentration / 1500` (a decimal multiplier; e.g. 150 Concentration → `0.10` = 10% extra duration).
- For each boon a build provides, finds the matching entry in `coverage.boons` and maps its sources to include `effectiveDuration`:

```js
// concentrationBonus = Concentration / 1500  (e.g. 0.10 for 10% bonus)
// effectiveDuration = base * (1 + concentrationBonus)
sources: boon.sources
  .filter(s => s.duration > 0)
  .map(s => ({
    type: s.type,              // "skill" | "trait"
    name: s.name,
    stacks: s.stacks,
    effectiveDuration: +(s.duration * (1 + concentrationBonus)).toFixed(1),
  }))
```

**Updated provider schema for line-scope providers:**

```js
{
  buildId: string,
  buildName: string,
  profession: string,
  eliteSpec: string | null,
  sources: Array<{
    type: "skill" | "trait",
    name: string,
    stacks: number,
    effectiveDuration: number,   // seconds, 1 decimal place
  }>
}
```

Squad-scope providers remain unchanged (no `sources` field).

### Call-site change in `comp-detail.js`

Pass `state.upgradeCatalog` as the 5th argument when calling `computeCompBoonCoverage`.

---

## HTML Structure

### `buildBoonCoverageHTML()` change

After each `.comp-boon-cov__line-row`, emit a sibling expansion div (empty, hidden):

```html
<div class="comp-boon-cov__line-row" data-line-id="…">
  <span class="comp-boon-cov__line-label">P1</span>
  <div class="comp-boon-cov__icons">…</div>
</div>
<div class="comp-boon-cov__duration-expand" data-line-id="…" hidden></div>
```

The expansion div is empty at render time and populated on first click.

### `_renderIconRow()` change

Line-scope icons get `data-clickable="true"` so the click handler and CSS can target them distinctly from squad icons:

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

Only builds that contribute this boon are rendered (providers with `sources.length > 0` after filtering).

```html
<div class="comp-boon-cov__dur-header">
  <img class="comp-boon-cov__dur-boon-icon" src="…" width="18" height="18" alt="Might">
  <span class="comp-boon-cov__dur-boon-name">Might</span>
  <span class="comp-boon-cov__dur-line-label">P1</span>
  <button class="comp-boon-cov__dur-close" aria-label="Close">✕</button>
</div>

<!-- Per contributing build — separated by .comp-boon-cov__dur-sep if more than one -->
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
      <span class="comp-boon-cov__dur-stacks">×5</span>  <!-- omitted if stacks === 1 -->
    </div>
    <!-- …more sources -->
  </div>
</div>
```

Duration display:
- Shows `effectiveDuration`, formatted as `Xs` (whole number) or `X.Xs` (1 decimal if fractional).
- Stacks shown as `×N` if `stacks > 1`, omitted if `stacks === 1`.
- Sources with `duration === 0` are already filtered before storing (in the data layer).

---

## Event Handling

All logic lives in `bindBoonCoverageEvents()` in `comp-boon-coverage.js`.

```
click on [data-clickable="true"][data-scope="line"] boon icon:
  if this icon is already active:
    → _closeDurationExpand(), return
  → _closeDurationExpand()          // close any open expansion
  → populate expansion div sibling of icon's parent .comp-boon-cov__line-row
  → remove `hidden` from expansion div
  → add .comp-boon-cov__icon--active to icon
  → set _activeDurationExpand = { expandEl, iconEl }

click on .comp-boon-cov__dur-close:
  → _closeDurationExpand()

mouseenter on [data-clickable="true"] boon icon:
  if _activeDurationExpand?.iconEl === this icon:
    → return early (suppress tooltip)
  else:
    → existing tooltip behavior (unchanged)

toggle-boon-coverage click (chevron) — in comp-detail.js:
  → call closeDurationExpand() exported from comp-boon-coverage.js
  → then existing collapse toggle logic
```

**Module-level state:**

```js
let _activeDurationExpand = null;
// shape: { expandEl: HTMLElement, iconEl: HTMLElement } | null

function _closeDurationExpand() {
  if (!_activeDurationExpand) return;
  _activeDurationExpand.expandEl.hidden = true;
  _activeDurationExpand.iconEl.classList.remove("comp-boon-cov__icon--active");
  _activeDurationExpand = null;
}

export function closeDurationExpand() { _closeDurationExpand(); }
```

---

## CSS

New classes added to the comp stylesheet:

| Class | Purpose |
|---|---|
| `.comp-boon-cov__duration-expand` | Wrapper; `border-left: 2px solid accent; background: slightly-darker; padding: 8px 12px 10px` |
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
| `src/renderer/modules/comps/comp-boon-coverage.js` | Data layer, HTML rendering, event handling; export `closeDurationExpand()` |
| `src/renderer/modules/comps/comp-detail.js` | Pass `state.upgradeCatalog` as 5th arg; call `closeDurationExpand()` in toggle-boon-coverage handler |
| `src/renderer/css/comp.css` (or equivalent) | New `.comp-boon-cov__duration-expand` and child classes |

---

## Non-goals

- No expansion for the SQUAD row (future work).
- No sorting of sources (rendered in the order returned by `computeBoonCoverage`).
- No animation beyond `hidden` toggle (keep it simple).
