/**
 * @jest-environment jsdom
 *
 * The share modal is the one surface that turns a personal folder into a shared
 * one and hands back the invite code. What matters here is that each of its
 * three states renders the right affordance, and that the picker's two paths
 * (existing team / brand-new team) both end in shareFolderToTeam.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { folders: [], teams: [], teamSession: null },
}));
jest.mock("../../../src/renderer/modules/library/folder-store.js", () => ({
  shareFolderToTeam: jest.fn(async () => ({ uploaded: 3, failed: [] })),
  stopSharingFolder: jest.fn(async () => {}),
  pullTeamFor: jest.fn(async () => {}),
}));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({
  showConfirmModal: jest.fn(async () => true),
}));
jest.mock("../../../src/renderer/modules/teams.js", () => {
  const { state } = require("../../../src/renderer/modules/state.js");
  return {
    loadTeamState: jest.fn(async () => {}),
    // Real enough for these tests: walk up to the nearest folder carrying teamId.
    teamRootFor: (id) => {
      let cur = state.folders.find((f) => f.id === id) || null;
      while (cur) {
        if (cur.teamId) return cur;
        if (!cur.parentId) return null;
        cur = state.folders.find((f) => f.id === cur.parentId) || null;
      }
      return null;
    },
  };
});

const { state } = require("../../../src/renderer/modules/state.js");
const folderStore = require("../../../src/renderer/modules/library/folder-store.js");
const teams = require("../../../src/renderer/modules/teams.js");
const { initShareModal, openShareModal, closeShareModal } =
  require("../../../src/renderer/modules/library/share-modal.js");

const PERSONAL = { id: "p", name: "Personal", parentId: null };
const TEAM_ROOT = { id: "t", name: "EWW", parentId: null, shared: true, teamId: "t", role: "owner" };
const TEAM_SUB = { id: "sub", name: "Raids", parentId: "t" };

beforeEach(() => {
  jest.clearAllMocks();
  // No body reset: the overlay is a singleton appended once, exactly as in the
  // app. Wiping the DOM would detach it while initShareModal() still thinks it
  // is mounted.
  window.desktopApi = {
    enableTeamSync: jest.fn(async () => {}),
    createTeam: jest.fn(async (name) => ({ team: { id: "new", name, inviteCode: "NEWCODE123" } })),
    listTeamMembers: jest.fn(async () => [
      { userId: "u1", login: "me", role: "owner" },
      { userId: "u2", login: "them", role: "member" },
    ]),
    removeTeamMember: jest.fn(async () => {}),
    rotateInvite: jest.fn(async () => ({ inviteCode: "ROTATED456" })),
    writeClipboardText: jest.fn(async () => {}),
  };
  state.folders = [PERSONAL, TEAM_ROOT, TEAM_SUB];
  state.teams = [{ team: { id: "t", name: "EWW", inviteCode: "ABCDE12345" }, role: "owner" }];
  state.teamSession = { userId: "u1", login: "me" };
  initShareModal();
});

afterEach(() => closeShareModal());

const body = () => document.querySelector("#shm-body");
const title = () => document.querySelector("#shm-title").textContent;
const act = (name) => document.querySelector(`[data-act="${name}"]`);
const flush = () => new Promise((r) => setTimeout(r, 0));

test("no team session → offers to enable sync rather than sending the user to Settings", async () => {
  state.teamSession = null;
  await openShareModal("p");
  expect(title()).toBe('Share "Personal"');
  expect(act("enable")).toBeTruthy();
  expect(act("share")).toBeFalsy();
});

test("enabling sync re-renders in place, without closing the dialog", async () => {
  state.teamSession = null;
  await openShareModal("p");
  teams.loadTeamState.mockImplementation(async () => { state.teamSession = { login: "me" }; });

  act("enable").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(window.desktopApi.enableTeamSync).toHaveBeenCalled();
  expect(document.querySelector(".shm-overlay").className).not.toContain("shm-overlay--hidden");
  expect(act("share")).toBeTruthy();
});

test("picker shares to the selected existing team and refreshes the library", async () => {
  const onRefresh = jest.fn();
  await openShareModal("p", { onRefresh });
  // The first team comes preselected, so the common one-team case is one click.
  expect(body().querySelector('input[value="t"]').checked).toBe(true);

  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(window.desktopApi.createTeam).not.toHaveBeenCalled();
  expect(folderStore.shareFolderToTeam).toHaveBeenCalledWith("p", "t");
  expect(onRefresh).toHaveBeenCalled();
});

test('"New team…" creates the team first, then shares to it', async () => {
  await openShareModal("p");
  const newOption = body().querySelector('input[value="__new"]');
  newOption.checked = true;
  newOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // Picking "New team…" reveals the name field.
  const nameInput = document.querySelector("#shm-new-team");
  expect(nameInput.hidden).toBe(false);
  nameInput.value = "Fresh Team";

  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(window.desktopApi.createTeam).toHaveBeenCalledWith("Fresh Team");
  expect(folderStore.shareFolderToTeam).toHaveBeenCalledWith("p", "new");
});

test("a new team with no name is rejected before anything is created", async () => {
  await openShareModal("p");
  body().querySelector('input[value="__new"]').checked = true;

  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(window.desktopApi.createTeam).not.toHaveBeenCalled();
  expect(folderStore.shareFolderToTeam).not.toHaveBeenCalled();
  expect(document.querySelector("#shm-status").textContent).toContain("name");
});

test("a shared folder shows the invite code and its members", async () => {
  await openShareModal("t");
  expect(title()).toBe('Sharing "EWW"');
  expect(document.querySelector("#shm-invite-code").textContent).toBe("ABCDE12345");
  await flush();
  expect([...document.querySelectorAll(".shm__member-name")].map((e) => e.textContent))
    .toEqual(["me", "them"]);
  // Owners can't be removed, and the owner row is the current user.
  expect(document.querySelectorAll('[data-act="remove-member"]')).toHaveLength(1);
});

test("Copy flashes confirmation and puts the code on the clipboard", async () => {
  jest.useFakeTimers();
  try {
    await openShareModal("t");
    const btn = act("copy-invite");
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(window.desktopApi.writeClipboardText).toHaveBeenCalledWith("ABCDE12345");
    expect(btn.textContent).toBe("Copied!");
    jest.advanceTimersByTime(2000);
    expect(btn.textContent).toBe("Copy");
  } finally {
    jest.useRealTimers();
  }
});

test("a clipboard failure still tells the user the code", async () => {
  window.desktopApi.writeClipboardText.mockRejectedValueOnce(new Error("denied"));
  await openShareModal("t");
  act("copy-invite").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
  expect(document.querySelector("#shm-status").textContent).toContain("ABCDE12345");
});

test("rotating swaps the code in place", async () => {
  await openShareModal("t");
  teams.loadTeamState.mockImplementation(async () => {
    state.teams = [{ team: { id: "t", name: "EWW", inviteCode: "ROTATED456" }, role: "owner" }];
  });

  act("rotate").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(window.desktopApi.rotateInvite).toHaveBeenCalledWith("t");
  expect(document.querySelector("#shm-invite-code").textContent).toBe("ROTATED456");
});

test("a member sees no invite code and no destructive actions", async () => {
  state.folders = [{ ...TEAM_ROOT, role: "member" }, TEAM_SUB];
  state.teams = [{ team: { id: "t", name: "EWW", inviteCode: "ABCDE12345" }, role: "member" }];
  await openShareModal("sub");
  expect(document.querySelector("#shm-invite-code")).toBeFalsy();
  expect(act("stop-sharing")).toBeFalsy();
  expect(act("pull")).toBeTruthy();
  await flush();
  expect(document.querySelectorAll('[data-act="remove-member"]')).toHaveLength(0);
});

// TeamSync.stopSharing rejects a team ROOT ("Not a shared sub-folder of a team"),
// so the affordance belongs on a SUB-folder and must be handed the sub-folder's
// own id — not the root's.
test("stop sharing un-shares the sub-folder the dialog was opened on", async () => {
  const onRefresh = jest.fn();
  await openShareModal("sub", { onRefresh });
  act("stop-sharing").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(folderStore.stopSharingFolder).toHaveBeenCalledWith("sub");
  expect(onRefresh).toHaveBeenCalled();
  expect(document.querySelector(".shm-overlay").className).toContain("shm-overlay--hidden");
});

test("the team ROOT gets no Stop sharing button — the engine refuses it", async () => {
  await openShareModal("t");
  expect(act("pull")).toBeTruthy();
  expect(act("stop-sharing")).toBeFalsy();
});

test("a failed share surfaces the error inline instead of throwing it away", async () => {
  folderStore.shareFolderToTeam.mockRejectedValueOnce(new Error("SYNC_OFFLINE"));
  await openShareModal("p");
  body().querySelector('input[value="t"]').checked = true;

  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(document.querySelector("#shm-status").textContent).toBe("SYNC_OFFLINE");
  expect(act("share").disabled).toBe(false);
});

test("retrying a failed new-team share reuses the team instead of creating another", async () => {
  folderStore.shareFolderToTeam.mockRejectedValueOnce(new Error("SYNC_OFFLINE"));
  teams.loadTeamState.mockImplementation(async () => {
    state.teams = [
      { team: { id: "t", name: "EWW", inviteCode: "ABCDE12345" }, role: "owner" },
      { team: { id: "new", name: "Fresh Team", inviteCode: "NEWCODE123" }, role: "owner" },
    ];
  });
  await openShareModal("p");
  const newOption = body().querySelector('input[value="__new"]');
  newOption.checked = true;
  newOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  document.querySelector("#shm-new-team").value = "Fresh Team";

  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
  expect(window.desktopApi.createTeam).toHaveBeenCalledTimes(1);
  expect(document.querySelector("#shm-status").textContent).toBe("SYNC_OFFLINE");
  // The picker re-rendered and preselected the team that now exists.
  expect(body().querySelector('input[value="new"]').checked).toBe(true);

  // Retry: no second team, and the share goes to the one already created.
  act("share").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
  expect(window.desktopApi.createTeam).toHaveBeenCalledTimes(1);
  expect(folderStore.shareFolderToTeam).toHaveBeenLastCalledWith("p", "new");
});

test("enabling sync from here clears the signed-out banner Settings owns", async () => {
  const onTeamSyncEnabled = jest.fn();
  initShareModal({ onTeamSyncEnabled });
  state.teamSession = null;
  await openShareModal("p");
  teams.loadTeamState.mockImplementation(async () => { state.teamSession = { login: "me" }; });

  act("enable").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();

  expect(onTeamSyncEnabled).toHaveBeenCalled();
});

test("re-opening does not stack Escape listeners", async () => {
  await openShareModal("p");
  await openShareModal("t");
  const removeSpy = jest.spyOn(document, "removeEventListener");
  closeShareModal();
  // One handler in, one handler out.
  const keydownRemovals = removeSpy.mock.calls.filter(([type]) => type === "keydown");
  expect(keydownRemovals).toHaveLength(1);
  removeSpy.mockRestore();

  // The stale handler from the first open must be gone, so Escape after a close
  // cannot re-close (and the overlay stays as-is).
  await openShareModal("p");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector(".shm-overlay").className).toContain("shm-overlay--hidden");
});

test("Escape closes the dialog", async () => {
  await openShareModal("p");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector(".shm-overlay").className).toContain("shm-overlay--hidden");
});
