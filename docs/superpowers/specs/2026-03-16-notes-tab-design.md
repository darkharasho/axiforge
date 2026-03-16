# Notes Tab — Markdown Editor with @ Mentions

**Date:** 2026-03-16
**Status:** Approved

## Overview

Extract the notes section from the equipment panel into its own dedicated tab with a toolbar-driven markdown editor. The editor provides formatting controls (headers, bold, italic, lists, horizontal rules, tables, links) that insert markdown syntax into a textarea, a preview toggle that renders the markdown with `marked`, and an @ mention autocomplete system that lets users reference skills, traits, runes, sigils, equipment, and consumables from the GW2 catalog. Referenced items display with their actual icons in the autocomplete popup, render as styled chips in preview mode, and show hover tooltips using the existing `bindHoverPreview` system.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editor approach | Toolbar + textarea + `marked` preview | Minimal dependencies, teaches markdown syntax, full theme control |
| Library | `marked` (~28KB) | Lightweight, well-maintained, no heavy editor framework needed |
| @ mention UX | Autocomplete popup with icons + category labels | Discoverability, prevents typos, matches Discord/Slack mental model |
| @ mention categories | All: skills, traits, weapons, armor, sigils, runes, food, utility, relics | Full catalog coverage |
| Data format | Raw markdown string in `state.editor.notes` | Backward compatible with existing plain-text notes |
| Hover tooltips | Reuse `bindHoverPreview` from detail-panel.js | Consistent with build tab behavior |

## New Files

### `src/renderer/modules/notes.js`

Notes tab module following the existing init pattern.

**Exports:**
- `initNotes({ notesPanel })` — receives DOM ref for the subtab container
- `initNotesCallbacks({ markEditorChanged })` — cross-module wiring (only needs markEditorChanged to flag builds as dirty)
- `renderNotesPanel()` — builds toolbar + textarea/preview, binds events. Called directly via import by `renderer.js` (same pattern as `renderEquipmentPanel`)

**Internal functions:**
- `buildToolbar()` — creates toolbar div with formatting buttons and preview toggle
- `insertMarkdown(type, textarea)` — inserts markdown syntax at cursor position for each toolbar action (wraps selection for bold/italic, prepends for headers/lists, inserts template for tables)
- `showAutocomplete(textarea, query)` — filters across `state.activeCatalog` (skills/traits from the current profession's catalog) and `state.upgradeCatalog` (runes, sigils, infusions, enrichments, food, utility, relics) by name prefix, positions popup at caret location, renders matching items with actual API icons and category labels
- `hideAutocomplete()` — removes popup
- `insertMention(item, textarea)` — inserts `@[category:id:Name]` at the trigger position (e.g., `@[skill:1234:Renewed Focus]`), closes popup. The bracket syntax stores category and ID for unambiguous resolution in preview.
- `renderPreview(markdown)` — uses `marked` to parse markdown, then post-processes to find `@[category:id:Name]` patterns, resolves each by ID against `state.activeCatalog`/`state.upgradeCatalog`, and replaces with styled chip elements that include the item icon and category label. Falls back to plain `@Name` text if the ID is not found. Note: sanitization is not needed in the desktop app since users edit their own notes.
- `bindMentionTooltips(previewEl)` — attaches `bindHoverPreview` to each mention chip so hovering shows the same detail tooltip as the build tab

**Toolbar buttons (in order):**
1. H1, H2, H3 — insert `# `, `## `, `### ` at line start
2. Separator
3. Bold — wraps selection in `**`
4. Italic — wraps selection in `*`
5. Separator
6. Unordered list — prepends `- ` to each selected line
7. Ordered list — prepends `1. `, `2. `, etc. to each selected line
8. Separator
9. Horizontal rule — inserts `\n---\n`
10. Table — inserts a 3-column template: `| Col 1 | Col 2 | Col 3 |\n|-------|-------|-------|\n| | | |`
11. Link — wraps selection in `[text](url)` or inserts template
12. Separator
13. @ Mention — triggers autocomplete popup (same as typing `@`)
14. Right-aligned: Preview toggle button

**Autocomplete popup behavior:**
- Appears when user types `@` followed by 1+ characters in the textarea
- Positioned below the caret using a hidden mirror-div technique (a hidden div replicates textarea content up to the caret to calculate pixel position)
- Filters all catalog categories: skills, traits, weapons, armor, sigils, runes, food, utility consumables, relics
- Each item shows: actual GW2 icon (from API icon URL), name, category label (e.g., "Skill", "Trait", "Rune")
- Keyboard navigation: Arrow Up/Down to navigate, Enter to select, Escape to dismiss
- Mouse: click to select
- Max 8 results shown at a time
- Minimum 1 character after `@` before showing results (prevents a massive unfiltered list)

**Preview mode:**
- Toolbar buttons become disabled/dimmed (visual only, not removed)
- Preview toggle button shows active state
- Textarea is replaced with a rendered div
- `marked` parses the markdown to HTML
- Post-processing regex finds `@[category:id:Name]` patterns and replaces with chip HTML: `<span class="notes-mention" data-type="skill" data-id="123">icon + name + category</span>`. The bracket syntax is hidden from the user in preview — they only see the rendered chip.
- `bindHoverPreview` attached to each `.notes-mention` element, using the appropriate lookup function based on `data-type` (same as build tab's skill/trait/item hover)

### `src/renderer/styles/notes.css`

Styles for the notes editor, following existing theme conventions.

**Key classes:**
- `.notes-editor` — outer container (full height of subtab area)
- `.notes-toolbar` — toolbar bar (background: `var(--panel-2)`, border-bottom: `var(--line-soft)`)
- `.notes-toolbar__btn` — toolbar button (32px square, hover: accent glow)
- `.notes-toolbar__sep` — vertical separator line
- `.notes-toolbar__preview` — preview toggle button (right-aligned, border pill style)
- `.notes-textarea` — the textarea (monospace font, transparent background, fills available space)
- `.notes-preview` — rendered preview container (same min-height as textarea)
- `.notes-preview h1/h2/h3/p/ul/ol/table/hr` — styled to match app theme
- `.notes-mention` — inline mention chip (blue tint background, `var(--accent-2)` text, rounded, inline-flex with icon)
- `.notes-mention:hover` — slightly brighter background for hover affordance
- `.notes-mention__icon` — 16x16 icon image within the chip
- `.notes-mention__label` — small uppercase category label within the chip
- `.notes-autocomplete` — popup container (absolute positioned, panel background, shadow, rounded corners, z-index above editor)
- `.notes-autocomplete__item` — each suggestion row (icon + name + category label)
- `.notes-autocomplete__item--selected` — keyboard-highlighted item (accent background tint)
- `.notes-feature-hint` — small hint below editor: "Type @ to reference skills, traits, and items"

### `src/site/render-notes.js`

Read-only notes renderer for the SPA (published builds).

**Exports:**
- `renderNotes(build)` — takes the enriched build object, parses `build.notes` with `marked`, post-processes @ mentions into chips with icons (using `build.catalogSkills`, `build.catalogTraits`, and enriched equipment data), returns a DOM element

**Behavior:**
- Read-only: no textarea, no toolbar, no autocomplete — just rendered markdown
- @ mentions resolve against the enriched catalog data embedded in the published build
- Mention chips get hover tooltips via `bindHoverPreview` (same function used by the desktop app and SPA build tab)
- If `build.notes` is empty/null, renders a subtle "No notes" placeholder
- HTML in markdown output is escaped (configure `marked` with `{ renderer }` that escapes HTML tags) to prevent XSS from user-authored content rendered in the browser

## Modified Files

### `src/renderer/index.html`

- Add "Notes" button to the subnav: `<button class="subnav__item" data-subtab="notes">Notes</button>`
- Add subtab container: `<div id="subtab-notes" class="subtab hidden"><div id="notesPanel"></div></div>`
- Add CSS import: `<link rel="stylesheet" href="styles/notes.css">`

### `src/renderer/renderer.js`

- Import `initNotes`, `initNotesCallbacks` from `./modules/notes.js`
- Add `notesPanel: document.getElementById("notesPanel")` to the `el` refs object
- Call `initNotes({ notesPanel: el.notesPanel })` during initialization
- Call `initNotesCallbacks({ markEditorChanged })` during callback wiring
- Add `renderNotesPanel()` call where equipment panel is currently rendered (on build load/switch)

### `src/renderer/modules/equipment.js`

- Remove the notes textarea creation (~lines 956-973)
- Remove the `notesInput` event listener that updates `state.editor.notes`
- Remove any notes-related references from `renderEquipmentPanel()`

### `src/renderer/styles/equipment.css`

- Remove `.equip-notes` styles (~lines 666-682)

### `src/renderer/styles/skeleton.css`

- Remove `.skel-equip__notes` skeleton style (~line 355)

### `src/renderer/modules/skeleton.js`

- Remove the `.skel-equip__notes` skeleton markup (~line 156)

### `src/renderer/index.html` (skeleton markup)

- Remove the `<div class="skel skel-equip__notes"></div>` element (~line 298)

### `src/site/render-build.js`

- Add "Notes" as a third tab alongside Build and Equipment
- Import and call `renderNotes(build)` for the Notes tab content
- Only show the Notes tab if `build.notes` is non-empty (graceful degradation for old builds)
- Remove the existing inline notes rendering block (~lines 324-335) that currently shows notes inside the Build tab — notes now live exclusively in the Notes tab

### `src/site/styles.css`

- Add `@import "../renderer/styles/notes.css"` to the shared CSS imports
- Add any SPA-specific overrides for notes rendering (e.g., read-only mode adjustments)

### `package.json`

- Add `marked` as a production dependency

## Data Flow

### Desktop App (Edit Mode)

```
User types in textarea
  → input event updates state.editor.notes (raw markdown string)
  → markEditorChanged() flags build as dirty

User clicks Preview toggle
  → marked.parse(state.editor.notes) → HTML string
  → Post-process: regex finds @[category:id:Name], resolves by ID against state.activeCatalog / state.upgradeCatalog
  → Replace with chip elements (icon + name + category)
  → bindHoverPreview on each chip

User types @ + characters
  → input event detects @ trigger
  → Filter state.activeCatalog + state.upgradeCatalog by name prefix
  → Position popup at caret using mirror-div
  → User selects → insert @[category:id:Name] into textarea
```

### SPA (Read-Only)

```
Build loads with enriched data
  → renderNotes(build) called
  → marked.parse(build.notes) → HTML
  → Post-process: resolve @mentions against build.catalogSkills/catalogTraits/etc.
  → Render chips with icons, attach hover tooltips via bindHoverPreview
```

### Serialization

No changes to save/load format. `state.editor.notes` remains a plain string field. Old plain-text notes are valid markdown and render correctly. The `@[category:id:Name]` syntax is stored as literal text — resolution happens at render time. The bracket format is slightly visible in the raw editor but unambiguously identifies referenced items.

### Published Build Enrichment

No changes to `buildPublish.js` needed. The existing `catalogSkills`, `catalogTraits`, and equipment data in the enriched build object provide everything the SPA needs to resolve @ mentions.

## Backward Compatibility

- Old builds with plain-text notes: render fine since plain text is valid markdown
- Old builds with no notes field: Notes tab shows empty editor (desktop) or is hidden (SPA)
- The `@[category:id:Name]` syntax in raw text won't break anything if the catalog lookup fails — it just renders as literal `@Name` text without a chip
- Old plain-text notes that happen to contain `@` characters won't false-match since the bracket syntax `@[...]` is specific

## Edge Cases

- **Ambiguous @ mentions:** If multiple catalog items share a name across categories (e.g., a skill and a trait named "Fury"), the autocomplete shows all matches with category labels so the user picks the right one. The `@[category:id:Name]` storage format ensures the correct item is always resolved in preview — no ambiguity.
- **Deleted/unknown references:** If an `@[category:id:Name]` ID doesn't match any catalog entry (e.g., item was removed from the game), it renders as plain text showing the Name portion (no chip, no error).
- **Long notes:** The textarea has `resize: vertical` and the editor container scrolls. No artificial length limit.
- **Read-only mode:** When viewing someone else's shared build in the desktop app, the notes tab shows preview mode only (no editing), consistent with the existing `_readOnly` pattern.
- **Monospace font requirement:** The textarea must use a monospace font for the mirror-div caret positioning technique to work accurately across different zoom levels.
- **Build switching:** When the user switches builds, `renderNotesPanel()` is called fresh (same pattern as equipment). Preview mode resets to edit mode on build switch to avoid stale rendered content.
- **@ toolbar button:** Inserts `@` character into the textarea at cursor position and triggers the same autocomplete flow as typing `@` — not a separate dialog.
