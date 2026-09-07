// Comp history — the record comps never had.
//
// A build has carried a full "who changed what" since the shared-folder work.
// The comp those builds sit in — the thing a squad actually argues over, and the
// thing one drag can restructure — carried nothing at all.
//
// This is at e2e level because it is the IPC boundary that matters: main writes
// the entry on `comps:save`, and the renderer reads it back through a panel.
// The summarising and the storage are covered far more cheaply in
// tests/unit/compHistoryStore.test.js.

const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir } = require("../helpers/app");
const { seedBuildFile, seedCompFile } = require("../helpers/data");
const { makeTestBuild, makeTestComp } = require("../helpers/builds");

const healer = makeTestBuild({ title: "Heal Druid", profession: "Ranger" });
const dps = makeTestBuild({ title: "Power Reaper", profession: "Necromancer" });
const comp = makeTestComp({
  name: "Raid Squad",
  gameMode: "wvw",
  buildIds: [healer.id],
  partyLines: [{ id: "pl-1", capacity: 5, slots: [healer.id] }],
});
// A separate comp for the slot-swap tests near the end of the file, rather
// than piling more state onto `comp` — by then it has already been renamed,
// moved, and reverted several times over, and none of that should matter to
// whether a slot swap words itself as "party N slot M:".
const slotComp = makeTestComp({
  name: "Slot Swap Comp",
  gameMode: "wvw",
  buildIds: [healer.id, dps.id],
  partyLines: [{ id: "pl-slot", capacity: 5, slots: [healer.id, null, null, null, null] }],
});

async function goToLibrary(window) {
  await window.click('.leftnav__item[data-page="library"]');
  await window.waitForSelector("#lib-content", { timeout: 5_000 });
  await window.waitForTimeout(300);
}

// getCompHistory returns {versions, nextCursor} (a page, not the whole log —
// v2 histories are uncapped). Every consumer below just wants the page.
async function entries(window) {
  const { versions } = await window.evaluate((id) => desktopApi.getCompHistory(id), comp.id);
  return versions;
}

test.describe("Comp history", () => {
  let app, window;

  test.beforeAll(async () => {
    cleanDataDir();
    seedBuildFile(healer);
    seedBuildFile(dps);
    seedCompFile(comp);
    ({ app, window } = await launchApp({ clean: false }));
    await goToLibrary(window);
  });

  test.afterAll(async () => closeApp(app));

  test("saving a comp records what changed, naming the build that moved", async () => {
    await window.evaluate(
      async ({ id, buildId }) => {
        const c = (await desktopApi.listComps()).find((x) => x.id === id);
        await desktopApi.saveComp({
          ...c,
          buildIds: [...c.buildIds, buildId],
          partyLines: [{ ...c.partyLines[0], slots: [...c.partyLines[0].slots, buildId] }],
        });
      },
      { id: comp.id, buildId: dps.id }
    );
    await window.waitForTimeout(500);

    const [latest] = await entries(window);
    expect(latest.summary).toContain("added Power Reaper");
    expect(latest.recordId).toBe(comp.id);
    // This is the FIRST time this comp has ever gone through the IPC
    // boundary, so it becomes the origin keyframe (v1) regardless of what
    // changed — see historyStore.js's `!last` branch. v2 stores no per-entry
    // snapshot; a version is a whole document, reconstructed on demand. What
    // makes v1 restorable is that it IS the document, not a snapshot beside it.
    expect(latest.v).toBe(1);
    const doc = await window.evaluate(
      ({ id, v }) => desktopApi.getHistoryVersion("comp", id, v),
      { id: comp.id, v: latest.v }
    );
    expect(doc.buildIds).toEqual([healer.id, dps.id]);
  });

  test("a rename lands as its own entry, newest first", async () => {
    await window.evaluate(async (id) => {
      const c = (await desktopApi.listComps()).find((x) => x.id === id);
      await desktopApi.saveComp({ ...c, name: "Raid Squad v2" });
    }, comp.id);
    await window.waitForTimeout(500);

    const all = await entries(window);
    expect(all[0].summary).toContain('name: "Raid Squad" → "Raid Squad v2"');
    expect(all[1].summary).toContain("added Power Reaper");
  });

  test("right-click → View History opens the panel with those entries", async () => {
    // The edits above went straight through desktopApi, so the renderer's
    // state.comps still holds the pre-rename copy and the panel would title
    // itself from that. Reload so state matches disk, which is what the real
    // rename path does for itself.
    await window.reload();
    await window.waitForFunction(
      () => document.querySelectorAll("#professionSelect .cselect__option").length > 0,
      null,
      { timeout: 30_000 }
    );
    await goToLibrary(window);
    await window.locator(`[data-comp-id="${comp.id}"]`).first().click({ button: "right" });
    await window
      .locator(".lib-ctx-menu .lib-ctx-item__label")
      .filter({ hasText: /^View History$/ })
      .first()
      .click();

    const panel = window.locator(".history-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator(".history-panel__title")).toContainText("Raid Squad v2");
    await expect(panel.locator(".history-panel__entry")).toHaveCount(2);
    await expect(panel.locator(".history-panel__entry-summary").first()).toContainText("name:");
  });

  test("restoring a version puts the comp back as it was", async () => {
    // Self-contained rather than leaning on the entries the tests above wrote:
    // a retry re-runs only the failed test, so a dependency on earlier ones
    // fails for the wrong reason.
    await window.evaluate(async (id) => {
      const c = (await desktopApi.listComps()).find((x) => x.id === id);
      await desktopApi.saveComp({ ...c, name: "About To Be Undone", notes: "scratch" });
    }, comp.id);
    await window.waitForTimeout(500);

    const all = await entries(window);
    // The newest entry's OWN version is the comp AFTER that edit. v2 keeps no
    // per-entry snapshot of the state before it — that state is the PREVIOUS
    // version, reconstructed on demand — so undoing this edit means restoring
    // v-1, not v.
    const undoLast = all[0];
    const before = await window.evaluate(
      ({ id, v }) => desktopApi.getHistoryVersion("comp", id, v),
      { id: comp.id, v: undoLast.v - 1 }
    );
    expect(before.name).not.toBe("About To Be Undone");

    await window.evaluate(
      ({ id, v }) => desktopApi.revertComp(id, v),
      { id: comp.id, v: undoLast.v - 1 }
    );
    await window.waitForTimeout(600);

    const restored = await window.evaluate(
      async (id) => (await desktopApi.listComps()).find((c) => c.id === id),
      comp.id
    );
    expect(restored.name).toBe(before.name);
    expect(restored.notes || "").toBe(before.notes || "");

    // The revert is itself an entry, so it can be undone in turn.
    const after = await entries(window);
    expect(after[0].source).toBe("revert");
  });

  test("comp entries share the folder timeline with build entries", async () => {
    await window.keyboard.press("Escape");
    const folder = await window.evaluate(async () => {
      const f = await desktopApi.saveFolder({ name: "Timeline" });
      const c = (await desktopApi.listComps())[0];
      await desktopApi.saveComp({ ...c, folderId: f.id, notes: "moved in" });
      const b = (await desktopApi.listBuilds()).find((x) => x.title === "Heal Druid");
      await desktopApi.saveBuild({ ...b, folderId: f.id, title: "Heal Druid (edited)" });
      return f.id;
    });
    await window.waitForTimeout(600);

    const timeline = await window.evaluate((id) => desktopApi.getFolderHistory(id), folder);
    const kinds = new Set(timeline.map((e) => e.recordKind));
    expect(kinds.has("comp")).toBe(true);
    expect(kinds.has("build")).toBe(true);
  });

  test("a slot swap records a party N slot M summary", async () => {
    // v1: the origin keyframe, first time this comp goes through the IPC
    // boundary.
    await window.evaluate(async (c) => { await desktopApi.saveComp(c); }, slotComp);
    await window.waitForTimeout(500);

    // v2: swap party 1 slot 1 from the healer to the dps build. diffComp.js
    // diffs `partyLines[i].slots` positionally and emits one `slot` op per
    // changed index — the comp-side mirror of a build's `gear` op.
    await window.evaluate(async (id) => {
      const c = (await desktopApi.listComps()).find((x) => x.id === id);
      const partyLines = c.partyLines.map((line, i) => (
        i === 0 ? { ...line, slots: [c.buildIds[1], ...line.slots.slice(1)] } : line
      ));
      await desktopApi.saveComp({ ...c, partyLines });
    }, slotComp.id);
    await window.waitForTimeout(500);

    const { versions } = await window.evaluate((id) => desktopApi.getCompHistory(id), slotComp.id);
    expect(versions[0].summary).toContain("party 1 slot 1:");
    expect(versions[0].summary).toContain("Heal Druid");
    expect(versions[0].summary).toContain("Power Reaper");
  });

  test("the compare modal opens on a comp entry with a slot-level change table", async () => {
    // The edits above went straight through desktopApi; reload so the
    // renderer's state (and the library it draws) matches disk.
    await window.reload();
    await window.waitForFunction(
      () => document.querySelectorAll("#professionSelect .cselect__option").length > 0,
      null,
      { timeout: 30_000 }
    );
    await goToLibrary(window);

    await window.locator(`[data-comp-id="${slotComp.id}"]`).first().click({ button: "right" });
    await window
      .locator(".lib-ctx-menu .lib-ctx-item__label")
      .filter({ hasText: /^View History$/ })
      .first()
      .click();

    const panel = window.locator(".history-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await panel.locator(".history-panel__entry").first().locator(".history-panel__entry-body").click();

    const modal = window.locator(".hist-compare");
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator(".hist-compare__col")).toHaveCount(2);

    const rows = modal.locator("[data-hist-row]");
    await expect(rows).toHaveCount(1);
    const text = await rows.first().textContent();
    expect(text).toContain("party 1 slot 1:");
  });
});
