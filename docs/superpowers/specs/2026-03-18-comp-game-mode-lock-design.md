# Comp Game Mode Lock — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Comps must not mix PvE and WvW builds. The first build added to a comp locks it to that build's game mode. While any builds remain in the comp, only builds of the same game mode can be added. When all builds are removed the comp becomes open again.

PvP is not a supported game mode in the app and is out of scope.

---

## Data Model

### Comp schema change

Add a `gameMode` field to the comp schema in `compStore.js`. Update `upsertComp` to persist this field alongside the existing comp fields:

```js
gameMode: null | "pve" | "wvw"
```

- `null` — comp is open (no builds)
- `"pve"` — comp is locked to PvE builds
- `"wvw"` — comp is locked to WvW builds

### Migration

Migration runs once at app startup, before `listComps` is first called via IPC (in `index.js`). At that point both build and comp data are available, so they can be joined.

For each existing comp:
- If `comp.buildIds` is empty, set `comp.gameMode = null`
- Otherwise, look up `builds[comp.buildIds[0]].gameMode` and set `comp.gameMode` to that value. If the build no longer exists (deleted but still referenced), treat the comp as unlocked (`null`).

Persist each updated comp via `upsertComp`. This is a one-time pass; after migration, `gameMode` is maintained by the feature logic going forward.

---

## Lock Lifecycle

| Event | Action |
|---|---|
| First build added to comp | `comp.gameMode = build.gameMode` |
| Subsequent build added (compatible) | No change |
| Subsequent build added (incompatible) | Block; show toast |
| Last build removed from comp | `comp.gameMode = null` |
| Build deleted while inside a comp | Same as removal — update `comp.buildIds` and if now empty, `comp.gameMode = null` |

This logic runs wherever `comp.buildIds` is mutated, including the server-side `removeBuildFromComps` path in `compStore.js` which is triggered on build deletion.

**Build `gameMode` edited while inside a comp:** Out of scope. The comp's lock is not revalidated when a build's `gameMode` is changed after it is already in the comp. The editor does not check or block this.

---

## Enforcement Points

### 1. Drag from library onto comp (`library.js` → `handleDropBuildOnComp`)

Before moving the build:

1. If `comp.gameMode !== null && comp.gameMode !== build.gameMode`, abort and show toast.
2. Otherwise proceed; if `comp.buildIds` was empty, set `comp.gameMode = build.gameMode`.

### 2. Add modal in comp detail (`comp-detail.js` → `openAddBuildModal`)

If `comp.gameMode !== null`, filter the available build list to only show builds where `build.gameMode === comp.gameMode`. Incompatible builds are excluded entirely (they can't be in the comp, so no need to display them greyed out).

### 3. Paste (`library.js` → `handlePasteJson`)

`handlePasteJson` has two internal code paths that can write a build into a comp:
- **Cut-move path** (lines ~501–542): moves a build from clipboard into the target comp
- **Clipboard-paste path** (lines ~545–578): pastes a build from external clipboard JSON

Both paths must check compatibility before writing. If the target comp is locked to a different game mode, show toast and abort. This covers both the context menu Paste action (`context-menu.js`) and the Ctrl+V keyboard shortcut.

### 4. Build removal → unlock

When the last build is removed from a comp (wherever `comp.buildIds` is modified to become empty), set `comp.gameMode = null` and persist.

---

## User Feedback

### Toast notification

When an incompatible build is blocked, show a toast:

> "This comp is locked to [PvE / WvW] builds."

Use the existing toast/notification system in the app.

### Drag visual indicator

During a drag from the library, when hovering over a comp that is locked to a different game mode:

- Add `is-invalid` CSS class **alongside** the existing `lib-drop-target` class on the `[data-comp-id]` element (do not replace `lib-drop-target`)
- The drop is rejected (no action on drop)
- Remove `is-invalid` on drag leave/end

This check is synchronous using renderer-side state — no IPC round-trip needed.

---

## Out of Scope

- PvP game mode (not present in the app)
- Revalidating the comp lock when a build's `gameMode` is edited after it is already in the comp
- Enforcing game mode on builds already inside party line slots (existing slot data is trusted as valid)
- Any UI indication on the comp card/list showing its locked mode (informational display only, not required for this feature)
