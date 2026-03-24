const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile equipment sub-tabs", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Equip Tabs Test" });
    payload = generateBuildPayload(build);
  });

  async function openEquipmentTab(page) {
    const equipTab = page.locator(".site-tab").filter({ hasText: "EQUIPMENT" });
    await equipTab.click();
    await page.waitForTimeout(200);
  }

  test("equipment sub-tabs are visible on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);
    await openEquipmentTab(page);
    const tabs = page.locator(".equip-mobile-tabs");
    await expect(tabs).toBeVisible();
  });

  test("sub-tabs show correct labels", async ({ page }) => {
    await loadBuildPage(page, payload);
    await openEquipmentTab(page);
    const tabButtons = page.locator(".equip-mobile-tab");
    await expect(tabButtons).toHaveCount(2);
    await expect(tabButtons.nth(0)).toContainText("Armor & Runes");
    await expect(tabButtons.nth(1)).toContainText("Weapons & Trinkets");
  });

  test("first tab is active by default", async ({ page }) => {
    await loadBuildPage(page, payload);
    await openEquipmentTab(page);
    const firstTab = page.locator(".equip-mobile-tab").first();
    await expect(firstTab).toHaveClass(/equip-mobile-tab--active/);
    const leftCol = page.locator(".equip-col--left");
    const rightCol = page.locator(".equip-col--right");
    await expect(leftCol).toBeVisible();
    await expect(rightCol).not.toBeVisible();
  });

  test("clicking second tab switches columns", async ({ page }) => {
    await loadBuildPage(page, payload);
    await openEquipmentTab(page);
    const tabs = page.locator(".equip-mobile-tab");
    await tabs.nth(1).click();
    await page.waitForTimeout(200);
    await expect(tabs.nth(1)).toHaveClass(/equip-mobile-tab--active/);
    await expect(tabs.nth(0)).not.toHaveClass(/equip-mobile-tab--active/);
    const leftCol = page.locator(".equip-col--left");
    const rightCol = page.locator(".equip-col--right");
    await expect(rightCol).toBeVisible();
    await expect(leftCol).not.toBeVisible();
  });

  test("clicking first tab switches back", async ({ page }) => {
    await loadBuildPage(page, payload);
    await openEquipmentTab(page);
    const tabs = page.locator(".equip-mobile-tab");
    await tabs.nth(1).click();
    await page.waitForTimeout(200);
    await tabs.nth(0).click();
    await page.waitForTimeout(200);
    await expect(tabs.nth(0)).toHaveClass(/equip-mobile-tab--active/);
    const leftCol = page.locator(".equip-col--left");
    await expect(leftCol).toBeVisible();
  });
});
