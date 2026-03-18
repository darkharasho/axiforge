# Comp Game Mode Lock — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Comps must not mix PvE and WvW builds. The first build added to a comp locks it to that build's game mode. While any builds remain in the comp, only builds of the same game mode can be added. When all builds are removed the comp becomes open again.

PvP is not a supported game mode in the app and is out of scope.

---

## Data Model

### Comp schema change

Add a `gameMode` field to the comp schema in `compStore.js`:

```js
gameMode: null | "pve" | "wvw"
```

- `null` — comp is open (no builds)
- `"pve"` — comp is locked to PvE builds
- `"wvw"` — comp is locked to WvW builds

### Migration

During `normalizComp` (or equivalent migration pass), derive `gameMode` for all existing comps by reading `builds[comp.buildIds[0]].gameMode`. If `buildIds` is empty, set to `null`.

---

## Lock Lifecycle

| Event | Action |
|---|---|
| First build added to comp | `comp.gameMode = build.gameMode` |
| Subsequent build added (compatible) | No change |
| Subsequent build added (incompatible) | Block; show toast |
| Last build removed from comp | `comp.gameMode = null` |

This logic runs wherever `comp.buildIds` is mutated.

---

## Enforcement Points

### 1. Drag from library onto comp (`library.js` → `handleDropBuildOnComp`)

Before moving the build:

1. If `comp.gameMode !== null && comp.gameMode !== build.gameMode`, abort and show toast.
2. Otherwise proceed; if `comp.buildIds` was empty, set `comp.gameMode = build.gameMode`.

### 2. Add modal in comp detail (`comp-detail.js` → `openAddBuildModal`)

If `comp.gameMode !== null`, filter the available build list to only show builds where `build.gameMode === comp.gameMode`. Incompatible builds are excluded entirely (they can't be in the comp, so no need to display them greyed out).

### 3. Paste via context menu (`context-menu.js`)

Before pasting a build into a comp, check compatibility. If incompatible, show toast and abort.

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

- Add an `is-invalid` CSS class to the drag target element
- The drop is rejected (no action on drop)
- Remove `is-invalid` class on drag leave/end

This check is synchronous using renderer-side state — no IPC round-trip needed.

---

## Out of Scope

- PvP game mode (not present in the app)
- Enforcing game mode on builds already inside party line slots (existing slot data is trusted as valid)
- Any UI indication on the comp card/list showing its locked mode (informational display only, not required for this feature)
