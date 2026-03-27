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
