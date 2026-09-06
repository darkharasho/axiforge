// The columns view — the view mode that kept getting forgotten.
//
// Columns is structurally different from every other view: its items live in
// sibling `.lib-col` containers rather than nested inside a [data-folder-id],
// and it has its own class names. Both facts have caused silent breakage that
// no other view saw:
//
//  - Rename resolved to null, because startInlineRename knew four title classes
//    and .lib-col__name was not one of them. The menu item simply did nothing.
//  - A column-to-column drag has no hover target, so it falls through to the
//    Sortable branch of _applyDrop — the one branch that moved only the dragged
//    build and left the rest of the selection behind.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile, seedFolderFile } = require("../helpers/data");
const { makeTestBuild, makeTestFolder } = require("../helpers/builds");

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

async function useColumnsView(window) {
  await window.click('.lib-view-btn[data-view="columns"]');
  await window.waitForSelector(".lib-columns", { timeout: 5_000 });
  await window.waitForTimeout(400);
}

test.describe("Columns view", () => {
  let app, window;

  const folder = makeTestFolder({ name: "Season Five" });
  const inA = makeTestBuild({ title: "Inside A", profession: "Warrior", folderId: folder.id });
  const inB = makeTestBuild({ title: "Inside B", profession: "Ranger", folderId: folder.id });
  const inC = makeTestBuild({ title: "Inside C", profession: "Thief", folderId: folder.id });

  test.beforeAll(async () => {
    cleanDataDir();
    seedFolderFile(folder);
    seedBuildFile(inA);
    seedBuildFile(inB);
    seedBuildFile(inC);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
    await useColumnsView(window);
  });

  test.afterAll(async () => closeApp(app));

  test("right-click → Rename actually opens an editor on the name", async () => {
    await window.locator(`.lib-col__item[data-folder-id="${folder.id}"]`).click();
    await window.waitForTimeout(400);

    const row = window.locator(`.lib-col__item[data-build-id="${inA.id}"]`);
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await window
      .locator(".lib-ctx-menu .lib-ctx-item__label")
      .filter({ hasText: /^Rename$/ })
      .first()
      .click();

    // Before the fix this resolved null and the view just repainted, so the
    // input never appeared and Rename looked dead.
    const input = window.locator(".lib-inline-input");
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.fill("Renamed In Columns");
    await window.keyboard.press("Enter");
    await window.waitForTimeout(600);

    const title = await window.evaluate(
      async (id) => (await desktopApi.listBuilds()).find((b) => b.id === id)?.title,
      inA.id
    );
    expect(title).toBe("Renamed In Columns");
  });

});

// ─── Window chrome ────────────────────────────────────────────────────────────

test.describe("App layout fits under the titlebar", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(makeTestBuild({ title: "Anything", profession: "Warrior" }));
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("the layout is exactly the viewport minus the titlebar, so nothing scrolls under it", async () => {
    // .app-layout used to clear the fixed titlebar with `margin-top: 42px`. An
    // adjoining top margin collapses out through a parent with no top padding
    // or border, so those 42px landed on <body> rather than inside it: <html>
    // came out 42px taller than the viewport and the whole document could
    // scroll. Scroll it and the layout slides up under the titlebar, clipping
    // the left nav's first icon — which is what Windows users were seeing.
    // (A second copy of the height, written as 40px in four places against a
    // 42px bar, made it 2px worse again.)
    const metrics = await window.evaluate(() => {
      const bar = document.querySelector(".titlebar");
      const layout = document.querySelector(".app-layout");
      return {
        barHeight: bar.getBoundingClientRect().height,
        layoutTop: layout.getBoundingClientRect().top,
        layoutBottom: layout.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        scrollable: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      };
    });

    expect(metrics.layoutTop).toBeCloseTo(metrics.barHeight, 0);
    expect(metrics.layoutBottom).toBeCloseTo(metrics.viewport, 0);
    // The document itself must not scroll at all.
    expect(metrics.scrollable).toBeLessThanOrEqual(0);
  });

  test("the left nav's first item is fully below the titlebar", async () => {
    const clipped = await window.evaluate(() => {
      const bar = document.querySelector(".titlebar").getBoundingClientRect();
      const first = document.querySelector(".leftnav__item").getBoundingClientRect();
      return first.top < bar.bottom;
    });
    expect(clipped).toBe(false);
  });
});
