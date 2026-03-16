# Build Summary Redesign

## Problem

The build summary section in the editor takes up too much vertical space and feels outdated. It lives inside a collapsible `<details>` element that bundles both informational data rows (status, profession, specializations, skills, elite line) and action buttons (Save, Duplicate, Publish, Copy/Paste JSON). This creates unnecessary UI weight in the editor and hides important actions behind a toggle.

## Goals

- Reclaim vertical space in the editor by removing the collapsible build summary section entirely
- Make Save and Publish always visible and quickly accessible
- Move build detail data (specs, skills, elite) to the build library page where it's more useful for scanning and comparing builds
- Modernize the button treatment with a cleaner, more compact layout

## Design

### Part 1: Editor Toolbar — Buttons Move to Subnav

**Remove from editor:**
- The entire `<details id="buildSummaryDetails">` element and all its contents
- The `renderEditorMeta()` summary data rows (profession, specs, skills, elite line)
- The "Unsaved changes" text badge (`#editorDirtyBadge`)
- All associated CSS: `.build-summary-details`, `.build-summary-toggle`, `.build-summary-content`, `.build-summary-actions`, `.build-summary`, `.build-summary__row`, `.build-summary__label`, `.build-summary__value`

**Add to subnav bar** (the `Build | Equipment | PvE/WvW` row):
- **Save button** — primary style, positioned right-aligned before the PvE/WvW toggle. When the editor has unsaved changes, display an orange dot indicator inside the button (left of the text). Button text is always "Save" (no asterisk or "Save Build*" pattern).
- **Publish button** — primary style, next to Save.
- **Overflow menu button** (⋯) — between Publish and the game mode toggle. Clicking opens an icon-labeled dropdown with:
  - Duplicate (copy icon)
  - Copy JSON (clipboard icon) — hidden unless dev mode
  - Paste JSON (paste icon) — hidden unless dev mode

**Overflow dropdown behavior:**
- Appears below the ⋯ button on click
- Closes on click outside, on item selection, or on Escape
- Each item has a small icon (CSS/unicode) and label text
- Uses existing app color palette (dark background, subtle border)

**Unsaved state indicator:**
- Orange dot (6px circle) rendered inside the Save button, left of the text
- Appears when `state.editorDirty` is true, hidden otherwise
- Replaces both the old "Unsaved changes" badge and the "Save Build*" asterisk pattern

**Toolbar panel** (`panel--toolbar`) becomes just the input grid: Build Title, Profession dropdown, Tags input. No collapsible section below.

### Part 2: Build Library Cards — Enriched with Summary Data

**Current card structure:**
```
Title
Profession | GAMEMODE | Updated 3/15/2026, 6:54:09 PM
[Load] [Publish] [Delete]
```

**New card structure:**
```
Title                                          Mar 15, 2026
[Profession pill] [GameMode pill] [EliteSpec pill]
Specs: Spite · Blood Magic · Reaper
Skills: Well of Blood · Well of Suffering · Spectral Armor · Suffer! · Ghastly Breach
[Load] [Publish] [Delete]
```

**Layout details:**
- **Top row:** Build title (left, `h3`), shortened date (right, muted). Date format: "Mar 15, 2026" instead of full timestamp.
- **Pill tags row:** Horizontal flex row of small rounded pills (`border-radius: 999px`).
  - Profession pill: dark blue background (`#1a2844`), subtle border (`#2a3f69`), light text
  - Game mode pill: same dark style, muted text
  - Elite spec pill: blue-tinted background (`rgba(78,168,255,0.1)`), blue border, blue text. Only shown if the build has an elite specialization.
- **Specs line:** Label "Specs:" in accent color (`#9eb8e5`), followed by dot-separated (` · `) specialization names in muted text. Omitted if no specializations.
- **Skills line:** Label "Skills:" in accent color, followed by dot-separated skill names (heal, utilities, elite in order). Omitted if no skills.
- **Action buttons:** Unchanged — 3-column grid with Load, Publish, Delete.

**Data source:** The saved build object from `serializeEditorToBuild()` already stores:
- `build.specializations[].name` — specialization names
- `build.specializations[].elite` — boolean for elite spec detection
- `build.skills.heal.name`, `build.skills.utility[].name`, `build.skills.elite.name` — skill names
- `build.profession`, `build.gameMode` — already displayed today

No additional data fetching or schema changes needed.

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/index.html` | Remove `<details id="buildSummaryDetails">` block. Add Save, Publish, overflow menu button to `<nav id="subnav">`. |
| `src/renderer/styles/cards.css` | Remove `.build-summary-*` classes. Add `.build-card__pills`, `.build-card__pill`, `.build-card__pill--elite`, `.build-card__detail` styles. |
| `src/renderer/styles/layout.css` | Add `.subnav__actions` container styles, `.subnav__overflow` dropdown styles, `.subnav__save-dot` indicator styles. |
| `src/renderer/modules/render-pages.js` | Rewrite `renderEditorMeta()` to only manage Save button dot state (no summary rows). Enrich `renderBuildList()` card rendering with pills, spec line, skill line. |
| `src/renderer/renderer.js` | Wire up overflow menu toggle/close behavior. Move Save/Publish/Duplicate click handlers to subnav button references. Update DOM element cache for new button locations. |

## Out of Scope

- Changing the build data schema or storage format
- Modifying the Publish flow or its progress UI (just relocating the trigger button)
- Redesigning the toolbar inputs (Title, Profession, Tags)
- Adding new features to the overflow menu beyond existing actions
