const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile spec accordion", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Accordion Test" });
    payload = generateBuildPayload(build);
  });

  test("spec cards have mobile headers on mobile viewport", async ({ page }) => {
    await loadBuildPage(page, payload);
    const specCards = page.locator(".spec-card");
    const specCount = await specCards.count();
    if (specCount === 0) {
      test.skip(true, "No spec cards rendered");
      return;
    }
    const mobileHeaders = page.locator(".spec-card__mobile-header");
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
    await headers.nth(0).click();
    await page.waitForTimeout(300);
    await expect(specCards.nth(0)).toHaveClass(/expanded/);
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
    const beforeTransform = await chevron.evaluate((el) => getComputedStyle(el).transform);
    await header.click();
    await page.waitForTimeout(300);
    const afterTransform = await chevron.evaluate((el) => getComputedStyle(el).transform);
    expect(afterTransform).not.toBe(beforeTransform);
  });
});
