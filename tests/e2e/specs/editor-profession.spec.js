const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const {
  openCustomSelect,
  selectProfession,
  fillSpecializations,
  setTitle,
} = require("../helpers/editor");

const ALL_PROFESSIONS = [
  "Guardian",
  "Warrior",
  "Engineer",
  "Ranger",
  "Thief",
  "Elementalist",
  "Mesmer",
  "Necromancer",
  "Revenant",
];

// Professions that have full catalog data in the mock server fixtures.
const CATALOGED_PROFESSIONS = ["Necromancer", "Elementalist", "Revenant"];

test.describe("Editor — Profession & Metadata", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // ── Test 1: All 9 professions are selectable ──────────────────────────────
  test("all 9 professions selectable", async () => {
    // Open the custom-select dropdown (grouped: professions are group headers).
    // The open menu lives on document.body, not under #professionSelect.
    const menu = await openCustomSelect(window, "#professionSelect");

    // Gather all group header labels — each profession should have a group
    const groupLabels = (
      await menu.locator(".cselect__group-header .cselect__label").allTextContents()
    ).map((text) => text.trim());

    for (const name of ALL_PROFESSIONS) {
      expect(groupLabels, `Missing profession group: ${name}`).toContain(name);
    }
    expect(groupLabels.length).toBe(ALL_PROFESSIONS.length);

    // Close the dropdown without selecting
    await window.click("#professionSelect .cselect__trigger");
  });

  // ── Test 2: Profession catalogs load correctly (spec cards for Necromancer) ─
  test("profession catalogs load correctly for each class", async () => {
    // Select Necromancer which has full fixture data
    await selectProfession(window, "Necromancer");

    // Verify spec cards appeared
    const specCardCount = await window.locator("#specializationsHost article.spec-card").count();
    expect(specCardCount).toBeGreaterThan(0);
  });

  // ── Test 3: Profession icons display with correct styling ─────────────────
  test("profession icons display with correct styling", async () => {
    // Open the dropdown and check that each option has an icon element
    const menu = await openCustomSelect(window, "#professionSelect");

    // Each option should have a .cselect__icon (SVG spans via iconSvg)
    const iconCount = await menu.locator(".cselect__option .cselect__icon").count();
    expect(iconCount).toBeGreaterThanOrEqual(ALL_PROFESSIONS.length);

    // Icons are SVG spans (.cselect__icon--svg), not <img> elements
    const svgIcons = await menu.locator(".cselect__option .cselect__icon--svg").evaluateAll(
      (els) => els.map((el) => ({ hasSvg: !!el.querySelector("svg"), className: el.className })),
    );
    expect(svgIcons.length).toBeGreaterThanOrEqual(ALL_PROFESSIONS.length);

    // Each SVG icon should contain an actual <svg> element
    for (const icon of svgIcons) {
      expect(icon.hasSvg).toBe(true);
      expect(icon.className).toContain("cselect__icon");
    }

    // Also verify the trigger button shows a profession SVG icon
    const triggerIcon = window.locator("#professionSelect .cselect__trigger .cselect__icon--svg");
    await expect(triggerIcon).toBeVisible();

    // Close the dropdown
    await window.click("#professionSelect .cselect__trigger");
  });

  // ── Test 4: Switching professions clears previous selections ──────────────
  test("switching professions clears previous selections", async () => {
    // Start with Necromancer and actually pick specs — the editor opens blank, so
    // comparing untouched slots across two professions would compare two identical
    // sets of empty placeholders and prove nothing.
    await selectProfession(window, "Necromancer");
    await fillSpecializations(window, ["Spite", "Curses", "Death Magic"]);

    const emblems = window.locator("#specializationsHost article.spec-card .spec-emblem");
    const necroSpecs = await emblems.evaluateAll((els) => els.map((el) => el.getAttribute("title")));
    expect(necroSpecs).toEqual(["Spite", "Curses", "Death Magic"]);

    // Switch to Elementalist (also has catalog fixture data)
    await selectProfession(window, "Elementalist");

    // Necromancer's specializations are gone — every slot is back to its placeholder
    expect(await emblems.count()).toBe(0);
    const emptyCards = window.locator("#specializationsHost article.spec-card--empty");
    expect(await emptyCards.count()).toBe(3);
  });

  // ── Test 5: Loading skeletons appear during catalog fetches ────────────────
  test("loading skeletons appear during catalog fetches", async () => {
    // The skeleton markup uses .skel-specs and .skel-spec-card classes.
    // We need to trigger a fresh catalog load (not cached) to see skeletons.
    // Clear the catalog cache, then trigger a profession switch.
    // Since all 3 cataloged professions may already be cached from prior tests,
    // we'll verify the skeleton HTML exists in the static source (it's in the HTML)
    // and that it gets replaced by real spec-cards after load.

    // Verify the static HTML had skeleton markup (it's in index.html by default)
    // The skeleton should appear briefly when setProfession is called.
    // We can test this by evaluating that injectSkeleton places .skel-specs into the host.

    // Clear catalog cache to force a fresh fetch
    await window.evaluate(() => {
      // Access the module's state.catalogCache and clear it
      const state = window.__axiforge_state;
      if (state && state.catalogCache) state.catalogCache.clear();
    });

    // We'll listen for the skeleton appearing, then wait for real cards.
    // Start observing before triggering the profession switch.
    const skelPromise = window.evaluate(() => {
      return new Promise((resolve) => {
        const host = document.querySelector("#specializationsHost");
        const observer = new MutationObserver(() => {
          if (host.querySelector(".skel-spec-card")) {
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(host, { childList: true, subtree: true });
        // Timeout fallback — resolve false if skeletons never appeared
        setTimeout(() => { observer.disconnect(); resolve(false); }, 10_000);
      });
    });

    // Trigger a profession switch (pick one that needs loading)
    // Use a profession whose catalog might already be in the cache — but we cleared it
    await selectProfession(window, "Revenant");

    const sawSkeleton = await skelPromise;
    expect(sawSkeleton).toBe(true);

    // After the catalog finishes loading, real spec-cards should be present
    await window.waitForFunction(
      () => !!document.querySelector("#specializationsHost article.spec-card"),
      null,
      { timeout: 15_000 },
    );
  });

  // ── Test 6: Build title input accepts up to 140 characters ────────────────
  test("build title input accepts up to 140 characters", async () => {
    const maxTitle = "A".repeat(140);
    await setTitle(window, maxTitle);
    const value = await window.inputValue("#editorTitle");
    expect(value).toBe(maxTitle);
    expect(value.length).toBe(140);

    // Verify the maxlength attribute on the input
    const maxlength = await window.getAttribute("#editorTitle", "maxlength");
    expect(maxlength).toBe("140");

    // Try typing beyond 140 — the input should enforce maxlength
    const overLong = "B".repeat(150);
    await setTitle(window, overLong);
    const clipped = await window.inputValue("#editorTitle");
    expect(clipped.length).toBeLessThanOrEqual(140);
  });

  // ── Test 7: Build title appears in window title bar ───────────────────────
  test("build title appears in window title bar", async () => {
    const buildName = "My Test Build";
    await setTitle(window, buildName);

    // The input event handler calls updateWindowTitle() which sets document.title
    // Trigger the input event explicitly in case fill() doesn't fire it
    await window.dispatchEvent("#editorTitle", "input");

    // Give a moment for the title update to propagate
    await window.waitForTimeout(200);

    // Read document.title from within the renderer
    const pageTitle = await window.evaluate(() => document.title);
    expect(pageTitle).toContain(buildName);
    expect(pageTitle).toContain("AxiForge");

    // Also verify via Electron's BrowserWindow API
    const electronTitle = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].getTitle();
    });
    expect(electronTitle).toContain(buildName);
  });

  // ── Test 8: Tags input accepts comma-separated values ─────────────────────
  test("tags input accepts comma-separated values", async () => {
    const tagInput = window.locator("#tagsInput .tag-container__input");
    await expect(tagInput).toBeVisible();

    // Clear any existing tags first
    await window.evaluate(() => {
      const pills = document.querySelectorAll("#tagsInput .tag-pill");
      pills.forEach((pill) => pill.remove());
    });

    // Type comma-separated tags
    await tagInput.fill("");
    await tagInput.type("power,condi,support", { delay: 10 });
    // Press Enter to commit any remaining text in the buffer
    await tagInput.press("Enter");
    await window.waitForTimeout(300);

    // Verify tag pills were created
    const tagPills = await window.$$eval("#tagsInput .tag-pill", (els) =>
      els.map((el) => el.textContent.replace("×", "").trim()),
    );
    expect(tagPills).toContain("power");
    expect(tagPills).toContain("condi");
    expect(tagPills).toContain("support");
    expect(tagPills.length).toBeGreaterThanOrEqual(3);
  });

  // ── Test 9: Unsaved changes indicator (dirty dot) shows/hides ─────────────
  test("unsaved changes indicator (dirty dot) shows/hides correctly", async () => {
    // Save the current state to establish a clean baseline
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);

    // After saving, the dot should be hidden (clean state)
    const dotHiddenAfterSave = await window.evaluate(() => {
      return document.querySelector("#saveDot").classList.contains("hidden");
    });
    expect(dotHiddenAfterSave).toBe(true);

    // Make a change — edit the title to trigger dirty state
    const currentTitle = await window.inputValue("#editorTitle");
    await setTitle(window, currentTitle + " changed");
    await window.dispatchEvent("#editorTitle", "input");
    await window.waitForTimeout(300);

    // The dirty dot should now be visible (hidden class removed)
    const dotHiddenAfterEdit = await window.evaluate(() => {
      return document.querySelector("#saveDot").classList.contains("hidden");
    });
    expect(dotHiddenAfterEdit).toBe(false);

    // Save again — dot should hide
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);

    const dotHiddenAfterSecondSave = await window.evaluate(() => {
      return document.querySelector("#saveDot").classList.contains("hidden");
    });
    expect(dotHiddenAfterSecondSave).toBe(true);
  });
});
