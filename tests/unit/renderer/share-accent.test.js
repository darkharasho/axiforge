/** @jest-environment jsdom */
"use strict";

// Pins currentShareAccent() — the single reader of data-axi-accent for the
// ?t= publish parameter — against a real DOM, not a hand-rolled stub, so a
// regression to the old data-theme attribute name would fail this test.

const renderPages = require("../../../src/renderer/modules/render-pages.js");

describe("currentShareAccent", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-axi-accent");
  });

  test("reads the accent id from the document element", () => {
    document.documentElement.setAttribute("data-axi-accent", "teal-ocean");
    expect(renderPages.currentShareAccent()).toBe("teal-ocean");

    const onboarding = { targetOwner: "personaluser", repoName: "axibuilds" };
    const build = {
      id: "b1",
      folderId: null,
      publishedSlug: "my-build",
      publishedFileId: "abc123",
      publishedKey: "key456",
    };
    const url = renderPages.resolvePublishedUrl(build, onboarding, [], renderPages.currentShareAccent());
    expect(url.endsWith("&t=teal-ocean")).toBe(true);
  });

  test("returns null and omits the t param when no accent is set", () => {
    expect(renderPages.currentShareAccent()).toBeNull();

    const onboarding = { targetOwner: "personaluser", repoName: "axibuilds" };
    const build = {
      id: "b1",
      folderId: null,
      publishedSlug: "my-build",
      publishedFileId: "abc123",
      publishedKey: "key456",
    };
    const url = renderPages.resolvePublishedUrl(build, onboarding, [], renderPages.currentShareAccent());
    expect(url).not.toContain("&t=");
  });
});
