const { test, expect } = require("playwright/test");
const path = require("path");
const fs = require("fs");
const { launchApp, closeApp, cleanDataDir, DATA_DIR } = require("../helpers/app");
const { resetSync, seedSync, syncState, editAsTeammate, asUser } = require("../helpers/sync");

// The three Team Sync flows that had NO end-to-end coverage: joining by invite
// (i.e. ever being a member rather than an owner), resolving a sync conflict,
// and stopping sharing. All three are driven through the real UI, against the
// mock Worker's real authorization rules.

const TEAM_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INVITE = "JOINME1234";

/** Sign the app in as `login` (the mock GitHub /user route reads this token). */
function seedGithubAuth(login = "e2e") {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "auth.json"),
    JSON.stringify({ token: login === "e2e" ? "e2e-github-token" : `gh-${login}`, viewer: { login }, onboarding: {} })
  );
}

async function openTeamsPane(window) {
  await window.click("#workspaceBtn");
  await window.click('.ws-menu-item:has-text("Settings")');
  await window.click(".settings-modal__nav-item[data-pane='teams']");
  await window.click("#sm-teams-enable");
  await expect(window.locator("#sm-teams-on")).toBeVisible();
}

async function enableSyncAndCreateTeam(window, name) {
  await openTeamsPane(window);
  await window.fill("#sm-team-create-name", name);
  await window.click("#sm-team-create");
  await expect(window.locator(".sm-team__name", { hasText: name })).toBeVisible();
  await window.click("#sm-close");
}

const outboxSize = (window) =>
  window.evaluate(async () => Object.values(await desktopApi.listOutbox()).flat().length);

async function waitForSynced(window) {
  await expect.poll(() => outboxSize(window), { timeout: 15_000 }).toBe(0);
}

test.describe("Team Sync — join, conflicts, stop sharing", () => {
  test.beforeEach(async () => { await resetSync(); });

  test("join by invite code: a MEMBER gets the team's contents and the member-side rules", async () => {
    // A team that already exists, owned by someone else, with their content in it.
    await seedSync([{
      id: TEAM_ID,
      name: "Mate Squad",
      inviteCode: INVITE,
      ownerLogin: "mate",
      items: [
        { id: "mate-folder", type: "folder", body: { name: "Mate Sub", sortOrder: 0 } },
        { id: "mate-build", type: "build", parentId: "mate-folder", body: { title: "Mate's build", profession: "Guardian" } },
      ],
    }]);

    cleanDataDir();
    seedGithubAuth("e2e");
    const { app, window } = await launchApp({ clean: false });

    await openTeamsPane(window);
    await window.fill("#sm-team-join-code", INVITE);
    await window.click("#sm-team-join");
    await expect(window.locator(".sm-team__name", { hasText: "Mate Squad" })).toBeVisible();
    // Joining makes you a member, not an owner — the pane must say so.
    await expect(window.locator(".sm-team", { hasText: "Mate Squad" })).toContainText(/member/i);
    await window.click("#sm-close");

    // The join pulls the team: the owner's folder and build are now local.
    await window.click(".leftnav__item[data-page='library']");
    await expect(window.locator("[data-navigate-folder]", { hasText: "Mate Squad" })).toBeVisible();
    await expect.poll(
      () => window.evaluate(() => desktopApi.listBuilds().then((b) => b.map((x) => x.title))),
      { timeout: 15_000 }
    ).toContain("Mate's build");
    const localFolders = await window.evaluate(() => desktopApi.listFolders());
    expect(localFolders.find((f) => f.id === TEAM_ID)).toMatchObject({ teamId: TEAM_ID, role: "member", shared: true });
    expect(localFolders.find((f) => f.id === "mate-folder")).toMatchObject({ parentId: TEAM_ID });

    // A member is not offered "Stop sharing" on a teammate's folder…
    await window.click(`[data-navigate-folder='${TEAM_ID}']`);
    await window.locator("#lib-content [data-folder-id='mate-folder']").click({ button: "right" });
    const menu = window.locator(".lib-ctx-menu").first();
    await expect(menu).toBeVisible();
    await expect(menu.locator(".lib-ctx-item__label", { hasText: "Pull now" })).toBeVisible();
    await expect(menu.locator(".lib-ctx-item__label", { hasText: "Stop sharing" })).toHaveCount(0);
    await window.keyboard.press("Escape");

    // …and the SERVER refuses it too, not just the UI: a member may only delete
    // what they created.
    const forbidden = await asUser("e2e", "DELETE", `/teams/${TEAM_ID}/items/mate-folder`, { query: "baseVersion=1" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("forbidden");
    // Their own contribution is fine.
    const mine = await asUser("e2e", "PUT", `/teams/${TEAM_ID}/items/my-build`, {
      body: { type: "build", parentId: "mate-folder", body: { title: "Mine", profession: "Thief" }, baseVersion: null },
    });
    expect(mine.status).toBe(201);
    const owned = await asUser("e2e", "DELETE", `/teams/${TEAM_ID}/items/my-build`, { query: "baseVersion=1" });
    expect(owned.status).toBe(200);
    // A member cannot rename the team either.
    const rename = await asUser("e2e", "PATCH", `/teams/${TEAM_ID}`, { body: { name: "Hijacked" } });
    expect(rename.status).toBe(403);

    await closeApp(app);
  });

  test("sync conflict → 'Take theirs' replaces the local copy with the teammate's", async () => {
    cleanDataDir();
    seedGithubAuth("e2e");
    const { app, window } = await launchApp({ clean: false });
    await enableSyncAndCreateTeam(window, "Conflict Team");
    await window.click(".leftnav__item[data-page='library']");

    const teamId = await window.evaluate(async () => (await desktopApi.listFolders()).find((f) => f.teamId).teamId);
    const buildId = await window.evaluate(async (fid) => {
      const saved = await desktopApi.saveBuild({ title: "Contested", profession: "Warrior", folderId: fid });
      return saved.id;
    }, teamId);
    await waitForSynced(window);

    // A teammate edits it on the server while we hold version 1.
    await editAsTeammate(teamId, buildId, "mate", { title: "Mate's title" });

    // Our next edit therefore pushes a stale baseVersion → 409 → conflict modal.
    await window.evaluate(({ id, fid }) => desktopApi.saveBuild({ id, title: "My title", profession: "Warrior", folderId: fid }), { id: buildId, fid: teamId });

    const modal = window.locator(".choice-modal");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal).toContainText("Sync conflict");
    await expect(modal).toContainText("mate");
    await modal.locator('[data-choice="theirs"]').click();

    await expect.poll(
      () => window.evaluate((id) => desktopApi.listBuilds().then((b) => b.find((x) => x.id === id)?.title), buildId),
      { timeout: 15_000 }
    ).toBe("Mate's title");
    await expect.poll(() => outboxSize(window), { timeout: 15_000 }).toBe(0);

    await closeApp(app);
  });

  test("sync conflict → 'Keep mine' re-pushes the local copy over the teammate's", async () => {
    cleanDataDir();
    seedGithubAuth("e2e");
    const { app, window } = await launchApp({ clean: false });
    await enableSyncAndCreateTeam(window, "Conflict Team 2");
    await window.click(".leftnav__item[data-page='library']");

    const teamId = await window.evaluate(async () => (await desktopApi.listFolders()).find((f) => f.teamId).teamId);
    const buildId = await window.evaluate(async (fid) => {
      const saved = await desktopApi.saveBuild({ title: "Contested", profession: "Warrior", folderId: fid });
      return saved.id;
    }, teamId);
    await waitForSynced(window);

    await editAsTeammate(teamId, buildId, "mate", { title: "Mate's title" });
    await window.evaluate(({ id, fid }) => desktopApi.saveBuild({ id, title: "My title", profession: "Warrior", folderId: fid }), { id: buildId, fid: teamId });

    const modal = window.locator(".choice-modal");
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.locator('[data-choice="mine"]').click();

    // Resolving "mine" adopts the server's version as the base and pushes again,
    // so the SERVER must end up holding our title, with no outbox left over.
    await expect.poll(
      async () => (await syncState(teamId)).items.find((i) => i.id === buildId)?.body?.title,
      { timeout: 15_000 }
    ).toBe("My title");
    await expect.poll(() => outboxSize(window), { timeout: 15_000 }).toBe(0);
    expect(await window.evaluate((id) => desktopApi.listBuilds().then((b) => b.find((x) => x.id === id)?.title), buildId)).toBe("My title");

    await closeApp(app);
  });

  test("stop sharing a team SUB-FOLDER removes it (and its contents) from the team", async () => {
    cleanDataDir();
    seedGithubAuth("e2e");
    const { app, window } = await launchApp({ clean: false });
    await enableSyncAndCreateTeam(window, "Stop Team");
    await window.click(".leftnav__item[data-page='library']");

    const teamId = await window.evaluate(async () => (await desktopApi.listFolders()).find((f) => f.teamId).teamId);

    // Make a sub-folder inside the team, through the UI.
    await window.click(`[data-navigate-folder='${teamId}']`);
    await window.locator("#lib-content").click({ button: "right", position: { x: 5, y: 5 } });
    await window.locator(".lib-ctx-menu .lib-ctx-item__label", { hasText: "New Folder" }).first().click();
    await window.fill(".lib-inline-input", "Shared Sub");
    await window.keyboard.press("Enter");

    const subId = await window.evaluate(async (tid) =>
      (await desktopApi.listFolders()).find((f) => f.parentId === tid).id, teamId);
    const buildId = await window.evaluate(async (fid) =>
      (await desktopApi.saveBuild({ title: "Inside sub", profession: "Ranger", folderId: fid })).id, subId);
    await waitForSynced(window);
    {
      const server = await syncState(teamId);
      expect(server.items.map((i) => i.id).sort()).toEqual([buildId, subId].sort());
    }

    // The team ROOT must NOT offer "Stop sharing" — the engine rejects the root
    // id, so an affordance there is a guaranteed error (security M2).
    await window.locator(".lib-sidebar [data-folder-id]", { hasText: "Stop Team" }).first().click({ button: "right" });
    const rootMenu = window.locator(".lib-ctx-menu").first();
    await expect(rootMenu).toBeVisible();
    await expect(rootMenu.locator(".lib-ctx-item__label", { hasText: "Share" })).toBeVisible();
    await expect(rootMenu.locator(".lib-ctx-item__label", { hasText: "Stop sharing" })).toHaveCount(0);
    await window.keyboard.press("Escape");

    // The SUB-folder does, and it works.
    await window.click(`[data-navigate-folder='${teamId}']`);
    await window.locator(`#lib-content [data-folder-id='${subId}']`).click({ button: "right" });
    const menu = window.locator(".lib-ctx-menu").first();
    await menu.locator(".lib-ctx-item__label", { hasText: "Stop sharing" }).first().click();
    await window.click("#cm-confirm");

    // Local: the folder is personal again and keeps its build.
    await expect.poll(
      () => window.evaluate((id) => desktopApi.listFolders().then((f) => f.find((x) => x.id === id)?.parentId ?? null), subId),
      { timeout: 15_000 }
    ).toBe(null);
    expect(await window.evaluate((id) => desktopApi.listBuilds().then((b) => b.find((x) => x.id === id)?.folderId), buildId)).toBe(subId);

    // Server: the folder is tombstoned and the delete cascaded to the build.
    const server = await syncState(teamId);
    expect(server.items.find((i) => i.id === subId)).toMatchObject({ deleted: true });
    expect(server.items.find((i) => i.id === buildId)).toMatchObject({ deleted: true });

    await closeApp(app);
  });
});
