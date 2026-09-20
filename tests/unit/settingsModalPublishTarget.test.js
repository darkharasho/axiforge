/** @jest-environment jsdom */
"use strict";

/**
 * Regression test: a user published a comp to their own GitHub instead of the
 * team's org. Root cause — picking an owner in Settings → Publishing only set
 * state.selectedTarget in memory. targetOwner was persisted solely as a side
 * effect of running "Setup Publishing", so selecting the org and closing the
 * dialog left publishing pointed at the personal account.
 */

const capturedSelects = [];
jest.mock("../../src/renderer/modules/state.js", () => ({
  state: { folders: [], teams: [], teamSession: null, outbox: {}, targets: [], selectedTarget: null, onboarding: null },
}));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({
  renderCustomSelect: jest.fn((host, opts) => { capturedSelects.push(opts); }),
}));
jest.mock("../../src/renderer/modules/utils.js", () => ({ escapeHtml: (s) => String(s), delay: () => Promise.resolve(), relativeTime: () => "just now" }));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../src/renderer/modules/choice-modal.js", () => ({ showChoiceModal: jest.fn() }));
jest.mock("../../src/renderer/modules/teams.js", () => ({ loadTeamState: jest.fn(async () => {}) }));
jest.mock("../../src/renderer/modules/team-modal.js", () => ({ initTeamModal: jest.fn(), openTeamModal: jest.fn(async () => {}) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("settings-modal — publish target picker", () => {
  let mod, api, state;

  beforeEach(async () => {
    jest.resetModules();
    capturedSelects.length = 0;
    document.body.innerHTML = "";
    ({ state } = require("../../src/renderer/modules/state.js"));
    state.targets = [
      { login: "me", type: "user" },
      { login: "gw2eww", type: "org" },
    ];
    state.selectedTarget = { login: "me", type: "user" };
    state.onboarding = { isAuthenticated: true, targetOwner: "me", targetOwnerType: "user", repoReady: true, pagesReady: true };

    api = {
      getSession: jest.fn(async () => ({ viewer: { login: "me" } })),
      getTeamSession: jest.fn(async () => null),
      listTeams: jest.fn(async () => []),
      listOutbox: jest.fn(async () => ({})),
      listFolders: jest.fn(async () => []),
      legacyLibraryStatus: jest.fn(async () => ({ hasLegacy: false })),
      getSetting: jest.fn(async () => null),
      listDiscordWebhooks: jest.fn(async () => []),
      getOnboardingStatus: jest.fn(async () => ({})),
      setPublishTarget: jest.fn(async (login, type) => ({
        isAuthenticated: true, targetOwner: login, targetOwnerType: type, repoReady: false, pagesReady: false,
      })),
    };
    window.desktopApi = api;

    mod = require("../../src/renderer/modules/settings-modal.js");
    mod.initSettingsModal();
    mod.initSettingsCallbacks({ refreshLibraryState: jest.fn(), navigateToPage: jest.fn(), refreshOnboardingStatus: jest.fn(), render: jest.fn() });
    mod.openSettingsModal({ initialPane: "publishing" });
    await flush();
  });

  function pickerOnChange() {
    const picker = capturedSelects.find((o) => o.className === "cselect--target");
    expect(picker).toBeTruthy();
    return picker.onChange;
  }

  test("the picker lists the user and every org they belong to", () => {
    const picker = capturedSelects.find((o) => o.className === "cselect--target");
    expect(picker.options.map((o) => o.value)).toEqual(["me", "gw2eww"]);
    expect(picker.options.find((o) => o.value === "gw2eww").meta).toBe("ORG");
  });

  test("selecting an org persists it immediately, with its owner type", async () => {
    await pickerOnChange()("gw2eww");
    await flush();
    expect(api.setPublishTarget).toHaveBeenCalledWith("gw2eww", "org");
  });

  test("the returned status replaces state.onboarding so the badges reflect the new owner", async () => {
    await pickerOnChange()("gw2eww");
    await flush();
    expect(state.onboarding.targetOwner).toBe("gw2eww");
    expect(state.onboarding.repoReady).toBe(false);
  });

  test("a failed persist does not throw or desync the in-memory selection", async () => {
    api.setPublishTarget.mockRejectedValue(new Error("offline"));
    await expect(pickerOnChange()("gw2eww")).resolves.toBeUndefined();
    expect(state.selectedTarget.login).toBe("gw2eww");
  });
});
