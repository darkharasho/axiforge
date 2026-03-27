# Party Coverage Playwright Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Playwright tests for the party coverage feature in both the Electron app (E2E) and the web SPA, covering rendering, interactions, and mobile responsiveness.

**Architecture:** Two self-contained test spec files — one for E2E (tests live computation pipeline in Electron) and one for SPA (tests pre-rendered HTML + event delegation in browser). Each follows existing patterns in its test suite. SPA tests provide pre-built `boonCoverageHtml` strings matching the real HTML structure (same pattern as `comp-boon-collapse.spec.js`).

**Tech Stack:** Playwright, Node.js (CommonJS), existing mock server infrastructure, existing test helpers (builds.js, data.js, nav.js for E2E; fixture-gen.js, route-mock.js for SPA).

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `tests/e2e/specs/party-coverage.spec.js` | 16 E2E test cases against Electron app |
| Create | `tests/spa/specs/party-coverage.spec.js` | 14 SPA test cases (9 desktop + 5 mobile) |

No new helpers needed — both files use existing infrastructure.

---

## Task 1: E2E Test File — Setup and Rendering Tests

**Files:**
- Create: `tests/e2e/specs/party-coverage.spec.js`

- [ ] **Step 1: Create the E2E spec file with imports, build fixtures, and beforeAll setup**

```js
const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { goToComps } = require("../helpers/nav");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp, uuid } = require("../helpers/builds");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function waitForCompDetail(window) {
  await window.waitForSelector(".comp-detail", { timeout: 5000 });
  await window.waitForTimeout(300);
}

async function openFirstComp(window) {
  const row = window.locator(".comp-list-row[data-comp-id]").first();
  await row.dblclick();
  await waitForCompDetail(window);
}

async function waitForPartyCoverage(window) {
  await window.waitForFunction(
    () => {
      const body = document.querySelector("#comp-boon-coverage-body");
      return body && body.querySelector(".party-cov__line") !== null;
    },
    null,
    { timeout: 15_000 }
  );
}

// ── Test Builds ──────────────────────────────────────────────────────────────
// P1: Guardian + Elementalist (strong boons + fields)
// P2: Warrior + Necromancer (strong finishers + sparse boons)

// Guardian — "Save Yourselves!" grants 7 boons, "Feel My Wrath!" grants Quickness+Fury
const guardianBuild = makeTestBuild({
  title: "Firebrand Support",
  profession: "Guardian",
  specializations: [
    { specializationId: 42, name: "Zeal", elite: false, traits: [1, 1, 1] },
    { specializationId: 16, name: "Radiance", elite: false, traits: [1, 1, 1] },
    { specializationId: 62, name: "Firebrand", elite: true, traits: [1, 1, 1] },
  ],
  skills: {
    heal: { id: 30025, name: "Purification", icon: "", slot: "Heal" },
    utility: [
      { id: 9085, name: "Save Yourselves!", icon: "", slot: "Utility" },
      { id: 9084, name: "Advance!", icon: "", slot: "Utility" },
      { id: 9152, name: "Hold the Line!", icon: "", slot: "Utility" },
    ],
    elite: { id: 29965, name: "Feel My Wrath!", icon: "", slot: "Elite" },
  },
});

// Elementalist — Glyph of Elemental Harmony (Might, Regen, Swiftness, Prot), Tornado (Lightning field + Whirl finisher)
const elementalistBuild = makeTestBuild({
  title: "Tempest Healer",
  profession: "Elementalist",
  specializations: [
    { specializationId: 31, name: "Fire", elite: false, traits: [1, 1, 1] },
    { specializationId: 26, name: "Earth", elite: false, traits: [1, 1, 1] },
    { specializationId: 48, name: "Tempest", elite: true, traits: [1, 1, 1] },
  ],
  skills: {
    heal: { id: 5569, name: "Glyph of Elemental Harmony", icon: "", slot: "Heal" },
    utility: [
      { id: 5638, name: "Arcane Wave", icon: "", slot: "Utility" },
      { id: 30432, name: "Aftershock!", icon: "", slot: "Utility" },
      { id: 5506, name: "Glyph of Elemental Power", icon: "", slot: "Utility" },
    ],
    elite: { id: 5534, name: "Tornado", icon: "", slot: "Elite" },
  },
});

// Warrior — Stomp (Blast finisher), Banner of Strength (Blast), Healing Signet
const warriorBuild = makeTestBuild({
  title: "Berserker DPS",
  profession: "Warrior",
  specializations: [
    { specializationId: 4, name: "Strength", elite: false, traits: [1, 1, 1] },
    { specializationId: 36, name: "Arms", elite: false, traits: [1, 1, 1] },
    { specializationId: 18, name: "Berserker", elite: true, traits: [1, 1, 1] },
  ],
  skills: {
    heal: { id: 14389, name: "Healing Signet", icon: "", slot: "Heal" },
    utility: [
      { id: 14388, name: "Stomp", icon: "", slot: "Utility" },
      { id: 14405, name: "Banner of Strength", icon: "", slot: "Utility" },
      { id: 14404, name: "Banner of Discipline", icon: "", slot: "Utility" },
    ],
    elite: { id: 14419, name: "Battle Standard", icon: "", slot: "Elite" },
  },
});

// Necromancer — Wells (Dark combo fields), minimal boons
const necromancerBuild = makeTestBuild({
  title: "Reaper",
  profession: "Necromancer",
  specializations: [
    { specializationId: 53, name: "Spite", elite: false, traits: [1, 1, 1] },
    { specializationId: 50, name: "Soul Reaping", elite: false, traits: [1, 1, 1] },
    { specializationId: 34, name: "Reaper", elite: true, traits: [1, 1, 1] },
  ],
  skills: {
    heal: { id: 10548, name: "Well of Blood", icon: "", slot: "Heal" },
    utility: [
      { id: 10546, name: "Well of Suffering", icon: "", slot: "Utility" },
      { id: 10545, name: "Well of Corruption", icon: "", slot: "Utility" },
      { id: 10609, name: "Well of Power", icon: "", slot: "Utility" },
    ],
    elite: { id: 10646, name: "Summon Flesh Golem", icon: "", slot: "Elite" },
  },
});

const lineId1 = uuid();
const lineId2 = uuid();

const comp = makeTestComp({
  name: "Party Coverage Test",
  buildIds: [guardianBuild.id, elementalistBuild.id, warriorBuild.id, necromancerBuild.id],
  partyLines: [
    { id: lineId1, capacity: 5, slots: [guardianBuild.id, elementalistBuild.id] },
    { id: lineId2, capacity: 5, slots: [warriorBuild.id, necromancerBuild.id] },
  ],
});

guardianBuild.compId = comp.id;
elementalistBuild.compId = comp.id;
warriorBuild.compId = comp.id;
necromancerBuild.compId = comp.id;

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Party Coverage — Rendering", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(guardianBuild);
    seedBuildFile(elementalistBuild);
    seedBuildFile(warriorBuild);
    seedBuildFile(necromancerBuild);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToComps(window);
    await openFirstComp(window);
    await waitForPartyCoverage(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // Test 1: Party coverage container renders
  test("party coverage container renders with party lines", async () => {
    const lines = window.locator(".party-cov__line");
    await expect(lines).toHaveCount(2);
  });

  // Test 2: Party lines have correct labels
  test("party lines have P1 and P2 labels", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const p2 = window.locator('.party-cov__line[data-line-label="P2"]');
    await expect(p1).toHaveCount(1);
    await expect(p2).toHaveCount(1);
  });

  // Test 3: P1 header shows profession icons
  test("P1 header shows Guardian and Elementalist profession icons", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const profIcons = p1.locator(".party-cov__header-prof");
    await expect(profIcons).toHaveCount(2);
  });

  // Test 4: P1 has covered boon pills
  test("P1 has at least one covered boon pill", async () => {
    // Expand P1 first
    const p1Header = window.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    await p1Header.click();
    await window.waitForTimeout(300);

    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const coveredPills = p1.locator(".party-cov__pill--boon:not(.party-cov__pill--uncovered)");
    const count = await coveredPills.count();
    expect(count).toBeGreaterThan(0);
  });

  // Test 5: P1 has combo field pills
  test("P1 has combo field pills", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const fieldPills = p1.locator(".party-cov__pill--field");
    const count = await fieldPills.count();
    expect(count).toBeGreaterThan(0);
  });

  // Test 6: P2 has finisher pills
  test("P2 has finisher pills", async () => {
    // Expand P2 first
    const p2Header = window.locator('.party-cov__line[data-line-label="P2"] .party-cov__line-header');
    await p2Header.click();
    await window.waitForTimeout(300);

    const p2 = window.locator('.party-cov__line[data-line-label="P2"]');
    const finisherPills = p2.locator(".party-cov__pill--finisher");
    const count = await finisherPills.count();
    expect(count).toBeGreaterThan(0);
  });

  // Test 7: Uncovered boons have uncovered styling
  test("uncovered boons have the uncovered class", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const uncoveredPills = p1.locator(".party-cov__pill--uncovered");
    const count = await uncoveredPills.count();
    // Not all 12 boons will be covered, so some should be uncovered
    expect(count).toBeGreaterThan(0);
  });

  // Test 8: Multi-provider boons show count badge
  test("boon pills with multiple providers show count badge", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    // Look for any pill with a badge (×N where N > 1)
    const badges = p1.locator(".party-cov__pill--boon .party-cov__pill-badge");
    const count = await badges.count();
    // Guardian + Elementalist both provide Might, so at least one badge expected
    expect(count).toBeGreaterThan(0);
  });
});
```

Write this to `tests/e2e/specs/party-coverage.spec.js`.

- [ ] **Step 2: Run the E2E rendering tests to verify they pass**

Run: `npx playwright test --config tests/e2e/playwright.config.js tests/e2e/specs/party-coverage.spec.js --grep "Rendering"`
Expected: All 8 rendering tests pass. If any fail due to skill ID coverage (e.g., no combo fields found), adjust skill IDs based on test output.

- [ ] **Step 3: Commit rendering tests**

```bash
git add tests/e2e/specs/party-coverage.spec.js
git commit -m "test(e2e): add party coverage rendering tests

Verifies party lines render with correct labels, profession icons,
covered/uncovered boon pills, combo field pills, finisher pills,
and count badges."
```

---

## Task 2: E2E Test File — Interaction Tests

**Files:**
- Modify: `tests/e2e/specs/party-coverage.spec.js`

- [ ] **Step 1: Add the interaction test describe block**

Append the following after the "Rendering" describe block (still inside the same file, using the same build fixtures):

```js
test.describe("Party Coverage — Interactions", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(guardianBuild);
    seedBuildFile(elementalistBuild);
    seedBuildFile(warriorBuild);
    seedBuildFile(necromancerBuild);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToComps(window);
    await openFirstComp(window);
    await waitForPartyCoverage(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // Test 9: Lines start collapsed
  test("party lines start collapsed by default", async () => {
    const bodies = window.locator(".party-cov__line-body");
    const count = await bodies.count();
    for (let i = 0; i < count; i++) {
      const hasCollapsed = await bodies.nth(i).evaluate(
        (el) => el.classList.contains("party-cov__line-body--collapsed")
      );
      expect(hasCollapsed).toBe(true);
    }
  });

  // Test 10: Line header expand/collapse
  test("clicking line header expands and collapses the line body", async () => {
    const p1Header = window.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    const p1Body = window.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-body');
    const p1Chevron = window.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-chevron');

    // Initially collapsed
    await expect(p1Chevron).toHaveText("\u25b8"); // ▸

    // Click to expand
    await p1Header.click();
    await window.waitForTimeout(300);
    const expandedClass = await p1Body.evaluate(
      (el) => !el.classList.contains("party-cov__line-body--collapsed")
    );
    expect(expandedClass).toBe(true);
    await expect(p1Chevron).toHaveText("\u25be"); // ▾

    // Click to collapse
    await p1Header.click();
    await window.waitForTimeout(300);
    const collapsedClass = await p1Body.evaluate(
      (el) => el.classList.contains("party-cov__line-body--collapsed")
    );
    expect(collapsedClass).toBe(true);
    await expect(p1Chevron).toHaveText("\u25b8"); // ▸
  });

  // Test 11: Boon pill expand
  test("clicking a covered boon pill expands its detail panel", async () => {
    // Expand P1
    const p1Header = window.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    await p1Header.click();
    await window.waitForTimeout(300);

    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const coveredPill = p1.locator('.party-cov__pill--boon[data-clickable="true"]').first();
    await coveredPill.click();
    await window.waitForTimeout(300);

    const expandEl = p1.locator('.party-cov__expand[data-expand-for="boons"]');
    const hasContent = await expandEl.evaluate((el) => el.innerHTML.trim().length > 0);
    expect(hasContent).toBe(true);
  });

  // Test 12: Boon detail shows source rows with profession icon, name, duration, target
  test("expanded boon detail shows source rows with expected content", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const expandEl = p1.locator('.party-cov__expand[data-expand-for="boons"]');
    const srcRows = expandEl.locator(".party-cov__src-row");
    const count = await srcRows.count();
    expect(count).toBeGreaterThan(0);

    // First source row should have an icon, name, duration, and target badge
    const firstRow = srcRows.first();
    await expect(firstRow.locator(".party-cov__src-icon")).toBeVisible();
    await expect(firstRow.locator(".party-cov__src-name")).toBeVisible();
    await expect(firstRow.locator(".party-cov__src-dur")).toBeVisible();

    // Target should be either ALLY or SELF
    const target = firstRow.locator(".party-cov__src-target--ally, .party-cov__src-target--self");
    await expect(target).toHaveCount(1);
  });

  // Test 13: Clicking same boon pill again collapses
  test("clicking the same boon pill again collapses the detail", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const coveredPill = p1.locator('.party-cov__pill--boon[data-clickable="true"]').first();
    await coveredPill.click();
    await window.waitForTimeout(300);

    const expandEl = p1.locator('.party-cov__expand[data-expand-for="boons"]');
    const hasContent = await expandEl.evaluate((el) => el.innerHTML.trim().length);
    expect(hasContent).toBe(0);
  });

  // Test 14: Self-boon toggle
  test("self-boon toggle hides self-only boons and revealing shows them", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const toggle = p1.locator('.party-cov__toggle-input');

    // Toggle is unchecked by default — self-only boons should have self-only class
    const selfOnlyBefore = await p1.locator(".party-cov__pill--self-only").count();

    // Check the toggle to show self boons
    await toggle.check();
    await window.waitForTimeout(300);
    const selfOnlyAfter = await p1.locator(".party-cov__pill--self-only").count();

    // After checking, no pills should have the self-only class
    expect(selfOnlyAfter).toBe(0);

    // Uncheck to restore
    await toggle.uncheck();
    await window.waitForTimeout(300);
    const selfOnlyRestored = await p1.locator(".party-cov__pill--self-only").count();
    expect(selfOnlyRestored).toBe(selfOnlyBefore);
  });

  // Test 15: Combo field pill expand
  test("clicking a combo field pill expands its detail", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const fieldPill = p1.locator('.party-cov__pill--field[data-clickable="true"]').first();
    await fieldPill.click();
    await window.waitForTimeout(300);

    const expandEl = p1.locator('.party-cov__expand[data-expand-for="fields"]');
    const srcRows = expandEl.locator(".party-cov__src-row");
    const count = await srcRows.count();
    expect(count).toBeGreaterThan(0);

    // Source row should have name
    await expect(srcRows.first().locator(".party-cov__src-name")).toBeVisible();

    // Click again to collapse
    await fieldPill.click();
    await window.waitForTimeout(300);
  });

  // Test 16: Finisher pill expand
  test("clicking a finisher pill expands its detail", async () => {
    // Need to use P2 which has finishers from Warrior
    const p2 = window.locator('.party-cov__line[data-line-label="P2"]');
    // Expand P2 if not already
    const p2Body = p2.locator(".party-cov__line-body");
    const isCollapsed = await p2Body.evaluate(
      (el) => el.classList.contains("party-cov__line-body--collapsed")
    );
    if (isCollapsed) {
      await p2.locator(".party-cov__line-header").click();
      await window.waitForTimeout(300);
    }

    const finisherPill = p2.locator('.party-cov__pill--finisher[data-clickable="true"]').first();
    await finisherPill.click();
    await window.waitForTimeout(300);

    const expandEl = p2.locator('.party-cov__expand[data-expand-for="finishers"]');
    const srcRows = expandEl.locator(".party-cov__src-row");
    const count = await srcRows.count();
    expect(count).toBeGreaterThan(0);

    await expect(srcRows.first().locator(".party-cov__src-name")).toBeVisible();

    // Collapse
    await finisherPill.click();
    await window.waitForTimeout(300);
  });
});
```

- [ ] **Step 2: Run the full E2E party coverage spec**

Run: `npx playwright test --config tests/e2e/playwright.config.js tests/e2e/specs/party-coverage.spec.js`
Expected: All 16 tests pass. If interaction tests fail, adjust selectors or waits based on output.

- [ ] **Step 3: Commit interaction tests**

```bash
git add tests/e2e/specs/party-coverage.spec.js
git commit -m "test(e2e): add party coverage interaction tests

Tests expand/collapse, boon pill detail expansion, self-boon
toggle, combo field expansion, and finisher expansion."
```

---

## Task 3: SPA Test File — Build Realistic boonCoverageHtml Fixture

**Files:**
- Create: `tests/spa/specs/party-coverage.spec.js`

The SPA receives pre-rendered `boonCoverageHtml`. We craft a realistic HTML string matching the production structure, with all data attributes the event delegation code relies on. This tests that the SPA rendering and interaction code works correctly.

- [ ] **Step 1: Create the SPA spec file with fixture HTML and desktop tests**

```js
const { test, expect } = require("playwright/test");
const { generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");

// Helper to escape HTML attribute values for embedding JSON in data attributes
function escAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Pre-built boonCoverageHtml matching production structure ─────────────────
// Two party lines: P1 (Guardian+Elementalist), P2 (Warrior+Necromancer)
// P1 has: covered boons (Might×2, Fury, Protection), Light combo field, Blast finisher
// P2 has: Blast×3 finishers, Dark combo field, sparse boons

const boonCoverageHtml = `
<div class="party-cov__line" data-line-label="P1">
  <div class="party-cov__line-header" data-action="toggle-line">
    <span class="party-cov__line-chevron">&#x25b8;</span>
    <span class="party-cov__line-label">P1</span>
    <span class="party-cov__header-profs">
      <span class="party-cov__header-prof" title="Firebrand">G</span>
      <span class="party-cov__header-prof" title="Tempest">E</span>
    </span>
    <span class="party-cov__header-boons">
      <img src="" width="16" height="16" alt="Aegis" class="party-cov__header-boon" data-boon-name="Aegis" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Alacrity" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Alacrity" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Fury" class="party-cov__header-boon" data-boon-name="Fury" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Might" class="party-cov__header-boon" data-boon-name="Might" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Protection" class="party-cov__header-boon" data-boon-name="Protection" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Quickness" class="party-cov__header-boon" data-boon-name="Quickness" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Regeneration" class="party-cov__header-boon" data-boon-name="Regeneration" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Resistance" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Resistance" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Resolution" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Resolution" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Stability" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Stability" data-has-ally="false" data-covered="false" />
      <img src="" width="16" height="16" alt="Swiftness" class="party-cov__header-boon" data-boon-name="Swiftness" data-has-ally="true" data-covered="true" />
      <img src="" width="16" height="16" alt="Vigor" class="party-cov__header-boon party-cov__header-boon--uncovered" data-boon-name="Vigor" data-has-ally="false" data-covered="false" />
    </span>
  </div>
  <div class="party-cov__line-body party-cov__line-body--collapsed">
    <div class="party-cov__section" data-section="boons">
      <div class="party-cov__section-header">
        <div class="party-cov__section-label">BOONS</div>
        <label class="party-cov__toggle">
          <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
          <span class="party-cov__toggle-switch"></span>
          <span class="party-cov__toggle-text">Show self boons</span>
        </label>
      </div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Might" data-has-ally="true" data-count="2"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Save Yourselves!", skillIcon: "", skillDescription: "Grant boons", skillFacts: [], stacks: 5, effectiveDuration: 15, context: "", isAlly: true }
               ]},
               { buildId: "e1", buildName: "Tempest", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", sources: [
                 { type: "skill", name: "Glyph of Elemental Harmony", skillIcon: "", skillDescription: "Heal and grant boons", skillFacts: [], stacks: 3, effectiveDuration: 10, context: "", isAlly: true }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Might" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Might</span>
          <span class="party-cov__pill-badge">&times;2</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Fury" data-has-ally="true" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Feel My Wrath!", skillIcon: "", skillDescription: "Grant fury and quickness", skillFacts: [], stacks: 1, effectiveDuration: 10, context: "", isAlly: true }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Fury" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Fury</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon party-cov__pill--uncovered"
             data-category="boon" data-boon-name="Alacrity" data-has-ally="false" data-count="0"
             data-providers="[]" data-line-label="P1">
          <img src="" width="20" height="20" alt="Alacrity" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Alacrity</span>
        </div>
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Regeneration" data-has-ally="false" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "g1", buildName: "Firebrand", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", sources: [
                 { type: "skill", name: "Purification", skillIcon: "", skillDescription: "Heal", skillFacts: [], stacks: 1, effectiveDuration: 10, context: "", isAlly: false }
               ]}
             ]))}"
             data-line-label="P1" data-clickable="true">
          <img src="" width="20" height="20" alt="Regeneration" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Regeneration</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="boons"></div>
    </div>
    <div class="party-cov__section" data-section="fields">
      <div class="party-cov__section-label">COMBO FIELDS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field" data-field-type="Light" data-count="1"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Wall of Reflection", profession: "Guardian", eliteSpec: "Firebrand", profIcon: "G", kitName: "", duration: 10, radius: 0, skillIcon: "", skillDescription: "Reflect projectiles", skillFacts: [] }
             ]))}"
             data-line-label="P1" data-clickable="true"
             style="background:#5a5a3a;border-color:#7a7a5a;">
          <span class="party-cov__pill-emoji">✨</span>
          <span class="party-cov__pill-name">Light</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="fields"></div>
    </div>
    <div class="party-cov__section" data-section="finishers">
      <div class="party-cov__section-label">FINISHERS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--finisher"
             data-category="finisher" data-finisher-type="Blast" data-count="2"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Arcane Wave", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Blast wave", skillFacts: [] },
               { sourceName: "Aftershock!", profession: "Elementalist", eliteSpec: "Tempest", profIcon: "E", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Earth finisher", skillFacts: [] }
             ]))}"
             data-line-label="P1" data-clickable="true"
             style="background:#4a3a5a;border-color:#6a5a7a;">
          <span class="party-cov__pill-emoji">💥</span>
          <span class="party-cov__pill-name">Blast</span>
          <span class="party-cov__pill-badge" style="color:#c8f;">&times;2</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="finishers"></div>
    </div>
  </div>
</div>
<div class="party-cov__line" data-line-label="P2">
  <div class="party-cov__line-header" data-action="toggle-line">
    <span class="party-cov__line-chevron">&#x25b8;</span>
    <span class="party-cov__line-label">P2</span>
    <span class="party-cov__header-profs">
      <span class="party-cov__header-prof" title="Berserker">W</span>
      <span class="party-cov__header-prof" title="Reaper">N</span>
    </span>
    <span class="party-cov__header-boons">
      <img src="" width="16" height="16" alt="Might" class="party-cov__header-boon" data-boon-name="Might" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Fury" class="party-cov__header-boon" data-boon-name="Fury" data-has-ally="false" data-covered="true" />
      <img src="" width="16" height="16" alt="Stability" class="party-cov__header-boon" data-boon-name="Stability" data-has-ally="false" data-covered="true" />
    </span>
  </div>
  <div class="party-cov__line-body party-cov__line-body--collapsed">
    <div class="party-cov__section" data-section="boons">
      <div class="party-cov__section-header">
        <div class="party-cov__section-label">BOONS</div>
        <label class="party-cov__toggle">
          <input type="checkbox" class="party-cov__toggle-input" data-action="toggle-self-boons" />
          <span class="party-cov__toggle-switch"></span>
          <span class="party-cov__toggle-text">Show self boons</span>
        </label>
      </div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--boon"
             data-category="boon" data-boon-name="Stability" data-has-ally="false" data-count="1"
             data-providers="${escAttr(JSON.stringify([
               { buildId: "w1", buildName: "Berserker", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", sources: [
                 { type: "skill", name: "Stomp", skillIcon: "", skillDescription: "Stomp the ground", skillFacts: [], stacks: 2, effectiveDuration: 6, context: "", isAlly: false }
               ]}
             ]))}"
             data-line-label="P2" data-clickable="true">
          <img src="" width="20" height="20" alt="Stability" class="party-cov__pill-icon" />
          <span class="party-cov__pill-name">Stability</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="boons"></div>
    </div>
    <div class="party-cov__section" data-section="fields">
      <div class="party-cov__section-label">COMBO FIELDS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--field"
             data-category="field" data-field-type="Dark" data-count="2"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Well of Suffering", profession: "Necromancer", eliteSpec: "Reaper", profIcon: "N", kitName: "", duration: 5, radius: 240, skillIcon: "", skillDescription: "Dark well", skillFacts: [] },
               { sourceName: "Well of Corruption", profession: "Necromancer", eliteSpec: "Reaper", profIcon: "N", kitName: "", duration: 5, radius: 240, skillIcon: "", skillDescription: "Corrupt boons", skillFacts: [] }
             ]))}"
             data-line-label="P2" data-clickable="true"
             style="background:#3a2a3a;border-color:#5a3a5a;">
          <span class="party-cov__pill-emoji">🌑</span>
          <span class="party-cov__pill-name">Dark</span>
          <span class="party-cov__pill-badge" style="color:#c8a;">&times;2</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="fields"></div>
    </div>
    <div class="party-cov__section" data-section="finishers">
      <div class="party-cov__section-label">FINISHERS</div>
      <div class="party-cov__pills">
        <div class="party-cov__pill party-cov__pill--finisher"
             data-category="finisher" data-finisher-type="Blast" data-count="3"
             data-sources="${escAttr(JSON.stringify([
               { sourceName: "Stomp", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Stomp the ground", skillFacts: [] },
               { sourceName: "Banner of Strength", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Place a banner", skillFacts: [] },
               { sourceName: "Banner of Discipline", profession: "Warrior", eliteSpec: "Berserker", profIcon: "W", kitName: "", hitCount: 1, percent: 100, skillIcon: "", skillDescription: "Place a banner", skillFacts: [] }
             ]))}"
             data-line-label="P2" data-clickable="true"
             style="background:#4a3a5a;border-color:#6a5a7a;">
          <span class="party-cov__pill-emoji">💥</span>
          <span class="party-cov__pill-name">Blast</span>
          <span class="party-cov__pill-badge" style="color:#c8f;">&times;3</span>
        </div>
      </div>
      <div class="party-cov__expand" data-expand-for="finishers"></div>
    </div>
  </div>
</div>`;

// ── Desktop Tests ────────────────────────────────────────────────────────────

test.describe("Party Coverage — Desktop", () => {
  test.skip(({ viewport }) => viewport.width < 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const builds = [
      makeTestBuild({ profession: "Guardian", title: "Firebrand" }),
      makeTestBuild({ profession: "Elementalist", title: "Tempest" }),
      makeTestBuild({ profession: "Warrior", title: "Berserker" }),
      makeTestBuild({ profession: "Necromancer", title: "Reaper" }),
    ];
    const comp = makeTestComp({
      name: "Party Coverage SPA Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [
        { id: "pl-1", capacity: 5, slots: [builds[0].id, builds[1].id] },
        { id: "pl-2", capacity: 5, slots: [builds[2].id, builds[3].id] },
      ],
      boonCoverageHtml,
    });
    payload = generateCompPayload(comp, builds);
  });

  // SPA Test 1: Party coverage renders
  test("party coverage container renders with party lines", async ({ page }) => {
    await loadCompPage(page, payload);
    const lines = page.locator(".party-cov__line");
    await expect(lines).toHaveCount(2);
  });

  // SPA Test 2: Labels
  test("party lines have P1 and P2 labels", async ({ page }) => {
    await loadCompPage(page, payload);
    await expect(page.locator('.party-cov__line-label:text("P1")')).toBeVisible();
    await expect(page.locator('.party-cov__line-label:text("P2")')).toBeVisible();
  });

  // SPA Test 3: Header content
  test("P1 header shows profession icons and covered boon indicators", async ({ page }) => {
    await loadCompPage(page, payload);
    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const profIcons = p1.locator(".party-cov__header-prof");
    await expect(profIcons).toHaveCount(2);

    // Covered boon icons should not have uncovered class
    const coveredBoons = p1.locator('.party-cov__header-boon:not(.party-cov__header-boon--uncovered)');
    const count = await coveredBoons.count();
    expect(count).toBeGreaterThan(0);
  });

  // SPA Test 4: All three sections
  test("each line has boons, fields, and finishers sections", async ({ page }) => {
    await loadCompPage(page, payload);

    // Expand P1 to make sections visible
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    await expect(p1.locator('[data-section="boons"]')).toHaveCount(1);
    await expect(p1.locator('[data-section="fields"]')).toHaveCount(1);
    await expect(p1.locator('[data-section="finishers"]')).toHaveCount(1);
  });

  // SPA Test 5: Expand/collapse
  test("clicking line header expands and collapses", async ({ page }) => {
    await loadCompPage(page, payload);
    const header = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    const body = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-body');
    const chevron = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-chevron');

    // Start collapsed
    await expect(chevron).toHaveText("\u25b8");

    // Expand
    await header.click();
    await expect(chevron).toHaveText("\u25be");
    const expanded = await body.evaluate((el) => !el.classList.contains("party-cov__line-body--collapsed"));
    expect(expanded).toBe(true);

    // Collapse
    await header.click();
    await expect(chevron).toHaveText("\u25b8");
  });

  // SPA Test 6: Boon pill expand
  test("clicking covered boon pill shows source detail rows", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const mightPill = p1.locator('.party-cov__pill--boon[data-boon-name="Might"]');
    await mightPill.click();
    await page.waitForTimeout(300);

    const srcRows = p1.locator('.party-cov__expand[data-expand-for="boons"] .party-cov__src-row');
    const count = await srcRows.count();
    expect(count).toBeGreaterThan(0);

    // Verify source row content
    await expect(srcRows.first().locator(".party-cov__src-name")).toBeVisible();
    await expect(srcRows.first().locator(".party-cov__src-dur")).toBeVisible();
  });

  // SPA Test 7: Combo field pill expand
  test("clicking field pill shows source details", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const lightPill = p1.locator('.party-cov__pill--field[data-field-type="Light"]');
    await lightPill.click();
    await page.waitForTimeout(300);

    const srcRows = p1.locator('.party-cov__expand[data-expand-for="fields"] .party-cov__src-row');
    expect(await srcRows.count()).toBeGreaterThan(0);
  });

  // SPA Test 8: Finisher pill expand
  test("clicking finisher pill shows source details", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P2"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p2 = page.locator('.party-cov__line[data-line-label="P2"]');
    const blastPill = p2.locator('.party-cov__pill--finisher[data-finisher-type="Blast"]');
    await blastPill.click();
    await page.waitForTimeout(300);

    const srcRows = p2.locator('.party-cov__expand[data-expand-for="finishers"] .party-cov__src-row');
    expect(await srcRows.count()).toBe(3);
  });

  // SPA Test 9: Self-boon toggle
  test("self-boon toggle changes boon pill visibility", async ({ page }) => {
    await loadCompPage(page, payload);
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const p1 = page.locator('.party-cov__line[data-line-label="P1"]');
    const toggle = p1.locator(".party-cov__toggle-input");

    // Regeneration has has-ally=false, so with toggle off it should get self-only class
    const regenPill = p1.locator('.party-cov__pill--boon[data-boon-name="Regeneration"]');
    const hasSelfOnly = await regenPill.evaluate((el) => el.classList.contains("party-cov__pill--self-only"));
    expect(hasSelfOnly).toBe(true);

    // Check toggle to show self boons
    await toggle.check();
    await page.waitForTimeout(300);
    const hasSelfOnlyAfter = await regenPill.evaluate((el) => el.classList.contains("party-cov__pill--self-only"));
    expect(hasSelfOnlyAfter).toBe(false);
  });
});
```

Write this to `tests/spa/specs/party-coverage.spec.js`.

- [ ] **Step 2: Run the SPA desktop tests**

Run: `npx playwright test --config tests/spa/playwright.config.js tests/spa/specs/party-coverage.spec.js --project=desktop`
Expected: All 9 desktop tests pass.

- [ ] **Step 3: Commit SPA desktop tests**

```bash
git add tests/spa/specs/party-coverage.spec.js
git commit -m "test(spa): add party coverage desktop tests

Tests rendering, expand/collapse, pill expansion for boons/fields/
finishers, and self-boon toggle on desktop viewport."
```

---

## Task 4: SPA Test File — Mobile Viewport Tests

**Files:**
- Modify: `tests/spa/specs/party-coverage.spec.js`

- [ ] **Step 1: Append the mobile test describe block**

Add after the Desktop describe block:

```js
// ── Mobile Tests ─────────────────────────────────────────────────────────────

test.describe("Party Coverage — Mobile", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const builds = [
      makeTestBuild({ profession: "Guardian", title: "Firebrand" }),
      makeTestBuild({ profession: "Elementalist", title: "Tempest" }),
      makeTestBuild({ profession: "Warrior", title: "Berserker" }),
      makeTestBuild({ profession: "Necromancer", title: "Reaper" }),
    ];
    const comp = makeTestComp({
      name: "Party Coverage SPA Mobile Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [
        { id: "pl-1", capacity: 5, slots: [builds[0].id, builds[1].id] },
        { id: "pl-2", capacity: 5, slots: [builds[2].id, builds[3].id] },
      ],
      boonCoverageHtml,
    });
    payload = generateCompPayload(comp, builds);
  });

  // SPA Mobile Test 10: Renders at mobile width
  test("party coverage renders at mobile width without horizontal overflow", async ({ page }) => {
    await loadCompPage(page, payload);
    const container = page.locator(".comp-boon-cov");
    await expect(container).toBeVisible();

    // Check no horizontal overflow
    const overflows = await page.evaluate(() => {
      const el = document.querySelector(".comp-boon-cov");
      return el ? el.scrollWidth > el.clientWidth : false;
    });
    expect(overflows).toBe(false);
  });

  // SPA Mobile Test 11: Header boons wrap
  test("header boons wrap at narrow width", async ({ page }) => {
    await loadCompPage(page, payload);
    const headerBoons = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__header-boons');
    await expect(headerBoons).toBeVisible();

    // flex-wrap should be applied — verify computed style
    const flexWrap = await headerBoons.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe("wrap");
  });

  // SPA Mobile Test 12: Pills tappable
  test("pill elements are visible and tappable at narrow width", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').click();
    await page.waitForTimeout(300);

    const pill = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__pill--boon[data-clickable="true"]').first();
    await expect(pill).toBeVisible();

    // Verify it's not clipped (bounding box within viewport)
    const box = await pill.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  });

  // SPA Mobile Test 13: Expand/collapse via tap
  test("expand and collapse work via tap on mobile", async ({ page }) => {
    await loadCompPage(page, payload);
    const header = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header');
    const chevron = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-chevron');

    await expect(chevron).toHaveText("\u25b8");
    await header.tap();
    await expect(chevron).toHaveText("\u25be");
    await header.tap();
    await expect(chevron).toHaveText("\u25b8");
  });

  // SPA Mobile Test 14: Expanded detail fits viewport
  test("expanded detail panel does not exceed viewport width", async ({ page }) => {
    await loadCompPage(page, payload);
    // Expand P1
    await page.locator('.party-cov__line[data-line-label="P1"] .party-cov__line-header').tap();
    await page.waitForTimeout(300);

    // Tap a boon pill
    const pill = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__pill--boon[data-clickable="true"]').first();
    await pill.tap();
    await page.waitForTimeout(300);

    // Check expand container fits
    const expandEl = page.locator('.party-cov__line[data-line-label="P1"] .party-cov__expand[data-expand-for="boons"]');
    const overflows = await expandEl.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(overflows).toBe(false);
  });
});
```

- [ ] **Step 2: Run the full SPA spec (all viewports)**

Run: `npx playwright test --config tests/spa/playwright.config.js tests/spa/specs/party-coverage.spec.js`
Expected: 9 desktop tests pass, 5 mobile tests pass, desktop tests skip on mobile viewport, mobile tests skip on desktop viewport.

- [ ] **Step 3: Commit mobile tests**

```bash
git add tests/spa/specs/party-coverage.spec.js
git commit -m "test(spa): add party coverage mobile viewport tests

Tests flex-wrap on header boons, pill tappability, tap expand/
collapse, and expanded detail viewport fitting at 375x667."
```

---

## Task 5: Run Full Test Suites and Fix Issues

**Files:**
- Modify: `tests/e2e/specs/party-coverage.spec.js` (if fixes needed)
- Modify: `tests/spa/specs/party-coverage.spec.js` (if fixes needed)

- [ ] **Step 1: Run the full E2E suite to check for regressions**

Run: `npx playwright test --config tests/e2e/playwright.config.js`
Expected: All existing tests still pass alongside new party-coverage tests.

- [ ] **Step 2: Run the full SPA suite to check for regressions**

Run: `npx playwright test --config tests/spa/playwright.config.js`
Expected: All existing tests still pass alongside new party-coverage tests.

- [ ] **Step 3: Fix any failures**

If E2E tests fail because certain skill IDs don't produce the expected boon/field/finisher facts, inspect the test output to see which pills rendered, then adjust the skill IDs in the build fixtures. The fixture catalog JSON files at `tests/e2e/fixtures/` contain the authoritative skill data.

If SPA tests fail because the `boonCoverageHtml` structure doesn't match what `render-comp.js` expects, compare against the HTML generated by `buildPartyCoverageHTML()` in `src/renderer/modules/comps/comp-boon-coverage.js`.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add tests/e2e/specs/party-coverage.spec.js tests/spa/specs/party-coverage.spec.js
git commit -m "test: fix party coverage test issues from full suite run"
```
