"use strict";

// Tests for per-build/comp publish progress tracking (issue #79).
// render-pages.js uses ES module imports — transformed by babel-jest.

let renderPages;
let stateModule;

// Minimal DOM mock for the publish ticker
function makeStatusEl() {
  const children = [];
  return {
    innerHTML: "",
    textContent: "",
    dataset: {},
    append(...els) { children.push(...els); },
    querySelector(sel) {
      // Return a mock strip with rows for advancePublishStep
      if (sel === ".publish-ticker__strip") {
        return makeMockStrip();
      }
      if (sel === ".publish-result") {
        return { innerHTML: "", querySelector: () => null, append() {} };
      }
      if (sel === ".publish-ticker") {
        return { style: {} };
      }
      return null;
    },
    _children: children,
  };
}

function makeMockStrip() {
  const rows = [
    "saving", "loading", "repo", "site", "builds", "encrypt", "upload", "deploy", "pages",
  ].map((key) => ({
    dataset: { publishStep: key },
    classList: {
      _classes: new Set(["publish-ticker__row--pending"]),
      add(c) { this._classes.add(c); },
      remove(...cs) { cs.forEach((c) => this._classes.delete(c)); },
      contains(c) { return this._classes.has(c); },
    },
    querySelector: () => ({ textContent: "", innerHTML: "" }),
    innerHTML: "",
    append() {},
  }));
  return {
    querySelectorAll(sel) {
      if (sel === "[data-publish-step]") return rows;
      return [];
    },
    querySelector(sel) {
      const match = sel.match(/\[data-publish-step="(\w+)"\]/);
      if (match) return rows.find((r) => r.dataset.publishStep === match[1]) || null;
      return null;
    },
    style: {},
    _rows: rows,
  };
}

// Mock document.createElement used by showPublishProgress
function setupDocumentMock() {
  global.document = {
    createElement(tag) {
      const children = [];
      return {
        tagName: tag.toUpperCase(),
        className: "",
        textContent: "",
        innerHTML: "",
        title: "",
        value: "",
        readOnly: false,
        dataset: {},
        style: {},
        classList: {
          _classes: new Set(),
          add(c) { this._classes.add(c); },
          remove(c) { this._classes.delete(c); },
          toggle(c) { if (this._classes.has(c)) { this._classes.delete(c); return false; } else { this._classes.add(c); return true; } },
          contains(c) { return this._classes.has(c); },
        },
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        append(...els) { children.push(...els); },
        appendChild(el) { children.push(el); return el; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        select() {},
        _children: children,
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  global.location = { port: "", hostname: "app" };
}

beforeAll(() => {
  setupDocumentMock();
  // window.desktopApi stubs
  global.window = {
    desktopApi: {
      writeClipboardText: jest.fn(),
      pollPagesStatus: jest.fn().mockResolvedValue({ ready: false }),
      openPreviewWindow: jest.fn(),
    },
  };
  stateModule = require("../../../src/renderer/modules/state");
  renderPages = require("../../../src/renderer/modules/render-pages");
});

beforeEach(() => {
  // Reset publish progress state
  const { state } = stateModule;
  for (const key of Object.keys(state.publishProgress)) {
    delete state.publishProgress[key];
  }
  // Re-inject a fresh status element
  const el = makeStatusEl();
  renderPages.initRenderPagesDom({ publishStatus: el });
});

describe("per-ID publish progress", () => {
  test("state.publishProgress starts empty", () => {
    const { state } = stateModule;
    expect(state.publishProgress).toBeDefined();
    expect(Object.keys(state.publishProgress)).toHaveLength(0);
  });

  test("showPublishProgress(id) sets data-publish-id on the element", () => {
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });
    renderPages.showPublishProgress("build-123");
    expect(statusEl.dataset.publishId).toBe("build-123");
  });

  test("getPublishTargetId returns the current data-publish-id", () => {
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });
    expect(renderPages.getPublishTargetId()).toBeFalsy();
    renderPages.showPublishProgress("build-abc");
    expect(renderPages.getPublishTargetId()).toBe("build-abc");
  });

  test("setPublishStatus is no-op when active publish exists for current element", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    // Set up active publish
    state.publishProgress["build-x"] = { currentStep: "loading" };
    statusEl.dataset.publishId = "build-x";

    renderPages.setPublishStatus("Some message");
    // textContent should NOT be set since active publish blocks it
    expect(statusEl.textContent).toBe("");
  });

  test("setPublishStatus works when no active publish for current element", () => {
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    renderPages.setPublishStatus("Build duplicated.");
    expect(statusEl.textContent).toBe("Build duplicated.");
  });

  test("syncPublishStatus restores active publish or clears", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    // No active publish — should clear
    renderPages.syncPublishStatus("build-999");
    expect(statusEl.innerHTML).toBe("");
    expect(statusEl.dataset.publishId).toBeUndefined();

    // With active publish — should populate (showPublishProgress + advancePublishStep)
    state.publishProgress["build-999"] = { currentStep: "repo" };
    renderPages.syncPublishStatus("build-999");
    expect(statusEl.dataset.publishId).toBe("build-999");
  });

  test("restorePublishProgress with error state", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    state.publishProgress["build-err"] = {
      currentStep: "loading",
      error: { step: "loading", message: "Network error" },
    };
    renderPages.restorePublishProgress("build-err");
    expect(statusEl.dataset.publishId).toBe("build-err");
  });

  test("restorePublishProgress with completed result clears to done state", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    state.publishProgress["build-done"] = {
      currentStep: "pages",
      result: "complete",
    };
    renderPages.restorePublishProgress("build-done");
    expect(statusEl.dataset.publishId).toBe("build-done");
  });

  test("restorePublishProgress with no entry clears the element", () => {
    const statusEl = makeStatusEl();
    statusEl.innerHTML = "<div>old content</div>";
    statusEl.dataset.publishId = "old-id";
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    renderPages.restorePublishProgress("nonexistent-id");
    expect(statusEl.innerHTML).toBe("");
    expect(statusEl.dataset.publishId).toBeUndefined();
  });

  test("independent builds have separate publish progress entries", () => {
    const { state } = stateModule;

    state.publishProgress["build-a"] = { currentStep: "encrypt" };
    state.publishProgress["build-b"] = { currentStep: "saving" };

    expect(state.publishProgress["build-a"].currentStep).toBe("encrypt");
    expect(state.publishProgress["build-b"].currentStep).toBe("saving");

    // Updating one doesn't affect the other
    state.publishProgress["build-a"].currentStep = "upload";
    expect(state.publishProgress["build-a"].currentStep).toBe("upload");
    expect(state.publishProgress["build-b"].currentStep).toBe("saving");
  });

  test("independent comps have separate publish progress entries", () => {
    const { state } = stateModule;

    state.publishProgress["comp-1"] = { currentStep: "builds" };
    state.publishProgress["comp-2"] = { currentStep: "repo" };

    expect(state.publishProgress["comp-1"].currentStep).toBe("builds");
    expect(state.publishProgress["comp-2"].currentStep).toBe("repo");
  });

  test("clearPublishProgress clears both state and DOM", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    // Set up active publish state and DOM
    state.publishProgress["build-123"] = { currentStep: "saving" };
    statusEl.innerHTML = "<div>Publishing...</div>";
    statusEl.dataset.publishId = "build-123";

    // Clear it
    renderPages.clearPublishProgress("build-123");

    // Verify state is cleared
    expect(state.publishProgress["build-123"]).toBeUndefined();
    // Verify DOM is cleared
    expect(statusEl.innerHTML).toBe("");
    expect(statusEl.dataset.publishId).toBeUndefined();
  });

  test("clearPublishProgress is safe when publish entry doesn't exist", () => {
    const { state } = stateModule;
    const statusEl = makeStatusEl();
    renderPages.initRenderPagesDom({ publishStatus: statusEl });

    // Attempt to clear a non-existent entry
    statusEl.innerHTML = "<div>old</div>";
    statusEl.dataset.publishId = "old-id";

    renderPages.clearPublishProgress("nonexistent-id");

    // DOM should still be cleared
    expect(statusEl.innerHTML).toBe("");
    expect(statusEl.dataset.publishId).toBeUndefined();
  });
});

describe("resolvePublishedUrl", () => {
  let resolvePublishedUrl;

  beforeAll(() => {
    ({ resolvePublishedUrl } = renderPages);
  });

  const onboarding = { targetOwner: "personaluser", repoName: "axibuilds" };

  const personalBuild = {
    id: "b1",
    folderId: null,
    publishedSlug: "my-build",
    publishedFileId: "abc123",
    publishedKey: "key456",
  };

  const sharedBuild = {
    id: "b2",
    folderId: "folder-shared",
    publishedSlug: "my-shared-build",
    publishedFileId: "def789",
    publishedKey: "orgkey",
  };

  const folders = [
    { id: "folder-shared", parentId: null, shared: true, orgName: "myorg" },
    { id: "folder-sub", parentId: "folder-shared", shared: false },
  ];

  test("personal build uses personal owner", () => {
    const url = resolvePublishedUrl(personalBuild, onboarding, [], null);
    expect(url).toContain("personaluser.github.io/axibuilds");
    expect(url).toContain("my-build");
    expect(url).toContain("abc123.key456");
  });

  test("shared build uses org owner from folder", () => {
    const url = resolvePublishedUrl(sharedBuild, onboarding, folders, null);
    expect(url).toContain("myorg.github.io/axibuilds");
    expect(url).not.toContain("personaluser");
    expect(url).toContain("my-shared-build");
    expect(url).toContain("def789.orgkey");
  });

  test("build in subfolder of shared folder uses org owner", () => {
    const subBuild = { ...sharedBuild, folderId: "folder-sub" };
    const url = resolvePublishedUrl(subBuild, onboarding, folders, null);
    expect(url).toContain("myorg.github.io/axibuilds");
    expect(url).not.toContain("personaluser");
  });

  test("theme param is appended when provided", () => {
    const url = resolvePublishedUrl(personalBuild, onboarding, [], "dark");
    expect(url).toContain("&t=dark");
  });

  test("returns null when build has no publishedFileId", () => {
    const unpublished = { ...personalBuild, publishedFileId: null };
    expect(resolvePublishedUrl(unpublished, onboarding, [], null)).toBeNull();
  });

  test("returns null when owner and repo are not available", () => {
    expect(resolvePublishedUrl(personalBuild, {}, [], null)).toBeNull();
  });
});
