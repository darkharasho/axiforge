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

test("web topbar fits without overflow and hides button labels on phone", async ({ page }) => {
  await page.goto(ENTRY);
  const bar = page.locator(".web-topbar");
  await expect(bar).toBeVisible({ timeout: READY_TIMEOUT });
  const barBox = await bar.boundingBox();
  expect(barBox.width).toBeLessThanOrEqual(391); // within 390 viewport (+1 rounding)
  // Button text labels collapse to icon-only on phone.
  await expect(page.locator(".web-topbar__btn-label").first()).toBeHidden();
});

test("subnav Build/Equipment tabs are tappable and switch subtabs", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  const buildTab = page.locator('.subnav__item[data-subtab="build"]');
  const equipTab = page.locator('.subnav__item[data-subtab="equipment"]');
  await expect(buildTab).toBeVisible();
  await expect(equipTab).toBeVisible();
  // Each tab must be at least 44px tall (touch target).
  const box = await equipTab.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await equipTab.click();
  await expect(page.locator("#subtab-equipment")).toBeVisible();
  await expect(page.locator("#subtab-build")).toBeHidden();
});

// ---------------------------------------------------------------------------
// Task 4: Skills reflow within the Build subtab
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
// Task 5: Traits reflow — stack the 3 specialization lines
// ---------------------------------------------------------------------------

test("specialization lines stack vertically on phone", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // Read the direct specialization children and assert they stack (increasing top).
  const tops = await page.evaluate(() => {
    const host = document.querySelector("#specializationsHost");
    const lines = [...host.children].filter((c) => c.getBoundingClientRect().height > 20);
    return lines.slice(0, 3).map((l) => Math.round(l.getBoundingClientRect().top));
  });
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  }
});

test("build subtab has no horizontal overflow after picking a profession", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#subtab-build");
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Task 6: Equipment reflow + sticky stat summary
// ---------------------------------------------------------------------------

test("equipment subtab is single-column with no overflow on phone", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  await page.locator('.subnav__item[data-subtab="equipment"]').click();
  await expect(page.locator("#subtab-equipment")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#equipmentPanel");
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
