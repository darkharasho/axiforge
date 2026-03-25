const { test, expect } = require("playwright/test");

test.describe("Background fills viewport on short pages", () => {
  test("landing page body covers full viewport height", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".site-landing", { timeout: 10_000 });

    const bodyHeight = await page.evaluate(() => document.body.getBoundingClientRect().height);
    const viewportHeight = page.viewportSize().height;

    expect(bodyHeight).toBeGreaterThanOrEqual(viewportHeight);
  });

  test("error page body covers full viewport height", async ({ page }) => {
    // Navigate with an invalid build param to trigger the error state
    await page.goto("/?b=invalid");
    await page.waitForSelector(".site-error", { timeout: 10_000 });

    const bodyHeight = await page.evaluate(() => document.body.getBoundingClientRect().height);
    const viewportHeight = page.viewportSize().height;

    expect(bodyHeight).toBeGreaterThanOrEqual(viewportHeight);
  });
});
