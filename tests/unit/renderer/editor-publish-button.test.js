/** @jest-environment jsdom */
"use strict";

const { editorPublishView } = require("../../../src/renderer/modules/render-pages.js");
const { state } = require("../../../src/renderer/modules/state.js");

beforeEach(() => {
  state.onboarding = { isAuthenticated: true, repoReady: true };
  state.editor = { id: "b1", title: "X" };
  state.builds = [{ id: "b1", publishedFileId: "f", publishedHash: "h", contentHash: "h" }];
  state.publishQueue = { items: {}, paused: null, published: [] };
});

test("an upload in flight for the open build reads Publishing…", () => {
  state.publishQueue = { items: { "build:b1": { state: "publishing" } }, paused: null, published: [] };
  expect(editorPublishView()).toMatchObject({ label: "Publishing…", action: "copy" });
});

test("a current build reads Copy link ✓", () => {
  expect(editorPublishView()).toMatchObject({ label: "Copy link", tone: "ok", icon: "check" });
});

test("another build's queue state does not leak onto the open one", () => {
  state.publishQueue = { items: { "build:other": { state: "failed", error: "x" } }, paused: null, published: [] };
  expect(editorPublishView()).toMatchObject({ label: "Copy link", tone: "ok" });
});

test("a new, unsaved build reads as never published", () => {
  state.editor = { id: null };
  expect(editorPublishView()).toMatchObject({ label: "Copy link", action: "copy", icon: "" });
});
