/**
 * @jest-environment jsdom
 *
 * Copy link from the library menu runs the action the editor's button would
 * show for that build, through renderer.js (axi:publish-action).
 */
"use strict";

let callbacks;
jest.mock("../../../src/renderer/modules/library/context-menu.js", () => ({
  initContextMenu: (cb) => { callbacks = cb; },
  wireContextMenuEvents: jest.fn(),
  closeMenu: jest.fn(),
}));

const { state } = require("../../../src/renderer/modules/state.js");
const { initLibrary } = require("../../../src/renderer/modules/library/library.js");

const CONNECTED = { isAuthenticated: true, repoReady: true };
let seen;
const onAction = (e) => seen.push(e.detail);

beforeAll(async () => {
  window.desktopApi = new Proxy({}, { get: () => jest.fn(async () => []) });
  await initLibrary({});
  window.addEventListener("axi:publish-action", onAction);
});
afterAll(() => window.removeEventListener("axi:publish-action", onAction));

beforeEach(() => {
  seen = [];
  state.onboarding = CONNECTED;
  state.publishQueue = { items: {} };
  state.builds = [
    { id: "never", title: "Fresh" },
    { id: "stale", publishedFileId: "f", publishedHash: "old", contentHash: "new", publishedOwner: "guildie" },
  ];
});

test("a never-published build copies (main publishes it first)", () => {
  callbacks.onPublish("never");
  expect(seen).toEqual([{ action: "copy", kind: "build", id: "never", owner: "" }]);
});

test("a stale build publishes its latest save before copying", () => {
  callbacks.onPublish("stale");
  expect(seen).toEqual([{ action: "publish-and-copy", kind: "build", id: "stale", owner: "guildie" }]);
});

test("an unconnected account goes to publishing setup", () => {
  state.onboarding = { isAuthenticated: false };
  callbacks.onPublish("never");
  expect(seen[0].action).toBe("setup");
});

test("a failed upload retries", () => {
  state.publishQueue = { items: { "build:never": { state: "failed", error: "boom" } } };
  callbacks.onPublish("never");
  expect(seen[0].action).toBe("retry");
});
