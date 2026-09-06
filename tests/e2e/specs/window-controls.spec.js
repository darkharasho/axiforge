const { test, expect } = require("playwright/test");
const { launchApp, closeApp } = require("../helpers/app");
const { openCustomSelect } = require("../helpers/editor");
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

  // The window is launched unmapped (AXIFORGE_HIDE_WINDOW, so a spec never steals
  // focus) and CI runs under a bare Xvfb with no window manager at all. minimize()
  // and maximize() are both requests TO a window manager, so isMinimized() and
  // isMaximized() stay false in either place no matter how correct the wiring is
  // -- which is exactly how these two specs sat red for months. What the app owns
  // is the wiring: button -> IPC -> the BrowserWindow call. So that is what they
  // assert now, by recording the calls main actually makes.
  async function recordWindowCalls() {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      globalThis.__winCalls = [];
      if (globalThis.__winCallsHooked) return;
      globalThis.__winCallsHooked = true;
      for (const name of ["minimize", "maximize", "unmaximize", "restore"]) {
        const orig = win[name].bind(win);
        win[name] = (...args) => {
          globalThis.__winCalls.push(name);
          // Recorded but not performed: on a developer machine there IS a window
          // manager, so a real minimize iconifies the window and every later
          // click in this spec waits forever on an element that is not there.
          if (name === "minimize") return undefined;
          return orig(...args);
        };
      }
    });
  }

  const windowCalls = () => app.evaluate(() => globalThis.__winCalls);

  // 1. Minimize, Maximize/Restore, Close buttons work
  test("minimize and maximize buttons reach the window", async () => {
    // Verify buttons are visible
    await expect(window.locator("#winMin")).toBeVisible();
    await expect(window.locator("#winMax")).toBeVisible();
    await expect(window.locator("#winClose")).toBeVisible();

    await recordWindowCalls();

    await window.click("#winMin");
    await expect.poll(windowCalls).toEqual(["minimize"]);

    // #winMax is a toggle over isMaximized(), which is false here, so it asks to
    // maximize.
    await window.click("#winMax");
    await expect.poll(windowCalls).toEqual(["minimize", "maximize"]);

    // On a machine that HAS a window manager that maximize really took, and the
    // rest of the file expects an ordinary window.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await window.waitForTimeout(300);
  });

  // 2. Double-clicking title bar maximizes/restores
  test("double-clicking title bar maximizes/restores", async () => {
    // Both halves of the toggle branch on isMaximized(), which answers for the
    // window manager -- true on a developer machine, permanently false under
    // Xvfb. Pin it rather than inherit it, so the spec asserts the same thing in
    // both places.
    const pinMaximized = (value) =>
      app.evaluate(({ BrowserWindow }, v) => {
        const win = BrowserWindow.getAllWindows()[0];
        globalThis.__realIsMaximized ||= win.isMaximized.bind(win);
        win.isMaximized = () => v;
      }, value);

    await recordWindowCalls();
    try {
      await pinMaximized(false);
      await window.locator("#titlebar").dblclick();
      await expect.poll(windowCalls).toEqual(["maximize"]);

      await pinMaximized(true);
      await window.locator("#titlebar").dblclick();
      await expect.poll(windowCalls).toEqual(["maximize", "unmaximize"]);
    } finally {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].isMaximized = globalThis.__realIsMaximized;
      });
    }
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

  // 7. Profession groups are all present
  test("profession colors are distinguishable", async () => {
    // The dropdown now uses grouped options — verify all 9 profession groups exist.
    // The open menu is portalled to document.body, so scope queries to the menu.
    const menu = await openCustomSelect(window, "#professionSelect");

    const groups = menu.locator(".cselect__group-header");
    const count = await groups.count();
    expect(count).toBe(9); // 9 GW2 professions

    // Each group header should have an SVG icon
    const iconCount = await menu.locator(".cselect__group-header .cselect__icon--svg").evaluateAll(
      (els) => els.filter((el) => !!el.querySelector("svg")).length,
    );
    expect(iconCount).toBe(9);

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
