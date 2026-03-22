# E2E Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational infrastructure for Playwright E2E tests — production code changes, mock API server, Playwright config, helper modules, and a smoke test that launches the real Electron app.

**Architecture:** Playwright's `_electron.launch()` starts the real app with `APP_PROFILE=e2e-test` for data isolation and `GW2_API_ROOT` pointing at a local mock HTTP server. Helper modules provide reusable app launch, navigation, editor interaction, and data seeding utilities. A single smoke-test spec validates the full pipeline.

**Tech Stack:** Playwright (Electron API), Node.js `http` module (mock server), existing GW2 API fixtures

**Spec:** `docs/superpowers/specs/2026-03-22-e2e-test-suite-design.md`

---

## File Structure

```
src/main/index.js                         # Modify: generalize APP_PROFILE (lines 29-33)
src/main/gw2Data/fetch.js                 # Modify: make GW2_API_ROOT env-configurable (line 1)
package.json                              # Modify: add test:e2e scripts

tests/e2e/
  playwright.config.js                    # Playwright config for Electron
  mock-server/
    server.js                             # HTTP mock server
    routes.js                             # Route handler mapping endpoints to fixtures
  fixtures/
    capture.js                            # Script to capture real API snapshots
    professions.json                      # Profession data (all 9)
    necromancer-catalog.json              # Full catalog for primary test profession
  helpers/
    app.js                                # launchApp(), closeApp(), cleanDataDir()
    nav.js                                # goToEditor(), goToLibrary(), switchTab()
    editor.js                             # selectProfession(), addSpec(), selectSkill()
    data.js                               # seedBuildFile(), seedBuildIPC(), clearData()
  specs/
    smoke.spec.js                         # Smoke test: app launches, loads profession, saves build
```

---

### Task 1: Production code changes

Two one-line changes to make the app testable. No behavior change in production.

**Files:**
- Modify: `src/main/index.js:29-33`
- Modify: `src/main/gw2Data/fetch.js:1`

- [ ] **Step 1: Generalize APP_PROFILE in index.js**

In `src/main/index.js`, replace lines 29-33:

```js
// Before:
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

- [ ] **Step 2: Make GW2_API_ROOT env-configurable in fetch.js**

In `src/main/gw2Data/fetch.js`, replace line 1:

```js
// Before:
const GW2_API_ROOT = "https://api.guildwars2.com/v2";

// After:
const GW2_API_ROOT = process.env.GW2_API_ROOT || "https://api.guildwars2.com/v2";
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx jest --verbose`
Expected: All tests pass (the mock in tests/helpers/mockFetch.js mocks fetch at the global level, so the env var change doesn't affect unit tests)

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/main/gw2Data/fetch.js
git commit -m "chore: make APP_PROFILE and GW2_API_ROOT env-configurable for E2E testing"
```

---

### Task 2: Add npm scripts and Playwright config

**Files:**
- Modify: `package.json`
- Create: `tests/e2e/playwright.config.js`

- [ ] **Step 1: Add npm scripts to package.json**

Add to the `"scripts"` object:

```json
"test:e2e": "npx playwright test --config tests/e2e/playwright.config.js",
"test:e2e:headed": "npx playwright test --config tests/e2e/playwright.config.js --headed",
"test:e2e:debug": "PWDEBUG=1 npx playwright test --config tests/e2e/playwright.config.js"
```

- [ ] **Step 2: Create Playwright config**

Write `tests/e2e/playwright.config.js`:

```js
// @ts-check
const path = require("path");

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 30_000,
  retries: 1,
  workers: 1, // Sequential — Electron instances can't run in parallel
  use: {
    trace: "on-first-retry",
  },
};
// Note: no globalSetup/globalTeardown. The mock server is started/stopped
// per spec file inside app.js launchApp()/closeApp(), since workers:1
// means only one spec runs at a time and Playwright runs globalSetup
// in a separate process (server references wouldn't transfer).
```

- [ ] **Step 3: Commit**

```bash
git add package.json tests/e2e/playwright.config.js
git commit -m "chore: add Playwright E2E config and npm scripts"
```

---

### Task 3: Capture API fixtures and build mock server

Capture real GW2 API responses for the primary test profession (Necromancer), then build a mock HTTP server that serves them.

**Files:**
- Create: `tests/e2e/fixtures/capture.js`
- Create: `tests/e2e/fixtures/professions.json`
- Create: `tests/e2e/fixtures/necromancer-catalog.json`
- Create: `tests/e2e/mock-server/server.js`
- Create: `tests/e2e/mock-server/routes.js`

- [ ] **Step 1: Create the fixture capture script**

Write `tests/e2e/fixtures/capture.js`. This is a one-time utility that fetches real GW2 API data and saves it as JSON fixtures:

```js
#!/usr/bin/env node
/**
 * Capture GW2 API responses for E2E test fixtures.
 * Run once: node tests/e2e/fixtures/capture.js
 */
const fs = require("fs/promises");
const path = require("path");

const API = "https://api.guildwars2.com/v2";
const OUT = __dirname;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchByIds(endpoint, ids) {
  const results = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const data = await fetchJson(`${API}/${endpoint}?ids=${chunk.join(",")}`);
    results.push(...data);
  }
  return results;
}

async function main() {
  console.log("Fetching profession list...");
  const profIds = await fetchJson(`${API}/professions`);
  const profs = await fetchByIds("professions", profIds);
  await fs.writeFile(path.join(OUT, "professions.json"), JSON.stringify(profs, null, 2));
  console.log(`  Saved ${profs.length} professions`);

  // Capture full catalog for Necromancer
  const necro = profs.find((p) => p.id === "Necromancer");
  if (!necro) throw new Error("Necromancer not found");

  const specIds = necro.specializations;
  const specs = await fetchByIds("specializations", specIds);

  const traitIds = specs.flatMap((s) => [...s.minor_traits, ...s.major_traits]);
  const traits = await fetchByIds("traits", traitIds);

  const skillIds = [
    ...necro.skills.map((s) => s.id),
    ...Object.values(necro.weapons).flatMap((w) => w.skills.map((s) => s.id)),
  ];
  const skills = await fetchByIds("skills", [...new Set(skillIds)]);

  const catalog = { profession: necro, specializations: specs, traits, skills };
  await fs.writeFile(path.join(OUT, "necromancer-catalog.json"), JSON.stringify(catalog, null, 2));
  console.log(`  Saved Necromancer catalog (${specs.length} specs, ${traits.length} traits, ${skills.length} skills)`);

  console.log("Done!");
}

main().catch(console.error);
```

- [ ] **Step 2: Run the capture script**

```bash
node tests/e2e/fixtures/capture.js
```

Expected: Creates `professions.json` and `necromancer-catalog.json` in `tests/e2e/fixtures/`.

- [ ] **Step 3: Create the mock server routes**

Write `tests/e2e/mock-server/routes.js`:

```js
const path = require("path");
const fs = require("fs");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const professions = JSON.parse(fs.readFileSync(path.join(FIXTURES, "professions.json"), "utf-8"));
const necroCatalog = JSON.parse(fs.readFileSync(path.join(FIXTURES, "necromancer-catalog.json"), "utf-8"));

// Index data by ID for fast lookup
const allSpecs = Object.fromEntries(necroCatalog.specializations.map((s) => [s.id, s]));
const allTraits = Object.fromEntries(necroCatalog.traits.map((t) => [t.id, t]));
const allSkills = Object.fromEntries(necroCatalog.skills.map((s) => [s.id, s]));

function parseIds(url) {
  const match = url.match(/[?&]ids=([^&]+)/);
  if (!match) return null; // no ids param → return null (bare endpoint)
  if (match[1] === "all") return "all"; // signal "return all"
  return match[1].split(",");
}

function handleRequest(method, url) {
  const pathname = new URL(url, "http://localhost").pathname;
  const ids = parseIds(url);

  // GET /v2/professions
  if (pathname === "/v2/professions" && ids === null) {
    return professions.map((p) => p.id);
  }
  if (pathname === "/v2/professions" && Array.isArray(ids)) {
    return professions.filter((p) => ids.includes(p.id));
  }

  // GET /v2/specializations?ids=...
  if (pathname === "/v2/specializations" && Array.isArray(ids)) {
    return ids.map((id) => allSpecs[id]).filter(Boolean);
  }

  // GET /v2/traits?ids=...
  if (pathname === "/v2/traits" && Array.isArray(ids)) {
    return ids.map((id) => allTraits[id]).filter(Boolean);
  }

  // GET /v2/skills (bare = ID list) or /v2/skills?ids=...
  if (pathname === "/v2/skills" && ids === null) {
    return Object.keys(allSkills).map(Number);
  }
  if (pathname === "/v2/skills" && ids === "all") {
    return Object.values(allSkills);
  }
  if (pathname === "/v2/skills" && Array.isArray(ids)) {
    return ids.map((id) => allSkills[id]).filter(Boolean);
  }

  // GET /v2/legends
  if (pathname === "/v2/legends" && ids === null) {
    return []; // No legends in Necromancer fixtures
  }
  if (pathname === "/v2/legends" && Array.isArray(ids)) {
    return [];
  }

  // GET /v2/pets?ids=all
  if (pathname === "/v2/pets") {
    return [];
  }

  // GET /v2/items?ids=...
  if (pathname === "/v2/items") {
    return []; // Equipment fixtures added later
  }

  return null; // 404
}

module.exports = { handleRequest };
```

- [ ] **Step 4: Create the mock server**

Write `tests/e2e/mock-server/server.js`:

```js
const http = require("http");
const { handleRequest } = require("./routes");

const PORT = 9877;
let server;

function start() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const result = handleRequest(req.method, req.url);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (result === null) {
        res.writeHead(404);
        res.end(JSON.stringify({ text: "not found" }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    });

    server.listen(PORT, () => {
      console.log(`Mock GW2 API server listening on http://localhost:${PORT}`);
      resolve();
    });
    server.on("error", reject);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

module.exports = { start, stop, PORT };
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/fixtures/ tests/e2e/mock-server/
git commit -m "feat(e2e): add mock GW2 API server and fixture capture script"
```

---

### Task 4: Implement helper modules

**Files:**
- Create: `tests/e2e/helpers/app.js`
- Create: `tests/e2e/helpers/nav.js`
- Create: `tests/e2e/helpers/editor.js`
- Create: `tests/e2e/helpers/data.js`

- [ ] **Step 1: Create app.js helper**

Write `tests/e2e/helpers/app.js`:

```js
const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const mockServer = require("../mock-server/server");

const MOCK_PORT = mockServer.PORT;

// app.getName() for unpackaged Electron returns package.json "name" field
const APP_NAME = "axiforge-desktop";
const DATA_DIR = getDataDir();

function getDataDir() {
  const appData = process.env.XDG_CONFIG_HOME || path.join(require("os").homedir(), ".config");
  return path.join(appData, `${APP_NAME}-e2e-test`, "data");
}

function cleanDataDir() {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function launchApp() {
  cleanDataDir();

  // Start mock server (workers:1 so only one spec runs at a time)
  await mockServer.start();

  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      APP_PROFILE: "e2e-test",
      GW2_API_ROOT: `http://localhost:${MOCK_PORT}/v2`,
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  // Wait for the app to finish initializing (profession selector appears)
  await window.waitForSelector("#professionSelect", { timeout: 10_000 });
  return { app, window };
}

async function closeApp(app) {
  if (app) await app.close();
  await mockServer.stop();
}

module.exports = { launchApp, closeApp, cleanDataDir, DATA_DIR };
```

- [ ] **Step 2: Create nav.js helper**

Write `tests/e2e/helpers/nav.js`:

```js
/**
 * Navigation helpers for E2E tests.
 * These interact with the app's top-level navigation.
 */

async function goToEditor(window) {
  // The editor is the default view — navigate via subnav if needed
  const editorTab = await window.$('#subnav [data-tab="build"], #subnav .tab-build');
  if (editorTab) await editorTab.click();
  await window.waitForTimeout(300);
}

async function goToLibrary(window) {
  const libBtn = await window.$('#lib-sidebar .nav-item[data-view="library"], [data-nav="library"]');
  if (libBtn) await libBtn.click();
  await window.waitForTimeout(300);
}

async function goToComps(window) {
  const compBtn = await window.$('#lib-sidebar .nav-item[data-view="comps"], [data-nav="comps"]');
  if (compBtn) await compBtn.click();
  await window.waitForTimeout(300);
}

async function switchTab(window, tabName) {
  // tabName: "build", "equipment", "notes"
  const tab = await window.$(`#subnav [data-tab="${tabName}"]`);
  if (tab) await tab.click();
  await window.waitForTimeout(300);
}

module.exports = { goToEditor, goToLibrary, goToComps, switchTab };
```

- [ ] **Step 3: Create editor.js helper**

Write `tests/e2e/helpers/editor.js`:

```js
/**
 * Editor interaction helpers for E2E tests.
 * These interact with the build editor UI elements.
 */

async function selectProfession(window, name) {
  // Use selectOption for native <select> elements
  await window.selectOption("#professionSelect", { label: name });
  // Wait for catalog to load from mock server
  await window.waitForTimeout(1500);
}

async function setTitle(window, title) {
  await window.fill("#editorTitle", title);
}

async function setGameMode(window, mode) {
  // mode: "pve" or "wvw"
  await window.click(`[data-game-mode="${mode}"], .game-mode-tab:has-text("${mode.toUpperCase()}")`);
  await window.waitForTimeout(500);
}

async function saveBuild(window) {
  await window.click("#saveBuildBtn");
  await window.waitForTimeout(500);
}

module.exports = { selectProfession, setTitle, setGameMode, saveBuild };
```

- [ ] **Step 4: Create data.js helper**

Write `tests/e2e/helpers/data.js`:

```js
/**
 * Data seeding helpers for E2E tests.
 *
 * Two modes:
 * - Pre-launch: write JSON files directly (use before launchApp())
 * - Live: use IPC via renderer (use while app is running)
 */

const path = require("path");
const fs = require("fs");
const { DATA_DIR } = require("./app");

// ── Pre-launch seeding (file-based) ──

function seedBuildFile(build) {
  const filePath = path.join(DATA_DIR, "builds.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(build);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function seedCompFile(comp) {
  const filePath = path.join(DATA_DIR, "comps.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(comp);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function seedFolderFile(folder) {
  const filePath = path.join(DATA_DIR, "folders.json");
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : [];
  existing.push(folder);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

function clearData() {
  for (const file of ["builds.json", "comps.json", "folders.json", "settings.json"]) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// ── Live seeding (IPC-based) ──

async function seedBuildIPC(window, build) {
  return window.evaluate((b) => window.desktopApi.saveBuild(b), build);
}

async function seedCompIPC(window, comp) {
  return window.evaluate((c) => window.desktopApi.saveComp(c), comp);
}

module.exports = { seedBuildFile, seedCompFile, seedFolderFile, clearData, seedBuildIPC, seedCompIPC };
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/helpers/
git commit -m "feat(e2e): add app, nav, editor, and data helper modules"
```

---

### Task 5: Write smoke test spec

A single spec file that validates the full E2E pipeline: mock server → Electron launch → load profession → interact with editor → save build.

**Files:**
- Create: `tests/e2e/specs/smoke.spec.js`

- [ ] **Step 1: Write the smoke test**

Write `tests/e2e/specs/smoke.spec.js`:

```js
const { test, expect } = require("@playwright/test");
const { launchApp, closeApp } = require("../helpers/app");

test.describe("Smoke test", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("app launches and shows profession selector", async () => {
    // The profession selector should be visible
    const profSelect = window.locator("#professionSelect");
    await expect(profSelect).toBeVisible({ timeout: 10_000 });
  });

  test("profession selector contains options", async () => {
    // Should have profession options loaded from mock server
    const options = await window.locator("#professionSelect option").count();
    // At minimum, Necromancer should be available from our fixtures
    expect(options).toBeGreaterThan(0);
  });

  test("can select a profession and see specializations load", async () => {
    // Select Necromancer
    await window.selectOption("#professionSelect", "Necromancer");
    await window.waitForTimeout(2000); // Wait for catalog load

    // Specialization host should have content
    const specHost = window.locator("#specializationsHost");
    await expect(specHost).toBeVisible();
  });

  test("can set build title", async () => {
    await window.fill("#editorTitle", "Test Necro Build");
    const titleValue = await window.inputValue("#editorTitle");
    expect(titleValue).toBe("Test Necro Build");
  });

  test("can save build", async () => {
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);
    // After save, the dirty indicator should be gone
    // (exact selector TBD during implementation — just verify no crash)
  });

  test("window controls are visible", async () => {
    await expect(window.locator("#winMin")).toBeVisible();
    await expect(window.locator("#winMax")).toBeVisible();
    await expect(window.locator("#winClose")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
npm run test:e2e
```

Expected: All 6 tests pass. The mock server starts, Electron launches, interacts with the UI, and closes cleanly.

- [ ] **Step 3: Debug and fix any selector issues**

The selectors in the smoke test and helpers are based on spec-documented IDs. If any don't match the actual DOM, fix them now. Use the headed mode to inspect:

```bash
npm run test:e2e:headed
```

Document any selector corrections needed for the helpers.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/smoke.spec.js
git commit -m "feat(e2e): add smoke test validating full E2E pipeline"
```

---

### Task 6: Verify full pipeline and finalize

- [ ] **Step 1: Run the full E2E suite (just smoke test for now)**

```bash
npm run test:e2e
```

Expected: Passes cleanly.

- [ ] **Step 2: Run the headed variant to visually verify**

```bash
npm run test:e2e:headed
```

Expected: See the Electron app launch, profession load, title set, save button clicked, then close.

- [ ] **Step 3: Run existing unit tests to confirm no regressions**

```bash
npx jest --verbose
```

Expected: All existing tests pass.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A tests/e2e/
git commit -m "fix(e2e): address issues found during pipeline verification"
```
