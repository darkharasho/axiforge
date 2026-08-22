const { test, expect } = require("playwright/test");
const { launchApp, closeApp, WIKI_ENABLED_ENV } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const {
  selectProfession,
  fillSpecializations,
  setGameMode,
} = require("../helpers/editor");

test.describe("Game Mode Toggle", () => {
  let app, window;

  test.beforeAll(async () => {
    // These specs assert PvE/WvW split behaviour, and splits only exist on
    // wiki-derived facts — the default E2E env turns that pass off.
    ({ app, window } = await launchApp({ env: WIKI_ENABLED_ENV }));
    await goToEditor(window);
    // Ensure Necromancer is selected (has good WvW split coverage in fixtures)
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // ── Test 1: PvE and WvW tabs toggle between game modes ─────────────────────
  test("PvE and WvW tabs toggle between game modes", async () => {
    // PvE should be active by default
    const pveBtn = window.locator('.game-mode-toggle__btn[data-mode="pve"]');
    const wvwBtn = window.locator('.game-mode-toggle__btn[data-mode="wvw"]');

    await expect(pveBtn).toBeVisible();
    await expect(wvwBtn).toBeVisible();

    // PvE should have the active class initially
    await expect(pveBtn).toHaveClass(/game-mode-toggle__btn--active/);
    await expect(wvwBtn).not.toHaveClass(/game-mode-toggle__btn--active/);

    // Click WvW
    await setGameMode(window, "wvw");

    // Now WvW should be active, PvE should not
    await expect(wvwBtn).toHaveClass(/game-mode-toggle__btn--active/);
    await expect(pveBtn).not.toHaveClass(/game-mode-toggle__btn--active/);

    // Click PvE back
    await setGameMode(window, "pve");

    // PvE active again
    await expect(pveBtn).toHaveClass(/game-mode-toggle__btn--active/);
    await expect(wvwBtn).not.toHaveClass(/game-mode-toggle__btn--active/);
  });

  // ── Test 2: Switching modes reloads specializations/traits with mode data ──
  test("switching modes reloads specializations/traits with mode-appropriate data", async () => {
    // Start in PvE mode
    await setGameMode(window, "pve");

    // Wait for spec cards to be loaded
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );

    // Capture spec card content in PvE
    const pveSpecContent = await window.$$eval(
      "#specializationsHost article.spec-card",
      (els) => els.map((el) => el.textContent),
    );
    expect(pveSpecContent.length).toBeGreaterThan(0);

    // Switch to WvW — this re-fetches catalog with WvW balance splits
    await setGameMode(window, "wvw");

    // Wait for spec cards to be re-rendered after mode switch
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );

    const wvwSpecContent = await window.$$eval(
      "#specializationsHost article.spec-card",
      (els) => els.map((el) => el.textContent),
    );
    expect(wvwSpecContent.length).toBeGreaterThan(0);

    // The spec card count should be the same (same profession)
    expect(wvwSpecContent.length).toBe(pveSpecContent.length);

    // Verify the game mode is WvW by checking the active toggle button
    const activeMode = await window.$eval(
      ".game-mode-toggle__btn--active",
      (el) => el.dataset.mode,
    );
    expect(activeMode).toBe("wvw");

    // Restore PvE for subsequent tests
    await setGameMode(window, "pve");
  });

  // ── Test 3: Game mode preference remembered across restarts ────────────────
  test("game mode preference remembered across restarts", async () => {
    // Set WvW mode
    await setGameMode(window, "wvw");

    // Verify WvW is active
    const wvwBtn = window.locator('.game-mode-toggle__btn[data-mode="wvw"]');
    await expect(wvwBtn).toHaveClass(/game-mode-toggle__btn--active/);

    // Close the app
    await closeApp(app);

    // Relaunch without cleaning data (preserves settings). The env has to be carried
    // over too: every test after this one runs against this instance, and dropping
    // WIKI_ENABLED_ENV here silently leaves them without any split data.
    ({ app, window } = await launchApp({ clean: false, env: WIKI_ENABLED_ENV }));
    await goToEditor(window);

    // launchApp() already waited for init to finish. Spec cards are NOT a restart
    // signal: a relaunch reopens with no profession selected, so #specializationsHost
    // stays in its empty state until something picks one.
    await window.waitForSelector(".game-mode-toggle__btn--active", { timeout: 15_000 });

    // The WvW button should still be active after restart
    const wvwBtnAfter = window.locator('.game-mode-toggle__btn[data-mode="wvw"]');
    const pveBtnAfter = window.locator('.game-mode-toggle__btn[data-mode="pve"]');

    await expect(wvwBtnAfter).toHaveClass(/game-mode-toggle__btn--active/);
    await expect(pveBtnAfter).not.toHaveClass(/game-mode-toggle__btn--active/);

    // Also verify via the active button's data-mode
    const restoredMode = await window.$eval(
      ".game-mode-toggle__btn--active",
      (el) => el.dataset.mode,
    );
    expect(restoredMode).toBe("wvw");

    // Restore PvE for subsequent tests
    await setGameMode(window, "pve");
  });

  // ── Test 4: Skill/trait balance splits reflect correctly per mode ───────────
  test("skill/trait balance splits reflect correctly per mode", async () => {
    // Ensure PvE mode and Necromancer
    await setGameMode(window, "pve");
    await selectProfession(window, "Necromancer");

    // Selecting a profession leaves all three slots empty, so fill them before
    // reaching for traits.
    await fillSpecializations(window, ["Spite", "Curses", "Death Magic"]);

    // Click a grandmaster trait in Spite ("Dread" has a known WvW split) to populate
    // the detail panel. Nothing is selected until the user picks it.
    const specCards = window.locator("#specializationsHost article.spec-card");
    const spiteCard = specCards.nth(0);
    const grandmasterTraits = spiteCard.locator(".trait-column--major").nth(2).locator(".trait-btn");
    expect(await grandmasterTraits.count()).toBe(3);

    await grandmasterTraits.first().click();
    await window.waitForTimeout(500);

    // Verify the detail panel shows content (PvE data)
    const detailHost = window.locator("#detailHost");
    const pveDetailHtml = await detailHost.innerHTML();
    expect(pveDetailHtml).toContain("detail-card");

    // The "WvW split" badge marks the *entity* as having a split, so it shows in
    // every mode — detail-panel.js sets hasSplit straight off the trait. What changes
    // per mode is the fact values, which is what the rest of this test checks.
    const splitBadge = detailHost.locator(".split-badge");
    expect(await splitBadge.count()).toBeGreaterThan(0);
    expect(await splitBadge.first().textContent()).toContain("WvW split");

    // Dread's PvE damage modifier.
    const pveFacts = await detailHost.locator(".facts-list").innerText();
    expect(pveFacts).toContain("15%");

    // Now switch to WvW mode — the catalog reloads with balance splits
    await setGameMode(window, "wvw");

    // Wait for spec cards to reload
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );

    // The same trait now reports its WvW value, and still carries the badge.
    await expect(detailHost.locator(".facts-list")).toContainText("10%");
    expect(await detailHost.locator(".facts-list").innerText()).not.toContain("15%");
    expect(await detailHost.locator(".split-badge").count()).toBeGreaterThan(0);

    // Restore PvE mode
    await setGameMode(window, "pve");
  });

  // ── Test 5: Detail panel facts update and flash when mode changes ──────────
  test("detail panel facts update and flash when mode changes", async () => {
    // Set PvE mode and ensure Necromancer is loaded
    await setGameMode(window, "pve");
    await selectProfession(window, "Necromancer");

    // Wait for spec cards
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );

    // Re-selecting the profession cleared the slots — refill before reaching for traits.
    await fillSpecializations(window, ["Spite", "Curses", "Death Magic"]);

    // Click a grandmaster trait to populate the detail panel. Use one with a known WvW
    // split so the facts actually change on the mode switch below.
    const specCards = window.locator("#specializationsHost article.spec-card");
    const spiteCard = specCards.nth(0);
    const grandmasterTraits = spiteCard.locator(".trait-column--major").nth(2).locator(".trait-btn");
    await grandmasterTraits.first().click();
    await window.waitForTimeout(500);

    // Verify the detail panel has a facts list
    const detailHost = window.locator("#detailHost");
    await expect(detailHost.locator(".facts-list")).toBeVisible();

    // Capture the PvE facts content
    const pveFacts = await detailHost.locator(".facts-list").innerHTML();

    // Switch to WvW — the detail panel should update and the facts list should get a refresh animation class
    await setGameMode(window, "wvw");

    // Wait for the detail panel to re-render with WvW data
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
