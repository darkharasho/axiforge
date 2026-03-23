# SPA Mobile Responsiveness Design

**Date:** 2026-03-23
**Status:** Approved
**Goal:** Make the GitHub Pages SPA (gw2eww.github.io) fully usable on mobile devices.

## Context

The SPA shares CSS with the Electron desktop renderer and is desktop-first. Users on mobile experience horizontal overflow, tiny touch targets, and broken layouts across skills, specializations, and equipment sections. User feedback confirms all major sections need work: everything too wide, specific sections broken, touch targets too small, and the detail panel crowding content.

## Approach

**CSS-only mobile overrides + minimal SPA-only JS** for interactive components.

- **New file:** `src/site/site-mobile.css` — all mobile media query overrides, imported in `src/site/styles.css`
- **Breakpoint:** `max-width: 768px` (single breakpoint)
- **Shared renderer CSS untouched** — mobile rules are SPA-only overrides
- **JS rendering code untouched** — same DOM structure, CSS reflows it
- **Two JS additions** (SPA-only): spec card accordion and bottom sheet detail panel

## Design by Section

### 1. Global / Layout

- `#app`: width changes from `min(1400px, 96vw)` to `100vw` with `padding: 0 12px`
- Remove horizontal margin/auto-centering
- `.site-navbar`: no changes needed (already works at narrow widths)
- `.build-header`: stack profession icon + title vertically; shrink icon slightly
- `.site-tabs`: tabs become full-width, evenly distributed (`flex: 1` per tab)

### 2. Skill Bar

Reflows from a single horizontal row into 3 stacked rows:

- **Row 1:** 5 weapon skills at ~58px, centered
- **Row 2:** Weapon swap as a pill button + HP badge (compact inline element replacing the health orb)
- **Row 3:** Heal + 3 utilities + elite at ~58px, centered

Implementation:
- `.skills-bar` switches to vertical flex direction
- `.health-orb` hidden via `display: none`
- New `.skills-bar__mobile-meta` element holds swap pill + HP badge — hidden on desktop, visible on mobile
- `.profession-mechanics-bar`: remove left padding, center icons, keep at ~30px
- Boon/condition coverage wraps naturally (flex with gap)
- **No JS changes** — CSS reflow only

### 3. Specializations — Collapsible Accordion

Spec cards collapse to compact rows on mobile, tap to expand.

**CSS:**
- `.specs-with-detail`: remove flex side-by-side (detail panel moves to bottom sheet)
- Collapsed state: emblem icon + spec name + 3 selected trait thumbnails + chevron in a horizontal row
- `.spec-card__body`: `display: none` when collapsed, revealed when `.expanded` class present
- Expanded state: trait tiers stack vertically (tier label + minor + 3 majors per row)
- `--spec-scale` reduced from `1.1` to `0.9`

**JS (SPA-only):**
- Detect mobile viewport on load, add `mobile` class to `#app`
- Inject collapsed header row into each spec card (emblem, spec name text, 3 trait thumbnails, chevron)
- Click handler on header toggles `.expanded` class
- Only one spec expanded at a time (expanding one collapses others)
- All start collapsed by default

### 4. Equipment — Sub-tabs

The 3-column grid collapses to a single column with sub-tab navigation.

**CSS:**
- `.equip-layout`: `grid-template-columns` changes to `1fr`
- `.equip-col--art` (center profession icon): `display: none`
- Equipment slots stack vertically, full width

**JS (SPA-only):**
- Inject pill-style sub-tab bar above equipment content: "Armor & Runes" / "Weapons & Trinkets"
- "Armor & Runes" shows left column content (armor slots, rune)
- "Weapons & Trinkets" shows right column content (weapons, accessories, sigils, food, utility, relic)
- Default: "Armor & Runes" active
- Reuses `.underwater-toggle` pill styling for visual consistency
- Hidden on desktop

### 5. Detail Panel — Bottom Sheet

Replaces the sticky sidebar detail panel on mobile with a slide-up bottom sheet.

**CSS:**
- `.detail-panel`: `display: none` on mobile
- `.hover-preview`: `display: none` on mobile (hover tooltips don't work on touch)
- New `.bottom-sheet`: fixed to bottom of viewport, `transform: translateY(100%)` by default, slides up via CSS transition
- Styling: dark `--panel` background, rounded top corners, max-height `60vh`, scrollable content
- Semi-transparent backdrop overlay
- Drag handle pill at top of sheet

**JS (SPA-only):**
- Skill/trait tap events open bottom sheet instead of populating sidebar
- Populate sheet with same content as detail panel (reuse `render-reference.js` logic)
- Dismiss by: tapping backdrop, tapping X button, or swiping down on drag handle
- Swipe-to-dismiss: track touch start/move/end, dismiss if dragged past ~100px threshold
- Lock body scroll while sheet is open

### 6. Comp Page

Follows same patterns, all CSS overrides (no new JS):

- **Comp header**: stack vertically
- **Party lines grid**: horizontal scroll per party line row (swipeable)
- **Build pool mini-cards**: already have container queries at 320px; ensure full-width on mobile
- **Boon coverage matrix**: wrap in horizontal scroll container with scroll hint

## Files Changed

| File | Type | Description |
|------|------|-------------|
| `src/site/site-mobile.css` | **New** | All mobile media query overrides |
| `src/site/styles.css` | Edit | Import `site-mobile.css` |
| `src/site/mobile.js` | **New** | Accordion, equipment sub-tabs, bottom sheet, mobile detection |
| `src/site/render-build.js` | Edit | Import and initialize mobile module |
| `src/site/render-comp.js` | Edit | Import and initialize mobile module (if needed for comp-specific setup) |

## What Does NOT Change

- All files under `src/renderer/styles/` (shared with Electron desktop app)
- All files under `src/renderer/modules/` (shared state/rendering logic)
- `src/site/render-reference.js` (reused as-is by bottom sheet)
- Desktop layout at viewports > 768px
- Build/comp data model, encryption, routing
