const { test, expect } = require("playwright/test");
const { generateBuildPayload, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage } = require("../helpers/route-mock");

test.describe("Mobile skill bar", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;
  let payloadWithSwap;

  test.beforeAll(() => {
    const build = makeRealisticNecromancerBuild({ title: "Skill Bar Test" });
    payload = generateBuildPayload(build);

    // Build with two weapon sets so the swap pill is enabled
    const buildWithSwap = makeRealisticNecromancerBuild({
      title: "Skill Bar Swap Test",
      equipment: {
        statPackage: "Berserker",
        relic: "",
        food: "",
        utility: "",
        slots: {},
        weapons: { mainhand1: "Greatsword", mainhand2: "Axe", offhand2: "Warhorn" },
        runes: {},
        sigils: {},
        infusions: {},
        enrichment: "",
      },
    });
    payloadWithSwap = generateBuildPayload(buildWithSwap);
  });

  test("mobile meta row is visible", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".skills-bar__mobile-meta")).toBeVisible();
  });

  test("health orb is hidden on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".health-orb")).not.toBeVisible();
  });

  test("desktop weapon swap button is hidden on mobile", async ({ page }) => {
    await loadBuildPage(page, payload);
    await expect(page.locator(".weapon-swap-btn")).not.toBeVisible();
  });

  test("HP badge shows a value", async ({ page }) => {
    await loadBuildPage(page, payload);
    const badge = page.locator(".mobile-hp-badge");
    await expect(badge).toBeVisible();
    await expect(page.locator(".mobile-hp-badge__label")).toContainText("HP");
  });

  test("swap pill is visible", async ({ page }) => {
    await loadBuildPage(page, payload);
    const pill = page.locator(".mobile-swap-pill");
    await expect(pill).toBeVisible();
  });

  test("tapping swap pill toggles active state", async ({ page }) => {
    await loadBuildPage(page, payloadWithSwap);
    const pill = page.locator(".mobile-swap-pill");
    // Verify pill is enabled (build has two weapon sets)
    await expect(pill).toBeEnabled();
    const initiallyActive = await pill.evaluate((el) => el.classList.contains("mobile-swap-pill--active"));
    await pill.click();
    await page.waitForTimeout(300);
    const afterClick = await pill.evaluate((el) => el.classList.contains("mobile-swap-pill--active"));
    expect(afterClick).not.toBe(initiallyActive);
  });
});
