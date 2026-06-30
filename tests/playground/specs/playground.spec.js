const { test, expect } = require("playwright/test");

// In Vite dev mode the root is src/renderer which serves index.html (desktop).
// The web playground entry is index.generated.html (produced by gen:web-html).
const ENTRY = "/index.generated.html";

// .web-topbar is injected by initWebChrome() after the renderer's async init()
// finishes (it waits for the profession list + nav). Give it room.
const READY_TIMEOUT = 20_000;
const HASH_TIMEOUT = 15_000;

// Pick a profession, then wait until the editor has actually loaded it (the async
// catalog fetch + render must finish before the build is encodable and the share
// hash can populate). The custom-select widget does not open under Playwright's
// synthetic mouse events, so drive it with DOM clicks — the renderer responds to
// them correctly (this test verifies our share/restore feature, not the picker).
async function pickCoreGuardian(page) {
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("#professionSelect button").click();
    await sleep(200);
    const portal = document.querySelector('[data-cselect-portal="1"]');
    const opt = [...(portal?.querySelectorAll(".cselect__option") || [])].find(
      (b) => b.textContent.trim() === "Core Guardian"
    );
    opt?.click();
  });
  // The trigger label reflects the picked profession once it loads into the editor.
  await expect(page.locator("#professionSelect button").first()).toContainText("Core Guardian", {
    timeout: READY_TIMEOUT,
  });
}

test("loads with web chrome", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(page.locator(".leftnav")).toBeHidden();
});

test("build -> share hash", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // The live hash sync (debounced edit events + a periodic convergence re-sync)
  // populates the share code once the build is encodable.
  await expect
    .poll(async () => (await page.evaluate(() => location.hash)).length, { timeout: HASH_TIMEOUT })
    .toBeGreaterThan(1);
});

test("reload restores the build", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  await expect
    .poll(async () => (await page.evaluate(() => location.hash)).length, { timeout: HASH_TIMEOUT })
    .toBeGreaterThan(1);
  const hash = await page.evaluate(() => location.hash);

  // Cold-load the captured share link. Navigate via about:blank first: going
  // straight to ENTRY+hash only changes the fragment of the current document
  // (no reload), so seedDraftFromHash would never re-run. about:blank forces a
  // full document load.
  await page.goto("about:blank");
  await page.goto(ENTRY + hash);
  await expect
    .poll(
      async () => page.evaluate(() => window.desktopApi.listBuilds().then((b) => b[0]?.profession)),
      { timeout: READY_TIMEOUT },
    )
    .toBe("Guardian");
});
