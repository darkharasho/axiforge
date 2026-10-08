/** @jest-environment jsdom */
"use strict";

jest.mock("../../../src/renderer/modules/settings-modal.js", () => ({ openSettingsModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/render-pages.js", () => ({ signInAndRefresh: jest.fn(async () => true) }));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../../src/renderer/modules/library/toast.js", () => ({ showToast: jest.fn() }));

const { state } = require("../../../src/renderer/modules/state.js");
const { applyPublishSnapshot, isPublishInFlight, publishButtonDeps } = require("../../../src/renderer/modules/publish-actions.js");
const { openSettingsModal } = require("../../../src/renderer/modules/settings-modal.js");
const { signInAndRefresh } = require("../../../src/renderer/modules/render-pages.js");
const { showConfirmModal } = require("../../../src/renderer/modules/confirm-modal.js");

beforeEach(() => {
  jest.clearAllMocks();
  state.onboarding = { isAuthenticated: true, repoReady: false };
  window.desktopApi = {
    listBuilds: jest.fn(async () => [{ id: "b1", publishedFileId: "f", publishedHash: "h" }]),
    listComps: jest.fn(async () => [{ id: "c1", name: "Raid", publishedFileId: "cf", notes: "stored" }]),
    getOnboardingStatus: jest.fn(async () => ({ isAuthenticated: true, repoReady: true })),
  };
  state.builds = [{ id: "b1" }];
  state.comps = [];
  state.activeComp = { id: "c1", name: "Raid", notes: "typing…" };
});

test("a snapshot is stored; lists reload only when something was published", async () => {
  await expect(applyPublishSnapshot({ items: { "build:b1": { state: "queued" } }, paused: null, published: [] })).resolves.toBe(false);
  expect(state.publishQueue.items["build:b1"].state).toBe("queued");
  expect(window.desktopApi.listBuilds).not.toHaveBeenCalled();

  await expect(applyPublishSnapshot({ items: {}, paused: null, published: ["build:b1", "comp:c1"] })).resolves.toBe(true);
  expect(state.builds[0].publishedFileId).toBe("f");
});

test("the open comp takes the new receipt but keeps its unsaved fields", async () => {
  await applyPublishSnapshot({ items: {}, paused: null, published: ["comp:c1"] });
  expect(state.activeComp).toMatchObject({ publishedFileId: "cf", notes: "typing…" });
});

// The comp board's Published Link unlocks from state.activeComp when
// renderer.js fires axi:publish-status, which it does only after this resolves.
test("a first publish puts the whole receipt on the open comp before resolving", async () => {
  const receipt = {
    publishedFileId: "cf", publishedKey: "k", publishedSlug: "s", publishedAt: "2026-10-08T00:00:00.000Z",
    publishedOwner: "me", publishedHash: "h2", publishedMemberHashes: { b1: "m" }, publishedFormat: 2,
  };
  window.desktopApi.listComps = jest.fn(async () => [{ id: "c1", name: "Raid", notes: "stored", ...receipt }]);
  state.activeComp = { id: "c1", name: "Raid", notes: "typing…" };
  await applyPublishSnapshot({ items: {}, paused: null, published: ["comp:c1"] });
  expect(state.activeComp).toEqual({ id: "c1", name: "Raid", notes: "typing…", ...receipt });
});

test("isPublishInFlight", async () => {
  await applyPublishSnapshot({ items: { "build:a": { state: "publishing" }, "build:b": { state: "failed" } }, paused: null, published: [] });
  expect(isPublishInFlight("build", "a")).toBe(true);
  expect(isPublishInFlight("build", "b")).toBe(false);
  expect(isPublishInFlight("comp", "x")).toBe(false);
});

describe("Set up publishing", () => {
  test("signed in: confirming the explainer opens the Publishing settings pane", async () => {
    await publishButtonDeps().openSetup();
    expect(signInAndRefresh).not.toHaveBeenCalled();
    expect(showConfirmModal).toHaveBeenCalledWith(expect.objectContaining({ title: "Publishing puts your build online" }));
    expect(showConfirmModal.mock.calls[0][0].body).toMatch(/publishes automatically/);
    expect(openSettingsModal).toHaveBeenCalledWith({ initialPane: "publishing" });
  });

  test("cancelling the explainer stops before the settings pane", async () => {
    showConfirmModal.mockResolvedValueOnce(false);
    await publishButtonDeps().openSetup();
    expect(openSettingsModal).not.toHaveBeenCalled();
  });

  test("signed out: sign-in runs first, then the explainer and pane", async () => {
    state.onboarding = { isAuthenticated: false };
    signInAndRefresh.mockImplementationOnce(async () => {
      expect(showConfirmModal).not.toHaveBeenCalled();
      state.onboarding = { isAuthenticated: true, repoReady: false };
      return true;
    });
    await publishButtonDeps().openSetup();
    expect(signInAndRefresh).toHaveBeenCalledTimes(1);
    expect(showConfirmModal).toHaveBeenCalled();
    expect(openSettingsModal).toHaveBeenCalledWith({ initialPane: "publishing" });
  });

  test("signed out: a cancelled sign-in stops", async () => {
    state.onboarding = { isAuthenticated: false };
    signInAndRefresh.mockResolvedValueOnce(false);
    await publishButtonDeps().openSetup();
    expect(showConfirmModal).not.toHaveBeenCalled();
    expect(openSettingsModal).not.toHaveBeenCalled();
  });

  test("signed out: a failed sign-in stops and surfaces the error", async () => {
    state.onboarding = { isAuthenticated: false };
    signInAndRefresh.mockRejectedValueOnce(new Error("denied"));
    await expect(publishButtonDeps().openSetup()).rejects.toThrow("denied");
    expect(showConfirmModal).not.toHaveBeenCalled();
    expect(openSettingsModal).not.toHaveBeenCalled();
  });

  test("signing in to an account that already publishes needs no setup", async () => {
    state.onboarding = { isAuthenticated: false };
    signInAndRefresh.mockImplementationOnce(async () => {
      state.onboarding = { isAuthenticated: true, repoReady: true };
      return true;
    });
    await publishButtonDeps().openSetup();
    expect(showConfirmModal).not.toHaveBeenCalled();
    expect(openSettingsModal).not.toHaveBeenCalled();
  });
});

test("Sign in to publish goes through the shared sign-in + refresh path", async () => {
  await publishButtonDeps().signIn();
  expect(signInAndRefresh).toHaveBeenCalledTimes(1);
});
