"use strict";

const { state, createEmptyEditor } = require("../../../src/renderer/modules/state");
const { serializeEditorToBuild, loadBuildIntoEditor } = require("../../../src/renderer/modules/editor");

// Ensure a minimal editor exists before each test
beforeEach(() => {
  state.editor = createEmptyEditor("Warrior");
  state.activeCatalog = null;
});

describe("serializeEditorToBuild — folderId / compId", () => {
  test("includes folderId when set on the editor", () => {
    state.editor.folderId = "folder-abc";
    const result = serializeEditorToBuild();
    expect(result.folderId).toBe("folder-abc");
  });

  test("includes compId when set on the editor", () => {
    state.editor.compId = "comp-xyz";
    const result = serializeEditorToBuild();
    expect(result.compId).toBe("comp-xyz");
  });

  test("omits folderId and compId when not set", () => {
    const result = serializeEditorToBuild();
    expect(result.folderId).toBeUndefined();
    expect(result.compId).toBeUndefined();
  });
});

describe("loadBuildIntoEditor — preserves compId / folderId", () => {
  test("round-trip: compId and folderId survive load → serialize", async () => {
    const build = {
      id: "build-1",
      title: "My Build",
      profession: "Warrior",
      compId: "comp-abc",
      folderId: "folder-def",
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });
    const result = serializeEditorToBuild();
    expect(result.compId).toBe("comp-abc");
    expect(result.folderId).toBe("folder-def");
  });

  test("round-trip: renaming does not lose compId", async () => {
    const build = {
      id: "build-2",
      title: "Original Name",
      profession: "Warrior",
      compId: "comp-xyz",
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });
    state.editor.title = "Renamed Build";
    const result = serializeEditorToBuild();
    expect(result.title).toBe("Renamed Build");
    expect(result.compId).toBe("comp-xyz");
  });
});
