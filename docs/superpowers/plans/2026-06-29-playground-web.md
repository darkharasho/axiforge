# AxiForge Playground (build.axi.link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a zero-backend web playground at build.axi.link where anyone can build a single GW2 build in the existing AxiForge editor and share it via URL or in-game chat code.

**Architecture:** The vanilla-JS renderer (`src/renderer`) talks to Electron only through the global `window.desktopApi`. A new web entry installs a browser implementation of that seam (baked catalog JSON, localStorage draft, share-code/chatlink, desktop-only stubs) **before** the renderer boots, so the exact same editor UI is reused unchanged. Built as a static SPA and deployed to Cloudflare.

**Tech Stack:** Vite 7, vanilla ESM, `@axiapps/code` (share codes), `gw2buildlink` (chat links), `@axiapps/gw2-data` (catalog builder, Node-side only at bake time), Jest, Playwright, Wrangler.

## Global Constraints

- **No backend, no auth, no network for app data.** All build data lives in `localStorage` + `location.hash`. The only runtime network calls allowed are: fetching baked catalog JSON from same-origin, and `gw2buildlink`'s GW2 API calls (`api.guildwars2.com`, CORS-enabled) for chat-link generation.
- **Never edit the renderer monolith to special-case web** beyond setting/reading a single flag. Hide desktop-only UI with a body class + CSS, not by forking renderer modules.
- **The web `desktopApi` must expose every method the renderer calls** (see the 88-method list) and **never throw** from a desktop-only stub — return a safe empty/no-op value.
- **Single source of truth for body markup:** generate the web HTML from `src/renderer/index.html` at build time; do not hand-maintain a copy.
- **Domain:** `build.axi.link` (custom domain on Cloudflare, like `roster.axi.link`).
- **Catalog game modes to bake:** `pve`, `wvw`, `pvp`.
- Reuse the existing Jest config (`tests/**/*.test.js`) and the existing `tests/spa` Playwright harness.
- Run Jest with `--maxWorkers=2`. Run vitest-style limits do not apply (this repo uses Jest).

---

## File Structure

**Create:**
- `src/web/main-web.js` — installs `window.desktopApi` + web flag, then imports the renderer.
- `src/web/webApi/index.js` — assembles the full desktopApi surface.
- `src/web/webApi/catalog.js` — catalog/profession/upgrade data from baked JSON, memoized.
- `src/web/webApi/draft.js` — single transient build in localStorage.
- `src/web/webApi/share.js` — share-code encode/decode, chat link, URL-hash sync.
- `src/web/webApi/settings.js` — getSetting/setSetting over localStorage.
- `src/web/webApi/system.js` — clipboard + openExternal.
- `src/web/webApi/stubs.js` — desktop-only safe no-ops.
- `src/web/chrome.js` — web top bar (Copy share link / Copy chat code / Get the desktop app) + hash-load wiring.
- `src/web/web.css` — `.is-web` rules hiding desktop-only UI + top-bar styling.
- `src/web/vite.config.js` — web build config.
- `scripts/gen-web-html.mjs` — derive web HTML from renderer HTML.
- `scripts/bake-catalogs.mjs` — generate static catalog JSON.
- `wrangler.jsonc` — static SPA deploy config.
- Tests: `tests/web/catalog.test.js`, `tests/web/draft.test.js`, `tests/web/share.test.js`, `tests/web/stubs.test.js`, `tests/spa/specs/playground.spec.js`.

**Modify:**
- `package.json` — add `dev:web`, `build:web`, `deploy:web`, `bake:catalogs` scripts + `wrangler` devDep; exclude baked catalogs from the electron build.
- `.gitignore` — ignore generated `src/web/public/catalogs/` and `src/web/index.generated.html`.

---

## Task 1: Web build scaffold — boot the renderer in a browser with a stub seam

**Files:**
- Create: `src/web/main-web.js`, `src/web/vite.config.js`, `scripts/gen-web-html.mjs`
- Modify: `package.json` (scripts + devDep), `.gitignore`

**Interfaces:**
- Produces: `window.desktopApi` (temporary minimal stub here, replaced in Task 8); `window.__AXIFORGE_WEB__ = true`; a working `npm run dev:web` that serves the editor shell in a browser.

- [ ] **Step 1: Add the HTML generator**

`scripts/gen-web-html.mjs`:
```js
// Derives the web entry HTML from the desktop renderer HTML so body markup stays
// single-source. Swaps the renderer.js module script for the web entry, retitles,
// and drops the Electron-only no-op. Output is git-ignored and regenerated each build.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcHtml = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");

let out = srcHtml
  .replace("<title>AxiForge Desktop</title>", "<title>AxiForge Playground</title>")
  .replace(
    '<script type="module" src="./renderer.js"></script>',
    '<script type="module" src="../web/main-web.js"></script>'
  );

// Sanity guard: fail loudly if the renderer script tag moves/renames.
if (!out.includes('src="../web/main-web.js"')) {
  throw new Error("gen-web-html: renderer.js script tag not found — update the replace target.");
}

writeFileSync(resolve(root, "src/renderer/index.generated.html"), out);
console.log("gen-web-html: wrote src/renderer/index.generated.html");
```

- [ ] **Step 2: Add the web entry (temporary stub seam)**

`src/web/main-web.js`:
```js
// Web entry. Installs a browser desktopApi BEFORE importing the renderer, which
// self-runs init() on import. This file's seam is replaced by the real one in Task 8.
window.__AXIFORGE_WEB__ = true;
window.desktopApi = new Proxy(
  {},
  {
    get() {
      // Until Task 8, every call resolves to a harmless empty value so the
      // renderer can boot without throwing.
      return async () => undefined;
    },
  }
);

await import("../renderer/renderer.js");
```

- [ ] **Step 3: Add the web Vite config**

`src/web/vite.config.js`:
```js
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// Root is the renderer dir so relative asset paths (./styles.css, ./svg, ./modules)
// resolve exactly as in the desktop build. The HTML input is the generated web entry.
export default defineConfig({
  root: path.resolve(repoRoot, "src/renderer"),
  base: "./",
  publicDir: path.resolve(repoRoot, "src/web/public"),
  optimizeDeps: {
    include: ["sortablejs", "@axiapps/gw2-data/engine"],
    exclude: ["@axiapps/gw2-data"],
  },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: path.resolve(repoRoot, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repoRoot, "src/renderer/index.generated.html"),
    },
    commonjsOptions: { include: [/packages\/gw2-data/, /node_modules/] },
  },
});
```

- [ ] **Step 4: Seed the web public dir with the renderer's static assets**

The web build needs the renderer's `svg/`, `img/`, fonts referenced by `./svg/...`. Copy the renderer's public assets so the web `publicDir` has them:
```bash
mkdir -p src/web/public
cp -r public/svg src/web/public/svg
cp -r public/img src/web/public/img
cp public/favicon.png src/web/public/favicon.png
```
(These are committed; baked catalogs added later are git-ignored.)

- [ ] **Step 5: Wire package.json scripts and .gitignore**

Add to `package.json` `scripts`:
```json
"gen:web-html": "node scripts/gen-web-html.mjs",
"dev:web": "npm run gen:web-html && vite --config src/web/vite.config.js",
"build:web": "npm run bake:catalogs && npm run gen:web-html && vite build --config src/web/vite.config.js"
```
Add to `.gitignore`:
```
src/renderer/index.generated.html
src/web/public/catalogs/
```

- [ ] **Step 6: Run the dev server and verify boot**

Run: `npm run dev:web` then open `http://localhost:5180`.
Expected: the editor shell renders (titlebar, editor panels). Console may log benign warnings from the stub seam, but no uncaught exception that blanks the page. The profession picker will be empty (catalogs come in Task 3).

- [ ] **Step 7: Commit**
```bash
git add src/web/main-web.js src/web/vite.config.js src/web/public scripts/gen-web-html.mjs package.json .gitignore
git commit -m "feat(web): scaffold playground web build that boots the renderer with a stub seam"
```

---

## Task 2: Bake catalogs script

**Files:**
- Create: `scripts/bake-catalogs.mjs`
- Modify: `package.json` (`bake:catalogs` script; exclude catalogs from electron build)
- Test: `tests/web/bake-smoke.test.js`

**Interfaces:**
- Produces static files under `src/web/public/catalogs/`:
  - `professions.json` — `Array<{id, name, icon, iconBig}>` (output of `getProfessionList`)
  - `upgrades.json` — output of `getUpgradeCatalog("en")`
  - `<professionId>-<gameMode>.json` — output of `getProfessionCatalog(id, "en", mode)` for each profession × `["pve","wvw","pvp"]`

- [ ] **Step 1: Write the bake script**

`scripts/bake-catalogs.mjs`:
```js
// Generates static GW2 catalog JSON for the web playground by running the existing
// Node catalog builder (src/main/gw2Data), where the wiki client + disk cache work.
// Run at web build time; output is git-ignored and served as static assets.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outDir = resolve(repoRoot, "src/web/public/catalogs");
const GAME_MODES = ["pve", "wvw", "pvp"];

const {
  getProfessionList,
  getProfessionCatalog,
  getUpgradeCatalog,
  initDiskCache,
  initWikiClient,
} = require(resolve(repoRoot, "src/main/gw2Data"));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const cacheDir = mkdtempSync(join(tmpdir(), "axiforge-bake-"));
  await initDiskCache(cacheDir);
  initWikiClient(cacheDir);

  const professions = await getProfessionList("en");
  writeFileSync(join(outDir, "professions.json"), JSON.stringify(professions));
  console.log(`baked professions.json (${professions.length})`);

  const upgrades = await getUpgradeCatalog("en");
  writeFileSync(join(outDir, "upgrades.json"), JSON.stringify(upgrades));
  console.log("baked upgrades.json");

  for (const prof of professions) {
    for (const mode of GAME_MODES) {
      const cat = await getProfessionCatalog(prof.id, "en", mode);
      writeFileSync(join(outDir, `${prof.id}-${mode}.json`), JSON.stringify(cat));
      console.log(`baked ${prof.id}-${mode}.json`);
    }
  }
  console.log("bake-catalogs: done");
}

main().catch((err) => {
  console.error("bake-catalogs failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script + electron exclusion to package.json**

Add to `scripts`: `"bake:catalogs": "node scripts/bake-catalogs.mjs"`.
In `build.files`, append an exclusion so the desktop package never ships web catalogs:
```json
"!src/web/public/catalogs/**"
```
(Add it to the existing `files` array.)

- [ ] **Step 3: Run the bake**

Run: `npm run bake:catalogs`
Expected: `src/web/public/catalogs/` fills with `professions.json`, `upgrades.json`, and `<prof>-<mode>.json` for all 9 professions × 3 modes (27 + 2 files). Console ends with `bake-catalogs: done`.

- [ ] **Step 4: Write a smoke test**

`tests/web/bake-smoke.test.js`:
```js
const fs = require("node:fs");
const path = require("node:path");

const catalogsDir = path.resolve(__dirname, "../../src/web/public/catalogs");
const EXPECTED_PROFESSIONS = 9;

const describeIfBaked = fs.existsSync(catalogsDir) ? describe : describe.skip;

describeIfBaked("baked catalogs", () => {
  test("professions.json lists all professions", () => {
    const profs = JSON.parse(fs.readFileSync(path.join(catalogsDir, "professions.json"), "utf8"));
    expect(Array.isArray(profs)).toBe(true);
    expect(profs.length).toBe(EXPECTED_PROFESSIONS);
    for (const p of profs) expect(typeof p.id).toBe("string");
  });

  test("every profession has a pve catalog that parses", () => {
    const profs = JSON.parse(fs.readFileSync(path.join(catalogsDir, "professions.json"), "utf8"));
    for (const p of profs) {
      const file = path.join(catalogsDir, `${p.id}-pve.json`);
      expect(fs.existsSync(file)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
    }
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npx jest tests/web/bake-smoke.test.js --maxWorkers=2`
Expected: PASS (the suite runs because catalogs exist from Step 3).

- [ ] **Step 6: Commit**
```bash
git add scripts/bake-catalogs.mjs tests/web/bake-smoke.test.js package.json
git commit -m "feat(web): bake static GW2 catalogs for the playground"
```

---

## Task 3: webApi/catalog.js — serve baked catalogs

**Files:**
- Create: `src/web/webApi/catalog.js`
- Test: `tests/web/catalog.test.js`

**Interfaces:**
- Consumes: baked JSON at `./catalogs/*.json` (relative to the deployed page).
- Produces: `createCatalogApi({ fetchImpl }) → { listProfessions, getProfessionCatalog, getUpgradeCatalog, clearGw2Cache }` where:
  - `listProfessions(): Promise<Array<{id,name,icon,iconBig}>>`
  - `getProfessionCatalog(professionId, gameMode="pve"): Promise<object>`
  - `getUpgradeCatalog(): Promise<object>`
  - `clearGw2Cache(): Promise<void>` (clears the in-memory memo)

  Note the **web signature drops the `lang` arg** the desktop uses; preload's web seam maps `getProfessionCatalog(professionId, gameMode)` directly.

- [ ] **Step 1: Write the failing test**

`tests/web/catalog.test.js`:
```js
const { createCatalogApi } = require("../../src/web/webApi/catalog.js");

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

test("getProfessionCatalog fetches the right file and memoizes", async () => {
  let calls = 0;
  const base = fakeFetch({ "catalogs/guardian-wvw.json": { ok: true } });
  const fetchImpl = async (u) => { calls++; return base(u); };
  const api = createCatalogApi({ fetchImpl });

  const a = await api.getProfessionCatalog("guardian", "wvw");
  const b = await api.getProfessionCatalog("guardian", "wvw");
  expect(a).toEqual({ ok: true });
  expect(b).toEqual({ ok: true });
  expect(calls).toBe(1); // memoized
});

test("getProfessionCatalog defaults to pve", async () => {
  const api = createCatalogApi({ fetchImpl: fakeFetch({ "catalogs/ranger-pve.json": { mode: "pve" } }) });
  expect(await api.getProfessionCatalog("ranger")).toEqual({ mode: "pve" });
});

test("listProfessions and getUpgradeCatalog read their files", async () => {
  const api = createCatalogApi({
    fetchImpl: fakeFetch({ "catalogs/professions.json": [{ id: "guardian" }], "catalogs/upgrades.json": { runes: [] } }),
  });
  expect(await api.listProfessions()).toEqual([{ id: "guardian" }]);
  expect(await api.getUpgradeCatalog()).toEqual({ runes: [] });
});

test("a missing catalog rejects with a clear error", async () => {
  const api = createCatalogApi({ fetchImpl: fakeFetch({}) });
  await expect(api.getProfessionCatalog("guardian")).rejects.toThrow(/catalog/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/web/catalog.test.js --maxWorkers=2`
Expected: FAIL with "Cannot find module '../../src/web/webApi/catalog.js'".

- [ ] **Step 3: Write the implementation**

`src/web/webApi/catalog.js`:
```js
// Serves the playground's GW2 data from baked static JSON (see scripts/bake-catalogs.mjs).
// No runtime GW2/wiki calls. Results are memoized in memory for the session.
function createCatalogApi({ fetchImpl = globalThis.fetch.bind(globalThis), base = "./catalogs" } = {}) {
  const memo = new Map();

  async function loadJson(file) {
    if (memo.has(file)) return memo.get(file);
    const promise = (async () => {
      const res = await fetchImpl(`${base}/${file}`);
      if (!res.ok) throw new Error(`Failed to load catalog "${file}" (${res.status}).`);
      return res.json();
    })();
    memo.set(file, promise);
    try {
      return await promise;
    } catch (err) {
      memo.delete(file); // allow retry after a transient failure
      throw err;
    }
  }

  return {
    listProfessions: () => loadJson("professions.json"),
    getUpgradeCatalog: () => loadJson("upgrades.json"),
    getProfessionCatalog: (professionId, gameMode = "pve") =>
      loadJson(`${professionId}-${gameMode}.json`),
    clearGw2Cache: async () => { memo.clear(); },
  };
}

module.exports = { createCatalogApi };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/web/catalog.test.js --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/catalog.js tests/web/catalog.test.js
git commit -m "feat(web): catalog api backed by baked static JSON"
```

---

## Task 4: webApi/draft.js — single transient build in localStorage

**Files:**
- Create: `src/web/webApi/draft.js`
- Test: `tests/web/draft.test.js`

**Interfaces:**
- Produces: `createDraftApi({ storage }) → { listBuilds, saveBuild, deleteBuild, getBuildHistory, listFolders, listComps, saveFolder, deleteFolder, reorderFolders, saveComp, deleteComp, listCompWebhooks }` — the persistence subset. Single-build semantics:
  - `listBuilds(): Promise<Build[]>` → `[draft]` if a draft exists, else `[]`
  - `saveBuild(build): Promise<Build>` → persists `build` as the sole draft under key `axiforge.web.draft`, returns it (assigning `id: "web-draft"` if missing)
  - `deleteBuild(id): Promise<void>` → clears the draft
  - everything else returns empty arrays / the input echoed (single-build scope has no folders/comps/history)
- `storage` is a `Storage`-like object (`getItem`/`setItem`/`removeItem`); defaults to `window.localStorage`.

- [ ] **Step 1: Write the failing test**

`tests/web/draft.test.js`:
```js
const { createDraftApi } = require("../../src/web/webApi/draft.js");

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test("listBuilds is empty before any save", async () => {
  const api = createDraftApi({ storage: memStorage() });
  expect(await api.listBuilds()).toEqual([]);
});

test("saveBuild persists a single draft, assigns id, and round-trips", async () => {
  const storage = memStorage();
  const api = createDraftApi({ storage });
  const saved = await api.saveBuild({ name: "Test", profession: "guardian" });
  expect(saved.id).toBe("web-draft");

  const api2 = createDraftApi({ storage }); // fresh instance, same storage
  const builds = await api2.listBuilds();
  expect(builds).toHaveLength(1);
  expect(builds[0].name).toBe("Test");
});

test("saveBuild overwrites — only ever one draft", async () => {
  const api = createDraftApi({ storage: memStorage() });
  await api.saveBuild({ name: "A", profession: "guardian" });
  await api.saveBuild({ name: "B", profession: "ranger" });
  const builds = await api.listBuilds();
  expect(builds).toHaveLength(1);
  expect(builds[0].name).toBe("B");
});

test("deleteBuild clears the draft", async () => {
  const api = createDraftApi({ storage: memStorage() });
  await api.saveBuild({ name: "A", profession: "guardian" });
  await api.deleteBuild("web-draft");
  expect(await api.listBuilds()).toEqual([]);
});

test("folders/comps/history are empty in single-build scope", async () => {
  const api = createDraftApi({ storage: memStorage() });
  expect(await api.listFolders()).toEqual([]);
  expect(await api.listComps()).toEqual([]);
  expect(await api.getBuildHistory("web-draft")).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/web/draft.test.js --maxWorkers=2`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

`src/web/webApi/draft.js`:
```js
// Single transient build persisted to localStorage. Folders/comps/history are
// empty in the playground's single-build scope; their methods exist only so the
// renderer never calls an undefined seam method.
const DRAFT_KEY = "axiforge.web.draft";
const DRAFT_ID = "web-draft";

function createDraftApi({ storage = window.localStorage } = {}) {
  function readDraft() {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return {
    listBuilds: async () => {
      const draft = readDraft();
      return draft ? [draft] : [];
    },
    saveBuild: async (build) => {
      const draft = { ...build, id: DRAFT_ID };
      storage.setItem(DRAFT_KEY, JSON.stringify(draft));
      return draft;
    },
    deleteBuild: async () => {
      storage.removeItem(DRAFT_KEY);
    },
    getBuildHistory: async () => [],
    getFolderHistory: async () => [],
    revertBuild: async () => null,
    listFolders: async () => [],
    saveFolder: async (folder) => folder,
    deleteFolder: async () => undefined,
    reorderFolders: async () => undefined,
    listComps: async () => [],
    saveComp: async (comp) => comp,
    deleteComp: async () => undefined,
    deleteComps: async () => undefined,
    reorderComps: async () => undefined,
    addTagsToComps: async () => undefined,
    removeTagsFromComps: async () => undefined,
    moveBuilds: async () => undefined,
    pinBuilds: async () => undefined,
    reorderBuilds: async () => undefined,
    listCompWebhooks: async () => [],
    listBuildWebhooks: async () => [],
  };
}

module.exports = { createDraftApi, DRAFT_KEY, DRAFT_ID };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/web/draft.test.js --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/draft.js tests/web/draft.test.js
git commit -m "feat(web): single transient build persistence over localStorage"
```

---

## Task 5: webApi/share.js — share codes, chat links, URL-hash sync

**Files:**
- Create: `src/web/webApi/share.js`
- Test: `tests/web/share.test.js`

**Interfaces:**
- Consumes: `@axiapps/code` (`encodeShareCode`, `decodeShareCode`, `isShareCode`), and `src/main/buildChatLink.js` (verified exports: `generateChatLink`, `previewChatLink`, `decodeChatLinkToBuild`, `mapBuildToTemplateInput`, `prewarmChatLinks` — note there is **no** `importChatLink` here; it lives in the main process IPC handler). `buildChatLink.js` has no top-level `electron`/`fs` require (it uses dynamic `import("gw2buildlink")`), so it is browser/Jest importable. Chat link uses `gw2buildlink` against `api.guildwars2.com` (CORS-safe).
- Produces: `createShareApi() → { encodeShareCode, decodeShareCode, isShareCode, generateChatLink, previewChatLink, importChatLink, importGw2Skills, buildToHash, hashToBuild }` where:
  - `encodeShareCode(build): Promise<string>`
  - `decodeShareCode(code): Promise<Build>`
  - `isShareCode(text): Promise<boolean>`
  - `generateChatLink(build): Promise<string>`
  - `buildToHash(build): Promise<string>` — returns the share code (for `location.hash`)
  - `hashToBuild(hash): Promise<Build|null>` — strips a leading `#`, returns the decoded build or `null` if the hash is empty/invalid

- [ ] **Step 1: Write the failing test**

`tests/web/share.test.js`:
```js
const { createShareApi } = require("../../src/web/webApi/share.js");

const BUILD = { name: "Test", profession: "guardian", gameMode: "pve", skills: {}, equipment: {} };

test("encode → decode round-trips a build", async () => {
  const api = createShareApi();
  const code = await api.encodeShareCode(BUILD);
  expect(typeof code).toBe("string");
  expect(code.length).toBeGreaterThan(0);
  const decoded = await api.decodeShareCode(code);
  expect(decoded.profession).toBe("guardian");
  expect(decoded.name).toBe("Test");
});

test("isShareCode recognizes a real code and rejects garbage", async () => {
  const api = createShareApi();
  const code = await api.encodeShareCode(BUILD);
  expect(await api.isShareCode(code)).toBe(true);
  expect(await api.isShareCode("not a code !!")).toBe(false);
});

test("buildToHash then hashToBuild round-trips (with leading #)", async () => {
  const api = createShareApi();
  const hash = await api.buildToHash(BUILD);
  const back = await api.hashToBuild("#" + hash);
  expect(back.profession).toBe("guardian");
});

test("hashToBuild returns null for empty or invalid hash", async () => {
  const api = createShareApi();
  expect(await api.hashToBuild("")).toBeNull();
  expect(await api.hashToBuild("#")).toBeNull();
  expect(await api.hashToBuild("#garbage-not-a-code")).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/web/share.test.js --maxWorkers=2`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

`src/web/webApi/share.js`:
```js
// Share + chat-link seam for the web playground. Wraps the same pure-JS encoders
// the desktop uses (@axiapps/code) and the chat-link generator (gw2buildlink via
// src/main/buildChatLink.js), plus URL-hash helpers for transient sharing.
const { encodeShareCode, decodeShareCode, isShareCode } = require("@axiapps/code");
const {
  generateChatLink,
  previewChatLink,
  decodeChatLinkToBuild,
} = require("../../main/buildChatLink.js");

function createShareApi() {
  async function hashToBuild(hash) {
    const code = String(hash || "").replace(/^#/, "").trim();
    if (!code) return null;
    try {
      if (!isShareCode(code)) return null;
      return decodeShareCode(code);
    } catch {
      return null;
    }
  }

  return {
    encodeShareCode: async (build) => encodeShareCode(build),
    decodeShareCode: async (code) => decodeShareCode(code),
    isShareCode: async (text) => Boolean(isShareCode(text)),
    generateChatLink: async (build) => generateChatLink(build),
    previewChatLink: async (link) => previewChatLink(link),
    importChatLink: async (link, name, folderId, gameMode) => {
      // Build the desktop's importChatLink shape from the pure decoder.
      const build = await decodeChatLinkToBuild(link);
      if (!build) throw new Error("Could not import that chat link.");
      return { ...build, name: name || build.name, folderId: folderId ?? null, gameMode: gameMode || build.gameMode || "pve" };
    },
    importGw2Skills: async () => {
      throw new Error("Importing from gw2skills.net is not available in the web playground.");
    },
    buildToHash: async (build) => encodeShareCode(build),
    hashToBuild,
  };
}

module.exports = { createShareApi };
```

Note (already verified): `src/main/buildChatLink.js` exports `{ generateChatLink, prewarmChatLinks, previewChatLink, decodeChatLinkToBuild, mapBuildToTemplateInput }` and has **no** top-level `electron`/`fs` require (it dynamically imports `gw2buildlink`), so it loads fine in Vite and Jest. Re-confirm if the file changed:
```bash
grep -n "module.exports" src/main/buildChatLink.js
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/web/share.test.js --maxWorkers=2`
Expected: PASS (4 tests). If `buildChatLink.js` pulls in Electron at module scope, the import will throw — resolve per the note above, then re-run.

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/share.js tests/web/share.test.js
git commit -m "feat(web): share-code + chat-link + url-hash seam"
```

---

## Task 6: webApi/settings.js + system.js

**Files:**
- Create: `src/web/webApi/settings.js`, `src/web/webApi/system.js`
- Test: `tests/web/settings.test.js`

**Interfaces:**
- Produces:
  - `createSettingsApi({ storage }) → { getSetting(key), setSetting(key, value) }` over `localStorage` under `axiforge.web.settings`.
  - `createSystemApi() → { writeClipboardText, readClipboardText, openExternal, showError, getAppVersion }` using `navigator.clipboard`, `window.open`, `window.alert`. `getAppVersion` returns the injected `__APP_VERSION__` or `"web"`.

- [ ] **Step 1: Write the failing test**

`tests/web/settings.test.js`:
```js
const { createSettingsApi } = require("../../src/web/webApi/settings.js");

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("setSetting then getSetting round-trips a value", async () => {
  const storage = memStorage();
  const api = createSettingsApi({ storage });
  await api.setSetting("theme", "dark");
  expect(await api.getSetting("theme")).toBe("dark");
});

test("getSetting returns undefined for unknown key", async () => {
  const api = createSettingsApi({ storage: memStorage() });
  expect(await api.getSetting("nope")).toBeUndefined();
});

test("settings persist across instances on shared storage", async () => {
  const storage = memStorage();
  await createSettingsApi({ storage }).setSetting("gameMode", "wvw");
  expect(await createSettingsApi({ storage }).getSetting("gameMode")).toBe("wvw");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/web/settings.test.js --maxWorkers=2`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementations**

`src/web/webApi/settings.js`:
```js
// Web settings over localStorage, stored as one JSON blob.
const SETTINGS_KEY = "axiforge.web.settings";

function createSettingsApi({ storage = window.localStorage } = {}) {
  function readAll() {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {
    getSetting: async (key) => {
      const all = readAll();
      return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : undefined;
    },
    setSetting: async (key, value) => {
      const all = readAll();
      all[key] = value;
      storage.setItem(SETTINGS_KEY, JSON.stringify(all));
    },
  };
}

module.exports = { createSettingsApi, SETTINGS_KEY };
```

`src/web/webApi/system.js`:
```js
// Browser implementations of clipboard / external-link / dialog / version seams.
function createSystemApi({ appVersion } = {}) {
  return {
    writeClipboardText: async (text) => {
      await navigator.clipboard.writeText(String(text ?? ""));
      return true;
    },
    readClipboardText: async () => {
      try { return await navigator.clipboard.readText(); } catch { return ""; }
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    showError: async (title, body) => {
      window.alert(`${title}\n\n${body || ""}`.trim());
    },
    getAppVersion: async () => appVersion || "web",
  };
}

module.exports = { createSystemApi };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/web/settings.test.js --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/settings.js src/web/webApi/system.js tests/web/settings.test.js
git commit -m "feat(web): settings + system (clipboard/external/version) seams"
```

---

## Task 7: webApi/stubs.js — desktop-only safe no-ops

**Files:**
- Create: `src/web/webApi/stubs.js`
- Test: `tests/web/stubs.test.js`

**Interfaces:**
- Produces: `createStubsApi() → object` exposing every desktop-only method the renderer may call, each returning a safe value and never throwing. Covered groups: window chrome (`minimizeWindow`, `toggleMaximizeWindow`, `isMaximizedWindow`, `closeWindow`, `openPreviewWindow`), auth (`getSession`→`{signedIn:false}`, `beginLogin`, `completeLogin`, `logout`), onboarding/pages (`getOnboardingStatus`→`{configured:false}`, `listTargets`→`[]`, `setupRepoPages`, `setupForkPages`, `pollPagesStatus`), publishing (`publishSite`, `publishBuild`, `publishComp`, `getCompPublishedUrl`→`null`), Discord (`shareCompToDiscord`, `shareBuildToDiscord`, `getBuildDiscordCopyText`→`""`, `generateCompPlaintext`→`""`), shared library (`getSharedLibraryConfig`→`null`, `connectSharedLibrary`, `disconnectSharedLibrary`, `setupSharedLibrary`, `pullAllShared`, `pullFolder`, `shareFolder`, `unshareFolder`, `listOrgs`→`[]`), updater (`checkForUpdates`, `restartApp`, and all `onUpdate*`/`onDownloadProgress`/`onPublishProgress`/`onSyncStatus`/`onSyncConflict` event registrars → no-op), wiki deep-dive (`getWikiSummary`→`null`, `getWikiRelatedData`→`null`, `resolveEntityFacts`→`(names)=>names.map(()=>null)`), misc (`getWhatsNew`→`null`, `setLastSeenVersion`, `prewarmChatLinks`, `exportAxicodeFile`, `importAxicodeFile`→`null`, `getUpgradeCatalog` is NOT here — it's catalog).

- [ ] **Step 1: Write the failing test**

`tests/web/stubs.test.js`:
```js
const { createStubsApi } = require("../../src/web/webApi/stubs.js");

test("auth + onboarding report signed-out / unconfigured", async () => {
  const s = createStubsApi();
  expect(await s.getSession()).toEqual({ signedIn: false });
  expect(await s.getOnboardingStatus()).toEqual({ configured: false });
  expect(await s.listTargets()).toEqual([]);
  expect(await s.getSharedLibraryConfig()).toBeNull();
});

test("event registrars accept a callback and do not throw", () => {
  const s = createStubsApi();
  expect(() => s.onUpdateAvailable(() => {})).not.toThrow();
  expect(() => s.onDownloadProgress(() => {})).not.toThrow();
  expect(() => s.onSyncStatus(() => {})).not.toThrow();
});

test("resolveEntityFacts returns one null per requested name", async () => {
  const s = createStubsApi();
  expect(await s.resolveEntityFacts(["a", "b"])).toEqual([null, null]);
});

test("every method is callable and never throws synchronously", () => {
  const s = createStubsApi();
  for (const key of Object.keys(s)) {
    expect(() => s[key](["x"], "y")).not.toThrow();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/web/stubs.test.js --maxWorkers=2`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

`src/web/webApi/stubs.js`:
```js
// Desktop-only seam methods that have no meaning in the browser playground.
// Each returns a safe value and never throws, so the renderer boots and runs
// with publishing/auth/updater/sharing simply inert (their UI is hidden via CSS).
function createStubsApi() {
  const noop = async () => undefined;
  const onEvent = () => undefined; // event registrars are sync, return void

  return {
    // window chrome
    minimizeWindow: noop,
    toggleMaximizeWindow: noop,
    isMaximizedWindow: async () => false,
    closeWindow: noop,
    openPreviewWindow: noop,
    // auth
    getSession: async () => ({ signedIn: false }),
    beginLogin: async () => { throw new Error("Sign-in is not available in the web playground."); },
    completeLogin: noop,
    logout: noop,
    // onboarding / pages
    getOnboardingStatus: async () => ({ configured: false }),
    listTargets: async () => [],
    setupRepoPages: noop,
    setupForkPages: noop,
    pollPagesStatus: async () => ({ ready: false }),
    // publishing
    publishSite: noop,
    publishBuild: noop,
    publishComp: noop,
    getCompPublishedUrl: async () => null,
    // discord
    shareCompToDiscord: noop,
    shareBuildToDiscord: noop,
    getBuildDiscordCopyText: async () => "",
    generateCompPlaintext: async () => "",
    encodeCompShareCode: async () => { throw new Error("Comp sharing is not available in the web playground."); },
    importCompShareCode: async () => { throw new Error("Comp import is not available in the web playground."); },
    // shared library
    getSharedLibraryConfig: async () => null,
    connectSharedLibrary: noop,
    disconnectSharedLibrary: noop,
    setupSharedLibrary: noop,
    pullAllShared: noop,
    pullFolder: noop,
    shareFolder: noop,
    unshareFolder: noop,
    listOrgs: async () => [],
    // updater + progress/sync events
    checkForUpdates: onEvent,
    restartApp: onEvent,
    onUpdateChecking: onEvent,
    onUpdateUnsupported: onEvent,
    onUpdateAvailable: onEvent,
    onUpdateNotAvailable: onEvent,
    onUpdateDownloaded: onEvent,
    onUpdateError: onEvent,
    onUpdateInstallError: onEvent,
    onDownloadProgress: onEvent,
    onPublishProgress: onEvent,
    onSyncStatus: onEvent,
    onSyncConflict: onEvent,
    // wiki deep-dive (facts are baked into catalogs; live lookups are off)
    getWikiSummary: async () => null,
    getWikiRelatedData: async () => null,
    resolveEntityFacts: async (names = []) => names.map(() => null),
    // misc
    getWhatsNew: async () => null,
    setLastSeenVersion: noop,
    prewarmChatLinks: noop,
    clearGw2Cache: noop, // real impl provided by catalog api; this is a fallback
    exportAxicodeFile: noop,
    importAxicodeFile: async () => null,
    getConfig: async () => ({ web: true }),
  };
}

module.exports = { createStubsApi };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/web/stubs.test.js --maxWorkers=2`
Expected: PASS (4 tests). Note: the "never throws synchronously" test calls each method once; the few stubs that intentionally reject (beginLogin, encodeCompShareCode, importCompShareCode) return a rejected Promise rather than throwing synchronously, so the test passes.

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/stubs.js tests/web/stubs.test.js
git commit -m "feat(web): desktop-only seam stubs that never throw"
```

---

## Task 8: webApi/index.js — assemble the seam + wire main-web.js

**Files:**
- Create: `src/web/webApi/index.js`
- Modify: `src/web/main-web.js`, `src/web/vite.config.js` (inject `__APP_VERSION__`)

**Interfaces:**
- Consumes: `createCatalogApi`, `createDraftApi`, `createShareApi`, `createSettingsApi`, `createSystemApi`, `createStubsApi`.
- Produces: `createWebApi({ appVersion }) → desktopApi` — a single object spreading stubs first, then the real modules (real wins on key collisions, e.g. `clearGw2Cache`, `getAppVersion`). Catalog's `getProfessionCatalog(professionId, gameMode)` is exposed directly (no `lang`).

- [ ] **Step 1: Write the assembler**

`src/web/webApi/index.js`:
```js
const { createCatalogApi } = require("./catalog.js");
const { createDraftApi } = require("./draft.js");
const { createShareApi } = require("./share.js");
const { createSettingsApi } = require("./settings.js");
const { createSystemApi } = require("./system.js");
const { createStubsApi } = require("./stubs.js");

// Assemble the full browser desktopApi. Order matters: stubs provide safe defaults
// for desktop-only methods; the real modules override where they share a name.
function createWebApi({ appVersion } = {}) {
  const catalog = createCatalogApi();
  const draft = createDraftApi();
  const share = createShareApi();
  const settings = createSettingsApi();
  const system = createSystemApi({ appVersion });
  const stubs = createStubsApi();

  return {
    ...stubs,
    ...catalog,
    ...draft,
    ...share,
    ...settings,
    ...system,
  };
}

module.exports = { createWebApi };
```

- [ ] **Step 2: Inject the app version into the web bundle**

In `src/web/vite.config.js`, read the package version and add a `define`:
```js
import { readFileSync } from "node:fs";
// ...inside defineConfig, add:
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(path.resolve(repoRoot, "package.json"), "utf8")).version
    ),
  },
```

- [ ] **Step 3: Rewrite main-web.js to install the real seam**

`src/web/main-web.js`:
```js
// Web entry: install the real browser desktopApi BEFORE importing the renderer,
// which self-runs init() on import. CommonJS modules are consumed via Vite interop.
import { createWebApi } from "./webApi/index.js";

declare; // (no-op marker line removed in JS; see note)

window.__AXIFORGE_WEB__ = true;
const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "web";
window.desktopApi = createWebApi({ appVersion });

await import("../renderer/renderer.js");
```
Remove the `declare;` marker line — it is not valid JS; the real file is:
```js
import { createWebApi } from "./webApi/index.js";

/* global __APP_VERSION__ */
window.__AXIFORGE_WEB__ = true;
const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "web";
window.desktopApi = createWebApi({ appVersion });

await import("../renderer/renderer.js");
```

- [ ] **Step 4: Run the dev server and verify the editor works end-to-end (manual)**

Run: `npm run dev:web` and open `http://localhost:5180`.
Expected: profession picker is populated from baked `professions.json`; selecting a profession loads its catalog and renders specs/skills/equipment; editing updates the live card. No uncaught console errors.

- [ ] **Step 5: Commit**
```bash
git add src/web/webApi/index.js src/web/main-web.js src/web/vite.config.js
git commit -m "feat(web): assemble browser desktopApi and wire the web entry"
```

---

## Task 9: chrome.js + web.css — top bar, share actions, hash load/save, hide desktop UI

**Files:**
- Create: `src/web/chrome.js`, `src/web/web.css`
- Modify: `src/web/main-web.js` (import chrome + css), `scripts/gen-web-html.mjs` (add `<body class="is-web">` and a top-bar mount, link web.css)

**Interfaces:**
- Consumes: `window.desktopApi` (`encodeShareCode`, `generateChatLink`, `writeClipboardText`, `listBuilds`), the share-api hash helpers (re-import `createShareApi` directly for `hashToBuild`/`buildToHash`).
- Produces: a top bar with **Copy share link**, **Copy chat code**, **Get the desktop app**; on load, if `location.hash` holds a valid code, load that build into the editor before/around `init()`; on editor change, encode the current build into `location.hash`.

- [ ] **Step 1: Inspect how the renderer exposes the current build + change events**

Run:
```bash
grep -nE "markEditorChanged|renderEditor|state.editor|getCurrentBuild|window.dispatchEvent|addEventListener\(\"axiforge" src/renderer/renderer.js src/renderer/modules/editor.js | head -30
```
Identify (a) how to read the current in-editor build object and (b) a hook/event fired on edit. If no event exists, the renderer already persists via `saveBuild` (our draft seam) — wrap `window.desktopApi.saveBuild` to also update the hash. Record the chosen mechanism in a comment in `chrome.js`.

- [ ] **Step 2: Write chrome.js**

`src/web/chrome.js`:
```js
// Web-only chrome: a slim top bar with the two share actions and a desktop CTA,
// plus URL-hash <-> build wiring for transient sharing. Loaded only by main-web.js.
import { createShareApi } from "./webApi/index.js" assert {}; // share helpers
import { createShareApi as makeShare } from "./webApi/share.js";

const share = makeShare();
const RELEASES_URL = "https://github.com/darkharasho/axiforge/releases/latest";

// Update location.hash from a build without triggering a navigation/scroll.
async function syncHashFromBuild(build) {
  if (!build) return;
  try {
    const code = await share.buildToHash(build);
    const url = `${location.pathname}#${code}`;
    history.replaceState(null, "", url);
  } catch {
    /* encoding failure: leave the hash as-is */
  }
}

// Wrap saveBuild so every persist also refreshes the shareable hash.
function instrumentSaveForHash() {
  const original = window.desktopApi.saveBuild;
  window.desktopApi.saveBuild = async (build) => {
    const saved = await original(build);
    void syncHashFromBuild(saved);
    return saved;
  };
}

// If the page opened with #<code>, decode it and seed the draft so the renderer's
// init() (which calls listBuilds) picks it up as the working build.
async function seedFromHash() {
  const build = await share.hashToBuild(location.hash);
  if (!build) return;
  build.id = "web-draft";
  await window.desktopApi.saveBuild(build);
}

function mountTopBar() {
  const bar = document.createElement("div");
  bar.className = "web-topbar no-drag";
  bar.innerHTML = `
    <button id="webCopyLink" type="button" class="web-topbar__btn web-topbar__btn--primary">Copy share link</button>
    <button id="webCopyChat" type="button" class="web-topbar__btn">Copy chat code</button>
    <a id="webGetApp" class="web-topbar__cta" href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">Get the desktop app</a>
  `;
  document.body.prepend(bar);

  bar.querySelector("#webCopyLink").addEventListener("click", async () => {
    const [build] = await window.desktopApi.listBuilds();
    if (!build) return;
    const code = await window.desktopApi.encodeShareCode(build);
    await window.desktopApi.writeClipboardText(`${location.origin}${location.pathname}#${code}`);
    flash(bar.querySelector("#webCopyLink"), "Link copied!");
  });

  bar.querySelector("#webCopyChat").addEventListener("click", async () => {
    const [build] = await window.desktopApi.listBuilds();
    if (!build) return;
    try {
      const chat = await window.desktopApi.generateChatLink(build);
      await window.desktopApi.writeClipboardText(chat);
      flash(bar.querySelector("#webCopyChat"), "Chat code copied!");
    } catch {
      flash(bar.querySelector("#webCopyChat"), "Couldn't generate code");
    }
  });
}

function flash(btn, msg) {
  const prev = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = prev; }, 1500);
}

export async function initWebChrome() {
  instrumentSaveForHash();
  await seedFromHash();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTopBar, { once: true });
  } else {
    mountTopBar();
  }
}
```
Remove the stray first import line (the `assert {}` one) — keep only `import { createShareApi as makeShare } from "./webApi/share.js";`.

- [ ] **Step 3: Write web.css**

`src/web/web.css`:
```css
/* Web playground chrome + hide desktop-only UI. Scoped under body.is-web. */
.is-web .titlebar__controls,        /* window buttons + workspace/account */
.is-web #updateStatusPill,
.is-web #updateRestartBtn,
.is-web .nav-library,               /* library/comps navigation (single-build scope) */
.is-web .nav-comps,
.is-web [data-desktop-only] {
  display: none !important;
}

.web-topbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--panel, #14161c);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.web-topbar__btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.web-topbar__btn--primary {
  background: var(--accent, #c8a85a);
  color: #1a1a1a;
  border-color: transparent;
}
.web-topbar__cta { margin-left: auto; opacity: 0.85; text-decoration: none; }
.web-topbar__cta:hover { opacity: 1; text-decoration: underline; }
```
Note: the selectors `.nav-library`, `.nav-comps`, `[data-desktop-only]` are guesses — in Step 1 you already inspected the renderer; confirm the real class/IDs for the library/comp nav and the titlebar controls (`grep -n "nav-library\|page-library\|titlebar__controls\|titlebar__workspace" src/renderer/index.html`) and correct the selectors so the right elements hide. Verify visually in Step 6.

- [ ] **Step 4: Load chrome + css from main-web.js**

Append to `src/web/main-web.js` (after installing the seam, before importing the renderer is fine since chrome wires around it; import css too):
```js
import "./web.css";
import { initWebChrome } from "./chrome.js";
// ...after window.desktopApi = createWebApi(...):
await initWebChrome();
await import("../renderer/renderer.js");
```

- [ ] **Step 5: Add body class + web.css link via the HTML generator**

In `scripts/gen-web-html.mjs`, after the existing replaces, add:
```js
out = out
  .replace("<body>", '<body class="is-web">')
  .replace("</head>", '  <link rel="stylesheet" href="../web/web.css" />\n  </head>');
```
(The css is also imported by main-web.js; the link tag avoids a flash of desktop chrome before JS runs. If Vite complains about the cross-dir href, drop the link tag and rely on the JS import only.)

- [ ] **Step 6: Verify manually**

Run: `npm run dev:web`, open `http://localhost:5180`.
Expected: top bar shows three controls; window buttons and library/comp nav are hidden; build a guardian build, click **Copy share link** → clipboard holds `http://localhost:5180/#<code>`; paste that URL in a new tab → the same build loads. **Copy chat code** copies a `[&...]` chat link.

- [ ] **Step 7: Commit**
```bash
git add src/web/chrome.js src/web/web.css src/web/main-web.js scripts/gen-web-html.mjs
git commit -m "feat(web): top bar with share-link/chat-code, hash sync, hide desktop UI"
```

---

## Task 10: Playwright SPA test for the playground

**Files:**
- Create: `tests/spa/specs/playground.spec.js`
- Modify: `package.json` (add `test:playground` script if the existing spa config can't target it directly)

**Interfaces:**
- Consumes: a served `dist/web` build (or the `dev:web` server). Follows the existing `tests/spa/playwright.config.js` conventions.

- [ ] **Step 1: Inspect the existing SPA test harness**

Run:
```bash
sed -n '1,60p' tests/spa/playwright.config.js && ls tests/spa/specs && sed -n '1,40p' tests/spa/helpers/*.js 2>/dev/null | head -60
```
Note how the config starts/serves the SPA (webServer block, baseURL) so the new spec reuses the same pattern. If the config is hard-wired to the published `src/site` SPA, add a second project or a dedicated config `tests/spa/playground.config.js` that serves `dist/web` (build first) or runs `dev:web`.

- [ ] **Step 2: Write the spec**

`tests/spa/specs/playground.spec.js`:
```js
const { test, expect } = require("@playwright/test");

// These assume baseURL points at the playground build (see Step 1). Selector names
// (#professionSelect etc.) must be confirmed against the renderer in Step 1 and
// adjusted here — replace with the real profession picker + card selectors.
test("loads, builds, and produces a shareable hash", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".web-topbar")).toBeVisible();

  // Pick a profession (confirm the real selector during Step 1).
  await page.selectOption("#professionSelect", "guardian").catch(async () => {
    // fallback if it's a custom-select widget rather than a native <select>
    await page.click('[data-profession="guardian"]');
  });

  // Editing should populate the URL hash with a share code.
  await expect.poll(async () => (await page.evaluate(() => location.hash)).length).toBeGreaterThan(1);
});

test("opening a shared hash restores the build", async ({ page }) => {
  // Build once, capture the hash.
  await page.goto("/");
  await page.selectOption("#professionSelect", "ranger").catch(() => {});
  await expect.poll(async () => (await page.evaluate(() => location.hash)).length).toBeGreaterThan(1);
  const hash = await page.evaluate(() => location.hash);

  // Reopen with the captured hash → same profession is selected.
  await page.goto("/" + hash);
  await expect.poll(async () =>
    page.evaluate(() => window.desktopApi.listBuilds().then((b) => b[0]?.profession))
  ).toBe("ranger");
});
```

- [ ] **Step 3: Run the spec**

Run: `npx playwright test --config tests/spa/playwright.config.js tests/spa/specs/playground.spec.js` (or the dedicated config from Step 1).
Expected: PASS. Adjust selectors discovered in Step 1 until green.

- [ ] **Step 4: Commit**
```bash
git add tests/spa/specs/playground.spec.js package.json
git commit -m "test(web): playwright coverage for build + share-hash round-trip"
```

---

## Task 11: Wrangler deploy config + deploy script

**Files:**
- Create: `wrangler.jsonc`
- Modify: `package.json` (`deploy:web` script, `wrangler` devDependency)

**Interfaces:**
- Produces: a static-asset Worker serving `dist/web` on `build.axi.link`.

- [ ] **Step 1: Add wrangler.jsonc**

`wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "axiforge-playground",
  "compatibility_date": "2026-06-29",
  // Pure static SPA (no Worker script): serve the Vite web build, falling back to
  // index.html for any path. Static-asset serving on Workers is free + unlimited.
  "assets": {
    "directory": "./dist/web",
    "not_found_handling": "single-page-application"
  },
  // Custom domain — axi.link DNS is already on Cloudflare, so the first deploy
  // provisions build.axi.link + its DNS record.
  "routes": [{ "pattern": "build.axi.link", "custom_domain": true }]
}
```
Note: the Vite build emits `index.generated.html`, not `index.html`. Add a copy step so the SPA entry is `index.html`. Update `build:web` to finish with a rename, or add to `gen-web-html.mjs` an option to also write `index.html`. Simplest: in `src/web/vite.config.js`, set `build.rollupOptions.input` and a `closeBundle` step, OR add to `package.json`:
```json
"build:web": "npm run bake:catalogs && npm run gen:web-html && vite build --config src/web/vite.config.js && node -e \"require('fs').copyFileSync('dist/web/index.generated.html','dist/web/index.html')\""
```

- [ ] **Step 2: Add deploy script + devDep**

Add to `scripts`: `"deploy:web": "npm run build:web && wrangler deploy"`.
Install wrangler: `npm install --save-dev wrangler@^4` (matches axiroster's version).

- [ ] **Step 3: Build and verify the bundle locally**

Run: `npm run build:web`
Expected: `dist/web/index.html` exists, `dist/web/catalogs/` is populated, assets are hashed. Serve and smoke test: `npx wrangler dev` (or `npx serve dist/web`) and confirm the playground loads.

- [ ] **Step 4: Commit (do NOT deploy)**
```bash
git add wrangler.jsonc package.json package-lock.json
git commit -m "build(web): wrangler static-SPA config + deploy:web script for build.axi.link"
```
Deployment itself (`npm run deploy:web`) requires explicit approval per project policy — do not run it as part of this plan.

---

## Self-Review

**Spec coverage:**
- Architecture / seam / boot order → Tasks 1, 8. ✓
- Baked catalogs → Tasks 2, 3. ✓
- Single transient build + localStorage draft → Task 4. ✓
- URL-hash + share code + chat code (both share affordances) → Tasks 5, 9. ✓
- Hidden desktop UI / graceful degrade → Tasks 7, 9. ✓
- Straight-into-editor entry, `#<code>` load → Task 9. ✓
- Error handling (catalog fetch, decode fallback, stub no-ops) → Tasks 3, 5, 7. ✓
- Testing (jest unit, playwright spa, bake smoke) → Tasks 2–7, 10. ✓
- Deploy to build.axi.link via wrangler → Task 11. ✓
- Out-of-scope (no backend/comps/folders) → enforced by Task 4 single-build semantics + Task 7 stubs. ✓

**Placeholder scan:** No TBD/TODO. Two tasks (9, 10) contain explicit "confirm the real selector" inspection steps with the exact grep commands to run — these are verification steps, not placeholders, because the renderer's internal selector names can't be known without reading it and the steps name precisely what to find and where to apply it.

**Type consistency:** `createCatalogApi`/`createDraftApi`/`createShareApi`/`createSettingsApi`/`createSystemApi`/`createStubsApi`/`createWebApi` names are consistent across Tasks 3–8. Draft id `"web-draft"` is used identically in Tasks 4 and 9. `buildToHash`/`hashToBuild` names match between Tasks 5 and 9. `getProfessionCatalog(professionId, gameMode)` (no `lang`) is consistent in Tasks 3 and 8.

**Known risk flagged for the implementer:** Task 5 depends on `src/main/buildChatLink.js` being importable in a browser/Jest context (no top-level `electron`/`fs`); the task includes the grep to verify and a fallback if not. Task 9 depends on discovering the renderer's current-build read + change hook; Step 1 of Task 9 resolves it before code is written.
