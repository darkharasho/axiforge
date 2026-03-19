# Mini Build Card — Design Spec

## Overview

A reusable, compact build card component that displays key build details in a taller horizontal row format. Designed to replace the current minimal pool cards in the comp detail page, and to be importable by any page in the app.

## Layout

```
┌─ 3px profession border ─────────────────────────────────────┐
│ [40px spec   Name .............. [tag] [role] [mode]        │
│  icon]       SPECS  (R) Radiance › (V) Virtues › (F★) FB   │
│              WEAP   Axe / Shield | Staff                    │
│              GEAR   ◆ Harrier · ᚱ Rune of Monk        [↗]  │
│                     ⬡ Relic of the Flock               [×]  │
└──────────────────────────────────────────────────────────────┘
```

### Row Breakdown

1. **Header row**: Build name (13px, bold), tag pills, role badge, game mode pill
2. **Specs row**: Label "SPECS" + three spec names with 16px circular letter pips; elite spec gets gold highlight + border
3. **Weapons row**: Label "WEAP" + weapon set names in `Set1 | Set2` format (text only, no images)
4. **Gear row**: Label "GEAR" + stat package (◆ icon, gold) + rune name (ᚱ icon, muted)
5. **Relic row**: No label (visually grouped under Gear by indentation) + relic name (⬡ icon, purple)

### Visual Elements

- **Profession icon**: 40px circle, profession-colored background tint, aligned to top of card. Uses existing `getSpecIcon()` SVGs from `profession-icons.js`.
- **Spec pips**: 16px circles with first letter of spec name. Background `rgba(136,153,187,0.15)`, text `#8899bb`. Elite variant: background `rgba(255,200,80,0.15)`, border `1px solid rgba(255,200,80,0.25)`, text `#ffc850`.
- **Gear icons**: 16px rounded squares with symbols:
  - Stat: `◆` — background `rgba(200,169,110,0.15)`, color `#c8a96e`
  - Rune: `ᚱ` — background `rgba(153,153,170,0.12)`, color `#99a`
  - Relic: `⬡` — background `rgba(170,136,204,0.12)`, color `#aa88cc`
- **Row labels**: 9px uppercase, `#556`, letter-spacing 0.5px, fixed 36px min-width
- **Profession border**: 3px left border, color from existing `lib-prof--*` classes
- **Action buttons**: 20px square, stacked vertically in top-right. Open (↗) and Remove (×).

## Files

### New: `src/renderer/modules/mini-build-card.js`

Exports:
- `renderMiniBuildCard(build, options)` → HTML string

Parameters:
- `build` — the build object from state
- `options` — optional object:
  - `showActions` (boolean, default `true`) — show open/remove buttons
  - `showMode` (boolean, default `true`) — show game mode pill

Internal helpers (not exported):
- `getSpecLineNames(build)` — returns array of `{ name, isElite }` for all 3 specializations
- `getWeaponSetNames(build)` — returns array of weapon set strings (e.g., `["Axe / Shield", "Staff"]`) by looking up weapon string IDs via `GW2_WEAPONS_BY_ID` from `constants.js` to get display labels

Reuses existing helpers (must be extracted to importable locations since they currently live as local functions in `comp-detail.js`):
- `getSpecIcon(build)` — currently local in `comp-detail.js`, calls `getProfessionSvg()` from `profession-icons.js`. Must be extracted/shared.
- `resolveStatPackage(build)` — currently local in `comp-detail.js`. Must be extracted.
- `getRuneName(build)` — same
- `getDisplayName(build)` — same
- `profClass(build.profession)` — same
- `roleBadgeHtml(build, catalog)` — same
- `escapeHtml()` from `utils.js` (already importable)

### New: `src/renderer/styles/mini-build-card.css`

All classes namespaced under `.mini-card`:
- `.mini-card` — outer container (flex, horizontal, dark bg, profession left border)
- `.mini-card__icon` — 40px profession circle
- `.mini-card__info` — flex-1 content area
- `.mini-card__header` — name + tags + role + mode row
- `.mini-card__name` — build title
- `.mini-card__detail-row` — flex row for each detail line
- `.mini-card__detail-label` — 9px uppercase label
- `.mini-card__spec-group` — flex container for spec pips
- `.mini-card__spec-pip` / `--elite` — 16px circle with letter
- `.mini-card__spec-name` / `--elite` — spec name text
- `.mini-card__spec-sep` — `›` separator
- `.mini-card__weap-group` — flex container for weapon sets
- `.mini-card__weap-name` — weapon text
- `.mini-card__weap-div` — `|` divider between sets
- `.mini-card__gear-icon` / `--stat` / `--rune` / `--relic` — 16px symbol squares
- `.mini-card__stat` — stat text (gold)
- `.mini-card__equip` — rune text (muted)
- `.mini-card__relic` — relic text (purple)
- `.mini-card__sep` — `·` separator
- `.mini-card__actions` — button column
- `.mini-card__btn-open` / `__btn-remove` — action buttons

### Modified: `src/renderer/modules/comps/comp-detail.js`

- Import `renderMiniBuildCard` from `mini-build-card.js`
- Replace `renderPoolCard()` call in pool list rendering with `renderMiniBuildCard(build, { showActions: true })`
- Keep `renderPoolCard()` temporarily as dead code or remove it — the new module replaces it entirely
- Extract `resolveStatPackage()`, `getRuneName()`, `getDisplayName()`, `roleBadgeHtml()` into shared locations if not already importable (or pass them as dependencies)

### Modified: `src/renderer/styles/comps.css`

- Remove or deprecate `.comp-pool-card*` styles (replaced by `mini-build-card.css`)
- Import `mini-build-card.css` in the main stylesheet chain

## Data Flow

```
build object (from state)
  ├─ build.profession → profClass(), getSpecIcon()
  ├─ build.title / build.specializations[2].name → getDisplayName()
  ├─ build.specializations[0..2] → getSpecLineNames() → [{name, isElite}]
  ├─ build.equipment.weapons.* → getWeaponSetNames() → ["Axe / Shield", "Staff"]
  ├─ build.equipment.statPackage → resolveStatPackage()
  ├─ build.equipment.runes.* → getRuneName() via upgradeCatalog
  ├─ build.equipment.relic → direct string
  ├─ build.tags → tag pills
  ├─ build.gameMode → mode pill
  └─ roleBadgeHtml(build, catalog) → role badge
```

## Edge Cases

- **Missing specializations**: If `build.specializations` has fewer than 3 entries, render only what exists. No empty pips.
- **Missing weapons**: If a weapon set slot is empty/null, omit that set. If both empty, hide the row entirely.
- **Missing gear**: If stat/rune/relic are empty strings or undefined, omit the corresponding icon + text. If all gear is empty, hide the gear rows.
- **Long names**: Build name truncates with ellipsis. Spec names, weapon names, and equipment names also truncate if the card is narrow.
- **Missing builds**: The existing `renderMissingPoolCard()` stays separate — it handles builds that are in the comp but no longer exist in the library.

## Interaction

- **Drag**: Card is draggable (cursor: grab) for drag-and-drop into party line slots. Unchanged from current behavior.
- **Hover**: Background lightens to `#181838`. Unchanged.
- **Open button (↗)**: Opens the build in the detail panel. Fires `pool-open` action.
- **Remove button (×)**: Removes build from comp pool. Fires `pool-remove` action.
- **Selection**: Multi-select behavior for drag-and-drop (existing `comp-drag-drop.js` integration) — unchanged, just targets new class names.
