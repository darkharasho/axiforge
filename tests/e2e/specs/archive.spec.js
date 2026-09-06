// The archive (v0.16.0) — putting something away without deleting it.
//
// The point of these specs is the distinction the feature exists for: an
// archived record is LIVE. It leaves the browsing views and nothing else about
// it changes — comps still resolve it, it never expires, and it never touches
// the trash. Tests that only checked "it disappeared from the list" would pass
// just as happily against a delete, which is exactly the bug the archive was
// added to stop people from committing by hand.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile, seedCompFile, seedFolderFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp, makeTestFolder } = require("../helpers/builds");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

/**
 * Right-click a row and click a menu entry by its exact label.
 *
 * Exact matching matters here: "Archive" is a prefix of "Archive Folder" and
 * "Archive 2 Builds", so a hasText match would silently pick whichever the DOM
 * happened to order first.
 */
async function contextMenuClick(window, rowSelector, label) {
  await window.locator(rowSelector).first().click({ button: "right" });
  const menu = window.locator(".lib-ctx-menu").first();
  await expect(menu).toBeVisible();
  await menu.locator(".lib-ctx-item__label").filter({ hasText: new RegExp(`^${label}$`) }).first().click();
  await window.waitForTimeout(400);
}

async function openArchive(window) {
  await window.locator("[data-navigate-archive]").click();
  await window.waitForTimeout(300);
}

const archiveNav = (window) => window.locator("[data-navigate-archive]");
const archiveRows = (window) => window.locator("[data-archive-row]");
const trashNav = (window) => window.locator("[data-navigate-trash]");

// ─── Archiving a build ────────────────────────────────────────────────────────

test.describe("Archive — builds", () => {
  let app, window;
  const keeper = makeTestBuild({ title: "Keeper Build", profession: "Warrior" });
  const shelved = makeTestBuild({ title: "Shelved Build", profession: "Necromancer" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(keeper);
    seedBuildFile(shelved);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("the Archive nav is hidden until something is archived", async () => {
    // Deliberately unlike the Trash, which is always present: an empty archive
    // is a feature the user has not met yet, not a place they expect to find.
    await expect(archiveNav(window)).toHaveCount(0);
    await expect(trashNav(window)).toBeVisible();
  });

  test("Archive removes the build from the library and reveals the nav with a count", async () => {
    await contextMenuClick(window, `[data-build-id="${shelved.id}"]`, "Archive");

    await expect(window.locator(`[data-build-id="${shelved.id}"]`)).toHaveCount(0);
    await expect(window.locator(`[data-build-id="${keeper.id}"]`)).toBeVisible();
    await expect(archiveNav(window)).toBeVisible();
    await expect(archiveNav(window).locator(".lib-nav-item__count")).toHaveText("1");
  });

  test("archiving is not deleting — the trash stays empty", async () => {
    // The whole reason the archive exists. If this ever fails, an archive has
    // quietly become a 30-day-countdown delete.
    await expect(trashNav(window).locator(".lib-nav-item__count")).toHaveCount(0);
    const trashed = await window.evaluate(() => desktopApi.listTrash());
    expect(trashed).toEqual([]);
  });

  test("the archived build is still a live record in the store", async () => {
    const found = await window.evaluate(
      async (id) => (await desktopApi.listBuilds()).find((b) => b.id === id) || null,
      shelved.id
    );
    expect(found).not.toBeNull();
    expect(found.title).toBe("Shelved Build");
    // Filtering happens in the renderer's browsing views, never in the store —
    // see the archive commit's note about ~100 call sites in sync/publish.
    expect(found.archivedAt).toBeTruthy();
  });

  test("the breadcrumb says you are in the Archive, not at the library root", async () => {
    await openArchive(window);
    // It used to fall through to the generic tail and render only "All Builds",
    // so the header claimed you were at the root while the pane showed the
    // archive.
    await expect(window.locator(".lib-breadcrumb__item--current")).toHaveText("Archive");
  });

  test("the inert toolbar controls are gone — only the breadcrumb remains", async () => {
    await openArchive(window);
    // Every one of these acts on a list the archive does not draw: search
    // filtered nothing, sort reordered nothing, the view toggle switched between
    // renderers that never run, and New/Import/Export targeted the library you
    // had just navigated away from. Typing in the search box was the worst of
    // them — it set state.buildSearch with no visible effect here, then the
    // library came back filtered for no apparent reason.
    await expect(window.locator("#lib-search-input")).toHaveCount(0);
    await expect(window.locator("#lib-sort-select")).toHaveCount(0);
    await expect(window.locator(".lib-toolbar__view-toggle")).toHaveCount(0);
    await expect(window.locator("#lib-new-btn")).toHaveCount(0);
    await expect(window.locator("#lib-import-btn")).toHaveCount(0);
    await expect(window.locator("#lib-export-btn")).toHaveCount(0);
    await expect(window.locator("#lib-filters .lib-fd")).toHaveCount(0);

    // The breadcrumb stays: it is the way back out.
    await expect(window.locator("[data-navigate-root]")).toBeVisible();
  });

  test("they come back when you leave", async () => {
    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator("#lib-search-input")).toBeVisible();
    await expect(window.locator("#lib-new-btn")).toBeVisible();
  });

  test("the archive view lists it with Open and Unarchive, and no destructive action", async () => {
    await openArchive(window);
    await expect(archiveRows(window)).toHaveCount(1);

    const row = archiveRows(window).first();
    await expect(row.locator(".lib-archive__name")).toHaveText("Shelved Build");
    await expect(row.locator(".lib-archive__meta")).toContainText("Necromancer");
    await expect(row.locator("[data-archive-open]")).toBeVisible();
    await expect(row.locator("[data-archive-restore]")).toHaveText("Unarchive");
    // Nothing in the archive is on its way out, so nothing here may destroy.
    await expect(row.locator(".lib-archive__btn--danger")).toHaveCount(0);
    await expect(window.locator("[data-trash-purge], [data-trash-empty]")).toHaveCount(0);
  });

  test("Open loads an archived build straight into the editor, leaving it archived", async () => {
    await archiveRows(window).first().locator("[data-archive-open]").click();
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 5_000 });
    await expect(window.locator("#editorTitle")).toHaveValue("Shelved Build");

    await goToLibrary(window);
    await openArchive(window);
    await expect(archiveRows(window)).toHaveCount(1);
  });

  test("Unarchive puts it back in the library and empties the archive", async () => {
    await archiveRows(window).first().locator("[data-archive-restore]").click();
    await window.waitForTimeout(500);

    // Still on the archive view, which must show its empty state rather than a
    // blank pane once the last row leaves.
    await expect(window.locator(".lib-archive--empty")).toBeVisible();

    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator(`[data-build-id="${shelved.id}"]`)).toBeVisible();
  });
});

// ─── Undo ─────────────────────────────────────────────────────────────────────

test.describe("Archive — undo", () => {
  let app, window;
  const build = makeTestBuild({ title: "Undo Me", profession: "Guardian" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(build);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("the toast offers Undo, and Undo brings the build straight back", async () => {
    await contextMenuClick(window, `[data-build-id="${build.id}"]`, "Archive");

    const toast = window.locator(".lib-toast--visible");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Archived 1 build");

    // The toast IS the discovery mechanism for the undo stack — if the button
    // stops appearing, undo becomes invisible again.
    const undo = toast.locator(".lib-toast__action");
    await expect(undo).toHaveText("Undo");
    await undo.click();
    await window.waitForTimeout(600);

    await expect(window.locator(`[data-build-id="${build.id}"]`)).toBeVisible();
    await expect(archiveNav(window)).toHaveCount(0);
  });
});

// ─── Comps ────────────────────────────────────────────────────────────────────

test.describe("Archive — comps keep resolving archived builds", () => {
  let app, window;
  const memberA = makeTestBuild({ title: "Comp Member A", profession: "Warrior" });
  const memberB = makeTestBuild({ title: "Comp Member B", profession: "Mesmer" });
  const comp = makeTestComp({
    name: "Squad Comp",
    buildIds: [memberA.id, memberB.id],
    partyLines: [{ id: "pl-1", capacity: 5, slots: [memberA.id, memberB.id] }],
  });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(memberA);
    seedBuildFile(memberB);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("archiving a build a comp uses does not gut the comp", async () => {
    await contextMenuClick(window, `[data-build-id="${memberA.id}"]`, "Archive");
    await expect(window.locator(`[data-build-id="${memberA.id}"]`)).toHaveCount(0);

    // Views that RESOLVE a record by id deliberately do not filter — the comp
    // editor is the headline case. A regression here would show the user an
    // empty party slot beside a build that still exists.
    const stored = await window.evaluate(
      async (id) => (await desktopApi.listComps()).find((c) => c.id === id),
      comp.id
    );
    expect(stored.buildIds).toContain(memberA.id);
    expect(stored.partyLines[0].slots).toContain(memberA.id);

    await window.click('.leftnav__item[data-page="comps"]');
    await window.locator(".comp-list-row[data-comp-id]").first().click();
    await window.waitForSelector(".comp-detail", { timeout: 5_000 });
    await window.waitForTimeout(400);
    await expect(window.locator(".comp-detail")).toContainText("Comp Member A");
  });

  test("a comp itself can be archived and brought back", async () => {
    await goToLibrary(window);
    await contextMenuClick(window, `[data-comp-id="${comp.id}"]`, "Archive");
    await expect(window.locator(`[data-comp-id="${comp.id}"]`)).toHaveCount(0);

    await openArchive(window);
    const compRow = window.locator('[data-archive-row][data-archive-type="comp"]');
    await expect(compRow).toHaveCount(1);
    await expect(compRow.locator(".lib-archive__meta")).toContainText("Comp");

    await compRow.locator("[data-archive-restore]").click();
    await window.waitForTimeout(500);
    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator(`[data-comp-id="${comp.id}"]`)).toBeVisible();
  });
});

// ─── Folders ──────────────────────────────────────────────────────────────────

test.describe("Archive — folders take their contents with them", () => {
  let app, window;
  const folder = makeTestFolder({ name: "Old Season" });
  const inside = makeTestBuild({ title: "Inside Build", profession: "Thief", folderId: folder.id });
  const outside = makeTestBuild({ title: "Outside Build", profession: "Ranger" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedFolderFile(folder);
    seedBuildFile(inside);
    seedBuildFile(outside);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("Archive Folder hides the folder and everything in it", async () => {
    await contextMenuClick(window, `#lib-content [data-folder-id="${folder.id}"]`, "Archive Folder");

    await expect(window.locator(`[data-folder-id="${folder.id}"]`)).toHaveCount(0);
    await expect(window.locator(`[data-build-id="${outside.id}"]`)).toBeVisible();

    // Archiving a folder without its builds would strand them: live records in
    // a folder nothing draws any more.
    const stillInFolder = await window.evaluate(
      async (id) => (await desktopApi.listBuilds()).find((b) => b.id === id)?.archivedAt || null,
      inside.id
    );
    expect(stillInFolder).toBeTruthy();
  });

  test("the folder stands in for its whole subtree — one row, no Open", async () => {
    await openArchive(window);
    await expect(archiveRows(window)).toHaveCount(1);

    const row = archiveRows(window).first();
    await expect(row).toHaveAttribute("data-archive-type", "folder");
    await expect(row.locator(".lib-archive__meta")).toContainText("Folder, with everything inside it");
    // There is nothing sensible to open for a subtree, so the button is absent.
    await expect(row.locator("[data-archive-open]")).toHaveCount(0);
  });

  test("Unarchive brings the whole batch back together", async () => {
    await archiveRows(window).first().locator("[data-archive-restore]").click();
    await window.waitForTimeout(600);

    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator(`#lib-content [data-folder-id="${folder.id}"]`)).toBeVisible();

    await window.locator(`#lib-content [data-folder-id="${folder.id}"]`).dblclick();
    await window.waitForTimeout(400);
    await expect(window.locator(`[data-build-id="${inside.id}"]`)).toBeVisible();
  });
});
