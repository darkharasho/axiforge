/** @jest-environment jsdom */
"use strict";
jest.mock("../../src/renderer/modules/state.js", () => ({ state: { folders: [], teams: [], teamSession: null, outbox: {} } }));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../src/renderer/modules/utils.js", () => ({ escapeHtml: (s) => String(s), delay: () => Promise.resolve(), relativeTime: () => "just now" }));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../src/renderer/modules/choice-modal.js", () => ({ showChoiceModal: jest.fn() }));
// Electron's renderer has no window.prompt(); everything that asks for a string
// goes through the modal helper, so that is what the rename path must call.
jest.mock("../../src/renderer/modules/prompt-modal.js", () => ({ showPrompt: jest.fn() }));

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

  test("team list: owner sees rotate/rename/delete and member rows with Remove; member sees Leave only", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([
      { team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" },
      { team: { id: "t2", name: "Guild" }, role: "member" },
    ]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    const rows = [...document.querySelectorAll(".sm-team")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("[data-act='rotate']")).not.toBeNull();
    expect(rows[0].querySelector("[data-act='delete']")).not.toBeNull();
    expect(rows[0].textContent).toContain("ABCDEFGHJK");
    expect(rows[1].querySelector("[data-act='rotate']")).toBeNull();
    expect(rows[1].querySelector("[data-act='leave']")).not.toBeNull();
    rows[0].querySelector("[data-act='members']").click();
    await flush(); await flush();
    expect(api.listTeamMembers).toHaveBeenCalledWith("t1");
    const memberRows = [...rows[0].querySelectorAll(".sm-team__member")];
    expect(memberRows.map((m) => m.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("vette")]));
    memberRows.find((m) => m.textContent.includes("vette")).querySelector("[data-act='remove']").click();
    await flush(); await flush();
    expect(api.removeTeamMember).toHaveBeenCalledWith("t1", "u2");
    rows[0].querySelector("[data-act='rotate']").click();
    await flush(); await flush();
    expect(api.rotateInvite).toHaveBeenCalledWith("t1");
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

  test("rename uses the modal prompt, never window.prompt (Electron throws on it)", async () => {
    const { showPrompt } = require("../../src/renderer/modules/prompt-modal.js");
    showPrompt.mockResolvedValue("EWW Reloaded");
    // Exactly what Electron does — if the handler still called it, the catch
    // would paint "Error: prompt() is and will not be supported."
    window.prompt = () => { throw new Error("prompt() is and will not be supported."); };
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([{ team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" }]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();

    document.querySelector(".sm-team [data-act='rename']").click();
    await flush(); await flush();

    expect(showPrompt).toHaveBeenCalledWith("New team name", "EWW");
    expect(api.renameTeam).toHaveBeenCalledWith("t1", "EWW Reloaded");
    expect(document.getElementById("sm-teams-status").textContent).not.toMatch(/^Error/);
  });

  test("cancelling the rename prompt changes nothing", async () => {
    const { showPrompt } = require("../../src/renderer/modules/prompt-modal.js");
    showPrompt.mockResolvedValue(null);
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([{ team: { id: "t1", name: "EWW", inviteCode: "ABCDEFGHJK" }, role: "owner" }]);
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    document.querySelector(".sm-team [data-act='rename']").click();
    await flush(); await flush();
    expect(api.renameTeam).not.toHaveBeenCalled();
  });

  test("a non-Error rejection still reaches the status line", async () => {
    api.getTeamSession.mockResolvedValue({ login: "me", userId: "u1" });
    api.listTeams.mockResolvedValue([{ team: { id: "t1", name: "Guild" }, role: "member" }]);
    // `err.message` on a bare string is undefined, so this used to render the
    // useless "Error: undefined" — and an undefined rejection threw inside the
    // catch outright, showing nothing at all.
    api.leaveTeam.mockRejectedValue("SYNC_OFFLINE");
    mod.openSettingsModal({ initialPane: "teams" });
    await flush(); await flush();
    document.querySelector(".sm-team [data-act='leave']").click();
    await flush(); await flush();
    expect(document.getElementById("sm-teams-status").textContent).toContain("SYNC_OFFLINE");
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
