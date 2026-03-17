# Unique Build and Folder Names — Design Spec

**Date:** 2026-03-17
**Status:** Approved

## Problem

Builds and folders currently have no name uniqueness enforcement. Multiple builds can share the same title and multiple folders can share the same name, causing confusion in the library.

## Requirements

- Build titles must be globally unique across all builds. Folder names must be globally unique across all folders. Build titles and folder names are checked independently — a build named "Warrior" and a folder named "Warrior" may coexist.
- **User-initiated** actions (rename, new folder with typed name) that produce a duplicate name are **blocked** with an explanatory error message displayed as `showToast("...", "error")`.
- **System-automated** actions (imports, duplicate) **auto-suffix** with ` (2)`, ` (3)`, etc. (space before parenthesis) to produce a unique name.
- Names are trimmed on save and on comparison. Comparison is case-insensitive.
- A case-only rename (e.g., `"my build"` → `"My Build"`) is permitted via the current name exclusion in `isNameTaken`.

## Approach

Renderer-only validation against `state.builds` and `state.folders`. No changes to the main process stores. This is appropriate for a single-user desktop app with no concurrent writes.

## Design

### Part 1: Shared Utilities (`src/renderer/modules/library/name-utils.js`)

Two exported helper functions. Both operate on flat arrays of name strings (the caller maps builds to title strings or folders to name strings before calling).

**`isNameTaken(name, takenNames, excludeName = null)`**
- `name`: string to test (trimmed, lowercased for comparison).
- `takenNames`: `string[]` — the existing names to check against.
- `excludeName`: optional string to exclude from the check (used for renames so the current name doesn't block itself — pass the item's current name, not its id).
- Returns `true` if a duplicate exists, `false` otherwise.

Example call for rename-build:
```js
isNameTaken(newTitle, state.builds.map(b => b.title), build.title)
```

**`makeUniqueName(baseName, takenNames)`**
- `baseName`: the desired name (trimmed).
- `takenNames`: `string[]` — existing names (comparison is case-insensitive).
- Tries `baseName` first; if taken, tries `baseName (2)`, `baseName (3)`, etc. (space before parenthesis).
- Returns the first available name, preserving the original casing of `baseName`.
- Does not strip existing suffixes — `"My Build (Copy)"` duplicated produces `"My Build (Copy) (2)"`, which is intentional.

### Part 2: User-initiated flows — block with error

All flows check after the null/cancel guard and before the save call.

**Rename build** (`handleRename`, line 225)
- `showPrompt` already trims and returns `null` for both cancel and empty-submit. The existing `if (!newTitle) return` guard is sufficient; no additional trim is needed.
- After the guard, call `isNameTaken(newTitle, state.builds.map(b => b.title), build.title)`.
- If taken: `showToast('A build named "${newTitle}" already exists.', "error")` and `return`.

**Rename folder** (`handleRenameFolder`, line 407)
- `insertInlineInput` returns `null` on Escape only. The call should pass `fallbackName: folder.name` so that blanking the field and pressing Enter/blur restores the original name rather than defaulting to "New Folder". This makes blank-Enter behave like a cancel.
- Existing guard: `if (!newName) { renderLibrary(); return; }` — fires on Escape only (and on blank-Enter if fallbackName is empty string, but with the recommendation above it fires for blank-Enter too since `folder.name` is truthy).
- After the guard, call `isNameTaken(newName, state.folders.map(f => f.name), folder.name)`.
- If taken: `showToast('A folder named "${newName}" already exists.', "error")` then `renderLibrary(); return`.

**New folder — sidebar** (`handleNewFolder`, line 193)
- `insertInlineInput` returns `null` on Escape, or the typed name (or "New Folder" if blank) otherwise.
- After the existing null guard, call `isNameTaken(name, state.folders.map(f => f.name))`.
- If taken: `showToast(...)` then `renderLibrary(); return`.

**New folder — content area** (`handleNewFolderInContent`, line 203)
- Same pattern as `handleNewFolder`.

**New subfolder** (`handleNewSubfolder`, line 418)
- Same pattern. The `fallbackName` here is also "New Folder" by default.

**New folder and move** (`handleNewFolderAndMove`, line 455)
- Same pattern. If taken: show error, `renderLibrary(); return` (no move occurs).
- Note: the existing guard `if (!folder?.id) return` at line 464 should also call `renderLibrary()` for consistency — fix this alongside the uniqueness check.

### Part 3: System-automated flows — auto-suffix

All of these call `makeUniqueName` before saving.

| Handler | Base name passed to `makeUniqueName` | `takenNames` |
|---|---|---|
| `handleDuplicate` (line 235) | `"${build.title \|\| 'Untitled'} (Copy)"` | `state.builds.map(b => b.title)` |
| `handleImportChatLink` (line 320) | `result.name` | `state.builds.map(b => b.title)` |
| `handleImportGw2Skills` (line 337) | `result.name` | `state.builds.map(b => b.title)` |

For the import handlers, the unique name is produced before the IPC call:
```js
const safeName = makeUniqueName(result.name, state.builds.map(b => b.title));
const saved = await window.desktopApi.importChatLink(result.link, safeName, folderId, gameMode);
```

**UX note:** The user types a name in the import modal, but per the agreed behavior, imports are treated as system-automated — if the typed name is taken, the build is silently saved with a ` (2)` suffix. This is intentional (matching the "imports append (2)" rule) and is accepted UX for this app.

### Part 4: Validation ordering pattern for `insertInlineInput` flows

The check always goes after the cancel guard and before the save:

```js
const name = await insertInlineInput(...);
if (!name) { renderLibrary(); return; }           // Escape-cancel only
if (isNameTaken(name, state.folders.map(f => f.name))) {
  showToast(`A folder named "${name}" already exists.`, "error");
  renderLibrary();
  return;
}
await saveFolder({ name, ... });
renderLibrary();
```

This does not require changes to `insertInlineInput` itself.

## Error Messages

- Builds: `A build named "[name]" already exists.`
- Folders: `A folder named "[name]" already exists.`

All error toasts use `showToast("...", "error")`.

## Files Affected

| File | Change |
|---|---|
| `src/renderer/modules/library/name-utils.js` | **New** — `isNameTaken`, `makeUniqueName` |
| `src/renderer/modules/library/library.js` | Add uniqueness checks to all handlers listed above |

## Out of Scope

- No changes to `BuildStore`, `FolderStore`, or IPC handlers.
- No migration of existing duplicate names (existing data is left as-is).
- **Default "Untitled Build" title** — `handleNewBuild` and `handleNewBuildInFolder` call `_app.startNewBuild?.()` and navigate to the editor; the title is assigned inside the editor module on first save. Uniqueness for the default build title is a follow-up.
- **`handlePasteJson`** — delegates entirely to `_app.importBuildJsonFromClipboard?.()` in the editor module, which saves via `loadBuildIntoEditor` + mark-dirty flow, not through the library's `saveBuild` IPC path. Out of scope for this spec.
- No uniqueness enforcement for tags, notes, or other fields.
