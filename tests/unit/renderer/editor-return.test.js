/** @jest-environment jsdom */
"use strict";

const { describeEditorOrigin, nextEditorReturn } =
  require("../../../src/renderer/modules/editor-return.js");

const baseState = (over = {}) => ({
  activePage: "library",
  editorReturn: null,
  currentFolder: null,
  folders: [],
  compPage: "list",
  activeComp: null,
  ...over,
});

describe("describeEditorOrigin", () => {
  test("the library root is just 'Library'", () => {
    expect(describeEditorOrigin(baseState(), "library")).toBe("Library");
  });

  test("a custom folder is named, so back says where it goes", () => {
    const state = baseState({
      currentFolder: { type: "custom", id: "f1" },
      folders: [{ id: "f1", name: "Raids" }],
    });
    expect(describeEditorOrigin(state, "library")).toBe("Raids");
  });

  test("a folder id that no longer resolves falls back to 'Library'", () => {
    // The folder can be deleted by a teammate's sync between opening the build
    // and reading the label; a missing folder must not blank the button out.
    const state = baseState({ currentFolder: { type: "custom", id: "gone" }, folders: [] });
    expect(describeEditorOrigin(state, "library")).toBe("Library");
  });

  test("smart folders are not named — they are still the library", () => {
    const state = baseState({ currentFolder: { type: "smart-profession", id: "guardian" } });
    expect(describeEditorOrigin(state, "library")).toBe("Library");
  });

  test("an open comp is named", () => {
    const state = baseState({
      compPage: "detail",
      activeComp: { id: "c1", name: "Zerg Frontline" },
    });
    expect(describeEditorOrigin(state, "comps")).toBe("Zerg Frontline");
  });

  test("the comp list is just 'Comps'", () => {
    expect(describeEditorOrigin(baseState(), "comps")).toBe("Comps");
  });

  test("an unnamed comp still gets a label rather than an empty button", () => {
    const state = baseState({ compPage: "detail", activeComp: { id: "c1" } });
    expect(describeEditorOrigin(state, "comps")).toBe("Comp");
  });

  test("pages with nowhere to go back to return null", () => {
    expect(describeEditorOrigin(baseState(), "editor")).toBeNull();
    expect(describeEditorOrigin(baseState(), "settings")).toBeNull();
  });
});

describe("nextEditorReturn", () => {
  test("opening the editor from the library remembers the library", () => {
    const state = baseState({
      activePage: "library",
      currentFolder: { type: "custom", id: "f1" },
      folders: [{ id: "f1", name: "Raids" }],
    });
    expect(nextEditorReturn(state, "editor")).toEqual({ page: "library", label: "Raids" });
  });

  test("opening the editor from a comp remembers that comp", () => {
    const state = baseState({
      activePage: "comps",
      compPage: "detail",
      activeComp: { id: "c1", name: "Zerg Frontline" },
    });
    expect(nextEditorReturn(state, "editor")).toEqual({ page: "comps", label: "Zerg Frontline" });
  });

  test("navigating within the editor keeps the original origin", () => {
    // Anything that re-navigates to the editor while already there (game-mode
    // sync, a reload of the same page) must not overwrite the origin with the
    // editor itself, which would point 'back' at where you already are.
    const state = baseState({
      activePage: "editor",
      editorReturn: { page: "library", label: "Raids" },
    });
    expect(nextEditorReturn(state, "editor")).toEqual({ page: "library", label: "Raids" });
  });

  test("leaving the editor clears the return", () => {
    const state = baseState({
      activePage: "editor",
      editorReturn: { page: "library", label: "Raids" },
    });
    expect(nextEditorReturn(state, "comps")).toBeNull();
  });

  test("the editor as a cold start offers no way back", () => {
    // Nothing was open before, so there is no origin to return to.
    const state = baseState({ activePage: "editor", editorReturn: null });
    expect(nextEditorReturn(state, "editor")).toBeNull();
  });
});
