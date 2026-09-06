// Importing a published AxiForge link (v0.15.0 for builds, v0.16.0 for comps).
//
// tests/unit/axiLinkImport.test.js already covers the parsing and the id
// remapping with an injected fetch. What it cannot cover is the half that
// actually loses user data when it breaks: the real HTTP fetch, the main-process
// handler that WRITES the comp, its builds and their new folder, and the
// renderer branch that has to reload three collections afterwards. That is what
// runs here, against a stand-in "published site" serving real encrypted payloads
// produced by the same publish + encrypt code the app ships.

const http = require("http");
const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { makeTestBuild, makeTestComp } = require("../helpers/builds");
const { generateBuildPayload, generateCompPayload } = require("../../spa/helpers/fixture-gen");
const { openFirstComp } = require("../helpers/comps");
const { publishPort } = require("../helpers/ports");

// ─── A stand-in for the published GitHub Pages site ───────────────────────────

// Per worker: a fixed port here collided with another worker's sync server the
// moment the suite went parallel, and took that worker down with it.
const PUB_PORT = publishPort();
/** @type {Map<string, string>} pathname → body */
const published = new Map();
let pubServer;

function publishBuild(build) {
  const { fileId, encKey, base64Payload } = generateBuildPayload(build);
  published.set(`/axibuilds/builds/${fileId}.enc`, base64Payload);
  return `http://localhost:${PUB_PORT}/axibuilds/?n=test&b=${fileId}.${encKey}`;
}

function publishComp(comp, builds) {
  const { fileId, encKey, base64Payload } = generateCompPayload(comp, builds);
  published.set(`/axibuilds/comps/${fileId}.enc`, base64Payload);
  return `http://localhost:${PUB_PORT}/axibuilds/?n=test&c=${fileId}.${encKey}`;
}

test.beforeAll(async () => {
  await new Promise((resolve, reject) => {
    pubServer = http.createServer((req, res) => {
      const body = published.get(new URL(req.url, "http://x").pathname);
      if (body === undefined) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(body);
    });
    pubServer.listen(PUB_PORT, resolve);
    pubServer.on("error", reject);
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => (pubServer ? pubServer.close(resolve) : resolve()));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

/** Open Import → AxiForge Link and type a link, without submitting. */
async function openImportModal(window, link) {
  await window.click("#lib-import-btn");
  await window.click('[data-import-type="axilink"]');
  await window.waitForSelector("#axilink-url-input", { timeout: 5_000 });
  await window.fill("#axilink-url-input", link);
  // The status line is driven by an `input` listener, so let it settle.
  await window.waitForTimeout(200);
}

async function importLink(window, link) {
  await openImportModal(window, link);
  await window.click('.confirm-modal__btn[data-action="import"]');
  await window.waitForTimeout(2_000);
}

// ─── The modal tells you which kind of link you pasted ────────────────────────

test.describe("AxiForge link import — the modal", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("a comp link is recognised as a comp, not rejected", async () => {
    // Before v0.16.0 this path answered "that's a link to a comp, not a build".
    await openImportModal(window, `http://localhost:${PUB_PORT}/axibuilds/?c=abc.def`);
    await expect(window.locator("#axilink-url-status")).toContainText("Comp link");
    await expect(window.locator('.confirm-modal__btn[data-action="import"]')).toBeEnabled();
    await window.keyboard.press("Escape");
  });

  test("a build link is accepted", async () => {
    await openImportModal(window, `http://localhost:${PUB_PORT}/axibuilds/?b=abc.def`);
    await expect(window.locator("#axilink-url-status")).toContainText("Valid AxiForge link");
    await window.keyboard.press("Escape");
  });

  test("something that is not a link at all is refused, with Import disabled", async () => {
    await openImportModal(window, "https://example.com/not-a-build");
    await expect(window.locator("#axilink-url-status")).toContainText("Not an AxiForge build or comp link");
    await expect(window.locator('.confirm-modal__btn[data-action="import"]')).toBeDisabled();
    await window.keyboard.press("Escape");
  });
});

// ─── Importing a published build ──────────────────────────────────────────────

test.describe("AxiForge link import — a build", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("fetches, decrypts and saves the build under its published name", async () => {
    const link = publishBuild(makeTestBuild({ title: "Published Reaper", profession: "Necromancer" }));
    await importLink(window, link);

    await expect(window.locator(".lib-list-row__title", { hasText: "Published Reaper" })).toBeVisible();
    const saved = await window.evaluate(async () =>
      (await desktopApi.listBuilds()).find((b) => b.title === "Published Reaper")
    );
    expect(saved).toBeTruthy();
    // The copy must not inherit the publisher's identity, or re-publishing it
    // would overwrite the build it came from.
    expect(saved.publishedFileId).toBeFalsy();
  });

  test("an explicit name overrides the published one", async () => {
    const link = publishBuild(makeTestBuild({ title: "Their Name", profession: "Warrior" }));
    await openImportModal(window, link);
    await window.fill("#axilink-name-input", "My Name");
    await window.click('.confirm-modal__btn[data-action="import"]');
    await window.waitForTimeout(2_000);

    await expect(window.locator(".lib-list-row__title", { hasText: "My Name" })).toBeVisible();
    await expect(window.locator(".lib-list-row__title", { hasText: "Their Name" })).toHaveCount(0);
  });

  test("a link whose file is gone says so instead of failing silently", async () => {
    await openImportModal(window, `http://localhost:${PUB_PORT}/axibuilds/?b=missing.${"k".repeat(43)}`);
    await window.click('.confirm-modal__btn[data-action="import"]');
    // Asserted without a settling wait on purpose: an error toast is dismissed
    // after the same 2s a success toast gets, so anything that sleeps first is
    // racing the disappearance rather than the failure.
    await expect(window.locator(".lib-toast--visible")).toContainText(
      /isn't published anymore|Import failed/,
      { timeout: 15_000 }
    );
  });
});

// ─── Importing a published comp ───────────────────────────────────────────────

test.describe("AxiForge link import — a comp brings its builds", () => {
  let app, window;

  const memberA = makeTestBuild({ title: "Comp Member A", profession: "Necromancer" });
  const memberB = makeTestBuild({ title: "Comp Member B", profession: "Warrior" });
  const comp = makeTestComp({
    name: "Published Squad",
    buildIds: [memberA.id, memberB.id],
    partyLines: [{ id: "pl-1", capacity: 5, slots: [memberA.id, memberB.id, null, null, null] }],
  });

  // The success toast self-dismisses after a couple of seconds, so it has to be
  // read while the import is landing rather than from a later test.
  let importToast = "";

  test.beforeAll(async () => {
    cleanDataDir();
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
    await openImportModal(window, publishComp(comp, [memberA, memberB]));
    await window.click('.confirm-modal__btn[data-action="import"]');
    await window.locator(".lib-toast--visible", { hasText: "imported with" }).waitFor({ timeout: 15_000 });
    importToast = (await window.locator(".lib-toast--visible").textContent()) || "";
    await window.waitForTimeout(500);
  });

  test.afterAll(async () => closeApp(app));

  test("the comp and every build it uses arrive together", async () => {
    const state = await window.evaluate(async () => ({
      comps: await desktopApi.listComps(),
      builds: await desktopApi.listBuilds(),
    }));
    expect(state.comps.map((c) => c.name)).toContain("Published Squad");
    expect(state.builds.map((b) => b.title)).toEqual(
      expect.arrayContaining(["Comp Member A", "Comp Member B"])
    );
    expect(importToast).toContain('"Published Squad" imported with 2 builds');
  });

  test("it lands in its own folder named after the comp", async () => {
    // Otherwise a comp's worth of builds scatters through whatever the user was
    // looking at.
    const folder = await window.evaluate(async () =>
      (await desktopApi.listFolders()).find((f) => f.name === "Published Squad")
    );
    expect(folder).toBeTruthy();

    const { comps, builds } = await window.evaluate(async () => ({
      comps: await desktopApi.listComps(),
      builds: await desktopApi.listBuilds(),
    }));
    const imported = comps.find((c) => c.name === "Published Squad");
    expect(imported.folderId).toBe(folder.id);
    for (const title of ["Comp Member A", "Comp Member B"]) {
      expect(builds.find((b) => b.title === title).folderId).toBe(folder.id);
    }

    await expect(window.locator("#lib-content [data-folder-id]", { hasText: "Published Squad" })).toBeVisible();
  });

  test("every reference is remapped in step — no empty slots beside imported builds", async () => {
    // The failure this guards against is subtle and silent: a build imports
    // fine, but the slot still names the publisher's id, so the comp renders a
    // gap where that build should be.
    const { comps, builds } = await window.evaluate(async () => ({
      comps: await desktopApi.listComps(),
      builds: await desktopApi.listBuilds(),
    }));
    const imported = comps.find((c) => c.name === "Published Squad");
    const idsByTitle = Object.fromEntries(builds.map((b) => [b.title, b.id]));
    const newA = idsByTitle["Comp Member A"];
    const newB = idsByTitle["Comp Member B"];

    // Fresh ids throughout — the publisher's ids are meaningless here.
    expect(newA).not.toBe(memberA.id);
    expect(newB).not.toBe(memberB.id);

    expect(imported.buildIds).toEqual(expect.arrayContaining([newA, newB]));
    const slots = imported.partyLines.flatMap((l) => l.slots);
    expect(slots).toEqual(expect.arrayContaining([newA, newB]));
    // Nothing may still point at a build id that no longer exists here.
    const live = new Set(builds.map((b) => b.id));
    for (const slot of slots.filter(Boolean)) {
      if (typeof slot === "string" && !slot.startsWith("tag:")) expect(live.has(slot)).toBe(true);
    }
  });

  test("the imported copy is ours — re-publishing it cannot overwrite the original", async () => {
    const { comps, builds } = await window.evaluate(async () => ({
      comps: await desktopApi.listComps(),
      builds: await desktopApi.listBuilds(),
    }));
    const imported = comps.find((c) => c.name === "Published Squad");
    expect(imported.id).not.toBe(comp.id);
    expect(imported.publishedFileId).toBeFalsy();
    for (const title of ["Comp Member A", "Comp Member B"]) {
      expect(builds.find((b) => b.title === title).publishedFileId).toBeFalsy();
    }
  });

  test("the comp opens with its builds in place", async () => {
    await window.click('.leftnav__item[data-page="comps"]');
    const back = window.locator(".comp-detail__back-btn");
    if (await back.count()) {
      await back.first().click();
      await window.waitForTimeout(300);
    }
    // Only one comp exists in this data dir, so the shared helper is enough —
    // and it encodes the comp list's contract (single click, no data-bound
    // handshake), which differs from the library list's.
    await openFirstComp(window);
    await window.waitForTimeout(400);
    await expect(window.locator(".comp-detail")).toContainText("Comp Member A");
    await expect(window.locator(".comp-detail")).toContainText("Comp Member B");
  });
});
