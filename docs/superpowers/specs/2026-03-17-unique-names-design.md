# Unique Build and Folder Names — Design Spec

**Date:** 2026-03-17
**Status:** Approved

## Problem

Builds and folders currently have no name uniqueness enforcement. Multiple builds can share the same title and multiple folders can share the same name, causing confusion in the library.

## Requirements

- Build titles must be globally unique across the entire library (not scoped per folder).
- Folder names must be globally unique across the entire library.
- **User-initiated** actions (rename, manual create) that produce a duplicate name are **blocked** with an explanatory error message.
- **System-automated** actions (imports, default "Untitled" names on new creates) **auto-suffix** with `(2)`, `(3)`, etc. to produce a unique name.

## Approach

Renderer-only validation against `state.builds` and `state.folders`. No changes to the main process stores. This is appropriate for a single-user desktop app with no concurrent writes.

## Design

### Part 1: Shared Utilities (`src/renderer/modules/library/name-utils.js`)

Two exported helper functions:

**`isNameTaken(name, items, currentId = null)`**
- Checks whether `name` (trimmed, case-insensitive) already exists in `items` array.
- `items` is either `state.builds` (checked against `title`) or `state.folders` (checked against `name`).
- `currentId` optionally excludes one item by `id`, so a rename to the same name is not blocked.
- Returns `true` if a duplicate exists, `false` otherwise.

**`makeUniqueName(baseName, items)`**
- Tries `baseName` first; if taken, tries `baseName (2)`, `baseName (3)`, etc.
- Uses the same case-insensitive, trimmed comparison as `isNameTaken`.
- Returns the first available unique name.

Both functions treat builds and folders uniformly — the caller passes the correct array and the functions are field-agnostic (they receive pre-mapped arrays of name strings).

### Part 2: User-initiated flows — block with error

**Rename build** (`handleRename` in `library.js`)
- After the `showPrompt` modal returns a new title, call `isNameTaken(newTitle, state.builds, build.id)`.
- If taken: show error `"A build named '[name]' already exists."` and do not save.

**Rename folder** (`handleRename` for folders in `library.js`)
- After the inline input commits, call `isNameTaken(newName, state.folders, folder.id)`.
- If taken: restore the original folder name and show error `"A folder named '[name]' already exists."`.

**New build with a manually entered name**
- If the creation flow allows the user to type a name, apply the same block check before saving.

### Part 3: System-automated flows — auto-suffix

All of the following wrap their base name through `makeUniqueName` before saving:

| Location | Base name |
|---|---|
| `handleNewBuild` / `handleNewBuildInFolder` | `"Untitled Build"` |
| `handleNewFolder` / `handleNewFolderInContent` | `"Untitled Folder"` |
| `handleImportChatLink` | imported build's title |
| `handleImportGw2Skills` | imported build's title |

The de-duplicated name is used as the initial value. If the user subsequently renames it, the block behavior from Part 2 applies.

## Error Messages

- Builds: `A build named "[name]" already exists.`
- Folders: `A folder named "[name]" already exists.`

## Files Affected

| File | Change |
|---|---|
| `src/renderer/modules/library/name-utils.js` | **New** — `isNameTaken`, `makeUniqueName` |
| `src/renderer/modules/library/library.js` | Add uniqueness checks to rename and create handlers |

## Out of Scope

- No changes to `BuildStore`, `FolderStore`, or IPC handlers.
- No migration of existing duplicate names (existing data is left as-is).
- No uniqueness enforcement for tags, notes, or other fields.
