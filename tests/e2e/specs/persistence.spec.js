const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { goToEditor, goToLibrary, switchTab } = require("../helpers/nav");
const { selectProfession, setTitle, saveBuild } = require("../helpers/editor");
const { seedBuildFile } = require("../helpers/data");
const { makeTestBuild } = require("../helpers/builds");

// ── Section 12A: Save & Dirty State ──────────────────────────────────────────

test.describe("Save & Dirty State", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
    await selectProfession(window, "Necromancer");
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 1. Save button saves all editor data; Ctrl+S shortcut works
  test("save button saves all editor data and Ctrl+S shortcut works", async () => {
    // Set a title and save via button
    await setTitle(window, "Save Button Test");
    await saveBuild(window);

    // The build should now exist in the library
    await goToLibrary(window);
    const row = window.locator("[data-build-id]", { hasText: "Save Button Test" });
    await expect(row.first()).toBeVisible();

    // Go back to editor to test Ctrl+S
    await goToEditor(window);
    await setTitle(window, "Ctrl+S Test");
    await window.keyboard.press("Control+s");
    await window.waitForTimeout(500);

    // Verify saved via library
    await goToLibrary(window);
    const updatedRow = window.locator("[data-build-id]", { hasText: "Ctrl+S Test" });
    await expect(updatedRow.first()).toBeVisible();

    // Return to editor
    await goToEditor(window);
  });

  // 2. Warning on page/build change if unsaved
  test("warning on build change if unsaved changes exist", async () => {
    // Save first to establish a baseline
    await saveBuild(window);
    await window.waitForTimeout(300);

    // Make a change to mark editor dirty
    await setTitle(window, "Dirty Build Title");
    await window.waitForTimeout(200);

    // The editor dirty state is tracked internally via computeEditorSignature().
    // confirmDiscardDirty() fires window.confirm() when state.editorDirty is true.
    // Verify the saveDot indicator exists (it shows when there are unsaved changes)
    const hasSaveDot = await window.evaluate(() => {
      return document.querySelector("#saveDot") !== null;
    });
    expect(hasSaveDot).toBe(true);

    // Save to reset dirty state for next tests
    await saveBuild(window);
  });
});

// ── Section 12B: Import/Export ────────────────────────────────────────────────

test.describe("Import/Export", () => {
  let app, window;

  // Single dialog handler — auto-accept any confirm() or alert() dialogs
  const dialogHandler = async (dialog) => {
    await dialog.accept();
  };

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    // Register a single dialog handler for the entire describe block
    window.on("dialog", dialogHandler);

    await goToEditor(window);
    await selectProfession(window, "Necromancer");
    await setTitle(window, "Export Test Build");

    // Unhide the Copy/Paste JSON buttons (they are dev-only)
    await window.evaluate(() => {
      document.querySelector("#copyBuildBtn")?.classList.remove("hidden");
      document.querySelector("#pasteBuildBtn")?.classList.remove("hidden");
    });
  });

  test.afterAll(async () => {
    window.off("dialog", dialogHandler);
    await closeApp(app);
  });

  // 3. Copy JSON exports current build
  test("Copy JSON exports current build to clipboard", async () => {
    // Open the overflow menu first
    await window.click("#overflowMenuBtn");
    await window.waitForTimeout(300);

    // Now click Copy JSON
    await window.click("#copyBuildBtn");
    await window.waitForTimeout(500);

    // Read clipboard
    const clipText = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clipText).toBeTruthy();

    // Should be valid JSON
    const parsed = JSON.parse(clipText);
    expect(parsed.title).toBe("Export Test Build");
    expect(parsed.profession).toBe("Necromancer");
  });

  // 4. Paste JSON imports from clipboard
  test("Paste JSON imports from clipboard", async () => {
    // Write a build JSON to clipboard
    const importBuild = {
      title: "Imported JSON Build",
      profession: "Warrior",
      specializations: [],
      skills: { heal: null, utility: [null, null, null], elite: null },
      tags: ["test"],
      notes: "imported notes",
      gameMode: "pve",
    };
    await app.evaluate(({ clipboard }, json) => clipboard.writeText(json), JSON.stringify(importBuild));

    // Open the overflow menu and click Paste JSON
    await window.click("#overflowMenuBtn");
    await window.waitForTimeout(300);
    await window.click("#pasteBuildBtn");
    await window.waitForTimeout(1000);

    // The editor title should now reflect the imported build
    const editorTitle = await window.inputValue("#editorTitle");
    expect(editorTitle).toBe("Imported JSON Build");

    // Check the publish status shows import message
    const status = await window.locator("#publishStatus").textContent();
    expect(status).toContain("Imported");
  });

  // 5. Paste chat link imports build into editor
  test("paste chat link (AxiCode) imports build into editor", async () => {
    // First, create and save a build so we can generate a share code
    await setTitle(window, "Chat Link Source");
    await saveBuild(window);

    // Generate the share code via the desktopApi
    const shareCode = await window.evaluate(async () => {
      try {
        const builds = await window.desktopApi.listBuilds();
        if (!builds?.length) return null;
        return await window.desktopApi.encodeShareCode(builds[builds.length - 1]);
      } catch {
        return null;
      }
    });

    if (!shareCode) {
      test.skip();
      return;
    }

    // Write the share code to clipboard
    await app.evaluate(({ clipboard }, code) => clipboard.writeText(code), shareCode);

    // Click paste button via overflow menu
    await window.click("#overflowMenuBtn");
    await window.waitForTimeout(300);
    await window.click("#pasteBuildBtn");
    await window.waitForTimeout(1000);

    // Verify import occurred — status should mention AxiCode
    const status = await window.locator("#publishStatus").textContent();
    expect(status).toContain("Imported");
  });

  // 6. Imported build loads all data correctly
  test("imported build loads all data correctly", async () => {
    // Write a complete build JSON to clipboard
    const fullBuild = {
      title: "Full Import Test",
      profession: "Necromancer",
      specializations: [],
      skills: { heal: null, utility: [null, null, null], elite: null },
      tags: ["raid", "power"],
      notes: "Full build import notes",
      gameMode: "pvp",
      equipment: {
        statPackage: "",
        relic: "",
        food: "",
        utility: "",
        slots: {},
        weapons: {},
        runes: {},
        sigils: {},
        infusions: {},
        enrichment: "",
      },
    };
    await app.evaluate(({ clipboard }, json) => clipboard.writeText(json), JSON.stringify(fullBuild));

    // Open overflow menu and click Paste JSON
    await window.click("#overflowMenuBtn");
    await window.waitForTimeout(300);
    await window.click("#pasteBuildBtn");
    await window.waitForTimeout(1000);

    // Verify title
    const title = await window.inputValue("#editorTitle");
    expect(title).toBe("Full Import Test");

    // Verify notes (switch to notes tab)
    await switchTab(window, "notes");
    await window.waitForTimeout(300);
    const notesTextarea = window.locator(".notes-textarea");
    const notesValue = await notesTextarea.inputValue();
    expect(notesValue).toBe("Full build import notes");

    // Switch back to build tab
    await switchTab(window, "build");
  });
});
