const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");

test.describe("Smoke test", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    // Navigate to the editor page so all tests start from a known state.
    // launchApp() already waits for init() to complete (specializationsHost has spec cards),
    // but the app starts on the library page — navigate to editor before any tests run.
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 10_000 });
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  test("app launches and shows profession selector", async () => {
    // launchApp() + beforeAll navigated to editor; verify the profession select is visible.
    const profSelect = window.locator("#professionSelect");
    await expect(profSelect).toBeVisible({ timeout: 10_000 });
  });

  test("profession selector has options from mock server", async () => {
    // The custom select renders .cselect__option buttons inside #professionSelect
    const options = await window.locator("#professionSelect .cselect__option").count();
    expect(options).toBeGreaterThan(0);
  });

  test("can select Necromancer and see specializations host", async () => {
    const { selectProfession } = require("../helpers/editor");
    await selectProfession(window, "Necromancer");
    const specHost = window.locator("#specializationsHost");
    await expect(specHost).toBeVisible();
  });

  test("can set build title", async () => {
    // Ensure the editor is visible (guards against retry starting fresh on library page)
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 10_000 });
    await window.fill("#editorTitle", "Smoke Test Build");
    const value = await window.inputValue("#editorTitle");
    expect(value).toBe("Smoke Test Build");
  });

  test("can save build", async () => {
    // Ensure the editor is visible (guards against retry starting fresh on library page)
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 10_000 });
    await window.click("#saveBuildBtn");
    await window.waitForTimeout(500);
  });

  test("window controls are visible", async () => {
    await expect(window.locator("#winMin")).toBeVisible();
    await expect(window.locator("#winMax")).toBeVisible();
    await expect(window.locator("#winClose")).toBeVisible();
  });

  test("can navigate to library", async () => {
    await window.click('.leftnav__item[data-page="library"]');
    await window.waitForTimeout(500);
    const libPage = window.locator("#page-library:not(.hidden)");
    await expect(libPage).toBeVisible();
  });

  test("can navigate back to editor", async () => {
    await window.click('.leftnav__item[data-page="editor"]');
    await window.waitForTimeout(500);
    const editorPage = window.locator("#page-editor:not(.hidden)");
    await expect(editorPage).toBeVisible();
  });
});
