const { test, expect } = require("playwright/test");

const ENTRY = "/index.generated.html";
const READY_TIMEOUT = 20_000;

// Only run these on the tablet project (601–1024px).
test.skip(
  ({ viewport }) => (viewport?.width ?? 0) <= 600 || (viewport?.width ?? 0) > 1024,
  "tablet-only"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pickCoreGuardian(page) {
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("#professionSelect button").click();
    await sleep(200);
    const portal = document.querySelector('[data-cselect-portal="1"]');
    const opt = [...(portal?.querySelectorAll(".cselect__option") || [])].find(
      (b) => b.textContent.trim() === "Core Guardian"
    );
    opt?.click();
  });
  await expect(page.locator("#professionSelect button").first()).toContainText("Core Guardian", {
    timeout: READY_TIMEOUT,
  });
}

// ---------------------------------------------------------------------------
// Task 9: Tablet 2-column reflow (601–1024px)
// ---------------------------------------------------------------------------

test("build subtab is two columns on tablet", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // Skills host and specializations host should sit side-by-side (overlapping y-range).
  const layout = await page.evaluate(() => {
    const a = document.querySelector("#skillsHost").getBoundingClientRect();
    const b = document.querySelector("#specializationsHost").getBoundingClientRect();
    return { aRight: a.right, bLeft: b.left, aLeft: a.left, bRight: b.right };
  });
  // Two columns: one starts to the right of where the other ends (in some order).
  const sideBySide = layout.bLeft >= layout.aRight - 2 || layout.aLeft >= layout.bRight - 2;
  expect(sideBySide).toBe(true);

  // No horizontal overflow at tablet width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
