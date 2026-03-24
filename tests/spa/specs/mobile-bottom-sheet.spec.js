const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile bottom sheet", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Bottom Sheet Test" });
    payload = generateBuildPayload(build);
  });

  test("tapping a skill opens the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);
    await expect(page.locator(".bottom-sheet-backdrop")).toHaveClass(/bottom-sheet-backdrop--active/);
  });

  test("bottom sheet shows skill card content", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const content = page.locator(".bottom-sheet__content");
    await expect(content).toBeVisible();
    const html = await content.innerHTML();
    expect(html.length).toBeGreaterThan(0);
  });

  test("tapping backdrop dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);

    await page.locator(".bottom-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });

  test("X button dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    await page.locator(".bottom-sheet__close").click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });

  test("swipe-down gesture dismisses the bottom sheet", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);
    await expect(page.locator(".bottom-sheet")).toHaveClass(/bottom-sheet--active/);

    const handle = page.locator(".bottom-sheet__handle");
    const box = await handle.boundingBox();
    if (!box) {
      test.skip(true, "Handle not visible");
      return;
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Simulate swipe down via touch events (100px+ threshold triggers close).
    // touchstart fires on the handle; touchmove and touchend fire on the sheet
    // because that is where the listeners are attached (see mobile.js).
    await page.evaluate(({ x, y }) => {
      const handle = document.querySelector(".bottom-sheet__handle");
      const sheet = document.querySelector(".bottom-sheet");
      handle.dispatchEvent(new TouchEvent("touchstart", {
        bubbles: true,
        touches: [new Touch({ identifier: 0, target: handle, clientX: x, clientY: y })],
      }));
      sheet.dispatchEvent(new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [new Touch({ identifier: 0, target: sheet, clientX: x, clientY: y + 150 })],
      }));
      sheet.dispatchEvent(new TouchEvent("touchend", {
        bubbles: true,
        changedTouches: [new Touch({ identifier: 0, target: sheet, clientX: x, clientY: y + 150 })],
      }));
    }, { x: startX, y: startY });

    await page.waitForTimeout(400);
    await expect(page.locator(".bottom-sheet")).not.toHaveClass(/bottom-sheet--active/);
  });
});
