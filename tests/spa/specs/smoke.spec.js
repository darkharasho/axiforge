const { test, expect } = require("playwright/test");
const { generateBuildPayload, generateCompPayload, makeTestBuild, makeTestComp, makeRealisticNecromancerBuild } = require("../helpers/fixture-gen");
const { loadBuildPage, loadCompPage } = require("../helpers/route-mock");

test.describe("SPA smoke tests", () => {
  test("renders a build with title, profession, and skills", async ({ page }) => {
    const build = makeRealisticNecromancerBuild({ title: "Smoke Test Reaper" });
    const payload = generateBuildPayload(build);
    await loadBuildPage(page, payload);

    await expect(page.locator(".build-header")).toContainText("Smoke Test Reaper");
    await expect(page.locator(".skills-host")).toBeVisible();
    await expect(page.locator(".specializations-host")).toBeVisible();
  });

  test("renders a comp with party lines", async ({ page }) => {
    const buildA = makeTestBuild({ profession: "Necromancer", title: "Build A" });
    const buildB = makeTestBuild({ profession: "Necromancer", title: "Build B" });
    const comp = makeTestComp({
      name: "Smoke Test Comp",
      buildIds: [buildA.id, buildB.id],
      partyLines: [{ id: "pl-1", capacity: 5, slots: [buildA.id, buildB.id] }],
    });
    const payload = generateCompPayload(comp, [buildA, buildB]);
    await loadCompPage(page, payload);

    await expect(page.locator(".comp-detail__topbar")).toContainText("Smoke Test Comp");
    await expect(page.locator(".comp-line")).toBeVisible();
    await expect(page.locator(".comp-slot")).toHaveCount(5);

    // The two occupied slots have to be OCCUPIED. Counting .comp-slot alone
    // passes whether or not a single build resolved — the SPA renders an empty
    // box for a slot it cannot look up — which is how a fixture that shipped
    // `builds` as an array instead of a map went unnoticed: every comp spec was
    // asserting on the chrome around five blank squares.
    await expect(page.locator(".comp-slot--filled")).toHaveCount(2);
    await expect(page.locator(".comp-slot--filled").first()).toHaveAttribute("title", /Build A|Build B/);
  });

  test("no console errors during build load", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const build = makeTestBuild({ profession: "Necromancer" });
    const payload = generateBuildPayload(build);
    await loadBuildPage(page, payload);

    expect(errors).toEqual([]);
  });
});
