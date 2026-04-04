# Skill Dropdown Redesign

## Summary

Redesign the heal/utility/elite skill dropdown to be wider with larger icons, show skill descriptions, and add a search bar that matches against both skill name and description text.

## Approach

Extend the existing `renderCustomSelect()` component with new opt-in config fields. No new components; all changes are additive and backwards-compatible.

## Files Changed

- `src/renderer/modules/custom-select.js` — new config options, search on flat lists, description rendering
- `src/renderer/modules/skills.js` — pass new config to `renderCustomSelect()`, include description in option data
- `src/renderer/modules/editor.js` — remove external `filterSkillList()` (search moves into custom select)
- `src/renderer/styles/custom-select.css` — wider menu, larger icons, description text, search input styles

## Data Changes

Each skill option object gains a `description` field sourced from `skill.description` in the catalog data. Example:

```js
{
  value: String(skill.id),
  label: skill.name,
  icon: skill.icon || "",
  description: skill.description || "",
  meta: skill.type ? String(skill.type).toUpperCase() : "",
  kind: "skill",
  entity: skill,
}
```

## Custom Select Changes (`custom-select.js`)

New opt-in config fields for `renderCustomSelect()`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `searchable` | `boolean` | `false` | Enables search input (now works on flat lists, not just grouped) |
| `iconSize` | `number` | `20` | Icon dimensions in px |
| `searchFields` | `string[]` | `["label"]` | Which option fields to search against |

Behavior:
- When `searchable: true`, a search input renders at the top of the menu and auto-focuses on dropdown open.
- Search is case-insensitive and matches against all fields listed in `searchFields`.
- Options with a `description` field render in a two-line layout: name on top, description below.

## CSS Changes (`custom-select.css`)

### Skill slot menu overrides (`.cselect--skill-slot`)
- `.cselect__menu`: min-width **340px**, max-height **400px**
- `.cselect__icon`: **40px x 40px**, 4px border-radius
- `.cselect__option`: `align-items: flex-start` (for two-line content)

### New elements
- `.cselect__option-description`: 11px font, `#6a7a9e` color, single-line truncation with ellipsis
- `.cselect__search`: dark background (`rgba(20, 30, 50, 0.9)`), 1px solid `#2c3d5e` border, 4px border-radius, 13px font. Container has 8px padding and bottom border separator.
- `.cselect__search-clear`: small "x" button to clear search text

### Empty state
- `.cselect__empty`: centered muted text ("No skills found") shown when search yields no results

## Skill Slot Integration (`skills.js`)

`makeSkillSlot()` passes new config to `renderCustomSelect()`:

```js
renderCustomSelect(selectHost, {
  value: String(selectedId || ""),
  className: "cselect--skill-slot",
  options: skillOptions,
  placeholder: "Select skill",
  searchable: true,
  iconSize: 40,
  searchFields: ["label", "description"],
  onChange: (nextValue) => { /* existing handler */ }
});
```

The external `filterSkillList()` call is removed — the custom select handles filtering internally via its search input.

## Edge Cases

- **No search results**: "No skills found" empty state message in the menu
- **Empty description**: skill renders single-line (name only), no blank space
- **Long descriptions**: truncated with text-overflow ellipsis after one line
- **Search clearing**: "x" button in search input, or delete text manually. Search state resets when dropdown closes.

## What Doesn't Change

- Drag-to-swap between utility slots
- Kit toggle indicators
- Keybind labels (6-0)
- Specialization locking behavior
- FLIP swap animation
- Hover preview binding for skill details panel
- Other custom selects (profession, etc.) — all new fields are opt-in with backwards-compatible defaults
