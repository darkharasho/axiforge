# Comp System Design

## Overview

Comps (compositions) are a new entity type that groups multiple builds together for squad planning. They are first-class entities in the library alongside builds and folders, with their own dedicated detail view for managing party line assignments.

## Data Model

### Comp Entity

Stored in `data/comps.json` via a new `compStore.js` in the main process.

```js
{
  id: string,              // UUID
  name: string,            // max 140 chars
  notes: string,           // max 12000 chars
  tags: string[],
  folderId: string | null, // null = root level
  sortOrder: number,
  buildIds: string[],      // references to library builds in this comp
  partyLines: [
    {
      id: string,          // UUID for stable identity during reorder
      capacity: number,    // total slot count (filled + empty); default 5, max 50
      slots: string[]      // buildId entries; no nulls — length = number of filled slots
    }
  ],
  createdAt: string,       // ISO 8601
  updatedAt: string        // ISO 8601
}
```

Key constraints:
- `buildIds` is the flat list of all builds in this comp (the "build pool")
- `partyLines[].slots` references builds from `buildIds` — a build can appear in multiple slots across lines
- `partyLines[].capacity` tracks the total number of visual slots (filled + empty); the UI renders `capacity` boxes, with `slots.length` filled and the rest empty
- Total capacity across all party lines capped at **50** (hard limit, matching GW2 squad max)
- A new comp starts with **one party line with capacity 5** (all empty)
- Clicking an empty `+` slot increments capacity by 1 (if under 50 total); dragging a build into an empty slot fills it without changing capacity
- Builds are **references**, not copies — edits to a build in the library propagate to all comps containing it
- A build can belong to **multiple comps**
- No changes to the build entity — builds do not know they are in a comp
- No changes to the folder entity — comps use `folderId` independently, same as builds

### Main Process Store (`compStore.js`)

Mirrors the pattern of `buildStore.js` and `folderStore.js`:
- `loadComps()` — read `comps.json` into memory
- `upsertComp(comp)` — create or update a comp
- `deleteComp(id)` — remove a comp
- `reorderComps(updates)` — batch update `sortOrder` values
- `listComps()` — return all comps

IPC handlers registered on the `comps:` namespace:
- `comps:list` — return all comps
- `comps:save` — create/update
- `comps:delete` — delete
- `comps:reorder` — reorder

### State Integration

Add to the global `state` object:
- `state.comps: []` — all comp entities
- `state.activeComp: null | comp` — currently viewed comp in detail mode
- `state.compPage: "list" | "detail"` — current mode of the comps page

## Library Integration

### Comps in the Sidebar

- Comps appear alongside builds in folder listings, distinguished by a squad/group icon
- The existing smart folders ("All Builds", by Profession, by Game Mode) do **not** include comps
- A new **"All Comps"** smart folder appears in the sidebar
- Creating a new comps: the "New" button dropdown gets a **"New Comp"** option alongside "New Build" and "New Folder"

### Comps in Content Views

- In list/table/grid/columns/icon views, comps render as a distinct row/card with a squad icon, comp name, and a build count badge (e.g., "6 builds")
- Clicking a comp navigates to the comp detail view
- Double-click or Enter opens the comp, same interaction pattern as loading a build

### Drag & Drop

- Comps are draggable into folders, same as builds (reorder, move between folders)
- Dragging a **build onto a comp** in the library adds that build to the comp's `buildIds`
- Comps **cannot** be dragged into other comps (no nesting)

### Context Menu

Right-click on a comp shows:
- Open
- Rename
- Duplicate
- Move to Folder
- Delete

### Selection

- Comps participate in multi-select for bulk move/delete operations
- Cannot bulk-select a mix of comps and builds for comp-specific actions

## Comps Page

### Navigation

- The left nav "Comps" button navigates to `#page-comps`
- The page has two modes: **list mode** and **detail mode**
- `state.compPage` tracks which mode is active

### List Mode

Displays all comps with a toolbar mirroring the library:
- **Search bar** — filter comps by name
- **Sort dropdown** — sort by name, date created, date updated
- **Filter chips** — filter by tags
- Each comp row shows: squad icon, name, build count, tags
- Clicking a comp switches to detail mode

### Detail Mode

**Layout: Side-by-side, 40/60 split.**

#### Top Bar
- "← Back to Comps" link (returns to list mode)
- Comp name (editable inline)
- Notes toggle button
- Slot counter: "X / 50 slots"

#### Tags Row
- Tag pills with `+ tag` button, same interactive pill UI as builds

#### Left Panel (40%) — Party Lines

Header: "PARTY LINES" label only (no controls in header).

Each party line is a **compact inline row**:
- `P#` label inline on the left (fixed 22px width)
- Slots rendered as 42×42px boxes in a flex-wrap container, **max-width constrained to 5 boxes per row** — wraps to a second row if > 5 members
- Filled slots: profession-colored border, circular class/elite spec icon inside, tooltip showing build name
- Empty slots: dashed border with `+` icon
- Duplicate (⧉) and remove (✕) controls on the far right, same line
- When a line wraps (> 5 slots), the P# label and controls align to the top
- Subtle bottom border separating lines (no card wrapper)
- Party lines are **draggable to reorder** — P# labels renumber automatically

**"+ Add Line"** at the bottom: a dashed-border row with just the text, matching the empty slot visual language.

**Slot interactions:**
- Drag a build from the pool onto an empty slot to assign it
- Drag a filled slot to another slot to swap (within or across lines)
- Right-click a filled slot: Remove from Line, Swap, Open Build
- Hovering a filled slot shows build name tooltip
- Clicking a filled slot opens that build in the editor

**Drag behavior:** When dragging a mini card from the build pool, the drag ghost **shrinks to just the class icon** (matching the slot size) for clean visual feedback when dropping into party line slots.

**Duplicate line:** Creates a new party line with the same `capacity` and `slots` array, appended below the source line.

#### Right Panel (60%) — Build Pool

Header: "BUILDS (N)" label + search input + "+ Add" button.

Each build displayed as a **mini card**:
- Profession-colored left border (3px)
- 32px circular class/elite spec icon
- **Top line:** Build name + tag pills
- **Bottom line:** Stat package (gold) · Rune · Relic (separated by · dots)
- Game mode badge on the far right
- Entire card is draggable

**"+ Add" button** opens a picker modal to select builds from the full library (search/filter capable).

**Search input** filters the build pool by name.

**Removing a build** from the pool (via right-click or remove button) also clears it from any party line slots it occupies.

## Deleted Build Handling

When a build is deleted from the library:
- Remove its ID from `buildIds` in all comps that reference it
- Clear its ID from any `partyLines[].slots` entries
- This cleanup happens in the build deletion flow (main process)

## File Structure

New files:
- `src/main/compStore.js` — data persistence & IPC handlers
- `src/renderer/modules/comps/comps.js` — page orchestrator (list + detail modes)
- `src/renderer/modules/comps/comp-list.js` — list mode rendering & toolbar
- `src/renderer/modules/comps/comp-detail.js` — detail view rendering & interactions
- `src/renderer/modules/comps/comp-drag-drop.js` — SortableJS setup for party lines & build pool
- `src/renderer/styles/comps.css` — all comp-related styles

Modified files:
- `src/renderer/modules/state.js` — add `comps`, `activeComp`, `compPage` to state
- `src/renderer/modules/render-pages.js` — wire comp page rendering
- `src/renderer/renderer.js` — init comps module, load comps on startup
- `src/renderer/modules/library/sidebar.js` — add "All Comps" smart folder
- `src/renderer/modules/library/content.js` — render comp entities in views
- `src/renderer/modules/library/context-menu.js` — comp context menu
- `src/renderer/modules/library/drag-drop.js` — handle drop-build-onto-comp
- `src/renderer/modules/library/library.js` — wire comp actions (new, delete, etc.)
- `src/renderer/modules/library/folder-store.js` — include comps in folder queries
- `src/main/buildStore.js` — cleanup comp references on build deletion
- `src/preload/index.js` — expose comp IPC methods
- `index.html` — update `#page-comps` stub with proper structure

## Out of Scope

- Comp publishing/sharing (future)
- Comp import/export (future)
- AxiCode encoding for comps (future)
- Role labels on party line slots (e.g., "healer", "alac") — possible future enhancement
- Boon/buff coverage analysis per party line — possible future enhancement
