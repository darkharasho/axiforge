/**
 * @jest-environment jsdom
 */
"use strict";

// The four direct imports are only used inside event handlers / async render
// paths, never at module-init, so stub them to avoid pulling transitive deps.
jest.mock("../../src/renderer/modules/state.js", () => ({ state: {} }));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../src/renderer/modules/utils.js", () => ({
  escapeHtml: (s) => String(s),
  delay: () => Promise.resolve(),
}));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn() }));

describe("settings-modal — sidebar nav structure", () => {
  let initSettingsModal;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = "";
    ({ initSettingsModal } = require("../../src/renderer/modules/settings-modal.js"));
    initSettingsModal();
  });

  test("renders five nav items in order", () => {
    const items = [...document.querySelectorAll(".settings-modal__nav-item")];
    expect(items.map((b) => b.dataset.pane)).toEqual([
      "appearance", "discord", "publishing", "shared-library", "data",
    ]);
  });

  test("renders a matching pane for every nav item", () => {
    const panes = [...document.querySelectorAll(".settings-modal__pane")];
    expect(panes.map((p) => p.dataset.pane).sort()).toEqual(
      ["appearance", "data", "discord", "publishing", "shared-library"]
    );
  });

  test("appearance is the default active nav item and pane", () => {
    const activeNav = document.querySelector(".settings-modal__nav-item--active");
    expect(activeNav.dataset.pane).toBe("appearance");
    const activePane = document.querySelector(".settings-modal__pane--active");
    expect(activePane.dataset.pane).toBe("appearance");
  });

  test("preserves every wired element ID", () => {
    for (const id of [
      "sm-close", "sm-theme-grid", "sm-target-picker", "sm-setup-row",
      "sm-comp-webhooks", "sm-add-comp-webhook", "sm-build-webhooks",
      "sm-add-build-webhook", "sm-save-status", "sm-clear-cache", "sm-cache-status",
      "sm-shared-status", "sm-shared-setup", "sm-shared-connected", "sm-org-select",
      "sm-shared-connect", "sm-shared-disconnect", "sm-shared-org-name", "sm-themed-builds",
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});
