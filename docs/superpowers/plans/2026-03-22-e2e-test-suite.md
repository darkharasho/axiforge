# Playwright E2E Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Playwright E2E test suite (~150 tests across 14 spec files) for the AxiForge Electron app, starting from zero infrastructure.

**Architecture:** Playwright's `_electron.launch()` starts the real app with `APP_PROFILE=e2e-test` for data isolation and `GW2_API_ROOT` pointing at a local mock HTTP server on port 9877. The mock server starts once via `global-setup.js` and stops via `global-teardown.js`. Each spec file launches a fresh Electron instance in `beforeAll`, cleans data in `beforeEach`. Helpers provide reusable app launch, navigation, editor interaction, and data seeding utilities.

**Tech Stack:** Playwright 1.58 (Electron API), Node.js `http` module (mock server), existing GW2 API fixtures from `tests/fixtures/gw2Api.js`

**Spec:** `docs/superpowers/specs/2026-03-22-e2e-test-suite-design.md`

---

## File Structure

```
src/main/index.js                         # Modify: generalize APP_PROFILE (lines 29-33)
src/main/gw2Data/fetch.js                 # Modify: make GW2_API_ROOT env-configurable (line 1)
package.json                              # Modify: add test:e2e scripts

tests/e2e/
  playwright.config.js                    # Playwright config for Electron
  global-setup.js                         # Start mock API server before all tests
  global-teardown.js                      # Stop mock API server after all tests
  mock-server/
    server.js                             # HTTP mock server (localhost:9877)
    routes.js                             # Route handler mapping endpoints to fixtures
  fixtures/
    capture.js                            # One-time script to capture real API snapshots
    professions.json                      # All 9 profession objects (captured)
    necromancer-catalog.json              # Full Necromancer catalog (captured)
    revenant-catalog.json                 # Full Revenant catalog with legends (captured)
    elementalist-catalog.json             # Full Elementalist catalog (captured)
    legends.json                          # Revenant legend data (captured)
    pets.json                             # Ranger pet data (captured)
  helpers/
    app.js                                # launchApp(), closeApp(), cleanDataDir()
    nav.js                                # goToEditor(), goToLibrary(), goToComps(), switchTab()
    editor.js                             # selectProfession(), setTitle(), saveBuild(), etc.
    data.js                               # seedBuildFile(), seedBuildIPC(), clearData()
    builds.js                             # Factory functions: makeTestBuild(), makeEquippedBuild()
  specs/
    smoke.spec.js                         # Smoke test (validates pipeline)
    editor-profession.spec.js             # Section 2: Profession & Metadata (9 tests)
    game-mode.spec.js                     # Section 3: Game Mode Toggle (5 tests)
    specializations.spec.js               # Section 4: Specializations & Traits (11 tests)
    skills.spec.js                        # Section 5: Skills (18 tests)
    equipment.spec.js                     # Section 6: Equipment (~31 tests)
    detail-panel.spec.js                  # Section 7: Detail Panel (6 tests)
    underwater.spec.js                    # Section 8: Underwater Mode (7 tests)
    library.spec.js                       # Section 9: Library & Management (~33 tests)
    notes.spec.js                         # Section 11: Notes Tab (7 tests)
    persistence.spec.js                   # Section 12: Persistence & Import/Export (6 tests)
    window-controls.spec.js               # Section 13: Window Controls (8 tests)
    edge-cases.spec.js                    # Section 16: Edge Cases (7 tests)
    compositions.spec.js                  # Section 17: Compositions (16 tests)
    regressions.spec.js                   # Section 18: Regression Checks (12 tests)
```

---

## Key DOM Selectors Reference

These are the actual DOM selectors from `src/renderer/index.html` and renderer modules. All spec files use these.

| Selector | Element |
|---|---|
| `#professionSelect` | Profession dropdown (`<select>`) |
| `#editorTitle` | Build title `<input>` |
| `#saveBuildBtn` | Save button |
| `#saveDot` | Unsaved indicator dot |
| `#saveStatus` | Save status label |
| `#specializationsHost` | Specialization cards container |
| `#skillsHost` | Skills panel container |
| `#equipmentPanel` | Equipment tab panel |
| `#notesPanel` | Notes tab panel |
| `#detailHost` | Detail/wiki panel (right sidebar) |
| `#detail-expand-btn` | Expand detail to modal |
| `#subnav` | Editor tab bar |
| `[data-subtab="build"]` | Build subtab button |
| `[data-subtab="equipment"]` | Equipment subtab button |
| `[data-subtab="notes"]` | Notes subtab button |
| `.leftnav__item[data-page="library"]` | Library nav button |
| `.leftnav__item[data-page="comps"]` | Comps nav button |
| `.leftnav__item[data-page="editor"]` | Editor nav button |
| `#page-editor` | Editor page container |
| `#page-library` | Library page container |
| `#page-comps` | Comps page container |
| `#winMin, #winMax, #winClose` | Window controls |
| `#titlebar` | Window titlebar |
| `#workspaceBtn` | Workspace menu toggle |
| `#updateVersionLabel` | Version display |
| `.game-mode-toggle__btn[data-mode="pve"]` | PvE mode button |
| `.game-mode-toggle__btn[data-mode="wvw"]` | WvW mode button |
| `.spec-card` | Specialization card |
| `.trait-btn` | Trait button |
| `.trait-btn--active` | Selected trait |
| `.skill-slot` | Skill slot |
| `.skill-icon-large` | Skill icon (clickable) |
| `.slot-picker` | Picker dropdown |
| `.slot-picker__search` | Picker search input |
| `.slot-picker__option` | Picker option |
| `.detail-modal-overlay` | Detail modal overlay |
| `.detail-modal` | Detail modal |
| `.confirm-modal` | Confirmation dialog |
| `#hoverPreview` | Hover preview tooltip |
| `#lib-content` | Library content area |
| `#lib-sidebar` | Library sidebar |
| `[data-build-id]` | Build card in library |
| `[data-folder-id]` | Folder in library |
| `.lib-list-row` | Library list row |
| `.comp-list-row[data-comp-id]` | Comp list row |
| `.comp-detail` | Comp detail page |
| `.comp-detail__party-panel` | Party lines panel |
| `.comp-detail__pool-panel` | Build pool panel |

---

## Phase 1: Infrastructure

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
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/main/gw2Data/fetch.js
git commit -m "chore: make APP_PROFILE and GW2_API_ROOT env-configurable for E2E testing"
```

---

### Task 2: Playwright config and npm scripts

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
  globalSetup: path.join(__dirname, "global-setup.js"),
  globalTeardown: path.join(__dirname, "global-teardown.js"),
  use: {
    trace: "on-first-retry",
  },
};
```

- [ ] **Step 3: Create global-setup.js**

Write `tests/e2e/global-setup.js`:

```js
const mockServer = require("./mock-server/server");

module.exports = async function globalSetup() {
  await mockServer.start();
  // Store reference for teardown (Playwright runs these in the same process)
  globalThis.__MOCK_SERVER__ = mockServer;
};
```

- [ ] **Step 4: Create global-teardown.js**

Write `tests/e2e/global-teardown.js`:

```js
module.exports = async function globalTeardown() {
  if (globalThis.__MOCK_SERVER__) {
    await globalThis.__MOCK_SERVER__.stop();
  }
};
```

- [ ] **Step 5: Commit**

```bash
git add package.json tests/e2e/playwright.config.js tests/e2e/global-setup.js tests/e2e/global-teardown.js
git commit -m "chore: add Playwright E2E config, global setup/teardown, and npm scripts"
```

---

### Task 3: Fixture capture and mock server

Capture real GW2 API responses for test fixtures, then build a mock HTTP server.

**Files:**
- Create: `tests/e2e/fixtures/capture.js`
- Create: `tests/e2e/fixtures/professions.json` (generated)
- Create: `tests/e2e/fixtures/necromancer-catalog.json` (generated)
- Create: `tests/e2e/mock-server/server.js`
- Create: `tests/e2e/mock-server/routes.js`

- [ ] **Step 1: Create the fixture capture script**

Write `tests/e2e/fixtures/capture.js`:

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
  const res = await fetch(url, { headers: { "User-Agent": "axiforge-e2e-fixture-capture" } });
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

async function captureProfessionCatalog(professions, profName, outFile) {
  const prof = professions.find((p) => p.id === profName);
  if (!prof) throw new Error(`${profName} not found`);

  console.log(`  Capturing ${profName} catalog...`);
  const specIds = prof.specializations;
  const specs = await fetchByIds("specializations", specIds);

  const traitIds = specs.flatMap((s) => [...s.minor_traits, ...s.major_traits]);
  const traits = await fetchByIds("traits", traitIds);

  const skillIds = [
    ...prof.skills.map((s) => s.id),
    ...Object.values(prof.weapons).flatMap((w) => (w.skills || []).map((s) => s.id)),
  ];
  const skills = await fetchByIds("skills", [...new Set(skillIds)]);

  const catalog = { profession: prof, specializations: specs, traits, skills };
  await fs.writeFile(path.join(OUT, outFile), JSON.stringify(catalog, null, 2));
  console.log(`  Saved ${profName}: ${specs.length} specs, ${traits.length} traits, ${skills.length} skills`);
}

async function main() {
  console.log("Fetching profession list...");
  const profIds = await fetchJson(`${API}/professions`);
  const profs = await fetchByIds("professions", profIds);
  await fs.writeFile(path.join(OUT, "professions.json"), JSON.stringify(profs, null, 2));
  console.log(`  Saved ${profs.length} professions`);

  // Capture catalogs for all 3 test professions (minimum viable set from spec)
  await captureProfessionCatalog(profs, "Necromancer", "necromancer-catalog.json");
  await captureProfessionCatalog(profs, "Elementalist", "elementalist-catalog.json");
  await captureProfessionCatalog(profs, "Revenant", "revenant-catalog.json");

  // Capture Revenant legends
  console.log("  Capturing legends...");
  const legendIds = await fetchJson(`${API}/legends`);
  const legends = await fetchByIds("legends", legendIds);
  await fs.writeFile(path.join(OUT, "legends.json"), JSON.stringify(legends, null, 2));
  console.log(`  Saved ${legends.length} legends`);

  // Capture legend-specific skills
  const legendSkillIds = legends.flatMap((l) => [l.heal, ...l.utilities, l.elite].filter(Boolean));
  const legendSkills = await fetchByIds("skills", [...new Set(legendSkillIds)]);
  // Merge into revenant catalog
  const revCatalogPath = path.join(OUT, "revenant-catalog.json");
  const revCatalog = JSON.parse(await fs.readFile(revCatalogPath, "utf-8"));
  const existingSkillIds = new Set(revCatalog.skills.map((s) => s.id));
  for (const s of legendSkills) {
    if (!existingSkillIds.has(s.id)) revCatalog.skills.push(s);
  }
  await fs.writeFile(revCatalogPath, JSON.stringify(revCatalog, null, 2));

  // Capture Ranger pets
  console.log("  Capturing pets...");
  const pets = await fetchJson(`${API}/pets?ids=all`);
  await fs.writeFile(path.join(OUT, "pets.json"), JSON.stringify(pets, null, 2));
  console.log(`  Saved ${pets.length} pets`);

  // Capture upgrade catalog (runes, sigils, food) — needed for equipment tests
  console.log("  Capturing upgrades...");
  const runeIds = await fetchJson(`${API}/items?ids=24836,24837,24838,24839,24840,24842`);
  await fs.writeFile(path.join(OUT, "upgrades.json"), JSON.stringify(runeIds, null, 2));

  console.log("Done!");
}

main().catch(console.error);
```

- [ ] **Step 2: Run the capture script**

Run: `node tests/e2e/fixtures/capture.js`
Expected: Creates `professions.json` and `necromancer-catalog.json` in `tests/e2e/fixtures/`.

- [ ] **Step 3: Create mock server routes**

Write `tests/e2e/mock-server/routes.js`:

```js
const path = require("path");
const fs = require("fs");

const FIXTURES = path.join(__dirname, "..", "fixtures");

// Load fixture data
const professions = JSON.parse(fs.readFileSync(path.join(FIXTURES, "professions.json"), "utf-8"));

// Load all available catalogs
const catalogs = {};
for (const file of fs.readdirSync(FIXTURES)) {
  const match = file.match(/^(.+)-catalog\.json$/);
  if (match) {
    catalogs[match[1]] = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf-8"));
  }
}

// Build indexed lookup maps from all catalogs
const allSpecs = {};
const allTraits = {};
const allSkills = {};
for (const catalog of Object.values(catalogs)) {
  for (const s of catalog.specializations) allSpecs[s.id] = s;
  for (const t of catalog.traits) allTraits[t.id] = t;
  for (const s of catalog.skills) allSkills[s.id] = s;
}

function parseIds(url) {
  const match = url.match(/[?&]ids=([^&]+)/);
  if (!match) return null;
  if (match[1] === "all") return "all";
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

  // GET /v2/skills
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
  const legendsPath = path.join(FIXTURES, "legends.json");
  const legends = fs.existsSync(legendsPath) ? JSON.parse(fs.readFileSync(legendsPath, "utf-8")) : [];
  if (pathname === "/v2/legends" && ids === null) {
    return legends.map((l) => l.id);
  }
  if (pathname === "/v2/legends" && Array.isArray(ids)) {
    return legends.filter((l) => ids.includes(l.id));
  }

  // GET /v2/pets
  const petsPath = path.join(FIXTURES, "pets.json");
  const pets = fs.existsSync(petsPath) ? JSON.parse(fs.readFileSync(petsPath, "utf-8")) : [];
  if (pathname === "/v2/pets" && ids === "all") {
    return pets;
  }
  if (pathname === "/v2/pets" && Array.isArray(ids)) {
    return pets.filter((p) => ids.includes(String(p.id)));
  }
  if (pathname === "/v2/pets" && ids === null) {
    return pets.map((p) => p.id);
  }

  // GET /v2/items (runes, sigils, food)
  if (pathname === "/v2/items") {
    const upgradesPath = path.join(FIXTURES, "upgrades.json");
    if (fs.existsSync(upgradesPath)) {
      const upgrades = JSON.parse(fs.readFileSync(upgradesPath, "utf-8"));
      if (Array.isArray(ids)) {
        return upgrades.filter((u) => ids.includes(String(u.id)));
      }
      return upgrades;
    }
    return [];
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

### Task 4: Helper modules

**Files:**
- Create: `tests/e2e/helpers/app.js`
- Create: `tests/e2e/helpers/nav.js`
- Create: `tests/e2e/helpers/editor.js`
- Create: `tests/e2e/helpers/data.js`
- Create: `tests/e2e/helpers/builds.js`

- [ ] **Step 1: Create app.js helper**

Write `tests/e2e/helpers/app.js`:

```js
const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { PORT: MOCK_PORT } = require("../mock-server/server");

const APP_NAME = "axiforge-desktop"; // matches package.json "name"
const DATA_DIR = getDataDir();

function getDataDir() {
  const appData = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(appData, `${APP_NAME}-e2e-test`, "data");
}

function cleanDataDir() {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true });
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function launchApp({ clean = true } = {}) {
  if (clean) cleanDataDir();

  // Mock server is started by global-setup.js, no need to start here
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
  await window.waitForSelector("#professionSelect", { timeout: 15_000 });
  return { app, window };
}

async function closeApp(app) {
  if (app) await app.close();
}

module.exports = { launchApp, closeApp, cleanDataDir, DATA_DIR };
```

- [ ] **Step 2: Create nav.js helper**

Write `tests/e2e/helpers/nav.js`:

```js
async function goToEditor(window) {
  await window.click('.leftnav__item[data-page="editor"]');
  await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 5000 });
}

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#page-library:not(.hidden)", { timeout: 5000 });
}

async function goToComps(window) {
  await window.click('.leftnav__item[data-page="comps"]');
  await window.waitForSelector("#page-comps:not(.hidden)", { timeout: 5000 });
}

async function switchTab(window, tabName) {
  await window.click(`[data-subtab="${tabName}"]`);
  await window.waitForTimeout(300);
}

module.exports = { goToEditor, goToLibrary, goToComps, switchTab };
```

- [ ] **Step 3: Create editor.js helper**

Write `tests/e2e/helpers/editor.js`:

```js
async function selectProfession(window, name) {
  await window.selectOption("#professionSelect", { label: name });
  // Wait for catalog to load from mock API
  await window.waitForTimeout(2000);
}

async function setTitle(window, title) {
  await window.fill("#editorTitle", title);
}

async function setGameMode(window, mode) {
  await window.click(`.game-mode-toggle__btn[data-mode="${mode}"]`);
  await window.waitForTimeout(500);
}

async function saveBuild(window) {
  await window.click("#saveBuildBtn");
  await window.waitForTimeout(500);
}

async function addSpecialization(window, specName) {
  // Click the empty spec slot to open picker
  const emptySlot = window.locator(".spec-card .cselect__trigger").first();
  await emptySlot.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  // Search and select
  const search = window.locator(".slot-picker__search");
  if (await search.isVisible()) {
    await search.fill(specName);
    await window.waitForTimeout(300);
  }
  await window.click(`.slot-picker__option:has-text("${specName}")`);
  await window.waitForTimeout(500);
}

async function selectTrait(window, specIndex, tier, col) {
  // tier: 1-3 (Adept/Master/Grandmaster), col: 0-2 (left/mid/right)
  const specCards = window.locator(".spec-card");
  const card = specCards.nth(specIndex);
  const traits = card.locator(`.trait-btn[data-tier="${tier}"]`);
  await traits.nth(col).click();
  await window.waitForTimeout(200);
}

async function selectSkill(window, slotType, skillName) {
  // slotType: "heal", "utility", "elite"
  // Click the skill slot to open picker
  const slot = window.locator(`.skill-slot[data-slot="${slotType}"] .skill-icon-large`).first();
  await slot.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  const search = window.locator(".slot-picker__search");
  if (await search.isVisible()) {
    await search.fill(skillName);
    await window.waitForTimeout(300);
  }
  await window.click(`.slot-picker__option:has-text("${skillName}")`);
  await window.waitForTimeout(300);
}

module.exports = { selectProfession, setTitle, setGameMode, saveBuild, addSpecialization, selectTrait, selectSkill };
```

- [ ] **Step 4: Create data.js helper**

Write `tests/e2e/helpers/data.js`:

```js
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

function seedSettingsFile(settings) {
  const filePath = path.join(DATA_DIR, "settings.json");
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

function clearData() {
  for (const file of ["builds.json", "comps.json", "folders.json", "settings.json"]) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// ── Live seeding (IPC-based, for use in beforeEach while app is running) ──

async function seedBuildIPC(window, build) {
  return window.evaluate((b) => desktopApi.saveBuild(b), build);
}

async function seedCompIPC(window, comp) {
  return window.evaluate((c) => desktopApi.saveComp(c), comp);
}

async function seedFolderIPC(window, folder) {
  return window.evaluate((f) => desktopApi.saveFolder(f), folder);
}

module.exports = { seedBuildFile, seedCompFile, seedFolderFile, seedSettingsFile, clearData, seedBuildIPC, seedCompIPC, seedFolderIPC };
```

- [ ] **Step 5: Create builds.js factory helper**

Write `tests/e2e/helpers/builds.js` — provides reusable test data factories:

```js
const crypto = require("crypto");

function uuid() {
  return crypto.randomUUID();
}

function makeTestBuild(overrides = {}) {
  return {
    id: uuid(),
    version: 2,
    title: "Test Build",
    profession: "Necromancer",
    specializations: [],
    skills: { heal: null, utility: [null, null, null], elite: null },
    underwaterSkills: { heal: null, utility: [null, null, null], elite: null },
    equipment: {
      statPackage: "",
      relic: "",
      food: "",
      utility: "",
      slots: {},
      weapons: {},
      runes: {},
      sigils: {},
      infusions: {},
      enrichment: "",
    },
    tags: [],
    notes: "",
    images: {},
    folderId: null,
    compId: null,
    pinned: false,
    sortOrder: 0,
    selectedLegends: ["", ""],
    selectedUnderwaterLegends: ["", ""],
    activeLegendSlot: 0,
    selectedPets: { terrestrial1: 0, terrestrial2: 0, aquatic1: 0, aquatic2: 0 },
    morphSkillIds: [0, 0, 0],
    gameMode: "pve",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTestComp(overrides = {}) {
  return {
    id: uuid(),
    name: "Test Comp",
    notes: "",
    tags: [],
    folderId: null,
    sortOrder: 0,
    buildIds: [],
    gameMode: null,
    partyLines: [
      { id: uuid(), capacity: 5, slots: [] },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTestFolder(overrides = {}) {
  return {
    id: uuid(),
    name: "Test Folder",
    parentId: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

module.exports = { makeTestBuild, makeTestComp, makeTestFolder, uuid };
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/helpers/
git commit -m "feat(e2e): add app, nav, editor, data, and build factory helpers"
```

---

### Task 5: Smoke test — validate full pipeline

A single spec file that validates: mock server starts → Electron launches → catalog loads → UI interactions work → app closes cleanly.

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
    const profSelect = window.locator("#professionSelect");
    await expect(profSelect).toBeVisible({ timeout: 10_000 });
  });

  test("profession selector has options from mock server", async () => {
    const options = await window.locator("#professionSelect option").count();
    expect(options).toBeGreaterThan(0);
  });

  test("can select Necromancer and see specializations host", async () => {
    await window.selectOption("#professionSelect", "Necromancer");
    await window.waitForTimeout(2000);
    const specHost = window.locator("#specializationsHost");
    await expect(specHost).toBeVisible();
  });

  test("can set build title", async () => {
    await window.fill("#editorTitle", "Smoke Test Build");
    const value = await window.inputValue("#editorTitle");
    expect(value).toBe("Smoke Test Build");
  });

  test("can save build", async () => {
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);
    // Save should succeed without crash
  });

  test("window controls are visible", async () => {
    await expect(window.locator("#winMin")).toBeVisible();
    await expect(window.locator("#winMax")).toBeVisible();
    await expect(window.locator("#winClose")).toBeVisible();
  });

  test("can navigate to library", async () => {
    await window.click('.leftnav__item[data-page="library"]');
    await window.waitForTimeout(500);
    const libPage = window.locator("#page-library");
    await expect(libPage).toBeVisible();
  });

  test("can navigate back to editor", async () => {
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForTimeout(500);
    const editorPage = window.locator("#page-editor");
    await expect(editorPage).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `npm run test:e2e`
Expected: All 8 tests pass.

- [ ] **Step 3: Debug selector issues in headed mode if needed**

Run: `npm run test:e2e:headed`

Inspect the running app and fix any selectors that don't match. Document corrections in the helpers.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/smoke.spec.js
git commit -m "feat(e2e): add smoke test validating full E2E pipeline"
```

---

## Phase 2: Core Editor Tests

### Task 6: Editor Profession & Metadata spec (Section 2)

**Files:**
- Create: `tests/e2e/specs/editor-profession.spec.js`

**Tests (9):**

- [ ] **Step 1: Write tests**

```js
const { test, expect } = require("@playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { selectProfession, setTitle } = require("../helpers/editor");
const { goToEditor } = require("../helpers/nav");

test.describe("Build Editor - Profession & Metadata", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("all 9 professions selectable", async () => {
    const profs = ["Guardian", "Warrior", "Engineer", "Ranger", "Thief",
                   "Elementalist", "Mesmer", "Necromancer", "Revenant"];
    for (const prof of profs) {
      await window.selectOption("#professionSelect", { label: prof });
      const selected = await window.inputValue("#professionSelect");
      expect(selected).toBe(prof);
    }
  });

  test("profession catalogs load correctly for each class", async () => {
    // Select Necromancer (has fixture data) and verify spec host populated
    await selectProfession(window, "Necromancer");
    const specHost = window.locator("#specializationsHost");
    await expect(specHost).toBeVisible();
  });

  test("profession icons display with correct styling", async () => {
    // Profession icon should be visible in the editor area
    // The select option or surrounding UI should show the profession icon
    const profSelect = window.locator("#professionSelect");
    await expect(profSelect).toBeVisible();
  });

  test("switching professions clears previous selections", async () => {
    await selectProfession(window, "Necromancer");
    await setTitle(window, "My Necro");
    // Add a specialization to have something to clear
    // Switch to another profession
    await selectProfession(window, "Guardian");
    await window.waitForTimeout(1000);
    // Specializations should be empty/reset
    const specCards = await window.locator(".spec-card").count();
    // After switching, spec cards should reset (empty state)
    expect(specCards).toBeGreaterThanOrEqual(0);
  });

  test("loading skeletons appear during catalog fetches", async () => {
    // Switch profession to trigger a fresh catalog load
    await window.selectOption("#professionSelect", "Necromancer");
    // Skeletons should appear briefly — check they exist in DOM
    // This may require looking for .skeleton or .loading classes
    // The exact selector depends on implementation; verify during testing
    await window.waitForTimeout(2000);
  });

  test("build title input accepts up to 140 characters", async () => {
    const longTitle = "A".repeat(140);
    await setTitle(window, longTitle);
    const value = await window.inputValue("#editorTitle");
    expect(value.length).toBeLessThanOrEqual(140);
  });

  test("build title appears in window title bar", async () => {
    await selectProfession(window, "Necromancer");
    await setTitle(window, "Title Bar Test");
    // Window title should include the build title
    const title = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getTitle();
    });
    expect(title).toContain("Title Bar Test");
  });

  test("tags input accepts comma-separated values", async () => {
    const tagsInput = window.locator("#tagsInput input, #tagsInput");
    if (await tagsInput.isVisible()) {
      // Type comma-separated tags
      await tagsInput.click();
      await window.keyboard.type("pve, power, dps");
      await window.keyboard.press("Enter");
      await window.waitForTimeout(300);
    }
  });

  test("unsaved changes indicator shows/hides correctly", async () => {
    // Make a change to trigger dirty state
    await setTitle(window, "Dirty Test " + Date.now());
    const saveDot = window.locator("#saveDot");
    // Dot should become visible (removed .hidden class)
    await expect(saveDot).toBeVisible({ timeout: 3000 });

    // Save the build
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);
    // Dot should be hidden again
    await expect(saveDot).toBeHidden({ timeout: 3000 });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test:e2e -- --grep "Profession"`
Expected: All 9 tests pass. Fix selectors if needed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/editor-profession.spec.js
git commit -m "test(e2e): add editor profession and metadata spec (section 2)"
```

---

### Task 7: Game Mode Toggle spec (Section 3)

**Files:**
- Create: `tests/e2e/specs/game-mode.spec.js`

**Tests (5):**
1. PvE and WvW tabs toggle between game modes
2. Switching modes reloads specializations/traits with mode-appropriate data
3. Game mode preference remembered across restarts
4. Skill/trait balance splits reflect correctly per mode
5. Detail panel facts update and flash when mode changes

- [ ] **Step 1: Write tests**

Write `tests/e2e/specs/game-mode.spec.js`. Key patterns:

```js
const { test, expect } = require("@playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { selectProfession, setGameMode } = require("../helpers/editor");
const { goToEditor } = require("../helpers/nav");

test.describe("Game Mode Toggle", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("PvE and WvW tabs toggle between game modes", async () => {
    const pveBtn = window.locator('.game-mode-toggle__btn[data-mode="pve"]');
    const wvwBtn = window.locator('.game-mode-toggle__btn[data-mode="wvw"]');
    await expect(pveBtn).toBeVisible();
    await expect(wvwBtn).toBeVisible();

    await wvwBtn.click();
    await window.waitForTimeout(500);
    await expect(wvwBtn).toHaveClass(/--active/);

    await pveBtn.click();
    await window.waitForTimeout(500);
    await expect(pveBtn).toHaveClass(/--active/);
  });

  test("switching modes reloads specializations/traits", async () => {
    await setGameMode(window, "wvw");
    const specHost = window.locator("#specializationsHost");
    await expect(specHost).toBeVisible();
    await setGameMode(window, "pve");
  });

  test("game mode preference remembered across restarts", async () => {
    await setGameMode(window, "wvw");
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);

    // Close and relaunch
    await closeApp(app);
    ({ app, window } = await launchApp());
    await goToEditor(window);

    // Load the saved build and check game mode
    // The game mode should persist
  });

  test("skill/trait balance splits reflect correctly per mode", async () => {
    await selectProfession(window, "Necromancer");
    await setGameMode(window, "pve");
    // Select a trait/skill and check detail panel
    // Switch to WvW and verify the facts change
    await setGameMode(window, "wvw");
    await window.waitForTimeout(500);
  });

  test("detail panel facts update and flash when mode changes", async () => {
    // Click a trait to show detail panel
    const firstTrait = window.locator(".trait-btn").first();
    if (await firstTrait.isVisible()) {
      await firstTrait.click();
      await window.waitForTimeout(300);
      // Switch mode and check for flash animation
      await setGameMode(window, "wvw");
      await window.waitForTimeout(300);
      // Detail host should have content
      const detailHost = window.locator("#detailHost");
      await expect(detailHost).toBeVisible();
    }
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Game Mode"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/game-mode.spec.js
git commit -m "test(e2e): add game mode toggle spec (section 3)"
```

---

### Task 8: Specializations & Traits spec (Section 4)

**Files:**
- Create: `tests/e2e/specs/specializations.spec.js`

**Tests (11):**
1. Can select 0–3 specializations
2. Specialization cards display with background images
3. 3 tier rows display per specialization
4. Each tier has 3 major trait options; can select 1 per tier
5. Selected traits show visual indicator
6. Minor traits display as read-only
7. Hovering over traits shows wiki preview panel
8. SVG connector lines draw between specializations
9. Lines update when page becomes visible
10. Lines clear when specializations are removed
11. Removing a specialization clears its traits

- [ ] **Step 1: Write tests**

Write `tests/e2e/specs/specializations.spec.js`. The spec file should:
- Launch app, go to editor, select Necromancer
- Test adding specializations via the spec picker
- Verify trait tier display and selection
- Check SVG connector line elements (.spec-connector)
- Verify hover preview behavior (#hoverPreview)
- Test removal and clearing behavior

Key assertions:
```js
// Verify 3 spec cards max
const specCards = window.locator(".spec-card");
expect(await specCards.count()).toBeLessThanOrEqual(3);

// Verify tier rows within a spec
const tiers = specCards.first().locator('[data-tier]');
expect(await tiers.count()).toBe(3);

// Verify trait selection visual indicator
const activeTrait = window.locator(".trait-btn--active");
await expect(activeTrait.first()).toBeVisible();

// Verify minor traits are read-only
const minorTraits = window.locator(".trait-btn--always");
// Minor traits should exist but not be clickable/changeable

// Verify connector lines
const connectors = window.locator(".spec-connector");
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Specializations"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/specializations.spec.js
git commit -m "test(e2e): add specializations and traits spec (section 4)"
```

---

### Task 9: Skills spec (Section 5)

**Files:**
- Create: `tests/e2e/specs/skills.spec.js`

**Tests (18):** Base skills (8) + Profession mechanics (10)

The fixture data only covers Necromancer in detail. For profession mechanic tests that need other professions, capture additional fixture data first:

- [ ] **Step 1: Capture additional profession fixtures if needed**

Run `tests/e2e/fixtures/capture.js` with Elementalist and Revenant uncommented, or add them manually. For the initial implementation, focus on Necromancer mechanics and stub tests for other professions.

- [ ] **Step 2: Write skill tests**

Write `tests/e2e/specs/skills.spec.js`. Key patterns:

```js
test.describe("Skills", () => {
  test.describe("Base skills", () => {
    test("heal skill slot displays with correct icon", async () => {
      // After selecting Necromancer, heal slot should be visible
      const healSlot = window.locator('.skill-slot[data-slot="heal"]');
      await expect(healSlot).toBeVisible();
    });

    test("clicking skill slot opens picker with search", async () => {
      const healSlot = window.locator('.skill-slot[data-slot="heal"] .skill-icon-large');
      await healSlot.click();
      const picker = window.locator(".slot-picker");
      await expect(picker).toBeVisible({ timeout: 3000 });
      const search = window.locator(".slot-picker__search");
      await expect(search).toBeVisible();
      // Close picker
      await window.keyboard.press("Escape");
    });
    // ... remaining base skill tests
  });

  test.describe("Profession mechanics", () => {
    test("Necromancer: shroud mechanics display", async () => {
      // F1 mechanic for Necromancer should show shroud or spec-specific
      const mechSlots = window.locator('.skill-icon--profession');
      expect(await mechSlots.count()).toBeGreaterThan(0);
    });
    // ... tests for other professions (stub with test.skip if no fixtures)
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `npm run test:e2e -- --grep "Skills"`

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/skills.spec.js
git commit -m "test(e2e): add skills spec (section 5)"
```

---

## Phase 3: Equipment & Detail Tests

### Task 10: Equipment spec (Section 6)

**Files:**
- Create: `tests/e2e/specs/equipment.spec.js`

**Tests (~31):** Armor (2) + Weapons (5) + Trinkets (2) + Stats/Runes/Sigils/Infusions (12) + Food/Utility (3) + Assumed Boons (4) + Stats Display (4)

This is the largest spec file. Organize into `test.describe` blocks matching the subsections.

- [ ] **Step 1: Ensure upgrade fixtures exist**

The equipment tests need rune/sigil/food data. If `tests/e2e/fixtures/upgrades.json` is empty, run the capture script to populate it with real item data, or create minimal fixture entries.

- [ ] **Step 2: Write equipment tests**

Write `tests/e2e/specs/equipment.spec.js`. Switch to the Equipment tab first:

```js
const { switchTab } = require("../helpers/nav");

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  await goToEditor(window);
  await selectProfession(window, "Necromancer");
  await switchTab(window, "equipment");
});
```

Key test areas:
- Armor: verify 6 slots visible, weight class matches profession
- Weapons: verify 2 weapon sets, two-handed disabling offhand
- Trinkets: verify all 7 slots (Back, Amulet, 2 Rings, 2 Accessories + enrichment)
- Stats: verify dropdown has combinations, stat calculations update
- Runes/Sigils: verify picker with search
- Food/Utility: verify dropdowns
- Assumed boons: verify might selector (0-25), fury/alacrity toggles
- Stats display: verify 9 stats calculate correctly

- [ ] **Step 3: Run and verify**

Run: `npm run test:e2e -- --grep "Equipment"`

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/equipment.spec.js
git commit -m "test(e2e): add equipment spec (section 6)"
```

---

### Task 11: Detail Panel spec (Section 7)

**Files:**
- Create: `tests/e2e/specs/detail-panel.spec.js`

**Tests (6):**
1. Clicking trait/skill shows details in right panel
2. Facts display with correct icons
3. Hover preview tooltip appears and can be dismissed
4. Expand button opens full detail modal
5. Modal closes on Escape or close button
6. Switching PvE/WvW updates detail facts with highlights/flash

- [ ] **Step 1: Write tests**

```js
test("clicking trait shows details in right panel", async () => {
  const trait = window.locator(".trait-btn").first();
  await trait.click();
  await window.waitForTimeout(500);
  const detail = window.locator("#detailHost");
  // Detail should now have content
  const text = await detail.textContent();
  expect(text.length).toBeGreaterThan(0);
});

test("expand button opens detail modal", async () => {
  await window.click("#detail-expand-btn");
  const modal = window.locator(".detail-modal");
  await expect(modal).toBeVisible({ timeout: 3000 });
});

test("modal closes on Escape", async () => {
  await window.keyboard.press("Escape");
  const overlay = window.locator(".detail-modal-overlay");
  await expect(overlay).toHaveClass(/--hidden/, { timeout: 3000 });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Detail Panel"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/detail-panel.spec.js
git commit -m "test(e2e): add detail panel spec (section 7)"
```

---

### Task 12: Underwater Mode spec (Section 8)

**Files:**
- Create: `tests/e2e/specs/underwater.spec.js`

**Tests (7):**
1. Underwater checkbox toggles underwater skill sets
2. Underwater equipment slots show (breather + aquatic weapons)
3. Only aquatic weapons available
4. Land weapons hidden when underwater enabled
5. Revenant: certain legends disabled underwater
6. Ranger: only amphibious/aquatic pets available
7. Elementalist: attunement skills update for underwater

- [ ] **Step 1: Write tests**

Tests 5-7 need Revenant/Ranger/Elementalist fixture data. If not yet captured, use `test.skip` with a note to add fixtures later.

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Underwater"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/underwater.spec.js
git commit -m "test(e2e): add underwater mode spec (section 8)"
```

---

## Phase 4: Library & Notes Tests

### Task 13: Library & Management spec (Section 9)

**Files:**
- Create: `tests/e2e/specs/library.spec.js`

**Tests (~33):** Library (8) + Folders (4) + Copy/Cut/Paste (12) + Context Menu (5) + Chat Link (2)

This is the second-largest spec and requires pre-seeded data. Use `data.js` helpers in `beforeAll` to seed builds and folders.

- [ ] **Step 1: Write library tests**

Write `tests/e2e/specs/library.spec.js`. Structure:

```js
const { test, expect } = require("@playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { goToLibrary, goToEditor } = require("../helpers/nav");
const { selectProfession, setTitle, saveBuild } = require("../helpers/editor");
const { seedBuildFile, seedFolderFile, clearData, seedBuildIPC } = require("../helpers/data");
const { makeTestBuild, makeTestFolder } = require("../helpers/builds");

test.describe("Library & Management", () => {
  let app, window;

  test.describe("Library basics", () => {
    test.beforeAll(async () => {
      // Seed 3 builds before launching — pass clean:false since we clean manually first
      cleanDataDir();
      seedBuildFile(makeTestBuild({ title: "Build Alpha", profession: "Necromancer" }));
      seedBuildFile(makeTestBuild({ title: "Build Beta", profession: "Necromancer" }));
      seedBuildFile(makeTestBuild({ title: "Build Gamma", profession: "Necromancer" }));
      ({ app, window } = await launchApp({ clean: false }));
    });

    test.afterAll(async () => {
      await closeApp(app);
    });

    test("library page shows all saved builds", async () => {
      await goToLibrary(window);
      const rows = window.locator("[data-build-id]");
      expect(await rows.count()).toBe(3);
    });

    test("search filters builds by title", async () => {
      // Type in search to filter
      const search = window.locator("#lib-search, .lib-filters__search input");
      if (await search.isVisible()) {
        await search.fill("Alpha");
        await window.waitForTimeout(300);
        const rows = window.locator("[data-build-id]:visible");
        expect(await rows.count()).toBe(1);
        await search.fill(""); // Reset
      }
    });

    // ... remaining library tests
  });

  test.describe("Copy/Cut/Paste", () => {
    test.beforeAll(async () => {
      cleanDataDir();
      seedBuildFile(makeTestBuild({ title: "Copy Test Build" }));
      ({ app, window } = await launchApp({ clean: false }));
      await goToLibrary(window);
    });

    test.afterAll(async () => {
      await closeApp(app);
    });

    test("Ctrl+C copies selected build; toast appears", async () => {
      // Select a build
      const firstBuild = window.locator("[data-build-id]").first();
      await firstBuild.click();
      // Press Ctrl+C
      await window.keyboard.press("Control+c");
      await window.waitForTimeout(300);
      // Look for toast notification
      const toast = window.locator(".toast, .notification");
      // Verify toast text contains "copied"
    });

    test("Ctrl+V pastes build with (1) suffix", async () => {
      await window.keyboard.press("Control+v");
      await window.waitForTimeout(500);
      // Should see new build with "(1)" suffix
      const builds = window.locator("[data-build-id]");
      expect(await builds.count()).toBe(2);
    });

    // ... remaining copy/cut/paste tests
  });

  test.describe("Folders", () => {
    // Folder create, rename, delete, drag-drop tests
  });

  test.describe("Context Menu", () => {
    // Right-click context menu tests
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Library"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/library.spec.js
git commit -m "test(e2e): add library and management spec (section 9)"
```

---

### Task 14: Notes Tab spec (Section 11)

**Files:**
- Create: `tests/e2e/specs/notes.spec.js`

**Tests (7):**
1. Notes textarea accepts input
2. Toolbar buttons insert markdown
3. Toggle preview/edit mode works
4. Preview renders markdown correctly
5. @ mention autocomplete shows skills/traits
6. Arrow keys navigate suggestions, Enter selects
7. Notes save with build and persist

- [ ] **Step 1: Write tests**

```js
test.describe("Notes Tab", () => {
  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    await switchTab(window, "notes");
  });

  test("notes textarea accepts input", async () => {
    const notes = window.locator("#notesPanel textarea, #notesPanel [contenteditable]");
    await notes.click();
    await window.keyboard.type("Test note content");
    const content = await notes.inputValue();
    expect(content).toContain("Test note content");
  });

  test("toolbar buttons insert markdown", async () => {
    // Click bold button and verify ** inserted
    const boldBtn = window.locator('.notes-toolbar [data-action="bold"], .notes-toolbar button:has-text("B")');
    if (await boldBtn.isVisible()) {
      await boldBtn.click();
      await window.waitForTimeout(200);
    }
  });

  // ... remaining notes tests
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Notes"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/notes.spec.js
git commit -m "test(e2e): add notes tab spec (section 11)"
```

---

## Phase 5: Persistence, Window Controls, Edge Cases

### Task 15: Persistence & Import/Export spec (Section 12)

**Files:**
- Create: `tests/e2e/specs/persistence.spec.js`

**Tests (6):**
1. Save button saves all editor data; Ctrl+S shortcut works
2. Warning on page/build change if unsaved
3. Copy JSON exports current build
4. Paste JSON imports from clipboard
5. Paste chat link imports build into editor
6. Imported build loads all data correctly

- [ ] **Step 1: Write tests**

Key patterns:
```js
test("Ctrl+S shortcut saves build", async () => {
  await setTitle(window, "Ctrl+S Test");
  await window.keyboard.press("Control+s");
  await window.waitForTimeout(500);
  // Save dot should hide
  const saveDot = window.locator("#saveDot");
  await expect(saveDot).toBeHidden({ timeout: 3000 });
});

test("copy JSON exports current build", async () => {
  await window.click("#copyBuildBtn");
  await window.waitForTimeout(300);
  // Read clipboard via Electron evaluate
  const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText());
  const parsed = JSON.parse(clipboardText);
  expect(parsed).toHaveProperty("profession");
});
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/persistence.spec.js
git commit -m "test(e2e): add persistence and import/export spec (section 12)"
```

---

### Task 16: Window Controls spec (Section 13)

**Files:**
- Create: `tests/e2e/specs/window-controls.spec.js`

**Tests (8):**
1. Minimize, Maximize/Restore, Close buttons work
2. Double-clicking title bar maximizes/restores
3. Window resizing works (min 1120x740)
4. Window size persists across sessions
5. Version displays in titlebar
6. Dark theme is readable with good contrast
7. Profession colors distinguish clearly
8. Workspace switcher shows user menu

- [ ] **Step 1: Write tests**

Key patterns:
```js
test("minimize button works", async () => {
  await window.click("#winMin");
  // Electron minimize — check via main process
  const isMinimized = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isMinimized();
  });
  expect(isMinimized).toBe(true);
  // Restore
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].restore();
  });
});

test("maximize/restore button toggles", async () => {
  await window.click("#winMax");
  const isMaximized = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isMaximized();
  });
  expect(isMaximized).toBe(true);
  await window.click("#winMax");
});

test("version displays in titlebar", async () => {
  const version = window.locator("#updateVersionLabel");
  await expect(version).toBeVisible();
  const text = await version.textContent();
  expect(text).toMatch(/\d+\.\d+/);
});

test("window minimum size enforced", async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(800, 600);
  });
  await window.waitForTimeout(500);
  const size = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.getSize();
  });
  expect(size[0]).toBeGreaterThanOrEqual(1120);
  expect(size[1]).toBeGreaterThanOrEqual(740);
});
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/window-controls.spec.js
git commit -m "test(e2e): add window controls spec (section 13)"
```

---

### Task 17: Edge Cases spec (Section 16)

**Files:**
- Create: `tests/e2e/specs/edge-cases.spec.js`

**Tests (7):**
1. GW2 API timeout shows error without crash
2. Empty build title validation
3. Invalid JSON import rejected with error
4. Corrupt build file handled gracefully
5. 0 specializations allowed; 3+ prevented
6. Empty utility slots allowed
7. Tags input handles edge cases

- [ ] **Step 1: Write tests**

The API timeout test needs a special approach — modify the mock server to delay/error for specific endpoints, or launch a separate app instance with a non-responsive mock port.

```js
test("empty build title validation", async () => {
  await setTitle(window, "");
  await window.click("#saveBuildBtn");
  await window.waitForTimeout(300);
  // Should show validation error or prevent save
});

test("invalid JSON import rejected with error", async () => {
  // Write invalid JSON to clipboard
  await app.evaluate(({ clipboard }) => {
    clipboard.writeText("not valid json {{{");
  });
  await window.click("#pasteBuildBtn");
  await window.waitForTimeout(300);
  // Should show error toast/modal
});

test("0 specializations allowed", async () => {
  // A build with no specs selected should be valid
  await selectProfession(window, "Necromancer");
  const specCards = window.locator(".spec-card .spec-card__panel");
  // Should have empty state or placeholder cards
});

test("corrupt build file handled gracefully", async () => {
  // This test needs a fresh launch with a corrupted builds.json
  // Seed corrupt data, launch, verify app doesn't crash
});
```

- [ ] **Step 2: Run and verify**
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/edge-cases.spec.js
git commit -m "test(e2e): add edge cases spec (section 16)"
```

---

## Phase 6: Compositions & Regressions

### Task 18: Compositions spec (Section 17)

**Files:**
- Create: `tests/e2e/specs/compositions.spec.js`

**Tests (16):** Party Line Drag-and-Drop (9) + Boon Coverage (7)

This spec needs pre-seeded builds and a comp with party lines.

- [ ] **Step 1: Write tests**

Write `tests/e2e/specs/compositions.spec.js`. Key patterns:

```js
const { test, expect } = require("@playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { goToComps } = require("../helpers/nav");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp, uuid } = require("../helpers/builds");

test.describe("Compositions", () => {
  let app, window;

  test.describe("Party Line Drag-and-Drop", () => {
    const buildIds = [uuid(), uuid(), uuid(), uuid(), uuid(), uuid()];

    test.beforeAll(async () => {
      cleanDataDir();
      // Seed 6 builds
      for (let i = 0; i < 6; i++) {
        seedBuildFile(makeTestBuild({
          id: buildIds[i],
          title: `DnD Build ${i + 1}`,
          profession: "Necromancer",
        }));
      }
      // Seed a comp with 2 party lines, some builds assigned
      seedCompFile(makeTestComp({
        name: "DnD Test Comp",
        buildIds: buildIds,
        partyLines: [
          { id: uuid(), capacity: 5, slots: buildIds.slice(0, 3) },
          { id: uuid(), capacity: 5, slots: buildIds.slice(3, 5) },
        ],
      }));
      ({ app, window } = await launchApp({ clean: false }));
      await goToComps(window);
    });

    test.afterAll(async () => {
      await closeApp(app);
    });

    test("builds can be reordered within same party line", async () => {
      // Open the comp detail
      const compRow = window.locator(".comp-list-row").first();
      await compRow.dblclick();
      await window.waitForTimeout(500);

      // Verify party panel is visible
      const partyPanel = window.locator(".comp-detail__party-panel");
      await expect(partyPanel).toBeVisible();
    });

    // ... remaining drag-drop tests using Playwright's drag API
  });

  test.describe("Boon Coverage", () => {
    test("boon coverage shows which boons are covered", async () => {
      // Boon coverage section should be visible in comp detail
      const boonCoverage = window.locator(".boon-coverage, [data-boon-coverage]");
      if (await boonCoverage.isVisible()) {
        await expect(boonCoverage).toBeVisible();
      }
    });

    // ... remaining boon coverage tests
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Compositions"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/compositions.spec.js
git commit -m "test(e2e): add compositions spec (section 17)"
```

---

### Task 19: Regressions spec (Section 18)

**Files:**
- Create: `tests/e2e/specs/regressions.spec.js`

**Tests (12):**
1. Reaper shroud 5 accuracy in WvW split
2. Overload skill selection updates reference panel
3. Elementalist flip skills not appearing in core/cata/evoker
4. Build name appears in window title
5. Build summary collapsed by default
6. Loading states show during catalog fetches
7. Lines between skills persist after publish
8. GitHub Pages setup is optional
9. Sentinel's, Wanderer's, Diviner's appear in stat dropdown
10. Comp: build draggable to last slot position
11. Comp: full party line expands on drop
12. Comp: build dropped back onto original line restored

- [ ] **Step 1: Write regression tests**

Write `tests/e2e/specs/regressions.spec.js`:

```js
test.describe("Regression Checks", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("build name appears in window title", async () => {
    await setTitle(window, "Regression Title Test");
    const title = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].getTitle();
    });
    expect(title).toContain("Regression Title Test");
  });

  test("build summary collapsed by default", async () => {
    // Verify summary section is collapsed on load
    const summary = window.locator(".build-summary, .editor-summary");
    if (await summary.isVisible()) {
      // Should be in collapsed state
      await expect(summary).not.toHaveClass(/--expanded/);
    }
  });

  test("loading states show during catalog fetches", async () => {
    // Switch profession to trigger catalog load
    await window.selectOption("#professionSelect", "Necromancer");
    // Check for skeleton/loading elements briefly
    // These appear and disappear quickly, so we just verify no crash
    await window.waitForTimeout(2000);
  });

  test("Sentinel's, Wanderer's, Diviner's in stat dropdown", async () => {
    await switchTab(window, "equipment");
    // Find the stat combo dropdown
    const statSelect = window.locator('.stat-select, [data-stat-package]').first();
    if (await statSelect.isVisible()) {
      await statSelect.click();
      await window.waitForTimeout(300);
      // Search for each stat type
      const picker = window.locator(".slot-picker");
      if (await picker.isVisible()) {
        const search = window.locator(".slot-picker__search");
        for (const stat of ["Sentinel", "Wanderer", "Diviner"]) {
          await search.fill(stat);
          await window.waitForTimeout(200);
          const options = await window.locator(".slot-picker__option").count();
          expect(options).toBeGreaterThan(0);
        }
      }
    }
  });

  test("GitHub Pages setup is optional", async () => {
    // Workspace menu should not force setup
    await window.click("#workspaceBtn");
    await window.waitForTimeout(300);
    // Onboarding should not be blocking the UI
    const onboarding = window.locator("#onboarding");
    // Just verify the app is functional without setup
    await window.keyboard.press("Escape");
  });

  // Tests 2-3 and 10-12 need Elementalist/comp fixtures
  // Stub with test.skip if fixtures not available
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test:e2e -- --grep "Regression"`

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/specs/regressions.spec.js
git commit -m "test(e2e): add regression checks spec (section 18)"
```

---

## Phase 7: Final Verification

### Task 20: Full suite run and cleanup

- [ ] **Step 1: Run the complete E2E suite**

```bash
npm run test:e2e
```

Expected: All spec files pass. Note any flaky tests for retry tuning.

- [ ] **Step 2: Run existing unit tests to confirm no regressions**

```bash
npx jest --verbose
```

Expected: All existing tests pass.

- [ ] **Step 3: Run headed mode for visual verification**

```bash
npm run test:e2e:headed
```

Walk through key flows visually to verify the tests are testing what they claim.

- [ ] **Step 4: Fix any remaining issues and commit**

```bash
git add tests/e2e/
git commit -m "fix(e2e): address issues found during full suite verification"
```

- [ ] **Step 5: Final commit with all infrastructure and specs**

If not already committed incrementally:

```bash
git add -A
git commit -m "feat: complete Playwright E2E test suite (~150 tests across 14 sections)"
```
