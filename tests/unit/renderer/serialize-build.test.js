"use strict";

const { state, createEmptyEditor } = require("../../../src/renderer/modules/state");
const { serializeEditorToBuild, loadBuildIntoEditor } = require("../../../src/renderer/modules/editor");

// Ensure a minimal editor exists before each test
beforeEach(() => {
  state.editor = createEmptyEditor("Warrior");
  state.activeCatalog = null;
});

describe("serializeEditorToBuild — folderId / compIds", () => {
  test("includes folderId when set on the editor", () => {
    state.editor.folderId = "folder-abc";
    const result = serializeEditorToBuild();
    expect(result.folderId).toBe("folder-abc");
  });

  test("includes compIds when set on the editor", () => {
    state.editor.compIds = ["comp-xyz", "comp-abc"];
    const result = serializeEditorToBuild();
    expect(result.compIds).toEqual(["comp-xyz", "comp-abc"]);
  });

  test("includes activeCompId in compIds when set", () => {
    state.editor.activeCompId = "comp-new";
    const result = serializeEditorToBuild();
    expect(result.compIds).toEqual(["comp-new"]);
  });

  test("activeCompId merges with existing compIds without duplicates", () => {
    state.editor.compIds = ["comp-a"];
    state.editor.activeCompId = "comp-a";
    const result = serializeEditorToBuild();
    expect(result.compIds).toEqual(["comp-a"]);
  });

  test("omits folderId and compIds when not set", () => {
    const result = serializeEditorToBuild();
    expect(result.folderId).toBeUndefined();
    expect(result.compIds).toBeUndefined();
  });
});

describe("loadBuildIntoEditor — preserves compIds / folderId", () => {
  test("round-trip: compIds and folderId survive load → serialize", async () => {
    const build = {
      id: "build-1",
      title: "My Build",
      profession: "Warrior",
      compIds: ["comp-abc"],
      folderId: "folder-def",
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });
    const result = serializeEditorToBuild();
    expect(result.compIds).toEqual(["comp-abc"]);
    expect(result.folderId).toBe("folder-def");
  });

  test("round-trip: renaming does not lose compIds", async () => {
    const build = {
      id: "build-2",
      title: "Original Name",
      profession: "Warrior",
      compIds: ["comp-xyz"],
    };
    await loadBuildIntoEditor(build, { captureBaseline: false });
    state.editor.title = "Renamed Build";
    const result = serializeEditorToBuild();
    expect(result.title).toBe("Renamed Build");
    expect(result.compIds).toEqual(["comp-xyz"]);
  });
});
