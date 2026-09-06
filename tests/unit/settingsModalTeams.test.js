/** @jest-environment jsdom */
"use strict";
jest.mock("../../src/renderer/modules/state.js", () => ({ state: { folders: [], teams: [], teamSession: null, outbox: {} } }));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../src/renderer/modules/utils.js", () => ({ escapeHtml: (s) => String(s), delay: () => Promise.resolve(), relativeTime: () => "just now" }));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../src/renderer/modules/choice-modal.js", () => ({ showChoiceModal: jest.fn() }));
// Everything about a TEAM — its people, their folder access, its name, deleting
// or leaving it — is the team dialog now. Settings owns the list and the way in.
jest.mock("../../src/renderer/modules/teams.js", () => ({ loadTeamState: jest.fn(async () => {}) }));
jest.mock("../../src/renderer/modules/team-modal.js", () => ({
  initTeamModal: jest.fn(),
  openTeamModal: jest.fn(async () => {}),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("settings-modal — Teams pane", () => {
  let mod, api;
  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = "";
    api = {
      getSession: jest.fn(async () => ({ viewer: { login: "me" } })),
      getTeamSession: jest.fn(async () => null),
      enableTeamSync: jest.fn(async () => ({ login: "me" })),
      disableTeamSync: jest.fn(async () => {}),
      listTeams: jest.fn(async () => []),
      listOutbox: jest.fn(async () => ({})),
      listFolders: jest.fn(async () => []),
      createTeam: jest.fn(async (name) => ({ team: { id: "t1", name, inviteCode: "ABCDEFGHJK" }, role: "owner" })),
      joinTeam: jest.fn(async () => ({ team: { id: "t2", name: "Guild" }, role: "member" })),
      listTeamMembers: jest.fn(async () => [{ userId: "u1", login: "me", role: "owner" }, { userId: "u2", login: "vette", role: "member" }]),
      removeTeamMember: jest.fn(async () => {}),
      rotateInvite: jest.fn(async () => ({ inviteCode: "ZZZZZZZZZZ" })),
      renameTeam: jest.fn(async () => ({})),
      deleteTeam: jest.fn(async () => {}),
      leaveTeam: jest.fn(async () => {}),
      writeClipboardText: jest.fn(async () => {}),
      legacyLibraryStatus: jest.fn(async () => ({ hasLegacy: false })),
      getSetting: jest.fn(async () => null),
      listDiscordWebhooks: jest.fn(async () => []),
      getOnboardingStatus: jest.fn(async () => ({})),
    };
    window.desktopApi = api;
    mod = require("../../src/renderer/modules/settings-modal.js");
    mod.initSettingsModal();
    mod.initSettingsCallbacks({ refreshLibraryState: jest.fn(), navigateToPage: jest.fn(), onTeamSyncEnabled: jest.fn(), refreshOnboardingStatus: jest.fn(), render: jest.fn() });
  });

  test("sync off: shows the enable view; enabling calls enableTeamSync and switches to the on view", async () => {
    mod.openSettingsModal({ initialPane: "teams" });
    await flush();
    expect(document.getElementById("sm-teams-off").hidden).toBe(false);
    expect(document.getElementById("sm-teams-on").hidden).toBe(true);
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    document.getElementById("sm-teams-enable").click();
    await flush(); await flush();
    expect(api.enableTeamSync).toHaveBeenCalled();
    expect(document.getElementById("sm-teams-on").hidden).toBe(false);
    expect(document.getElementById("sm-teams-user").textContent).toContain("me");
  });

  test("create team shows the invite code and copies it; join calls joinTeam with the trimmed code", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    mod.openSettingsModal({ initialPane: "teams" });
    await flush();
    document.getElementById("sm-team-create-name").value = "EWW";
    document.getElementById("sm-team-create").click();
    await flush(); await flush();
    expect(api.createTeam).toHaveBeenCalledWith("EWW");
    expect(document.getElementById("sm-teams-status").textContent).toContain("ABCDEFGHJK");
    expect(api.writeClipboardText).toHaveBeenCalledWith("ABCDEFGHJK");
    document.getElementById("sm-team-join-code").value = "  zzzzzzzzzz ";
    document.getElementById("sm-team-join").click();
    await flush(); await flush();
    expect(api.joinTeam).toHaveBeenCalledWith("ZZZZZZZZZZ");
  });

  test("create team still succeeds when the clipboard write fails: team appears in the list and status is not an error", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.writeClipboardText.mockRejectedValueOnce(new Error("clipboard denied"));
    api.listTeams.mockResolvedValue([
      { team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" },
    ]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush();
    document.getElementById("sm-team-create-name").value = "EWW";
    document.getElementById("sm-team-create").click();
    await flush(); await flush();
    expect(api.createTeam).toHaveBeenCalledWith("EWW");
    const status = document.getElementById("sm-teams-status");
    expect(status.textContent).toContain("ABCDEFGHJK");
    expect(status.textContent).not.toMatch(/^Error/);
    expect(document.querySelectorAll(".sm-team")).toHaveLength(1);
  });

  test("team list: one row per team, naming your role and offering the way in", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([
      { team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" },
      { team: { id: "t2", name: "Guild" }, role: "member" },
    ]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    const rows = [...document.querySelectorAll(".sm-team")];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.querySelector(".sm-team__name").textContent)).toEqual(["EWW", "Guild"]);
    expect(rows[0].textContent).toContain("owner");
    expect(rows[1].textContent).toContain("member");
    expect(rows.every((r) => r.querySelector("[data-act='manage']"))).toBe(true);
  });

  // These seven controls were a second implementation of what the Share dialog
  // rendered its own way. The row is a list entry now; none of them live here.
  test("the row carries no invite code, rotate, rename, delete or member list", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([{ team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" }]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    const row = document.querySelector(".sm-team");
    for (const act of ["rotate", "rename", "delete", "members", "leave", "copy-invite"]) {
      expect(row.querySelector(`[data-act='${act}']`)).toBeNull();
    }
    expect(row.textContent).not.toContain("ABCDEFGHJK");
    expect(api.listTeamMembers).not.toHaveBeenCalled();
  });

  test("Manage team opens the team dialog for that team, with a refresh hook", async () => {
    const { openTeamModal } = require("../../src/renderer/modules/team-modal.js");
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([
      { team: { id: "t1", name: "EWW" }, role: "owner" },
      { team: { id: "t2", name: "Guild" }, role: "member" },
    ]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();

    document.querySelectorAll(".sm-team [data-act='manage']")[1].click();
    await flush(); await flush();

    expect(openTeamModal).toHaveBeenCalledWith("t2", expect.objectContaining({ onRefresh: expect.any(Function) }));
  });

  test("legacy org library: the migrate prompt appears, runs the migration and hides itself", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.legacyLibraryStatus.mockResolvedValue({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root", builds: 3, comps: 1 }] });
    api.migrateOrgLibrary = jest.fn(async () => ({ teamId: "t1", uploaded: 4, failed: [], foldersMigrated: 1 }));
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    const box = document.getElementById("sm-teams-migrate");
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain("gw2eww");
    expect(box.textContent).toContain("3 builds");
    api.legacyLibraryStatus.mockResolvedValue({ hasLegacy: false });
    document.getElementById("sm-migrate-new").click();
    await flush(); await flush(); await flush();
    expect(api.migrateOrgLibrary).toHaveBeenCalledWith({ teamName: "gw2eww" });
    expect(document.getElementById("sm-teams-status").textContent).toContain("Migrated");
    expect(box.hidden).toBe(true);
  });

  test("legacy org library: failures are reported and the prompt stays", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.legacyLibraryStatus.mockResolvedValue({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root", builds: 1, comps: 0 }] });
    api.migrateOrgLibrary = jest.fn(async () => ({ teamId: "t1", uploaded: 0, failed: [{ itemId: "b0", status: 413, message: "too large" }], foldersMigrated: 1 }));
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    document.getElementById("sm-migrate-new").click();
    await flush(); await flush(); await flush();
    const status = document.getElementById("sm-teams-status");
    expect(status.textContent).toContain("too large");
    expect(document.getElementById("sm-teams-migrate").hidden).toBe(false);
  });

  test("legacy org library: migrating into an existing team asks which team", async () => {
    const { showChoiceModal } = require("../../src/renderer/modules/choice-modal.js");
    showChoiceModal.mockResolvedValue("t9");
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([{ team: { id: "t9", name: "Guild" }, role: "owner" }]);
    api.legacyLibraryStatus.mockResolvedValue({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root", builds: 1, comps: 0 }] });
    api.migrateOrgLibrary = jest.fn(async () => ({ teamId: "t9", uploaded: 2, failed: [], foldersMigrated: 1 }));
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    document.getElementById("sm-migrate-existing").click();
    await flush(); await flush(); await flush();
    expect(showChoiceModal).toHaveBeenCalled();
    expect(api.migrateOrgLibrary).toHaveBeenCalledWith({ teamId: "t9" });
  });

  test("legacy org library: a FAILED status probe leaves the migration prompt up", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.legacyLibraryStatus.mockResolvedValue({ hasLegacy: true, orgName: "gw2eww", folders: [{ id: "root0", name: "Root", builds: 1, comps: 0 }] });
    api.migrateOrgLibrary = jest.fn(async () => { throw new Error("SYNC_OFFLINE"); });
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    const box = document.getElementById("sm-teams-migrate");
    expect(box.hidden).toBe(false);

    // The migration fails AND the re-probe from its error path can't reach main.
    // "Couldn't check" must not be read as "nothing to migrate" — that would take
    // the only entry point to migration away while the org library is still there.
    api.legacyLibraryStatus.mockRejectedValue(new Error("EPIPE"));
    document.getElementById("sm-migrate-new").click();
    await flush(); await flush(); await flush();

    expect(document.getElementById("sm-teams-status").textContent).toContain("SYNC_OFFLINE");
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain("gw2eww");
  });

  test("returning to the Teams pane re-checks the GitHub session", async () => {
    // Signed out of GitHub when Settings opened → the enable button is disabled.
    api.getSession.mockResolvedValue(null);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    expect(document.getElementById("sm-teams-enable").disabled).toBe(true);

    // Signing in elsewhere used to leave it disabled for the life of the modal.
    api.getSession.mockResolvedValue({ viewer: { login: "me" } });
    document.querySelector('.settings-modal__nav-item[data-pane="appearance"]').click();
    await flush();
    document.querySelector('.settings-modal__nav-item[data-pane="teams"]').click();
    await flush(); await flush();
    expect(document.getElementById("sm-teams-enable").disabled).toBe(false);
  });

  test("sign out asks for confirmation then calls disableTeamSync", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    mod.openSettingsModal({ initialPane: "teams" });
    await flush();
    document.getElementById("sm-teams-signout").click();
    await flush(); await flush();
    expect(api.disableTeamSync).toHaveBeenCalled();
  });
});
