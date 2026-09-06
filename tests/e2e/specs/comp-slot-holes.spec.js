// A comp whose party line has a hole in it must still open.
//
// `slots` is a DENSE list of what is filled: the comp editor splices on removal
// and renders empty boxes for everything past slots.length, so it never writes a
// null itself. But a record can arrive from somewhere that did — an import, a
// teammate's sync payload, a hand-edited comps.json. renderPartyLine used to read
// `buildId.length` straight off the entry, so one null threw out of
// renderCompDetail and left the entire comps page blank with nothing on screen to
// explain it. Nothing recovered short of restarting the app.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp } = require("../helpers/builds");
const { openFirstComp } = require("../helpers/comps");

test.describe("Comp detail — a party line with a hole in it", () => {
  let app, window;
  const pageErrors = [];

  const filled = makeTestBuild({ title: "Real Member", profession: "Necromancer" });
  const holey = makeTestComp({
    name: "Holey Comp",
    buildIds: [filled.id],
    // A hole between two entries, and trailing holes: every arrangement that
    // used to reach `null.length`.
    partyLines: [{ id: "pl-1", capacity: 5, slots: [filled.id, null, filled.id, null, null] }],
  });

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(filled);
    seedCompFile(holey);
    ({ app, window } = await launchApp({ clean: false }));
    window.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  });

  test.afterAll(async () => closeApp(app));

  test("the comp opens instead of blanking the page", async () => {
    await window.click('.leftnav__item[data-page="comps"]');
    await openFirstComp(window);

    await expect(window.locator(".comp-detail")).toBeVisible();
    await expect(window.locator(".comp-detail__topbar")).toContainText("Holey Comp");
  });

  test("the build that IS there still renders, and the holes render as empty slots", async () => {
    await expect(window.locator(".comp-slot--filled")).toHaveCount(2);
    await expect(window.locator(".comp-slot--empty").first()).toBeVisible();
    // A hole is not a broken reference — it must not be reported as one.
    await expect(window.locator(".comp-slot--missing")).toHaveCount(0);
  });

  test("nothing threw while rendering it", async () => {
    expect(pageErrors).toEqual([]);
  });
});
