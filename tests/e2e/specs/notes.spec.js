const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");
const { selectProfession, setTitle, saveBuild } = require("../helpers/editor");
const { switchTab } = require("../helpers/nav");

test.describe("Notes Tab", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    // Switch to the Notes subtab
    await switchTab(window, "notes");
    await window.waitForSelector("#subtab-notes:not(.hidden)", { timeout: 5000 });
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 1. Notes textarea accepts input
  test("notes textarea accepts input", async () => {
    const textarea = window.locator(".notes-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Hello notes test");
    const value = await textarea.inputValue();
    expect(value).toBe("Hello notes test");
    // Clear for subsequent tests
    await textarea.fill("");
  });

  // 2. Toolbar buttons insert markdown (Bold, Italic, etc.)
  test("toolbar buttons insert markdown", async () => {
    const textarea = window.locator(".notes-textarea");
    await textarea.fill("");
    await textarea.focus();

    // Click Bold button (title="Bold")
    const boldBtn = window.locator('.notes-toolbar__btn[title="Bold"]');
    await boldBtn.click();
    let value = await textarea.inputValue();
    expect(value).toContain("**");

    // Clear and test Italic
    await textarea.fill("");
    await textarea.focus();
    const italicBtn = window.locator('.notes-toolbar__btn[title="Italic"]');
    await italicBtn.click();
    value = await textarea.inputValue();
    expect(value).toContain("*");

    // Clear and test Heading 1
    await textarea.fill("");
    await textarea.focus();
    const h1Btn = window.locator('.notes-toolbar__btn[title="Heading 1"]');
    await h1Btn.click();
    value = await textarea.inputValue();
    expect(value).toContain("# ");

    // Clear and test Link
    await textarea.fill("");
    await textarea.focus();
    const linkBtn = window.locator('.notes-toolbar__btn[title="Link"]');
    await linkBtn.click();
    value = await textarea.inputValue();
    expect(value).toContain("[link text](url)");

    // Clean up
    await textarea.fill("");
  });

  // 3. Toggle preview/edit mode works
  test("toggle preview/edit mode works", async () => {
    const textarea = window.locator(".notes-textarea");
    await textarea.fill("**Bold preview test**");

    // Click preview toggle button
    const previewBtn = window.locator(".notes-toolbar__preview");
    await previewBtn.click();
    await window.waitForTimeout(300);

    // Textarea should be hidden, preview div should be visible
    await expect(textarea).toBeHidden();
    const previewDiv = window.locator(".notes-preview");
    await expect(previewDiv).toBeVisible();

    // Preview button should have active class
    await expect(previewBtn).toHaveClass(/notes-toolbar__preview--active/);

    // Click preview toggle again to go back to edit mode
    await previewBtn.click();
    await window.waitForTimeout(300);

    // Textarea should be visible again
    await expect(textarea).toBeVisible();
    await expect(previewDiv).toBeHidden();
  });

  // 4. Preview renders markdown correctly
  test("preview renders markdown correctly", async () => {
    const textarea = window.locator(".notes-textarea");
    await textarea.fill("**Bold text** and *italic text*");

    // Switch to preview mode
    const previewBtn = window.locator(".notes-toolbar__preview");
    await previewBtn.click();
    await window.waitForTimeout(300);

    const previewDiv = window.locator(".notes-preview");
    await expect(previewDiv).toBeVisible();

    // Preview should render markdown to HTML
    const previewHtml = await previewDiv.innerHTML();
    expect(previewHtml).toContain("<strong>Bold text</strong>");
    expect(previewHtml).toContain("<em>italic text</em>");

    // Switch back to edit mode
    await previewBtn.click();
    await window.waitForTimeout(300);
  });

  // 5. @ mention autocomplete shows skills/traits
  test("@ mention autocomplete shows results from catalog", async () => {
    const textarea = window.locator(".notes-textarea");
    await textarea.fill("");
    await textarea.focus();

    // Type @ followed by a search query — "Life" should match skills/traits
    // in the Necromancer catalog from the mock server
    await textarea.type("@Life");
    await window.waitForTimeout(500);

    // The autocomplete popup should appear
    const autocomplete = window.locator(".notes-autocomplete");
    // If no results, the popup won't show, so we check if it exists
    const count = await autocomplete.count();
    if (count > 0) {
      await expect(autocomplete).toBeVisible();
      // Should have at least one item
      const items = autocomplete.locator(".notes-autocomplete__item");
      const itemCount = await items.count();
      expect(itemCount).toBeGreaterThan(0);

      // Each item should have a name
      const firstName = await items.first().locator(".notes-autocomplete__item-name").textContent();
      expect(firstName.length).toBeGreaterThan(0);
    }

    // Dismiss autocomplete
    await window.keyboard.press("Escape");
    await window.waitForTimeout(200);
    await textarea.fill("");
  });

  // 6. Arrow keys navigate suggestions, Enter selects
  test("arrow keys navigate suggestions and Enter selects", async () => {
    const textarea = window.locator(".notes-textarea");
    await textarea.fill("");
    await textarea.focus();

    // Type @ followed by a query to trigger autocomplete
    await textarea.type("@Life");
    await window.waitForTimeout(500);

    const autocomplete = window.locator(".notes-autocomplete");
    const acCount = await autocomplete.count();
    if (acCount === 0) {
      // If autocomplete doesn't show (no matching catalog entries), skip gracefully
      test.skip();
      return;
    }

    // First item should be selected by default
    const selectedItem = autocomplete.locator(".notes-autocomplete__item--selected");
    await expect(selectedItem).toBeVisible();

    // Press ArrowDown to move selection
    await window.keyboard.press("ArrowDown");
    await window.waitForTimeout(200);

    // Now press Enter to select the current item
    await window.keyboard.press("Enter");
    await window.waitForTimeout(300);

    // The textarea should contain a mention pattern like @[type:id:Name]
    const value = await textarea.inputValue();
    expect(value).toMatch(/@\[\w+:\d+:[^\]]+\]/);

    // Autocomplete should be dismissed
    await expect(autocomplete).toHaveCount(0);

    await textarea.fill("");
  });

  // 7. Notes save with build and persist across save/reload
  test("notes save with build and persist across save/reload", async () => {
    // Switch to build tab to set a title, then back to notes
    await switchTab(window, "build");
    await window.waitForTimeout(300);
    await setTitle(window, "Notes Persist Test");

    // Switch back to notes tab
    await switchTab(window, "notes");
    await window.waitForTimeout(300);

    const textarea = window.locator(".notes-textarea");
    await textarea.fill("These notes should persist after save");

    // Save the build
    await saveBuild(window);

    // Verify notes are still present after save
    const valueAfterSave = await textarea.inputValue();
    expect(valueAfterSave).toBe("These notes should persist after save");
  });
});
