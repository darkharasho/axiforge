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
- All associated CSS: `.build-summary-details`, `.build-summary-toggle`, `.build-summary-content`, `.build-summary-actions`, `.build-summary`, `.build-summary__row`, `.build-summary__label`, `.build-summary__value`, `.dirty-badge`

**Add to subnav bar** (the `Build | Equipment | PvE/WvW` row):

All new buttons go inside a `.subnav__actions` wrapper div with `margin-left: auto` and `display: flex; align-items: center; gap: 6px`. The existing `.game-mode-toggle` moves inside this wrapper (removing its own `margin-left: auto`). This keeps all right-aligned items in a single flex group.

- **Save button** — primary style, first item in the actions wrapper. When the editor has unsaved changes, display an orange dot indicator inside the button (left of the text). Button text is always "Save" (no asterisk or "Save Build*" pattern).
- **Publish button** — primary style, next to Save.
- **Publish status** — the `#publishStatus` element relocates from the removed details block into the subnav actions wrapper, between Publish and the overflow button. It displays publish progress inline.
- **Overflow menu button** (⋯) — between Publish status and the game mode toggle. Clicking opens an icon-labeled dropdown with:
  - Duplicate (copy icon)
  - Copy JSON (clipboard icon) — hidden unless dev mode
  - Paste JSON (paste icon) — hidden unless dev mode
- **Game mode toggle** — existing PvE/WvW toggle, moved inside the wrapper (last item)

**Overflow dropdown behavior:**
- Appears below the ⋯ button on click, positioned absolutely
- `z-index: 20` (above subnav's `z-index: 10`) to ensure it renders above all page content
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

No additional data fetching or schema changes needed. Note: `build.skills.heal`, `.utility[]`, and `.elite` can be `null` when no skill is selected — card rendering must use null-safe access (`build.skills?.heal?.name || ""`).

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/index.html` | Remove `<details id="buildSummaryDetails">` block. Add Save, Publish, overflow menu button to `<nav id="subnav">`. |
| `src/renderer/styles/cards.css` | Remove `.build-summary-*` and `.dirty-badge` classes. Add `.build-card__pills`, `.build-card__pill`, `.build-card__pill--elite`, `.build-card__detail` styles. |
| `src/renderer/styles/layout.css` | Add `.subnav__actions` container styles (with `margin-left: auto`), `.subnav__overflow` dropdown styles (with `z-index: 20`), `.subnav__save-dot` indicator styles. Remove `margin-left: auto` from `.game-mode-toggle`. |
| `src/renderer/modules/render-pages.js` | Rewrite `renderEditorMeta()` to only manage Save button dot state (no summary rows). Update `renderEditorForm()` to reference new subnav button locations for disabled state/tooltip management. Enrich `renderBuildList()` card rendering with pills, spec line, skill line. Update publish handler in `renderBuildList()` to call updated `renderEditorMeta()`. |
| `src/renderer/renderer.js` | Wire up overflow menu toggle/close behavior. Move Save/Publish/Duplicate click handlers to subnav button references. Update DOM element cache for new button locations. Relocate `#publishStatus` element reference. |

## Out of Scope

- Changing the build data schema or storage format
- Modifying the Publish flow or its progress UI (just relocating the trigger button)
- Redesigning the toolbar inputs (Title, Profession, Tags)
- Adding new features to the overflow menu beyond existing actions
