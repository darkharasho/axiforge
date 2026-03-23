const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor, switchTab } = require("../helpers/nav");
const { selectProfession } = require("../helpers/editor");

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

// Helper: select a weapon type in a weapon slot, then set its stat combo
async function equipWeapon(window, weaponName, statCombo) {
  const panel = window.locator("#equipmentPanel");
  const weaponSection = panel.locator(".equip-section").filter({ hasText: "Weapons" }).first();

  // Find the first weapon type button and click to open picker
  const weaponSlots = weaponSection.locator(".equip-slot--weapon");
  const slot = weaponSlots.first();
  const weaponBtn = slot.locator(".equip-weapon-type-btn");
  await weaponBtn.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  await window.click(`.slot-picker__option:has-text("${weaponName}")`);
  await window.waitForTimeout(300);

  // Now click the stat picker button
  const statBtn = slot.locator(".equip-stat-pick-btn");
  await statBtn.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
  const search = window.locator(".slot-picker__search");
  if (await search.isVisible()) {
    await search.fill(statCombo);
    await window.waitForTimeout(200);
  }
  await window.click(`.slot-picker__option:has-text("${statCombo}")`);
  await window.waitForTimeout(300);
}

// ─── Active weapon set filtering (issue #64) ────────────────────────────────

test.describe("Weapon set stats — swapping sets updates attributes", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("only active weapon set contributes to stats, swapping updates attributes", async () => {
    // Seed state: Berserker's on mainhand1 (set 1), Celestial on mainhand2 (set 2)
    // This bypasses the complex weapon picker UI.
    await window.evaluate(() => {
      const el = document.querySelector("#equipmentPanel");
      // Access state through the module system is not possible from evaluate,
      // so we trigger the stat change via the equipment panel's own mechanisms.
    });

    // Equip Axe + Berserker's on mainhand1 (set 1)
    await equipWeapon(window, "Axe", "Berserker");

    // Power and Ferocity should increase
    const ferocitySet1 = await getStatValue(window, "Ferocity");
    expect(ferocitySet1).toBeGreaterThan(0);
    const powerSet1 = await getStatValue(window, "Power");
    expect(powerSet1).toBeGreaterThan(1000);

    // Also equip a weapon on set 2 so the swap button is enabled.
    // Set 2 weapon slots are the 3rd and 4th .equip-slot--weapon elements.
    const panel = window.locator("#equipmentPanel");
    const weaponSection = panel.locator(".equip-section").filter({ hasText: "Weapons" }).first();
    const weaponSlots = weaponSection.locator(".equip-slot--weapon");
    const mh2Slot = weaponSlots.nth(2); // mainhand2
    const mh2WeaponBtn = mh2Slot.locator(".equip-weapon-type-btn");
    await mh2WeaponBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });
    await window.click('.slot-picker__option:has-text("Dagger")');
    await window.waitForTimeout(300);

    // Set Celestial stats on mainhand2
    const mh2StatBtn = mh2Slot.locator(".equip-stat-pick-btn");
    await mh2StatBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });
    const search = window.locator(".slot-picker__search");
    if (await search.isVisible()) {
      await search.fill("Celestial");
      await window.waitForTimeout(200);
    }
    await window.click('.slot-picker__option:has-text("Celestial")');
    await window.waitForTimeout(300);

    // Set 1 is still active — Ferocity should reflect Berserker's only (not Celestial)
    const ferocityStillSet1 = await getStatValue(window, "Ferocity");
    expect(ferocityStillSet1).toBe(ferocitySet1); // unchanged

    // Force a full re-render so the skill bar picks up the set 2 weapon
    // (toggling underwater mode triggers renderEditor which re-renders skills + equipment)
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await waterBtn.click();
    await window.waitForTimeout(300);
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    await landBtn.click();
    await window.waitForTimeout(500);

    // Now swap to set 2
    const swapBtn = window.locator(".skills-bar .weapon-swap-btn");
    await expect(swapBtn).toBeVisible({ timeout: 3000 });
    await swapBtn.click();
    await window.waitForTimeout(500);

    // Check equipment tab — set 2 (Celestial) should be active
    await switchTab(window, "equipment");
    await window.waitForTimeout(500);

    // Celestial has equal stats across all 9 attributes (59 per stat for 1H weapon)
    const ferocitySet2 = await getStatValue(window, "Ferocity");
    const expertiseSet2 = await getStatValue(window, "Expertise");
    // Celestial gives the same value to all stats
    expect(ferocitySet2).toBeGreaterThan(0);
    expect(expertiseSet2).toBeGreaterThan(0);
    // Berserker's set 1 should NOT be contributing (it has 0 Expertise)
    expect(ferocitySet2).toBe(expertiseSet2);

    // Swap back to set 1
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    await swapBtn.click();
    await window.waitForTimeout(500);
    await switchTab(window, "equipment");
    await window.waitForTimeout(500);

    // Ferocity should be Berserker's value again, Expertise should be 0
    expect(await getStatValue(window, "Ferocity")).toBe(ferocitySet1);
    expect(await getStatValue(window, "Expertise")).toBe(0);
  });
});

test.describe("Weapon set stats — land/water toggle", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("switching to underwater excludes land weapon stats", async () => {
    // Equip Axe + Berserker's on mainhand1
    await equipWeapon(window, "Axe", "Berserker");
    const ferocityLand = await getStatValue(window, "Ferocity");
    expect(ferocityLand).toBeGreaterThan(0);

    // Switch to underwater via the toggle
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Equipment tab should show 0 Ferocity (land weapon excluded)
    await switchTab(window, "equipment");
    await window.waitForTimeout(500);
    expect(await getStatValue(window, "Ferocity")).toBe(0);

    // Switch back to land — Ferocity should restore
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    await landBtn.click();
    await window.waitForTimeout(500);
    await switchTab(window, "equipment");
    await window.waitForTimeout(500);
    expect(await getStatValue(window, "Ferocity")).toBe(ferocityLand);
  });
});
