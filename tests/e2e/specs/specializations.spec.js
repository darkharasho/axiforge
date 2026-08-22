const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const {
  selectProfession,
  fillSpecializations,
  changeSpecialization,
} = require("../helpers/editor");

/**
 * Click a major trait button within a spec card.
 * tierIndex: 0-based index of the major tier column (0=Adept, 1=Master, 2=Grandmaster).
 * col: 0-based index of the trait within that tier (0, 1, or 2).
 */
async function clickMajorTrait(window, specIndex, tierIndex, col) {
  const card = window.locator("article.spec-card").nth(specIndex);
  const majorColumns = card.locator(".trait-column--major");
  const column = majorColumns.nth(tierIndex);
  const btn = column.locator(".trait-btn").nth(col);
  await btn.click();
  await window.waitForTimeout(300);
}

test.describe("Specializations & Traits", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    // The editor opens with three empty slots — every assertion in this file is about
    // a chosen specialization (emblem, trait columns, minor anchors, connectors), so
    // fill them here rather than in each test.
    await fillSpecializations(window, ["Spite", "Curses", "Death Magic"]);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // ── Test 1: Can select 0–3 specializations ────────────────────────────────
  test("can select 0-3 specializations", async () => {
    // beforeAll filled all three slots; the host always renders exactly 3 cards.
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBe(3);

    // Each card should have a spec emblem with a name
    for (let i = 0; i < count; i++) {
      const emblem = specCards.nth(i).locator(".spec-emblem");
      await expect(emblem).toBeVisible();
    }

    // Verify we can change a specialization (swap slot 0 to a different spec).
    // First, capture the current spec name in slot 0.
    const originalTitle = await specCards.nth(0).locator(".spec-emblem").getAttribute("title");

    // Change slot 0 to "Blood Magic" — a core Necromancer spec no other slot holds
    // (occupied specs render as disabled options).
    await changeSpecialization(window, 0, "Blood Magic");

    // The emblem title should now be "Blood Magic"
    const newTitle = await specCards.nth(0).locator(".spec-emblem").getAttribute("title");
    expect(newTitle).toBe("Blood Magic");
    expect(newTitle).not.toBe(originalTitle);

    // Still 3 spec cards
    expect(await specCards.count()).toBe(3);

    // Restore to original for subsequent tests. Re-selecting the profession would
    // clear all three slots, not just this one.
    await changeSpecialization(window, 0, originalTitle);
  });

  // ── Test 2: Specialization cards display with background images ───────────
  test("specialization cards display with background images", async () => {
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBeGreaterThan(0);

    // Each spec card should have a panel with a background-image style
    for (let i = 0; i < count; i++) {
      const panel = specCards.nth(i).locator(".spec-card__panel");
      await expect(panel).toBeVisible();
      const bgImage = await panel.evaluate((el) => el.style.backgroundImage);
      // Should contain a URL to a wiki image
      expect(bgImage).toContain("url(");
      expect(bgImage).toContain("wiki.guildwars2.com");
    }
  });

  // ── Test 3: 3 tier rows (Adept/Master/Grandmaster) display per spec ───────
  test("3 tier rows display per specialization", async () => {
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = specCards.nth(i);
      // Each spec card should have 3 major trait columns (one per tier)
      const majorColumns = card.locator(".trait-column--major");
      expect(await majorColumns.count()).toBe(3);

      // Each spec card should also have 3 minor trait anchors (one per tier)
      const minorAnchors = card.locator(".trait-minor-anchor");
      expect(await minorAnchors.count()).toBe(3);
    }
  });

  // ── Test 4: Each tier has 3 major trait options; can select 1 per tier ────
  test("each tier has 3 major trait options and can select 1 per tier", async () => {
    const card = window.locator("article.spec-card").first();

    // Check all 3 tiers. Choosing a specialization sets majorChoices to {1:0,2:0,3:0} —
    // no trait is picked for you — so each tier starts with 3 options and none active.
    const majorColumns = card.locator(".trait-column--major");
    for (let tier = 0; tier < 3; tier++) {
      const column = majorColumns.nth(tier);
      const traitBtns = column.locator(".trait-btn");
      // Each tier should have exactly 3 major trait options
      expect(await traitBtns.count()).toBe(3);

      // Picking one makes it the tier's only active trait
      await traitBtns.nth(0).click();
      await window.waitForTimeout(200);
      const activeBtns = column.locator(".trait-btn--active");
      expect(await activeBtns.count()).toBe(1);
    }

    // Click a different trait in the first tier and verify only one is active
    const tier0Column = majorColumns.nth(0);
    const currentActive = await tier0Column.locator(".trait-btn--active").first().getAttribute("title");
    // Find a non-active trait button and click it
    const allBtns = tier0Column.locator(".trait-btn");
    for (let i = 0; i < 3; i++) {
      const btn = allBtns.nth(i);
      const isActive = await btn.evaluate((el) => el.classList.contains("trait-btn--active"));
      if (!isActive) {
        await btn.click();
        await window.waitForTimeout(300);
        break;
      }
    }

    // Now the active trait should have changed
    const newActive = await tier0Column.locator(".trait-btn--active").first().getAttribute("title");
    expect(newActive).not.toBe(currentActive);

    // Still only 1 active per tier
    expect(await tier0Column.locator(".trait-btn--active").count()).toBe(1);
  });

  // ── Test 5: Selected traits show visual indicator ─────────────────────────
  test("selected traits show visual indicator", async () => {
    const card = window.locator("article.spec-card").first();
    const majorColumns = card.locator(".trait-column--major");

    // Pick one major per tier — nothing is selected until the user chooses.
    for (let tier = 0; tier < 3; tier++) {
      await majorColumns.nth(tier).locator(".trait-btn").nth(2).click();
      await window.waitForTimeout(200);
    }

    for (let tier = 0; tier < 3; tier++) {
      const column = majorColumns.nth(tier);
      const activeBtns = column.locator(".trait-btn--active");
      // Each tier should have exactly one active trait
      expect(await activeBtns.count()).toBe(1);

      // The active trait should have the trait-btn--active class
      const activeBtn = activeBtns.first();
      await expect(activeBtn).toHaveClass(/trait-btn--active/);

      // Non-active traits should NOT have the active class
      const inactiveBtns = column.locator(".trait-btn:not(.trait-btn--active)");
      const inactiveCount = await inactiveBtns.count();
      expect(inactiveCount).toBe(2);
      for (let j = 0; j < inactiveCount; j++) {
        await expect(inactiveBtns.nth(j)).not.toHaveClass(/trait-btn--active/);
      }
    }
  });

  // ── Test 6: Minor traits display as read-only ─────────────────────────────
  test("minor traits display as read-only", async () => {
    const card = window.locator("article.spec-card").first();
    const minorBtns = card.locator(".trait-btn--always");

    // Each spec has 3 minor traits (one per tier)
    expect(await minorBtns.count()).toBe(3);

    // Minor traits should have the --always class (always selected)
    for (let i = 0; i < 3; i++) {
      const btn = minorBtns.nth(i);
      await expect(btn).toHaveClass(/trait-btn--always/);
      // Minor traits should be visible
      await expect(btn).toBeVisible();
      // Minor traits should have an icon (img)
      const img = btn.locator("img");
      expect(await img.count()).toBeGreaterThan(0);
    }
  });

  // ── Test 7: Hovering over traits shows wiki preview panel ─────────────────
  test("hovering over traits shows wiki preview panel", async () => {
    const card = window.locator("article.spec-card").first();
    const hoverPreview = window.locator("#hoverPreview");

    // Ensure hover preview is hidden by moving the mouse to a neutral area first
    await window.mouse.move(0, 0);
    await window.waitForTimeout(300);
    await expect(hoverPreview).toHaveClass(/hidden/);

    // Hover over the first major trait button
    const majorColumns = card.locator(".trait-column--major");
    const firstTrait = majorColumns.first().locator(".trait-btn").first();
    await firstTrait.hover();
    await window.waitForTimeout(300);

    // The hover preview should now be visible (hidden class removed)
    await expect(hoverPreview).not.toHaveClass(/hidden/);

    // The hover preview should contain content (title, meta, etc.)
    const previewHtml = await hoverPreview.innerHTML();
    expect(previewHtml.length).toBeGreaterThan(0);
    expect(previewHtml).toContain("hover-preview__title");

    // Move mouse away to hide the preview
    await window.mouse.move(0, 0);
    await window.waitForTimeout(300);
    await expect(hoverPreview).toHaveClass(/hidden/);
  });

  // ── Test 8: SVG connector lines draw between specializations ──────────────
  test("SVG connector lines draw between specializations", async () => {
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBeGreaterThan(0);

    // Each spec card body should have an SVG connector
    for (let i = 0; i < count; i++) {
      const card = specCards.nth(i);
      const body = card.locator(".spec-card__body");
      const connector = body.locator("svg.spec-connector");
      await expect(connector).toBeVisible();

      // The connector should have path elements
      const paths = connector.locator("path");
      expect(await paths.count()).toBeGreaterThan(0);
    }
  });

  // ── Test 9: Lines update when page becomes visible ────────────────────────
  test("lines update when page becomes visible", async () => {
    // Navigate away from editor to library
    await window.click('.leftnav__item[data-page="library"]');
    await window.waitForSelector("#page-library:not(.hidden)", { timeout: 5000 });

    // Navigate back to editor
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 5000 });

    // Wait for connectors to redraw (they use rAF)
    await window.waitForTimeout(500);

    // Connectors should still be present after page navigation
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const body = specCards.nth(i).locator(".spec-card__body");
      const connector = body.locator("svg.spec-connector");
      await expect(connector).toBeVisible();

      // Verify path data is non-empty (connector was actually redrawn)
      const pathD = await connector.locator("path").first().getAttribute("d");
      expect(pathD).toBeTruthy();
      expect(pathD).toContain("M ");
    }
  });

  // ── Test 10: Lines clear when specializations are removed ─────────────────
  test("lines clear when specializations are removed", async () => {
    // Change a specialization — the old connectors should be replaced with new ones.
    const card0Body = window.locator("article.spec-card").nth(0).locator(".spec-card__body");

    // Capture the current connector path data
    const oldPath = await card0Body.locator("svg.spec-connector path").first().getAttribute("d");
    expect(oldPath).toBeTruthy();

    // Change the spec in slot 0 to a different one
    const currentTitle = await window.locator("article.spec-card").nth(0).locator(".spec-emblem").getAttribute("title");
    const targetSpec = currentTitle === "Blood Magic" ? "Soul Reaping" : "Blood Magic";
    await changeSpecialization(window, 0, targetSpec);

    // After changing, the connector should be present on the new card
    const newCard0Body = window.locator("article.spec-card").nth(0).locator(".spec-card__body");
    const newConnector = newCard0Body.locator("svg.spec-connector");
    await expect(newConnector).toBeVisible();

    // The new connector should have valid path data
    const newPath = await newConnector.locator("path").first().getAttribute("d");
    expect(newPath).toBeTruthy();
    expect(newPath).toContain("M ");
  });

  // ── Test 11: Removing a specialization clears its traits ──────────────────
  test("removing a specialization clears its traits", async () => {
    // First, select specific traits in slot 0
    const card = window.locator("article.spec-card").first();
    const majorColumns = card.locator(".trait-column--major");

    // Click the second trait in each tier (col index 1)
    for (let tier = 0; tier < 3; tier++) {
      const column = majorColumns.nth(tier);
      await column.locator(".trait-btn").nth(1).click();
      await window.waitForTimeout(200);
    }

    // Verify the second trait in each tier is now active
    for (let tier = 0; tier < 3; tier++) {
      const column = majorColumns.nth(tier);
      const secondBtn = column.locator(".trait-btn").nth(1);
      await expect(secondBtn).toHaveClass(/trait-btn--active/);
    }

    // Record the active trait titles in slot 0
    const activeTraitTitles = [];
    for (let tier = 0; tier < 3; tier++) {
      const column = majorColumns.nth(tier);
      const activeBtn = column.locator(".trait-btn--active").first();
      activeTraitTitles.push(await activeBtn.getAttribute("title"));
    }

    // Now change slot 0 to a specialization no other slot holds — occupied specs are
    // rendered as disabled options.
    const currentSpecTitle = await card.locator(".spec-emblem").getAttribute("title");
    const targetSpec = currentSpecTitle === "Soul Reaping" ? "Spite" : "Soul Reaping";
    await changeSpecialization(window, 0, targetSpec);

    // The spec should have changed
    const newSpecTitle = await window.locator("article.spec-card").first().locator(".spec-emblem").getAttribute("title");
    expect(newSpecTitle).toBe(targetSpec);

    // The traits should be cleared: swapping a slot resets majorChoices to
    // {1:0, 2:0, 3:0}, so the new spec starts with nothing selected in any tier.
    const newCard = window.locator("article.spec-card").first();
    const newMajorColumns = newCard.locator(".trait-column--major");

    for (let tier = 0; tier < 3; tier++) {
      const column = newMajorColumns.nth(tier);
      expect(await column.locator(".trait-btn--active").count()).toBe(0);

      // None of the previously chosen traits survived the swap
      const titles = await column.locator(".trait-btn").evaluateAll((els) =>
        els.map((el) => el.getAttribute("title")),
      );
      expect(titles).not.toContain(activeTraitTitles[tier]);
    }
  });
});
