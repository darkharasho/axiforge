# Build Library Revamp — Design Spec

## Overview

Revamp the build library from a flat list of build cards into a file-system-like experience with folders, multiple views, context menus, drag-and-drop, multi-select, and sortable/filterable columns. The goal is an intuitive, snappy, easy-to-use UI for maintaining builds.

## Data Model

### Build Schema Additions

Three new fields added to the existing build schema (additive, no breaking changes):

| Field       | Type             | Default | Description                                      |
|-------------|------------------|---------|--------------------------------------------------|
| `folderId`  | `string \| null` | `null`  | ID of the custom folder this build lives in      |
| `pinned`    | `boolean`        | `false` | Whether pinned to top of its current view        |
| `sortOrder` | `number`         | `0`     | Manual ordering within a folder (drag reorder)   |

### Folder Schema

New `folders.json` file alongside `builds.json`, managed by `FolderStore`. Each folder:

```json
{
  "id": "uuid",
  "name": "string",
  "parentId": "string | null",
  "sortOrder": 0,
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

- `parentId: null` means top-level folder.
- Nesting is allowed to arbitrary depth but the UI encourages 2 levels max.
- Deleting a folder sets `folderId: null` on all builds in that folder (moves them to root).
- Deleting a parent folder also deletes all sub-folders (their builds also move to root).

### Smart Folders

Not stored — computed at render time from build properties:

- **All Builds** — always present, shows total count
- **By Profession** — one entry per profession that has at least 1 build
- **By Game Mode** — one entry per game mode (PvE, WvW, PvP) that has at least 1 build

Smart folders are read-only and not editable by the user.

### Build-to-Folder Relationship

- A build lives in exactly one custom folder (or at root if `folderId` is `null`).
- A build naturally appears in whichever smart folders match its properties (profession, game mode).
- Builds with no custom folder assignment sit at the root level alongside custom folders.

### Migration

On first launch after update:
- Existing builds get `folderId: null`, `pinned: false`, `sortOrder: 0`.
- Empty `folders.json` created: `[]`.
- No data loss, fully backwards compatible.

## Sidebar

### Structure

Collapsible sidebar on the left side of the library page.

**Smart Folders** section:
- "All Builds" — always present, shows total count
- "By Profession" — expandable group, one child per profession with builds, shows count
- "By Game Mode" — expandable group, one child per mode with builds, shows count

**My Folders** section:
- Flat list of top-level folders with expand/collapse chevrons for those with sub-folders
- Each folder shows build count
- "+" button in section header to create a new folder
- Folders are drag targets (drag builds onto them to move)
- Folders can be reordered by dragging within the sidebar

### Navigation Behavior

- Clicking a folder (smart or custom) filters the main content area to show that folder's builds.
- Breadcrumb trail at the top of content area shows current location (e.g., "My Folders > Raid Builds > Wing 1-4").
- Breadcrumb segments are clickable to navigate up.
- Collapse button hides sidebar; content area expands to full width.
- Sidebar state persisted to user preferences: collapsed/expanded, which folders are open.

### Entering Folders (Main Content Area)

- Double-click a folder card/row to navigate into it.
- Or click in the sidebar.
- Folder contents show sub-folders first, then builds.

## Views

Four view modes, persisted to user preferences. Switching views preserves sort order and filters.

### List View (Default)

Compact rows (~30px height). Each row contains:
- Elite spec / core profession icon (from `gw2-class-icons`, profession-colored)
- Build title
- Pin star (if pinned)
- Metadata pills: profession, game mode, elite spec
- Last modified date

Thin header row with clickable sort areas. Folders render as rows with Heroicon folder icon at the top of the list.

### Table View

Full spreadsheet with sortable column headers:
- Pin star
- Spec icon
- Name
- Profession
- Elite Spec
- Game Mode
- Tags (as small chips)
- Created date
- Modified date

Click any header to sort ascending/descending (toggle, with sort indicator arrow). Column widths resizable by dragging header borders. Folders appear as rows with folder icon, only name column populated.

### Grid View

Small cards with:
- Spec icon + title + date in card header
- Metadata pills below
- Pin star in top-right corner if pinned
- Auto-fill grid adapting to container width

Folder cards: folder icon + name + build count.

### Icon View

Minimal: spec icon (larger) + title below. Tightly packed grid for maximum density. Folders shown as folder icon + name. Best for large collections and visual scanning.

### Shared Across All Views

- **Toolbar:** breadcrumb, search input, sort dropdown, view mode toggle buttons, "New Build" button
- **Filter chips bar:** toggleable chips for profession, game mode, elite spec, tags
- Active filters + search combine with AND logic
- Pinned builds always float to top regardless of sort
- All UI icons (folders, actions, toolbar) use Heroicons
- All build icons use `gw2-class-icons` SVGs (elite spec icon if available, otherwise core profession icon)

## Selection & Interaction

### Selection

- Single click selects a build (deselects others).
- `Ctrl+click` toggles individual selection (add/remove from multi-select).
- `Shift+click` selects range between last selected and clicked item.
- `Ctrl+A` selects all visible builds.
- `Escape` clears selection.
- Selection persists across sort/filter changes (selected items that become hidden stay selected).

### Drag and Drop

- Drag a single build onto a folder (sidebar or inline) to move it.
- Drag with multi-select moves all selected builds.
- Drag folders in sidebar to reorder.
- Drag a build between other builds to manually reorder (updates `sortOrder`).
- Visual feedback: drop target highlights, insertion line between items for reorder.
- Dragging over a folder in the sidebar auto-expands it after a short hover delay (~500ms).

### Keyboard Shortcuts

| Key        | Action                          |
|------------|---------------------------------|
| `Enter`    | Load selected build in editor   |
| `F2`       | Rename selected build/folder    |
| `Ctrl+D`   | Duplicate selected build        |
| `Ctrl+N`   | New build                       |
| `Ctrl+C`   | Copy selected build(s) as JSON  |
| `Ctrl+V`   | Paste build from JSON           |
| `Del`      | Delete selected (with confirm)  |
| `Ctrl+A`   | Select all                      |
| Arrow keys | Navigate up/down through list   |

### Double-Click

- On a build — load in editor.
- On a folder — navigate into it.

## Context Menus

All menu items use Heroicons. Destructive actions shown in red at bottom of menu.

### Single Build Right-Click

1. Load in Editor (`Enter`)
2. Rename (`F2`)
3. Duplicate (`Ctrl+D`)
4. ---
5. Pin to Top / Unpin
6. Move to Folder > (submenu: New Folder..., Root (no folder), then all custom folders)
7. Edit Tags...
8. ---
9. Copy as JSON (`Ctrl+C`)
10. Publish to Web
11. ---
12. Build Info
13. Delete (`Del`)

### Multi-Select Right-Click

1. Header: "N builds selected"
2. ---
3. Move to Folder >
4. Add Tags...
5. Pin All / Unpin All
6. ---
7. Export as JSON
8. ---
9. Delete N Builds

### Folder Right-Click

1. Open Folder (`Enter`)
2. Rename Folder (`F2`)
3. ---
4. New Sub-folder
5. New Build in Folder
6. ---
7. Delete Folder (note: builds moved to root)

### Empty Area Right-Click

1. New Build (`Ctrl+N`)
2. New Folder
3. ---
4. Paste Build from JSON (`Ctrl+V`)
5. ---
6. Select All (`Ctrl+A`)

## Persistence & IPC

### New IPC Handlers (Main Process)

**Folders:**
- `folders:list` — returns all folders
- `folders:save` — create or update a folder (upsert)
- `folders:delete` — delete folder by ID (builds with that `folderId` set to `null`)
- `folders:reorder` — update `sortOrder` for a batch of folders

**Builds (additions):**
- `builds:move` — update `folderId` for one or more build IDs
- `builds:pin` — toggle `pinned` for one or more build IDs
- `builds:reorder` — update `sortOrder` for a batch of builds

### User Preferences

Stored in app config (or new `preferences.json`):

| Key                               | Type       | Default      |
|-----------------------------------|------------|--------------|
| `library.viewMode`                | string     | `"list"`     |
| `library.sortField`              | string     | `"updatedAt"`|
| `library.sortDirection`          | string     | `"desc"`     |
| `library.sidebarOpen`            | boolean    | `true`       |
| `library.sidebarExpandedFolders` | string[]   | `[]`         |
| `library.activeFilters`          | object     | `{}`         |

## Component Architecture

Vanilla JS modules. Each module is small and single-purpose.

### New Modules

| Module                                          | Responsibility                                                      |
|-------------------------------------------------|---------------------------------------------------------------------|
| `src/renderer/modules/library/library.js`       | Main orchestrator: initializes sidebar, content, toolbar, wires them together |
| `src/renderer/modules/library/sidebar.js`       | Renders sidebar tree, folder navigation, expand/collapse, drag targets |
| `src/renderer/modules/library/content.js`       | Renders active view (list/table/grid/icon), build rendering per mode |
| `src/renderer/modules/library/toolbar.js`       | Search, sort, view toggle, filter chips, breadcrumb                 |
| `src/renderer/modules/library/context-menu.js`  | Builds and shows context menus based on right-click target          |
| `src/renderer/modules/library/selection.js`     | Selection state, Ctrl/Shift+click logic, keyboard navigation       |
| `src/renderer/modules/library/drag-drop.js`     | Drag and drop for builds and folders, reorder and move              |
| `src/renderer/modules/library/folder-store.js`  | Client-side folder operations via IPC                               |

### New Main Process Files

| File                          | Responsibility                          |
|-------------------------------|-----------------------------------------|
| `src/main/folderStore.js`     | Persistence layer for `folders.json`    |

### Modified Files

| File                                       | Changes                                                        |
|--------------------------------------------|----------------------------------------------------------------|
| `src/main/buildStore.js`                   | Add `folderId`, `pinned`, `sortOrder` to normalization         |
| `src/main/index.js`                        | Add new IPC handlers for folders, move, pin, reorder           |
| `src/renderer/modules/render-pages.js`     | Replace `renderBuildList()` with new library module            |
| `src/renderer/modules/state.js`            | Add `folders`, library preferences to state                    |
| `src/renderer/index.html`                  | Replace library page markup with new structure                 |

### New Styles

| File                                  | Responsibility                                          |
|---------------------------------------|---------------------------------------------------------|
| `src/renderer/styles/library.css`     | All library styles, prefixed with `lib-` to avoid conflicts |

Replaces relevant parts of `cards.css` for the build list. Organized by section: sidebar, toolbar, list view, table view, grid view, icon view, context menu, drag-drop feedback.

## Dependencies

- **Heroicons** — UI icons (folders, actions, toolbar). Inline SVG symbols, no package dependency needed.
- **gw2-class-icons** — already installed, used for build spec/profession icons via `profession-icons.js`.
- No new npm packages required.
