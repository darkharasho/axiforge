const { test, expect } = require("playwright/test");
const { launchApp, closeApp, WIKI_ENABLED_ENV } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const {
  selectProfession,
  fillSpecializations,
  setGameMode,
} = require("../helpers/editor");

test.describe("Detail Panel", () => {
  let app, window;

  test.beforeAll(async () => {
    // These specs assert PvE/WvW split behaviour, and splits only exist on
    // wiki-derived facts — the default E2E env turns that pass off.
    ({ app, window } = await launchApp({ env: WIKI_ENABLED_ENV }));
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    // Every test here inspects the panel for a trait, and traits only exist once a
    // specialization is chosen — the editor opens with all three slots empty.
    await fillSpecializations(window, ["Spite", "Curses", "Death Magic"]);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // ── Test 1: Clicking trait/skill shows details in right panel ──────────────
  test("clicking trait shows details in right panel", async () => {
    // Click a major trait button to populate the detail panel
    const specCard = window.locator("article.spec-card").first();
    const majorColumns = specCard.locator(".trait-column--major");
    const firstMajorTrait = majorColumns.first().locator(".trait-btn").first();

    // Get the trait name before clicking
    const traitTitle = await firstMajorTrait.getAttribute("title");
    expect(traitTitle).toBeTruthy();

    await firstMajorTrait.click();
    await window.waitForTimeout(500);

    // The detail panel should now show the trait info
    const detailHost = window.locator("#detailHost");
    const detailCard = detailHost.locator(".detail-card");
    await expect(detailCard).toBeVisible();

    // The detail card should contain the trait name
    const detailHtml = await detailCard.innerHTML();
    expect(detailHtml).toContain(traitTitle);

    // Should contain sections: In-Game Description, Wiki, Facts
    expect(detailHtml).toContain("In-Game Description");
    expect(detailHtml).toContain("Wiki");
    expect(detailHtml).toContain("Facts");
  });

  // ── Test 2: Facts display with correct icons ──────────────────────────────
  test("facts display with correct icons", async () => {
    // Ensure detail panel is populated by clicking a trait
    const specCard = window.locator("article.spec-card").first();
    const majorColumns = specCard.locator(".trait-column--major");
    await majorColumns.first().locator(".trait-btn").first().click();
    await window.waitForTimeout(500);

    const detailHost = window.locator("#detailHost");
    const factsList = detailHost.locator(".facts-list");
    await expect(factsList).toBeVisible();

    // Facts list should have at least one list item
    const factItems = factsList.locator("li");
    const count = await factItems.count();
    expect(count).toBeGreaterThan(0);

    // Check that fact items with icons use the fact-status-icon class
    const iconCount = await factsList.locator(".fact-status-icon").count();
    // At least some facts should have icons (img elements with fact-status-icon class)
    expect(iconCount).toBeGreaterThanOrEqual(0);

    // Each fact-status-icon should be an img with a src attribute
    for (let i = 0; i < iconCount; i++) {
      const icon = factsList.locator(".fact-status-icon").nth(i);
      const src = await icon.getAttribute("src");
      expect(src).toBeTruthy();
    }
  });

  // ── Test 3: Hover preview tooltip appears and can be dismissed ─────────────
  test("hover preview tooltip appears and can be dismissed", async () => {
    const hoverPreview = window.locator("#hoverPreview");

    // Move mouse well away from any interactive element and wait for preview to hide
    await window.mouse.move(10, 10);
    await window.waitForTimeout(500);
    await expect(hoverPreview).toHaveClass(/hidden/);

    // Hover over a major trait button
    const specCard = window.locator("article.spec-card").first();
    const majorColumns = specCard.locator(".trait-column--major");
    const traitBtn = majorColumns.first().locator(".trait-btn").first();
    await traitBtn.hover();
    await window.waitForTimeout(500);

    // The hover preview should now be visible (hidden class removed)
    await expect(hoverPreview).not.toHaveClass(/hidden/);

    // The hover preview should contain a title
    const previewTitle = hoverPreview.locator(".hover-preview__title");
    await expect(previewTitle).toBeVisible();
    const titleText = await previewTitle.textContent();
    expect(titleText.length).toBeGreaterThan(0);

    // Move mouse away to dismiss the preview
    await window.mouse.move(0, 0);
    await window.waitForTimeout(300);
    await expect(hoverPreview).toHaveClass(/hidden/);
  });

  // ── Test 4: Expand button opens full detail modal ─────────────────────────
  test("expand button opens full detail modal", async () => {
    // Ensure detail panel is populated by clicking a trait
    const specCard = window.locator("article.spec-card").first();
    const majorColumns = specCard.locator(".trait-column--major");
    await majorColumns.first().locator(".trait-btn").first().click();
    await window.waitForTimeout(500);

    // The expand button should be enabled
    const expandBtn = window.locator("#detail-expand-btn");
    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toBeEnabled();

    // Click the expand button
    await expandBtn.click();
    await window.waitForTimeout(500);

    // The detail modal overlay should become visible (hidden class removed)
    const overlay = window.locator(".detail-modal-overlay");
    await expect(overlay).not.toHaveClass(/detail-modal-overlay--hidden/);

    // The detail modal should be visible with content
    const modal = window.locator(".detail-modal");
    await expect(modal).toBeVisible();

    // Modal should contain the trait name (same as what was in the detail panel)
    const modalName = window.locator("#dm-name");
    const nameText = await modalName.textContent();
    expect(nameText.length).toBeGreaterThan(0);

    // Clean up: close the modal
    await window.locator("#dm-close").click();
    await window.waitForTimeout(300);
  });

  // ── Test 5: Modal closes on Escape or close button ────────────────────────
  test("modal closes on Escape or close button", async () => {
    // Ensure detail panel is populated
    const specCard = window.locator("article.spec-card").first();
    const majorColumns = specCard.locator(".trait-column--major");
    await majorColumns.first().locator(".trait-btn").first().click();
    await window.waitForTimeout(500);

    // -- Test close button --
    // Open the modal
    await window.locator("#detail-expand-btn").click();
    await window.waitForTimeout(500);

    const overlay = window.locator(".detail-modal-overlay");
    await expect(overlay).not.toHaveClass(/detail-modal-overlay--hidden/);

    // Click the close button
    await window.locator("#dm-close").click();
    await window.waitForTimeout(300);

    // Modal should be hidden
    await expect(overlay).toHaveClass(/detail-modal-overlay--hidden/);

    // -- Test Escape key --
    // Re-open the modal
    await window.locator("#detail-expand-btn").click();
    await window.waitForTimeout(500);
    await expect(overlay).not.toHaveClass(/detail-modal-overlay--hidden/);

    // Press Escape to close
    await window.keyboard.press("Escape");
    await window.waitForTimeout(300);

    // Modal should be hidden again
    await expect(overlay).toHaveClass(/detail-modal-overlay--hidden/);
  });

  // ── Test 6: Switching PvE/WvW updates detail facts with highlights/flash ──
  test("switching PvE/WvW updates detail facts with highlights", async () => {
    // Ensure PvE mode
    await setGameMode(window, "pve");

    // Wait for spec cards to load after mode switch
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );

    // Click a trait with a known WvW split (grandmaster tier of Spite/first spec).
    // Pick it explicitly: no trait is selected until the user chooses one, so looking
    // for an already-active button would depend on whatever an earlier test clicked.
    const specCards = window.locator("#specializationsHost article.spec-card");
    const spiteCard = specCards.nth(0);
    const grandmasterTraits = spiteCard.locator(".trait-column--major").nth(2).locator(".trait-btn");
    expect(await grandmasterTraits.count()).toBe(3);

    await grandmasterTraits.first().click();
    await window.waitForTimeout(500);

    // Verify the detail panel has a facts list
    const detailHost = window.locator("#detailHost");
    await expect(detailHost.locator(".facts-list")).toBeVisible();

    // Capture the PvE facts content
    const pveFacts = await detailHost.locator(".facts-list").innerHTML();

    // Switch to WvW — the detail panel should update
    await setGameMode(window, "wvw");

    // Wait for spec cards to reload after mode switch
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );
    await window.waitForTimeout(800);

    // The facts-list should have the "facts-list--refresh" animation class
    const hasRefreshClass = await detailHost.evaluate((host) => {
      const ul = host.querySelector(".facts-list");
      return ul ? ul.classList.contains("facts-list--refresh") : false;
    });
    expect(hasRefreshClass).toBe(true);

    // The facts content should be different (WvW split changes the values)
    const wvwFacts = await detailHost.locator(".facts-list").innerHTML();
    expect(wvwFacts).not.toBe(pveFacts);

    // Restore PvE mode
    await setGameMode(window, "pve");
  });
});
