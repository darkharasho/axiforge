# Comp List Redesign

## Problem

The current comp list page is a flat, visually plain list that shows only an icon, name, build count, and tag pills per row. Users must open each comp to see useful information like game mode, squad composition, boon coverage, or publish status. The toolbar is minimal — just search, sort, and a "New Comp" button — with no filtering, bulk actions, or view options.

## Goals

- Make the comp list visually compelling and information-rich at a glance
- Surface key comp metadata (game mode, squad size, profession icons, boon coverage, publish status, timestamps) directly in the list
- Provide robust filtering, sorting, and bulk action capabilities
- Support two view densities (expanded and compact)

## Design

### Comp Row — Expanded View

Each comp renders as a two-line card-style row:

**Top line (left to right):**
- Checkbox (low opacity by default, full opacity on hover or when any item is selected)
- Comp name (gold accent, `#c8a96e`, 13px, semibold)
- Game mode badge — "PvE" (blue tint, `#4fc3f7`) or "WvW" (red tint, `#ef5350`); bordered pill with tinted background. Omitted if `gameMode` is null.
- Publish status badge — "Published" (green tint, `#4caf50`) or "Draft" (gray, `#888`); always visible
- Spacer
- "Updated Xd ago" relative timestamp (dim, `#555`)

**Bottom line (left to right, aligned under name):**
- Profession/spec icons — real GW2 SVG icons from `gw2-class-icons` via `getProfessionSvg()`, rendered at 22x22px with profession-colored backgrounds and 4px border-radius. Show first 5 unique specs across all party lines. If more exist, show "+N" count. Empty/unfilled slots shown as dashed-border outlines.
- Pipe separator
- Party/slot summary — e.g., "2 parties · 10 slots"
- Pipe separator
- Boon coverage indicator — colored dot (8px, green/yellow/red based on thresholds) + percentage text in matching color
- Tags (pushed to right) — rounded pills, `9px`, border `#252545`

**Boon coverage thresholds:**
- Green (`#4caf50`): >= 80%
- Yellow (`#ffc107`): >= 50% and < 80%
- Red (`#f44336`): < 50%

**Row interactions:**
- Hover: border shifts to `#c8a96e44` (subtle gold glow)
- Click: opens comp detail view (existing behavior)
- Right-click: existing context menu (open, rename, duplicate, copy JSON, copy AxiCode, delete, paste)
- Checkbox click: enters/toggles bulk selection mode

### Comp Row — Compact View

Single-line dense rows for users who want to fit more on screen. Shows: checkbox, name, game mode badge, publish badge, party/slot count, boon coverage dot + %, timestamp. No profession icons or tags. Same interactions.

### Toolbar — Progressive Two-Tier Layout

**Tier 1 (always visible):**
| Element | Position | Description |
|---------|----------|-------------|
| New Comp button | Left | Gold background (`#c8a96e`), dark text, "+" icon, prominent |
| Search input | Left of center | Max-width 260px, magnifying glass icon, placeholder "Search comps...", filters by name (case-insensitive) |
| Spacer | Center | Pushes remaining controls right |
| Filters toggle | Right | Button with funnel icon. Default state: subtle (`#1a1a3a` bg). Active state (filters open or any filter applied): gold tint (`#c8a96e22` bg, gold text) |
| View toggle | Right | Two-button group — expanded rows icon (active by default, gold) and compact rows icon. Bordered group with `#252545` |

Note: Sort controls are moved from tier 1 (where they currently live) to tier 2, consolidating all filtering/sorting into the collapsible section.

**Tier 2 (collapsible, toggled by Filters button):**
| Element | Position | Description |
|---------|----------|-------------|
| Mode dropdown | Left | Label "MODE", select with options: All, PvE, WvW |
| Status dropdown | Left | Label "STATUS", select with options: All, Published, Draft |
| Sort dropdown + direction | Left | Label "SORT", select with options: Last Updated, Date Created, Name. Adjacent up/down arrow button to toggle asc/desc |
| Spacer | Center | |
| Tag chips | Right | Label "TAGS", horizontal row of tag pill buttons. Click toggles active state (gold border/text when active). Multiple tags use OR logic. |

Labels are uppercase, 10px, dim (`#555`), with `letter-spacing: 0.5px`.

Filter state is persisted in `state.compPrefs` (existing pattern) — extended with:
- `activeFilters.gameMode`: `null` | `"pve"` | `"wvw"`
- `activeFilters.publishStatus`: `null` | `"published"` | `"draft"`
- `filtersExpanded`: `boolean`
- `viewMode`: `"expanded"` | `"compact"`

### Bulk Selection Mode

Triggered when any checkbox is checked.

**Behavior:**
- Toolbar tier 1 is replaced by a contextual action bar with gold-tinted background (`#c8a96e11`, border-bottom `#c8a96e44`)
- Action bar contains: master checkbox (select all/none), "N selected" label (gold text), spacer, then action buttons: Tag, Export, Delete, Cancel
- Tag button: opens a dropdown/popover to add or remove tags from selected comps
- Export button: exports selected comps as JSON (same format as existing "Copy JSON" context menu action)
- Delete button: red-tinted, confirms before deleting
- Cancel button: deselects all, returns to normal toolbar
- Selected rows get gold-tinted background (`#c8a96e0a`) and gold border (`#c8a96e44`)
- Unselected rows remain normal

**Exiting bulk mode:**
- Click Cancel
- Uncheck all checkboxes
- Navigate away from comps page

### Empty State

When no comps exist or no comps match current filters:

- Centered message area
- If no comps at all: "No compositions yet" + "Create your first comp to organize builds into party groups" + gold "New Comp" button
- If filters produce no results: "No comps match your filters" + "Try adjusting your filters or search" + "Clear Filters" button

### Data Flow

**Publish status:**
- A comp is considered published when `comp.publishedFileId` is truthy; otherwise it is a draft.

**Profession icons per comp:**
1. For each comp, iterate through `partyLines[].slots[]` to collect all assigned `buildId`s
2. Look up each build from `state.builds` — use `build.profession` as the icon name (always present as a top-level field). If the build has an elite spec selected (`build.specializations[2]?.name` where `build.specializations[2]?.elite === true`), use that spec name instead for a more specific icon.
3. Deduplicate and take first 5 unique specs/professions
4. Render each using `getProfessionSvg(specName)` with the profession's color as background
5. If total unique specs > 5, show "+N" suffix

**Boon coverage:**
- Reuse existing `computeCompBoonCoverage()` from `comp-boon-coverage.js`
- Aggregate percentage formula: `(number of boons in the squad coverage map with count > 0) / 12 * 100`, rounded to nearest integer. The 12 boons are those in `BOON_DISPLAY_ORDER`.
- **Caching strategy:** Maintain a module-level `Map<compId, { percentage: number, hash: string }>` cache. The hash is computed from the comp's `buildIds` array (joined + hashed). On each render, compare the current hash to the cached hash — only recompute if they differ. Since `computeCompBoonCoverage()` is async, render rows with a placeholder ("--") initially, then update the percentage in-place when the async computation resolves. Invalidate cache entry when the comp's builds change.
- Show aggregate percentage across all party lines

**Relative timestamps:**
- Compute from `comp.updatedAt` ISO string
- Threshold rules: < 1 min = "just now", 1-59 min = "Xm ago", 1-23h = "Xh ago", 1-6d = "Xd ago", 1-4w = "Xw ago", 1-11mo = "Xmo ago", >= 12mo = "Xy ago"

**Bulk selection state:**
- Track selected comp IDs in a module-level `Set<string>` (not persisted in `state`). On each `renderCompList()` call, restore checkbox `checked` state from this set. Clear the set when navigating away from the comps page or clicking Cancel in the bulk action bar.

### Batch IPC Operations

Bulk actions require new IPC channels:

| Channel | Preload bridge method | Description |
|---------|----------------------|-------------|
| `comps:delete-batch` | `desktopApi.deleteComps(ids: string[])` | Delete multiple comps by ID array |
| `comps:add-tags` | `desktopApi.addTagsToComps(ids: string[], tags: string[])` | Add tags to multiple comps |
| `comps:remove-tags` | `desktopApi.removeTagsFromComps(ids: string[], tags: string[])` | Remove tags from multiple comps |

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/modules/comps/comp-list.js` | Major rewrite — new row rendering, toolbar, filter tier, bulk selection, view toggle, boon coverage cache |
| `src/renderer/styles/comps.css` | New styles for expanded/compact rows, toolbar tiers, badges, bulk selection bar, profession icon strip |
| `src/renderer/modules/state.js` | Extend `compPrefs` with new filter/view fields |
| `src/renderer/modules/comps/comps.js` | Minor — pass new callbacks for bulk actions (delete multiple, tag multiple, export multiple) |
| `src/main/compStore.js` | Add `deleteComps(ids)`, `addTagsToComps(ids, tags)`, `removeTagsFromComps(ids, tags)` batch operations |
| `src/main/index.js` | Register IPC handlers for `comps:delete-batch`, `comps:add-tags`, `comps:remove-tags` |
| `src/preload/index.js` | Expose `deleteComps`, `addTagsToComps`, `removeTagsFromComps` on `desktopApi` |

## Existing Patterns Preserved

- Context menu (right-click) behavior unchanged
- Search filtering logic extended, not replaced
- Sort field/direction persistence in `state.compPrefs`
- Tag chip OR-logic filtering kept
- All existing callbacks (`onOpenComp`, `onNewComp`, `onDeleteComp`, `onRenameComp`, `onDuplicateComp`) retained
- Inline renaming (double-click or F2) preserved

## Out of Scope

- Drag-and-drop reordering of comps in the list
- Folder/grouping organization
- Comp detail page changes
- Keyboard navigation / accessibility enhancements (future work)
