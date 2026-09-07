// Build history + the v2 compare modal.
//
// Comps got their own history in tests/e2e/specs/comp-history.spec.js; this
// covers the build side of the same v2 machinery, plus the thing neither of
// those specs exercised: the side-by-side compare modal
// (src/renderer/modules/library/history-compare.js) that a click on any
// history entry opens.
//
// Same conventions as comp-history.spec.js: one Electron instance for the
// whole file, edits go straight through desktopApi (the IPC boundary is what
// matters here — the summarising and storage are covered far more cheaply in
// tests/unit/history/*.test.js and tests/unit/historyStore.test.js), and a
// window.reload() sits between an IPC-only edit and the first UI interaction
// that depends on it, because those edits never touch the renderer's `state`.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile } = require("../helpers/data");
const { makeTestBuild } = require("../helpers/builds");

// The rune slot the UI calls "helm" is stored under `equipment.runes.head` —
// the history summariser deliberately still calls it "head" (see the note at
// the top of src/main/history/renderSummary.js), so assertions below check
// for "head rune:", not "helm rune:".
const build = makeTestBuild({
  title: "Compare Test Build",
  profession: "Warrior",
  equipment: {
    statPackage: "",
    relic: "",
    food: "",
    utility: "",
    slots: {},
    weapons: {},
    // Present on both sides of the edit (empty string is a real, if bare,
    // rune-name) so the compare modal's hidden highlight anchor for
    // head/rune exists in BOTH reconstructed documents — an absent key would
    // render no anchor at all on the "before" card.
    runes: { head: "Superior Rune of the Scholar" },
    sigils: {},
    infusions: {},
    enrichment: "",
  },
});

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

async function reloadAndOpenLibrary(window) {
  // The edits below go straight through desktopApi, so the renderer's
  // state.builds still holds the pre-edit copy and the library/panel would
  // title or list itself from that. Reload so state matches disk.
  await window.reload();
  await window.waitForFunction(
    () => document.querySelectorAll("#professionSelect .cselect__option").length > 0,
    null,
    { timeout: 30_000 }
  );
  await goToLibrary(window);
}

test.describe("Build history + compare", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(build);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("saving a build twice records the rune change, not a generic update", async () => {
    // First save: nothing has changed since the seed, but this is the FIRST
    // time this build has ever gone through the IPC boundary, so it becomes
    // the origin keyframe (v1) regardless — see historyStore.js's `!last`
    // branch, which always writes v1 for a record with no history yet.
    await window.evaluate(async (id) => {
      const b = (await desktopApi.listBuilds()).find((x) => x.id === id);
      await desktopApi.saveBuild(b);
    }, build.id);
    await window.waitForTimeout(500);

    // Second save: an actual edit, so it becomes v2.
    await window.evaluate(async (id) => {
      const b = (await desktopApi.listBuilds()).find((x) => x.id === id);
      await desktopApi.saveBuild({
        ...b,
        equipment: { ...b.equipment, runes: { ...b.equipment.runes, head: "Superior Rune of Durability" } },
      });
    }, build.id);
    await window.waitForTimeout(500);

    const { versions } = await window.evaluate((id) => desktopApi.getBuildHistory(id), build.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].v).toBe(2);
    expect(versions[0].summary).toContain("head rune:");
    expect(versions[0].summary).toContain("Superior Rune of the Scholar");
    expect(versions[0].summary).toContain("Superior Rune of Durability");
    // "build updated" is v1's fallback string and is not a reachable output
    // of the v2 renderer (src/main/history/renderSummary.js) at all.
    expect(versions[0].summary).not.toBe("build updated");
  });

  test("right-click → View History shows two entries, the newest a rune change", async () => {
    await reloadAndOpenLibrary(window);

    await window.locator(`[data-build-id="${build.id}"]`).first().click({ button: "right" });
    await window
      .locator(".lib-ctx-menu .lib-ctx-item__label")
      .filter({ hasText: /^View History$/ })
      .first()
      .click();

    const panel = window.locator(".history-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator(".history-panel__entry")).toHaveCount(2);

    const newestSummary = await panel.locator(".history-panel__entry-summary").first().textContent();
    expect(newestSummary).toContain("head rune:");
    expect(newestSummary).not.toBe("build updated");
  });

  test("clicking the newest entry opens the compare modal with two cards", async () => {
    const panel = window.locator(".history-panel");
    await panel.locator(".history-panel__entry").first().locator(".history-panel__entry-body").click();

    const modal = window.locator(".hist-compare");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".hist-compare__col")).toHaveCount(2);
  });

  test("the changed rune is outlined in both columns", async () => {
    const modal = window.locator(".hist-compare");
    await expect(modal.locator(".hist-compare__col--left .hist-changed")).toHaveCount(1);
    await expect(modal.locator(".hist-compare__col--right .hist-changed")).toHaveCount(1);
  });

  test("the change table has exactly one row naming both runes", async () => {
    const modal = window.locator(".hist-compare");
    const rows = modal.locator("[data-hist-row]");
    await expect(rows).toHaveCount(1);
    const text = await rows.first().textContent();
    expect(text).toContain("Superior Rune of the Scholar");
    expect(text).toContain("Superior Rune of Durability");
  });

  test("switching the right picker to Current re-renders without error", async () => {
    const modal = window.locator(".hist-compare");
    await modal.locator(".hist-compare__pick--right").selectOption("current");

    await expect(modal.locator(".hist-compare__col--right .hist-compare__col-title")).toHaveText("Current");
    await expect(modal.locator(".hist-compare__cols")).toBeVisible();
    const bodyText = await modal.locator(".hist-compare__body").textContent();
    expect(bodyText).not.toContain("Could not load");
  });

  test("Restore this version returns the build to the original rune and logs a revert", async () => {
    const modal = window.locator(".hist-compare");
    // Move the left picker back to v1 — the state before the rune change —
    // so the footer's restore button targets it.
    await modal.locator(".hist-compare__pick--left").selectOption("1");
    await expect(modal.locator(".hist-compare__col--left .hist-compare__col-title")).toHaveText("v1");

    await modal.locator(".hist-compare__restore").click();
    await modal.locator(".hist-compare__confirm-yes").click();
    await window.waitForTimeout(600);

    // Both the compare modal and the history panel it was opened from close
    // on a successful restore (onRestored === closeHistoryPanel).
    await expect(window.locator(".hist-compare")).toHaveCount(0);
    await expect(window.locator(".history-panel")).toHaveCount(0);

    const restored = await window.evaluate(
      async (id) => (await desktopApi.listBuilds()).find((b) => b.id === id),
      build.id
    );
    expect(restored.equipment.runes.head).toBe("Superior Rune of the Scholar");

    const { versions } = await window.evaluate((id) => desktopApi.getBuildHistory(id), build.id);
    expect(versions[0].v).toBe(3);
    expect(versions[0].source).toBe("revert");
  });

  test("editing a build twice within the coalesce window produces one entry, not two", async () => {
    const coalesceBuild = makeTestBuild({ title: "Coalesce Test Build", profession: "Guardian" });

    // v1: origin keyframe.
    await window.evaluate(async (b) => { await desktopApi.saveBuild(b); }, coalesceBuild);
    await window.waitForTimeout(300);

    // v2: the FIRST edit after v1 always becomes its own version — coalescing
    // into v1 is blocked on purpose (it is the record's origin keyframe; see
    // the `last.v > 1` guard in historyStore.js).
    await window.evaluate(async (id) => {
      const b = (await desktopApi.listBuilds()).find((x) => x.id === id);
      await desktopApi.saveBuild({ ...b, notes: "first edit" });
    }, coalesceBuild.id);
    await window.waitForTimeout(300);

    // A second edit by the same author/source, moments later: inside the
    // 5-minute coalesce window, so it merges into v2 instead of becoming v3.
    await window.evaluate(async (id) => {
      const b = (await desktopApi.listBuilds()).find((x) => x.id === id);
      await desktopApi.saveBuild({ ...b, notes: "second edit" });
    }, coalesceBuild.id);
    await window.waitForTimeout(500);

    const { versions } = await window.evaluate((id) => desktopApi.getBuildHistory(id), coalesceBuild.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].v).toBe(2);
  });
});
