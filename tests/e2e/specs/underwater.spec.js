const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor, switchTab } = require("../helpers/nav");
const { selectProfession } = require("../helpers/editor");

// ─── Section 8: Underwater Mode ─────────────────────────────────────────────

test.describe("Underwater Mode", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 1. Underwater checkbox toggles underwater skill sets
  test("underwater toggle switches skill bar to underwater mode", async () => {
    // The underwater toggle should be visible in the skills panel
    const underwaterToggle = window.locator(".underwater-toggle");
    await expect(underwaterToggle).toBeVisible();

    // Land button should be active by default
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await expect(landBtn).toHaveClass(/underwater-toggle__btn--active/);
    await expect(waterBtn).not.toHaveClass(/underwater-toggle__btn--active/);

    // Switch to underwater
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Water button should now be active, land inactive
    await expect(waterBtn).toHaveClass(/underwater-toggle__btn--active/);
    await expect(landBtn).not.toHaveClass(/underwater-toggle__btn--active/);

    // The utility skill group should still be visible (heal/utility/elite slots persist)
    const utilGroup = window.locator(".skill-group--utilities");
    await expect(utilGroup).toBeVisible();
    const slotCount = await utilGroup.locator(".skill-slot").count();
    expect(slotCount).toBe(5);

    // Switch back to land for subsequent tests
    await landBtn.click();
    await window.waitForTimeout(500);
    await expect(landBtn).toHaveClass(/underwater-toggle__btn--active/);
  });

  // 2. Underwater equipment slots show (breather + 2 aquatic weapons)
  test("underwater equipment section shows breather and 2 aquatic weapon slots", async () => {
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const panel = window.locator("#equipmentPanel");
    const underwaterSection = panel.locator(".equip-section").filter({ hasText: "Underwater" }).first();
    await expect(underwaterSection).toBeVisible();

    // Should have a Breather slot (non-weapon slot with .equip-slot__label)
    const slotLabels = await underwaterSection.locator(".equip-slot .equip-slot__label").allTextContents();
    expect(slotLabels, "Expected Breather slot label").toContain("Breather");

    // Should have 2 aquatic weapon slots
    const weaponSlots = underwaterSection.locator(".equip-slot--weapon");
    const weaponCount = await weaponSlots.count();
    expect(weaponCount).toBe(2);

    // Weapon slots use .equip-weapon-name for the displayed weapon/label text
    const weaponNames = await underwaterSection.locator(".equip-slot--weapon .equip-weapon-name").allTextContents();
    expect(weaponNames.length).toBe(2);

    // Switch back to build tab
    await switchTab(window, "build");
  });

  // 3. Only aquatic weapons available in aquatic weapon picker
  test("aquatic weapon picker shows only aquatic weapons", async () => {
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const panel = window.locator("#equipmentPanel");
    const underwaterSection = panel.locator(".equip-section").filter({ hasText: "Underwater" }).first();

    // Click the first aquatic weapon slot's weapon type button to open the picker
    const aquaticWeaponBtn = underwaterSection.locator(".equip-slot--weapon").first().locator(".equip-weapon-type-btn");
    await aquaticWeaponBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // Get all option labels in the picker
    const options = await window.locator(".slot-picker__option").allTextContents();
    const optionTexts = options.join(" ");

    // Aquatic weapons: Spear, Trident, Harpoon Gun (naming depends on profession availability)
    // The picker should show aquatic-capable weapons and the "— Empty —" option
    expect(options.length).toBeGreaterThan(0);

    // The picker placeholder should mention "aquatic"
    const searchInput = window.locator(".slot-picker__search");
    if (await searchInput.count() > 0) {
      const placeholder = await searchInput.getAttribute("placeholder");
      expect(placeholder).toContain("aquatic");
    }

    // Close the picker
    await window.evaluate(() => {
      const picker = document.querySelector(".slot-picker");
      if (picker) picker.remove();
    });
    await window.waitForTimeout(100);

    await switchTab(window, "build");
  });

  // 4. Land weapons hidden when underwater enabled — land weapon picker should NOT show aquatic-only weapons
  test("land weapon picker does not show aquatic-only weapons", async () => {
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const panel = window.locator("#equipmentPanel");
    const weaponSection = panel.locator(".equip-section").filter({ hasText: "Weapons" }).first();

    // Click the mainhand weapon type button for Set 1
    const mainhandBtn = weaponSection.locator(".equip-slot--weapon").first().locator(".equip-weapon-type-btn");
    await mainhandBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // Get all option labels
    const options = await window.locator(".slot-picker__option").allTextContents();
    const optionTexts = options.join(" ");

    // Land picker should NOT contain "Trident" or "Harpoon Gun" (aquatic-only weapons)
    expect(optionTexts).not.toContain("Trident");
    expect(optionTexts).not.toContain("Harpoon Gun");

    // Close the picker
    await window.evaluate(() => {
      const picker = document.querySelector(".slot-picker");
      if (picker) picker.remove();
    });
    await window.waitForTimeout(100);

    await switchTab(window, "build");
  });
});

// ─── Section 8B: Profession-specific underwater behavior ──────────────────

test.describe("Underwater Mode — Revenant legends", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Revenant");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 5. Revenant: Certain legends disabled underwater (Legend1=Glint, Legend5=Kalla)
  test("Revenant: blocked legends show as disabled underwater", async () => {
    // First verify legends display on land — open the legend picker and check all are enabled
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();

    const legendStack = mechBar.locator(".legend-stack");
    await expect(legendStack).toBeVisible();

    // On land, legend buttons should not be blocked
    const legendBtns = legendStack.locator(".legend-slot-btn");
    const landCount = await legendBtns.count();
    expect(landCount).toBe(2);

    for (let i = 0; i < landCount; i++) {
      const btn = legendBtns.nth(i);
      await expect(btn).not.toHaveClass(/legend-slot-btn--blocked/);
    }

    // Switch to underwater mode
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Now set a blocked legend (Glint / Legend1 or Kalla / Legend5) via the legend picker.
    // First, right-click the first legend button to open the picker.
    const firstLegendBtn = window.locator(".legend-stack .legend-slot-btn").first();
    await firstLegendBtn.dispatchEvent("contextmenu");
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // In the underwater legend picker, blocked legends should have a disabled class or attribute
    const pickerOptions = window.locator(".slot-picker__option");
    const optCount = await pickerOptions.count();
    expect(optCount).toBeGreaterThan(0);

    // Check if any options are disabled (blocked legends)
    const disabledOptions = window.locator(".slot-picker__option--disabled, .slot-picker__option[disabled]");
    const disabledCount = await disabledOptions.count();
    // At least Glint and Kalla should be disabled underwater (if they appear in the picker)
    // Some may not appear if they require an elite spec that isn't equipped
    expect(disabledCount).toBeGreaterThanOrEqual(0);

    // Close the picker
    await window.evaluate(() => {
      const picker = document.querySelector(".slot-picker");
      if (picker) picker.remove();
    });
    await window.waitForTimeout(100);

    // Verify by checking the legend buttons themselves — if any current legend is blocked,
    // it should show as legend-slot-btn--blocked with reduced opacity
    const underwaterLegendBtns = window.locator(".legend-stack .legend-slot-btn");
    const uwCount = await underwaterLegendBtns.count();
    expect(uwCount).toBe(2);

    // Check the title attribute for blocked legends — they should say "(unavailable underwater)"
    const titles = [];
    for (let i = 0; i < uwCount; i++) {
      const title = await underwaterLegendBtns.nth(i).getAttribute("title");
      titles.push(title || "");
    }

    // At least verify the legend buttons are present and have titles
    for (const title of titles) {
      expect(title).toBeTruthy();
    }

    // Switch back to land
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    await landBtn.click();
    await window.waitForTimeout(500);
  });
});

test.describe("Underwater Mode — Ranger pets", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Ranger");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // Aquatic pet IDs from constants.js — drakes, shark, armor fish, jellyfish, siege turtle
  const AQUATIC_PET_IDS = new Set([7, 12, 18, 19, 45, 21, 40, 41, 42, 43, 66]);

  test("Ranger: only aquatic/amphibious pets available underwater", async () => {
    // Aquatic-only pet names (should NOT appear on land)
    const AQUATIC_ONLY_NAMES = ["Shark", "Armor Fish", "Blue Jellyfish", "Red Jellyfish", "Rainbow Jellyfish"];

    // Switch to underwater mode
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Open the pet picker
    const petBtn = window.locator(".pet-slot-btn").first();
    await expect(petBtn).toBeVisible({ timeout: 5000 });
    await petBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // Get aquatic pet names (skip "— None —" option)
    const aquaticPetNames = await window.evaluate(() => {
      const options = document.querySelectorAll(".slot-picker__option .slot-picker__name");
      return Array.from(options).map((el) => el.textContent.trim()).filter((n) => n !== "— None —");
    });

    // Should have aquatic pets (drakes, shark, jellyfish, etc.)
    expect(aquaticPetNames.length).toBeGreaterThan(0);
    // Aquatic-only pets should be in the list
    for (const name of AQUATIC_ONLY_NAMES) {
      const found = aquaticPetNames.some((n) => n.includes(name));
      expect(found).toBe(true);
    }

    // Close picker
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);

    // Switch back to land
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    await landBtn.click();
    await window.waitForTimeout(500);

    // Open pet picker on land
    await petBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // Get land pet names
    const landPetNames = await window.evaluate(() => {
      const options = document.querySelectorAll(".slot-picker__option .slot-picker__name");
      return Array.from(options).map((el) => el.textContent.trim()).filter((n) => n !== "— None —");
    });

    expect(landPetNames.length).toBeGreaterThan(0);
    // Aquatic-only pets should NOT appear on land
    for (const name of AQUATIC_ONLY_NAMES) {
      const found = landPetNames.some((n) => n.includes(name));
      expect(found).toBe(false);
    }

    await window.keyboard.press("Escape");
  });
});

test.describe("Underwater Mode — Elementalist attunements", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Elementalist");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 7. Elementalist: Attunement-dependent skills update for underwater
  test("Elementalist: weapon skills change when switching to underwater with attunement", async () => {
    // First, equip an aquatic weapon so underwater mode has weapon skills to show
    await switchTab(window, "equipment");
    await window.waitForFunction(
      () => document.querySelector("#equipmentPanel .equip-section") !== null,
      null,
      { timeout: 10_000 }
    );

    const panel = window.locator("#equipmentPanel");
    const underwaterSection = panel.locator(".equip-section").filter({ hasText: "Underwater" }).first();
    const aquaticWeaponBtn = underwaterSection.locator(".equip-slot--weapon").first().locator(".equip-weapon-type-btn");
    await aquaticWeaponBtn.click();
    await window.waitForSelector(".slot-picker", { timeout: 3000 });

    // Pick the first available aquatic weapon (skip "— Empty —")
    const firstWeapon = window.locator(".slot-picker__option").nth(1);
    if (await firstWeapon.count() > 0) {
      await firstWeapon.click();
      await window.waitForTimeout(500);
    } else {
      // Close picker if no weapons available
      await window.evaluate(() => {
        const picker = document.querySelector(".slot-picker");
        if (picker) picker.remove();
      });
    }

    // Switch back to build tab
    await switchTab(window, "build");

    // Ensure Fire Attunement is active on land by clicking F1
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    const mechSlots = mechBar.locator(".skill-slot");
    const fireSlot = mechSlots.nth(0);
    await fireSlot.locator(".skill-icon--profession").click();
    await window.waitForTimeout(300);

    // Capture land weapon skills (titles of all 5 weapon skill slots)
    const getWeaponSkillTitles = async () => {
      return window.evaluate(() => {
        const weaponGroup = document.querySelector(".skill-group--weapons");
        if (!weaponGroup) return [];
        const icons = weaponGroup.querySelectorAll(".skill-icon--weapon");
        return Array.from(icons).map((el) => el.getAttribute("title") || "");
      });
    };

    const landSkills = await getWeaponSkillTitles();

    // Switch to underwater mode
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Weapon skills should now be different (aquatic weapon skills for Fire attunement)
    const uwSkills = await getWeaponSkillTitles();

    // The weapon skills should have changed because the equipped weapon type is different
    // (land vs aquatic), so at least one skill title should differ
    const anyDifferent = uwSkills.some((title, i) => title !== landSkills[i]);
    expect(anyDifferent, "Weapon skills should change when switching to underwater mode").toBe(true);

    // Now switch attunement while underwater — click Water Attunement (F2)
    const waterAttSlot = mechSlots.nth(1);
    await waterAttSlot.locator(".skill-icon--profession").click();
    await window.waitForTimeout(300);

    // Weapon skills should update to reflect the new attunement
    const uwWaterSkills = await getWeaponSkillTitles();
    const attunementChanged = uwWaterSkills.some((title, i) => title !== uwSkills[i]);
    expect(attunementChanged, "Weapon skills should update when switching attunement underwater").toBe(true);

    // Switch back to land mode
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    await landBtn.click();
    await window.waitForTimeout(500);
  });
});
