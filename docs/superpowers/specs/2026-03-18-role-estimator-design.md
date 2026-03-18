# Role Estimator — Design Spec
**Date:** 2026-03-18
**Status:** Approved

## Overview

A new core feature that automatically estimates the role of a GW2 build based solely on its computed equipment stats. The estimated role is displayed as a badge on build cards in the library (all view modes except icon) and on build slots in the comp detail view.

## Roles

Six possible role labels:

| Role | Primary Signal |
|---|---|
| Power DPS | High Power / Precision / Ferocity |
| Condi DPS | High Condition Damage / Expertise |
| Boon Support | High Concentration / Boon Duration |
| Heal Support | High Healing Power |
| Hybrid | Two roles are roughly equally dominant |
| Unknown | Slots have stats but no role clears the minimum threshold |

**Note:** Tank was explicitly excluded — it is not a meaningful role category in GW2 competitive play. Toughness-heavy gear sets (e.g. Minstrel's) fall under Heal Support or Boon Support based on their secondary stats.

## Architecture

A new pure function module — `src/renderer/modules/roleEstimator.js` — contains all role logic.

**Data flow:**
```
build.equipment + catalog → scoreEquipmentSlots(slots) + scoreRuneStats(build, catalog)
                          → estimateRole(build, catalog) → role string | null
```

- `estimateRole(build, catalog = null)` is the primary public API. `catalog` is the `state.upgradeCatalog` (upgrade item lookup map); passing it enables rune bonus scoring. If `null`, only equipment stat scoring is used.
- `roleBadgeHtml(build, catalog = null)` is a convenience wrapper that returns an HTML string or `''`.
- Internally, `scoreEquipmentSlots(slots)` computes stat totals from slot combo labels using `computeSlotStats` from `stats.js`; `scoreRuneStats(build, catalog)` parses rune bonus strings from the catalog.
- The result is **not persisted** on the build object. It is computed on-demand at render time.
- No global state access, no side effects. Pure functions in, string out.

**Empty build guard:** Before scoring, check whether any slot in `build.equipment.slots` has a non-empty stat combo label set. If no slots have any stats, return `null` — no badge is rendered. This prevents the GW2 base stat values (Power, Precision, Toughness, Vitality start at 1000 each) from producing spurious role labels on empty builds.

## Scoring Algorithm

Four role scores are computed from equipment-contributed stat totals (`computeSlotStats` returns equipment values only — no GW2 base stat subtraction needed):

| Role | Score Formula |
|---|---|
| Power DPS | `Power × 1.0 + Precision × 0.5 + Ferocity × 0.5` |
| Condi DPS | `ConditionDamage × 1.0 + Expertise × 0.8` |
| Boon Support | `Concentration × 1.5 + HealingPower × 0.3` |
| Heal Support | `HealingPower × 1.5 + Concentration × 0.3` |

Hybrid is a derived outcome, not a scored role.

**Rune bonuses** are also scored additively. Flat stat bonuses (e.g. `+25 Power`) are added directly to the relevant stat total. Percentage bonuses are converted to stats using GW2 conversions: `+1% Boon Duration = +15 Concentration`, `+1% Condition Duration = +15 Expertise`. `to All Stats` bonuses add to all nine stats.

**Winner selection:**
1. Compute all four scores using equipment stats plus rune bonus stats.
2. Sort scores descending. Let `score1` = highest, `score2` = second highest.
3. If `score1` does not clear the minimum threshold (**700**), return **Unknown**.
4. If both `score1` and `score2` clear threshold AND `(score1 - score2) / score1 < 0.20`, return **Hybrid**.
5. Otherwise, return the role with the highest score.

**Note:** The minimum threshold is 700, not the originally-designed 1500. The lower value ensures Celestial gear builds (~810 max single-role score) receive a role label rather than Unknown, while still correctly returning Unknown for completely empty gear sets.

## UI Display

### Build cards (library)

- A small role badge renders below the build title, alongside existing tag chips.
- Shown in all library view modes that display build cards: **list, table, grid, columns**.
- Not shown in **icon** view mode (insufficient space).
- Visual weight matches existing tags but is not interactive (no click/filter behavior).
- One distinct color per role (defined as CSS custom properties for easy theming).

### Comp detail view

- Each build slot in party lines shows the same role badge.
- Pool builds at the bottom also show the badge.
- Consistent positioning with the library card treatment — allows scanning a composition to see role coverage at a glance.

## Out of Scope

- Trait/skill-based role inference
- Multiple simultaneous role labels per build (single winner only)
- Filtering or sorting by role (future enhancement)
- PvP-specific role logic (standard stat compute handles PvP amulets already)
- Persisting the role estimate to the build store

## Files to Create / Modify

| File | Change |
|---|---|
| `src/renderer/modules/roleEstimator.js` | New module — `estimateRole(build, catalog)` + `roleBadgeHtml(build, catalog)` + private helpers |
| `src/renderer/modules/library/content.js` | Render role badge on build cards (all modes except icon) |
| `src/renderer/modules/comps/comp-detail.js` | Render role badge on comp slots and pool builds |
| `src/renderer/styles/role-badge.css` | New file — role badge styles and per-role CSS custom properties |
| `src/renderer/styles.css` | Import `role-badge.css` |
