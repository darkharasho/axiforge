// A teammate's delete is undoable.
//
// Your own delete has been recoverable since v0.14.0: `builds:delete` stages the
// build in the trash for 30 days and defers the comp unlink and the history
// deletion to the purge. A tombstone arriving over sync did none of that — it
// went through teamSync._applyTombstone, which called the raw
// `buildStore.deleteBuild` (a hard filter-out of builds.json) *and*
// `historyStore.deleteHistory`. So the delete you did not perform, in the folder
// you share with other people, was the only one you could never undo: no trash
// row, no history, nothing on screen to say it had happened.
//
// These specs drive the real Worker rules in the mock sync server: a real
// teammate really deletes the item, and the app really pulls the tombstone.

const { test, expect } = require("playwright/test");
const path = require("path");
const fs = require("fs");
const { launchApp, closeApp, cleanDataDir, DATA_DIR } = require("../helpers/app");
const { resetSync, seedSync, syncState, signIn, asUser } = require("../helpers/sync");

const TEAM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INVITE = "JOINME1234";

function seedGithubAuth(login = "e2e") {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "auth.json"),
    JSON.stringify({ token: login === "e2e" ? "e2e-github-token" : `gh-${login}`, viewer: { login }, onboarding: {} })
  );
}

async function joinTeam(window) {
  await window.click("#workspaceBtn");
  await window.click('.ws-menu-item:has-text("Settings")');
  await window.click(".settings-modal__nav-item[data-pane='teams']");
  await window.click("#sm-teams-enable");
  await expect(window.locator("#sm-teams-on")).toBeVisible();
  await window.fill("#sm-team-join-code", INVITE);
  await window.click("#sm-team-join");
  await expect(window.locator(".sm-team__name", { hasText: "Mate Squad" })).toBeVisible();
  await window.click("#sm-close");
}

const titles = (window) =>
  window.evaluate(() => desktopApi.listBuilds().then((b) => b.map((x) => x.title)));

async function pull(window) {
  await window.evaluate((id) => desktopApi.pullTeam(id), TEAM_ID);
  await window.waitForTimeout(500);
}

test.describe("A teammate's delete lands in the trash, not the void", () => {
  let app, window;

  test.beforeAll(async () => {
    await resetSync();
    await seedSync([{
      id: TEAM_ID,
      name: "Mate Squad",
      inviteCode: INVITE,
      ownerLogin: "mate",
      items: [
        { id: "mate-build", type: "build", body: { title: "Doomed by mate", profession: "Guardian" } },
        { id: "kept-build", type: "build", body: { title: "Untouched", profession: "Warrior" } },
      ],
    }]);

    // The seed creates mate as a user but not a session; deleting through the
    // server's real authorization rules needs one.
    await signIn("mate");

    cleanDataDir();
    seedGithubAuth("e2e");
    ({ app, window } = await launchApp({ clean: false }));
    await joinTeam(window);
    await window.click(".leftnav__item[data-page='library']");
    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Doomed by mate");
  });

  test.afterAll(async () => closeApp(app));

  test("the build leaves the library when the tombstone arrives", async () => {
    // The owner really deletes it, through the server's own authorization.
    const res = await asUser("mate", "DELETE", `/teams/${TEAM_ID}/items/mate-build`, { query: "baseVersion=1" });
    expect(res.status).toBe(200);

    await pull(window);
    await expect.poll(() => titles(window), { timeout: 15_000 }).not.toContain("Doomed by mate");
    expect(await titles(window)).toContain("Untouched");
  });

  test("it is staged in the trash, with the full retention window", async () => {
    // This is the whole point. Before, the record was filtered straight out of
    // builds.json the moment the tombstone landed.
    const trashed = await window.evaluate(() => desktopApi.listTrash());
    const row = trashed.find((t) => t.id === "mate-build");
    expect(row).toBeTruthy();
    expect(row.type).toBe("build");
    expect(row.name).toBe("Doomed by mate");

    await window.locator("[data-navigate-trash]").click();
    await window.waitForTimeout(400);
    const uiRow = window.locator('[data-trash-row][data-trash-id="mate-build"]');
    await expect(uiRow.locator(".lib-trash__name")).toHaveText("Doomed by mate");
    await expect(uiRow.locator(".lib-trash__meta")).toContainText("30 days left");
  });

  test("its history survives, and records who deleted it", async () => {
    const history = await window.evaluate(() => desktopApi.getBuildHistory("mate-build"));
    const entry = history.find((e) => e.summary === "Deleted");
    expect(entry).toBeTruthy();
    expect(entry.authorLogin).toBe("mate");
    // The snapshot is what makes "Bring it back" possible from the history panel.
    expect(entry.snapshot.title).toBe("Doomed by mate");
  });

  test("Put Back brings it back and re-shares it with the team", async () => {
    await window.locator('[data-trash-row][data-trash-id="mate-build"] [data-trash-restore]').click();
    await window.waitForTimeout(800);

    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Doomed by mate");

    // Local-only would be a half-undo: the teammate who deleted it, and everyone
    // else, has to see it come back too.
    await expect
      .poll(
        () => window.evaluate(async () =>
          Object.values(await desktopApi.listOutbox()).flat().length
        ),
        { timeout: 15_000 }
      )
      .toBe(0);
    const state = await syncState(TEAM_ID);
    const remote = state.items.find((i) => i.id === "mate-build");
    expect(remote).toBeTruthy();
    expect(remote.deleted).toBeFalsy();
  });
});

test.describe("The shared team trash", () => {
  // The recovery half. The undelete above only works because THIS machine still
  // held a copy when the tombstone arrived — a teammate who was offline, or who
  // joined afterwards, has nothing local to put back. The server keeps the body
  // for the same 30 days it already kept the tombstone, so it can answer for
  // everyone.
  let app, window;

  test.beforeAll(async () => {
    await resetSync();
    await signIn("mate");
    await seedSync([{
      id: TEAM_ID,
      name: "Mate Squad",
      inviteCode: INVITE,
      ownerLogin: "mate",
      items: [],
    }]);

    cleanDataDir();
    seedGithubAuth("e2e");
    ({ app, window } = await launchApp({ clean: false }));
    await joinTeam(window);

    // The folder and its builds are OURS — the case worth covering is your own
    // work removed by somebody else. A member may only delete what they made,
    // and the same rule governs putting it back.
    await asUser("e2e", "PUT", `/teams/${TEAM_ID}/items/team-folder`, {
      body: { type: "folder", body: { name: "Raid Night" }, baseVersion: null },
    });
    for (const [id, title] of [["team-b1", "Inside One"], ["team-b2", "Inside Two"]]) {
      await asUser("e2e", "PUT", `/teams/${TEAM_ID}/items/${id}`, {
        body: { type: "build", parentId: "team-folder", body: { title, profession: "Guardian" }, baseVersion: null },
      });
    }
    await window.click(".leftnav__item[data-page='library']");
    await pull(window);
    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Inside One");

    // The owner deletes the whole folder, which the server cascades.
    await asUser("mate", "DELETE", `/teams/${TEAM_ID}/items/team-folder`, { query: "baseVersion=1" });
    await pull(window);
    await expect.poll(() => titles(window), { timeout: 15_000 }).not.toContain("Inside One");
  });

  test.afterAll(async () => closeApp(app));

  test("the team's deletion is listed, attributed, and says what rode along", async () => {
    const rows = await window.evaluate((id) => desktopApi.listTeamTrash(id), TEAM_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "team-folder", type: "folder", name: "Raid Night", carried: 2 });
    expect(rows[0].deletedBy.login).toBe("mate");
    // We created it, so we may put it back even though the owner removed it.
    expect(rows[0].canRestore).toBe(true);
  });

  test("it renders in the Trash view as the team's, not yours", async () => {
    await window.locator("[data-navigate-trash]").click();
    await window.waitForTimeout(600);

    const row = window.locator('[data-team-trash-row][data-trash-id="team-folder"]');
    await expect(row.locator(".lib-trash__name")).toHaveText("Raid Night");
    await expect(row.locator(".lib-trash__meta")).toContainText("deleted by mate");
    await expect(row.locator(".lib-trash__meta")).toContainText("2 items went with it");
    // Nobody gets to spend the team's retention window from here.
    await expect(row.locator("[data-trash-purge]")).toHaveCount(0);
  });

  test("Put Back restores the whole batch, for everyone", async () => {
    // Navigate here rather than leaning on the test above: a retry re-runs only
    // the failed test, so an inherited view fails for the wrong reason.
    await window.click(".leftnav__item[data-page='library']");
    await window.locator("[data-navigate-trash]").click();
    await window.waitForTimeout(600);

    await window.locator('[data-team-trash-row][data-trash-id="team-folder"] [data-team-trash-restore]').click();
    await window.waitForTimeout(1500);

    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Inside One");
    expect(await titles(window)).toContain("Inside Two");
    const folders = await window.evaluate(() => desktopApi.listFolders());
    expect(folders.map((f) => f.id)).toContain("team-folder");

    // For everyone: the server has it live again, so the teammate who deleted it
    // sees it come back on their next pull.
    const state = await syncState(TEAM_ID);
    for (const id of ["team-folder", "team-b1", "team-b2"]) {
      expect(state.items.find((i) => i.id === id).deleted).toBeFalsy();
    }
    // And it has left the shared trash.
    expect(await window.evaluate((id) => desktopApi.listTeamTrash(id), TEAM_ID)).toEqual([]);
  });
});

test.describe("The folder history panel shows the deletion", () => {
  let app, window;

  test.beforeAll(async () => {
    await resetSync();
    await seedSync([{
      id: TEAM_ID,
      name: "Mate Squad",
      inviteCode: INVITE,
      ownerLogin: "mate",
      items: [
        { id: "hist-build", type: "build", body: { title: "Gone but logged", profession: "Ranger" } },
      ],
    }]);

    // The seed creates mate as a user but not a session; deleting through the
    // server's real authorization rules needs one.
    await signIn("mate");

    cleanDataDir();
    seedGithubAuth("e2e");
    ({ app, window } = await launchApp({ clean: false }));
    await joinTeam(window);
    await window.click(".leftnav__item[data-page='library']");
    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Gone but logged");

    await asUser("mate", "DELETE", `/teams/${TEAM_ID}/items/hist-build`, { query: "baseVersion=1" });
    await pull(window);
    await expect.poll(() => titles(window), { timeout: 15_000 }).not.toContain("Gone but logged");
  });

  test.afterAll(async () => closeApp(app));

  test("a deleted build still appears in its folder's history", async () => {
    // getFolderHistory used to build its title lookup from listBuilds(), which
    // filters trashed records — so a build vanished from its own folder's
    // history the moment it was deleted, taking every earlier entry with it.
    const entries = await window.evaluate((id) => desktopApi.getFolderHistory(id), TEAM_ID);
    const deletion = entries.find((e) => e.buildTitle === "Gone but logged" && e.summary === "Deleted");
    expect(deletion).toBeTruthy();
    expect(deletion.authorLogin).toBe("mate");
    expect(deletion.buildDeleted).toBe(true);
  });

  test("restoring that version from history undeletes the build", async () => {
    // upsertBuild deliberately carries the trash stamp over from the existing
    // record (so a teammate's edit can't resurrect something you deleted), which
    // means a plain revert would write a build nothing draws. The revert path
    // has to take it out of the trash first.
    const entries = await window.evaluate((id) => desktopApi.getFolderHistory(id), TEAM_ID);
    const deletion = entries.find((e) => e.buildTitle === "Gone but logged" && e.summary === "Deleted");

    await window.evaluate(
      ({ entryId }) => desktopApi.revertBuild("hist-build", entryId),
      { entryId: deletion.id }
    );
    await window.waitForTimeout(600);

    await expect.poll(() => titles(window), { timeout: 15_000 }).toContain("Gone but logged");
    const stillTrashed = await window.evaluate(() =>
      desktopApi.listTrash().then((t) => t.some((x) => x.id === "hist-build"))
    );
    expect(stillTrashed).toBe(false);
  });
});
