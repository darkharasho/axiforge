/**
 * @jest-environment jsdom
 *
 * Publish on save: the library menu's Publish became "Copy link". It asks
 * renderer.js to run the same action the editor's button would (a stale build
 * publishes before copying; an unconnected account goes to setup), and its
 * share gate knows an upload in flight doesn't block sharing.
 */
"use strict";

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: {
    folders: [], builds: [], comps: [], teams: [], teamSession: null, outbox: {},
    folderSyncStatus: {}, buildSyncStatus: {}, compSyncStatus: {}, conflicts: {},
    currentFolder: null, onboarding: null, publishQueue: { items: {} },
  },
}));
jest.mock("../../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/share-modal.js", () => ({ openShareModal: jest.fn() }));
jest.mock("../../../src/renderer/modules/library/selection.js", () => ({
  isSelected: jest.fn(() => false),
  getSelection: jest.fn(() => []),
  isCompSelected: jest.fn(() => false),
  getCompSelection: jest.fn(() => []),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { wireContextMenuEvents, closeMenu, initContextMenu } =
  require("../../../src/renderer/modules/library/context-menu.js");

const NEVER = { id: "b1", title: "Fresh" };

function openBuildMenu(buildId) {
  document.body.innerHTML = `<div id="lib-content"><div data-build-id="${buildId}">row</div></div>`;
  wireContextMenuEvents();
  document.querySelector(`[data-build-id="${buildId}"]`)
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  return document.querySelector(".lib-ctx-menu");
}

// The Share to Discord items live in a submenu that opens on hover.
function discordItem(menu, label) {
  itemFor(menu, "Share to Discord").dispatchEvent(new MouseEvent("mouseenter"));
  return itemFor(document.body, label);
}

function itemFor(menu, label) {
  return [...menu.querySelectorAll(".lib-ctx-item")]
    .find((el) => el.querySelector(".lib-ctx-item__label")?.textContent === label);
}

let onPublish;
beforeEach(() => {
  closeMenu();
  state.builds = [NEVER];
  state.publishQueue = { items: {} };
  onPublish = jest.fn();
  initContextMenu({ onPublish });
});

test("the build menu offers Copy link, not Publish, and it calls onPublish", () => {
  const menu = openBuildMenu("b1");
  expect(itemFor(menu, "Publish")).toBeUndefined();
  itemFor(menu, "Copy link").click();
  expect(onPublish).toHaveBeenCalledWith("b1");
});

test("the Discord submenu's copy item says what it copies, so it can't be mistaken for Copy link", () => {
  const menu = openBuildMenu("b1");
  expect(discordItem(menu, "Copy Discord text")).toBeDefined();
  expect(itemFor(document.body, "Copy Link")).toBeUndefined();
});

test("Discord share stays enabled while the build's first upload is in flight", () => {
  expect(discordItem(openBuildMenu("b1"), "Discord Embed").title).toBe("Not published yet — Copy link publishes it");
  closeMenu();
  state.publishQueue = { items: { "build:b1": { state: "publishing" } } };
  const embed = discordItem(openBuildMenu("b1"), "Discord Embed");
  expect(embed.classList.contains("lib-ctx-item--disabled")).toBe(false);
});
