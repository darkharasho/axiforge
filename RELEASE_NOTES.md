## Version v0.3.14 — April 11, 2026

### Bug Fixes
- Build and comp notes are no longer silently cut off at 12,000 characters — the limit has been raised to 100,000 characters, supporting long-form build guides
- Windows taskbar icon now follows the system/taskbar theme instead of the app theme

## Version v0.3.13 — April 11, 2026

### Bug Fixes
- Weapon swapping between a two-handed weapon set and a one-handed weapon set no longer miscounts infusions — previously, switching to a one-handed mainhand would count an extra infusion slot
- Stat breakdown hover tooltip rows now align consistently (removed misaligned icons)

### Other Changes
- Dev mode no longer suppresses window focus on Vite hot-reload

## Version v0.3.12 — April 11, 2026

### New Features
- Stat breakdown hover now shows the specific trait name (e.g. "Forceful Greatsword") instead of a generic "Trait bonus" label
- Stat breakdown entries now display a colored category pill (trait, equipment, boon, food, rune, sigil, etc.) for easier identification
- App icon now adapts to system theme on macOS and Windows (light icon on dark backgrounds, dark icon on light backgrounds)

### Bug Fixes
- Forceful Greatsword warrior trait now correctly doubles its Power bonus (+120 → +240) when a greatsword or underwater spear is equipped

## Version v0.3.11 — April 11, 2026

### Bug Fixes
- Composition builder now analyzes weapon skills from all Elementalist attunements, not just the active one — blast finishers like Frozen Burst, Earthquake, and Churning Earth are now correctly listed
- Composition builder now includes combo finishers and fields from utility bundle skills (e.g., Engineer kits, Elementalist conjure weapons)
- Fixed build library table view header having a gap below the filter bar and rows rendering above the sticky header when scrolling

## Version v0.3.10 — April 10, 2026

### Bug Fixes
- Fixed Pinnacle of Strength trait applying +10 Power as a passive bonus instead of correctly modifying Might per-stack Power (30 → 40 per stack)
- Fixed Pinnacle of Strength not granting its passive 5% critical chance increase
- Fixed signet passive stat bonuses not updating the attributes panel immediately when selecting a skill — previously required saving the build first

## Version v0.3.9 — April 10, 2026

### Bug Fixes
- Fixed equipment stats not being preserved when sharing builds via axicode — mixed-stat builds (e.g. Berserker armor + Assassin trinkets) now encode and decode per-slot stats correctly
- Fixed imported axicode builds showing "Select stats..." on all equipment slots instead of the actual stat combo

### Other Changes
- Moved axicode source into the monorepo under `packages/axicode` and renamed packages to the `@axiapps` scope (`@axiapps/code`, `@axiapps/gw2-data`)

## Version v0.3.8 — April 10, 2026

### Bug Fixes
- Fixed Critical Strike Chance calculation being 5% too high across all builds — the formula was double-counting the base crit chance on top of what Precision already provides (#193)
- Crit Chance now displays with 2 decimal places to match the in-game tooltip precision

## Version v0.3.7 — April 10, 2026

### Bug Fixes
- Fixed weapon dropdowns showing empty after clearing the API cache — the in-memory catalog cache was not being flushed alongside the disk cache, causing stale data to be served

## Version v0.3.6 — April 10, 2026

### Bug Fixes
- Fixed the shared build website (SPA) pegging CPU to 100% and causing high temperatures in Chrome and Edge — the ambient background animation now uses GPU-composited transforms instead of expensive gradient repaints

## Version v0.3.5 — April 10, 2026

### Bug Fixes
- Fixed a bug where clicking Save could delete equipped weapons (greatsword, axe, etc.) from a build, making them impossible to re-equip
- Fixed catalog cache not distinguishing between game modes, which could return stale data when switching between PvE, WvW, and PvP

## Version v0.3.4 — April 10, 2026

### Bug Fixes
- Fixed Discord webhook sharing failing with a 400 error for large comps — embeds that exceed Discord's 6000-character or 25-field limits are now automatically split across multiple embeds (grid in the first, build legend in continuation embeds)
- Discord error responses now include the full error body in the error message, making it easier to diagnose webhook issues
- Comp titles and descriptions that exceed Discord's limits are now truncated gracefully instead of causing a rejection

## Version v0.3.3 — April 10, 2026

### Bug Fixes
- Fixed "require is not defined" error in packaged builds — the gw2-data engine CJS modules are now properly converted to ESM during the renderer Vite build

## Version v0.3.2 — April 10, 2026

### Bug Fixes
- Fixed crash on AppImage launch caused by EPIPE error when stdout/stderr pipe is closed by the parent process

## Version v0.3.1 — April 10, 2026

### Bug Fixes
- Fixed crash on launch for Linux AppImage and Windows installer builds — the new gw2-data package was not being included in the packaged app

## Version v0.3.0 — April 10, 2026

### New Features
- New `@axi/gw2-data` engine package — stat computation, boon analysis, combo detection, and tooltip rendering are now powered by a dedicated calculation engine with full test coverage
- Wiki-sourced skill and trait facts replace hardcoded balance split data, providing accurate per-mode (PvE/WvW/PvP) tooltips that stay up-to-date with game patches
- Wiki shared-name resolution automatically disambiguates skills and traits that share names across professions
- Recharge and cast time badges now appear in tooltip and detail panel headers
- Discord embed notifications for new releases (when webhook is configured)
- Color theme system with 9 forge-themed palettes

### Bug Fixes
- Published web builds no longer show a blank page (fixed CJS-to-ESM conversion for the gw2-data engine package in the Vite SPA build)
- @Weapons tags now render as styled chips with icons in published builds instead of raw text
- Percentage-based wiki facts now correctly preserve the % symbol
- Profession dropdown is now disabled until all catalogs finish loading, preventing selection errors
- Berserker Burst Recharge reduction now displays correctly in tooltips
- Fatal Frenzy trait now shows correct Condition Damage values and proper PvE/WvW split
- Berserker Blood Reaction trait bonuses now apply correctly, including berserk toggle from skills panel
- Signet of Fury passive bonus and active bonus now display correctly in tooltips
- Weapon tooltips now show proper timing badges and recharge values
- Elementalist tooltips no longer show incorrect values
- Infusion stat calculations now compute correctly
- Missing tooltips for traits with WvW splits now display properly
- Hover tooltips now use compact trait skill lists instead of full skill cards

### Other Changes
- Renderer modules now delegate stat computation to the engine bridge instead of duplicating logic
- Wiki name collision detection with profession-specific suffix retries
- In-memory catalog caching and concurrent request deduplication for faster load times

## Version v0.2.0 — April 9, 2026

### New Features
- Complete visual overhaul with the new "Cool Midnight + Clean Orange" design language
- Modernized color palette with warm orange accents replacing the previous blue theme across all interactive elements
- Updated typography system using Outfit for headings and DM Sans for body text
- Redesigned settings modal with card-based sections, SVG icons, and staggered entrance animations
- Published SPA rebranded with the AxiForge orange/gold color scheme and updated navbar branding

### Other Changes
- Migrated all focus states, selection highlights, toggles, tooltips, and drag indicators to the new accent color
- Updated mobile styles for color consistency with the desktop app

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

