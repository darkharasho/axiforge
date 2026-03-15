# Web Publishing Design

**Date:** 2026-03-14
**Status:** Approved

## Overview

Publish individual GW2 builds from the AxiForge desktop app to a GitHub Pages site (`axibuilds` repo). Each build gets an encrypted file in the repo and a shareable URL. The published page renders a read-only, desktop-identical view of the build — specs, skills, equipment, all with hover tooltips and bundle expansion. No external API calls needed; all data is embedded.

## URL Format

```
owner.github.io/axibuilds/<slug>#<fileId>.<key>
```

- **slug**: slugified build name (lowercase, hyphens, stripped special chars). Purely cosmetic — used in the URL path for human readability.
- **fileId**: 8-character random hex string. Identifies the encrypted file in the repo (`builds/<fileId>.enc`).
- **key**: base64url-encoded AES-GCM encryption key. Lives in the URL fragment, which is never sent to the server.

The fragment contains everything needed to locate and decrypt the build. No manifest or server-side lookup.

**Examples** (keys abbreviated for readability — actual base64url keys are ~43 characters):
- `owner.github.io/axibuilds/power-reaper#a7f3b2c1.xK9mP2qR4sT6uV8wAb3cDe...`
- `owner.github.io/axibuilds/core-necromancer#b8e4c3d2.yL0nQ3rS5tU7vW9xFg4hIj...`

**Slug collisions:** Two builds with the same name produce the same slug path, but since the fragment (fileId + key) is different, each URL is unique. The path is purely cosmetic.

## Build Name Auto-Population

If the user hasn't set a build name:
- If the 3rd specialization slot is an elite spec → use the elite spec name (e.g., "Reaper", "Dragonhunter")
- If all core traitlines → use "Core {Profession}" (e.g., "Core Necromancer")

The build name must be set before publishing. Publishing auto-saves the build first.

## Encryption

**Purpose:** Prevent casual repo browsers from reading raw build JSON. Not hardened against determined attackers — reasonable obfuscation with real encryption.

**Algorithm:** AES-GCM
- 256-bit random key generated via `crypto.randomBytes(32)` (Node.js)
- 12-byte random IV, prepended to the ciphertext
- Encrypted payload stored as base64 in `.enc` files
- Browser decryption via Web Crypto API (`crypto.subtle.decrypt`)

**Key storage:** The desktop app stores publish metadata alongside the build in `builds.json`:
```json
{
  "publishedSlug": "power-reaper",
  "publishedFileId": "a7f3b2c1",
  "publishedKey": "xK9mP2qR4sT6uV8w"
}
```

The app can always decrypt its own builds using this stored metadata.

## Publish Flow

### Pre-Publish Validation
- Build name must be set (auto-populate if empty, error if still empty)
- Profession must be selected
- GitHub auth must be active

### Steps
1. Serialize build via `serializeEditorToBuild()` — includes all denormalized trait/skill data (names, icons, descriptions)
2. Auto-save the build (publish implies save)
3. Generate or reuse encryption key and file ID from stored publish metadata
4. Encrypt serialized build JSON → base64 blob
5. Slugify build name → e.g., `power-reaper`
6. If previously published with a different name (slug changed): delete old `.enc` file from repo
7. Commit encrypted file to `axibuilds` repo at `site/builds/<fileId>.enc`
8. Update local publish metadata on the build
9. Trigger Pages workflow dispatch
10. Return full URL to the user

### Re-Publish Behavior
- Same build = same URL (overwrite). File ID and key are reused.
- If the build name changed, the old URL dies. Old file is deleted, new slug takes over. No redirects.

### First-Time Setup
- Reuse existing onboarding flow but create `axibuilds` repo instead of `axiforge`
- Deploy static SPA files (index.html, styles.css, app.js) to the repo
- Set up GitHub Pages with workflow build type
- Deploy `.github/workflows/deploy-pages.yml`

## Site Structure

```
axibuilds/
├── site/
│   ├── index.html          # SPA shell
│   ├── styles.css          # Desktop-matching dark theme
│   ├── app.js              # Client-side routing, decryption, rendering
│   ├── 404.html            # SPA routing fallback (redirects to index.html)
│   └── builds/             # Encrypted build files (inside site/ so Pages serves them)
│       ├── a7f3b2c1.enc
│       ├── b8e4c3d2.enc
│       └── ...
├── .nojekyll
└── .github/workflows/deploy-pages.yml
```

Encrypted build files live under `site/builds/` so they are included in the Pages artifact (the workflow uploads `./site`). The app fetches them from `./builds/<fileId>.enc` relative to the site root.

## Published Build Page

### Titlebar / Navbar
- **Left:** AxiForge logo (SVG) + "AxiForge Builds" (Cinzel serif font)
- **Right:** GitHub link (to axiforge repo), Discord link (discord.gg/UjzMXMGXEg)

### Build Header
- Build name (large, Cinzel serif)
- Profession / elite spec, game mode, publish date
- Tags as pill badges

### Tabbed Content
Tabs switch between BUILD and EQUIPMENT panels, matching the desktop app:

**BUILD tab:**
- Specialization rows with spec icon, name, trait grid (3 tiers × 3 options, selected traits highlighted)
- Skill bar (heal, utilities, elite) with GW2 icons
- Underwater skills (if applicable)
- Profession-specific sections rendered from serialized build data:
  - Revenant: `selectedLegends` (legend swap bar)
  - Ranger/Soulbeast: `selectedPets` (terrestrial + aquatic pet display)
  - Elementalist/Weaver: attunement indicator
  - Engineer: kit/toolbelt bundle expansion
  - Necromancer/Antiquary: `antiquaryArtifacts` (F-key draws)
  - Catalyst: `morphSkillIds`
  - Vindicator: `allianceTacticsForm` (legendary alliance form)
- Notes section

**EQUIPMENT tab:**
- Same two-column card layout as desktop app
- Armor/trinket slots with icons on left, weapons on right
- Stat package, runes, sigils, infusions — all with GW2 item icons
- Relic, food, utility, enrichment cards

### Interactive Features (Read-Only)
- Hover tooltips on traits and skills (detail panel with descriptions, facts, boon/condition icons)
- Bundle expansion (clicking kit/toolbelt skills to see their sub-skills)
- Tab switching between BUILD and EQUIPMENT

### No Editing
- No dropdowns, no drag-and-drop, no selection handlers
- No save/publish buttons

## SPA Architecture

### Routing (Client-Side)
- `/<slug>#<fileId>.<key>` → build viewer page
- `/` → landing page ("AxiForge Builds — publish from the desktop app")
- Any other path → 404 message

GitHub Pages doesn't support server-side routing. The `404.html` file handles this:
1. When GitHub Pages can't find a path (e.g., `/power-reaper`), it serves `404.html`
2. `404.html` stores the current path and fragment in `sessionStorage`
3. `404.html` redirects to `/axibuilds/` (the site root / `index.html`)
4. `index.html` checks `sessionStorage` on load, restores the original path, and routes accordingly

### app.js Flow
1. Parse URL path (slug) and fragment (fileId.key)
2. Split fragment on first `.` → fileId and base64url key
3. Fetch `builds/<fileId>.enc`
4. Decode base64 → extract IV (first 12 bytes) + ciphertext
5. Import key via Web Crypto API
6. Decrypt with AES-GCM
7. Parse JSON → build object
8. Render build header, tabs, build panel, equipment panel
9. Wire up hover tooltips and bundle expansion

### Code Approach
Write focused read-only renderers in `siteBundle.js` as embedded strings (same pattern as current site bundle). These closely mirror the desktop component structure and styles but are purpose-built for read-only display. Direct reuse of desktop modules is impractical due to editing logic interleaved with rendering.

### Styles
Reuse the desktop app's CSS variables and visual language:
- Colors: `--bg: #04070f`, `--panel: #101930`, `--accent: #4fd897`, `--accent-2: #48a8ff`
- Fonts: Cinzel (headings), Exo 2 (body)
- Border radius: 14px panels, 10px inputs
- Dark blue-black base with green/blue accents

## Changes to Existing Code

### `githubApi.js`
- Change `TARGET_REPO` from `"axiforge"` to `"axibuilds"` (replaces the old build library site entirely — the new per-build publishing supersedes the previous "publish all builds" approach)
- Update repo description to `"AxiForge Builds — published GW2 builds"`
- Add function to delete a file from the repo (for slug change cleanup)

### `siteBundle.js`
- Replace current `buildSiteBundle()` with new SPA bundle generation
- New function: `buildPublishBundle(build, fileId, key)` for individual build encryption + commit
- SPA HTML/CSS/JS as embedded strings (significantly expanded from current)

### `buildStore.js`
- Store publish metadata (`publishedSlug`, `publishedFileId`, `publishedKey`) on build objects

### `src/main/index.js`
- New IPC handler: `builds:publish-build` (single build publish)
- Update onboarding handlers to use `axibuilds` repo name

### `src/renderer/modules/render-pages.js`
- Add "Publish" button to build editor/list UI
- Show published URL after successful publish
- Auto-populate build name from elite spec / "Core {Profession}" if empty

### `src/preload/index.js`
- Expose new `publishBuild` IPC method

## Deferred Features

### Web Editor
A standalone web editor at `/axibuilds/editor` for tinkering with builds (no save). Deferred due to complexity of sourcing GW2 catalog data (traits, skills, specs) in the browser without the desktop app's API layer. Will be revisited as a follow-up feature.

### Revisions System
Currently, re-publishing overwrites the previous version. A future revision system would support multiple snapshots of the same build with version history or a revision selector on the published page.

### Unpublish
No UI for removing a published build from the web. Users can manually delete the `.enc` file from their `axibuilds` repo. A dedicated unpublish flow may be added later.
