const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const {
  openMenu,
  closeOpenSelect,
  selectProfession,
  fillSpecializations,
  changeSpecialization,
  selectSkill,
  equipMainhandWeapon,
} = require("../helpers/editor");

// Professions with full catalog fixture data (skills, traits, specializations).
const CATALOGED = ["Necromancer", "Elementalist", "Revenant"];

// Professions present in professions.json but lacking full catalog data.
const UNCATALOGED = ["Guardian", "Warrior", "Engineer", "Ranger", "Thief", "Mesmer"];

// ─── Section 5A: Base skill tests ───────────────────────────────────────────

test.describe("Skills — Base skill slots", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    // Skill slots start empty — the editor picks nothing for you — so equip a heal
    // skill for the tests below that assert on a populated slot.
    await selectSkill(window, ".skill-group--utilities .skill-slot", "Well of Blood");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 1. Heal skill slot displays with correct icon
  test("heal skill slot displays with correct icon", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    await expect(utilGroup).toBeVisible();

    // The utility group contains 5 slots: heal, utility x3, elite.
    // Heal is the first slot (keybind "6").
    const slots = utilGroup.locator(".skill-slot");
    const healSlot = slots.first();
    await expect(healSlot).toBeVisible();

    // The heal slot should have a skill icon button
    const iconBtn = healSlot.locator(".skill-icon-large");
    await expect(iconBtn).toBeVisible();

    // beforeAll equipped a heal skill, so the slot renders its icon
    const img = iconBtn.locator("img");
    const imgCount = await img.count();
    expect(imgCount).toBeGreaterThan(0);
    const src = await img.first().getAttribute("src");
    expect(src).toBeTruthy();

    // The keybind label should show "6"
    const keyLabel = iconBtn.locator(".skill-icon-large__keylabel");
    await expect(keyLabel).toHaveText("6");
  });

  // 2. 3 Utility skill slots display in order
  test("3 utility skill slots display in order", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    const slots = utilGroup.locator(".skill-slot");

    // Should have 5 total: heal + 3 utility + elite
    const count = await slots.count();
    expect(count).toBe(5);

    // Utility slots are indices 1, 2, 3 (keybinds 7, 8, 9)
    for (let i = 1; i <= 3; i++) {
      const slot = slots.nth(i);
      await expect(slot).toBeVisible();
      const keyLabel = slot.locator(".skill-icon-large .skill-icon-large__keylabel");
      await expect(keyLabel).toHaveText(String(i + 6));
    }
  });

  // 3. Elite skill slot displays correctly
  test("elite skill slot displays correctly", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    const slots = utilGroup.locator(".skill-slot");

    // Elite is the last slot (index 4, keybind "0")
    const eliteSlot = slots.nth(4);
    await expect(eliteSlot).toBeVisible();

    const iconBtn = eliteSlot.locator(".skill-icon-large");
    await expect(iconBtn).toBeVisible();

    // Keybind "0"
    const keyLabel = iconBtn.locator(".skill-icon-large__keylabel");
    await expect(keyLabel).toHaveText("0");
  });

  // 4. Skill icons load from GW2 API renders
  test("skill icons load from GW2 API renders", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    const iconBtns = utilGroup.locator(".skill-icon-large");
    const count = await iconBtns.count();
    expect(count).toBe(5);

    // The heal slot equipped in beforeAll should have an icon from the API
    const healIcon = iconBtns.first();
    const imgs = healIcon.locator("img");
    const imgCount = await imgs.count();
    if (imgCount > 0) {
      const src = await imgs.first().getAttribute("src");
      // GW2 API render URLs are typically https://render.guildwars2.com/...
      expect(src).toContain("render.guildwars2.com");
    }
  });

  // 5. Clicking skill slot opens picker with search
  test("clicking skill slot opens picker (cselect dropdown)", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    const healSlot = utilGroup.locator(".skill-slot").first();

    // Click the skill icon to open the custom select dropdown.
    // The icon button click handler proxies to the cselect trigger.
    const iconBtn = healSlot.locator(".skill-icon-large");
    await iconBtn.click();

    // The cselect overlay should open (wrapper gets .cselect--skill-slot.cselect--open),
    // but its menu is portalled to document.body — read options from there.
    await expect(window.locator(".cselect--skill-slot.cselect--open")).toBeVisible({ timeout: 3000 });
    const menu = openMenu(window);
    await menu.waitFor({ state: "visible", timeout: 3000 });

    // There should be skill options in the dropdown
    const options = menu.locator(".cselect__option");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    await closeOpenSelect(window);
  });

  // 6. Picker filters skills by profession/mode
  test("picker filters skills by profession/mode", async () => {
    // Open heal skill picker by clicking the icon button
    const utilGroup = window.locator(".skill-group--utilities");
    const healSlot = utilGroup.locator(".skill-slot").first();
    await healSlot.locator(".skill-icon-large").click();

    await expect(window.locator(".cselect--skill-slot.cselect--open")).toBeVisible({ timeout: 3000 });
    const menu = openMenu(window);
    await menu.waitFor({ state: "visible", timeout: 3000 });

    // All options should be Necromancer heal skills
    const optionLabels = await menu.locator(".cselect__option .cselect__label").allTextContents();
    expect(optionLabels.length).toBeGreaterThan(0);

    // Known Necromancer heal skills: "Summon Blood Fiend", "Consume Conditions", "Well of Blood"
    const necroHeals = ["Summon Blood Fiend", "Consume Conditions", "Well of Blood"];
    for (const heal of necroHeals) {
      const found = optionLabels.some((label) => label.includes(heal));
      expect(found, `Expected to find Necromancer heal skill: ${heal}`).toBe(true);
    }

    // Should NOT contain Elementalist-specific heals (e.g. "Glyph of Elemental Harmony")
    for (const label of optionLabels) {
      expect(label).not.toContain("Glyph of Elemental Harmony");
    }

    await closeOpenSelect(window);
  });

  // 7. Selected skill updates immediately
  test("selected skill updates immediately", async () => {
    const utilGroup = window.locator(".skill-group--utilities");
    const healSlot = utilGroup.locator(".skill-slot").first();
    const iconBtn = healSlot.locator(".skill-icon-large");

    // Capture the current heal skill title
    const beforeTitle = await iconBtn.getAttribute("title");

    // Open the picker and choose a different skill
    await iconBtn.click();
    await expect(window.locator(".cselect--skill-slot.cselect--open")).toBeVisible({ timeout: 3000 });
    const menu = openMenu(window);
    await menu.waitFor({ state: "visible", timeout: 3000 });

    // Find an option that is NOT currently selected
    const options = menu.locator(".cselect__option:not(.cselect__option--selected)");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    // Click the first non-selected option
    const targetLabel = await options.first().locator(".cselect__label").textContent();
    await options.first().click();
    await window.waitForTimeout(500);

    // The icon button title should now reflect the newly selected skill
    const afterTitle = await healSlot.locator(".skill-icon-large").getAttribute("title");
    expect(afterTitle).not.toBe(beforeTitle);
    expect(afterTitle).toContain(targetLabel.trim());
  });

  // 8. Aquatic/underwater skill slots show when applicable
  test("aquatic/underwater toggle switches skill bar context", async () => {
    // Verify the underwater toggle exists
    const underwaterToggle = window.locator(".underwater-toggle");
    await expect(underwaterToggle).toBeVisible();

    // Land button should be active by default
    const landBtn = window.locator('.underwater-toggle__btn[data-mode="land"]');
    const waterBtn = window.locator('.underwater-toggle__btn[data-mode="water"]');
    await expect(landBtn).toHaveClass(/underwater-toggle__btn--active/);

    // Capture current heal skill title on land
    const landHealTitle = await window.locator(
      ".skill-group--utilities .skill-slot:first-child .skill-icon-large"
    ).getAttribute("title");

    // Switch to underwater
    await waterBtn.click();
    await window.waitForTimeout(500);

    // Water button should now be active
    await expect(waterBtn).toHaveClass(/underwater-toggle__btn--active/);
    await expect(landBtn).not.toHaveClass(/underwater-toggle__btn--active/);

    // Skill slots should still be present (the structure persists)
    const utilGroup = window.locator(".skill-group--utilities");
    await expect(utilGroup).toBeVisible();
    const slotCount = await utilGroup.locator(".skill-slot").count();
    expect(slotCount).toBe(5);

    // Switch back to land
    await landBtn.click();
    await window.waitForTimeout(500);
    await expect(landBtn).toHaveClass(/underwater-toggle__btn--active/);
  });
});

// ─── Section 5B: Profession mechanic tests ──────────────────────────────────

test.describe("Skills — Profession mechanics", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 9. Elementalist: Attunement buttons (Fire/Water/Air/Earth)
  test("Elementalist: attunement buttons Fire/Water/Air/Earth display", async () => {
    await selectProfession(window, "Elementalist");

    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();

    // Elementalist should have 4 attunement F-slots (F1-F4): Fire, Water, Air, Earth
    const mechSlots = mechBar.locator(".skill-slot");
    const count = await mechSlots.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Each mechanic slot should have an F-key label and a profession icon
    const attunementNames = [];
    for (let i = 0; i < 4; i++) {
      const slot = mechSlots.nth(i);
      const fLabel = slot.locator(".skill-icon--profession-flabel");
      await expect(fLabel).toBeVisible();
      await expect(fLabel).toHaveText(`F${i + 1}`);

      // Each attunement should have an icon image
      const iconBtn = slot.locator(".skill-icon--profession");
      await expect(iconBtn).toBeVisible();
      const img = iconBtn.locator("img");
      expect(await img.count()).toBeGreaterThan(0);

      const title = await iconBtn.getAttribute("title");
      attunementNames.push(title);
    }

    // Verify all 4 attunement names are present (Fire, Water, Air, Earth)
    const expected = ["Fire Attunement", "Water Attunement", "Air Attunement", "Earth Attunement"];
    for (const name of expected) {
      expect(attunementNames).toContain(name);
    }

    // Click an attunement and verify it becomes active
    // First click Fire Attunement (F1) to ensure an attunement is active
    const fireSlot = mechSlots.nth(0);
    await fireSlot.locator(".skill-icon--profession").click();
    await window.waitForTimeout(300);

    const fireIcon = fireSlot.locator(".skill-icon--profession");
    await expect(fireIcon).toHaveClass(/skill-icon--profession-active/);

    // Now click Water Attunement (F2) and verify it becomes active
    const waterSlot = mechSlots.nth(1);
    await waterSlot.locator(".skill-icon--profession").click();
    await window.waitForTimeout(300);

    const waterIcon = waterSlot.locator(".skill-icon--profession");
    await expect(waterIcon).toHaveClass(/skill-icon--profession-active/);
  });

  // 10. Necromancer: Shroud mechanics
  test("Necromancer: shroud mechanic F1 slot displays", async () => {
    await selectProfession(window, "Necromancer");

    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();

    // Necromancer should have at least 1 profession mechanic slot (Death Shroud at F1)
    const mechSlots = mechBar.locator(".skill-slot");
    const count = await mechSlots.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // The F1 slot should have the Death Shroud skill
    const firstSlot = mechSlots.first();
    const iconBtn = firstSlot.locator(".skill-icon--profession");
    await expect(iconBtn).toBeVisible();

    // It should have an F1 label
    const fLabel = firstSlot.locator(".skill-icon--profession-flabel");
    await expect(fLabel).toHaveText("F1");

    // The skill should have an icon image
    const img = iconBtn.locator("img");
    const imgCount = await img.count();
    expect(imgCount).toBeGreaterThan(0);

    // Title should be "Death Shroud" (base Necro) or "Reaper's Shroud" etc depending on elite spec
    const title = await iconBtn.getAttribute("title");
    expect(title).toBeTruthy();
  });

  // 11. Revenant: Legend swap buttons (2 slots) + legend-specific skills
  test("Revenant: legend swap buttons and legend stack display", async () => {
    await selectProfession(window, "Revenant");

    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();

    // Revenant should have a legend-stack with 2 legend buttons
    const legendStack = mechBar.locator(".legend-stack");
    await expect(legendStack).toBeVisible();

    const legendBtns = legendStack.locator(".legend-slot-btn");
    const legendCount = await legendBtns.count();
    expect(legendCount).toBe(2);

    // One legend should be active
    const activeLegend = legendStack.locator(".legend-slot-btn--active");
    const activeCount = await activeLegend.count();
    expect(activeCount).toBe(1);

    // Each legend button should have an F1 label
    for (let i = 0; i < 2; i++) {
      const btn = legendBtns.nth(i);
      const label = btn.locator(".legend-slot-btn__label");
      await expect(label).toHaveText("F1");
    }
  });

  // 12. Guardian: Virtue buttons (F1-F3)
  test("Guardian: profession mechanics display", async () => {
    await selectProfession(window, "Guardian");
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    // Guardian has 3 virtue slots (F1 Justice, F2 Resolve, F3 Courage)
    const mechSlots = mechBar.locator(".skill-slot");
    expect(await mechSlots.count()).toBeGreaterThanOrEqual(3);
    // F1 should have a skill icon with title
    const f1Icon = mechSlots.first().locator(".skill-icon--profession");
    await expect(f1Icon).toBeVisible();
    const title = await f1Icon.getAttribute("title");
    expect(title).toBeTruthy();
  });

  // 13. Warrior: Burst skill (F1)
  test("Warrior: profession mechanics display", async () => {
    await selectProfession(window, "Warrior");
    // Warrior's F1 burst is weapon-specific: skills.js deliberately renders NO mechanic
    // (and hence no mechanics bar) while the mainhand is empty, which is how a fresh
    // build starts. Equip a weapon so there is a burst to show.
    await equipMainhandWeapon(window, "Greatsword");
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    // Warrior has F1 burst + potentially F2 from elite specs
    const mechSlots = mechBar.locator(".skill-slot");
    expect(await mechSlots.count()).toBeGreaterThanOrEqual(1);
    const f1Label = mechSlots.first().locator(".skill-icon--profession-flabel");
    await expect(f1Label).toHaveText("F1");
  });

  // 14. Engineer: Tool belt skills (F1-F5)
  test("Engineer: profession mechanics display", async () => {
    await selectProfession(window, "Engineer");
    // The Engineer tool belt is derived from equipped utility skills — with an empty
    // skill bar there are no F-slots and therefore no mechanics bar.
    await selectSkill(window, ".skill-group--utilities .skill-slot", "Healing Turret");
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    // Engineer has tool belt F1-F5 derived from equipped skills
    const mechSlots = mechBar.locator(".skill-slot");
    expect(await mechSlots.count()).toBeGreaterThanOrEqual(1);
    const f1Label = mechSlots.first().locator(".skill-icon--profession-flabel");
    await expect(f1Label).toHaveText("F1");
  });

  // 15. Ranger: profession mechanics (pet slots)
  test("Ranger: profession mechanics display", async () => {
    await selectProfession(window, "Ranger");
    // Ranger has pet slots in the mechanic bar
    const petBtn = window.locator(".pet-slot-btn");
    await expect(petBtn.first()).toBeVisible({ timeout: 5000 });
    // Should have pet slot label
    const petLabel = window.locator(".pet-slot-btn__label");
    expect(await petLabel.first().textContent()).toBeTruthy();
  });

  // 16. Thief: Steal/shadow mechanic (F1)
  test("Thief: profession mechanics display", async () => {
    await selectProfession(window, "Thief");
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    // Thief has F1 Steal + potentially F2 from elite specs
    const mechSlots = mechBar.locator(".skill-slot");
    expect(await mechSlots.count()).toBeGreaterThanOrEqual(1);
    const f1Icon = mechSlots.first().locator(".skill-icon--profession");
    await expect(f1Icon).toBeVisible();
    const title = await f1Icon.getAttribute("title");
    expect(title).toBeTruthy();
  });

  // 17. Mesmer: Shatter skills (F1-F4)
  test("Mesmer: profession mechanics display", async () => {
    await selectProfession(window, "Mesmer");
    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();
    // Mesmer has 4 shatter skills (F1-F4)
    const mechSlots = mechBar.locator(".skill-slot");
    expect(await mechSlots.count()).toBeGreaterThanOrEqual(4);
    // Verify F1-F4 labels
    for (let i = 0; i < 4; i++) {
      const label = mechSlots.nth(i).locator(".skill-icon--profession-flabel");
      await expect(label).toHaveText(`F${i + 1}`);
    }
  });

  // 18. Mechanics update when specialization changes
  test("mechanics update when specialization changes", async () => {
    // Use Necromancer — switching elite spec changes the F1 mechanic
    // (e.g. "Death Shroud" ↔ "Reaper's Shroud" ↔ Scourge F1–F5)
    await selectProfession(window, "Necromancer");

    const mechBar = window.locator(".profession-mechanics-bar");
    await expect(mechBar).toBeVisible();

    // Only the third slot accepts an elite spec, and the editor opens with all three
    // slots empty — put a known elite spec in it so there is an F1 mechanic to change.
    await fillSpecializations(window, ["Spite", "Curses", "Reaper"]);

    // Capture the current F1 mechanic title
    const f1Icon = mechBar.locator(".skill-slot").first().locator(".skill-icon--profession");
    const beforeTitle = await f1Icon.getAttribute("title");
    expect(beforeTitle).toBeTruthy();

    // Swap the elite spec — the F1 mechanic should follow it
    // (Reaper's Shroud → Desert Shroud etc.)
    await changeSpecialization(window, 2, "Scourge");

    const afterTitle = await mechBar
      .locator(".skill-slot")
      .first()
      .locator(".skill-icon--profession")
      .getAttribute("title");
    expect(afterTitle).toBeTruthy();
    expect(afterTitle).not.toBe(beforeTitle);
  });
});
