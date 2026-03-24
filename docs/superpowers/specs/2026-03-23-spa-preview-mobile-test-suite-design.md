# SPA Preview & Mobile Test Suite Design

## Overview

A Playwright browser-based test suite for the SPA's preview (hover cards, detail panel) and mobile (accordion, sub-tabs, skill bar, bottom sheet) flows. Tests generate encrypted build payloads from existing mock data and serve them via route interception — no GitHub publishing required.

## Approach

**Vite Dev Server + Route Interception (Approach A)**

- Start Vite dev server in Playwright `webServer` config
- Generate `.enc` payloads programmatically using `serializeForPublish()` + `encryptBuild()` with existing e2e fixture catalogs
- Use `page.route()` to intercept `builds/{fileId}.enc` / `comps/{fileId}.enc` fetches and return pre-generated payloads
- Tests run in Chromium (not Electron) at multiple viewport sizes
- Parallel workers enabled (no Electron singleton constraint)

## Prerequisites

- `playwright` (already in `devDependencies`) provides `playwright/test` — no additional package needed. SPA tests use `require("playwright/test")` matching the existing e2e convention.
- `gw2-class-icons` must be installed (`serializeForPublish()` reads SVG icons from `node_modules/gw2-class-icons/wiki/svg/` — already in `dependencies`)

## Module Format

All `tests/spa/` files use **CommonJS** (`require`/`module.exports`) to match the existing test and source conventions. The `src/main/` modules (`buildPublish.js`, `buildEncryption.js`) and `tests/e2e/helpers/` are all CJS. Using CJS throughout avoids interop issues.

## File Structure

```
tests/
├── e2e/                          # existing Electron tests (untouched)
└── spa/
    ├── playwright.config.js      # browser config with 3 viewport projects + webServer
    ├── helpers/
    │   ├── fixture-gen.js        # serializeForPublish + encryptBuild wrapper
    │   ├── route-mock.js         # page.route() helpers for .enc interception
    │   └── viewports.js          # named viewport presets
    └── specs/
        ├── smoke.spec.js
        ├── preview-hover.spec.js
        ├── preview-detail-panel.spec.js
        ├── mobile-spec-accordion.spec.js
        ├── mobile-equipment-tabs.spec.js
        ├── mobile-skill-bar.spec.js
        ├── mobile-bottom-sheet.spec.js
        ├── mobile-comp.spec.js
        ├── responsive-transitions.spec.js
        └── (future spec files as needed)
```

## Playwright Config

- **Projects:** `desktop` (1280x800), `mobile` (375x667), `tablet` (768x1024)
- **webServer:** Playwright's `webServer` config auto-starts and stops the Vite dev server (no separate `global-setup.js`/`global-teardown.js` needed)
- **Workers:** Parallel (no Electron singleton constraint)
- **Traces:** On first retry (matching existing e2e convention)

### npm Scripts

```json
"test:spa": "npx playwright test --config tests/spa/playwright.config.js",
"test:spa:headed": "npx playwright test --config tests/spa/playwright.config.js --headed",
"test:spa:debug": "PWDEBUG=1 npx playwright test --config tests/spa/playwright.config.js"
```

## Data Flow

### Fixture Generation (`helpers/fixture-gen.js`)

Imports from main process modules (all CJS, `require()`):
- `serializeForPublish()` from `src/main/buildPublish.js` (depends on `src/main/statsCompute.js` transitively; reads profession icon SVGs from `node_modules/gw2-class-icons/` via `fs.readFileSync`)
- `encryptBuild()` from `src/main/buildEncryption.js` (depends only on Node `crypto`)
- `makeTestBuild()` / `makeTestComp()` from `tests/e2e/helpers/builds.js`
- Profession catalogs from `tests/e2e/fixtures/`

Exposes:

```js
async function generateEncPayload(buildOrComp, type = "build") {
  // 1. serializeForPublish(build, catalog, upgradeCatalog)
  // 2. encryptBuild(enrichedData, encKey)
  // 3. returns { fileId, encKey, base64Payload }
}
```

### Route Interception (`helpers/route-mock.js`)

```js
async function mockEncRoute(page, { fileId, base64Payload, type = "build" }) {
  const dir = type === "build" ? "builds" : "comps";
  await page.route(`**/${dir}/${fileId}.enc`, route =>
    route.fulfill({ body: base64Payload, contentType: "text/plain" })
  );
}
```

### Per-Test Flow

1. `generateEncPayload(makeTestBuild({ profession: "Necromancer", ... }))` returns `{ fileId, encKey, base64Payload }`
2. `mockEncRoute(page, { fileId, base64Payload })` intercepts the fetch
3. `page.goto(baseUrl + /?b=${fileId}.${encKey})` triggers SPA load → decrypt → render
4. Assertions on rendered output

No separate mock server needed — the encrypted payload is self-contained with all enriched data.

## Test Coverage

### `smoke.spec.js`

- SPA loads and renders a build at all 3 viewports (profession name, title, skills visible)
- SPA loads and renders a comp (party lines, build cards visible)
- No JS console errors during load

### `preview-hover.spec.js` (desktop only)

- Hovering a skill shows `.hover-preview` card with correct name/description
- Hovering a trait shows preview with facts
- Mouse away hides preview
- Preview card stays within viewport bounds

### `preview-detail-panel.spec.js` (desktop only)

- Clicking a skill populates the detail panel sidebar
- Panel shows icon, name, description, facts
- "Open Wiki Page" link present
- Clicking a different skill updates panel content

### `mobile-spec-accordion.spec.js` (mobile viewport)

- All 3 spec cards start collapsed (compact header with name + trait thumbnails)
- Tapping a spec card expands it (full trait grid)
- Expanding one collapses the previously open one
- Chevron rotates on expand/collapse

### `mobile-equipment-tabs.spec.js` (mobile viewport)

- Equipment section shows sub-tabs ("Armor & Runes" / "Weapons & Trinkets")
- Only one column visible at a time
- Switching tabs swaps visible content
- Both tabs contain correct items

### `mobile-skill-bar.spec.js` (mobile viewport)

- Health orb hidden, HP badge visible with value
- Swap pill button visible
- Tapping swap pill toggles weapon set

### `mobile-bottom-sheet.spec.js` (mobile viewport)

- Tapping a skill opens bottom sheet from below
- Sheet shows correct skill card content
- Tapping backdrop dismisses sheet
- X button dismisses sheet
- Swipe-down gesture dismisses sheet (touch event simulation)

### `mobile-comp.spec.js` (mobile viewport)

- Comp renders with party lines in horizontal scroll
- Build cards display correctly at narrow width

### `responsive-transitions.spec.js` (dynamic resizing)

- Desktop to mobile: detail panel hides, accordion activates, sub-tabs appear
- Mobile to desktop: accordion expands, sub-tabs disappear, detail panel returns
- No broken state after resize cycle

## Key Design Decisions

1. **Separate config from e2e tests** — SPA tests are browser-based, e2e tests are Electron-based. Different launch mechanisms, different constraints. Keeping them separate avoids config conflicts.

2. **Reuse existing fixtures** — The e2e fixture catalogs (6.2 MB of profession data) are the same data the real publish pipeline uses. No duplication.

3. **Route interception over static files** — Per-test flexibility without file I/O overhead. The SPA sees identical response format either way.

4. **Self-contained payloads** — `serializeForPublish()` enriches the build with everything the SPA needs (skills, traits, equipment display, icons). No GW2 API calls during rendering.

5. **Parallel workers** — Unlike Electron tests (single worker due to singleton app), browser tests can safely parallelize across viewport projects.
