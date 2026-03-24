const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Responsive transitions", () => {
  test.skip(({ viewport }) => viewport.width <= 1024, "Starts at desktop, resizes to mobile");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Responsive Test" });
    payload = generateBuildPayload(build);
  });

  test("desktop to mobile: detail panel hides, accordion activates", async ({ page }) => {
    await loadBuildPage(page, payload);

    await expect(page.locator(".detail-panel")).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    await expect(page.locator(".detail-panel")).not.toBeVisible();

    const mobileHeaders = page.locator(".spec-card__mobile-header");
    if (await page.locator(".spec-card").count() > 0) {
      await expect(mobileHeaders.first()).toBeVisible();
    }

    // Navigate to the EQUIPMENT tab so the equip-mobile-tabs element is visible
    const equipTab = page.locator(".site-tab").filter({ hasText: "EQUIPMENT" });
    await equipTab.click();
    await page.waitForTimeout(200);

    await expect(page.locator(".equip-mobile-tabs")).toBeVisible();
  });

  test("mobile to desktop: accordion collapses, detail panel returns", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loadBuildPage(page, payload);
    await page.waitForTimeout(300);

    await expect(page.locator(".detail-panel")).not.toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);

    await expect(page.locator(".detail-panel")).toBeVisible();

    // Navigate to the EQUIPMENT tab to confirm equip-mobile-tabs is hidden at desktop width
    const equipTab = page.locator(".site-tab").filter({ hasText: "EQUIPMENT" });
    await equipTab.click();
    await page.waitForTimeout(200);
    await expect(page.locator(".equip-mobile-tabs")).not.toBeVisible();
  });

  test("full resize cycle produces no broken state", async ({ page }) => {
    await loadBuildPage(page, payload);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);

    await expect(page.locator(".skills-host")).toBeVisible();
    await expect(page.locator(".specializations-host")).toBeVisible();
    await expect(page.locator(".detail-panel")).toBeVisible();
  });
});
