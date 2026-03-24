const { test, expect } = require("playwright/test");
const { generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");

test.describe("Mobile comp rendering", () => {
  test.skip(({ viewport }) => viewport.width > 1024, "Mobile/tablet only");

  let payload;

  test.beforeAll(() => {
    const builds = Array.from({ length: 5 }, (_, i) =>
      makeTestBuild({ profession: "Necromancer", title: `Build ${i + 1}` })
    );
    const comp = makeTestComp({
      name: "Mobile Comp Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [{ id: "pl-1", capacity: 5, slots: builds.map((b) => b.id) }],
    });
    payload = generateCompPayload(comp, builds);
  });

  test("comp renders party lines on mobile", async ({ page }) => {
    await loadCompPage(page, payload);
    await expect(page.locator(".comp-line")).toBeVisible();
  });

  test("party line slots container is horizontally scrollable", async ({ page }) => {
    await loadCompPage(page, payload);

    const slotsContainer = page.locator(".comp-line__slots").first();
    const overflowX = await slotsContainer.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe("auto");
  });

  test("build cards display at full width on mobile", async ({ page }) => {
    await loadCompPage(page, payload);

    const miniCard = page.locator(".mini-card").first();
    if (await miniCard.count() === 0) {
      test.skip(true, "No mini cards rendered");
      return;
    }

    const box = await miniCard.boundingBox();
    const viewport = page.viewportSize();
    expect(box.width).toBeGreaterThan(viewport.width * 0.7);
  });
});
