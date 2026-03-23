const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor, switchTab } = require("../helpers/nav");
const { selectProfession, setGameMode } = require("../helpers/editor");

// Helper: select a utility skill by clicking the nth slot (0-based) and picking by name
async function selectUtilitySkill(window, utilIndex, skillName) {
  const utilGroup = window.locator(".skill-group--utilities");
  // Utility slots are at indices 1, 2, 3 (heal=0, elite=4)
  const slot = utilGroup.locator(".skill-slot").nth(utilIndex + 1);
  const iconBtn = slot.locator(".skill-icon-large");
  await iconBtn.click();

  const cselectOpen = window.locator(".cselect--skill-slot.cselect--open");
  await expect(cselectOpen).toBeVisible({ timeout: 3000 });

  // Click the option matching the skill name (scroll into view handled by Playwright)
  const option = cselectOpen.locator(`.cselect__option:has-text("${skillName}")`).first();
  await option.scrollIntoViewIfNeeded();
  await option.click();
  await window.waitForTimeout(500);
}

// Helper: read a stat value from the Attributes section
async function getStatValue(window, statLabel) {
  const panel = window.locator("#equipmentPanel");
  const statsSection = panel.locator(".equip-section").filter({ hasText: "Attributes" }).first();
  const rows = statsSection.locator(".equip-stat-row");
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const label = await rows.nth(i).locator(".equip-stat-label").first().textContent();
    if (label.trim() === statLabel) {
      const value = await rows.nth(i).locator(".equip-stat-value").first().textContent();
      return parseInt(value.replace(/,/g, ""));
    }
  }
  return null;
}

// Helper: read the Crit Chance derived stat value
async function getCritChance(window) {
  const panel = window.locator("#equipmentPanel");
  const statsSection = panel.locator(".equip-section").filter({ hasText: "Attributes" }).first();
  const precisionRow = statsSection.locator(".equip-stat-row").nth(1); // Precision is second row
  const derivedCell = precisionRow.locator(".equip-stat-cell--derived");
  const critValue = await derivedCell.locator(".equip-stat-value").textContent();
  return critValue.trim();
}

// ─── Skill passive attribute bonuses (issue #61) ────────────────────────────

test.describe("Skill passive attribute bonuses", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Elementalist");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("Signet of Fire increases Precision and Crit Chance", async () => {
    // 1. Check base attributes on the equipment tab
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const basePrecision = await getStatValue(window, "Precision");
    expect(basePrecision).toBe(1000);

    const baseCrit = await getCritChance(window);
    expect(baseCrit).toBe("10.0%");

    // 2. Switch to build tab and equip Signet of Fire
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    await selectUtilitySkill(window, 0, "Signet of Fire");

    // Verify the skill icon title updated to confirm selection
    const utilGroup = window.locator(".skill-group--utilities");
    const utilSlot = utilGroup.locator(".skill-slot").nth(1); // first utility slot
    const iconTitle = await utilSlot.locator(".skill-icon-large").getAttribute("title");
    expect(iconTitle).toContain("Signet of Fire");

    // 3. Switch back to equipment tab and verify Precision increased by 180
    await switchTab(window, "equipment");
    await window.waitForTimeout(500);

    const newPrecision = await getStatValue(window, "Precision");
    expect(newPrecision).toBe(1000 + 180);

    // 4. Verify Crit Chance updated: 5 + (1180 - 895) / 21.0 = 18.6%
    const newCrit = await getCritChance(window);
    expect(newCrit).toBe("18.6%");
  });

  test("removing signet reverts Precision and Crit Chance to base", async () => {
    // Signet of Fire is equipped from previous test. Replace it with a non-signet skill.
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    // Select a different utility that does NOT grant a passive attribute bonus
    await selectUtilitySkill(window, 0, "Glyph of Storms");

    await switchTab(window, "equipment");
    await window.waitForTimeout(500);

    const precision = await getStatValue(window, "Precision");
    expect(precision).toBe(1000);

    const crit = await getCritChance(window);
    expect(crit).toBe("10.0%");
  });
});

test.describe("Skill passive bonuses — WvW mode", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Guardian");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("Bane Signet adds +180 Power in PvE", async () => {
    // Equip Bane Signet
    await selectUtilitySkill(window, 0, "Bane Signet");

    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const power = await getStatValue(window, "Power");
    expect(power).toBe(1000 + 180);
  });
});
