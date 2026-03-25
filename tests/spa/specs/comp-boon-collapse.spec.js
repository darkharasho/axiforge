const { test, expect } = require("playwright/test");
const { generateCompPayload, makeTestBuild, makeTestComp } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");

test.describe("Boon coverage collapse toggle on SPA comp view", () => {
  let payload;

  test.beforeAll(() => {
    const builds = [
      makeTestBuild({ profession: "Guardian", title: "Firebrand" }),
    ];
    const comp = makeTestComp({
      name: "Boon Collapse Test",
      buildIds: builds.map((b) => b.id),
      partyLines: [{ id: "pl-1", capacity: 5, slots: builds.map((b) => b.id) }],
      boonCoverageHtml: '<div class="comp-boon-cov__squad-label">SQUAD</div><div class="comp-boon-cov__icons"><span>test</span></div>',
    });
    payload = generateCompPayload(comp, builds);
  });

  test("clicking boon coverage header collapses and expands the body", async ({ page }) => {
    await loadCompPage(page, payload);

    const header = page.locator(".comp-boon-cov__header");
    const body = page.locator(".comp-boon-cov__body");
    const chevron = page.locator(".comp-boon-cov__chevron");

    // Body should be visible initially
    await expect(body).toBeVisible();
    await expect(chevron).toHaveText("\u25be"); // ▾ (expanded)

    // Click header to collapse
    await header.click();
    await expect(body).toBeHidden();
    await expect(chevron).toHaveText("\u25b8"); // ▸ (collapsed)

    // Click header again to expand
    await header.click();
    await expect(body).toBeVisible();
    await expect(chevron).toHaveText("\u25be"); // ▾ (expanded)
  });
});
