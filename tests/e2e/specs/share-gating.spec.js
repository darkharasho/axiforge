// Share gating — you cannot hand out a link to something that isn't published,
// or to a version that no longer matches what you're looking at.
//
// The predicate itself lives in two places on purpose (src/shared/publishState.js
// for main, src/renderer/modules/share-gate.js for the renderer) and a unit test
// locks them in sync. What no unit test covers is whether the three surfaces that
// are supposed to CONSULT it actually do: the editor's Share dropdown, the
// library's right-click Share to Discord submenu, and the comp detail's Share
// dropdown. Each wires the tooltip up by hand, so each can drift on its own.
//
// A build with `publishedAt !== updatedAt` is the stale case: published once,
// edited since. That is the state that quietly ships a teammate the wrong build.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp } = require("../helpers/builds");

const PUBLISHED = {
  publishedFileId: "abc123",
  publishedKey: "k".repeat(43),
  publishedSlug: "test-build",
};

// Same instant on both stamps = published exactly as it stands now.
const CLEAN_AT = "2026-03-01T12:00:00.000Z";
// Edited after the last publish.
const STALE_UPDATED = "2026-03-02T12:00:00.000Z";

const unpublished = makeTestBuild({ title: "Never Published", profession: "Warrior" });
const clean = makeTestBuild({
  title: "Published Clean",
  profession: "Necromancer",
  ...PUBLISHED,
  publishedAt: CLEAN_AT,
  updatedAt: CLEAN_AT,
});
const stale = makeTestBuild({
  title: "Published Stale",
  profession: "Mesmer",
  ...PUBLISHED,
  publishedAt: CLEAN_AT,
  updatedAt: STALE_UPDATED,
});

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

/** Open a build's right-click menu and hover into "Share to Discord". */
async function openShareSubmenu(window, buildId) {
  await window.locator(`[data-build-id="${buildId}"]`).first().click({ button: "right" });
  const menu = window.locator(".lib-ctx-menu").first();
  await expect(menu).toBeVisible();
  await menu.locator(".lib-ctx-item__label", { hasText: "Share to Discord" }).first().hover();
  await window.waitForTimeout(300);
  return window.locator(".lib-ctx-menu").last();
}

async function closeMenus(window) {
  await window.keyboard.press("Escape");
  await window.waitForTimeout(200);
}

// ─── The library's right-click Share submenu ──────────────────────────────────

test.describe("Share gating — library context menu", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(unpublished);
    seedBuildFile(clean);
    seedBuildFile(stale);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("an unpublished build cannot be shared, and says why", async () => {
    const submenu = await openShareSubmenu(window, unpublished.id);
    const copy = submenu.locator(".lib-ctx-item", { hasText: "Copy Link" }).first();
    await expect(copy).toHaveClass(/lib-ctx-item--disabled/);
    await expect(copy).toHaveAttribute("title", "Publish this build first");
    await closeMenus(window);
  });

  test("a build published and then edited says the changes are the problem", async () => {
    // Not "publish this first" — it HAS been published. Getting this message
    // wrong is what sends someone off to look for a Publish button they already
    // used.
    const submenu = await openShareSubmenu(window, stale.id);
    const embed = submenu.locator(".lib-ctx-item", { hasText: "Discord Embed" }).first();
    await expect(embed).toHaveClass(/lib-ctx-item--disabled/);
    await expect(embed).toHaveAttribute("title", "Publish your latest changes first");
    await closeMenus(window);
  });

  test("a build published exactly as it stands is shareable", async () => {
    const submenu = await openShareSubmenu(window, clean.id);
    for (const label of ["Copy Link", "Discord Embed"]) {
      const item = submenu.locator(".lib-ctx-item", { hasText: label }).first();
      await expect(item).not.toHaveClass(/lib-ctx-item--disabled/);
      await expect(item).not.toHaveAttribute("title", /Publish/);
    }
    await closeMenus(window);
  });
});

// ─── The editor's Share dropdown ──────────────────────────────────────────────

test.describe("Share gating — editor Share dropdown", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(unpublished);
    seedBuildFile(clean);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  async function loadBuild(window, id) {
    await goToLibrary(window);
    await window.locator(`[data-build-id="${id}"]`).first().dblclick();
    await window.waitForSelector("#page-editor:not(.hidden)", { timeout: 5_000 });
    await window.waitForTimeout(500);
  }

  test("an unpublished build disables Discord Copy, Embed and Published Link", async () => {
    await loadBuild(window, unpublished.id);
    for (const action of ["discord-copy", "discord-embed"]) {
      const btn = window.locator(`#editorShareDropdown [data-action='${action}']`);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute("title", "Publish this build first");
    }
    await expect(window.locator("#editorShareDropdown [data-action='copy-published-link']")).toBeDisabled();
  });

  test("Chat Link and AxiCode stay available regardless — they need no publish", async () => {
    // These encode the build itself rather than pointing at a hosted copy, so
    // gating them would be gating the offline path on a network feature.
    for (const action of ["copy-chat-link", "copy-axicode"]) {
      await expect(window.locator(`#editorShareDropdown [data-action='${action}']`)).toBeEnabled();
    }
  });

  test("a published, unedited build enables the Discord actions", async () => {
    await loadBuild(window, clean.id);
    for (const action of ["discord-copy", "discord-embed"]) {
      await expect(window.locator(`#editorShareDropdown [data-action='${action}']`)).toBeEnabled();
    }
  });

  test("editing in the editor re-gates them before the change is published", async () => {
    // The dirty editor is the case the build record cannot see: updatedAt is
    // still equal to publishedAt on disk, and only `state.editorDirty` knows the
    // user has typed since.
    await window.fill("#editorTitle", "Published Clean edited");
    await window.waitForTimeout(600);
    for (const action of ["discord-copy", "discord-embed"]) {
      const btn = window.locator(`#editorShareDropdown [data-action='${action}']`);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute("title", "Publish your latest changes first");
    }
  });
});

// ─── The comp detail's Share dropdown ─────────────────────────────────────────

test.describe("Share gating — comp Share dropdown", () => {
  let app, window;

  const unpublishedComp = makeTestComp({ name: "Unpublished Comp" });
  const publishedComp = makeTestComp({
    name: "Published Comp",
    publishedFileId: "def456",
    publishedKey: "k".repeat(43),
    publishedSlug: "published-comp",
    publishedAt: CLEAN_AT,
    updatedAt: CLEAN_AT,
  });

  test.beforeAll(async () => {
    cleanDataDir();
    seedCompFile(unpublishedComp);
    seedCompFile(publishedComp);
    ({ app, window } = await launchApp({ clean: false }));
  });

  test.afterAll(async () => closeApp(app));

  async function openComp(window, name) {
    await window.click('.leftnav__item[data-page="comps"]');
    // The comps page remembers the comp it had open, so clicking the nav item
    // lands on the detail view, not the list. Back out first or the row we want
    // simply is not on screen.
    const back = window.locator(".comp-detail__back-btn");
    if (await back.count()) {
      await back.first().click();
      await window.waitForTimeout(300);
    }
    // Match the name element with an anchored regex, not the whole row with a
    // bare string: Playwright's hasText is a case-insensitive SUBSTRING match,
    // so "Published Comp" also selects "Unpublished Comp" — and .first() then
    // opens whichever the list happens to order first.
    await window
      .locator(".comp-list-row__name")
      .filter({ hasText: new RegExp(`^${name}$`) })
      .first()
      .click();
    await window.waitForSelector(".comp-detail", { timeout: 5_000 });
    await window.waitForTimeout(400);
  }

  test("an unpublished comp disables the Discord entries but keeps AxiCode", async () => {
    await openComp(window, "Unpublished Comp");
    for (const action of ["share-discord", "copy-plaintext"]) {
      const btn = window.locator(`.comp-share-dropdown__item[data-action='${action}']`);
      await expect(btn).toBeDisabled();
      await expect(btn).toHaveAttribute("title", "Publish this comp first");
    }
    await expect(window.locator(".comp-share-dropdown__item[data-action='copy-share-code']")).toBeEnabled();
  });

  test("a published comp enables them", async () => {
    await openComp(window, "Published Comp");
    for (const action of ["share-discord", "copy-plaintext"]) {
      await expect(window.locator(`.comp-share-dropdown__item[data-action='${action}']`)).toBeEnabled();
    }
  });
});
