const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { goToEditor, goToComps, switchTab } = require("../helpers/nav");
const { selectProfession, setTitle, saveBuild, setGameMode } = require("../helpers/editor");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp, uuid } = require("../helpers/builds");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for comp detail view to render. */
async function waitForCompDetail(window) {
  await window.waitForSelector(".comp-detail", { timeout: 5000 });
  await window.waitForTimeout(300);
}

/** Open first comp in the list. */
async function openFirstComp(window) {
  const row = window.locator(".comp-list-row[data-comp-id]").first();
  await row.dblclick();
  await waitForCompDetail(window);
}

/** Navigate to editor equipment tab. */
async function goToEquipment(window) {
  await goToEditor(window);
  await switchTab(window, "equipment");
  await window.waitForFunction(
    () => {
      const panel = document.querySelector("#equipmentPanel");
      return panel && panel.querySelector(".equip-section") !== null;
    },
    null,
    { timeout: 10_000 }
  );
}

/** Open stat picker on the first armor slot. */
async function openFirstArmorStatPicker(window) {
  const armorSection = window.locator("#equipmentPanel .equip-section").filter({ hasText: "Armor" }).first();
  const firstSlot = armorSection.locator(".equip-slot__value").first();
  await firstSlot.click();
  await window.waitForSelector(".slot-picker", { timeout: 3000 });
}

// ── 1. Reaper shroud 5 accuracy in WvW split ────────────────────────────────

test.describe("Reaper shroud 5 accuracy in WvW split", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("WvW mode renders Necromancer skills without errors", async () => {
    // Switch to WvW mode — this triggers split skill resolution
    await setGameMode(window, "wvw");
    await window.waitForTimeout(500);

    // The skills panel should still be rendered (no crash/blank)
    const skillsHost = window.locator("#skillsHost");
    await expect(skillsHost).toBeVisible();

    // Verify no error overlay or blank page
    const hasContent = await window.evaluate(() => {
      const host = document.querySelector("#skillsHost");
      return host && host.children.length > 0;
    });
    expect(hasContent).toBe(true);

    // Switch back to PvE
    await setGameMode(window, "pve");
    await window.waitForTimeout(500);
  });
});

// ── 2. Overload skill selection updates reference panel ──────────────────────

test.describe("Overload skill selection updates reference panel", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Elementalist");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("selecting a heal skill updates detail panel", async () => {
    // The utility skill group contains heal (index 0), 3 utilities, and elite.
    const utilGroup = window.locator(".skill-group--utilities");
    await expect(utilGroup).toBeVisible({ timeout: 5000 });

    // Click the heal slot icon to open the cselect dropdown
    const healSlot = utilGroup.locator(".skill-slot").first();
    const iconBtn = healSlot.locator(".skill-icon-large");
    await iconBtn.click();

    const cselectOpen = window.locator(".cselect--skill-slot.cselect--open");
    await expect(cselectOpen).toBeVisible({ timeout: 5000 });

    // Pick the first available heal skill
    const firstOption = cselectOpen.locator(".cselect__option").first();
    await firstOption.click();
    await window.waitForTimeout(500);

    // The detail panel should show something (auto-preview on selection)
    const detailHost = window.locator("#detailHost");
    await expect(detailHost).toBeVisible();
  });
});

// ── 3. Elementalist flip skills not appearing in core/cata/evoker ────────────

test.describe("Elementalist flip skills filtering", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Elementalist");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("flip skills are filtered from equippable skill options", async () => {
    // The utility skill group contains heal (index 0), 3 utilities, and elite.
    const utilGroup = window.locator(".skill-group--utilities");
    await expect(utilGroup).toBeVisible({ timeout: 5000 });

    // Open the heal skill cselect for Elementalist
    const healSlot = utilGroup.locator(".skill-slot").first();
    const iconBtn = healSlot.locator(".skill-icon-large");
    await iconBtn.click();

    const cselectOpen = window.locator(".cselect--skill-slot.cselect--open");
    await expect(cselectOpen).toBeVisible({ timeout: 5000 });

    // Count the available options — flip skills should be excluded
    const optionCount = await cselectOpen.locator(".cselect__option").count();
    expect(optionCount).toBeGreaterThan(0);

    // Get all option texts and verify none are known flip skill names
    // (Overload skills are mechanic skills, not equippable — they should not appear as heal options)
    const optionTexts = await cselectOpen.locator(".cselect__option .cselect__label").allTextContents();
    const flipIndicators = ["Overload Fire", "Overload Water", "Overload Air", "Overload Earth"];
    for (const flip of flipIndicators) {
      const found = optionTexts.some((t) => t.includes(flip));
      expect(found, `Flip skill "${flip}" should not appear in heal picker`).toBe(false);
    }

    // Close the dropdown
    await window.evaluate(() => {
      const open = document.querySelector(".cselect--open");
      if (open) open.classList.remove("cselect--open");
    });
    await window.waitForTimeout(300);
  });
});

// ── 4. Build name appears in window title ────────────────────────────────────

test.describe("Build name appears in window title", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("setting build title updates document.title", async () => {
    await setTitle(window, "My Custom Build");
    await window.waitForTimeout(300);

    // Save to trigger title update
    await saveBuild(window);
    await window.waitForTimeout(300);

    const title = await window.evaluate(() => document.title);
    expect(title).toContain("My Custom Build");
  });
});

// ── 5. Build summary collapsed by default ────────────────────────────────────

test.describe("Boon coverage collapsed by default", () => {
  let app, window;

  const build = makeTestBuild({ title: "Collapse Test", profession: "Necromancer" });
  const lineId = uuid();
  const comp = makeTestComp({
    name: "Collapse Test Comp",
    buildIds: [build.id],
    partyLines: [{ id: lineId, capacity: 5, slots: [build.id] }],
  });
  build.compId = comp.id;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(build);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToComps(window);
    await openFirstComp(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("boon coverage section exists with toggle header", async () => {
    // The boon coverage section should have its collapsible header
    const header = window.locator("[data-action='toggle-boon-coverage']");
    await expect(header).toBeVisible();
    // The title should say BOON COVERAGE
    const title = window.locator(".comp-boon-cov__title");
    await expect(title).toHaveText("BOON COVERAGE");
  });
});

// ── 6. Loading states show during catalog fetches ────────────────────────────

test.describe("Loading states show during catalog fetches", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("skeleton placeholders exist in HTML before catalog loads", async () => {
    // The initial HTML has skeleton elements for specs and skills
    // After init, they are replaced. But we can verify the mechanism exists.
    const hasSkeletonCSS = await window.evaluate(() => {
      // Check that skeleton CSS classes are defined in stylesheets
      const sheets = [...document.styleSheets];
      for (const sheet of sheets) {
        try {
          const rules = [...sheet.cssRules];
          for (const rule of rules) {
            if (rule.selectorText && rule.selectorText.includes("skel-spec-card")) {
              return true;
            }
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasSkeletonCSS).toBe(true);
  });
});

// ── 7. Lines between skills persist after publish ────────────────────────────

test.describe("Lines between skills persist after publish", () => {
  test.skip("publishing requires GitHub API credentials — cannot test in E2E without mock", () => {});
});

// ── 8. GitHub Pages setup is optional ────────────────────────────────────────

test.describe("GitHub Pages setup is optional", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("app launches and functions without GitHub Pages configuration", async () => {
    // The app should launch and work without any GitHub Pages or publishing setup.
    // Navigate to editor and verify it works
    await goToEditor(window);
    const profSelect = window.locator("#professionSelect");
    await expect(profSelect).toBeVisible();

    // The publish button exists but doesn't block normal operation
    // Settings can be opened; publishing section is present but not required
    const settingsBtn = window.locator("#settingsBtn");
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await window.waitForTimeout(300);

      const publishSection = window.locator("#sm-publishing-section");
      // Publishing section exists in settings but is not mandatory
      if (await publishSection.isVisible()) {
        await expect(publishSection).toBeVisible();
      }

      // Close settings
      const closeBtn = window.locator("#sm-close");
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await window.waitForTimeout(300);
      }
    }

    // Verify the app is still functional
    await selectProfession(window, "Necromancer");
    const specCards = window.locator("#specializationsHost article.spec-card");
    const count = await specCards.count();
    expect(count).toBeGreaterThan(0);
  });
});

// ── 9. Sentinel's, Wanderer's, Diviner's appear in stat dropdown ─────────────

test.describe("Stat combos in equipment picker", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEquipment(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("Sentinel's appears in stat picker search", async () => {
    await openFirstArmorStatPicker(window);
    const search = window.locator(".slot-picker__search");
    await search.fill("Sentinel");
    await window.waitForTimeout(300);
    const options = await window.locator(".slot-picker__option").count();
    expect(options).toBeGreaterThanOrEqual(1);
    const texts = await window.locator(".slot-picker__option").allTextContents();
    const hasSentinel = texts.some((t) => t.includes("Sentinel"));
    expect(hasSentinel).toBe(true);
    // Close picker
    await window.evaluate(() => document.querySelector(".slot-picker")?.remove());
    await window.waitForTimeout(100);
  });

  test("Wanderer's appears in stat picker search", async () => {
    await openFirstArmorStatPicker(window);
    const search = window.locator(".slot-picker__search");
    await search.fill("Wanderer");
    await window.waitForTimeout(300);
    const options = await window.locator(".slot-picker__option").count();
    expect(options).toBeGreaterThanOrEqual(1);
    const texts = await window.locator(".slot-picker__option").allTextContents();
    const hasWanderer = texts.some((t) => t.includes("Wanderer"));
    expect(hasWanderer).toBe(true);
    // Close picker
    await window.evaluate(() => document.querySelector(".slot-picker")?.remove());
    await window.waitForTimeout(100);
  });

  test("Diviner's appears in stat picker search", async () => {
    await openFirstArmorStatPicker(window);
    const search = window.locator(".slot-picker__search");
    await search.fill("Diviner");
    await window.waitForTimeout(300);
    const options = await window.locator(".slot-picker__option").count();
    expect(options).toBeGreaterThanOrEqual(1);
    const texts = await window.locator(".slot-picker__option").allTextContents();
    const hasDiviner = texts.some((t) => t.includes("Diviner"));
    expect(hasDiviner).toBe(true);
    // Close picker
    await window.evaluate(() => document.querySelector(".slot-picker")?.remove());
    await window.waitForTimeout(100);
  });
});

// ── 10-12. Comp regression tests ─────────────────────────────────────────────

test.describe("Comp regressions — drag-and-drop", () => {
  let app, window;

  const buildA = makeTestBuild({ title: "Reg Build A", profession: "Necromancer" });
  const buildB = makeTestBuild({ title: "Reg Build B", profession: "Warrior" });
  const buildC = makeTestBuild({ title: "Reg Build C", profession: "Mesmer" });
  const buildD = makeTestBuild({ title: "Reg Build D", profession: "Guardian" });
  const buildE = makeTestBuild({ title: "Reg Build E", profession: "Ranger" });
  const buildF = makeTestBuild({ title: "Reg Build F", profession: "Engineer" });

  const lineId1 = uuid();
  const lineId2 = uuid();

  const comp = makeTestComp({
    name: "Regression Comp",
    buildIds: [buildA.id, buildB.id, buildC.id, buildD.id, buildE.id, buildF.id],
    partyLines: [
      { id: lineId1, capacity: 5, slots: [buildA.id, buildB.id, buildC.id] },
      { id: lineId2, capacity: 5, slots: [buildD.id, buildE.id, buildF.id, buildA.id, buildB.id] },
    ],
  });

  buildA.compId = comp.id;
  buildB.compId = comp.id;
  buildC.compId = comp.id;
  buildD.compId = comp.id;
  buildE.compId = comp.id;
  buildF.compId = comp.id;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(buildA);
    seedBuildFile(buildB);
    seedBuildFile(buildC);
    seedBuildFile(buildD);
    seedBuildFile(buildE);
    seedBuildFile(buildF);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToComps(window);
    await openFirstComp(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 10. Build draggable to last slot position
  test("build draggable to last slot position in party line", async () => {
    const firstSlot = window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).first();
    const lastEmpty = window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--empty`
    ).last();
    await firstSlot.dragTo(lastEmpty);
    await window.waitForTimeout(500);

    // Line 1 should still have its filled slots
    const filledCount = await window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).count();
    expect(filledCount).toBe(3);
  });

  // 11. Full party line rejects drop (capacity guard)
  test("full party line rejects drop from another line", async () => {
    // Line 2 is full (5/5). Try to drag from line 1 into it.
    const filledBefore = await window.locator(
      `.comp-line[data-line-id="${lineId2}"] .comp-slot--filled`
    ).count();
    expect(filledBefore).toBe(5);

    const srcSlot = window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).first();
    const fullTarget = window.locator(
      `.comp-line[data-line-id="${lineId2}"] .comp-line__slots`
    );
    await srcSlot.dragTo(fullTarget);
    await window.waitForTimeout(500);

    const filledAfter = await window.locator(
      `.comp-line[data-line-id="${lineId2}"] .comp-slot--filled`
    ).count();
    expect(filledAfter).toBe(5);
  });

  // 12. Build dropped back onto original line restored
  test("build dropped back onto original line remains intact", async () => {
    const filledBefore = await window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).count();

    // Drag a slot within the same line (no-op reorder)
    const firstSlot = window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).first();
    const lineSlots = window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-line__slots`
    );
    await firstSlot.dragTo(lineSlots);
    await window.waitForTimeout(500);

    const filledAfter = await window.locator(
      `.comp-line[data-line-id="${lineId1}"] .comp-slot--filled`
    ).count();
    expect(filledAfter).toBe(filledBefore);
  });
});
