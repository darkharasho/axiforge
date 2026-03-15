# SPA Vite App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the published build viewer from embedded template strings into a proper Vite-built SPA that shares CSS with the desktop app, has 1:1 read-only renderers, and uses enriched build data (weapon skills, F-skills, stats, profession icons).

**Architecture:** A new `src/site/` directory contains a standalone Vite app with its own `index.html`, renderer modules, and `vite.config.js`. It imports the desktop CSS files directly via `@import`. The Electron main process enriches build data at publish time via a new `buildPublish.js` module, then reads the pre-built Vite output from `dist/site/` instead of generating template strings. The SPA decrypts and renders the enriched build data with zero external API calls.

**Tech Stack:** Vite (site build), vanilla JS ES modules, Web Crypto API, shared desktop CSS, Node.js crypto (encryption), `gw2-class-icons` package (profession SVGs).

**Spec:** `docs/superpowers/specs/2026-03-15-spa-vite-app-design.md`

**Important context for implementers:**
- The desktop app is an Electron app with vanilla JS (no React/Vue)
- Renderer modules are ES modules (`import`/`export`) in `src/renderer/modules/`
- Main process modules are CommonJS (`require`/`module.exports`) in `src/main/`
- The desktop renderer uses a global `state` object — SPA renderers must NOT depend on it
- The desktop CSS is in `src/renderer/styles/` (14 CSS files)
- The existing `siteBundle.js` has embedded HTML/CSS/JS as template strings (~900 lines) — this gets replaced
- Tests use Jest. Run with `npx jest --verbose`
- The worktree is at `.worktrees/web-publishing` on branch `feature/web-publishing`

---

## Chunk 1: Vite App Scaffolding & Build Pipeline

### Task 1: Create Vite Config and SPA Shell

**Files:**
- Create: `src/site/vite.config.js`
- Create: `src/site/index.html`
- Create: `src/site/404.html`
- Create: `src/site/styles.css`
- Create: `src/site/main.js`

This task creates the bare SPA structure that can be built with Vite. No renderers yet — just the shell, routing, and decryption.

- [ ] **Step 1: Create `src/site/vite.config.js`**

```js
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: Create `src/site/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AxiForge Builds</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Exo+2:wght@300;400;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <nav class="site-navbar">
      <div class="site-navbar__left">
        <span class="site-navbar__logo">&#9876;</span>
        <span class="site-navbar__title">AxiForge Builds</span>
      </div>
      <div class="site-navbar__right">
        <a href="https://github.com/darkharasho/axiforge" target="_blank" rel="noreferrer" class="site-navbar__link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </a>
        <a href="https://discord.gg/UjzMXMGXEg" target="_blank" rel="noreferrer" class="site-navbar__link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.618-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 00.031.056 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.076.076 0 00-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.031-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.029z"/></svg>
          Discord
        </a>
      </div>
    </nav>
    <main id="app"></main>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/site/404.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>AxiForge Builds — Redirecting</title>
    <script>
      var seg = location.pathname.split('/').filter(Boolean);
      var repoName = seg.length > 0 ? seg[0] : '';
      var buildPath = seg.slice(1).join('/');
      if (buildPath || location.hash) {
        sessionStorage.setItem('spa-redirect', JSON.stringify({ path: buildPath, hash: location.hash }));
        location.replace('/' + repoName + '/');
      }
    </script>
  </head>
  <body><p>Redirecting&hellip;</p></body>
</html>
```

- [ ] **Step 4: Create `src/site/styles.css`**

```css
/* Import desktop CSS — one source of truth for component styles */
@import "../renderer/styles/base.css";
@import "../renderer/styles/layout.css";
@import "../renderer/styles/buttons.css";
@import "../renderer/styles/specializations.css";
@import "../renderer/styles/skills.css";
@import "../renderer/styles/equipment.css";
@import "../renderer/styles/detail-panel.css";

/* ── SPA-specific styles ─────────────────────────────────────────────── */

/* Navbar */
.site-navbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 24px; background: var(--panel); border-bottom: 1px solid var(--line-soft);
}
.site-navbar__left { display: flex; align-items: center; gap: 10px; }
.site-navbar__logo { font-size: 1.4rem; }
.site-navbar__title { font-family: 'Cinzel', serif; font-size: 1.1rem; color: var(--accent); font-weight: 700; letter-spacing: 0.04em; }
.site-navbar__right { display: flex; align-items: center; gap: 16px; }
.site-navbar__link { color: var(--muted); text-decoration: none; font-size: 0.85rem; display: flex; align-items: center; gap: 6px; transition: color 0.15s; }
.site-navbar__link:hover { color: var(--text); }

/* App container */
#app { width: min(1100px, 94vw); margin: 24px auto 48px; }

/* Landing */
.site-landing { text-align: center; padding: 80px 0; }
.site-landing h1 { font-family: 'Cinzel', serif; font-size: 2rem; color: var(--accent); margin-bottom: 12px; }
.site-landing p { color: var(--muted); font-size: 1.05rem; }
.site-landing a { color: var(--accent-2); }

/* Loading & error */
.site-loading { text-align: center; padding: 48px 0; color: var(--muted); font-size: 1.1rem; }
.site-error { background: rgba(255,60,60,.12); border: 1px solid rgba(255,60,60,.4); border-radius: 10px; padding: 20px; color: #ff8888; text-align: center; margin-top: 40px; }

/* Build header */
.build-header { margin-bottom: 20px; display: flex; align-items: center; gap: 14px; }
.build-header__icon { width: 48px; height: 48px; color: var(--muted); flex-shrink: 0; }
.build-header__icon svg { width: 100%; height: 100%; }
.build-header__info h1 { font-family: 'Cinzel', serif; font-size: 1.6rem; margin: 0; }
.build-header__meta { color: var(--muted); font-size: 0.85rem; margin-top: 2px; }
.build-header__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.build-header__tag { background: var(--panel); border: 1px solid var(--line-soft); border-radius: 999px; padding: 3px 10px; font-size: 0.75rem; color: var(--accent-2); }

/* Tabs */
.site-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--line-soft); margin-bottom: 16px; }
.site-tab { background: none; border: none; color: var(--muted); font-family: 'Exo 2', sans-serif; font-size: 0.88rem; font-weight: 600; padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; letter-spacing: 0.04em; transition: color 0.15s, border-color 0.15s; }
.site-tab:hover { color: var(--text); }
.site-tab--active { color: var(--accent); border-bottom-color: var(--accent); }
.site-tab-content { display: none; }
.site-tab-content--active { display: block; }

/* Section headings used in SPA */
.site-section-heading { color: var(--accent-2); font-family: 'Exo 2', sans-serif; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 20px 0 8px; }

/* Notes display */
.site-notes { color: var(--muted); padding: 12px 14px; border: 1px solid var(--line-soft); border-radius: 8px; background: var(--panel); font-size: 0.88rem; line-height: 1.5; white-space: pre-wrap; }

/* Mechanic section (legends, pets, attunements) */
.site-mechanic { display: flex; gap: 8px; align-items: center; margin-top: 8px; padding: 6px 10px; background: var(--panel); border: 1px solid var(--line-soft); border-radius: 8px; font-size: 0.85rem; color: var(--muted); }
```

- [ ] **Step 5: Create `src/site/main.js` (minimal — routing + decryption only)**

```js
import "./styles.css";

const app = document.getElementById("app");

// ── SPA Routing ──────────────────────────────────────────────────────────
function init() {
  let redirect = null;
  try {
    const stored = sessionStorage.getItem("spa-redirect");
    if (stored) { redirect = JSON.parse(stored); sessionStorage.removeItem("spa-redirect"); }
  } catch (e) { /* ignore */ }

  const hash = redirect ? redirect.hash : location.hash;
  const path = redirect ? redirect.path : getBuildPath();

  if (!hash || hash.length < 2) { showLanding(); return; }

  const fragment = hash.substring(1);
  const dotIdx = fragment.indexOf(".");
  if (dotIdx < 1) { showError("Invalid build link."); return; }

  const fileId = fragment.substring(0, dotIdx);
  const key = fragment.substring(dotIdx + 1);

  showLoading();
  loadBuild(fileId, key);
}

function getBuildPath() {
  return location.pathname.split("/").filter(Boolean).slice(1).join("/");
}

function showLanding() {
  app.innerHTML = `<div class="site-landing"><h1>AxiForge Builds</h1><p>Share your Guild Wars 2 builds with encrypted links.<br>Publish from the <a href="https://github.com/darkharasho/axiforge">AxiForge desktop app</a>.</p></div>`;
}

function showLoading() {
  app.innerHTML = `<div class="site-loading">Decrypting build\u2026</div>`;
}

function showError(msg) {
  app.innerHTML = `<div class="site-error">${escapeHtml(msg)}</div>`;
}

// ── Fetch & Decrypt ──────────────────────────────────────────────────────
async function loadBuild(fileId, base64urlKey) {
  try {
    const res = await fetch("builds/" + encodeURIComponent(fileId) + ".enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Build not found (HTTP " + res.status + ")");
    const base64Data = await res.text();
    const build = await decrypt(base64Data, base64urlKey);
    renderBuild(build);
  } catch (err) {
    showError(err.message || String(err));
  }
}

async function decrypt(base64Data, base64urlKey) {
  const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const keyBytes = base64urlDecode(base64urlKey);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain));
}

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ── Placeholder render (replaced in later tasks) ─────────────────────────
function renderBuild(build) {
  app.innerHTML = `<div class="build-header"><div class="build-header__info"><h1>${escapeHtml(build.title || "Untitled Build")}</h1><p class="build-header__meta">${escapeHtml(build.profession || "")} &middot; ${escapeHtml((build.gameMode || "pve").toUpperCase())}</p></div></div><pre style="color:var(--muted);font-size:0.75rem;max-height:60vh;overflow:auto">${escapeHtml(JSON.stringify(build, null, 2))}</pre>`;
}

export function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Start ────────────────────────────────────────────────────────────────
init();
```

- [ ] **Step 6: Verify Vite can build the site**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build succeeds, output in `dist/site/` with `index.html`, `404.html`, and `assets/` folder.

- [ ] **Step 7: Verify `dist/site/` is gitignored**

Check that `dist/` is in `.gitignore`. If not, add it.

- [ ] **Step 8: Commit**

```bash
git add src/site/ .gitignore
git commit -m "feat: scaffold SPA Vite app with routing and decryption"
```

---

### Task 2: Update Build Pipeline (package.json + siteBundle.js)

**Files:**
- Modify: `package.json` (scripts section)
- Modify: `src/main/siteBundle.js` (full rewrite — read dist/site/ instead of template strings)
- Modify: `tests/unit/siteBundle.test.js` (update for new approach)

- [ ] **Step 1: Add `build:site` script to `package.json`**

Add to the `scripts` section:
```json
"build:site": "vite build --config src/site/vite.config.js"
```

Update the `dev` script to build the site first:
```json
"dev": "npm run build:site && concurrently -k \"vite\" \"wait-on tcp:5173 && APP_PROFILE=dev VITE_DEV_SERVER_URL=http://localhost:5173 electronmon .\""
```

Update the build scripts to include site build:
```json
"build:app": "npm run build:site && npm run build:renderer && electron-builder --publish never",
"build:app:linux": "npm run build:site && npm run build:renderer && electron-builder --linux --publish never",
"build:app:win": "npm run build:site && npm run build:renderer && electron-builder --win --publish never"
```

- [ ] **Step 2: Rewrite `src/main/siteBundle.js`**

Replace the entire file with:

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { encryptBuild } = require("./buildEncryption");

// Resolve dist/site directory — packaged app uses resourcesPath, dev uses project root
function getSiteDistDir() {
  if (typeof app !== "undefined" && app.isPackaged) {
    return path.join(process.resourcesPath, "site");
  }
  return path.join(__dirname, "../../dist/site");
}

function buildSpaBundle() {
  const distDir = getSiteDistDir();
  if (!fs.existsSync(distDir)) {
    throw new Error(`Site not built. Run "npm run build:site" first. Expected: ${distDir}`);
  }
  const files = {};
  walkDir(distDir, distDir, files);
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
      // Read text files as utf8, binary files as base64
      const ext = path.extname(entry.name).toLowerCase();
      const isBinary = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot"].includes(ext);
      files[rel] = isBinary
        ? fs.readFileSync(full).toString("base64")
        : fs.readFileSync(full, "utf8");
    }
  }
}

function buildEncryptedBuildFile(buildData, fileId, base64urlKey) {
  const content = encryptBuild(buildData, base64urlKey);
  return {
    filePath: `site/builds/${fileId}.enc`,
    content,
  };
}

module.exports = { buildSpaBundle, buildEncryptedBuildFile };
```

- [ ] **Step 3: Update `tests/unit/siteBundle.test.js`**

The tests need to work with the new file-reading approach. Build the site first, then test.

Rewrite the test file:

```js
"use strict";

// Build the site before running tests
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const DIST_DIR = path.join(__dirname, "../../dist/site");

// Build site if dist doesn't exist
beforeAll(() => {
  if (!fs.existsSync(DIST_DIR)) {
    execSync("npx vite build --config src/site/vite.config.js", {
      cwd: path.join(__dirname, "../.."),
      stdio: "pipe",
    });
  }
});

// Mock electron app for siteBundle.js
jest.mock("electron", () => ({ app: { isPackaged: false } }), { virtual: true });

const { buildSpaBundle, buildEncryptedBuildFile } = require("../../src/main/siteBundle");

describe("buildSpaBundle", () => {
  test("returns an object with file entries", () => {
    const bundle = buildSpaBundle();
    expect(typeof bundle).toBe("object");
    expect(Object.keys(bundle).length).toBeGreaterThan(0);
  });

  test("contains site/index.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toBeTruthy();
  });

  test("contains site/404.html", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/404.html"]).toBeTruthy();
  });

  test("contains site/.nojekyll", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/.nojekyll"]).toBe("\n");
  });

  test("index.html is valid HTML5", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"].trimStart()).toMatch(/^<!doctype html>/i);
  });

  test("index.html contains AxiForge Builds", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/index.html"]).toContain("AxiForge Builds");
  });

  test("404.html contains sessionStorage redirect", () => {
    const bundle = buildSpaBundle();
    expect(bundle["site/404.html"]).toContain("sessionStorage");
    expect(bundle["site/404.html"]).toContain("location.replace");
  });

  test("contains at least one asset file (CSS or JS)", () => {
    const bundle = buildSpaBundle();
    const assetKeys = Object.keys(bundle).filter(k => k.startsWith("site/assets/"));
    expect(assetKeys.length).toBeGreaterThan(0);
  });

  test("all values are strings", () => {
    const bundle = buildSpaBundle();
    for (const value of Object.values(bundle)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("buildEncryptedBuildFile", () => {
  test("returns filePath and content", () => {
    const result = buildEncryptedBuildFile({ title: "Test" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.filePath).toBe("site/builds/abc12345.enc");
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
  });

  test("content does not contain plaintext", () => {
    const result = buildEncryptedBuildFile({ title: "My Secret Build" }, "abc12345", "someBase64urlKey_that_is_43_chars_longAAAAA");
    expect(result.content).not.toContain("My Secret Build");
  });
});
```

- [ ] **Step 4: Build the site and run tests**

Run:
```bash
npm run build:site
npx jest tests/unit/siteBundle.test.js --verbose
```
Expected: Site builds, all tests pass.

- [ ] **Step 5: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json src/main/siteBundle.js tests/unit/siteBundle.test.js
git commit -m "feat: replace embedded template strings with Vite-built site output"
```

---

## Chunk 2: Enriched Publish Data

### Task 3: Build Publish Module (serializeForPublish)

**Files:**
- Create: `src/main/buildPublish.js`
- Create: `tests/unit/buildPublish.test.js`
- Modify: `src/main/index.js` (use serializeForPublish in publish handler)

This module enriches the serialized build data with weapon skills, F-skills, stats, profession icons, pet/legend display data — everything the SPA needs to render without API calls.

**Important:** This module runs in the main process (CommonJS). It cannot import ES modules from `src/renderer/modules/` directly. Instead, it must implement the enrichment logic using the catalog data structures that are already available in the main process via the GW2 API fetcher.

Reference these data structures:
- `catalog.professionWeapons` — weapon → skills mapping
- `catalog.weaponSkillById` — Map of weapon skill ID → skill object
- `catalog.skillById` — Map of skill ID → skill object
- `catalog.legends` — Revenant legend data
- `catalog.professionSkills` — F-key mechanic skills
- `catalog.petById` — Ranger pet data (if available)

The catalog is fetched via `getProfessionCatalog(professionId, "en")` in `src/main/gw2Data/index.js`.

- [ ] **Step 1: Write tests for `serializeForPublish`**

Create `tests/unit/buildPublish.test.js`:

```js
"use strict";

const { serializeForPublish } = require("../../src/main/buildPublish");

function makeMockBuild() {
  return {
    title: "Power Reaper",
    profession: "Necromancer",
    specializations: [
      { id: 39, name: "Soul Reaping", elite: false, icon: "sr.png", background: "sr-bg.png",
        minorTraits: [{ id: 1, name: "Minor 1", icon: "m1.png", description: "desc" }],
        majorChoices: { 1: 100, 2: 200, 3: 300 },
        majorTraitsByTier: { 1: [{ id: 100, name: "T1", icon: "t1.png" }], 2: [], 3: [] } },
      { id: 34, name: "Spite", elite: false, icon: "sp.png", background: "sp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
      { id: 34, name: "Reaper", elite: true, icon: "rp.png", background: "rp-bg.png",
        minorTraits: [], majorChoices: { 1: 0, 2: 0, 3: 0 }, majorTraitsByTier: { 1: [], 2: [], 3: [] } },
    ],
    skills: {
      heal: { id: 10527, name: "Well of Blood", icon: "wob.png", description: "Heal" },
      utility: [{ id: 10532, name: "Well of Suffering", icon: "wos.png", description: "Utility" }],
      elite: { id: 10549, name: "Lich Form", icon: "lf.png", description: "Elite" },
    },
    equipment: {
      statPackage: "Berserker",
      weapons: { mainhand1: "Greatsword", offhand1: "", mainhand2: "Dagger", offhand2: "Focus" },
      runes: { head: "Scholar" }, sigils: { mainhand1: ["Force", "Impact"] },
      slots: {}, infusions: {}, relic: "Thief", food: "Soup", utility: "Stone", enrichment: "",
    },
    gameMode: "pve",
    tags: ["dps"],
    notes: "A test build",
    selectedLegends: ["", ""],
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
  };
}

function makeMockCatalog() {
  return {
    professionWeapons: {
      Greatsword: {
        flags: ["TwoHand", "Mainhand"],
        skills: [
          { id: 1, slot: "Weapon_1" }, { id: 2, slot: "Weapon_2" },
          { id: 3, slot: "Weapon_3" }, { id: 4, slot: "Weapon_4" }, { id: 5, slot: "Weapon_5" },
        ],
      },
    },
    weaponSkillById: new Map([
      [1, { id: 1, name: "Dusk Strike", icon: "ds.png", description: "Auto", slot: "Weapon_1" }],
      [2, { id: 2, name: "Infusing Terror", icon: "it.png", description: "Skill 2", slot: "Weapon_2" }],
      [3, { id: 3, name: "Death Spiral", icon: "dsp.png", description: "Skill 3", slot: "Weapon_3" }],
      [4, { id: 4, name: "Nightfall", icon: "nf.png", description: "Skill 4", slot: "Weapon_4" }],
      [5, { id: 5, name: "Grasping Darkness", icon: "gd.png", description: "Skill 5", slot: "Weapon_5" }],
    ]),
    skillById: new Map(),
    professionSkills: [
      { id: 10574, name: "Death Shroud", icon: "ds-icon.png", description: "Enter DS", slot: "Profession_1" },
    ],
    legends: [],
    petById: new Map(),
    specializationById: new Map(),
  };
}

describe("serializeForPublish", () => {
  test("includes all base build fields", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.title).toBe("Power Reaper");
    expect(result.profession).toBe("Necromancer");
    expect(result.skills.heal.name).toBe("Well of Blood");
  });

  test("adds weaponSkills for equipped weapons", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.weaponSkills).toBeDefined();
    expect(result.weaponSkills.set1).toHaveLength(5);
    expect(result.weaponSkills.set1[0].name).toBe("Dusk Strike");
  });

  test("adds professionMechanics (F-skills)", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(result.professionMechanics).toBeDefined();
    expect(Array.isArray(result.professionMechanics)).toBe(true);
  });

  test("adds professionIcon SVG string", () => {
    const result = serializeForPublish(makeMockBuild(), makeMockCatalog());
    expect(typeof result.professionIcon).toBe("string");
  });

  test("handles missing weapons gracefully", () => {
    const build = makeMockBuild();
    build.equipment.weapons = {};
    const result = serializeForPublish(build, makeMockCatalog());
    expect(result.weaponSkills.set1).toEqual([]);
    expect(result.weaponSkills.set2).toEqual([]);
  });

  test("handles null catalog gracefully", () => {
    const result = serializeForPublish(makeMockBuild(), null);
    expect(result.weaponSkills).toBeDefined();
    expect(result.professionMechanics).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/buildPublish.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/main/buildPublish.js`**

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Enrich a serialized build with data the SPA needs to render without API calls.
 * Extends the existing build object (from serializeEditorToBuild) with:
 * - weaponSkills: resolved weapon skills for each weapon set
 * - professionMechanics: F1-F5 profession skill icons
 * - professionIcon: SVG string for profession/elite spec
 * - petDisplay: pet names/icons for Ranger
 * - legendDisplay: legend names/icons for Revenant
 */
function serializeForPublish(build, catalog) {
  const result = { ...build };

  result.weaponSkills = resolveWeaponSkills(build, catalog);
  result.professionMechanics = resolveProfessionMechanics(build, catalog);
  result.professionIcon = resolveProfessionIcon(build);
  result.petDisplay = resolvePetDisplay(build, catalog);
  result.legendDisplay = resolveLegendDisplay(build, catalog);

  return result;
}

function resolveWeaponSkills(build, catalog) {
  const weapons = build?.equipment?.weapons || {};
  const profWeapons = catalog?.professionWeapons || {};
  const skillById = catalog?.weaponSkillById || new Map();

  const sets = {
    set1: resolveWeaponSetSkills(weapons.mainhand1, weapons.offhand1, profWeapons, skillById),
    set2: resolveWeaponSetSkills(weapons.mainhand2, weapons.offhand2, profWeapons, skillById),
    aquatic1: resolveWeaponSetSkills(weapons.aquatic1, "", profWeapons, skillById),
    aquatic2: resolveWeaponSetSkills(weapons.aquatic2, "", profWeapons, skillById),
  };

  return sets;
}

function resolveWeaponSetSkills(mainhand, offhand, profWeapons, skillById) {
  const slots = [null, null, null, null, null];

  // Mainhand skills (slots 1-3 for 1H, 1-5 for 2H)
  const mhData = mainhand ? profWeapons[mainhand] : null;
  if (mhData) {
    const isTwoHand = mhData.flags?.includes("TwoHand");
    const maxSlot = isTwoHand ? 5 : 3;
    for (const ref of mhData.skills || []) {
      const slotNum = parseWeaponSlot(ref.slot);
      if (slotNum >= 1 && slotNum <= maxSlot) {
        const skill = skillById.get(ref.id);
        if (skill) slots[slotNum - 1] = simplifySkill(skill);
      }
    }
  }

  // Offhand skills (slots 4-5)
  const ohData = offhand ? profWeapons[offhand] : null;
  if (ohData) {
    for (const ref of ohData.skills || []) {
      const slotNum = parseWeaponSlot(ref.slot);
      if (slotNum >= 4 && slotNum <= 5) {
        const skill = skillById.get(ref.id);
        if (skill) slots[slotNum - 1] = simplifySkill(skill);
      }
    }
  }

  return slots.filter(Boolean);
}

function parseWeaponSlot(slot) {
  const match = String(slot || "").match(/Weapon_(\d)/);
  return match ? Number(match[1]) : 0;
}

function resolveProfessionMechanics(build, catalog) {
  const profSkills = catalog?.professionSkills || [];
  return profSkills
    .filter(s => s.slot && s.slot.startsWith("Profession_"))
    .sort((a, b) => (a.slot || "").localeCompare(b.slot || ""))
    .map(s => ({
      id: s.id,
      name: s.name || "",
      icon: s.icon || "",
      description: s.description || "",
      fLabel: "F" + (parseWeaponSlot(s.slot.replace("Profession_", "Weapon_")) || s.slot.replace("Profession_", "")),
    }));
}

function resolveProfessionIcon(build) {
  const profession = build?.profession || "";
  const eliteSpec = (build?.specializations || []).find(s => s?.elite);
  const iconName = eliteSpec?.name || profession;
  if (!iconName) return "";

  try {
    const svgPath = path.join(__dirname, "../../node_modules/gw2-class-icons/wiki/svg", iconName + ".svg");
    return fs.readFileSync(svgPath, "utf8");
  } catch {
    // Try profession name as fallback
    try {
      const svgPath = path.join(__dirname, "../../node_modules/gw2-class-icons/wiki/svg", profession + ".svg");
      return fs.readFileSync(svgPath, "utf8");
    } catch {
      return "";
    }
  }
}

function resolvePetDisplay(build, catalog) {
  const pets = build?.selectedPets || {};
  const petById = catalog?.petById || new Map();
  const result = {};

  for (const [key, petId] of Object.entries(pets)) {
    if (!petId) continue;
    const pet = petById.get(Number(petId));
    result[key] = pet
      ? { id: pet.id, name: pet.name || "", icon: pet.icon || "" }
      : { id: petId, name: `Pet ${petId}`, icon: "" };
  }

  return result;
}

function resolveLegendDisplay(build, catalog) {
  const legends = build?.selectedLegends || [];
  const catalogLegends = catalog?.legends || [];
  const skillById = catalog?.skillById || new Map();

  return legends.filter(Boolean).map(legendId => {
    const legend = catalogLegends.find(l => l.id === legendId);
    if (!legend) return { id: legendId, name: legendId, swapIcon: "" };
    const swapSkill = legend.swap ? skillById.get(legend.swap) : null;
    return {
      id: legendId,
      name: legend.name || legendId,
      swapIcon: swapSkill?.icon || "",
    };
  });
}

function simplifySkill(skill) {
  if (!skill) return null;
  return {
    id: skill.id || 0,
    name: skill.name || "",
    icon: skill.icon || "",
    description: skill.description || "",
    slot: skill.slot || "",
  };
}

module.exports = { serializeForPublish };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/buildPublish.test.js --verbose`
Expected: All tests pass.

- [ ] **Step 5: Wire `serializeForPublish` into the publish handler**

In `src/main/index.js`:

Add import at the top:
```js
const { serializeForPublish } = require("./buildPublish");
```

In the `builds:publish-build` handler, after the `encKey` and `newSlug` lines (around line 283), add the enrichment step before encrypting. Replace:
```js
    // Encrypt and commit the build
    progress("encrypt");
    const encFile = buildEncryptedBuildFile(build, fileId, encKey);
```
with:
```js
    // Enrich build data for the SPA
    progress("encrypt");
    let enrichedBuild = build;
    try {
      const { getProfessionCatalog } = require("./gw2Data");
      const catalog = await getProfessionCatalog(build.profession, "en");
      enrichedBuild = serializeForPublish(build, catalog);
    } catch {
      // Fall back to un-enriched build if catalog unavailable
    }
    const encFile = buildEncryptedBuildFile(enrichedBuild, fileId, encKey);
```

- [ ] **Step 6: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/buildPublish.js tests/unit/buildPublish.test.js src/main/index.js
git commit -m "feat: add serializeForPublish with weapon skills, F-skills, profession icons"
```

---

## Chunk 3: Read-Only Renderers

### Task 4: Specialization Renderer

**Files:**
- Create: `src/site/render-specs.js`

Read-only specialization cards matching the desktop DOM structure.

- [ ] **Step 1: Create `src/site/render-specs.js`**

This file exports a `renderSpecializations(container, specs)` function that produces the desktop's spec card DOM. Study `src/renderer/modules/specializations.js` and `src/renderer/styles/specializations.css` for the exact structure.

Key DOM structure to produce:
```html
<div class="specializations-host">
  <article class="spec-card">
    <div class="spec-card__panel [spec-card__panel--elite]" style="background-image:url(BACKGROUND)">
      <div class="spec-card__body">
        <div class="spec-emblem [spec-emblem--elite]"><img src="ICON" /></div>
        <!-- 3 tiers, each: minor anchor + major column -->
        <div class="trait-minor-anchor">
          <button class="trait-btn trait-btn--always" disabled><img src="MINOR_ICON" /></button>
        </div>
        <div class="trait-column trait-column--major">
          <button class="trait-btn [trait-btn--active]" disabled data-name="NAME" data-desc="DESC"><img src="ICON" /></button>
          <!-- ×3 per tier -->
        </div>
        <!-- repeat for tiers 2, 3 -->
      </div>
    </div>
  </article>
</div>
```

All buttons are `disabled` (read-only). Add `data-name` and `data-desc` for tooltip hover.

- [ ] **Step 2: Wire into main.js**

Import `renderSpecializations` in `main.js` and call it from `renderBuild()` to replace the placeholder.

- [ ] **Step 3: Build and verify visually**

Run: `npm run build:site`
Verify the spec cards render with background images, trait grids, and proper styling.

- [ ] **Step 4: Commit**

```bash
git add src/site/render-specs.js src/site/main.js
git commit -m "feat: add read-only specialization renderer matching desktop DOM"
```

---

### Task 5: Skills Renderer

**Files:**
- Create: `src/site/render-skills.js`

- [ ] **Step 1: Create `src/site/render-skills.js`**

Produces the desktop's skill bar structure. Uses enriched data: `build.weaponSkills`, `build.professionMechanics`, `build.skills`, `build.underwaterSkills`, `build.legendDisplay`, `build.petDisplay`.

Key sections:
- Weapon skills row with 5 icons per set
- Profession mechanics bar (F1-F5)
- Heal/utility/elite bar
- Underwater skills (if applicable)
- Legend/pet/attunement display

All using the desktop CSS classes: `skills-bar__weapon-col`, `skills-bar__weapon-row`, `skill-group`, `skill-icon-large`, `skill-slot-label`, `profession-mechanics-bar`, `skill-icon--profession`, etc.

- [ ] **Step 2: Wire into main.js and build**
- [ ] **Step 3: Commit**

```bash
git add src/site/render-skills.js src/site/main.js
git commit -m "feat: add read-only skills renderer with weapon skills and F-skills"
```

---

### Task 6: Equipment Renderer

**Files:**
- Create: `src/site/render-equipment.js`

- [ ] **Step 1: Create `src/site/render-equipment.js`**

Produces the desktop's `equip-layout` 3-column grid. Uses the enriched build data.

Key sections:
- Left column: armor slots with stats + runes, weapon slots with sigils, consumables (food/utility)
- Center column: profession icon SVG (`build.professionIcon`)
- Right column: stat summary (if `build.stats` present), trinket grid, underwater gear
- Notes display (read-only div)

Uses desktop CSS classes: `equip-layout`, `equip-col`, `equip-section`, `equip-slot`, `equip-slot--compact`, `equip-slot--weapon`, `equip-upgrade-btn`, etc.

- [ ] **Step 2: Wire into main.js and build**
- [ ] **Step 3: Commit**

```bash
git add src/site/render-equipment.js src/site/main.js
git commit -m "feat: add read-only equipment renderer with 3-column layout"
```

---

### Task 7: Build Header + Tabs + Detail Panel

**Files:**
- Create: `src/site/render-build.js`
- Create: `src/site/render-detail.js`
- Modify: `src/site/main.js`

- [ ] **Step 1: Create `src/site/render-build.js`**

Orchestrates the page:
- Build header with profession icon SVG + title + meta + tags
- Tab bar (BUILD / EQUIPMENT)
- Tab content switching
- Wires up spec/skill/equipment renderers

- [ ] **Step 2: Create `src/site/render-detail.js`**

Hover preview using the desktop's `.hover-preview` structure:
- `mouseover` delegation on `[data-name]` elements
- Shows icon, name, description
- Positioned near hovered element
- Hidden on `mouseout`

- [ ] **Step 3: Update `src/site/main.js`**

Replace the placeholder `renderBuild()` with imports from render-build.js. Wire up the detail panel.

- [ ] **Step 4: Build and verify end-to-end**

Run: `npm run build:site && npm run dev`
Publish a build and verify the full page renders correctly.

- [ ] **Step 5: Commit**

```bash
git add src/site/render-build.js src/site/render-detail.js src/site/main.js
git commit -m "feat: add build header, tab switching, and hover detail panel"
```

---

## Chunk 4: Integration & Cleanup

### Task 8: Update Electron Builder Config

**Files:**
- Modify: `package.json` or `electron-builder.yml` (whichever has the build config)

- [ ] **Step 1: Add `dist/site` to the packaged app files**

Ensure the electron-builder config includes the pre-built site files so they're available in the packaged `.exe`/`.AppImage`.

- [ ] **Step 2: Verify packaged build works**

Run: `npm run build:app:linux` (or `build:app:win`)
Verify the packaged app can publish builds successfully.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: include dist/site in packaged Electron app"
```

---

### Task 9: Update Integration Tests

**Files:**
- Modify: `tests/integration/buildWorkflow.test.js`

- [ ] **Step 1: Update integration tests for new siteBundle API**

The integration tests should verify that `buildSpaBundle()` returns the Vite-built files and that `buildEncryptedBuildFile()` still works.

- [ ] **Step 2: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/buildWorkflow.test.js
git commit -m "fix: update integration tests for Vite-built site bundle"
```

---

### Task 10: End-to-End Testing

- [ ] **Step 1: Start dev app** — `npm run dev`
- [ ] **Step 2: Create a build** with specs, skills, and equipment configured
- [ ] **Step 3: Publish the build** and verify progress steps complete
- [ ] **Step 4: Open the published URL** and verify:
  - Spec cards with background images and trait grids
  - Weapon skills (1-5) shown
  - F-skills / profession mechanics shown
  - Equipment panel with armor, weapons, trinkets, stats
  - Profession icon in header and equipment center column
  - Hover tooltips work on traits and skills
  - Tab switching works
- [ ] **Step 5: Test with multiple professions** (at least Necromancer, Warrior, Elementalist, Revenant, Ranger)
- [ ] **Step 6: Commit any fixes**

```bash
git add -p
git commit -m "fix: address issues found during e2e testing"
```
