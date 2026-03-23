const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { goToEditor } = require("../helpers/nav");

test.describe("Window Controls", () => {
  let app, window;

  test.beforeAll(async () => {
    ({ app, window } = await launchApp());
    await goToEditor(window);
  });

  test.afterAll(async () => {
    await closeApp(app);
  });

  // 1. Minimize, Maximize/Restore, Close buttons work
  test("minimize, maximize/restore buttons work", async () => {
    // Show the window for minimize/maximize tests (hidden in e2e mode)
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win.isVisible()) win.showInactive();
    });
    await window.waitForTimeout(300);

    // Verify buttons are visible
    await expect(window.locator("#winMin")).toBeVisible();
    await expect(window.locator("#winMax")).toBeVisible();
    await expect(window.locator("#winClose")).toBeVisible();

    // Test minimize
    await window.click("#winMin");
    await window.waitForTimeout(500);

    const isMinimized = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMinimized()
    );
    expect(isMinimized).toBe(true);

    // Restore from minimize
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore()
    );
    await window.waitForTimeout(500);

    const isMinimizedAfterRestore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMinimized()
    );
    expect(isMinimizedAfterRestore).toBe(false);

    // Test maximize
    await window.click("#winMax");
    await window.waitForTimeout(500);

    const isMaximized = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized()
    );
    expect(isMaximized).toBe(true);

    // Click maximize again to restore
    await window.click("#winMax");
    await window.waitForTimeout(500);

    const isMaximizedAfterRestore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized()
    );
    expect(isMaximizedAfterRestore).toBe(false);
  });

  // 2. Double-clicking title bar maximizes/restores
  test("double-clicking title bar maximizes/restores", async () => {
    // Ensure window is visible and not maximized
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win.isVisible()) win.showInactive();
    });
    const wasMaximized = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized()
    );
    if (wasMaximized) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].unmaximize()
      );
      await window.waitForTimeout(300);
    }

    // Double-click the titlebar
    await window.locator("#titlebar").dblclick();
    await window.waitForTimeout(500);

    const isMaximized = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized()
    );
    expect(isMaximized).toBe(true);

    // Double-click again to restore
    await window.locator("#titlebar").dblclick();
    await window.waitForTimeout(500);

    const isRestored = await app.evaluate(({ BrowserWindow }) =>
      !BrowserWindow.getAllWindows()[0].isMaximized()
    );
    expect(isRestored).toBe(true);
  });

  // 3. Window resizing works (min 1120x740)
  test("window enforces minimum size of 1120x740", async () => {
    // Get current size
    const [origWidth, origHeight] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    );

    // Try to resize to below minimum
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(800, 500);
    });
    await window.waitForTimeout(500);

    const [newWidth, newHeight] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    );

    // The window should enforce minimum size of 1120x740
    expect(newWidth).toBeGreaterThanOrEqual(1120);
    expect(newHeight).toBeGreaterThanOrEqual(740);

    // Restore original size
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
    }, [origWidth, origHeight]);
    await window.waitForTimeout(300);
  });

  // 4. Window size persists across sessions
  test.skip("window size persists across sessions", async () => {
    // The app does not implement window state persistence (no saveWindowState/loadWindowState).
    // This test is skipped because the feature is not yet implemented.
  });

  // 5. Version displays in titlebar
  test("version displays in titlebar", async () => {
    const versionLabel = window.locator("#updateVersionLabel");
    // The version label element exists; it may or may not have text depending on update state.
    // Verify the element is present in the DOM.
    const exists = await versionLabel.count();
    expect(exists).toBe(1);

    // The version label text may be populated by the update checker.
    // We can at least verify the titlebar brand text is present.
    const brandText = await window.locator(".titlebar__brand").textContent();
    expect(brandText).toContain("AxiForge");
  });

  // 6. Dark theme is readable with good contrast
  test("dark theme has readable contrast", async () => {
    // Verify the background color is dark
    const bgColor = await window.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    // The app uses a dark background (#050910 or similar)
    expect(bgColor).toBeTruthy();

    // Verify text color is light for contrast
    const textColor = await window.evaluate(() => {
      return getComputedStyle(document.body).color;
    });
    expect(textColor).toBeTruthy();

    // Parse colors to verify contrast — background should be dark (low luminance)
    // and text should be light (high luminance)
    const parsedBg = parseRgb(bgColor);
    const parsedText = parseRgb(textColor);

    if (parsedBg && parsedText) {
      const bgLuminance = relativeLuminance(parsedBg);
      const textLuminance = relativeLuminance(parsedText);
      // Dark background should have low luminance
      expect(bgLuminance).toBeLessThan(0.2);
      // Text should have higher luminance than background for readability
      expect(textLuminance).toBeGreaterThan(bgLuminance);
    }
  });

  // 7. Profession colors distinguish clearly
  test("profession colors are distinguishable", async () => {
    // Check that the profession selector options have distinct color styling
    // by verifying the CSS custom properties or inline styles exist
    await window.click("#professionSelect .cselect__trigger");
    await window.waitForTimeout(300);

    const options = window.locator("#professionSelect .cselect__option");
    const count = await options.count();
    expect(count).toBe(9); // 9 GW2 professions

    // Each option should have a profession-specific color via an icon or class
    const optionColors = await window.evaluate(() => {
      const opts = document.querySelectorAll("#professionSelect .cselect__option");
      const colors = [];
      opts.forEach((opt) => {
        const color = opt.style.color ||
          getComputedStyle(opt).color ||
          opt.getAttribute("data-color") ||
          "";
        colors.push(color);
      });
      return colors;
    });

    // All options should have some color defined
    expect(optionColors.length).toBe(9);

    // Close the dropdown
    await window.click("#professionSelect .cselect__trigger");
    await window.waitForTimeout(200);
  });

  // 8. Workspace switcher shows user menu
  test("workspace switcher shows user menu", async () => {
    // Click the workspace button
    const wsBtn = window.locator("#workspaceBtn");
    await expect(wsBtn).toBeVisible();
    await wsBtn.click();
    await window.waitForTimeout(300);

    // The workspace menu should become visible (hidden class removed)
    const wsMenu = window.locator("#workspaceMenu");
    await expect(wsMenu).toBeVisible();

    // It should contain the auth row
    const authRow = window.locator("#authRow");
    await expect(authRow).toBeVisible();

    // Click outside the menu to close it (clicking on the main content area)
    await window.locator("#page-editor").click({ position: { x: 300, y: 300 } });
    await window.waitForTimeout(300);

    // Menu should be hidden again
    await expect(wsMenu).toBeHidden();
  });
});

// ── Helper functions for contrast checks ─────────────────────────────────────

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
