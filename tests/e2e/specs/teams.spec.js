const { test, expect } = require("playwright/test");
const { launchApp, closeApp, cleanDataDir, DATA_DIR } = require("../helpers/app");
const path = require("path");
const fs = require("fs");

// NOTE on deviation from the task brief: the brief's spec calls
// `desktopApi.enableTeamSync()` after seeding a fake GitHub token/viewer into
// auth.json. That doesn't work here — `teams:enable` (src/main/index.js) goes
// through the real top-level `getSession()`, which calls the REAL GitHub API
// (`getViewer()` in src/main/githubApi.js hits the hardcoded
// `https://api.github.com`, with no env override for tests). A fake token
// against the real API returns a real 401, which clears the seeded auth and
// makes `teams:enable` throw "Log in with GitHub first." — this environment
// has live network access to api.github.com (verified with curl), so it is
// NOT a network-error fallback case.
//
// `teams:create` (teamSync.createTeam) does NOT go through that GitHub check
// — it only needs `auth.sync` (the team-sync session), which is exactly what
// the mock server's `POST /auth/github` would have produced. So instead of
// exercising `enableTeamSync()`, we seed `auth.sync` directly, matching what
// the second test already does for its offline scenario. This still
// exercises the real teamSync engine (createTeam → root folder → outbox →
// flush → PUT against the mock server) end to end; it just skips the
// GitHub-login leg of "enable", which would require a live/mocked GitHub API
// not covered by this task's mock-sync-server.
function seedTeamSyncAuth() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, "auth.json"),
    JSON.stringify({ sync: { sessionToken: "e2e-session", userId: "u1", login: "e2e" } })
  );
}

test.describe("Teams", () => {
  test("create team → root folder appears; saving into it syncs", async () => {
    cleanDataDir();
    seedTeamSyncAuth();
    const { app, window } = await launchApp({ clean: false });
    await window.evaluate(() => desktopApi.createTeam("E2E Team"));
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
});
