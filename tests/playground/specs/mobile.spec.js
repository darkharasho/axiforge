const { test, expect } = require("playwright/test");

const ENTRY = "/index.generated.html";
const READY_TIMEOUT = 20_000;

// Only run these on the mobile project (390x844).
test.skip(({ viewport }) => (viewport?.width ?? 0) > 600, "mobile-only");

test("editor loads with web chrome at phone width", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(page.locator(".leftnav")).toBeHidden();
});

test("page has no horizontal overflow at phone width", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1); // allow 1px rounding
});
