# Role Estimator — Design Spec
**Date:** 2026-03-18
**Status:** Approved

## Overview

A new core feature that automatically estimates the role of a GW2 build based solely on its computed equipment stats. The estimated role is displayed as a badge on build cards in the library list and on build slots in the comp detail view.

## Roles

Seven possible role labels:

| Role | Primary Signal |
|---|---|
| Power DPS | High Power / Precision / Ferocity |
| Condi DPS | High Condition Damage / Expertise |
| Boon Support | High Concentration / Boon Duration |
| Heal Support | High Healing Power |
| Tank | High Toughness |
| Hybrid | Two roles are roughly equally dominant |
| Unknown | No role clears the minimum threshold |

## Architecture

A new pure function module — `src/renderer/modules/roleEstimator.js` — contains all role logic.

**Data flow:**
```
build → computeEquipmentStats() → estimateRole() → role string
```

- `estimateRole(build)` calls the existing `computeEquipmentStats()` from `stats.js` to get the 9 raw stat totals, then scores them and returns the winning role label.
- The result is **not persisted** on the build object. It is computed on-demand at render time, keeping the build data model clean and ensuring the role always reflects current equipment.
- No state, no side effects. Pure function in, string out.

## Scoring Algorithm

Six role scores are computed from the raw stat totals:

| Role | Score Formula |
|---|---|
| Power DPS | `Power × 1.0 + Precision × 0.5 + Ferocity × 0.5` |
| Condi DPS | `ConditionDamage × 1.0 + Expertise × 0.8` |
| Boon Support | `Concentration × 1.5 + HealingPower × 0.3` |
| Heal Support | `HealingPower × 1.5 + Concentration × 0.3` |
| Tank | `Toughness × 1.5 + Vitality × 0.5` |

**Winner selection:**
1. Compute all five scores.
2. Find the highest score.
3. If the highest score does not clear the minimum threshold (1500), return **Unknown**.
4. If the top-2 scores are both above threshold and within 20% of each other, return **Hybrid**.
5. Otherwise, return the role with the highest score.

**Hybrid formula:**
```
if abs(score1 - score2) / score1 < 0.20 → Hybrid
```

**No badge:** If the build has no equipment filled in (all slots empty / no stat package set), `estimateRole` returns `null` and no badge is rendered.

## UI Display

### Build cards (library list)

- A small role badge renders below the build title, alongside existing tag chips.
- Visual weight matches existing tags but is not interactive (no click/filter behavior).
- One distinct color per role (defined in CSS variables for easy future theming).

### Comp detail view

- Each build slot in party lines shows the same role badge.
- Pool builds at the bottom also show the badge.
- Consistent positioning with the library card treatment — allows scanning a composition to see role coverage at a glance.

## Out of Scope

- Trait/skill/rune-based role inference (stats only)
- Multiple simultaneous role labels per build (single winner only)
- Filtering or sorting by role (future enhancement)
- PvP-specific role logic (standard stat compute handles PvP amulets already)
- Persisting the role estimate to the build store

## Files to Create / Modify

| File | Change |
|---|---|
| `src/renderer/modules/roleEstimator.js` | New module — pure `estimateRole(build)` function |
| `src/renderer/modules/library/content.js` | Render role badge on build cards |
| `src/renderer/modules/comps/comp-detail.js` | Render role badge on comp slots and pool builds |
| `src/renderer/style.css` (or equivalent) | Role badge styles and per-role color variables |
