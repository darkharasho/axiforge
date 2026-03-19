# Library Skeleton Loading — Design Spec

## Problem

On initial app startup, when the library was the last active page, the sidebar and content area are blank while `state.builds` and folders are loaded from the main process. This makes the app feel broken or unresponsive during a 500ms–2s loading window.

## Solution

Facebook-style skeleton placeholders in both the sidebar and content area, using the existing `skeleton.js` / `skeleton.css` infrastructure. Four distinct content skeleton templates match each view mode (list, table, grid, icon), and the user's saved view preference is read early so the correct skeleton is shown.

## Decisions

- **Scope:** Sidebar (`#lib-sidebar`) + content area (`#lib-content`) — both panels show skeletons
- **View matching:** Read `library.viewMode` from settings early in `init()` and inject the matching content skeleton; default to list view for the static first-paint skeleton in `index.html`
- **Flash prevention:** Existing 150ms `animation-delay` on `.skel` means fast warm-cache loads never show the skeleton (it's cleared before the delay expires)
- **Teardown:** None needed — `renderLibrary()` already does `innerHTML = ...` on both containers, which naturally clears the skeleton

## When the Skeleton Shows

Only during initial app startup, specifically the window between page load and `renderLibrary()` being called. This only matters when the library was the active page on last close. Navigation from editor → library after startup has no loading gap (data is already in memory).

`reloadBuilds()` (called after save/delete/import) is explicitly out of scope: those operations occur while the user is on the editor page, not the library, so the library page is never active at the same moment a reload is in flight. No skeleton is needed there.

## Architecture

### Pattern (mirrors existing editor panel skeletons)

1. **Static HTML in `index.html`** — list-view content skeleton + sidebar skeleton pre-populated in `#lib-content` and `#lib-sidebar` for instant first paint, zero JS dependency
2. **Early pref read in `renderer.js`** — before awaiting `listBuilds()` / `listProfessions()`, read `library.viewMode` from settings and re-inject the correct content skeleton if it differs from list view. Note: `initLibrary()` also reads this setting via `loadPrefs()`, but that happens after the heavy data load — too late to show the right skeleton during it. The early read in `renderer.js` is a one-time extra IPC call at startup (a single setting key, ~1ms) whose sole purpose is covering the `listBuilds` loading window. The two reads are independent and serve different purposes.
3. **Natural teardown** — `renderLibrary()` replaces both containers' `innerHTML`, automatically clearing skeletons

### Skeleton Templates

Five new templates added to `skeleton.js`:

| Template key | Panel | Description |
|---|---|---|
| `library-sidebar` | `#lib-sidebar` | Smart Folders section header + 3 item skeletons; My Folders section header + 2 item skeletons |
| `library-list` | `#lib-content` | 6 rows: 20×20px icon + title bar (varying width) + 2 pill bars + date bar |
| `library-table` | `#lib-content` | Static column header row + 6 data rows (icon + title cell + profession pill + spec cell + mode cell + date cell) |
| `library-grid` | `#lib-content` | 6 cards: centered 40×40px icon → title bar → 2 pills → date bar (matches `.lib-grid-card` flex-column layout) |
| `library-icon` | `#lib-content` | 10 items: 36×36px icon + short title bar below (matches `.lib-icon-item` centered column layout) |

### Skeleton Shapes (new CSS in `skeleton.css`)

All new shapes reuse the existing `.skel` base class and pulse animation. New shape classes:

| Class | Dimensions | Usage |
|---|---|---|
| `skel-lib-sidebar-head` | `height: 9px` | Section label bars in sidebar |
| `skel-lib-sidebar-icon` | `14×14px, border-radius: 3px` | Folder icon placeholders in sidebar |
| `skel-lib-row-icon` | `18×18px, border-radius: 4px` | Spec icon in list/table rows |
| `skel-lib-card-icon` | `40×40px, border-radius: 6px` | Centered spec icon in grid cards |
| `skel-lib-icon-img` | `34×34px, border-radius: 6px` | Icon view item image |

Text bars (title, date, pills) use inline `style` width values on plain `.skel` elements, same as existing skeleton templates.

### Integration in `renderer.js`

```js
// Before the heavy data load:
const savedViewMode = await window.desktopApi.getSetting("library.viewMode");
const viewMode = savedViewMode || "list";

// Show skeleton in both panels immediately
injectSkeleton(document.getElementById("lib-sidebar"), "library-sidebar");
injectSkeleton(document.getElementById("lib-content"), `library-${viewMode}`);

// Now load the heavy data (skeleton visible during this window)
const [builds, professions] = await Promise.all([
  window.desktopApi.listBuilds(),
  window.desktopApi.listProfessions(),
]);
```

`renderLibrary()` at the end of `init()` replaces both containers' content — no skeleton teardown needed.

### Static Skeleton in `index.html`

`#lib-sidebar` and `#lib-content` are pre-populated with the `library-sidebar` and `library-list` skeleton HTML respectively. This ensures a skeleton is visible at first paint before any JS runs, covering the gap between HTML load and `renderer.js` executing the early pref read.

For list-view users (the default), the static HTML is the final skeleton — the JS step is a no-op. For non-list-view users, the JS re-injection quickly replaces the list skeleton with the correct view-mode skeleton. The list-view flash lasts only as long as it takes `renderer.js` to start executing (~50ms), which is imperceptible.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/modules/skeleton.js` | Add 5 new templates: `library-sidebar`, `library-list`, `library-table`, `library-grid`, `library-icon` |
| `src/renderer/styles/skeleton.css` | Add lib-specific shape classes: `skel-lib-sidebar-head`, `skel-lib-sidebar-icon`, `skel-lib-row-icon`, `skel-lib-card-icon`, `skel-lib-icon-img` |
| `src/renderer/index.html` | Pre-populate `#lib-sidebar` and `#lib-content` with static list-view skeleton HTML |
| `src/renderer/renderer.js` | Read `library.viewMode` early in `init()`; call `injectSkeleton()` on both containers before awaiting `listBuilds()` |

## No New Dependencies

All infrastructure (CSS animation, shape classes, `injectSkeleton()` API) already exists. This is purely additive.
