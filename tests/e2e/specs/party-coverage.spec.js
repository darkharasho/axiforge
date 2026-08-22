const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { openFirstComp } = require("../helpers/comps");
const { goToComps } = require("../helpers/nav");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp, uuid } = require("../helpers/builds");

// ── Helpers ──────────────────────────────────────────────────────────────────


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

guardianBuild.compIds = [comp.id];
elementalistBuild.compIds = [comp.id];
warriorBuild.compIds = [comp.id];
necromancerBuild.compIds = [comp.id];

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Party Coverage — Rendering", () => {
  test.describe.configure({ timeout: 60_000 });
  let app, window;

  test.beforeAll(async () => {
    test.setTimeout(60_000);
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

    // _closeExpand removes the --open class (does not clear innerHTML)
    const expandEl = p1.locator('.party-cov__expand[data-expand-for="boons"]');
    const isOpen = await expandEl.evaluate(
      (el) => el.classList.contains("party-cov__expand--open")
    );
    expect(isOpen).toBe(false);
  });

  // Test 14: Self-boon toggle
  test("self-boon toggle hides self-only boons and revealing shows them", async () => {
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    // The toggle label is visible and wraps the hidden checkbox — click it to toggle
    const toggleLabel = p1.locator('.party-cov__toggle');

    // Toggle is unchecked by default — self-only boons should have self-only class
    const selfOnlyBefore = await p1.locator(".party-cov__pill--self-only").count();

    // Click the visible label to check the toggle (show self boons)
    await toggleLabel.click();
    await window.waitForTimeout(300);
    const selfOnlyAfter = await p1.locator(".party-cov__pill--self-only").count();

    // After checking, no pills should have the self-only class
    expect(selfOnlyAfter).toBe(0);

    // Click again to uncheck and restore
    await toggleLabel.click();
    await window.waitForTimeout(300);
    const selfOnlyRestored = await p1.locator(".party-cov__pill--self-only").count();
    expect(selfOnlyRestored).toBe(selfOnlyBefore);
  });

  // Test 15: Combo field pill expand
  test("clicking a combo field pill expands its detail", async () => {
    // Ensure P1 is expanded before clicking field pill
    const p1 = window.locator('.party-cov__line[data-line-label="P1"]');
    const p1Body = p1.locator(".party-cov__line-body");
    const p1IsCollapsed = await p1Body.evaluate(
      (el) => el.classList.contains("party-cov__line-body--collapsed")
    );
    if (p1IsCollapsed) {
      await p1.locator(".party-cov__line-header").click();
      await window.waitForTimeout(300);
    }

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
