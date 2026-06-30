# AxiForge Playground (build.axi.link) — Design

**Date:** 2026-06-29
**Status:** Approved, pending implementation plan

## Goal

A zero-install, zero-backend web playground at **build.axi.link** where anyone
can open the browser, build a single Guild Wars 2 build with the existing
AxiForge editor, and share it via a link or in-game chat code. Builds are
**transient**: they live in the URL and `localStorage`, never on a server.

This mirrors the pattern AxiRoster uses for its web build (`roster.axi.link`):
the renderer talks to one injected seam, and the web entry installs a browser
implementation of that seam so the *exact same* editor UI is reused unchanged.

## Decisions (locked during brainstorming)

1. **Sharing / persistence:** Pure URL + share-code, **no backend**.
   `localStorage` holds a refresh-safe working draft. A backend short-link layer
   (the "C" option) is explicitly deferred and can be added later behind the same
   seam without touching the renderer.
2. **Scope:** A **single transient build** editor. No library, folders, comps,
   history, or publishing on web.
3. **GW2 data:** **Baked catalogs** generated at build time. The wiki API
   (`wiki.guildwars2.com/api.php`) sends **no CORS header** (verified), so live
   in-browser catalog building is impossible without a proxy Worker — which would
   reintroduce the backend we are avoiding. The GW2 API (`api.guildwars2.com`)
   does send `access-control-allow-origin: *`, but building a catalog live is
   many rate-limited requests with no persistent cache. Baking is faster,
   deterministic, and backend-free.
4. **Entry:** Straight into the editor (no splash). `build.axi.link/#<code>`
   loads a shared build immediately. A slim web top bar carries the share actions
   and a "Get the desktop app" CTA.
5. **Share affordances:** **Both** "Copy share link" (`build.axi.link/#<code>`)
   **and** "Copy chat code" (the in-game `generateChatLink` output).

## Architecture

The renderer (`src/renderer`) accesses Electron only through the global
`window.desktopApi` (88 methods, most desktop-only). The web build installs a
browser implementation of that surface before the renderer boots.

```
src/web/
  index.html          web entry; loads main-web.js, then the existing renderer
  main-web.js          installs window.desktopApi = createWebApi(); sets isWeb flag
                       BEFORE importing renderer.js (renderer self-runs init() on import)
  webApi/
    index.js           assembles the full desktopApi surface from the modules below
    catalog.js         listProfessions / getProfessionCatalog / getUpgradeCatalog
                       / clearGw2Cache → fetch baked JSON, memoized in memory
    draft.js           single transient build in localStorage:
                       listBuilds → [draft] | [], saveBuild, deleteBuild
    share.js           encodeShareCode/decodeShareCode/isShareCode (@axiapps/code);
                       generateChatLink/previewChatLink/importChatLink/importGw2Skills
                       (gw2buildlink + buildChatLink logic); URL-hash sync helpers
    settings.js        getSetting / setSetting → localStorage
    system.js          clipboard → navigator.clipboard; openExternal → window.open
    stubs.js           desktop-only safe no-ops: auth, updater, window chrome,
                       publishing, Discord, shared library, onboarding/pages,
                       folders, comps, history
  chrome.js            web top bar: "Copy share link", "Copy chat code",
                       "Get the desktop app"
  vite.config.js       root = src/web, reuses src/renderer modules, builds → dist/web
scripts/
  bake-catalogs.mjs    runs the existing Node catalog builder (src/main/gw2Data)
                       for every profession × game mode; writes
                       src/web/public/catalogs/<prof>-<mode>.json,
                       upgrades.json, professions.json
wrangler.jsonc         static SPA → build.axi.link (custom domain)
```

### Boot order

`renderer.js` runs `init()` at module-evaluation time (line ~517). Therefore
`main-web.js` must assign `window.desktopApi` and set the `isWeb` runtime flag
**before** importing the renderer module — the same ordering AxiRoster uses with
`setClient(...)` before render.

## The data seam — baked catalogs

`bake-catalogs.mjs` reuses `src/main/gw2Data` in Node, where the wiki client and
disk cache work normally, to produce static JSON per profession/mode. At runtime
`webApi/catalog.js` lazily `fetch()`es only the catalog for the profession the
user selects, then memoizes it. No runtime GW2 or wiki calls occur in the
browser. Regeneration is a build step (wireable into CI on GW2 balance patches).
Total static payload is on the order of ~10–30 MB across all professions, served
lazily and free on Cloudflare static assets.

## Transient builds & sharing (no backend)

- **One working build.** `listBuilds` returns `[draft]`; `saveBuild` writes the
  draft to `localStorage`; folders/comps/history are empty stubs; their UI is
  hidden via the `isWeb` flag.
- **URL is the source of truth.** On every edit (debounced): encode the build
  with `@axiapps/code`, write it to both `localStorage` and `location.hash`. A
  refresh restores work and the URL is always shareable.
- **Load order:** `#<code>` present → decode & load; else `localStorage` draft;
  else a fresh empty build. A bad/old code → toast + fall back to empty build.
- **Two share actions** in the web top bar:
  - **Copy share link** → `build.axi.link/#<code>`
  - **Copy chat code** → the in-game `generateChatLink(build)` output

## Hidden on web (graceful degrade)

Behind a single `isWeb` flag (AxiRoster's `setWeb` approach): window chrome
buttons, auth/sign-in, GitHub-Pages publishing, Discord webhook sending, shared
library, updater, onboarding/pages setup. The deep "wiki detail" hover modal
degrades to baked summaries where present, otherwise is hidden — build cards
still render fully because wiki facts are baked into the catalogs.

## Error handling

- Catalog fetch failure → toast + retry (baked files should always exist).
- Share-code decode failure → toast ("couldn't load that build link") and fall
  back to an empty build.
- Any desktop-only method that slips through → safe no-op, never throws.

## Testing

- **Jest unit:** share-code/hash roundtrip, draft persistence, catalog
  memoization, stubs never throw. Reuses existing `@axiapps/code` and
  `gw2buildlink` coverage.
- **Playwright SPA** (existing `tests/spa` harness): load playground → edit
  build → copy link → reload from hash → assert restored; load a known `#<code>`
  → assert the correct build renders.
- **Bake smoke test:** every generated catalog JSON parses and contains all 9
  professions.

## Deploy

`wrangler.jsonc` serves `dist/web` as a static SPA on `build.axi.link` (custom
domain, exactly like `roster.axi.link`). Package scripts:

- `dev:web` — vite dev against `src/web`
- `build:web` — `bake-catalogs` then `vite build --config src/web/vite.config.js`
- `deploy:web` — `build:web` then `wrangler deploy`

## Out of scope for v1 (YAGNI)

Backend short-links, comps/squad sharing on web, saved libraries, folders. The
seam leaves room to add backend short-links later without touching the renderer.
