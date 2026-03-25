# .axicode File Export/Import Design

**Date:** 2026-03-24
**Status:** Approved

## Summary

Add the ability to export and import `.axicode` files — gzipped JSON bundles containing builds, folders, and compositions. This enables bulk backup, sharing, and transfer of library data as files rather than clipboard-only operations.

## File Format

`.axicode` files are gzipped JSON with this structure:

```json
{
  "version": 1,
  "exportedAt": "2026-03-24T12:00:00.000Z",
  "builds": [],
  "folders": [],
  "comps": []
}
```

- `version` field enables future format evolution without breaking old files.
- Uses Node.js built-in `zlib.gzip` / `zlib.gunzip` — no new dependencies.
- JSON schemas match existing `builds.json`, `folders.json`, `comps.json` — no transformation.
- Electron file dialogs filter to `*.axicode`.

## Export

### Entry Points

1. **Toolbar "Export" dropdown** — new button next to the existing Import button. Contains "Export All (.axicode)" which exports everything visible in the current view.
2. **Right-click selected items** — "Export (.axicode)" added to build multi-select, comp, multi-comp, and folder context menus.
3. **Right-click empty area** — "Export (.axicode)" exports everything visible (same as toolbar).

### Collection Logic

All paths converge on a single export function. What gets collected depends on context:

**Selection-based export:**
- Selected builds → included directly.
- Selected folder → the folder + all builds and comps inside it, recursively for subfolders. Comps pull in their referenced builds.
- Selected comp → the comp + all builds referenced by its `buildIds`.
- Mixed selection → union of all the above, deduplicated by ID.

**Visible export (empty-area or toolbar):**
- Everything currently rendered in the content area — the same set after search/filter/navigation is applied.
- Inside a folder view → that folder and its contents.
- Root with filters active → only what matches the filters.

### Save Dialog

- Electron `dialog.showSaveDialog` with filter `{ name: 'AxiCode Files', extensions: ['axicode'] }`.
- Default filename: `axiforge-export-YYYY-MM-DD.axicode` for bulk, or the item name for single selections (e.g., `Power-Berserker.axicode`).

## Import

### Entry Points

1. **Toolbar Import dropdown** — new ".axicode File" option added below existing items (Build Link, GW2Skills, AxiCode).
2. **Context menu Import submenu** — ".axicode File" added to empty-area and folder Import submenus.

### Flow

1. **File picker** — `dialog.showOpenDialog` with filter `*.axicode`.
2. **Decompress & parse** — `zlib.gunzip` → `JSON.parse`, validate `version` field.
3. **Conflict detection** — match imported items against existing library by ID.
4. **No conflicts** → import everything, show toast: "Imported 8 builds, 2 comps, 1 folder".
5. **Conflicts found** → show per-item conflict resolution dialog.
6. **Apply resolution per item:**
   - **Replace** — overwrite existing item with imported version (same ID, updated data).
   - **Import as Copy** — generate new UUID, append `(1)` / `(2)` suffix to title (reusing existing dedup logic from paste).
   - **Skip** — don't import that item.
7. **Folder targeting** — if imported from a folder context menu, reparent root-level imported items into that folder. Items in subfolders within the export retain their relative structure.
8. **Undo support** — entire import is one undo operation.

## Conflict Resolution Dialog

New modal following the existing `confirm-modal.js` pattern — singleton overlay, Promise-based API.

### Module

New files: `import-conflict-modal.js` + `import-conflict-modal.css`.

### API

```js
showImportConflictModal({
  conflicts: [
    { type: 'build', imported: {...}, existing: {...} },
    { type: 'comp',  imported: {...}, existing: {...} },
    { type: 'folder', imported: {...}, existing: {...} },
  ],
  totalCount: 8
})
// Returns Promise<Map<id, 'replace' | 'copy' | 'skip'> | null>
// null = cancelled
```

### Features

- Per-item dropdown defaulting to "Import as Copy" (safest default).
- Bulk shortcuts: "Replace All", "Copy All", "Skip All" — sets all dropdowns at once.
- Header shows "X of Y items conflict".
- Each row: colored profession/type indicator, item name, item type + metadata, dropdown.
- Scrollable list for many conflicts.
- Cancel dismisses the entire import.
- Keyboard: Escape to cancel.

## Architecture

### `@mks.haro/axicode` package (version bump to 1.3.0)

New `fileCodec.js` module:

- `encodeAxicodeFile({ builds, folders, comps })` → returns `Buffer` (gzipped JSON with `version`, `exportedAt`).
- `decodeAxicodeFile(buffer)` → returns `{ version, exportedAt, builds, folders, comps }` or throws on invalid/corrupt data.
- `isValidAxicodeFile(buffer)` → returns boolean.

### Electron main process (`src/main/`)

New `axicodeFile.js` module with two IPC handlers:

- `axicode-file:export` — receives `{ builds, folders, comps }` from renderer, calls `encodeAxicodeFile()`, opens save dialog, writes buffer to disk.
- `axicode-file:import` — opens file dialog, reads file buffer, calls `decodeAxicodeFile()`, returns parsed data to renderer.

Thin wrapper — all encode/decode logic lives in the axicode package.

### Preload bridge (`src/preload/`)

Two new methods on `window.desktopApi`:

- `exportAxicodeFile(builds, folders, comps)` → returns `{ success, filePath }` or `{ cancelled }`.
- `importAxicodeFile()` → returns `{ success, data }` or `{ cancelled }` or `{ error }`.

### Renderer (`src/renderer/modules/library/`)

New `axicode-io.js` module — orchestrates:

- Export collection logic (gather items, resolve folder/comp contents, deduplicate).
- Import flow (conflict detection, dialog, applying resolutions, dedup titles, undo).

Modifications to existing modules:

- `context-menu.js` — add export/import items to menus.
- `toolbar.js` — add Export dropdown button + .axicode to Import dropdown.
- `library.js` — wire up callbacks.

### New files

| File | Purpose |
|------|---------|
| `axicode/src/fileCodec.js` | Encode/decode .axicode file buffers |
| `axiforge/src/main/axicodeFile.js` | IPC handlers for file I/O |
| `axiforge/src/renderer/modules/library/axicode-io.js` | Export collection + import orchestration |
| `axiforge/src/renderer/modules/import-conflict-modal.js` | Conflict resolution dialog |
| `axiforge/src/renderer/styles/import-conflict-modal.css` | Dialog styles |

### No new dependencies

`zlib` is Node.js built-in. `dialog` is Electron built-in. All existing schemas reused.

## Edge Cases & Validation

### Export

- Empty selection / empty view → disable the export option (greyed out).
- Nested folder selection → recursively collect all subfolders and contents, deduplicate.
- Build referenced by multiple comps → only included once in `builds` array.

### Import

- Corrupt/non-gzip file → error dialog: "This file is not a valid .axicode file".
- Unknown `version` → error dialog: "This .axicode file was created with a newer version of AxiForge. Please update to import it."
- Folder depth overflow → if importing folders would exceed the 3-level nesting limit, flatten excess into the deepest allowed level.
- Importing into a folder already at max depth → same flattening behavior.
- Duplicate title resolution → reuse existing `(1)`, `(2)` suffix logic from paste.

### Undo

- Entire import is a single undo operation.
- Undo removes all imported items. Replacements restore originals.
