## Version v0.1.9 — April 8, 2026

### Bug Fixes
- Rune, sigil, food, utility, and relic mentions in build notes now render as styled tooltip chips in the published SPA instead of plain text
- Generic `@[item:...]` mentions are automatically resolved to their specific type (rune, food, sigil, etc.) at publish time
- Unresolved mentions now render as styled chips instead of falling back to plain text

### Other Changes
- Unified design system with consistent CSS tokens across all UI components

## Version v0.1.8 — April 7, 2026

### New Features
- Build editor now starts with a completely blank state — no profession, specializations, traits, or skills are pre-selected
- Empty specialization slots display interactive placeholder cards that open the spec picker on click
- Skill bar renders disabled placeholder slots (weapon, heal, utility, elite) when no profession is selected
- Profession dropdown shows placeholder text instead of defaulting to the first class
- Selecting a new specialization no longer auto-picks the first trait in each tier — all trait choices start blank
- Switching professions or starting a new build no longer auto-fills skills

## Version v0.1.7 — April 6, 2026

### Bug Fixes
- Relic of the Thief tooltip now shows Stack Duration and Maximum Stacks facts
- Fixes CI test failures from v0.1.6

## Version v0.1.6 — April 6, 2026

### New Features
- Skill tooltips now show traited fact overrides when matching traits are equipped
- Weapon @ mentions in build notes for quick reference
- Expanded signet passive buff audit coverage across all professions

### Bug Fixes
- Paragon Strengthening Stanzas trait now shows accurate chant effect descriptions instead of raw numbers
- Signet passive buffs now properly affect stat totals
- Forceful Greatsword and other trait passive buffs now correctly apply to stat totals
- Berserker burst recharge reduction no longer missing from tooltip calculations
- Versatile Rage now shows correct 5s recharge rate and tooltip timing
- Wiki audit parser now correctly handles percentage-based buff descriptions (e.g. Paragon chants)

### Other Changes
- Updated WvW skill balance split data

## Version v0.1.5 — April 6, 2026

### New Features
- Hovering over relics in the relic selector dropdown now shows a tooltip with the relic's description and effects, anchored to the side of the menu

## Version v0.1.4 — April 5, 2026

### Bug Fixes
- Two-handed weapons (greatsword, hammer, longbow, rifle, short bow, staff, spear) now correctly show higher stats than one-handed weapons
- Boon coverage tracker now uses correct stat weights for two-handed weapons

## Version v0.1.3 — April 5, 2026

### Other Changes
- App titlebar badge updated from "alpha" to "beta"
- Simplified release process to standard semver versioning

## Version v0.1.2 — April 5, 2026

### New Features
- Burst recharge reduction is now included in stat calculations
- Updated WvW skill balance splits data

### Bug Fixes
- Trait connector lines in published web builds now stay aligned when the browser window is resized

## Version v0.1.0 — April 1, 2026

### New Features
- Grouped profession selector for streamlined build creation
- Handle all trait-modified boon values including fury stats, might modifier, and game-mode splits
- Add 15 missing stat sets for PvE and WvW

### Bug Fixes
- Allow more than 5 players per party line in comp view (auto-expands on drop)
- Imported build codes without an elite spec now correctly name the build after the core profession
- Traits now properly respect assumed boons
- Include relic description and facts in SPA published builds and equipment panel
- Add missing Giver's stats
- Builds in profession smart folders now appear correctly under All Builds

