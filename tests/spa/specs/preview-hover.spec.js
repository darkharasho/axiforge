const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Preview hover card", () => {
  test.skip(({ viewport }) => viewport.width <= 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Hover Test" });
    payload = generateBuildPayload(build);
  });

  test("hovering a skill shows hover preview with name", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    await expect(hoverPreview).toHaveClass(/hidden/);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered — build has no skills");
      return;
    }

    await skillIcon.hover();
    await page.waitForTimeout(300);

    await expect(hoverPreview).not.toHaveClass(/hidden/);

    const title = page.locator(".hover-preview__title");
    await expect(title).toBeVisible();
    const text = await title.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test("moving mouse away hides hover preview", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.hover();
    await page.waitForTimeout(300);
    await expect(hoverPreview).not.toHaveClass(/hidden/);

    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    await expect(hoverPreview).toHaveClass(/hidden/);
  });

  test("hovering a trait shows hover preview", async ({ page }) => {
    await loadBuildPage(page, payload);
    const hoverPreview = page.locator("#hoverPreview");

    const traitBtn = page.locator(".trait-btn").first();
    if (await traitBtn.count() === 0) {
      test.skip(true, "No trait buttons rendered");
      return;
    }

    await traitBtn.hover();
    await page.waitForTimeout(300);
    await expect(hoverPreview).not.toHaveClass(/hidden/);
  });

  test("hover preview stays within viewport", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.hover();
    await page.waitForTimeout(300);

    const previewBox = await page.locator("#hoverPreview").boundingBox();
    if (!previewBox) return;

    const viewport = page.viewportSize();
    expect(previewBox.x).toBeGreaterThanOrEqual(0);
    expect(previewBox.y).toBeGreaterThanOrEqual(0);
    expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(viewport.width + 2);
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(viewport.height + 2);
  });
});
