/**
 * @jest-environment jsdom
 *
 * Manage Team is where team administration was consolidated: the member list,
 * the invite code and remove-member each used to exist twice, in Settings and
 * in the Share dialog, and folder access could only be seen one folder at a
 * time. What matters here is that a folder's level is set for EVERYONE first and
 * excepted per person second, that the pane says where each level came from,
 * that setting one re-reads rather than patching (a grant changes what every
 * folder below it inherits), that picking a folder in the tree is the only way
 * the pane changes, and that a member is shown their own levels rather than
 * controls they cannot use.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { folders: [], teams: [], teamSession: null },
}));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({
  showConfirmModal: jest.fn(async () => true),
}));
jest.mock("../../../src/renderer/modules/prompt-modal.js", () => ({
  showPrompt: jest.fn(async () => null),
}));
jest.mock("../../../src/renderer/modules/teams.js", () => {
  const { state } = require("../../../src/renderer/modules/state.js");
  return {
    loadTeamState: jest.fn(async () => {}),
    rootForTeam: (teamId) => state.folders.find((f) => f.teamId === teamId) || null,
  };
});

const { state } = require("../../../src/renderer/modules/state.js");
const { showConfirmModal } = require("../../../src/renderer/modules/confirm-modal.js");
const { showPrompt } = require("../../../src/renderer/modules/prompt-modal.js");
const { initTeamModal, openTeamModal, closeTeamModal } =
  require("../../../src/renderer/modules/team-modal.js");

const ROOT = { id: "root", name: "EWW", parentId: null, shared: true, teamId: "t1", role: "owner" };
const RAIDS = { id: "raids", name: "Raids", parentId: "root", sortOrder: 0 };
const WVW = { id: "wvw", name: "WvW", parentId: "root", sortOrder: 1 };
const DEEP = { id: "deep", name: "Squads", parentId: "wvw", sortOrder: 0 };

const flush = () => new Promise((r) => setTimeout(r, 0));
const act = (name) => document.querySelector(`[data-act="${name}"]`);
const tab = (id) => document.querySelector(`[data-tab="${id}"]`);
const status = () => document.querySelector("#tm-status").textContent;

let api;

beforeEach(() => {
  jest.clearAllMocks();
  api = {
    listTeamMembers: jest.fn(async () => [
      { userId: "u1", login: "me", role: "owner" },
      { userId: "u2", login: "vette", role: "member" },
    ]),
    listTeamGrants: jest.fn(async () => ({ grants: [], defaults: { member: "write" } })),
    setTeamGrant: jest.fn(async () => {}),
    removeTeamMember: jest.fn(async () => {}),
    rotateInvite: jest.fn(async () => ({ inviteCode: "ROTATED456" })),
    renameTeam: jest.fn(async () => {}),
    deleteTeam: jest.fn(async () => {}),
    leaveTeam: jest.fn(async () => {}),
    pullTeam: jest.fn(async () => {}),
    writeClipboardText: jest.fn(async () => {}),
  };
  window.desktopApi = api;
  state.folders = [ROOT, RAIDS, WVW, DEEP];
  state.teams = [{ team: { id: "t1", name: "EWW", inviteCode: "ABCDE12345" }, role: "owner" }];
  state.teamSession = { userId: "u1", login: "me" };
  // The overlay is a singleton appended once, exactly as in the app.
  initTeamModal();
});

afterEach(() => closeTeamModal());

describe("as an owner", () => {
  test("opens on People with the invite code, the members and what each can do", async () => {
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector("#tm-title").textContent).toBe("EWW");
    expect(document.querySelector("#tm-invite-code").textContent).toBe("ABCDE12345");
    expect([...document.querySelectorAll(".tm__person-name")].map((e) => e.textContent))
      .toEqual(["me", "vette"]);
    expect(document.querySelector('[data-user-id="u2"] .tm__person-access').textContent)
      .toBe("Can edit everywhere");
    expect(document.querySelector("#tm-meta").textContent).toBe("2 members · 3 shared folders");
  });

  test("an owner's summary is not computed from grants — they can undo any of them", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "raids", userId: "u1", access: "none" }], defaults: { member: "write" },
    });
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector('[data-user-id="u1"] .tm__person-access').textContent)
      .toBe("Full access everywhere");
  });

  // A person's team-wide level and a grant on the root are the same fact, so the
  // People tab writes the ROOT KEY — otherwise the two surfaces would disagree
  // about what "Read only everywhere" means.
  test("a member's team-wide level is set on People, and lands on the root key", async () => {
    await openTeamModal("t1");
    await flush();
    const select = document.querySelector('.tm__person[data-user-id="u2"] select[data-act="set-access"]');
    expect(select.value).toBe("inherit");
    expect(select.querySelector('option[value="inherit"]').textContent)
      .toBe("Team default (Can edit)");

    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "t1", userId: "u2", access: "read" }], defaults: { member: "write" },
    });
    select.value = "read";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(); await flush();

    expect(api.setTeamGrant).toHaveBeenCalledWith("t1", "t1", "u2", "read"); // root key
    expect(document.querySelector('.tm__person[data-user-id="u2"] select[data-act="set-access"]').value)
      .toBe("read");
    expect(document.querySelector('[data-user-id="u2"] .tm__person-access').textContent)
      .toBe("Read only everywhere");
  });

  // An owner can hand any grant back in the same breath, so a level set against
  // one would be a lie — it is stated, never offered.
  test("an owner gets no team-wide control", async () => {
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector('.tm__person[data-user-id="u1"] select')).toBeNull();
    expect(document.querySelector('.tm__person[data-user-id="u1"] .tm__person-fixed').textContent)
      .toBe("Owner");
  });

  test("a face where there is one, and the initial standing in where there is not", async () => {
    api.listTeamMembers.mockResolvedValue([
      { userId: "u1", login: "me", role: "owner", avatarUrl: "https://x/me.png" },
      { userId: "u2", login: "vette", displayName: "Vette", role: "member" },
    ]);
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector('[data-user-id="u1"] .tm__avatar-img').getAttribute("src"))
      .toBe("https://x/me.png");
    // The monogram is the cell's own content, so a slow or broken avatar still reads.
    expect(document.querySelector('[data-user-id="u1"] .tm__avatar').textContent).toContain("M");
    expect(document.querySelector('[data-user-id="u2"] .tm__avatar-img')).toBeNull();
    expect(document.querySelector('[data-user-id="u2"] .tm__avatar').textContent).toBe("V");
  });

  test("the tree is every folder in the team, nested, with the root keyed by TEAM id", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();
    const nodes = [...document.querySelectorAll(".tm-fa__node")];
    expect(nodes.map((n) => n.dataset.key)).toEqual(["t1", "raids", "wvw", "deep"]);
    expect(nodes.map((n) => n.querySelector(".tm-fa__node-name").textContent))
      .toEqual(["EWW", "Raids", "WvW", "Squads"]);
    // Depth is what makes "Squads is inside WvW" readable at a glance.
    expect(nodes[3].getAttribute("style")).toContain("--depth:2");
    // A small tree opens flat: the tree is how you PICK a folder, and hiding
    // folders to save four rows makes picking the harder of the two.
    expect(document.querySelectorAll('[data-act="toggle-folder"][aria-expanded="true"]'))
      .toHaveLength(2);
    // The root is picked by default, and exactly one folder is on screen.
    expect(document.querySelector(".tm-fa__pane").dataset.folderKey).toBe("t1");
    expect(document.querySelectorAll('.tm-fa__pane select[data-user-id="*"]')).toHaveLength(1);
    expect(document.querySelectorAll(".tm-fa__exception")).toHaveLength(0);
  });

  test("picking a folder in the tree is what changes the pane", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();
    document.querySelector('.tm-fa__node[data-key="deep"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".tm-fa__pane").dataset.folderKey).toBe("deep");
    expect(document.querySelector('.tm-fa__node[data-key="deep"]').className).toContain("--on");
    expect(document.querySelector(".tm-fa__crumb").textContent.replace(/\s+/g, " "))
      .toContain("EWW / WvW");
    // Picking is a read, not a write — nothing was sent to the server.
    expect(api.setTeamGrant).not.toHaveBeenCalled();
  });

  // The twisty is nested inside the node, so it has to win the click or opening
  // a branch would double as picking it.
  test("collapsing a branch hides what is inside it without changing the selection", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();
    document.querySelector('[data-act="toggle-folder"][data-key="wvw"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect([...document.querySelectorAll(".tm-fa__node")].map((n) => n.dataset.key))
      .toEqual(["t1", "raids", "wvw"]);
    expect(document.querySelector(".tm-fa__pane").dataset.folderKey).toBe("t1");
  });

  // A match has to be reachable however the tree was left.
  test("the filter narrows the tree and ignores collapse", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();
    const box = document.querySelector("#tm-fa-filter");
    box.value = "squad";
    box.dispatchEvent(new Event("input", { bubbles: true }));

    expect([...document.querySelectorAll(".tm-fa__node")].map((n) => n.dataset.key))
      .toEqual(["t1", "wvw", "deep"]);
    // The input itself survives — redrawing the tab would take the caret with it.
    expect(document.querySelector("#tm-fa-filter")).toBe(box);
  });

  // Otherwise "Manage access" lands on a tree with the answer somewhere in it.
  test("a Share dialog deep link opens ON that folder", async () => {
    await openTeamModal("t1", { tab: "access", focusFolderId: "deep" });
    await flush();
    expect(document.querySelector(".tm-fa__pane").dataset.folderKey).toBe("deep");
    expect(document.querySelector('.tm-fa__node[data-key="deep"]').className).toContain("--on");
  });

  // The whole point of the blanket: it is a fact about the folder, so it covers
  // the member who joins next week too, and stays one line however big the team.
  test("setting a folder for everyone is one control, and reads back as one", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "wvw", userId: "*", access: "read" }], defaults: { member: "write" },
    });

    document.querySelector('.tm-fa__node[data-key="wvw"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const select = document.querySelector('.tm-fa__pane select[data-user-id="*"]');
    select.value = "read";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(); await flush();

    expect(api.setTeamGrant).toHaveBeenCalledWith("t1", "wvw", "*", "read");
    expect(status()).toBe("Everyone's access updated.");
    expect(document.querySelector('.tm-fa__pane select[data-user-id="*"]').value).toBe("read");

    // ...and it reaches the folder below, which is what a blanket is for — said
    // in words, because an inherited level and a deliberate one are otherwise
    // the same control showing the same text.
    document.querySelector('.tm-fa__node[data-key="deep"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".tm-fa__blanket").className).toContain("--inherited");
    expect(document.querySelector(".tm-fa__blanket-sub").textContent.replace(/\s+/g, " "))
      .toBe("Nothing set here — follows WvW");
    expect(document.querySelector('.tm-fa__pane select[data-user-id="*"] option').textContent)
      .toBe("Inherited · Read only");
  });

  test("naming a person is a two-step exception, and nothing is stored until a level is chosen", async () => {
    await openTeamModal("t1", { tab: "access" });
    await flush();

    document.querySelector('.tm-fa__node[data-key="wvw"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    act("add-exception").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const picker = act("pick-person");
    picker.value = "u2";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    expect(api.setTeamGrant).not.toHaveBeenCalled();
    const pending = document.querySelector(".tm-fa__exception--pending");
    expect(pending.dataset.userId).toBe("u2");

    const level = pending.querySelector("select");
    level.value = "none";
    level.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(); await flush();
    expect(api.setTeamGrant).toHaveBeenCalledWith("t1", "wvw", "u2", "none");
  });

  test("dropping an exception puts that person back on whatever everyone gets", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "wvw", userId: "u2", access: "none" }], defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access" });
    await flush();

    document.querySelector('.tm-fa__node[data-key="wvw"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    act("clear-exception").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();

    expect(api.setTeamGrant).toHaveBeenCalledWith("t1", "wvw", "u2", "inherit");
    expect(status()).toBe("Exception removed.");
  });

  test("a blanket is inherited by everything under it, and the list says so", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "wvw", userId: "*", access: "read" }], defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access" });
    await flush();
    const pick = (key) => {
      document.querySelector(`.tm-fa__node[data-key="${key}"]`)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return document.querySelector('.tm-fa__pane select[data-user-id="*"]');
    };
    expect(pick("wvw").value).toBe("read");
    const deep = pick("deep");
    expect(deep.value).toBe("inherit");
    expect(deep.querySelector("option").textContent).toBe("Inherited · Read only");
    // A sibling is untouched — inheritance runs down the chain, not across it.
    expect(pick("raids").querySelector("option").textContent).toBe("Inherited · Can edit");
    // The tree says at a glance which folder the rule is actually on.
    expect(document.querySelectorAll(".tm-fa__dot")).toHaveLength(1);
    expect(document.querySelector('.tm-fa__node[data-key="wvw"] .tm-fa__dot')).not.toBeNull();
  });

  test("a person named on a folder is shown as its exception, above whatever everyone gets", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [
        { folderId: "wvw", userId: "*", access: "read" },
        { folderId: "wvw", userId: "u2", access: "delete" },
      ],
      defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access", focusFolderId: "wvw" });
    await flush();
    const row = document.querySelector(".tm-fa__exception");
    expect(row.dataset.userId).toBe("u2");
    expect(row.querySelector("select").value).toBe("delete");
    expect(row.querySelector("option").textContent).toBe("Same as everyone (Read only)");
    expect(row.querySelector(".tm-fa__person-note").textContent).toMatch(/Overrides/);
  });

  // No access is the one level that takes something away, and it takes every
  // folder below with it — said where it is set, not discovered by the person
  // who lost the folder.
  test("shutting someone out is spelled out on the folder it happens on", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "wvw", userId: "u2", access: "none" }], defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access", focusFolderId: "wvw" });
    await flush();
    expect(document.querySelector(".tm-fa__warn").textContent.replace(/\s+/g, " "))
      .toContain("vette loses “WvW”");
    // And the tree flags it, so it is findable without opening every folder.
    expect(document.querySelector('.tm-fa__node[data-key="wvw"] .tm-fa__dot').className)
      .toContain("--blocks");
  });

  // The fold is the point of a blanket: it covers people without naming them.
  test("everyone else is one line until asked, and then says where each level came from", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "t1", userId: "*", access: "read" }], defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access", focusFolderId: "raids" });
    await flush();
    expect(document.querySelector(".tm-fa__fold").lastElementChild.textContent.replace(/\s+/g, " "))
      .toBe("2 others get Read only — show them");
    expect(document.querySelectorAll(".tm-fa__others .tm-fa__person")).toHaveLength(0);

    act("toggle-others").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector('.tm-fa__others [data-user-id="u2"] .tm-fa__person-note')
      .textContent.replace(/\s+/g, " ")).toBe("From Everyone on EWW");
    // An owner is stated, never controlled: they can hand any grant back.
    expect(document.querySelector('.tm-fa__others [data-user-id="u1"] select')).toBeNull();
    expect(document.querySelector('.tm-fa__others [data-user-id="u1"] .tm-fa__fixed').textContent)
      .toBe("Full access");
  });

  // Patching the one control would leave every folder BELOW it describing the
  // level it used to inherit, which is exactly the confusion the pane exists to
  // remove — and the folder below is one click away, not off screen.
  test("setting a level re-reads the grants so the folders below it update too", async () => {
    const onRefresh = jest.fn();
    await openTeamModal("t1", { tab: "access", focusFolderId: "wvw", onRefresh });
    await flush();
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "wvw", userId: "*", access: "none" }], defaults: { member: "write" },
    });

    const select = document.querySelector('.tm-fa__pane select[data-user-id="*"]');
    select.value = "none";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(); await flush();

    expect(api.setTeamGrant).toHaveBeenCalledWith("t1", "wvw", "*", "none");
    document.querySelector('.tm-fa__node[data-key="deep"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector('.tm-fa__pane select[data-user-id="*"]').value).toBe("inherit");
    expect(document.querySelector('.tm-fa__pane select[data-user-id="*"] option').textContent)
      .toBe("Inherited · No access");
    expect(onRefresh).toHaveBeenCalled();
    expect(status()).toBe("Everyone's access updated.");
  });

  test("a refused grant is reported and the control snaps back to the server's answer", async () => {
    api.setTeamGrant.mockRejectedValueOnce(new Error("SYNC_OFFLINE"));
    await openTeamModal("t1", { tab: "access", focusFolderId: "raids" });
    await flush();

    const select = document.querySelector('.tm-fa__pane select[data-user-id="*"]');
    select.value = "none";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(); await flush();

    expect(status()).toBe("SYNC_OFFLINE");
    expect(document.querySelector('.tm-fa__pane select[data-user-id="*"]').value).toBe("inherit");
  });

  // The root folder is not a synced item, so a team-wide grant is keyed by the
  // TEAM id. Opening Share on the root has to deep-link to that key, not to a
  // folder id the tree has never heard of.
  test("deep-linking from the team root lands on the team-wide folder", async () => {
    await openTeamModal("t1", { tab: "access", focusFolderId: "root" });
    await flush();
    expect(document.querySelector(".tm-fa__pane").dataset.folderKey).toBe("t1");
    expect(document.querySelector(".tm-fa__crumb").textContent).toContain("The whole team");
  });

  test("removing a member confirms first, then drops them from the list", async () => {
    await openTeamModal("t1");
    await flush();
    document.querySelector('[data-user-id="u2"] [data-act="remove-member"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();

    expect(showConfirmModal).toHaveBeenCalled();
    expect(api.removeTeamMember).toHaveBeenCalledWith("t1", "u2");
    expect(document.querySelector('[data-user-id="u2"]')).toBeNull();
  });

  test("an owner cannot be removed — there is no control to try it with", async () => {
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector('[data-user-id="u1"] [data-act="remove-member"]')).toBeNull();
  });

  test("Copy puts the invite code on the clipboard and says so", async () => {
    jest.useFakeTimers();
    try {
      await openTeamModal("t1");
      const btn = act("copy-invite");
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      expect(api.writeClipboardText).toHaveBeenCalledWith("ABCDE12345");
      expect(btn.textContent).toBe("Copied!");
      jest.advanceTimersByTime(2000);
      expect(btn.textContent).toBe("Copy");
    } finally {
      jest.useRealTimers();
    }
  });

  test("a clipboard failure still tells the user the code", async () => {
    api.writeClipboardText.mockRejectedValueOnce(new Error("denied"));
    await openTeamModal("t1");
    act("copy-invite").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(status()).toContain("ABCDE12345");
  });

  test("rotating confirms, then shows the new code in place", async () => {
    const teams = require("../../../src/renderer/modules/teams.js");
    await openTeamModal("t1");
    await flush();
    teams.loadTeamState.mockImplementation(async () => {
      state.teams = [{ team: { id: "t1", name: "EWW", inviteCode: "ROTATED456" }, role: "owner" }];
    });

    act("rotate").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();

    expect(api.rotateInvite).toHaveBeenCalledWith("t1");
    expect(document.querySelector("#tm-invite-code").textContent).toBe("ROTATED456");
  });

  test("rename goes through the modal prompt, never window.prompt (Electron throws on it)", async () => {
    showPrompt.mockResolvedValue("EWW Reloaded");
    window.prompt = () => { throw new Error("prompt() is and will not be supported."); };
    await openTeamModal("t1", { tab: "team" });
    await flush();

    act("rename").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();

    expect(showPrompt).toHaveBeenCalledWith("New team name", "EWW");
    expect(api.renameTeam).toHaveBeenCalledWith("t1", "EWW Reloaded");
    expect(status()).not.toMatch(/^Error/);
  });

  test("the rename is callable without the dialog, for the folder right-click", async () => {
    // Renaming a team root folder IS renaming the team, so the library's
    // right-click reaches the same call rather than growing a second one that
    // could drift from it.
    const { promptRenameTeam } = require("../../../src/renderer/modules/team-modal.js");
    showPrompt.mockResolvedValue("EWW Reloaded");
    const onRefresh = jest.fn();

    const err = await promptRenameTeam("t1", { onRefresh });

    expect(showPrompt).toHaveBeenCalledWith("New team name", "EWW");
    expect(api.renameTeam).toHaveBeenCalledWith("t1", "EWW Reloaded");
    expect(onRefresh).toHaveBeenCalled();
    expect(err).toBeNull();
  });

  test("a failed rename hands the reason back rather than reporting it itself", async () => {
    // The two callers report differently — a status line in the dialog, a toast
    // in the library — and neither can show the other's.
    const { promptRenameTeam } = require("../../../src/renderer/modules/team-modal.js");
    showPrompt.mockResolvedValue("EWW Reloaded");
    api.renameTeam.mockRejectedValue(new Error("Only the owner can rename a team."));

    expect(await promptRenameTeam("t1", {})).toBe("Only the owner can rename a team.");
  });

  test("a refresh that throws does not make a completed rename look failed", async () => {
    const { promptRenameTeam } = require("../../../src/renderer/modules/team-modal.js");
    showPrompt.mockResolvedValue("EWW Reloaded");

    const err = await promptRenameTeam("t1", {
      onRefresh: async () => { throw new Error("library reload blew up"); },
    });

    expect(api.renameTeam).toHaveBeenCalled();
    expect(err).toBeNull();
  });

  test("cancelling the rename prompt changes nothing", async () => {
    showPrompt.mockResolvedValue(null);
    await openTeamModal("t1", { tab: "team" });
    await flush();
    act("rename").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();
    expect(api.renameTeam).not.toHaveBeenCalled();
  });

  test("an owner gets Delete team, and it closes the dialog once it lands", async () => {
    const onRefresh = jest.fn();
    await openTeamModal("t1", { tab: "team", onRefresh });
    await flush();
    expect(act("leave-team")).toBeFalsy();

    act("delete-team").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();

    expect(api.deleteTeam).toHaveBeenCalledWith("t1");
    expect(document.querySelector(".tm-overlay").className).toContain("tm-overlay--hidden");
    expect(onRefresh).toHaveBeenCalled();
  });

  test("Pull now pulls the team and refreshes the library", async () => {
    const onRefresh = jest.fn();
    await openTeamModal("t1", { tab: "team", onRefresh });
    await flush();
    act("pull").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();
    expect(api.pullTeam).toHaveBeenCalledWith("t1");
    expect(onRefresh).toHaveBeenCalled();
  });

  test("a caller's refresh throwing does not read as the action failing", async () => {
    await openTeamModal("t1", { tab: "team", onRefresh: async () => { throw new Error("boom"); } });
    await flush();
    act("pull").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();
    expect(status()).toBe("Up to date with the team.");
  });

  test("the People tab points at the access list rather than growing its own control", async () => {
    await openTeamModal("t1");
    await flush();
    act("go-access").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".tm-fa")).toBeTruthy();
    expect(tab("access").className).toContain("tm__tab--active");
  });
});

describe("as a member", () => {
  beforeEach(() => {
    state.folders = [{ ...ROOT, role: "member" }, RAIDS, WVW, DEEP];
    state.teams = [{ team: { id: "t1", name: "EWW" }, role: "member" }];
    state.teamSession = { userId: "u2", login: "vette" };
  });

  test("no invite code, no remove, no delete — Leave instead", async () => {
    await openTeamModal("t1");
    await flush();
    expect(document.querySelector("#tm-invite-code")).toBeNull();
    expect(document.querySelector('[data-act="remove-member"]')).toBeNull();
    expect(document.querySelector("#tm-role").textContent).toBe("You're a member");

    tab("team").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(act("delete-team")).toBeFalsy();
    act("leave-team").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(); await flush();
    expect(api.leaveTeam).toHaveBeenCalledWith("t1");
  });

  test("access shows their OWN levels — everyone else's are not theirs to see", async () => {
    api.listTeamGrants.mockResolvedValue({
      grants: [{ folderId: "raids", userId: "u2", access: "read" }], defaults: { member: "write" },
    });
    await openTeamModal("t1", { tab: "access" });
    await flush();
    expect(document.querySelector(".tm-fa")).toBeNull();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    const levels = [...document.querySelectorAll(".tm__mine")].map((r) => r.textContent.trim().replace(/\s+/g, " "));
    expect(levels).toEqual(["EWW Can edit", "Raids Read only", "WvW Can edit", "Squads Can edit"]);
  });
});

test("a team with no local root folder yet renders without a grid rather than throwing", async () => {
  state.folders = [];
  await openTeamModal("t1", { tab: "access" });
  await flush();
  expect(document.querySelector("#tm-body").textContent).toMatch(/Nothing is shared/);
});

// The dialog can be closed, or moved to another team, while the fetch is in
// flight; painting the previous team's people over the new one is worse than
// the loading state.
test("a load that lands after the dialog moved on is discarded", async () => {
  let release;
  api.listTeamMembers.mockImplementation(() => new Promise((r) => { release = () => r([{ userId: "zz", login: "ghost", role: "member" }]); }));
  const opening = openTeamModal("t1");
  closeTeamModal();
  release();
  await opening;
  await flush();
  expect(document.body.textContent).not.toContain("ghost");
});

test("Escape closes the dialog, and re-opening does not stack listeners", async () => {
  await openTeamModal("t1");
  await openTeamModal("t1");
  const removeSpy = jest.spyOn(document, "removeEventListener");
  closeTeamModal();
  expect(removeSpy.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);
  removeSpy.mockRestore();

  await openTeamModal("t1");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector(".tm-overlay").className).toContain("tm-overlay--hidden");
});
