# Mobile-friendly SPA viewer & Playground editor — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Make both web surfaces usable on phones and tablets:

- **A) Published SPA viewer** (`src/site` → gw2eww.github.io/axibuilds): read-only build/comp
  links (shared in Discord, opened on phones) should look intentional, not broken.
- **B) Playground editor** (`src/web` → build.axi.link): a genuinely usable **focused**
  editor on mobile — the common editing path (pick profession, swap skills/traits, adjust
  gear) works great; rarely-used power features may stay awkward.

Phone portrait **and** tablet are both first-class targets.

## Non-goals (YAGNI)

- No PWA / offline / installable app.
- No gesture navigation (swipe between sections).
- No persisting section open/closed state across loads.
- No comps/notes in the playground (already stripped on web).
- No new product features — this is pure responsive adaptation.
- Desktop Electron renderer layout is **unchanged**.

## Breakpoints (shared system)

| Breakpoint | Range      | SPA viewer                         | Playground editor                               |
|------------|------------|------------------------------------|-------------------------------------------------|
| Phone      | ≤ 600px    | 1-col, existing mobile layer polished | Collapsible single-scroll (Option B)         |
| Tablet     | 601–1024px | 1-col / relaxed                    | 2-column reflow (Skills+Traits / Gear+Stats)    |
| Desktop    | > 1024px   | unchanged                          | unchanged                                       |

The SPA's existing mobile layer already keys on `1024px`; that stays as the tablet boundary,
with a new `≤600px` phone refinement added inside the same files.

## Architecture / file layout

### Playground editor (`src/web`) — the core work

A **new, self-contained mobile layer scoped under `body.is-web`** so it cannot affect the
desktop Electron app:

- **`src/web/web-mobile.css`** — all editor breakpoints/reflow: collapsible sections, touch
  targets, traits/equipment/stats reflow, tablet 2-column grid, modal-as-sheet.
- **`src/web/web-mobile.js`** — minimal JS: collapsible section toggle (click-to-toggle,
  open/closed state held in-memory only), and a touch fix for the custom-select widget.

Both imported **only** in the web build (via `main-web.js` / `chrome.js`), never in the
desktop renderer. Rationale: reuses the desktop DOM/section structure with minimal JS rework,
degrades naturally to the desktop multi-column layout as the viewport widens, keeps the live
stat panel in context, and honors the "reuse the desktop renderer unchanged" architecture.

### SPA viewer (`src/site`) — extend, don't rebuild

- Extend existing **`src/site/mobile.js`** + **`src/site/site-mobile.css`**.
- Add a `≤600px` phone refinement block alongside the existing `≤1024px` block.
- No new architecture; mostly polish + filling gaps (notably comps, see below).

## Playground editor reflow detail

### Phone (≤600px): collapsible single-scroll

Desktop content blocks become collapsible cards, stacked in order:

1. **Header** (sticky, non-collapsible): build title + profession select + Share. The
   `web-topbar` buttons collapse to an overflow/icon row on narrow screens.
2. **Skills** — weapon + slot skills, wrap to fit; open by default.
3. **Traits** — the 3 specialization lines stack vertically (desktop = side-by-side); each
   line's trait tiers reflow to fit width.
4. **Equipment** — armor / weapons / trinkets / upgrades stack single-column; each slot is a
   full-width touch row rather than a tight grid.
5. **Attributes/Stats** — collapsed by default, but a **sticky mini-summary** (key stats,
   e.g. Power / Toughness / Boon Duration) stays visible so edits show live feedback without
   expanding.

Section state: pure CSS toggle via a class where possible; `web-mobile.js` handles only the
click-to-toggle and remembers open/closed **in-memory** (resets per load).

### Tablet (601–1024px): 2-column reflow

Sections are **not** collapsed. A 2-column CSS grid: Skills + Traits (left), Equipment + Stats
(right) — a middle ground between phone-scroll and desktop multi-panel. Pure CSS override of
the `.is-web .app-layout` / content grid at this breakpoint.

### Touch & interaction fixes (both breakpoints)

- Minimum **44×44px** tap targets on all skill/trait/gear tiles and buttons.
- **Custom-select** (`#professionSelect`, skill dropdowns): must open on real touch; menu is
  scrollable and height-capped so long skill descriptions don't run off-screen (extends the
  existing `.cselect__menu` cap in `web.css`). Note the known gotcha: the widget doesn't open
  under synthetic mouse clicks — verify real touch behavior.
- **Detail/wiki modals** (skill/trait detail popups): reflow to near-fullscreen sheets on
  phone instead of desktop-positioned floating panels.
- Momentum scroll; audit for fixed widths that cause horizontal overflow.

## SPA viewer polish detail

- Add `≤600px` phone refinement to `site-mobile.css`.
- Audit **both** the read-only build view and the **comp** view at phone/tablet widths; fix
  overflow (likely: comp party/pool cards, boon-coverage rows, wide tables). Comps may not
  have been covered by the original mobile pass.
- Reuse the same 44px touch-target and near-fullscreen-modal conventions for consistency;
  stays read-only (no editor JS).

## Testing / verification

- **Manual via chrome-devtools MCP** at ≈390 (phone), ≈768 (tablet), ≈1280 (desktop) for both
  the playground editor and the SPA viewer. Primary check — curl/dev-boot miss JS-driven layout.
- **Playwright** (`tests/playground/`): add a mobile-viewport run — assert sections
  collapse/expand, profession select opens on touch, and no horizontal overflow
  (`scrollWidth <= clientWidth`).
- **Desktop regression guard:** confirm the Electron renderer renders identically (all new
  CSS/JS scoped under `body.is-web`, loaded only in the web build).

## Key files

- New: `src/web/web-mobile.css`, `src/web/web-mobile.js`
- Edit: `src/web/main-web.js` and/or `src/web/chrome.js` (import mobile layer), `src/web/web.css`
- Edit: `src/site/site-mobile.css`, `src/site/mobile.js`
- Edit/extend: `tests/playground/*`
