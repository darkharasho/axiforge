/** @jest-environment jsdom */
"use strict";

jest.mock("../../../src/renderer/modules/settings-modal.js", () => ({ openSettingsModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/render-pages.js", () => ({ startLoginFlow: jest.fn(async () => {}) }));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn(async () => true) }));
jest.mock("../../../src/renderer/modules/library/toast.js", () => ({ showToast: jest.fn() }));

const { state } = require("../../../src/renderer/modules/state.js");
const { applyPublishSnapshot, isPublishInFlight, publishButtonDeps } = require("../../../src/renderer/modules/publish-actions.js");
const { openSettingsModal } = require("../../../src/renderer/modules/settings-modal.js");

beforeEach(() => {
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

test("isPublishInFlight", async () => {
  await applyPublishSnapshot({ items: { "build:a": { state: "publishing" }, "build:b": { state: "failed" } }, paused: null, published: [] });
  expect(isPublishInFlight("build", "a")).toBe(true);
  expect(isPublishInFlight("build", "b")).toBe(false);
  expect(isPublishInFlight("comp", "x")).toBe(false);
});

test("setup opens the Publishing settings pane", async () => {
  await publishButtonDeps().openSetup();
  expect(openSettingsModal).toHaveBeenCalledWith({ initialPane: "publishing" });
});
