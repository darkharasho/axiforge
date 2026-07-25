# Web Import Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring gw2skills.net URL import and `.axicode` file import to the web playground (build.axi.link), each loading the resulting build straight into the current editor.

**Architecture:** Extract the gw2skills parse+map logic into a transport-agnostic core module (`src/main/gw2skillsParse.js`) that callers drive by injecting `fetchText` and `getUpgradeCatalog`. Desktop injects Node `https` + the `gw2Data` catalog; a new Cloudflare Worker route (`GET /api/gw2skills`) injects `fetch` + the baked static catalog, so the browser never fetches gw2skills.net or evals scraped JS. `.axicode` import reuses the pure `@axiapps/code` codec behind a browser file input, with a `zlib`→pako shim for the browser bundle. On web, both imports branch on `window.__AXIFORGE_WEB__` to call `loadBuildIntoEditor` instead of the desktop library-save flow.

**Tech Stack:** Node/Electron main, Cloudflare Workers (wrangler, `nodejs_compat`), Vite web build, vanilla-JS renderer, `json5` (already installed), `pako` (already installed), `@axiapps/code`, vitest.

**Design-note (deviation from spec wording):** The spec said "swap `https`→`fetch` inside the shared module." We instead make the transport **injected** (`fetchText`). Desktop keeps its proven `https` path; only the Worker uses `fetch`. Same isomorphism goal, lower risk to desktop networking, and it keeps the `gw2Data` catalog tree out of the Worker bundle.

## Global Constraints

- vitest parallelism: run with `--maxWorkers=2` (per project CLAUDE.md). Example: `npx vitest run --maxWorkers=2 <file>`.
- No new heavy dependencies — use already-installed `json5` (2.2.3) and `pako`.
- Desktop import behavior and UI must not change — `tests/unit/gw2skillsImport.test.js` must stay green (its imports resolve through `gw2skillsImport.js`, whose public surface is preserved).
- Web imports load into the **current editor only**. No library, folders, comps, or `.axicode` conflict resolution on web.
- The gw2skills Worker route runs all gw2skills.net network access server-side (page HTML + `ajax/db/*.json`), eliminating CORS. gw2skills import on web depends on the Worker being deployed; desktop is unaffected.
- The parsed `preload` object is JSON5-parseable data (unquoted keys, quoted strings). The `SI || undefined` expression lives at the `BuildEditor` top level, NOT inside `preload` — so we extract and parse the `preload` sub-object only.

---

## File Structure

- **Create** `src/main/gw2skillsParse.js` — transport-agnostic core: `parsePreloadFromHtml`, the pure mapping helpers (moved verbatim), and `parseGw2Skills(url, deps)` orchestration.
- **Modify** `src/main/gw2skillsImport.js` — slim to a desktop adapter that injects `httpsGet` + `gw2Data.getUpgradeCatalog` and re-exports the same public surface.
- **Modify** `workers/share-shortener/src/index.js` — add `GET /api/gw2skills` route.
- **Modify** `src/web/webApi/share.js` — implement `importGw2Skills` via the Worker route.
- **Create** `src/web/webApi/axicode.js` — `createAxicodeApi`: `decodeAxicodeBuffer` + browser-file-input `importAxicodeFile`.
- **Modify** `src/web/webApi/index.js` — wire `createAxicodeApi` (overrides the stub).
- **Create** `src/web/shims/zlib.js` — pako-backed `gzipSync`/`gunzipSync` returning `Buffer`.
- **Modify** `src/web/vite.config.js` — alias `zlib` → the shim.
- **Modify** `src/renderer/modules/library/library.js` — web branches in `handleImportGw2Skills` + `handleImportAxicodeFile`, plus `showAxicodeBuildPickerModal`.
- **Tests:** `tests/unit/gw2skillsParse.test.js`, `tests/unit/worker-gw2skills.test.js`, `tests/unit/web/share-import-gw2skills.test.js`, `tests/unit/web/axicode-import.test.js`.

---

## Task 1: Extract the pure parse core (`gw2skillsParse.js`), json5 instead of vm

**Files:**
- Create: `src/main/gw2skillsParse.js`
- Modify: `src/main/gw2skillsImport.js` (move logic out; leave a desktop adapter — done in Task 2)
- Test: `tests/unit/gw2skillsParse.test.js`

**Interfaces:**
- Produces:
  - `parsePreloadFromHtml(html: string) => { preload: object, dbid: string }`
  - `parseGw2Skills(url: string, deps: { fetchText: (url)=>Promise<string>, getUpgradeCatalog: ()=>Promise<object>, name?: string|null, folderId?: string|null, gameMode?: string }) => Promise<object>` (assembled build)
  - Re-exported helpers: `_buildStatLookup`, `_normalizeStatName`, `_lookupUpgradeName`, `_lookupBuffName`, `_mapEquipment`, `_extractMorphSkillIds`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gw2skillsParse.test.js`:

```js
"use strict";
const { parsePreloadFromHtml } = require("../../src/main/gw2skillsParse.js");

function makeHtml(preloadJs) {
  return `
    <script>
    window.onload = function() {
      var SI = null;
      E = new BuildEditor({
        version: "9.1.2",
        dbid: 1772970067,
        showinfo: SI || undefined,
        preload: ${preloadJs}
      });
      E.init();
    };
    </script>`;
}

describe("parsePreloadFromHtml (json5 core)", () => {
  it("extracts dbid", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "AAAA", mode: "pve", equipment: {} }`));
    expect(r.dbid).toBe("1772970067");
  });
  it("extracts chatlink and mode from an unquoted-key literal", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "DQYfHSkb", mode: "wvw", equipment: { buff: { food: 534, utility: 40 } } }`));
    expect(r.preload.chatlink).toBe("DQYfHSkb");
    expect(r.preload.mode).toBe("wvw");
    expect(r.preload.equipment.buff.food).toBe(534);
  });
  it("tolerates a bare `undefined` value inside preload", () => {
    const r = parsePreloadFromHtml(makeHtml(`{ chatlink: "X", mode: "pve", note: undefined, equipment: {} }`));
    expect(r.preload.chatlink).toBe("X");
    expect(r.preload.note).toBeNull();
  });
  it("throws a clear error when preload is absent", () => {
    expect(() => parsePreloadFromHtml(`<script>new BuildEditor({ dbid: 1, showinfo: SI })</script>`))
      .toThrow(/preload/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 tests/unit/gw2skillsParse.test.js`
Expected: FAIL (cannot find module `gw2skillsParse.js`).

- [ ] **Step 3: Create `gw2skillsParse.js` with the json5 parser + moved helpers**

Create `src/main/gw2skillsParse.js`. Header + parser:

```js
"use strict";

const JSON5 = require("json5");
const { decodeChatLinkToBuild } = require("./buildChatLink.js");

// ── Page parser ──────────────────────────────────────────────────────────────
// gw2skills embeds `new BuildEditor({ ..., preload: {…} })` in the page. The
// top-level arg contains JS expressions (e.g. `showinfo: SI || undefined`) that
// only a real evaluator could handle — but `preload` itself is plain data. So we
// extract ONLY the balanced-brace `preload` sub-object and parse it with JSON5
// (unquoted keys, trailing commas). This is browser/Worker-safe (no `vm`/eval).
function _extractBalancedObject(src, fromIndex) {
  let depth = 0, start = -1;
  for (let i = fromIndex; i < src.length; i++) {
    const c = src[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

function parsePreloadFromHtml(html) {
  const dbidMatch = html.match(/dbid\s*:\s*(\d+)/);
  if (!dbidMatch) throw new Error("Could not find dbid in gw2skills page");
  const dbid = dbidMatch[1];

  const marker = "new BuildEditor(";
  const beStart = html.indexOf(marker);
  if (beStart === -1) throw new Error("Could not find BuildEditor in gw2skills page");

  const preloadKey = html.indexOf("preload", beStart);
  if (preloadKey === -1) throw new Error("No preload found in BuildEditor args");
  const colon = html.indexOf(":", preloadKey);
  const literal = colon === -1 ? null : _extractBalancedObject(html, colon + 1);
  if (!literal) throw new Error("Could not extract preload object");

  // JSON5 supports unquoted keys/trailing commas but NOT bare `undefined`.
  // gw2skills occasionally emits `key: undefined`; normalize to null before parse.
  const cleaned = literal.replace(/\bundefined\b/g, "null");
  let preload;
  try {
    preload = JSON5.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse gw2skills preload: ${err.message}`);
  }
  if (!preload || !preload.chatlink) throw new Error("No chatlink in gw2skills preload");
  return { preload, dbid };
}
```

Then **move** the pure mapping helpers from `gw2skillsImport.js` into this file, bodies unchanged: `_normalizeStatName`, `_buildStatLookup`, `_lookupUpgradeName`, `_lookupBuffName`, `_mapEquipment`, `_extractMorphSkillIds`, and any private helpers they call (everything in the current `gw2skillsImport.js` between the DB section and the exports that is NOT `httpsGet`, `_fetchDb`, or `_parsePreloadFromHtml`). Add the injected orchestration (replacing the current `parseGw2Skills` body, swapping `httpsGet`→`deps.fetchText`, `_fetchDb`→inline fetch via `deps.fetchText`, `getUpgradeCatalog(...)`→`deps.getUpgradeCatalog()`):

```js
const _dbCache = new Map();

async function parseGw2Skills(url, deps = {}) {
  const { fetchText, getUpgradeCatalog, name = null, folderId = null, gameMode } = deps;
  if (typeof fetchText !== "function") throw new Error("parseGw2Skills requires deps.fetchText");
  if (typeof getUpgradeCatalog !== "function") throw new Error("parseGw2Skills requires deps.getUpgradeCatalog");

  const normalizedUrl = url.replace(/^https?:\/\/(?:www\.)?gw2skills\.net/, "https://en.gw2skills.net");
  const { preload, dbid } = parsePreloadFromHtml(await fetchText(normalizedUrl));

  const buildGameMode = preload.mode === "wvw" ? "wvw"
    : preload.mode === "pvp" ? "pvp"
    : gameMode || "pve";

  async function fetchDb(id) {
    if (_dbCache.has(id)) return _dbCache.get(id);
    const raw = JSON.parse(await fetchText(`https://en.gw2skills.net/ajax/db/en.${id}.json`));
    _dbCache.set(id, raw);
    return raw;
  }

  const chatLink = `[&${preload.chatlink}]`;
  const [buildTemplate, db, upgradeCatalog] = await Promise.all([
    decodeChatLinkToBuild(chatLink, name, folderId, buildGameMode),
    fetchDb(dbid),
    getUpgradeCatalog(),
  ]);

  // ↓↓↓ everything after the Promise.all in the CURRENT parseGw2Skills body is
  // pure mapping — move it here verbatim (statLookup, equipment mapping, morph
  // skills, assembling and returning the build). Do not change it.
  // ... (moved verbatim) ...
}

module.exports = {
  parsePreloadFromHtml,
  parseGw2Skills,
  _buildStatLookup, _normalizeStatName, _lookupUpgradeName,
  _lookupBuffName, _mapEquipment, _extractMorphSkillIds,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/gw2skillsParse.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/gw2skillsParse.js tests/unit/gw2skillsParse.test.js
git commit -m "feat(gw2skills): extract transport-agnostic parse core with json5 parser"
```

---

## Task 2: Slim `gw2skillsImport.js` to a desktop adapter (preserve public surface)

**Files:**
- Modify: `src/main/gw2skillsImport.js`
- Test: `tests/unit/gw2skillsImport.test.js` (existing — must stay green)

**Interfaces:**
- Consumes: `gw2skillsParse.js` (`parseGw2Skills`, `parsePreloadFromHtml`, helpers).
- Produces (UNCHANGED surface): `parseGw2Skills(url, opts)`, `importGw2SkillsBuild(url, name, folderId, gameMode)`, plus test exports incl. `_parsePreloadFromHtml`.

- [ ] **Step 1: Run the existing desktop test to establish the green baseline**

Run: `npx vitest run --maxWorkers=2 tests/unit/gw2skillsImport.test.js`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Replace `gw2skillsImport.js` body with the desktop adapter**

Keep the existing `httpsGet` function (Node `https`) — it becomes the injected `fetchText`. Replace the rest:

```js
"use strict";

const https = require("https");
const core = require("./gw2skillsParse.js");

// (keep the existing httpsGet(url, redirectCount) implementation here verbatim)

async function parseGw2Skills(url, opts = {}) {
  const { getUpgradeCatalog } = require("./gw2Data"); // lazy: desktop-only dep
  return core.parseGw2Skills(url, {
    fetchText: (u) => httpsGet(u),
    getUpgradeCatalog: () => getUpgradeCatalog("en"),
    name: opts.name ?? null,
    folderId: opts.folderId ?? null,
    gameMode: opts.gameMode,
  });
}

async function importGw2SkillsBuild(url, name, folderId, gameMode) {
  return parseGw2Skills(url, { name, folderId, gameMode });
}

module.exports = {
  importGw2SkillsBuild,
  parseGw2Skills,
  // Back-compat test surface — now sourced from the core module.
  _parsePreloadFromHtml: core.parsePreloadFromHtml,
  _buildStatLookup: core._buildStatLookup,
  _normalizeStatName: core._normalizeStatName,
  _lookupUpgradeName: core._lookupUpgradeName,
  _lookupBuffName: core._lookupBuffName,
  _mapEquipment: core._mapEquipment,
  _extractMorphSkillIds: core._extractMorphSkillIds,
};
```

Note: the desktop IPC callers (`src/main/index.js:879-885`) and localApi ops (`index.js:2110`) pass `{ gameMode }` / positional args and need NO change — the adapter signature is unchanged.

- [ ] **Step 3: Run the existing desktop test to verify it still passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/gw2skillsImport.test.js`
Expected: PASS (unchanged behavior; `_parsePreloadFromHtml` now delegates to json5 core). If any assertion inspected `vm`-specific behavior, update it to the equivalent json5 expectation.

- [ ] **Step 4: Run the broader main suite touching this area**

Run: `npx vitest run --maxWorkers=2 tests/unit/gw2skillsImport.test.js tests/unit/localApi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/gw2skillsImport.js
git commit -m "refactor(gw2skills): make gw2skillsImport a thin desktop adapter over the core"
```

---

## Task 3: Add the `GET /api/gw2skills` Worker route

**Files:**
- Modify: `workers/share-shortener/src/index.js`
- Test: `tests/unit/worker-gw2skills.test.js`

**Interfaces:**
- Consumes: `parseGw2Skills` from `../../../src/main/gw2skillsParse.js`; `env.ASSETS` binding.
- Produces: `GET /api/gw2skills?url=<gw2skills editor url>` → `{ build }` (200) or `{ error }` (400/502).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/worker-gw2skills.test.js`. Import the route handler (extract it as a named export `handleGw2Skills` from the worker module) and drive it with stub deps:

```js
"use strict";
const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");

function stubEnv(upgrades) {
  return { ASSETS: { fetch: async () => new Response(JSON.stringify(upgrades)) } };
}

describe("handleGw2Skills", () => {
  it("rejects a non-gw2skills url with 400", async () => {
    const res = await handleGw2Skills("https://evil.example/x", stubEnv({}), { fetchText: async () => "" });
    expect(res.status).toBe(400);
  });
  it("returns a build for a valid gw2skills url", async () => {
    const html = `new BuildEditor({ dbid: 1, showinfo: SI, preload: { chatlink: "DQYfHSkb", mode: "pve", equipment: {} } })`;
    const fetchText = async (u) =>
      u.includes("/ajax/db/") ? JSON.stringify({ upgrade: { desc: [], rows: [] } }) : html;
    const res = await handleGw2Skills(
      "https://en.gw2skills.net/editor/?abc",
      stubEnv({ /* upgrade catalog shape */ }),
      { fetchText }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.build).toBeTruthy();
    expect(body.build.profession).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 tests/unit/worker-gw2skills.test.js`
Expected: FAIL (module `gw2skills-route.js` not found).

- [ ] **Step 3: Create the route module and wire it into the worker**

Create `workers/share-shortener/src/gw2skills-route.js`:

```js
import { parseGw2Skills } from "../../../src/main/gw2skillsParse.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const GW2SKILLS_RE = /^https?:\/\/(?:[a-z]{2}\.)?gw2skills\.net\/editor\//i;

// `deps.fetchText` is injected in tests; production defaults to global fetch.
export async function handleGw2Skills(url, env, deps = {}) {
  if (!url || !GW2SKILLS_RE.test(url)) {
    return json({ error: "A gw2skills.net editor URL is required." }, 400);
  }
  const fetchText =
    deps.fetchText ||
    (async (u) => {
      const r = await fetch(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AxiForge/1.0)",
          Referer: "https://en.gw2skills.net/",
          Accept: "text/html,application/json,*/*",
        },
      });
      if (!r.ok) throw new Error(`gw2skills responded ${r.status}`);
      return r.text();
    });
  // Baked catalog is served from the SPA's own assets (same shape as desktop
  // getUpgradeCatalog("en") — produced by scripts/bake-catalogs.mjs).
  const getUpgradeCatalog = async () => {
    const assetUrl = new URL("/catalogs/upgrades.json", "https://build.axi.link");
    const r = await env.ASSETS.fetch(new Request(assetUrl));
    if (!r.ok) throw new Error("upgrade catalog unavailable");
    return r.json();
  };
  try {
    const build = await parseGw2Skills(url, { fetchText, getUpgradeCatalog });
    return json({ build });
  } catch (err) {
    const msg = String(err && err.message || err);
    const upstream = /responded \d+|fetch|network/i.test(msg);
    return json({ error: upstream ? "gw2skills.net could not be reached." : "Couldn't read that gw2skills build." }, upstream ? 502 : 400);
  }
}
```

Wire it into `workers/share-shortener/src/index.js` — add near the other route checks in `fetch()`:

```js
if (pathname === "/api/gw2skills") {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
  const { handleGw2Skills } = await import("./gw2skills-route.js");
  return handleGw2Skills(url.searchParams.get("url") || "", env);
}
```

No `wrangler.jsonc` change needed: `/api/*` is already in `run_worker_first` and routed to the Worker.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/worker-gw2skills.test.js`
Expected: PASS. (`Response`/`Request` are provided by the vitest/undici global environment; if the file is node-CJS, add `const { Response, Request } = require("undici")` at the top of the test.)

- [ ] **Step 5: Verify the Worker still builds (bundle sanity)**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wf-gw2skills-check`
Expected: builds without error (confirms `gw2skillsParse.js` + `json5` + `buildChatLink.js`/`gw2buildlink` bundle cleanly under `nodejs_compat`; the desktop `gw2Data` tree is NOT pulled in). If `gw2buildlink`'s dynamic import fails to bundle, add it to a `no_bundle`/external list or import it statically in `buildChatLink.js`; record the fix here.

- [ ] **Step 6: Commit**

```bash
git add workers/share-shortener/src/gw2skills-route.js workers/share-shortener/src/index.js tests/unit/worker-gw2skills.test.js
git commit -m "feat(worker): add GET /api/gw2skills route for web gw2skills import"
```

---

## Task 4: Implement `importGw2Skills` in the web share API

**Files:**
- Modify: `src/web/webApi/share.js`
- Test: `tests/unit/web/share-import-gw2skills.test.js`

**Interfaces:**
- Consumes: `GET /api/gw2skills` (Task 3).
- Produces: `share.importGw2Skills(url, name, folderId, gameMode) => Promise<build>` (throws with a clear message on failure). `createShareApi(deps)` gains `deps.gw2skillsEndpoint` (default `/api/gw2skills`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/share-import-gw2skills.test.js`:

```js
import { describe, it, expect } from "vitest";
import { createShareApi } from "../../../src/web/webApi/share.js";

function fakeFetch(response) {
  return async () => ({ ok: response.ok ?? true, json: async () => response.body, status: response.status ?? 200 });
}

describe("share.importGw2Skills", () => {
  it("returns the build from the worker, applying name/gameMode", async () => {
    const build = { profession: "Guardian", title: "x" };
    const share = createShareApi({ fetch: fakeFetch({ body: { build } }) });
    const out = await share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "wvw");
    expect(out.profession).toBe("Guardian");
    expect(out.name).toBe("My Build");
    expect(out.gameMode).toBe("wvw");
  });
  it("throws a clear error when the worker returns an error", async () => {
    const share = createShareApi({ fetch: fakeFetch({ ok: false, status: 502, body: { error: "gw2skills.net could not be reached." } }) });
    await expect(share.importGw2Skills("https://en.gw2skills.net/editor/?abc")).rejects.toThrow(/gw2skills/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/share-import-gw2skills.test.js`
Expected: FAIL (current `importGw2Skills` always throws "not available").

- [ ] **Step 3: Implement the method**

In `src/web/webApi/share.js`, add `const gw2skillsEndpoint = deps.gw2skillsEndpoint || "/api/gw2skills";` alongside the other endpoint defaults, and replace the `importGw2Skills` stub in the returned object:

```js
importGw2Skills: async (url, name, folderId, gameMode) => {
  if (!fetchImpl) throw new Error("Importing from gw2skills.net is not available here.");
  let res;
  try {
    res = await fetchImpl(`${gw2skillsEndpoint}?url=${encodeURIComponent(url)}`);
  } catch {
    throw new Error("gw2skills import is unavailable right now.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !data || !data.build) {
    throw new Error((data && data.error) || "Couldn't import that gw2skills build.");
  }
  const build = data.build;
  return {
    ...build,
    name: name || build.name || build.title,
    folderId: folderId ?? null,
    gameMode: gameMode || build.gameMode || "pve",
  };
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/share-import-gw2skills.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/webApi/share.js tests/unit/web/share-import-gw2skills.test.js
git commit -m "feat(web): wire gw2skills import to the worker route"
```

---

## Task 5: Web branch for gw2skills import in the renderer (load into editor)

**Files:**
- Modify: `src/renderer/modules/library/library.js` (`handleImportGw2Skills`, ~line 593)

**Interfaces:**
- Consumes: `window.desktopApi.importGw2Skills` (now real on web), `_app.loadBuildIntoEditor`, `_app.navigateToPage` (already used at library.js:285-286).

- [ ] **Step 1: Add the web branch (manual verification — DOM/app-shell wiring)**

In `handleImportGw2Skills`, after obtaining the build and before the desktop library-save flow, insert the web branch:

```js
const gameMode = state.editor?.gameMode || "pve";
const build = await window.desktopApi.importGw2Skills(result.url, result.name, folderId, gameMode);
if (window.__AXIFORGE_WEB__) {
  _app.loadBuildIntoEditor?.(build);
  _app.navigateToPage?.("editor");
  showToast(`"${build.title || build.name || "Build"}" loaded`);
  return;
}
// desktop path unchanged:
await addImportedBuildToActiveComp(build);
...
```

(Rename the existing `saved` local to `build`, or keep `saved` and use it — just ensure the web branch runs before any `saveBuild`/`listBuilds`/`renderLibrary` calls.)

- [ ] **Step 2: Verify desktop unit tests unaffected**

Run: `npx vitest run --maxWorkers=2 tests/unit/renderer`
Expected: PASS (no desktop behavior change; web branch is gated by `__AXIFORGE_WEB__`).

- [ ] **Step 3: Manual web smoke test**

Run: `npm run dev:web` (or the project's web dev script), open the playground, use the toolbar import → gw2skills, paste a real `https://en.gw2skills.net/editor/?...` URL. Expected: the build loads into the editor. (Requires the Worker route reachable — for pure local, run `npx wrangler dev` and point `gw2skillsEndpoint` at it, or test against a deployed preview.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat(web): load gw2skills import into the editor instead of the library"
```

---

## Task 6: Browser `zlib` shim (pako) for `.axicode` decode

**Files:**
- Create: `src/web/shims/zlib.js`
- Modify: `src/web/vite.config.js`
- Test: `tests/unit/web/zlib-shim.test.js`

**Interfaces:**
- Produces: `gzipSync(buf) => Buffer`, `gunzipSync(buf) => Buffer` (matching the subset `@axiapps/code/fileCodec.js` uses).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/zlib-shim.test.js`:

```js
import { describe, it, expect } from "vitest";
import { gzipSync, gunzipSync } from "../../../src/web/shims/zlib.js";

describe("web zlib shim", () => {
  it("round-trips through gzip/gunzip", () => {
    const original = Buffer.from(JSON.stringify({ hello: "world", n: 42 }), "utf-8");
    const out = gunzipSync(gzipSync(original));
    expect(out.toString("utf-8")).toBe(original.toString("utf-8"));
  });
  it("gunzips real node-zlib output", () => {
    const zlib = require("zlib");
    const gz = zlib.gzipSync(Buffer.from("axicode-payload"));
    expect(gunzipSync(gz).toString("utf-8")).toBe("axicode-payload");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/zlib-shim.test.js`
Expected: FAIL (shim not found).

- [ ] **Step 3: Implement the shim + alias**

Create `src/web/shims/zlib.js`:

```js
// Browser stand-in for the tiny subset of node:zlib that @axiapps/code/fileCodec
// uses (gzipSync/gunzipSync). Backed by pako. Returns Buffer (Buffer is polyfilled
// in the web entry, see src/web/main-web.js).
import { gzip, ungzip } from "pako";

export function gzipSync(buf) {
  return Buffer.from(gzip(buf instanceof Uint8Array ? buf : Buffer.from(buf)));
}
export function gunzipSync(buf) {
  return Buffer.from(ungzip(buf instanceof Uint8Array ? buf : Buffer.from(buf)));
}
export default { gzipSync, gunzipSync };
```

In `src/web/vite.config.js`, add a `resolve.alias` so the browser bundle maps `zlib` to the shim (add a top-level `resolve` key in the config object):

```js
resolve: {
  alias: {
    zlib: path.resolve(repoRoot, "src/web/shims/zlib.js"),
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/zlib-shim.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/shims/zlib.js src/web/vite.config.js tests/unit/web/zlib-shim.test.js
git commit -m "feat(web): pako-backed zlib shim so the browser can decode .axicode"
```

---

## Task 7: Web `.axicode` decode API + file input

**Files:**
- Create: `src/web/webApi/axicode.js`
- Modify: `src/web/webApi/index.js`
- Test: `tests/unit/web/axicode-import.test.js`

**Interfaces:**
- Consumes: `decodeAxicodeFile` from `@axiapps/code`.
- Produces:
  - `decodeAxicodeBuffer(buffer) => { builds: object[] }` (pure, testable)
  - `importAxicodeFile() => Promise<{ cancelled?: true, builds?: object[], error?: string }>` (opens a browser file picker)
  - `createAxicodeApi() => { importAxicodeFile }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web/axicode-import.test.js`:

```js
import { describe, it, expect } from "vitest";
import { encodeAxicodeFile } from "@axiapps/code";
import { decodeAxicodeBuffer } from "../../../src/web/webApi/axicode.js";

describe("decodeAxicodeBuffer", () => {
  it("returns the builds from a valid .axicode buffer", () => {
    const builds = [{ id: "a", title: "Alpha", profession: "Guardian" }, { id: "b", title: "Bravo", profession: "Warrior" }];
    const buffer = encodeAxicodeFile({ builds, folders: [], comps: [] });
    const out = decodeAxicodeBuffer(buffer);
    expect(out.builds.map((b) => b.title)).toEqual(["Alpha", "Bravo"]);
  });
  it("throws a clear error on a non-axicode buffer", () => {
    expect(() => decodeAxicodeBuffer(Buffer.from("not gzip"))).toThrow(/axicode/i);
  });
});
```

(Confirm the exact `encodeAxicodeFile` input shape against `packages/axicode/tests/fileCodec.test.js` and match it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/axicode-import.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `axicode.js` and wire it**

Create `src/web/webApi/axicode.js`:

```js
// .axicode import for the web playground: decode with the pure @axiapps/code
// codec (zlib is aliased to a pako shim in the browser build) behind a browser
// file input. Web has no library, so we only surface builds; the caller loads
// one into the editor.
import { decodeAxicodeFile } from "@axiapps/code";

export function decodeAxicodeBuffer(buffer) {
  const data = decodeAxicodeFile(buffer); // throws "Not a valid .axicode file: ..." on bad input
  const builds = Array.isArray(data?.builds) ? data.builds : [];
  return { builds };
}

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".axicode";
    input.style.display = "none";
    // 'cancel' fires when the picker is dismissed (supported in modern browsers).
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.remove();
      resolve(file || null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function createAxicodeApi({ pick = pickFile } = {}) {
  return {
    importAxicodeFile: async () => {
      const file = await pick();
      if (!file) return { cancelled: true };
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        return decodeAxicodeBuffer(buffer);
      } catch (err) {
        return { error: err && err.message ? err.message : "Could not read that .axicode file." };
      }
    },
  };
}
```

In `src/web/webApi/index.js`, import and spread it AFTER `stubs` so it overrides the stub:

```js
import { createAxicodeApi } from "./axicode.js";
// ...
const axicode = createAxicodeApi();
return { ...stubs, ...catalog, ...draft, ...share, ...settings, ...system, ...axicode };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --maxWorkers=2 tests/unit/web/axicode-import.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/webApi/axicode.js src/web/webApi/index.js tests/unit/web/axicode-import.test.js
git commit -m "feat(web): .axicode decode API behind a browser file input"
```

---

## Task 8: Web branch + build picker for `.axicode` import in the renderer

**Files:**
- Modify: `src/renderer/modules/library/library.js` (`handleImportAxicodeFile` ~line 659; add `showAxicodeBuildPickerModal`)

**Interfaces:**
- Consumes: `window.desktopApi.importAxicodeFile()` (returns `{ cancelled?, builds?, error? }` on web), `_app.loadBuildIntoEditor`, `_app.navigateToPage`.
- Produces: `showAxicodeBuildPickerModal(builds) => Promise<build|null>`.

- [ ] **Step 1: Add the web branch in `handleImportAxicodeFile`**

```js
async function handleImportAxicodeFile(targetFolderId) {
  if (window.__AXIFORGE_WEB__) {
    const result = await window.desktopApi.importAxicodeFile();
    if (!result || result.cancelled) return;
    if (result.error) { showToast(result.error, "error"); return; }
    const builds = result.builds || [];
    if (builds.length === 0) { showToast("No builds found in that file.", "error"); return; }
    const chosen = builds.length === 1 ? builds[0] : await showAxicodeBuildPickerModal(builds);
    if (!chosen) return;
    _app.loadBuildIntoEditor?.(chosen);
    _app.navigateToPage?.("editor");
    showToast(`"${chosen.title || chosen.name || "Build"}" loaded`);
    return;
  }
  // desktop path unchanged:
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  await handleAxicodeImport(folderId, renderLibrary, showToast);
}
```

- [ ] **Step 2: Add `showAxicodeBuildPickerModal`**

Add a small modal following the existing modal patterns in this file (mirror the structure/markup of `showGw2SkillsImportModal` around line 1604 — same overlay classes, close/escape handling). It renders a list of `builds` by `title` (fallback `name`/"Untitled") and resolves the chosen build object, or `null` on cancel:

```js
function showAxicodeBuildPickerModal(builds) {
  return new Promise((resolve) => {
    // Build an overlay with one button per build (data-index), a Cancel button,
    // Escape-to-cancel, and backdrop-click-to-cancel — matching the markup and
    // teardown of showGw2SkillsImportModal. On a build click: resolve(builds[i]).
    // On cancel/escape/backdrop: resolve(null). (Implement using the same DOM
    // helpers the neighboring modals use; do not introduce a new modal system.)
  });
}
```

(Implement the modal body concretely against the sibling modal in this file — reuse its overlay element, class names, and cleanup so styling and a11y match.)

- [ ] **Step 3: Verify desktop renderer tests unaffected**

Run: `npx vitest run --maxWorkers=2 tests/unit/renderer`
Expected: PASS (web branch gated by `__AXIFORGE_WEB__`; desktop still routes to `handleAxicodeImport`).

- [ ] **Step 4: Manual web smoke test**

Run the web dev server, export a `.axicode` from desktop (single build and a multi-build file), then import each in the playground. Expected: single-build loads directly; multi-build shows the picker; chosen build loads into the editor.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat(web): load .axicode import into the editor with a multi-build picker"
```

---

## Task 9: Full build + suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (all existing + new tests).

- [ ] **Step 2: Build the web bundle**

Run: `npm run build:web` (the project's Vite web build; confirm the exact script in `package.json`).
Expected: builds cleanly — confirms the `zlib`→pako alias resolves and `@axiapps/code`'s file codec bundles for the browser.

- [ ] **Step 3: Worker dry-run deploy**

Run: `npx wrangler deploy --dry-run --outdir /tmp/wf-final-check`
Expected: builds cleanly (gw2skills route bundles).

- [ ] **Step 4: Lint**

Run: the project's lint script (e.g. `npm run lint`).
Expected: no new errors in touched files.

- [ ] **Step 5: Final commit (if lint auto-fixed anything)**

```bash
git add -A
git commit -m "chore: lint + verification for web import parity"
```

---

## Self-Review

**Spec coverage:**
- gw2skills URL import on web → Tasks 1-5. ✓
- Worker route owning all gw2skills network access (no CORS) → Task 3. ✓
- `vm`→safe parser → Task 1 (json5 on the `preload` sub-object). ✓
- `.axicode` file import on web → Tasks 6-8. ✓
- Load into current editor, no library/folders/comps → Tasks 5, 8 (`__AXIFORGE_WEB__` branch → `loadBuildIntoEditor`). ✓
- Multi-build `.axicode` picker → Task 8. ✓
- Desktop behavior unchanged / existing tests green → Task 2 (preserved surface), Steps re-running `gw2skillsImport.test.js`. ✓
- Error handling (bad URL, upstream failure, parse failure, worker down, bad file, empty decode) → Tasks 3 (route errors), 4 (web throw), 7 (decode error), 8 (empty/error toasts). ✓

**Placeholder scan:** The only non-verbatim spots are deliberate mechanical moves (Task 1: move the unchanged mapping helpers/tail of `parseGw2Skills`) and Task 8's modal body (must mirror the concrete sibling modal in the same file). Both name exactly what to copy and from where. No `TODO`/`TBD`/"add error handling" left abstract.

**Type consistency:** `parseGw2Skills(url, deps)` core signature (Task 1) is consumed with matching keys by the desktop adapter (Task 2) and the Worker route (Task 3). `importGw2Skills(url, name, folderId, gameMode)` matches the renderer call site (Task 5) and the existing desktop signature. `importAxicodeFile()` return shape `{ cancelled?, builds?, error? }` (Task 7) matches the renderer consumer (Task 8). `decodeAxicodeBuffer(buffer) => { builds }` consistent across Tasks 7 and its test.
