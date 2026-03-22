# Playwright E2E Test Suite — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Automated E2E tests that launch the real AxiForge Electron app via Playwright's `_electron.launch()`, interact with the renderer window, and validate QA checklist items. GW2 API data is fully mocked via a local HTTP fixture server. Runs on command via `npm run test:e2e`, not part of `npm test`.

Covers 14 of 18 QA checklist sections (~150 test cases). Skips: Authentication/Onboarding (OAuth), Publishing (GitHub API), Performance (not suited to Playwright), Cross-Platform (not Playwright's job).

---

## File Structure

```
tests/e2e/
  playwright.config.js            # Playwright config (Electron launch, timeouts, retries)
  global-setup.js                 # Start mock API server before all tests
  global-teardown.js              # Stop mock API server after all tests
  mock-server/
    server.js                     # Local HTTP server serving GW2 API fixture data
    routes.js                     # Route definitions mapping API endpoints to fixtures
  fixtures/
    professions.json              # Full profession catalog snapshots (1-2 professions)
    skills.json                   # Skill data for test professions
    traits.json                   # Trait data for test professions
    specializations.json          # Specialization data for test professions
    upgrades.json                 # Rune/sigil/food data
    legends.json                  # Revenant legend data
    pets.json                     # Ranger pet data
  helpers/
    app.js                        # launchApp(), closeApp(), cleanDataDir()
    nav.js                        # goToEditor(), goToLibrary(), goToComps()
    editor.js                     # selectProfession(), addSpecialization(), selectSkill(), etc.
    data.js                       # seedBuild(), seedComp(), seedFolder() — write JSON directly
  specs/
    editor-profession.spec.js     # Section 2: Profession & Metadata (9 tests)
    game-mode.spec.js             # Section 3: Game Mode Toggle (5 tests)
    specializations.spec.js       # Section 4: Specializations & Traits (11 tests)
    skills.spec.js                # Section 5: Skills (18 tests)
    equipment.spec.js             # Section 6: Equipment (~31 tests)
    detail-panel.spec.js          # Section 7: Detail Panel (6 tests)
    underwater.spec.js            # Section 8: Underwater Mode (7 tests)
    library.spec.js               # Section 9: Library & Management (~33 tests)
    notes.spec.js                 # Section 11: Notes Tab (7 tests)
    persistence.spec.js           # Section 12: Persistence & Import/Export (6 tests)
    window-controls.spec.js       # Section 13: Window Controls (8 tests)
    edge-cases.spec.js            # Section 16: Edge Cases (7 tests)
    compositions.spec.js          # Section 17: Compositions (16 tests)
    regressions.spec.js           # Section 18: Regression Checks (12 tests)
```

---

## npm Scripts

Add to `package.json`:

```json
"test:e2e": "npx playwright test --config tests/e2e/playwright.config.js",
"test:e2e:headed": "npx playwright test --config tests/e2e/playwright.config.js --headed",
"test:e2e:debug": "PWDEBUG=1 npx playwright test --config tests/e2e/playwright.config.js"
```

Not wired into `npm test`. Playwright is already a devDependency (installed for wiki-audit).

---

## Dependencies

`playwright` is already installed. No additional dependencies needed — the mock API server uses Node's built-in `http` module.

---

## App Launch Strategy

### Playwright Electron API

Each spec file launches a fresh Electron app instance in `beforeAll` and closes it in `afterAll`. Tests within a file share the app instance but start from a clean data state via `beforeEach`.

```js
const { _electron: electron } = require("playwright");

let app, window;
beforeAll(async () => {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      APP_PROFILE: "e2e-test",
      GW2_API_ROOT: "http://localhost:9877/v2",
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
});
afterAll(async () => { await app.close(); });
```

### Data Isolation

The existing `APP_PROFILE` mechanism in `src/main/index.js` only handles the `"dev"` profile. A small production code change generalizes it to support any profile name:

```js
// Before (src/main/index.js lines 29-33):
const IS_DEV_PROFILE = process.env.APP_PROFILE === "dev" && !app.isPackaged;
if (IS_DEV_PROFILE) {
  const devUserData = path.join(app.getPath("appData"), `${app.getName()}-dev`);
  app.setPath("userData", devUserData);
}

// After:
const APP_PROFILE = process.env.APP_PROFILE;
if (APP_PROFILE && !app.isPackaged) {
  const profileUserData = path.join(app.getPath("appData"), `${app.getName()}-${APP_PROFILE}`);
  app.setPath("userData", profileUserData);
}
```

This preserves the existing `APP_PROFILE=dev` behavior and adds support for `APP_PROFILE=e2e-test`, which creates `~/.config/AxiForge-e2e-test/data/`. Since Playwright launches unpackaged Electron (`args: ["."]`), the `!app.isPackaged` guard passes.

The `app.js` helper cleans this directory before each test file. For tests that need pre-existing data (library tests, comp tests), the `data.js` helper seeds data before the app launches via `launchApp()`. Because each spec file launches a fresh Electron instance in `beforeAll`, seeded data is read from disk at startup — no in-memory cache issues.

For `beforeEach` within a running app, use IPC-based seeding (`window.desktopApi.saveBuild()`, etc.) instead of direct file writes, since the stores cache data in memory.

### Production Code Changes

Two minimal changes:

**1. `src/main/index.js`** — Generalize APP_PROFILE (shown above)

**2. `src/main/gw2Data/fetch.js`** — Make API root configurable:

```js
// Before:
const GW2_API_ROOT = "https://api.guildwars2.com/v2";

// After:
const GW2_API_ROOT = process.env.GW2_API_ROOT || "https://api.guildwars2.com/v2";
```

Both are one-line changes. No behavior change in production (env vars are unset).

---

## API Mocking Strategy

### Local Mock Server

A lightweight HTTP server (`mock-server/server.js`) starts on `localhost:9877` before all tests (via `global-setup.js`) and stops after (via `global-teardown.js`).

The server serves fixture data for all GW2 API endpoints the app calls:

| Endpoint | Response |
|---|---|
| `GET /v2/professions` | Array of profession IDs |
| `GET /v2/professions?ids=...` | Profession objects |
| `GET /v2/skills` | Array of skill IDs |
| `GET /v2/skills?ids=...` | Skill objects (chunked) |
| `GET /v2/traits?ids=...` | Trait objects |
| `GET /v2/specializations?ids=...` | Specialization objects |
| `GET /v2/legends` | Legend IDs |
| `GET /v2/legends?ids=...` | Legend objects |
| `GET /v2/pets?ids=all` | Pet objects |
| `GET /v2/items?ids=...` | Item objects (runes, sigils, food) |

### Fixture Data

Fixtures are captured API snapshots for a focused set of professions — enough to test all features without loading all 9 professions. The minimum viable set:

- **Necromancer** — has shroud mechanic, elite specs (Reaper, Scourge, Harbinger), WvW splits, and is a good general-purpose test profession
- **Elementalist** — has attunement mechanic, 4 attunement buttons, overload F5, weaver dual-attunement
- **Revenant** — has legend swap, legend-specific skills, underwater legend restrictions

All unit test fixtures from `tests/fixtures/gw2Api.js` are reused where they provide sufficient data. Gaps are filled by capturing and committing real API response snapshots.

### Wiki API Mocking

Wiki requests (`wiki.guildwars2.com/api.php`) are not served by the mock server — they are simply allowed to fail silently. The wiki panel is not tested (per spec scope). If needed, a simple fixture can be added.

---

## Helper Modules

### `helpers/app.js` — App lifecycle

```js
launchApp()     // Launch Electron with e2e env vars, return { app, window }
closeApp(app)   // Close Electron gracefully
cleanDataDir()  // Delete and recreate the e2e-test data directory
```

### `helpers/nav.js` — Navigation

```js
goToEditor(window)              // Click editor tab, wait for load
goToLibrary(window)             // Click library tab, wait for build list
goToComps(window)               // Click comps tab, wait for comp list
switchTab(window, tabName)      // Switch subnav tab (Build/Equipment/Notes)
```

### `helpers/editor.js` — Editor interactions

```js
selectProfession(window, name)          // Click profession in #professionSelect
addSpecialization(window, name)         // Open spec picker, select by name
selectTrait(window, specIndex, tier, col) // Click trait at position
selectSkill(window, slot, name)         // Open skill picker, search and select
setGameMode(window, mode)               // Click PvE or WvW tab
setTitle(window, title)                 // Type into #editorTitle
saveBuild(window)                       // Click #saveBuildBtn, wait for save
```

### `helpers/data.js` — Data seeding

Two seeding modes depending on timing:

**Pre-launch seeding** (before `launchApp()` in `beforeAll`): writes JSON files directly to the e2e-test data directory. The app reads them on startup.

```js
seedBuildFile(build)   // Write a build object into builds.json (pre-launch only)
seedCompFile(comp)     // Write a comp object into comps.json (pre-launch only)
seedFolderFile(folder) // Write a folder object into folders.json (pre-launch only)
clearData()            // Remove all JSON data files
```

**Live seeding** (while app is running, in `beforeEach`): uses IPC via the renderer to ensure in-memory stores stay in sync.

```js
seedBuildIPC(window, build)   // await window.evaluate(b => desktopApi.saveBuild(b), build)
seedCompIPC(window, comp)     // await window.evaluate(c => desktopApi.saveComp(c), comp)
```

---

## Test Coverage Mapping

Each test maps to one QA checklist checkbox. Format: `test("checklist item text", ...)`.

### Section 2: Build Editor - Profession & Metadata (9 tests)

```
- All 9 professions selectable
- Profession catalogs load correctly for each class
- Profession icons display with correct styling
- Switching professions clears previous selections
- Loading skeletons appear during catalog fetches
- Build title input accepts up to 140 characters
- Build title appears in window title bar
- Tags input accepts comma-separated values
- Unsaved changes indicator (dirty dot) shows/hides correctly
```

### Section 3: Game Mode Toggle (5 tests)

```
- PvE and WvW tabs toggle between game modes
- Switching modes reloads specializations/traits with mode-appropriate data
- Game mode preference remembered across restarts
- Skill/trait balance splits reflect correctly per mode
- Detail panel facts update and flash when mode changes
```

### Section 4: Specializations & Traits (11 tests)

```
- Can select 0–3 specializations
- Specialization cards display with background images
- 3 tier rows (Adept/Master/Grandmaster) display per specialization
- Each tier has 3 major trait options; can select 1 per tier
- Selected traits show visual indicator
- Minor traits display as read-only
- Hovering over traits shows wiki preview panel
- SVG connector lines draw between specializations
- Lines update when page becomes visible
- Lines clear when specializations are removed
- Removing a specialization clears its traits
```

### Section 5: Skills (18 tests)

```
Base skills:
- Heal skill slot displays with correct icon
- 3 Utility skill slots display in order
- Elite skill slot displays correctly
- Skill icons load from GW2 API renders
- Clicking skill slot opens picker with search
- Picker filters skills by profession/mode
- Selected skill updates immediately
- Aquatic/underwater skill slots show when applicable

Profession mechanics (F1–F5):
- Elementalist: Attunement buttons (Fire/Water/Air/Earth) + Overload F5
- Necromancer: Shroud or spec-specific mechanics
- Revenant: Legend swap buttons (2 slots) + legend-specific skills
- Guardian: Virtue buttons (Justice/Resolve/Courage) + spec variations
- Warrior: Burst skill updates based on equipped weapon
- Engineer: Tool-belt skills derived from heal/utility/elite
- Ranger: Pet swap commands + species skill
- Thief: Steal/shadow mechanics
- Mesmer: Shatter buttons or spec-specific mechanics
- Mechanics update when specialization or weapon changes
```

The 3 fixture professions (Necromancer, Elementalist, Revenant) get full mechanics tests. The other 6 professions require additional fixture data captured during implementation — the mock server serves per-profession snapshots, so adding fixture files is straightforward.

### Section 6: Equipment (~31 tests)

```
Armor:
- 6 armor slots display: Head, Shoulders, Chest, Hands, Legs, Feet
- Armor weight (light/medium/heavy) correct per profession

Weapons:
- 2 weapon sets available (mainhand/offhand per set)
- Aquatic weapons show separately
- Weapon dropdown enforces hand restrictions
- Weapon swaps update visible skill bar
- Two-handed weapons disable offhand slot

Trinkets:
- Back, Amulet, 2 Rings, 2 Accessories display
- Trinket picker/search works

Stats, Runes, Sigils, Infusions:
- Stat combo dropdown shows all stat combinations
- Stat combo dropdown includes Sentinel's, Wanderer's, Diviner's
- Sentinel's, Wanderer's, Diviner's each produce correct stat totals when selected
- Stat calculations update when stat package changes
- Rune slots show for armor (6 slots)
- Sigil slots show for weapons
- Rune/Sigil pickers have search
- Infusion slots display in appropriate gear
- Ring infusions allow up to 3 per ring
- Enrichment slot shows for amulet

Food & Utility:
- Food dropdown available with search
- Utility consumable dropdown available
- Stats update based on food/utility selection

Assumed Boons:
- Might stacks selector (0–25)
- Fury and Alacrity toggles
- Assumed boons persist in build
- Reset button clears assumptions

Stats Display:
- Power, Precision, Ferocity, Toughness, Vitality, Condition Damage, Expertise, Healing Power, Concentration calculate correctly
- Stats break down by source (Base, Armor, Weapon, Runes, Sigils, Infusions, Food, Assumptions)
- Stat totals are accurate
- Crit chance % calculates correctly from Precision
```

### Section 7: Detail Panel (6 tests)

```
- Clicking trait/skill shows details in right panel
- Facts display with correct icons
- Hover preview tooltip appears and can be dismissed
- Expand button opens full detail modal
- Modal closes on Escape or close button
- Switching PvE/WvW updates detail facts with highlights/flash
```

Wiki webview test is skipped (out of scope).

### Section 8: Underwater Mode (7 tests)

```
- Underwater checkbox toggles underwater skill sets
- Underwater equipment slots show (breather + 2 aquatic weapons)
- Only aquatic weapons available
- Land weapons hidden when underwater enabled
- Revenant: Certain legends disabled underwater
- Ranger: Only amphibious/aquatic pets available underwater (if fixtures support)
- Elementalist: Attunement-dependent skills update for underwater
```

### Section 9: Library & Management (~33 tests)

```
Library:
- Library page shows all saved builds with title, profession icon, last modified
- Search filters builds by title
- New Build creates empty build
- Load build from library into editor
- Save/Update existing build
- Duplicate build creates copy with "(Copy)" suffix
- Delete build with confirmation
- Pin/unpin builds

Folders:
- Create, rename, and delete folders
- Move builds between folders via drag-drop
- Drag builds within folder to reorder
- Visual feedback during drag (hover states, drop zones)

Copy/Cut/Paste:
- Ctrl+C copies selected build; "Build copied!" toast appears
- Ctrl+C with multiple builds selected copies all; "N builds copied!" toast
- Ctrl+V pastes clipboard build as new build with "(1)" title suffix
- Ctrl+V again increments suffix to "(2)", "(3)", etc.
- Ctrl+V pastes into current folder (not always root)
- Ctrl+X cuts selected build; "Build cut!" toast appears
- Ctrl+V after Ctrl+X moves build; "Build moved!" toast
- Ctrl+C after Ctrl+X cancels the cut (paste creates copy, not move)
- Ctrl+V with empty clipboard shows "Clipboard is empty" error toast
- Ctrl+V with non-JSON clipboard shows error toast
- Ctrl+V with array of builds in clipboard pastes all builds
- Copy/Cut/Paste work when inside folders and subfolders

Context Menu:
- Open, Duplicate, Delete, Move, Pin/Unpin options for builds
- Copy and Cut options appear in single-build context menu
- Copy and Cut options appear in multi-select context menu
- Paste option appears in empty-area context menu
- Edit name, Delete options for folders

Chat Link Integration:
- Generate chat link button copies link to clipboard
- Chat links can be imported back (paste)
```

### Section 11: Notes Tab (7 tests)

```
- Notes textarea accepts input
- Toolbar buttons insert markdown
- Toggle preview/edit mode works
- Preview renders markdown correctly
- @ mention autocomplete shows skills/traits
- Arrow keys navigate suggestions, Enter selects
- Notes save with build and persist across save/reload
```

### Section 12: Persistence & Import/Export (6 tests)

```
- Save button saves all editor data; Ctrl+S shortcut works
- Warning on page/build change if unsaved
- Copy JSON exports current build
- Paste JSON imports from clipboard
- Paste chat link imports build into editor
- Imported build loads all data correctly
```

### Section 13: Window Controls (8 tests)

```
- Minimize, Maximize/Restore, Close buttons work
- Double-clicking title bar maximizes/restores
- Window resizing works (min 1120x740)
- Window size persists across sessions
- Version displays in titlebar
- Dark theme is readable with good contrast
- Profession colors distinguish clearly
- Workspace switcher shows user menu
```

Update check tests are skipped.

### Section 16: Edge Cases (7 tests)

```
- GW2 API timeout shows error without crash
- Empty build title validation
- Invalid JSON import rejected with error
- Corrupt build file handled gracefully
- 0 specializations allowed; 3+ prevented
- Empty utility slots allowed
- Tags input handles edge cases
```

GitHub API failure test is skipped.

### Section 17: Compositions (16 tests)

```
Party Line Drag-and-Drop:
- Build slot draggable to last position
- Dropping into full party line expands it
- Source party line shrinks after move
- Ghost visible when hovering full line
- Dropping slot back onto original line restores correctly
- Clicking empty slot does not add rows
- Builds reorderable within same party line
- Builds movable between party lines
- Builds draggable from pool into party line

Boon Coverage:
- Boon coverage shows which boons are covered
- Boon coverage tooltip shows build name and profession icon
- Elite spec icon shows (not base profession) when build uses elite spec
- Base profession icon for builds without elite spec
- Squad-level boon coverage groups by party line
- Serialized builds display correct elite spec in tooltips
- Editor-format builds look up elite spec from catalog and display correctly
```

### Section 18: Regression Checks (12 tests)

```
- Reaper shroud 5 accuracy in WvW split
- Overload skill selection updates reference panel
- Elementalist flip skills not appearing in core/cata/evoker
- Build name appears in window title
- Build summary collapsed by default
- Loading states show during catalog fetches
- Lines between skills persist after publish
- GitHub Pages setup is optional
- Sentinel's, Wanderer's, Diviner's appear in stat dropdown
- Comp: build draggable to last slot position
- Comp: full party line expands on drop
- Comp: build dropped back onto original line restored
```

---

## Playwright Configuration

```js
// tests/e2e/playwright.config.js
module.exports = {
  testDir: "./specs",
  timeout: 30_000,          // 30s per test
  retries: 1,               // Retry flaky tests once
  workers: 1,               // Sequential — Electron can't run parallel
  globalSetup: "./global-setup.js",
  globalTeardown: "./global-teardown.js",
  use: {
    trace: "on-first-retry", // Capture trace on retry for debugging
  },
};
```

Workers must be 1 — multiple Electron instances would compete for ports and data directories.

**Expected runtime:** ~10-20 minutes for the full suite (~150 tests, each spec file launches a fresh Electron instance). Most tests should complete well under the 30s timeout.

---

## Key DOM Selectors

These selectors are used by helper modules. Consolidated here for reference:

| Selector | Element |
|---|---|
| `#professionSelect` | Profession dropdown |
| `#editorTitle` | Build title input |
| `#saveBuildBtn` | Save button |
| `#specializationsHost` | Specialization container |
| `#skillsHost` | Skills container |
| `#equipmentPanel` | Equipment tab |
| `#notesPanel` | Notes tab |
| `#detailHost` | Detail/wiki panel |
| `#buildList` | Build library list |
| `#lib-content` | Library content area |
| `#lib-sidebar` | Library sidebar |
| `#subnav` | Build/Equipment/Notes tab bar |
| `#winMin, #winMax, #winClose` | Window controls |
| `#titlebar` | Window titlebar |
| `[data-build-id]` | Build card in library |
| `[data-comp-id]` | Comp card in library |
| `[data-folder-id]` | Folder in library |

Actual selectors will be verified and refined during implementation by inspecting the running app.

---

## Out of Scope

- Section 1: Authentication & Onboarding (OAuth device flow)
- Section 10: Publishing & GitHub Pages (GitHub API integration)
- Section 14: Performance & Stability (not suited to Playwright)
- Section 15: Cross-Platform (not Playwright's job)
- Wiki webview testing (sandboxed iframe)
- Update check / auto-update testing
- Chat link pre-warming
