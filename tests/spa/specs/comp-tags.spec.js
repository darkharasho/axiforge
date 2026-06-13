const { test, expect } = require("playwright/test");
const { loadCatalog, makeTestBuild } = require("../helpers/fixture-gen");
const { loadCompPage } = require("../helpers/route-mock");
const { serializeForPublish } = require("../../../src/main/buildPublish");
const {
  encryptBuild,
  generateFileId,
  generateEncryptionKey,
} = require("../../../src/main/buildEncryption");

// Build a published-comp payload in the real shape serializeCompForPublish emits:
// builds keyed by id (object), comp-scoped categories, and a "tag:<id>" slot.
function generateTaggedCompPayload() {
  const buildA = makeTestBuild({ profession: "Necromancer", title: "Power Reaper" });
  const buildB = makeTestBuild({ profession: "Guardian", title: "Heal Firebrand" });

  const builds = {};
  for (const b of [buildA, buildB]) {
    builds[b.id] = serializeForPublish(b, loadCatalog(b.profession), null);
  }

  const comp = {
    name: "Tagged Comp",
    gameMode: "wvw",
    buildColors: {},
    categories: [
      { id: "cat-dps", name: "DPS", icon: "img/tags/might.png", buildIds: [buildA.id, buildB.id] },
    ],
    partyLines: [
      { id: "pl-1", capacity: 5, slots: [buildA.id, "tag:cat-dps", buildB.id] },
    ],
    builds,
  };

  const fileId = generateFileId();
  const encKey = generateEncryptionKey();
  return { fileId, encKey, base64Payload: encryptBuild(comp, encKey) };
}

test.describe("SPA comp build tags", () => {
  let payload;
  test.beforeAll(() => { payload = generateTaggedCompPayload(); });

  test("renders a tag slot with the category icon", async ({ page }) => {
    await loadCompPage(page, payload);
    const tag = page.locator(".comp-slot--tag");
    await expect(tag).toHaveCount(1);
    const img = tag.locator("img.comp-slot__tag-img");
    await expect(img).toHaveAttribute("src", "img/tags/might.png");
  });

  test("party-line label is a Lucide-style numbered badge, not 'P1' text", async ({ page }) => {
    await loadCompPage(page, payload);
    const label = page.locator(".comp-line__label").first();
    await expect(label.locator("svg.comp-line__num")).toHaveCount(1);
    await expect(label).not.toHaveText(/P1/);
  });

  test("hovering a tag slot shows the rich popover with the member builds", async ({ page }) => {
    await loadCompPage(page, payload);
    const tag = page.locator(".comp-slot--tag");

    // No popover until hover; native title is suppressed in favor of it
    await expect(page.locator(".comp-tag-pop")).toHaveCount(0);
    await expect(tag).not.toHaveAttribute("title", /.+/);

    await tag.hover();

    const pop = page.locator(".comp-tag-pop");
    await expect(pop).toBeVisible();
    await expect(pop.locator(".comp-tag-pop__title")).toHaveText("DPS");
    await expect(pop.locator(".comp-tag-pop__row")).toHaveCount(2);
    await expect(pop).toContainText("Power Reaper");
    await expect(pop).toContainText("Heal Firebrand");
  });

  test("popover is dismissed on mouse-out", async ({ page }) => {
    await loadCompPage(page, payload);
    const tag = page.locator(".comp-slot--tag");
    await tag.hover();
    await expect(page.locator(".comp-tag-pop")).toBeVisible();
    // Move the mouse away
    await page.mouse.move(0, 0);
    await expect(page.locator(".comp-tag-pop")).toHaveCount(0);
  });

  test("the tag token is not shown as a build in the pool", async ({ page }) => {
    await loadCompPage(page, payload);
    // Pool shows the two real builds; never a card for the tag token
    await expect(page.locator(".comp-pool")).not.toContainText("tag:cat-dps");
  });
});
