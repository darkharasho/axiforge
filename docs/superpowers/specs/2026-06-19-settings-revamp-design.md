# Settings Revamp — Sidebar-Nav Modal

**Date:** 2026-06-19
**Status:** Approved design

## Problem

The current Settings modal (`src/renderer/modules/settings-modal.js`, ~719 lines;
`src/renderer/styles/settings-modal.css`, ~733 lines) is a single 520px-wide modal
with all six sections stacked in one scrolling column (Appearance, Publishing,
Discord, Data, Shared Library). The narrow single-column stack feels cramped and
unorganized — the Discord section in particular packs two webhook editors, and the
theme grid is squeezed.

## Goal

Reorganize the same settings into a roomier, clearer layout without changing any
underlying functionality, persistence, or IPC. Presentation-only refactor.

## Approach: Sidebar-nav modal

Selected over top-tabs (crowds as categories grow) and a full-page route (more
structural change than warranted for ~5 categories). Keeps the modal pattern, so
the rest of the app architecture is untouched.

### Layout

- Modal grows to roughly **840×560** (from 520 wide), centered, same overlay.
- **Left sidebar (~210px):** app "Settings" title with the gear icon, then a vertical
  nav list of categories. Active item highlighted in the accent color
  (`rgba(var(--accent-rgb), 0.16)` background, accent text, bold). Hover state
  `rgba(var(--accent-rgb), 0.08)`.
- **Right pane:** shows one category at a time — a header (category title +
  one-line description) above a scrollable body.
- **Footer:** keeps the existing save-status line on the left; add an explicit
  **Close** / **Done** button pair on the right (today there is only the status
  line plus the header X). Header X remains.

### Categories (sidebar order)

1. **Appearance** — icon: palette/brush (existing SVG at settings-modal.js:67)
   - Group "Theme": the 9-theme grid (more horizontal room).
   - Group "Options": themed build pages toggle.
2. **Discord** — icon: message bubble (settings-modal.js:88)
   - Group "Comp Webhooks": webhook list editor + Add Webhook.
   - Group "Build Webhooks": webhook list editor + Add Webhook.
   - Webhook rows get more width for the URL field.
3. **Publishing** — icon: upload arrow (settings-modal.js:79)
   - Repository owner selector, setup status badges, Setup Publishing flow.
4. **Shared Library** — icon: users (settings-modal.js:115)
   - Organization selector / Connect, or connected state + Disconnect.
5. **Data & Cache** — icon: database (settings-modal.js:104)
   - Clear API Cache button, cache status, 24h caching hint.

### Within-pane grouping

Related controls sit under small uppercase group labels (style of the existing
`.settings-modal__sublabel`, e.g. "Comp Webhooks" / "Build Webhooks"). Each pane
header carries a one-line description so the pane is self-explanatory.

### Icons

Reuse the existing inline feather-style SVGs already defined in the current modal
(no new icon pack). The gear, palette/brush, message bubble, upload arrow, users,
and database SVGs move from section titles into the sidebar nav items; the close X
SVG stays.

## Behavior

- Clicking a sidebar item swaps the right pane — no scrolling through all sections.
- Remember the last-open category for the session (in-memory; reset on app
  restart is acceptable — no new persisted setting required).
- **All existing functionality preserved:** same settings keys, same save logic,
  same debounced webhook saves, same IPC. Only the rendering structure and CSS
  change. No data-shape changes.

## Out of scope

- No changes to `buildStore.js`, preload, or main-process settings IPC.
- No new settings, no new persisted keys.
- No changes to publishing/shared-library/webhook business logic — only where
  their controls are mounted in the DOM.

## Affected files

- `src/renderer/modules/settings-modal.js` — restructure the `innerHTML` template
  into sidebar + per-pane panels; add nav-switching logic; preserve all element
  IDs the existing wiring relies on (or update wiring consistently if IDs move).
- `src/renderer/styles/settings-modal.css` — new sidebar/pane layout; widen modal;
  restyle nav items; adapt section/group styles.

## Testing

- Manual verification in-app (render/launch): open Settings, click through all five
  categories, confirm each renders and its controls work (theme switch, toggle,
  add/edit/delete webhook with thread modes, publishing setup picker, shared
  library connect/disconnect, clear cache).
- Confirm settings still persist and reload correctly (theme, toggle, webhooks).
- Confirm Close/Done and header X all dismiss the modal; save-status still updates.
