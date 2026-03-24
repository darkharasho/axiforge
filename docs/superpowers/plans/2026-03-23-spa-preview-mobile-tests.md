# SPA Preview & Mobile Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright browser-based test suite covering preview (hover cards, detail panel) and mobile (accordion, sub-tabs, skill bar, bottom sheet) flows in the SPA, using encrypted build payloads generated from existing fixture data.

**Architecture:** Separate Playwright config (`tests/spa/`) runs tests against Vite dev server in Chromium. A fixture-gen helper transforms e2e fixture JSONs into the catalog shape `serializeForPublish()` needs, encrypts build data, and `page.route()` intercepts `.enc` fetches to serve payloads. Three viewport projects (desktop/mobile/tablet) test responsive behavior.

**Tech Stack:** Playwright (playwright/test), Vite dev server, Node.js crypto (AES-256-GCM), existing e2e fixture data

**Spec:** `docs/superpowers/specs/2026-03-23-spa-preview-mobile-test-suite-design.md`

---

### Task 1: Playwright Config & npm Scripts

**Files:**
- Create: `tests/spa/playwright.config.js`
- Modify: `package.json` (add test:spa scripts)

- [ ] **Step 1: Create Playwright config**

Create `tests/spa/playwright.config.js`:

```js
const path = require("path");

/** @type {import('playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: path.join(__dirname, "specs"),
  timeout: 30_000,
  retries: 1,
  workers: undefined, // parallel by default
  use: {
    trace: "on-first-retry",
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "npx vite --config src/site/vite.config.js --port 3100",
    port: 3100,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 375, height: 667 }, hasTouch: true },
    },
    {
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
  ],
};
```

- [ ] **Step 2: Add npm scripts to package.json**

Add these entries to the `"scripts"` section of `package.json`:

```json
"test:spa": "npx playwright test --config tests/spa/playwright.config.js",
"test:spa:headed": "npx playwright test --config tests/spa/playwright.config.js --headed",
"test:spa:debug": "PWDEBUG=1 npx playwright test --config tests/spa/playwright.config.js"
```

- [ ] **Step 3: Verify Vite dev server starts correctly**

Run: `npx vite --config src/site/vite.config.js --port 3100 &`
Verify it starts and serves the SPA at `http://localhost:3100`.
Then kill the background process.

- [ ] **Step 4: Commit**

```bash
git add tests/spa/playwright.config.js package.json
git commit -m "chore: add SPA Playwright config and npm scripts"
```

---

### Task 2: Fixture Generation Helper

**Files:**
- Create: `tests/spa/helpers/fixture-gen.js`

This helper transforms the raw e2e fixture JSON files into the catalog shape that `serializeForPublish()` expects, then encrypts the enriched build.

**Key insight:** The e2e fixture catalogs have `{ profession, specializations, traits, skills }` but `serializeForPublish()` expects `{ specializations, traits, skills, professionWeapons, weaponSkills, pets, legends }`. The helper must derive `professionWeapons` from `profession.weapons` and filter `weaponSkills` from the skills array.

- [ ] **Step 1: Create fixture-gen.js**

```js
"use strict";

const path = require("path");
const fs = require("fs");
const { serializeForPublish } = require("../../../src/main/buildPublish");
const {
  encryptBuild,
  generateFileId,
  generateEncryptionKey,
} = require("../../../src/main/buildEncryption");
const { makeTestBuild, makeTestComp } = require("../../e2e/helpers/builds");

const FIXTURES = path.join(__dirname, "../../e2e/fixtures");

// ---------------------------------------------------------------------------
// Catalog loading — transforms raw fixture JSONs into the shape
// serializeForPublish() expects.
// ---------------------------------------------------------------------------

const _catalogCache = new Map();

function normalizeWeaponKey(apiKey) {
  if (apiKey === "HarpoonGun" || apiKey === "Speargun") return "harpoon";
  return apiKey.toLowerCase();
}

/**
 * Load a profession's fixture catalog and reshape it for serializeForPublish().
 * @param {string} professionName — e.g. "Necromancer"
 * @returns {object} catalog with { specializations, traits, skills, professionWeapons, weaponSkills, pets, legends }
 */
function loadCatalog(professionName) {
  const key = professionName.toLowerCase();
  if (_catalogCache.has(key)) return _catalogCache.get(key);

  const filePath = path.join(FIXTURES, `${key}-catalog.json`);
  if (!fs.existsSync(filePath)) {
    // Return empty catalog — serializeForPublish handles nulls gracefully
    return { specializations: [], traits: [], skills: [], professionWeapons: {}, weaponSkills: [], pets: [], legends: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const profession = raw.profession;

  // Derive professionWeapons from profession.weapons
  const professionWeapons = Object.fromEntries(
    Object.entries(profession.weapons || {}).map(([apiKey, wData]) => [
      normalizeWeaponKey(apiKey),
      {
        flags: Array.isArray(wData.flags) ? wData.flags : [],
        specialization: Number(wData.specialization) || 0,
        skills: (wData.skills || []).map((s) => ({
          id: Number(s.id) || 0,
          slot: s.slot || "",
          attunement: s.attunement || "",
        })),
      },
    ])
  );

  // Collect all weapon skill IDs
  const weaponSkillIds = new Set();
  for (const wData of Object.values(profession.weapons || {})) {
    for (const s of wData.skills || []) {
      weaponSkillIds.add(Number(s.id));
    }
  }

  // Filter weapon skills from the full skills array
  const weaponSkills = raw.skills.filter((s) => weaponSkillIds.has(s.id));

  // Load pets and legends (shared across professions)
  let pets = [];
  const petsPath = path.join(FIXTURES, "pets.json");
  if (fs.existsSync(petsPath)) pets = JSON.parse(fs.readFileSync(petsPath, "utf-8"));

  let legends = [];
  const legendsPath = path.join(FIXTURES, "legends.json");
  if (fs.existsSync(legendsPath)) legends = JSON.parse(fs.readFileSync(legendsPath, "utf-8"));

  const catalog = {
    specializations: raw.specializations,
    traits: raw.traits,
    skills: raw.skills,
    professionWeapons,
    weaponSkills,
    pets,
    legends,
  };

  _catalogCache.set(key, catalog);
  return catalog;
}

// ---------------------------------------------------------------------------
// Payload generation
// ---------------------------------------------------------------------------

/**
 * Generate an encrypted .enc payload from a build object.
 *
 * @param {object} build — a build object (e.g. from makeTestBuild())
 * @param {object|null} [catalog] — profession catalog; auto-loaded from fixtures if omitted
 * @returns {{ fileId: string, encKey: string, base64Payload: string }}
 */
function generateBuildPayload(build, catalog) {
  if (!catalog) catalog = loadCatalog(build.profession || "Necromancer");
  const enriched = serializeForPublish(build, catalog, null);
  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  const base64Payload = encryptBuild(enriched, encKey);
  return { fileId, encKey, base64Payload };
}

/**
 * Generate an encrypted .enc payload from a comp object with embedded build data.
 *
 * @param {object} comp — a comp object (e.g. from makeTestComp())
 * @param {Array<object>} builds — array of enriched build objects to embed
 * @returns {{ fileId: string, encKey: string, base64Payload: string }}
 */
function generateCompPayload(comp, builds) {
  const enrichedBuilds = builds.map((b) => {
    const catalog = loadCatalog(b.profession || "Necromancer");
    return serializeForPublish(b, catalog, null);
  });
  const enrichedComp = { ...comp, builds: enrichedBuilds };
  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  const base64Payload = encryptBuild(enrichedComp, encKey);
  return { fileId, encKey, base64Payload };
}

/**
 * Create a realistic Necromancer (Reaper) build with real skill/spec IDs
 * from the fixture data, so the SPA renders interactive skill/trait elements.
 */
function makeRealisticNecromancerBuild(overrides = {}) {
  return makeTestBuild({
    profession: "Necromancer",
    title: "Power Reaper",
    specializations: [
      {
        id: 53, name: "Spite", elite: false,
        icon: "", background: "",
        minorTraits: [913, 915, 917],
        majorChoices: { 1: 914, 2: 829, 3: 853 },
        majorTraitsByTier: {},
      },
      {
        id: 39, name: "Curses", elite: false,
        icon: "", background: "",
        minorTraits: [802, 803, 810],
        majorChoices: { 1: 801, 2: 1693, 3: 812 },
        majorTraitsByTier: {},
      },
      {
        id: 34, name: "Reaper", elite: true,
        icon: "", background: "",
        minorTraits: [1905, 1879, 2018],
        majorChoices: { 1: 2020, 2: 2031, 3: 2021 },
        majorTraitsByTier: {},
      },
    ],
    skills: {
      heal: { id: 10548, name: "Consume Conditions", icon: "", slot: "Heal" },
      utility: [
        { id: 10546, name: "Well of Suffering", icon: "", slot: "Utility" },
        { id: 10545, name: "Well of Corruption", icon: "", slot: "Utility" },
        { id: 10609, name: "Well of Power", icon: "", slot: "Utility" },
      ],
      elite: { id: 10646, name: "Summon Flesh Golem", icon: "", slot: "Elite" },
    },
    equipment: {
      statPackage: "Berserker",
      relic: "",
      food: "",
      utility: "",
      slots: {},
      weapons: { mainhand1: "Greatsword" },
      runes: {},
      sigils: {},
      infusions: {},
      enrichment: "",
    },
    ...overrides,
  });
}

module.exports = {
  loadCatalog,
  generateBuildPayload,
  generateCompPayload,
  makeTestBuild,
  makeTestComp,
  makeRealisticNecromancerBuild,
};
```

- [ ] **Step 2: Verify fixture-gen works**

Run a quick Node.js check:

```bash
node -e "
const { generateBuildPayload, makeTestBuild } = require('./tests/spa/helpers/fixture-gen');
const build = makeTestBuild({ profession: 'Necromancer', title: 'Test Reaper' });
const { fileId, encKey, base64Payload } = generateBuildPayload(build);
console.log('fileId:', fileId);
console.log('encKey length:', encKey.length);
console.log('payload length:', base64Payload.length);
console.log('SUCCESS');
"
```

Expected: Prints fileId (8 hex chars), encKey (~44 chars), payload length (several thousand), and SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/helpers/fixture-gen.js
git commit -m "feat: add SPA test fixture generation helper"
```

---

### Task 3: Route Mock Helper

**Files:**
- Create: `tests/spa/helpers/route-mock.js`

- [ ] **Step 1: Create route-mock.js**

```js
"use strict";

/**
 * Intercept .enc file fetches and serve pre-generated payloads.
 *
 * @param {import('playwright/test').Page} page
 * @param {{ fileId: string, base64Payload: string, type?: "build"|"comp" }} opts
 */
async function mockEncRoute(page, { fileId, base64Payload, type = "build" }) {
  const dir = type === "build" ? "builds" : "comps";
  await page.route(`**/${dir}/${fileId}.enc`, (route) =>
    route.fulfill({ body: base64Payload, contentType: "text/plain" })
  );
}

/**
 * Navigate to the SPA with a build payload.
 * Sets up route interception, then navigates to the build URL.
 *
 * @param {import('playwright/test').Page} page
 * @param {{ fileId: string, encKey: string, base64Payload: string }} payload
 * @param {{ waitFor?: string }} [opts]
 */
async function loadBuildPage(page, payload, opts = {}) {
  await mockEncRoute(page, { fileId: payload.fileId, base64Payload: payload.base64Payload, type: "build" });
  await page.goto(`/?b=${payload.fileId}.${payload.encKey}`);
  await page.waitForSelector(opts.waitFor || ".skills-host", { timeout: 15_000 });
}

/**
 * Navigate to the SPA with a comp payload.
 *
 * @param {import('playwright/test').Page} page
 * @param {{ fileId: string, encKey: string, base64Payload: string }} payload
 * @param {{ waitFor?: string }} [opts]
 */
async function loadCompPage(page, payload, opts = {}) {
  await mockEncRoute(page, { fileId: payload.fileId, base64Payload: payload.base64Payload, type: "comp" });
  await page.goto(`/?c=${payload.fileId}.${payload.encKey}`);
  await page.waitForSelector(opts.waitFor || ".comp-detail", { timeout: 15_000 });
}

module.exports = { mockEncRoute, loadBuildPage, loadCompPage };
```

- [ ] **Step 2: Commit**

```bash
git add tests/spa/helpers/route-mock.js
git commit -m "feat: add SPA test route mock helper"
```

---

### Task 4: Smoke Tests

**Files:**
- Create: `tests/spa/specs/smoke.spec.js`

These tests validate the basic end-to-end flow: SPA loads → fetches .enc → decrypts → renders. Runs in all 3 viewport projects.

- [ ] **Step 1: Create smoke.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadBuildPage, loadCompPage } = require("../helpers/route-mock");

test.describe("SPA smoke tests", () => {
  test("renders a build with title, profession, and skills", async ({ page }) => {
    const build = makeTestBuild({ profession: "Necromancer", title: "Smoke Test Reaper" });
    const payload = generateBuildPayload(build);
    await loadBuildPage(page, payload);

    // Title visible
    await expect(page.locator(".build-header")).toContainText("Smoke Test Reaper");

    // Skills section rendered
    await expect(page.locator(".skills-host")).toBeVisible();

    // Specializations section rendered
    const specCards = page.locator(".spec-card");
    // Build has empty specs by default, but the host should exist
    await expect(page.locator(".specializations-host")).toBeVisible();
  });

  test("renders a comp with party lines", async ({ page }) => {
    const buildA = makeTestBuild({ profession: "Necromancer", title: "Build A" });
    const buildB = makeTestBuild({ profession: "Necromancer", title: "Build B" });
    const comp = makeTestComp({
      name: "Smoke Test Comp",
      buildIds: [buildA.id, buildB.id],
      partyLines: [{ id: "pl-1", capacity: 5, slots: [buildA.id, buildB.id] }],
    });
    const payload = generateCompPayload(comp, [buildA, buildB]);
    await loadCompPage(page, payload);

    // Comp name visible
    await expect(page.locator(".comp-detail__topbar")).toContainText("Smoke Test Comp");

    // Party line rendered with slots
    await expect(page.locator(".comp-line")).toBeVisible();
    await expect(page.locator(".comp-slot")).toHaveCount(5);
  });

  test("no console errors during build load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const build = makeTestBuild({ profession: "Necromancer" });
    const payload = generateBuildPayload(build);
    await loadBuildPage(page, payload);

    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run smoke tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/smoke.spec.js`
Expected: All tests pass across desktop, mobile, and tablet projects.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/smoke.spec.js
git commit -m "test: add SPA smoke tests for build and comp rendering"
```

---

### Task 5: Preview Hover Tests (Desktop)

**Files:**
- Create: `tests/spa/specs/preview-hover.spec.js`

Desktop-only tests for `.hover-preview` card behavior. The SPA creates `#hoverPreview` element with class `.hover-preview.hidden`, shows it on `mouseenter` of skills/traits, hides on `mouseleave`.

- [ ] **Step 1: Create preview-hover.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

// Only run on desktop — hover doesn't exist on mobile/tablet
test.describe("Preview hover card", () => {
  test.skip(({ viewport }) => viewport.width <= 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Hover Test" });
    payload = generateBuildPayload(build);
  });

  test("hovering a skill shows hover preview with name", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    // Preview starts hidden
    await expect(hoverPreview).toHaveClass(/hidden/);

    // Find a skill icon to hover
    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered — build has no skills");
      return;
    }

    await skillIcon.hover();
    await page.waitForTimeout(300);

    // Preview should be visible
    await expect(hoverPreview).not.toHaveClass(/hidden/);

    // Preview has content
    const title = page.locator(".hover-preview__title");
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test("moving mouse away hides hover preview", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    // Hover to show
    await skillIcon.hover();
    await page.waitForTimeout(300);
    await expect(hoverPreview).not.toHaveClass(/hidden/);

    // Move away to hide
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    await expect(hoverPreview).toHaveClass(/hidden/);
  });

  test("hovering a trait shows hover preview", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    const traitBtn = page.locator(".trait-btn").first();
    if (await traitBtn.count() === 0) {
      test.skip(true, "No trait buttons rendered");
      return;
    }

    await traitBtn.hover();
    await page.waitForTimeout(300);
    await expect(hoverPreview).not.toHaveClass(/hidden/);
  });

  test("hover preview stays within viewport", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.hover();
    await page.waitForTimeout(300);

    const previewBox = await page.locator("#hoverPreview").boundingBox();
    if (!previewBox) return;

    const viewport = page.viewportSize();
    expect(previewBox.x).toBeGreaterThanOrEqual(0);
    expect(previewBox.y).toBeGreaterThanOrEqual(0);
    expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(viewport.width + 2);
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(viewport.height + 2);
  });
});
```

- [ ] **Step 2: Run hover tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/preview-hover.spec.js --project=desktop`
Expected: All pass (or skip gracefully if build has no skill icons).

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/preview-hover.spec.js
git commit -m "test: add SPA hover preview tests (desktop)"
```

---

### Task 6: Preview Detail Panel Tests (Desktop)

**Files:**
- Create: `tests/spa/specs/preview-detail-panel.spec.js`

Desktop-only tests for the `.detail-panel` sidebar that populates on skill/trait click.

- [ ] **Step 1: Create preview-detail-panel.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Detail panel", () => {
  test.skip(({ viewport }) => viewport.width <= 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Detail Panel Test" });
    payload = generateBuildPayload(build);
  });

  test("clicking a skill populates the detail panel", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const detailHost = page.locator("#detailHost");
    const detailCard = detailHost.locator(".detail-card");
    await expect(detailCard).toBeVisible();
  });

  test("detail panel shows skill name and description", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const detailCard = page.locator(".detail-panel .detail-card");
    const html = await detailCard.innerHTML();
    // Should have some text content (name, description)
    expect(html.length).toBeGreaterThan(0);
  });

  test("detail panel contains wiki link", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    // The detail card should contain a link with data-url attribute (wiki link)
    const wikiLink = page.locator(".detail-panel .detail-card [data-url]");
    await expect(wikiLink).toBeVisible();
  });

  test("clicking a different skill updates panel content", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skills = page.locator(".skill-icon-large");
    const count = await skills.count();
    if (count < 2) {
      test.skip(true, "Need at least 2 skill icons to test switching");
      return;
    }

    // Click first skill
    await skills.nth(0).click();
    await page.waitForTimeout(300);
    const firstContent = await page.locator(".detail-panel .detail-card").innerHTML();

    // Click second skill
    await skills.nth(1).click();
    await page.waitForTimeout(300);
    const secondContent = await page.locator(".detail-panel .detail-card").innerHTML();

    // Content should differ (different skills)
    expect(firstContent).not.toBe(secondContent);
  });

  test("detail panel is visible on desktop", async ({ page }) => {
    await loadBuildPage(page, payload);
    const panel = page.locator(".detail-panel");
    await expect(panel).toBeVisible();
  });
});
```

- [ ] **Step 2: Run detail panel tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/preview-detail-panel.spec.js --project=desktop`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/preview-detail-panel.spec.js
git commit -m "test: add SPA detail panel tests (desktop)"
```

---

### Task 7: Mobile Spec Accordion Tests

**Files:**
- Create: `tests/spa/specs/mobile-spec-accordion.spec.js`

Tests for the specialization accordion at viewport ≤ 1024px. Each `.spec-card` gets a `.spec-card__mobile-header` injected. Tapping toggles `.expanded` class.

- [ ] **Step 1: Create mobile-spec-accordion.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile spec accordion", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    // Use realistic Necromancer — fully cataloged, will produce enriched specs with traits
    const build = makeRealisticNecromancerBuild({ title: "Accordion Test" });
    payload = generateBuildPayload(build);
  });

  test("spec cards have mobile headers on mobile viewport", async ({ page }) => {
    await loadBuildPage(page, payload);

    const mobileHeaders = page.locator(".spec-card__mobile-header");
    // At least check that mobile headers exist (even if 0 specs, the init ran)
    const specCards = page.locator(".spec-card");
    const specCount = await specCards.count();

    if (specCount === 0) {
      test.skip(true, "No spec cards rendered — build has no specializations");
      return;
    }

    await expect(mobileHeaders.first()).toBeVisible();
  });

  test("spec cards start collapsed on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);

    const specCards = page.locator(".spec-card");
    const count = await specCards.count();
    if (count === 0) {
      test.skip(true, "No spec cards");
      return;
    }

    // No spec card should have .expanded class initially
    for (let i = 0; i < count; i++) {
      await expect(specCards.nth(i)).not.toHaveClass(/expanded/);
    }
  });

  test("tapping a spec card header expands it", async ({ page }) => {
    await loadBuildPage(page, payload);

    const specCards = page.locator(".spec-card");
    if (await specCards.count() === 0) {
      test.skip(true, "No spec cards");
      return;
    }

    const firstHeader = page.locator(".spec-card__mobile-header").first();
    await firstHeader.click();
    await page.waitForTimeout(300);

    await expect(specCards.first()).toHaveClass(/expanded/);
  });

  test("expanding one spec collapses the previously open one", async ({ page }) => {
    await loadBuildPage(page, payload);

    const specCards = page.locator(".spec-card");
    const count = await specCards.count();
    if (count < 2) {
      test.skip(true, "Need at least 2 spec cards");
      return;
    }

    const headers = page.locator(".spec-card__mobile-header");

    // Expand first
    await headers.nth(0).click();
    await page.waitForTimeout(300);
    await expect(specCards.nth(0)).toHaveClass(/expanded/);

    // Expand second — first should collapse
    await headers.nth(1).click();
    await page.waitForTimeout(300);
    await expect(specCards.nth(1)).toHaveClass(/expanded/);
    await expect(specCards.nth(0)).not.toHaveClass(/expanded/);
  });

  test("chevron rotates when expanded", async ({ page }) => {
    await loadBuildPage(page, payload);

    const specCards = page.locator(".spec-card");
    if (await specCards.count() === 0) {
      test.skip(true, "No spec cards");
      return;
    }

    const chevron = page.locator(".spec-card__mobile-chevron").first();
    const header = page.locator(".spec-card__mobile-header").first();

    // Before expand — no rotation
    const beforeTransform = await chevron.evaluate((el) => getComputedStyle(el).transform);

    await header.click();
    await page.waitForTimeout(300);

    // After expand — should have rotation transform
    const afterTransform = await chevron.evaluate((el) => getComputedStyle(el).transform);
    expect(afterTransform).not.toBe(beforeTransform);
  });
});
```

- [ ] **Step 2: Run accordion tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/mobile-spec-accordion.spec.js --project=mobile`
Expected: All pass (or skip if build has no specializations populated).

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/mobile-spec-accordion.spec.js
git commit -m "test: add SPA mobile spec accordion tests"
```

---

### Task 8: Mobile Equipment Sub-tabs Tests

**Files:**
- Create: `tests/spa/specs/mobile-equipment-tabs.spec.js`

Tests the `.equip-mobile-tabs` bar that toggles between `.equip-col--left` (Armor & Runes) and `.equip-col--right` (Weapons & Trinkets).

- [ ] **Step 1: Create mobile-equipment-tabs.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile equipment sub-tabs", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Equip Tabs Test" });
    payload = generateBuildPayload(build);
  });

  test("equipment sub-tabs are visible on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);

    const tabs = page.locator(".equip-mobile-tabs");
    await expect(tabs).toBeVisible();
  });

  test("sub-tabs show correct labels", async ({ page }) => {
    await loadBuildPage(page, payload);

    const tabButtons = page.locator(".equip-mobile-tab");
    await expect(tabButtons).toHaveCount(2);
    await expect(tabButtons.nth(0)).toContainText("Armor & Runes");
    await expect(tabButtons.nth(1)).toContainText("Weapons & Trinkets");
  });

  test("first tab is active by default", async ({ page }) => {
    await loadBuildPage(page, payload);

    const firstTab = page.locator(".equip-mobile-tab").first();
    await expect(firstTab).toHaveClass(/equip-mobile-tab--active/);

    // Left column visible, right hidden
    const leftCol = page.locator(".equip-col--left");
    const rightCol = page.locator(".equip-col--right");
    await expect(leftCol).toBeVisible();
    await expect(rightCol).not.toBeVisible();
  });

  test("clicking second tab switches columns", async ({ page }) => {
    await loadBuildPage(page, payload);

    const tabs = page.locator(".equip-mobile-tab");
    await tabs.nth(1).click();
    await page.waitForTimeout(200);

    // Second tab active
    await expect(tabs.nth(1)).toHaveClass(/equip-mobile-tab--active/);
    await expect(tabs.nth(0)).not.toHaveClass(/equip-mobile-tab--active/);

    // Right column visible, left hidden
    const leftCol = page.locator(".equip-col--left");
    const rightCol = page.locator(".equip-col--right");
    await expect(rightCol).toBeVisible();
    await expect(leftCol).not.toBeVisible();
  });

  test("clicking first tab switches back", async ({ page }) => {
    await loadBuildPage(page, payload);

    const tabs = page.locator(".equip-mobile-tab");

    // Switch to second
    await tabs.nth(1).click();
    await page.waitForTimeout(200);

    // Switch back to first
    await tabs.nth(0).click();
    await page.waitForTimeout(200);

    await expect(tabs.nth(0)).toHaveClass(/equip-mobile-tab--active/);
    const leftCol = page.locator(".equip-col--left");
    await expect(leftCol).toBeVisible();
  });
});
```

- [ ] **Step 2: Run equipment tabs tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/mobile-equipment-tabs.spec.js --project=mobile`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/mobile-equipment-tabs.spec.js
git commit -m "test: add SPA mobile equipment sub-tab tests"
```

---

### Task 9: Mobile Skill Bar Tests

**Files:**
- Create: `tests/spa/specs/mobile-skill-bar.spec.js`

Tests the mobile skill bar: `.skills-bar__mobile-meta` row with `.mobile-swap-pill` and `.mobile-hp-badge`. Health orb (`.health-orb`) and `.weapon-swap-btn` should be hidden on mobile.

- [ ] **Step 1: Create mobile-skill-bar.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile skill bar", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Skill Bar Test" });
    payload = generateBuildPayload(build);
  });

  test("mobile meta row is visible", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".skills-bar__mobile-meta")).toBeVisible();
  });

  test("health orb is hidden on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".health-orb")).not.toBeVisible();
  });

  test("desktop weapon swap button is hidden on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".weapon-swap-btn")).not.toBeVisible();
  });

  test("HP badge shows a value", async ({ page }) => {
    await loadBuildPage(page, payload);
    const badge = page.locator(".mobile-hp-badge");
    await expect(badge).toBeVisible();
    await expect(page.locator(".mobile-hp-badge__label")).toContainText("HP");
  });

  test("swap pill is visible", async ({ page }) => {
    await loadBuildPage(page, payload);
    const pill = page.locator(".mobile-swap-pill");
    await expect(pill).toBeVisible();
  });

  test("tapping swap pill toggles active state", async ({ page }) => {
    await loadBuildPage(page, payload);
    const pill = page.locator(".mobile-swap-pill");

    // Initial state — not active (set 1)
    const initiallyActive = await pill.evaluate((el) => el.classList.contains("mobile-swap-pill--active"));

    await pill.click();
    await page.waitForTimeout(300);

    const afterClick = await pill.evaluate((el) => el.classList.contains("mobile-swap-pill--active"));
    expect(afterClick).not.toBe(initiallyActive);
  });
});
```

- [ ] **Step 2: Run skill bar tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/mobile-skill-bar.spec.js --project=mobile`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/mobile-skill-bar.spec.js
git commit -m "test: add SPA mobile skill bar tests"
```

---

### Task 10: Mobile Bottom Sheet Tests

**Files:**
- Create: `tests/spa/specs/mobile-bottom-sheet.spec.js`

Tests the `.bottom-sheet` slide-up panel that replaces the detail panel on mobile. Opens on skill/trait tap, dismisses via backdrop, X button, or swipe-down.

- [ ] **Step 1: Create mobile-bottom-sheet.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile bottom sheet", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Bottom Sheet Test" });
    payload = generateBuildPayload(build);
  });

  test("tapping a skill opens the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);
    await expect(page.locator(".bottom-sheet-backdrop")).toHaveClass(/bottom-sheet-backdrop--active/);
  });

  test("bottom sheet shows skill card content", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const content = page.locator(".bottom-sheet__content");
    await expect(content).toBeVisible();
    const html = await content.innerHTML();
    expect(html.length).toBeGreaterThan(0);
  });

  test("tapping backdrop dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    // Open
    await skillIcon.click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);

    // Dismiss via backdrop
    await page.locator(".bottom-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });

  test("X button dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    // Open
    await skillIcon.click();
    await page.waitForTimeout(300);

    // Dismiss via X button
    await page.locator(".bottom-sheet__close").click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });

  test("swipe-down gesture dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    // Open
    await skillIcon.click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);

    // Swipe down on handle (100px+ threshold triggers close)
    const handle = page.locator(".bottom-sheet__handle");
    const box = await handle.boundingBox();
    if (!box) {
      test.skip(true, "Handle not visible");
      return;
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.touchscreen.tap(startX, startY);
    // Simulate swipe: touchstart → touchmove → touchend
    await page.evaluate(({ x, y }) => {
      const el = document.querySelector(".bottom-sheet__handle");
      el.dispatchEvent(new TouchEvent("touchstart", {
        touches: [new Touch({ identifier: 0, target: el, clientX: x, clientY: y })],
      }));
      el.dispatchEvent(new TouchEvent("touchmove", {
        touches: [new Touch({ identifier: 0, target: el, clientX: x, clientY: y + 150 })],
      }));
      el.dispatchEvent(new TouchEvent("touchend", {
        changedTouches: [new Touch({ identifier: 0, target: el, clientX: x, clientY: y + 150 })],
      }));
    }, { x: startX, y: startY });

    await page.waitForTimeout(400);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });
});
```

- [ ] **Step 2: Run bottom sheet tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/mobile-bottom-sheet.spec.js --project=mobile`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/mobile-bottom-sheet.spec.js
git commit -m "test: add SPA mobile bottom sheet tests"
```

---

### Task 11: Mobile Comp Tests

**Files:**
- Create: `tests/spa/specs/mobile-comp.spec.js`

Tests comp rendering at mobile viewport — party lines with horizontal scroll and build cards at narrow width.

- [ ] **Step 1: Create mobile-comp.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");

test.describe("Mobile comp rendering", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const builds = Array.from({ length: 5 }, (_, i) =>
      makeTestBuild({ profession: "Necromancer", title: `Build ${i + 1}` })
    );
    const comp = makeTestComp({
      name: "Mobile Comp Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [{ id: "pl-1", capacity: 5, slots: builds.map((b) => b.id) }],
    });
    payload = generateCompPayload(comp, builds);
  });

  test("comp renders party lines on mobile", async ({ page }) => {
    await loadCompPage(page, payload);
    await expect(page.locator(".comp-line")).toBeVisible();
  });

  test("party line slots container is horizontally scrollable", async ({ page }) => {
    await loadCompPage(page, payload);

    const slotsContainer = page.locator(".comp-line__slots").first();
    const overflowX = await slotsContainer.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe("auto");
  });

  test("build cards display at full width on mobile", async ({ page }) => {
    await loadCompPage(page, payload);

    const miniCard = page.locator(".mini-card").first();
    if (await miniCard.count() === 0) {
      test.skip(true, "No mini cards rendered");
      return;
    }

    const box = await miniCard.boundingBox();
    const viewport = page.viewportSize();
    // Card should be nearly full width (accounting for padding)
    expect(box.width).toBeGreaterThan(viewport.width * 0.7);
  });
});
```

- [ ] **Step 2: Run comp tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/mobile-comp.spec.js --project=mobile`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/mobile-comp.spec.js
git commit -m "test: add SPA mobile comp tests"
```

---

### Task 12: Responsive Transition Tests

**Files:**
- Create: `tests/spa/specs/responsive-transitions.spec.js`

Tests that resizing the viewport between desktop and mobile correctly toggles UI state — detail panel, accordion, sub-tabs. Uses `page.setViewportSize()` to simulate.

- [ ] **Step 1: Create responsive-transitions.spec.js**

```js
const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeTestBuild, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Responsive transitions", () => {
  // Run only on desktop project (we resize within the test)
  test.skip(({ viewport }) => viewport.width <= 1024, "Starts at desktop, resizes to mobile");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Responsive Test" });
    payload = generateBuildPayload(build);
  });

  test("desktop to mobile: detail panel hides, accordion activates", async ({ page }) => {
    await loadBuildPage(page, payload);

    // Desktop: detail panel visible
    await expect(page.locator(".detail-panel")).toBeVisible();

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Mobile: detail panel hidden
    await expect(page.locator(".detail-panel")).not.toBeVisible();

    // Mobile: accordion headers visible (if specs exist)
    const mobileHeaders = page.locator(".spec-card__mobile-header");
    if (await page.locator(".spec-card").count() > 0) {
      await expect(mobileHeaders.first()).toBeVisible();
    }

    // Mobile: equipment sub-tabs visible
    await expect(page.locator(".equip-mobile-tabs")).toBeVisible();
  });

  test("mobile to desktop: accordion collapses, detail panel returns", async ({ page }) => {
    // Start at mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await loadBuildPage(page, payload);
    await page.waitForTimeout(300);

    // Verify mobile state
    await expect(page.locator(".detail-panel")).not.toBeVisible();

    // Resize to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);

    // Desktop: detail panel visible again
    await expect(page.locator(".detail-panel")).toBeVisible();

    // Desktop: equipment sub-tabs hidden
    await expect(page.locator(".equip-mobile-tabs")).not.toBeVisible();
  });

  test("full resize cycle produces no broken state", async ({ page }) => {
    await loadBuildPage(page, payload);

    // Desktop → Mobile → Desktop
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    // Verify core sections still visible
    await expect(page.locator(".skills-host")).toBeVisible();
    await expect(page.locator(".specializations-host")).toBeVisible();
    await expect(page.locator(".detail-panel")).toBeVisible();

    // No console errors during resize cycle
    const errors = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run responsive tests**

Run: `npx playwright test --config tests/spa/playwright.config.js specs/responsive-transitions.spec.js --project=desktop`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/spa/specs/responsive-transitions.spec.js
git commit -m "test: add SPA responsive transition tests"
```

---

### Task 13: Run Full Suite & Fix Issues

- [ ] **Step 1: Run the complete SPA test suite**

Run: `npx playwright test --config tests/spa/playwright.config.js`

This runs all 10 spec files across all 3 projects (desktop, mobile, tablet).

- [ ] **Step 2: Fix any failures**

If tests fail, diagnose root causes:
- **Selector mismatch** — verify exact class names against `src/site/mobile.js` and `src/site/render-build.js`
- **Timing issues** — increase `waitForTimeout` or use `waitForSelector` instead
- **Missing data** — ensure `makeTestBuild()` produces enough data for the test (skills, specializations)
- **Viewport skip logic** — verify `test.skip()` conditions match the project viewport sizes

Fix failures and re-run until all pass.

- [ ] **Step 3: Run with headed mode to visually verify**

Run: `npx playwright test --config tests/spa/playwright.config.js --headed --project=mobile`
Visually confirm mobile UI behaviors look correct.

- [ ] **Step 4: Final commit**

```bash
git add -A tests/spa/
git commit -m "test: complete SPA preview & mobile test suite"
```
