/** @jest-environment jsdom */
"use strict";

// The notes editor is shared between the Build Editor's Notes tab and the
// Comp detail Notes tab. It must therefore read and write through a caller
// supplied "doc" adapter rather than reaching into state.editor directly.

jest.mock("../../../src/renderer/modules/detail-panel.js", () => ({
  bindHoverPreview: jest.fn(),
}));
jest.mock("marked", () => ({ marked: { parse: (s) => s, use: jest.fn() } }));

const { state } = require("../../../src/renderer/modules/state.js");
const { createNotesEditor } = require("../../../src/renderer/modules/notes.js");

function makeDoc(initial = {}) {
  const doc = {
    text: initial.text || "",
    images: initial.images || null,
    changes: 0,
    getText: () => doc.text,
    setText: (v) => { doc.text = v; },
    getImages: () => doc.images,
    setImages: (v) => { doc.images = v; },
    onChange: () => { doc.changes += 1; },
  };
  return doc;
}

let mount;

beforeEach(() => {
  document.body.innerHTML = '<div id="mount"></div>';
  mount = document.getElementById("mount");
  state.editor = { notes: "UNTOUCHED", images: null };
});

describe("createNotesEditor", () => {
  test("seeds the textarea from the doc, not state.editor", () => {
    createNotesEditor(mount, makeDoc({ text: "hold mid" })).render();
    const ta = mount.querySelector(".notes-textarea");
    expect(ta).not.toBeNull();
    expect(ta.value).toBe("hold mid");
  });

  test("typing writes to the doc and leaves state.editor.notes alone", () => {
    const doc = makeDoc({ text: "" });
    createNotesEditor(mount, doc).render();

    const ta = mount.querySelector(".notes-textarea");
    ta.value = "push north";
    ta.dispatchEvent(new Event("input"));

    expect(doc.text).toBe("push north");
    expect(doc.changes).toBe(1);
    expect(state.editor.notes).toBe("UNTOUCHED");
  });

  test("toolbar insertion writes through the doc", () => {
    const doc = makeDoc({ text: "" });
    createNotesEditor(mount, doc).render();

    const boldBtn = mount.querySelector('.notes-toolbar__btn[title="Bold"]');
    expect(boldBtn).not.toBeNull();
    boldBtn.click();

    expect(doc.text).toBe("****");
    expect(state.editor.notes).toBe("UNTOUCHED");
  });

  test("read-only mode leaves the textarea uneditable", () => {
    createNotesEditor(mount, makeDoc({ text: "notes" }), { readOnly: true }).render();
    expect(mount.querySelector(".notes-textarea").readOnly).toBe(true);
  });

  test("accepts a custom placeholder", () => {
    createNotesEditor(mount, makeDoc(), { placeholder: "Comp notes..." }).render();
    expect(mount.querySelector(".notes-textarea").placeholder).toBe("Comp notes...");
  });
});

describe("switching between documents", () => {
  test("renderNotesPanel returns to the build editor's own panel", () => {
    const { initNotes, initNotesCallbacks, renderNotesPanel } = require("../../../src/renderer/modules/notes.js");
    const editorPanel = document.createElement("div");
    document.body.append(editorPanel);
    initNotes({ notesPanel: editorPanel });
    initNotesCallbacks({ markEditorChanged: () => {} });

    // Render a different document (a comp) into its own mount...
    createNotesEditor(mount, makeDoc({ text: "comp notes" })).render();
    expect(mount.querySelector(".notes-textarea").value).toBe("comp notes");

    // ...then go back to the build editor.
    state.editor.notes = "build notes";
    renderNotesPanel();

    expect(editorPanel.querySelector(".notes-textarea").value).toBe("build notes");
    expect(mount.querySelector(".notes-textarea").value).toBe("comp notes");
  });

  test("a read-only comp editor does not leave the build editor read-only", () => {
    const { initNotes, initNotesCallbacks, renderNotesPanel } = require("../../../src/renderer/modules/notes.js");
    const editorPanel = document.createElement("div");
    document.body.append(editorPanel);
    initNotes({ notesPanel: editorPanel });
    initNotesCallbacks({ markEditorChanged: () => {} });

    createNotesEditor(mount, makeDoc({ text: "comp" }), { readOnly: true }).render();
    renderNotesPanel();

    expect(editorPanel.querySelector(".notes-textarea").readOnly).toBe(false);
  });
});

describe("renderNotesPanel (build editor wrapper)", () => {
  test("still reads and writes state.editor", () => {
    const { initNotes, initNotesCallbacks, renderNotesPanel } = require("../../../src/renderer/modules/notes.js");
    const marked = jest.fn();
    initNotes({ notesPanel: mount });
    initNotesCallbacks({ markEditorChanged: marked });

    state.editor.notes = "build notes";
    renderNotesPanel();

    const ta = mount.querySelector(".notes-textarea");
    expect(ta.value).toBe("build notes");

    ta.value = "edited";
    ta.dispatchEvent(new Event("input"));
    expect(state.editor.notes).toBe("edited");
    expect(marked).toHaveBeenCalled();
  });
});
