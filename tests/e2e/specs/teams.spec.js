const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir, DATA_DIR } = require("../helpers/app");
const { syncPort } = require("../helpers/ports");

// This worker's own sync server — the suite runs several at once.
const SYNC_PORT = syncPort();
const path = require("path");
const fs = require("fs");
const http = require("http");

// `teams:enable` (src/main/index.js) first calls getSession(), which calls the
// REAL GitHub API's getViewer() — that's now redirected to the mock sync
// server's `/user` route via AXIFORGE_GITHUB_API_ROOT (see helpers/app.js and
// src/main/githubApi.js). So we only need a fake GitHub token on disk to pass
// getSession(); teams:enable then drives the real `teamSync.enableWithGithub()`
// → `POST /auth/github` on the mock server, exactly like production.
function seedGithubAuth() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "auth.json"),
    JSON.stringify({ token: "e2e-github-token", viewer: { login: "e2e" }, onboarding: {} })
  );
}

function resetSyncServer() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port: SYNC_PORT, path: "/__reset", method: "POST" },
      (res) => { res.resume(); res.on("end", resolve); }
    );
    req.on("error", reject);
    req.end();
  });
}


/** Settings → Teams: sign in and create a team, the way a user would. */
async function enableSyncAndCreateTeam(window, name) {
  await window.click("#workspaceBtn");
  await window.click('.ws-menu-item:has-text("Settings")');
  await window.click(".settings-modal__nav-item[data-pane='teams']");
  await window.click("#sm-teams-enable");
  await expect(window.locator("#sm-teams-on")).toBeVisible();
  await window.fill("#sm-team-create-name", name);
  await window.click("#sm-team-create");
  await expect(window.locator(".sm-team__name", { hasText: name })).toBeVisible();
  await window.click("#sm-close");
}

test.describe("Teams", () => {
  test.beforeEach(async () => {
    // The mock server's `db` persists across tests in this file (it lives in
    // Playwright's globalSetup process, not the worker process running these
    // specs) — reset it so `team-${db.teams.size + 1}` IDs stay deterministic.
    await resetSyncServer();
  });

  test("create team → root folder appears; saving into it syncs", async () => {
    cleanDataDir();
    seedGithubAuth();
    const { app, window } = await launchApp({ clean: false });
    // Drive this through the real Settings → Teams UI rather than calling
    // desktopApi.enableTeamSync()/createTeam() directly: the click handlers
    // (settings-modal.js's _enableTeams/_createTeam) are what refresh
    // state.folders/state.teamSession afterwards, which the library sidebar
    // reads from. Calling the IPC methods directly leaves that renderer-side
    // state stale until some other trigger happens to refresh it.
    await window.click("#workspaceBtn");
    await window.click('.ws-menu-item:has-text("Settings")');
    await window.click(".settings-modal__nav-item[data-pane='teams']");
    await window.click("#sm-teams-enable");
    await expect(window.locator("#sm-teams-on")).toBeVisible();
    await window.fill("#sm-team-create-name", "E2E Team");
    await window.click("#sm-team-create");
    await expect(window.locator(".sm-team__name", { hasText: "E2E Team" })).toBeVisible();
    await window.click("#sm-close");
    await window.click(".leftnav__item[data-page='library']");
    await expect(window.locator(".lib-sidebar__section-label", { hasText: "Team Folders" })).toBeVisible();
    await expect(window.locator("[data-navigate-folder]", { hasText: "E2E Team" })).toBeVisible();
    const folderId = await window.evaluate(async () => (await desktopApi.listFolders()).find((f) => f.teamId).id);
    await window.evaluate((fid) => desktopApi.saveBuild({ title: "Synced build", profession: "Warrior", folderId: fid }), folderId);
    // outbox flush (1s debounce) → PUT lands on the mock server; badge settles to synced
    await expect
      .poll(async () => window.evaluate(async () => Object.values(await desktopApi.listOutbox()).flat().length), { timeout: 10_000 })
      .toBe(0);
    await closeApp(app);
  });

  test("unreachable server → pending badge, outbox retained across restart", async () => {
    const unreachable = { AXIFORGE_SYNC_BASE: "http://localhost:1/api/sync" };
    cleanDataDir();
    // Pre-seed a team root + session directly (server is down, so do it via files)
    const authPath = path.join(DATA_DIR, "auth.json");
    fs.writeFileSync(authPath, JSON.stringify({ sync: { sessionToken: "e2e-session", userId: "u1", login: "e2e" } }));
    fs.writeFileSync(
      path.join(DATA_DIR, "folders.json"),
      JSON.stringify([
        {
          id: "t1",
          name: "Offline Team",
          parentId: null,
          sortOrder: 0,
          shared: true,
          teamId: "t1",
          role: "owner",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ])
    );

    let { app, window } = await launchApp({ clean: false, env: unreachable });
    await window.evaluate(() => desktopApi.saveBuild({ title: "Offline build", profession: "Warrior", folderId: "t1" }));
    await window.click(".leftnav__item[data-page='library']");
    await window.click("[data-navigate-folder='t1']");
    await expect(window.locator(".lib-content-sync-indicator--pending")).toBeVisible({ timeout: 10_000 });
    await closeApp(app);

    ({ app, window } = await launchApp({ clean: false, env: unreachable }));
    const outbox = await window.evaluate(() => desktopApi.listOutbox());
    expect(Object.values(outbox).flat().length).toBe(1);
    await closeApp(app);
  });

  test("sidebar right-click → Share… opens the share modal with the invite code", async () => {
    cleanDataDir();
    seedGithubAuth();
    const { app, window } = await launchApp({ clean: false });
    await enableSyncAndCreateTeam(window, "Sidebar Team");
    await window.click(".leftnav__item[data-page='library']");

    // The whole point of the feature: the LEFT SIDEBAR is right-clickable, not
    // just the list page. context-menu.js dispatches on data-folder-id, which
    // sidebar.js now emits alongside data-navigate-folder.
    const sidebarFolder = window.locator(".lib-sidebar [data-folder-id]", { hasText: "Sidebar Team" });
    await sidebarFolder.click({ button: "right" });
    const menu = window.locator(".lib-ctx-menu").first();
    await expect(menu).toBeVisible();
    await menu.locator(".lib-ctx-item__label", { hasText: "Share" }).first().click();

    await expect(window.locator(".shm")).toBeVisible();
    await expect(window.locator("#shm-title")).toHaveText(/Sharing "Sidebar Team"/);
    await expect(window.locator("#shm-invite-code")).not.toBeEmpty();
    // People and access are the team dialog's, not this one's — the folder
    // dialog says what YOU may do here and links to the rest.
    await expect(window.locator("#shm-my-access")).not.toBeEmpty();

    await window.locator('[data-act="manage-team"]').click();
    await expect(window.locator(".shm")).toBeHidden();
    await expect(window.locator(".tm")).toBeVisible();
    // An owner lands on the access browser with the folder they came from
    // already picked — the deep link lands on the answer, not on a list with
    // the answer somewhere in it. Members and grants load asynchronously.
    await expect(window.locator(".tm-fa__node--on")).toBeVisible();
    await expect(window.locator(".tm-fa__blanket-title")).toHaveText("Everyone in the team");
    await window.locator('[data-tab="people"]').click();
    await expect(window.locator(".tm__person-name", { hasText: "e2e" })).toBeVisible();

    await window.keyboard.press("Escape");
    await expect(window.locator(".tm")).toBeHidden();
    await closeApp(app);
  });

  test("list-page right-click → Share… reaches the same modal", async () => {
    cleanDataDir();
    seedGithubAuth();
    const { app, window } = await launchApp({ clean: false });
    await enableSyncAndCreateTeam(window, "List Team");
    await window.click(".leftnav__item[data-page='library']");

    await window.locator("#lib-content [data-folder-id]").first().click({ button: "right" });
    const menu = window.locator(".lib-ctx-menu").first();
    await expect(menu).toBeVisible();
    await menu.locator(".lib-ctx-item__label", { hasText: "Share" }).first().click();
    await expect(window.locator("#shm-invite-code")).not.toBeEmpty();
    await closeApp(app);
  });

  test("signed out → Share… offers to enable sync instead of dead-ending", async () => {
    cleanDataDir();
    // No auth.json at all: the app has never signed in to GitHub.
    const { app, window } = await launchApp({ clean: false });
    await window.click(".leftnav__item[data-page='library']");
    await window.click("#lib-new-folder-btn");
    await window.fill(".lib-inline-input", "Solo Folder");
    await window.keyboard.press("Enter");

    const folder = window.locator(".lib-sidebar [data-folder-id]", { hasText: "Solo Folder" });
    await expect(folder).toBeVisible();
    await folder.click({ button: "right" });
    const menu = window.locator(".lib-ctx-menu").first();
    await menu.locator(".lib-ctx-item__label", { hasText: "Share" }).first().click();

    // Before this feature the menu item was hidden entirely without a team
    // session, so the only path was Settings → Teams.
    await expect(window.locator(".shm")).toBeVisible();
    await expect(window.locator('[data-act="enable"]')).toBeVisible();
    await closeApp(app);
  });
});
