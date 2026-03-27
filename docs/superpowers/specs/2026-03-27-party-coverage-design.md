# Party Coverage View

**Date:** 2026-03-27
**Replaces:** Boon coverage panel in comp detail view
**Visual reference:** `.superpowers/brainstorm/325897-1774639218/content/layout-expanded.html`

## Overview

Replace the existing boon coverage panel with a "Party Coverage" view that shows three categories per party line: boon coverage, combo field coverage, and blast finisher coverage. No squad-wide summary — purely per-line. Full parity between desktop (Electron) and SPA (web published).

## Data Extraction

A single extraction engine scans each build across all skill sources:

- Weapon skills (active weapon set, auto-attacks, flip skills)
- Heal / Utility / Elite skills
- Profession mechanics (F1-F5, determined by selected specializations)
- Traits (major and minor from equipped specs)
- **Kit/bundle sub-skills** (e.g., Bomb Kit's individual skills, Flamethrower skills, Conjure weapon skills)

### Boons

Scan for `Buff`, `ApplyBuffCondition`, and `PrefixedBuff` fact types. Extract:

- Boon name (normalized)
- Stacks (`apply_count`)
- Duration (adjusted for concentration from gear/runes)
- Self vs. ally targeting (sentence-level keyword analysis: "allies"/"ally" in description)
- Source type (skill or trait) and source name
- Special case: Twisted Medicine (Trait 2220) makes Elixir boons ally-targeted

### Combo Fields

Scan for `ComboField` fact type. Extract:

- `field_type`: Fire, Water, Light, Dark, Ethereal, Ice, Lightning, Smoke, Poison
- Duration: from `Duration` or `Time` facts on the same skill (when available)
- Radius: from `Radius` facts on the same skill (when available)
- Source skill name
- Source class and elite spec
- Kit/bundle name if the skill comes from a bundle sub-skill

### Blast Finishers

Scan for `ComboFinisher` fact type where `finisher_type === "Blast"`. Extract:

- Skill name
- Source class and elite spec
- Kit/bundle name if from a bundle sub-skill
- Blast count: defaults to 1 per `ComboFinisher` fact; skills with multiple `ComboFinisher` facts count as multiple blasts
- `percent` from the fact (shown in UI only when < 100%, e.g., "×1 blast (75%)")

### Aggregation

Per party line: group sources across all builds in that line. No squad-wide aggregation.

Output per line:
```
{
  lineId, label ("P1", "P2", ...),
  boons: Map<boonName, { count, providers, sources }>,
  comboFields: Map<fieldType, { count, providers, sources }>,
  blastFinishers: [{ skillName, class, eliteSpec, kit, blastCount }]
}
```

## UI Structure

### Per Party Line

Three stacked sections within each party line, all visible simultaneously (no tabs).

#### Header Row

- Party line label (P1, P2, etc.) — left-aligned, gold color (`#e0a040`)
- Self-boon toggle — top-right, **off by default**. When off, hides boons where ALL sources are self-only (no ally sources). When on, shows all boons regardless.

#### Boons Section

- Label: "BOONS" (uppercase, small, muted)
- Row of boon pills for all 12 boons in fixed order: Aegis, Alacrity, Fury, Might, Protection, Quickness, Regeneration, Resistance, Resolution, Stability, Swiftness, Vigor
- Covered boons: green background (`#3a5a3a`), green text (`#8f8`)
- Uncovered boons: dark background (`#333`), grey text (`#666`)
- Provider count badge (×2, ×3) in yellow-ish text (`#dda`) when multiple builds provide
- **Click to expand** a boon: reveals source detail panel with left border accent in green (`#8f8`)
  - Header: boon icon + name + source count
  - Source rows (dark background `#252540`, rounded):
    - Profession color pip (8px square, rounded corners)
    - Skill/trait name
    - Elite spec name (kit name in parentheses if from bundle)
    - Stack count
    - Duration (with concentration adjustment)
    - ALLY badge (blue bg `#2a4a6a`, blue text `#8cf`) or SELF badge (olive bg `#4a4a2a`, yellow text `#dd8`)

#### Combo Fields Section

- Label: "COMBO FIELDS" (uppercase, small, muted)
- Row of field type pills, only showing field types that have sources (no greyed-out placeholders)
- Color-coded by field type:
  - Fire: orange bg (`#5a3a2a`), orange text (`#f96`)
  - Water: blue bg (`#2a3a5a`), blue text (`#6af`)
  - Light: yellow bg (`#5a5a3a`), yellow text (`#ee8`)
  - Other field types: similar distinctive color pairs
- Source count badge when multiple skills provide same field type
- **Click to expand** a field type: reveals source detail panel with left border accent matching field color
  - Header: field icon + type name + source count
  - Source rows:
    - Profession color pip
    - Skill name
    - Class / elite spec (kit name in parens if from bundle)
    - Duration (e.g., "4s duration")
    - Radius (e.g., "180 radius")

#### Blast Finishers Section

- Label: "BLAST FINISHERS" (uppercase, small, muted)
- Single "Blast" pill showing total source count, purple theme (`#4a3a5a` bg, `#c8f` text)
- **Click to expand**: reveals source detail panel with left border accent in purple (`#c8f`)
  - Header: blast icon + "Blast Finishers" + source count
  - Source rows:
    - Profession color pip
    - Skill name
    - Class / elite spec (kit name in parens if from bundle)
    - Blast count (e.g., "×1 blast", "×3 blasts"); percent shown as suffix if < 100% (e.g., "×1 blast (75%)")

### Empty Lines

Party lines with no builds assigned show nothing (same as current behavior).

## Self-Boon Toggle Behavior

- Toggle is per party line
- Default state: **off** (hide self-only boons)
- When off: a boon is hidden if every source for that boon within the line is self-targeted (no ally sources)
- When on: all boons shown regardless of targeting
- Toggle state is ephemeral (not persisted)
- Only affects the Boons section — Fields and Blasts have no self/ally concept

## Files Affected

### Rewritten

- `src/renderer/modules/comps/comp-boon-coverage.js` — rewritten to compute all three categories, render new UI, handle toggle and expand interactions
- `src/renderer/modules/boon-coverage.js` — extraction logic expanded to include `ComboField` and `ComboFinisher` facts, plus bundle/kit sub-skill scanning
- Boon coverage HTML in `src/site/render-comp.js` — updated to match new party coverage UI

### Unchanged

- Single-build boon coverage in build editor detail panel — untouched
- Comp data model (`partyLines`, `slots`, `builds`) — no changes
- Catalog/skill data fetching — already has combo field/finisher data from GW2 API
- `src/renderer/modules/constants.js` — may need new constants for field type colors/icons but core boon constants stay

## Out of Scope

- Other combo finisher types (Leap, Projectile, Whirl) — only Blast finishers
- Combo interaction analysis (e.g., "blast in fire field = area Might") — just shows what each line has access to
- Squad-wide summary view — purely per-line
- Persisting toggle state across sessions

## Visual Reference

The mockup at `.superpowers/brainstorm/325897-1774639218/content/layout-expanded.html` is the visual source of truth. Implementation must match its colors, spacing, layout, badges, expanded row structure, and overall feel as closely as possible.
