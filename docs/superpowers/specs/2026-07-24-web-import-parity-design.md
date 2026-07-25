# Web Import Parity: gw2skills URL + `.axicode` File Import

**Date:** 2026-07-24
**Status:** Approved (design)

## Goal

Bring the two "import a build" flows that exist on the desktop app to the web
playground (build.axi.link), so a web user can import a build from a
gw2skills.net editor URL or from a `.axicode` file. The web UI for both already
exists (the renderer is shared verbatim with desktop); today both paths hit
stubs.

## Scope

- **In scope:** gw2skills.net URL import and `.axicode` file import on web, each
  loading the resulting build into the **current editor** (the active draft).
- **Out of scope:** any library / folder / comp persistence on web, multi-build
  library import, and `.axicode` conflict resolution. The web playground is a
  single-build editor; imported builds replace/populate the active draft.

## Background — current state

Two independent features, both with working desktop UI that is already present
in the web build but wired to stubs:

1. **gw2skills.net URL import** — core logic in `src/main/gw2skillsImport.js`
   (`parseGw2Skills(url, opts)`, ~631 lines). ~500 lines are pure, portable
   data-mapping. Two Node-only chokepoints:
   - `https.request` — fetches the gw2skills editor page, then a second fetch to
     `https://en.gw2skills.net/ajax/db/en.<dbid>.json`. Both are CORS-blocked in
     a browser.
   - `vm.runInContext` (in `_parsePreloadFromHtml`) — evals the
     `new BuildEditor({…})` object literal scraped out of the page HTML. No
     browser equivalent; CSP blocks `eval`; Cloudflare Workers block
     `eval`/`new Function` at runtime.

   Web stub: `src/web/webApi/share.js` (`importGw2Skills`) throws
   "not available in the web playground."

2. **`.axicode` file import** — codec `@axiapps/code` (`decodeAxicodeFile`) is
   pure JS. Only the Electron `dialog` + `node:fs` shell in
   `src/main/axicodeFile.js` is desktop-bound. Renderer orchestration lives in
   `src/renderer/modules/library/axicode-io.js` (`handleAxicodeImport`) and uses
   a conflict modal + folder targeting.

   Web stub: `src/web/webApi/stubs.js` (`importAxicodeFile`) returns `null`.

Web architecture: the web build compiles the desktop renderer directly (Vite
`root = src/renderer`); `src/web/main-web.js` sets `window.__AXIFORGE_WEB__ =
true` and supplies `window.desktopApi = createWebApi(...)`. Any renderer feature
that calls `window.desktopApi.X()` works on web as long as `webApi` implements
`X`. The Cloudflare Worker (`axiforge-playground`, `workers/share-shortener/`)
already routes `/api/*` to itself, runs with `nodejs_compat`, and already
depends on `@axiapps/code`.

## Part 1 — gw2skills.net URL import

### Architecture: isomorphic parser, executed in the Worker

Refactor `gw2skillsImport.js` so the **same module** runs on desktop and in the
Worker, by replacing only the two Node-bound seams:

- `https.request` → global `fetch` (present in modern Electron main and in
  Workers).
- `vm.runInContext` → a tolerant JS-object-literal parser that turns the scraped
  `BuildEditor({…})` argument into data (handles unquoted keys, single quotes,
  trailing commas). The ~500 lines of pure mapping are untouched.

Data flow on web:

```
browser (webApi.importGw2Skills(url))
   │  GET /api/gw2skills?url=<encoded gw2skills editor url>
   ▼
Worker (axiforge-playground)
   │  fetch page HTML  ─┐
   │  extract + parse BuildEditor object literal
   │  fetch ajax/db/en.<dbid>.json
   │  run pure mapping → assembled build object
   ▼
browser  →  load build into current editor
```

- **Worker route:** `GET /api/gw2skills?url=…` added to
  `workers/share-shortener/src/index.js`. Already covered by the existing
  `run_worker_first: ["/api/*", …]` rule and `/api/*` routing — no
  `wrangler.jsonc` change needed. The Worker imports the isomorphic
  `gw2skillsImport` module and returns the finished build as JSON. Both
  gw2skills.net fetches happen server-side, eliminating all CORS problems.
- **Web:** replace the `importGw2Skills` throw-stub in
  `src/web/webApi/share.js` with a `fetch` to `/api/gw2skills?url=…`; on success
  load the returned build into the current editor; on failure surface a clear
  user-facing error (see Error handling).
- **Desktop:** behavior unchanged. It uses the same module, now internally
  backed by `fetch`/safe-parse instead of `https`/`vm`.

### Key risk: the object-literal parser

`vm` evaluates arbitrary JS; the replacement parser only handles data. If
gw2skills embeds something exotic in the `BuildEditor` argument, the parser
could choke where `vm` would not. Mitigation:

- Validate the parser against the real captured gw2skills pages used as fixtures
  in `tests/unit/gw2skillsImport.test.js` (desktop tests must stay green with
  the refactored module — this is the parity guarantee).
- On a parse failure, the Worker returns a structured error and the web UI shows
  a clear "couldn't read this gw2skills build" message rather than a stack trace.

### Error handling (Part 1)

- Invalid / non-gw2skills URL → rejected before fetch (reuse the existing
  `gw2skills.net/editor/?` validation already in the renderer modal).
- Upstream fetch failure / non-200 from gw2skills → Worker returns a 502-style
  JSON error; web shows "gw2skills.net could not be reached, try again."
- Parse failure → JSON error; web shows the "couldn't read this build" message.
- Worker unreachable (offline / not deployed) → web catches the fetch rejection
  and shows a generic "import unavailable" message. Desktop is unaffected.

## Part 2 — `.axicode` file import

### Architecture: pure codec + browser file input

- Implement `importAxicodeFile` in `src/web/webApi/` (replacing the
  `stubs.js` `→ null` stub). It opens a browser `<input type="file"
  accept=".axicode">`, reads the file bytes, and runs `decodeAxicodeFile`
  (`@axiapps/code`) in-process. No Worker, no network.
- Because web has no library/folders/conflict-resolution:
  - decode → **one** build: load it straight into the editor.
  - decode → **multiple** builds: show a lightweight picker (list of build
    names); the chosen build loads into the editor.
- The desktop flow in `axicode-io.js` (conflict modal + folder targeting) is
  bypassed on web by branching on the existing `window.__AXIFORGE_WEB__` flag,
  so shared renderer code stays intact for desktop.

### Error handling (Part 2)

- File that fails to decode (corrupt / wrong format) → show "this doesn't look
  like a valid .axicode file."
- User cancels the file picker → no-op.
- Empty decode (zero builds) → show "no builds found in this file."

## Testing

- **Part 1:** the existing `tests/unit/gw2skillsImport.test.js` suite must pass
  against the refactored isomorphic module (proves desktop parity + exercises
  the new object-literal parser against real fixtures). Add unit coverage for
  the parser's tolerant cases (unquoted keys, single quotes, trailing commas)
  and for the Worker route's error responses.
- **Part 2:** unit test the web `importAxicodeFile` against a known-good
  `.axicode` fixture (single- and multi-build) using the existing codec tests
  in `packages/axicode/tests/` as reference; assert single-build loads directly
  and multi-build surfaces the picker selection.
- Keep vitest parallelism at `--maxWorkers=2` per project convention.

## Files touched (anticipated)

- `src/main/gw2skillsImport.js` — swap `https`→`fetch`, `vm`→safe parser
  (isomorphic; desktop behavior preserved).
- `workers/share-shortener/src/index.js` — add `GET /api/gw2skills` route.
- `src/web/webApi/share.js` — implement `importGw2Skills` via the Worker route.
- `src/web/webApi/stubs.js` (or a new `webApi` module) — implement
  `importAxicodeFile` via browser file input + `decodeAxicodeFile`.
- Renderer `axicode-io.js` — branch on `window.__AXIFORGE_WEB__` for the
  simplified web path (no conflict modal / folder targeting).
- Tests as listed above.

## Non-goals / explicit YAGNI

- No public CORS proxy (fragile, privacy-leaky) — the Worker owns all gw2skills
  network access.
- No web library, folders, comps, or `.axicode` conflict resolution.
- No change to desktop import behavior or UI.
