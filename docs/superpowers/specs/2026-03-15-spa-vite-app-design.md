# SPA Vite App — Architecture Redesign

**Date:** 2026-03-15
**Status:** Approved
**Supersedes:** The embedded template string approach in the current `siteBundle.js`

## Overview

Restructure the published build viewer SPA from embedded template strings in `siteBundle.js` (~900 lines) into a proper Vite-built app at `src/site/`. The SPA imports the desktop app's CSS files directly (one source of truth for component styles) and has its own focused read-only renderers that produce the exact same DOM structure as the desktop app. Build data is enriched at publish time with weapon skills, F-skills, stats, profession icons, and pet/legend display data so the SPA is fully self-contained.

## Project Structure

```
axiforge/
├── src/
│   ├── main/                   # Electron main process (existing)
│   │   ├── siteBundle.js       # SIMPLIFIED: reads dist/site/ instead of generating strings
│   │   ├── buildPublish.js     # NEW: serializeForPublish() — enriched build data
│   │   └── ...
│   ├── preload/                # Preload bridge (existing, unchanged)
│   ├── renderer/               # Desktop Electron renderer (existing)
│   │   ├── modules/
│   │   └── styles/             # Shared CSS — imported by both desktop and site
│   └── site/                   # NEW: SPA Vite app
│       ├── index.html          # SPA shell (navbar, #app container, font loading)
│       ├── 404.html            # GitHub Pages SPA routing fallback
│       ├── main.js             # Entry: routing, decryption, render orchestration
│       ├── decrypt.js          # Web Crypto AES-GCM decryption
│       ├── render-build.js     # Build header, tabs, layout orchestration
│       ├── render-specs.js     # Read-only specialization cards (1:1 desktop DOM)
│       ├── render-skills.js    # Read-only skill bar + weapon skills + profession mechanics
│       ├── render-equipment.js # Read-only equipment panel (1:1 desktop DOM)
│       ├── render-detail.js    # Hover preview / detail panel
│       ├── styles.css          # @import desktop CSS + SPA-specific overrides
│       └── vite.config.js      # Vite config for static site build
├── dist/
│   └── site/                   # Vite build output (committed to axibuilds repo)
│       ├── index.html
│       ├── 404.html
│       └── assets/             # Bundled CSS/JS with hashed filenames
└── package.json                # Updated scripts: build:site, dev wires site build
```

## CSS Sharing

`src/site/styles.css` imports the desktop CSS files directly:

```css
@import "../renderer/styles/base.css";
@import "../renderer/styles/specializations.css";
@import "../renderer/styles/skills.css";
@import "../renderer/styles/equipment.css";
@import "../renderer/styles/detail-panel.css";
@import "../renderer/styles/buttons.css";

/* SPA-specific styles (navbar, tabs, landing, error, build header, etc.) */
```

Vite resolves `@import` at build time and bundles everything into a single CSS file. One source of truth — when the desktop styles change, the site automatically picks them up on next build.

## Read-Only Renderers

Each `render-*.js` file produces the **exact same HTML structure and CSS classes** as its desktop counterpart, just without interactive editing (no dropdowns, no drag, no slot pickers). This means the desktop CSS works unchanged.

### `render-specs.js`
Produces the desktop's `specializations-host > spec-card > spec-card__panel > spec-card__body` structure with:
- Background images from `spec.background`
- Gold borders for elite specs (`spec-card__panel--elite`)
- Spec emblem (`spec-emblem`, `spec-emblem--elite`)
- Minor traits with hexagonal clip-path (`trait-btn--always`)
- Major traits with active glow (`trait-btn--active`) and dimmed unselected
- `data-name` and `data-desc` attributes for hover tooltips
- No SVG connectors (complex animated paths — skip for read-only)

### `render-skills.js`
Produces the desktop's skill bar structure with:
- Weapon skills row (`skills-bar__weapon-row > skills-bar > skill-group`) — 5 weapon skill icons per weapon set
- Profession mechanics bar (`profession-mechanics-bar`) — F1-F5 icons with labels
- Heal/utility/elite bar (`skill-group--utilities`) — icon + label layout
- Revenant legend slots, Ranger pet slots, Elementalist attunement indicators
- Underwater skills section when applicable
- `data-name` and `data-desc` attributes for hover tooltips

### `render-equipment.js`
Produces the desktop's `equip-layout` 3-column grid with:
- Left column: armor slots (`equip-slot--compact`) with stat icons and rune upgrade buttons, weapon slots (`equip-slot--weapon`) with weapon type icon + stat + sigil/infusion upgrades, consumable slots (food/utility)
- Center column: profession icon art (`equip-art-bg-icon`) with SVG
- Right column: stat summary (`equip-stats` grid with derived stats), trinket grid (`equip-trinket-grid`), underwater section
- Notes display (read-only `<div>` instead of `<textarea>`)

### `render-detail.js`
Hover preview panel using the desktop's `hover-preview` structure:
- Icon, title, kind label
- Description text
- Facts list (formatted damage, buffs, conditions, etc.)
- Positioned near hovered element via mouseover/mouseout delegation
- Uses `data-name`, `data-desc`, and optionally `data-facts` attributes on hoverable elements

### `render-build.js`
Orchestrates the page layout:
- Build header: profession icon SVG + build name + profession/game mode/tags
- Tab bar: BUILD / EQUIPMENT tabs
- Tab content containers
- Wires up tab switching

## Enriched Publish Data

New `serializeForPublish(build, catalog, upgradeCatalog)` function in `src/main/buildPublish.js` that extends the existing serialized build with:

### Weapon Skills
For each equipped weapon set (mainhand1/offhand1, mainhand2/offhand2, aquatic1/aquatic2), resolve the 5 weapon skills from the catalog:
```json
{
  "weaponSkills": {
    "set1": [
      { "id": 123, "name": "Chop", "icon": "url", "description": "...", "slot": "Weapon_1" },
      ...
    ],
    "set2": [...],
    "aquatic1": [...]
  }
}
```

Uses `getEquippedWeaponSkills()` from `skills.js` (already exported).

### Profession Mechanics (F-Skills)
Resolve F1-F5 profession mechanic skills from the catalog:
```json
{
  "professionMechanics": [
    { "id": 456, "name": "Reaper's Shroud", "icon": "url", "description": "...", "fLabel": "F1" },
    ...
  ]
}
```

Uses `buildMechanicSlotsForRender()` from `skills.js` (already exported).

### Stat Summary
Calculate total attributes from equipment:
```json
{
  "stats": {
    "power": 2897,
    "precision": 2127,
    "toughness": 1000,
    "vitality": 1000,
    "critChance": "52.38%",
    "critDamage": "150%",
    "health": 11645
  }
}
```

Uses the stat calculation logic from `stats.js`.

### Profession Icon SVG
The SVG string for the profession or elite spec icon:
```json
{
  "professionIcon": "<svg>...</svg>"
}
```

Read from `gw2-class-icons` package (same source as `profession-icons.js`).

### Pet Display Data (Ranger)
```json
{
  "petDisplay": {
    "terrestrial1": { "id": 44, "name": "Juvenile Tiger", "icon": "url" },
    "terrestrial2": { "id": 12, "name": "Juvenile Brown Bear", "icon": "url" }
  }
}
```

### Legend Display Data (Revenant)
```json
{
  "legendDisplay": [
    { "id": "Legend1", "name": "Legendary Assassin Stance", "swapIcon": "url" },
    { "id": "Legend2", "name": "Legendary Demon Stance", "swapIcon": "url" }
  ]
}
```

### What Gets Encrypted

The enriched build object (everything from `serializeEditorToBuild()` plus the additions above) is what gets encrypted and committed to the repo. The SPA decrypts and renders it without any external API calls.

## Simplified `siteBundle.js`

Instead of generating HTML/CSS/JS as template strings, reads pre-built Vite output:

```js
const fs = require("node:fs");
const path = require("node:path");

const SITE_DIST = app.isPackaged
  ? path.join(process.resourcesPath, "site")
  : path.join(__dirname, "../../dist/site");

function buildSpaBundle() {
  const files = {};
  walkDir(SITE_DIST, SITE_DIST, files);
  files["site/.nojekyll"] = "\n";
  return files;
}

function walkDir(dir, root, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, root, files);
    } else {
      const rel = "site/" + path.relative(root, full).replace(/\\/g, "/");
      files[rel] = fs.readFileSync(full, "utf8");
    }
  }
}
```

## Build & Dev Workflow

### npm scripts
```json
{
  "build:site": "vite build --config src/site/vite.config.js",
  "dev": "npm run build:site && concurrently \"vite\" \"electron .\"",
  "build": "npm run build:site && electron-builder"
}
```

- `npm run dev` — builds site once, then starts Electron + Vite dev server. One command.
- `npm run build` — builds site, then packages Electron app. Site files included in the package.
- `npm run build:site` — standalone site build for iteration.

### Dev iteration on the SPA
For rapid SPA development without Electron:
```bash
cd src/site && npx vite
```
This serves the SPA locally with HMR. Use a test `.enc` file or a mock build JSON for development. The SPA can be iterated on independently of the Electron app.

### Packaged app
Electron Builder includes `dist/site/**` in the app package via the `files` array in `package.json` or `electron-builder.yml`. At runtime, `siteBundle.js` reads from `process.resourcesPath` (packaged) or `dist/site/` (dev).

## Vite Config

```js
// src/site/vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",                    // Relative paths for GitHub Pages
  build: {
    outDir: "../../dist/site",
    emptyDirBeforeWrite: true,
  },
});
```

`base: "./"` ensures all asset URLs are relative, which is required for GitHub Pages subpath deployment (`owner.github.io/axibuilds/`).

## Changes to Existing Code

### `src/main/siteBundle.js`
- Remove all embedded template strings (`SPA_INDEX_HTML`, `SPA_STYLES_CSS`, `SPA_APP_JS`, `SPA_404_HTML`)
- Remove `fs.readFileSync` calls to desktop CSS files
- Replace `buildSpaBundle()` with directory walker that reads `dist/site/`
- Keep `buildEncryptedBuildFile()` unchanged

### `src/main/buildPublish.js` (new)
- `serializeForPublish(build, catalog, upgradeCatalog, professionIcons)` — extends serialized build with weapon skills, F-skills, stats, profession icon, pet/legend display data
- Called from the `builds:publish-build` IPC handler in `index.js`

### `src/main/index.js`
- Import `serializeForPublish` from `buildPublish.js`
- In the `builds:publish-build` handler, call `serializeForPublish()` to enrich the build data before encrypting
- Load the profession catalog and upgrade catalog for the build's profession to pass to `serializeForPublish()`

### `package.json`
- Add `build:site` script
- Update `dev` script to build site first
- Add `dist/site` to electron-builder files

### `tests/unit/siteBundle.test.js`
- Update tests to verify `buildSpaBundle()` reads from `dist/site/`
- May need a test fixture directory or mock

### `tests/unit/buildPublish.test.js` (new)
- Test `serializeForPublish()` enrichment with mock catalog data

## What This Does NOT Change

- The encryption/decryption flow (AES-GCM, same key format, same `.enc` files)
- The URL format (`owner.github.io/axibuilds/<slug>#<fileId>.<key>`)
- The GitHub API integration (repo creation, Pages setup, file commits)
- The preload bridge
- The desktop renderer modules (they're read-only dependencies for CSS)
- The build store (publish metadata fields)

## Migration

The existing embedded template string approach is replaced entirely. The `SPA_INDEX_HTML`, `SPA_STYLES_CSS`, `SPA_APP_JS`, and `SPA_404_HTML` constants are deleted. The desktop CSS `fs.readFileSync` calls are also deleted. All of this is replaced by reading `dist/site/`.

The first time after this change, the user must re-publish to update the site files on GitHub Pages. Old published build URLs continue to work since the encrypted `.enc` files are untouched — only the SPA shell/styles/JS change.
