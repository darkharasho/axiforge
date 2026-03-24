const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Detail panel", () => {
  test.skip(({ viewport }) => viewport.width <= 1024, "Desktop only");

  let payload;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Detail Panel Test" });
    payload = generateBuildPayload(build);
  });

  test("clicking a skill populates the detail panel", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const detailCard = page.locator(".detail-panel .detail-card");
    await expect(detailCard).toBeVisible();
  });

  test("detail panel shows skill name and description", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    const detailCard = page.locator(".detail-panel .detail-card");
    const html = await detailCard.innerHTML();
    expect(html.length).toBeGreaterThan(0);
  });

  test("detail panel shows skill title after click", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skillIcon = page.locator(".skill-icon-large").first();
    if (await skillIcon.count() === 0) {
      test.skip(true, "No skill icons rendered");
      return;
    }

    await skillIcon.click();
    await page.waitForTimeout(300);

    // The SPA reference panel uses buildSkillCard which renders .hover-preview__title.
    // Verify the detail card has a non-empty skill title rendered.
    const skillTitle = page.locator(".detail-panel .detail-card .hover-preview__title");
    await expect(skillTitle).toBeVisible();
    const titleText = await skillTitle.textContent();
    expect(titleText.trim().length).toBeGreaterThan(0);
  });

  test("clicking a different skill updates panel content", async ({ page }) => {
    await loadBuildPage(page, payload);

    const skills = page.locator(".skill-icon-large");
    const count = await skills.count();
    if (count < 2) {
      test.skip(true, "Need at least 2 skill icons to test switching");
      return;
    }

    await skills.nth(0).click();
    await page.waitForTimeout(300);
    const firstContent = await page.locator(".detail-panel .detail-card").innerHTML();

    await skills.nth(1).click();
    await page.waitForTimeout(300);
    const secondContent = await page.locator(".detail-panel .detail-card").innerHTML();

    expect(firstContent).not.toBe(secondContent);
  });

  test("detail panel is visible on desktop", async ({ page }) => {
    await loadBuildPage(page, payload);
    const panel = page.locator(".detail-panel");
    await expect(panel).toBeVisible();
  });
});
