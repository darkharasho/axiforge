// The trash (v0.14.0) — deleting stages instead of destroys.
//
// Two properties are load-bearing and neither is obvious from the code:
//  - Delete no longer asks. The confirm was removed on purpose, because asking
//    the user to approve something that has not been destroyed is theatre; the
//    toast's Undo is the safety net instead. A regression that puts a modal back
//    would leave these specs hanging on a click that never lands.
//  - The only genuinely unrecoverable actions — Delete Permanently and Empty
//    Trash — DO still ask.

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

async function contextMenuClick(window, rowSelector, label) {
  await window.locator(rowSelector).first().click({ button: "right" });
  const menu = window.locator(".lib-ctx-menu").first();
  await expect(menu).toBeVisible();
  await menu.locator(".lib-ctx-item__label").filter({ hasText: new RegExp(`^${label}$`) }).first().click();
  await window.waitForTimeout(400);
}

async function openTrash(window) {
  await window.locator("[data-navigate-trash]").click();
  await window.waitForTimeout(300);
}

async function confirmModal(window) {
  const btn = window.locator("#cm-confirm");
  await btn.waitFor({ state: "visible", timeout: 3_000 });
  await btn.click();
  await window.waitForTimeout(400);
}

const trashNav = (window) => window.locator("[data-navigate-trash]");
const trashRows = (window) => window.locator("[data-trash-row]");

// ─── Deleting a build ─────────────────────────────────────────────────────────

test.describe("Trash — deleting stages a build", () => {
  let app, window;
  const doomed = makeTestBuild({ title: "Doomed Build", profession: "Elementalist" });
  const spared = makeTestBuild({ title: "Spared Build", profession: "Warrior" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(doomed);
    seedBuildFile(spared);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("Delete takes effect with no confirm, and says where the build went", async () => {
    await contextMenuClick(window, `[data-build-id="${doomed.id}"]`, "Delete");

    // No modal: if one appears the delete has silently become blocking again.
    // The confirm modal's markup is static in index.html, so the signal is
    // visibility, not presence.
    await expect(window.locator("#cm-confirm")).toBeHidden();
    await expect(window.locator(`[data-build-id="${doomed.id}"]`)).toHaveCount(0);

    const toast = window.locator(".lib-toast--visible");
    await expect(toast).toContainText("Moved 1 build to Trash");
    await expect(toast.locator(".lib-toast__action")).toHaveText("Undo");
    await expect(trashNav(window).locator(".lib-nav-item__count")).toHaveText("1");
  });

  test("the breadcrumb says you are in the Trash", async () => {
    await openTrash(window);
    await expect(window.locator(".lib-breadcrumb__item--current")).toHaveText("Trash");
  });

  test("the inert toolbar controls are gone here too", async () => {
    await openTrash(window);
    for (const sel of ["#lib-search-input", "#lib-sort-select", "#lib-new-btn", "#lib-import-btn"]) {
      await expect(window.locator(sel)).toHaveCount(0);
    }
    await expect(window.locator("[data-navigate-root]")).toBeVisible();
  });

  test("the trash view counts down the retention window and offers both actions", async () => {
    await openTrash(window);
    await expect(trashRows(window)).toHaveCount(1);

    const row = trashRows(window).first();
    await expect(row.locator(".lib-trash__name")).toHaveText("Doomed Build");
    // 30-day retention, so a just-deleted item shows the full window.
    await expect(row.locator(".lib-trash__meta")).toContainText("30 days left");
    await expect(row.locator("[data-trash-restore]")).toHaveText("Put Back");
    await expect(row.locator("[data-trash-purge]")).toHaveText("Delete Permanently");
    await expect(window.locator("[data-trash-empty]")).toBeVisible();
  });

  test("Put Back returns the build to the library", async () => {
    await trashRows(window).first().locator("[data-trash-restore]").click();
    await window.waitForTimeout(500);

    await expect(window.locator(".lib-trash--empty")).toBeVisible();
    await expect(trashNav(window).locator(".lib-nav-item__count")).toHaveCount(0);

    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator(`[data-build-id="${doomed.id}"]`)).toBeVisible();
    await expect(window.locator(`[data-build-id="${spared.id}"]`)).toBeVisible();
  });

  test("Undo in the toast is an equivalent path back", async () => {
    await contextMenuClick(window, `[data-build-id="${doomed.id}"]`, "Delete");
    await window.locator(".lib-toast--visible .lib-toast__action").click();
    await window.waitForTimeout(600);

    await expect(window.locator(`[data-build-id="${doomed.id}"]`)).toBeVisible();
    await expect(trashNav(window).locator(".lib-nav-item__count")).toHaveCount(0);
  });
});

// ─── The unrecoverable actions ────────────────────────────────────────────────

test.describe("Trash — the actions that really are final still ask", () => {
  let app, window;
  const a = makeTestBuild({ title: "Purge Me", profession: "Thief" });
  const b = makeTestBuild({ title: "Empty Me", profession: "Ranger" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(a);
    seedBuildFile(b);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("Delete Permanently confirms, then the record is gone from the store", async () => {
    await contextMenuClick(window, `[data-build-id="${a.id}"]`, "Delete");
    await openTrash(window);

    await trashRows(window).first().locator("[data-trash-purge]").click();
    await expect(window.locator("#cm-confirm")).toBeVisible();
    await confirmModal(window);

    await expect(window.locator(".lib-trash--empty")).toBeVisible();
    const stillThere = await window.evaluate(
      async (id) => (await desktopApi.listBuilds()).some((x) => x.id === id),
      a.id
    );
    expect(stillThere).toBe(false);
  });

  test("cancelling Delete Permanently leaves the item in the trash", async () => {
    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await contextMenuClick(window, `[data-build-id="${b.id}"]`, "Delete");
    await openTrash(window);

    await trashRows(window).first().locator("[data-trash-purge]").click();
    await window.locator("#cm-cancel").click();
    await window.waitForTimeout(400);
    await expect(trashRows(window)).toHaveCount(1);
  });

  test("Empty Trash confirms, then clears everything", async () => {
    await window.locator("[data-trash-empty]").click();
    await expect(window.locator("#cm-confirm")).toBeVisible();
    await confirmModal(window);

    await expect(window.locator(".lib-trash--empty")).toBeVisible();
    await expect(trashNav(window).locator(".lib-nav-item__count")).toHaveCount(0);
  });
});

// ─── Folders and comps ────────────────────────────────────────────────────────

test.describe("Trash — a folder goes in as one batch", () => {
  let app, window;
  const folder = makeTestFolder({ name: "Doomed Folder" });
  const inside = makeTestBuild({ title: "Folder Build", profession: "Guardian", folderId: folder.id });
  const comp = makeTestComp({ name: "Doomed Comp" });

  test.beforeAll(async () => {
    cleanDataDir();
    seedFolderFile(folder);
    seedBuildFile(inside);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("deleting a folder stages one row, not one per build inside", async () => {
    await contextMenuClick(window, `#lib-content [data-folder-id="${folder.id}"]`, "Delete Folder");
    await expect(window.locator(`[data-folder-id="${folder.id}"]`)).toHaveCount(0);

    await openTrash(window);
    await expect(trashRows(window)).toHaveCount(1);
    const row = trashRows(window).first();
    await expect(row).toHaveAttribute("data-trash-type", "folder");
    await expect(row.locator(".lib-trash__meta")).toContainText("Folder, with everything inside it");
  });

  test("putting the folder back brings its builds back inside it", async () => {
    await trashRows(window).first().locator("[data-trash-restore]").click();
    await window.waitForTimeout(600);

    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await window.locator(`#lib-content [data-folder-id="${folder.id}"]`).dblclick();
    await window.waitForTimeout(400);
    await expect(window.locator(`[data-build-id="${inside.id}"]`)).toBeVisible();
  });

  test("a comp can be deleted and restored the same way", async () => {
    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await contextMenuClick(window, `[data-comp-id="${comp.id}"]`, "Delete");
    await expect(window.locator(`[data-comp-id="${comp.id}"]`)).toHaveCount(0);

    await openTrash(window);
    const compRow = window.locator('[data-trash-row][data-trash-type="comp"]');
    await expect(compRow).toHaveCount(1);
    await compRow.locator("[data-trash-restore]").click();
    await window.waitForTimeout(500);

    await window.locator("[data-navigate-root]").first().click();
    await window.waitForTimeout(300);
    await expect(window.locator(`[data-comp-id="${comp.id}"]`)).toBeVisible();
  });
});
