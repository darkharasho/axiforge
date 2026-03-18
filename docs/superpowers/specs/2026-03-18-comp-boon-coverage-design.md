# Comp Boon Coverage — Design Spec

**Date:** 2026-03-18
**Status:** Approved

---

## Overview

Add boon coverage visibility to the comp detail view, showing both a squad-wide aggregate and a per-line breakdown. This lets users quickly see which boons are covered across the full squad and which are missing or only covered within specific lines.

---

## Scope

- **Boons only** — no conditions
- **All 12 GW2 boons** shown in the existing `BOON_DISPLAY_ORDER`: Aegis, Alacrity, Fury, Might, Protection, Quickness, Regeneration, Resistance, Resolution, Stability, Swiftness, Vigor

---

## Placement

A collapsible **"Boon Coverage"** section appended at the bottom of the party lines panel in the comp detail view (`comp-detail.js`), below the last party line and the "Add Line" button. It sits inside the scrollable left panel, not in a full-width bar.

- **Default state:** expanded
- **Toggle:** clicking the section header collapses/expands it
- **Collapsed state persistence:** stored in `compPrefs` in state (alongside existing sort/filter prefs) so it survives navigation between comps

---

## Display

### Icon row format

Each scope (squad + each party line) renders a row of 12 boon icons in `BOON_DISPLAY_ORDER`:

- **Covered** (count ≥ 1): full opacity, with a `×N` count badge (bottom-right corner of icon). Badge style matches the existing boon coverage badge style in the build editor.
- **Not covered** (count = 0): icon rendered at ~28% opacity, no badge.

Icon sizes:
- Squad row: 22×22 px (same as per-build boon coverage display)
- Per-line rows: 17×17 px (slightly smaller to fit within the panel)

### Section layout

```
▾ BOON COVERAGE

SQUAD
[icon×8][icon×6][icon×5][icon×4][dimmed][dimmed]…

P1   [icon×5][icon×4][icon×3][dimmed]…
P2   [icon×3][icon×2][dimmed][dimmed]…
P3   …
```

Line labels (P1, P2…) are left-aligned with a fixed minimum width so the icon rows align. Lines with no filled slots are omitted.

---

## Counting

**A boon counts as "provided by a build" if that boon's name appears in the `boons` array returned by `computeBoonCoverage()` for that build.**

- Count = number of builds in the scope (squad or line) that provide the boon
- Empty slots (unfilled comp slots) are not counted — only resolved builds contribute
- Builds without complete data (missing from catalog/editor) are skipped silently

---

## Tooltips

### Per-line boon icon tooltip

```
[boon icon]  Might                  3 builds
─────────────────────────────────
  [prof icon]  Dragonhunter
  [prof icon]  Firebrand
  [prof icon]  Catalyst
```

- Lists every build in that line that provides the boon
- Build label: `build.name` if set, else truncated build ID
- Prof icon: same profession icon used in the slot tile

### Squad boon icon tooltip

```
[boon icon]  Might                  5 builds
─────────────────────────────────
P1
  [prof icon]  Dragonhunter
  [prof icon]  Firebrand
P2
  [prof icon]  Chronomancer
  [prof icon]  Spellbreaker
```

- Same structure but contributors are grouped by party line
- Line labels match the P1/P2/… labels used in the main panel

### Dimmed (uncovered) boon tooltip

```
[boon icon]  Aegis
Not covered
```

---

## Computation

### New utility: `computeCompBoonCoverage(comp, builds, catalogCache, getCatalog)`

Located in `src/renderer/modules/boon-coverage.js`.

This function is **async** because it may need to fetch catalogs for professions not yet in cache.

**Parameters:**
- `comp` — the active comp object from state
- `builds` — `state.builds` array (all builds)
- `catalogCache` — `state.catalogCache` Map (keyed `${professionId}_${gameMode}`)
- `getCatalog` — the async `getCatalog(professionId, gameMode)` function from `renderer.js` (passed in to avoid circular imports)

**Returns:**
```js
{
  squad: {
    [boonName]: {
      count: number,
      providers: [{ buildId, buildName, lineLabel }]
    }
  },
  lines: [
    {
      lineId: string,
      label: string,           // "P1", "P2", …
      boons: {
        [boonName]: {
          count: number,
          providers: [{ buildId, buildName }]
        }
      }
    }
  ]
}
```

**Algorithm:**
1. Collect all unique `(profession, gameMode)` pairs across all filled slots; pre-fetch their catalogs via `getCatalog` (warm the cache in parallel with `Promise.all`)
2. For each entry in `comp.partyLines` (index → label P1, P2, …), using `line.id` as `lineId` in the return value:
   a. For each slot (buildId) in the line:
      - Resolve the build from `builds` by ID; if unresolvable, skip
      - Look up the catalog from `catalogCache` using `${build.profession}_${build.gameMode || "pve"}`
      - Resolve weapon skills: `resolveEquippedWeaponSkills(catalog, build)` — the stored build object has the same shape as `state.editor` for the fields `computeBoonCoverage` reads (`specializations`, `skills`, `equipment`)
      - Run `computeBoonCoverage(catalog, build, weaponSkills)`
      - For each boon in the result, record the build as a provider in that line's boon map
3. Aggregate line results into squad totals

### Threading `getCatalog` into the utility

`getCatalog` in `renderer.js` is currently a private function. It must be **exported** so it can be passed into the comp module. The call chain:

1. `renderer.js` exports `getCatalog`
2. `renderer.js` passes it to `initCompDetail({ onRerender, onOpenBuild, getCatalog })`
3. `initCompDetail` stores it and forwards it to `_renderBoonCoverageSection(container, comp, getCatalog)`
4. `_renderBoonCoverageSection` passes it to `computeCompBoonCoverage(comp, builds, catalogCache, getCatalog)`

### Async render pattern

`renderCompDetail()` is synchronous. No async patch infrastructure currently exists in `comp-detail.js` — this is new. The pattern to use:

1. During the synchronous render, write an empty placeholder:
   ```html
   <div id="comp-boon-coverage-body"><!-- loading --></div>
   ```
2. After `bindDetailEvents()`, kick off an immediately-invoked async IIFE:
   ```js
   (async () => {
     const compId = comp.id;
     const data = await computeCompBoonCoverage(comp, state.builds, state.catalogCache, getCatalog);
     // Guard against stale results if user navigated away
     if (state.activeComp?.id !== compId) return;
     const el = document.getElementById("comp-boon-coverage-body");
     if (!el) return;
     el.innerHTML = _buildBoonCoverageHTML(data);
   })();
   ```

This avoids a full re-render and matches the targeted DOM update approach used for the build pool search (`comp-detail.js` line ~959).

---

## Implementation Touch Points

| File | Change |
|------|--------|
| `src/renderer/modules/boon-coverage.js` | Add `computeCompBoonCoverage()` |
| `src/renderer/modules/comps/comp-detail.js` | Add `_renderBoonCoverageSection()`, `_buildBoonCoverageHTML()`, async IIFE patch, collapse toggle; extend `initCompDetail` options to accept `getCatalog` |
| `src/renderer/modules/comps/comps.js` | Forward `getCatalog` when calling `initCompDetail` |
| `src/renderer/renderer.js` | Export `getCatalog` |
| `src/renderer/modules/state.js` | Add `compPrefs.boonCoverageCollapsed` boolean (default `false`) |
| `src/renderer/styles/comps.css` | Styles for the coverage section, per-line rows, tooltip |

---

## Non-Goals

- No condition coverage
- No "copy to clipboard" or export
- No threshold highlighting (e.g., "you need at least 5 builds with Quickness")
- No sorting or filtering by boon coverage in the comp list view
