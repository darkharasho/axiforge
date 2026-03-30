# Unified Profession + Elite Spec Selector

**Date:** 2026-03-29
**Issue:** #121 (UI cleanup item)
**Status:** Design

## Problem

The current profession picker and specialization selector are separate controls. Choosing a profession requires the top-bar dropdown, and choosing an elite spec requires clicking the (invisible) emblem overlay on the third spec card — a non-obvious interaction. Users want a faster workflow that lets them pick their build identity (profession + elite spec) in one step from one control.

## Design

Replace the existing profession dropdown with a single grouped dropdown that lists every profession and its elite specs. The dropdown follows the existing `renderCustomSelect` / `cselect` pattern but adds two new capabilities: **grouped options** (profession headers with indented elite spec children) and **search filtering**.

### Closed State

The trigger button shows the currently selected elite spec name and its profession icon. If no elite spec is selected (core build), it shows "Core {Profession}" (e.g. "Core Necromancer"). The field label changes from "Profession" to "Profession / Elite Spec".

### Open State

The dropdown menu displays all 9 professions as non-clickable group headers (icon + profession name, dimmed styling). Under each profession header:

- **"Core"** option (italic/dimmed) — selects that profession with no elite spec in slot 3
- Each elite spec for that profession — shown with the spec's icon and name

The currently selected option shows a golden checkmark and highlighted text. The dropdown is single-select — clicking an option closes the menu.

### Search

A text input at the top of the dropdown menu filters options as the user types. Search matches against:

- Elite spec names (e.g. "rea" matches "**Rea**per")
- Profession names (e.g. "nec" shows all Necromancer options)

Only professions with matching children are shown. Matched text is highlighted in the results. The search input is auto-focused when the dropdown opens.

### Selection Behavior

**Same-profession elite spec switch** (e.g. Reaper -> Scourge):
- Sets the new elite spec in slot 3 (replacing the old one)
- Preserves slots 1 and 2 specialization and trait choices
- If slot 3 previously had a non-elite spec, it moves to an empty core slot (or is cleared if no slot is available)

**Same-profession "Core" selection** (e.g. Reaper -> Core Necromancer):
- Clears the elite spec from slot 3
- Preserves slots 1 and 2

**Cross-profession switch** (e.g. Reaper -> Firebrand):
- Full profession change — equivalent to changing the profession dropdown today
- Resets build (specializations, traits, equipment, skills) as it does currently

### Data Source

The dropdown options are derived from the existing `state.professions` list and each profession's `catalog.specializations` array. Elite specs are identified by the `elite: true` flag on specialization objects. No new data fetching is needed — this is purely a UI restructuring of existing data.

## Changes

### `src/renderer/modules/custom-select.js`

Extend `renderCustomSelect` to support a new `groups` config option as an alternative to the flat `options` array. When `groups` is provided:

- Render each group as a non-interactive header element (`cselect__group-header`)
- Render each group's children as normal `cselect__option` elements with indented styling (`cselect__option--grouped`)
- Add a search input (`cselect__search`) at the top of the menu when `config.searchable` is true
- Search filters groups and options, hiding non-matching entries and empty groups
- Auto-focus the search input on open

New config shape. Values use the format `"{professionId}:{specId}"` where specId is `"core"` for non-elite builds, or the elite spec's numeric ID. This lets the onChange handler parse both pieces from a single value string.

```js
renderCustomSelect(host, {
  value: "Necromancer:7",  // profession:eliteSpecId
  className: "cselect--prof-spec",
  searchable: true,
  groups: [
    {
      label: "Necromancer",
      icon: "https://render.guildwars2.com/file/...",
      options: [
        { value: "Necromancer:core", label: "Core", icon: "..." },
        { value: "Necromancer:7",    label: "Reaper", icon: "..." },
        { value: "Necromancer:60",   label: "Scourge", icon: "..." },
        { value: "Necromancer:64",   label: "Harbinger", icon: "..." },
      ]
    },
    // ... other professions
  ],
  onChange: (value, option) => {
    const [profession, specId] = value.split(":");
    // ...
  }
});
```

### `src/renderer/modules/render-pages.js`

Replace the `renderCustomSelect` call for `#professionSelect` with the new grouped variant. Build the groups array from `state.professions` and each profession's catalog specializations. The `onChange` handler:

1. Determines if this is a same-profession or cross-profession switch
2. For same-profession: updates slot 3 elite spec, preserves slots 1-2
3. For cross-profession: calls existing `setProfession()` flow, then sets elite spec in slot 3

### `src/renderer/index.html`

Change the label text from "Profession" to "Profession / Elite Spec".

### `src/renderer/styles/custom-select.css`

Add styles for:
- `.cselect__group-header` — non-interactive, dimmed, with icon
- `.cselect__option--grouped` — left padding indent (e.g. `padding-left: 32px`)
- `.cselect__search` — text input at top of menu with appropriate styling
- `.cselect--prof-spec` — any selector-specific overrides (min-width for the wider labels)

## Edge Cases

- **First load / no profession selected:** Dropdown shows placeholder "Select profession / elite spec". All options are available.
- **Elite spec already in slot 3 from trait panel:** Dropdown reflects this — the matching elite spec option is shown as selected.
- **Slot 3 has a non-elite spec when switching elite:** The non-elite spec currently in slot 3 needs to move to an available core slot (1 or 2), or be cleared if both are occupied with different specs. Use existing `_enforceEditorConsistency()` logic which already handles this.
- **Search with no results:** Show "No matches" empty state in the menu.
- **Profession catalog not yet loaded:** Disable the dropdown (same as current behavior when no professions are loaded).

## Testing

- Unit tests in `tests/unit/renderer/custom-select.test.js` for grouped rendering, search filtering, and group header non-interactivity
- Unit tests for the onChange handler logic: same-profession switch preserves slots 1-2, cross-profession switch resets build
- Verify search matches both profession names and elite spec names
- Verify "Core" selection clears elite from slot 3
