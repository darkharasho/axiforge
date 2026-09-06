/** @jest-environment jsdom */
"use strict";

// Comp notes support Discord-style class emoji: typing ":fire" opens a
// typeahead of profession / elite-spec names, and ":Firebrand:" renders as the
// class icon in the preview.

jest.mock("../../../src/renderer/modules/detail-panel.js", () => ({
  bindHoverPreview: jest.fn(),
}));
jest.mock("marked", () => ({ marked: { parse: (s) => `<p>${s}</p>`, use: jest.fn() } }));

const { createNotesEditor } = require("../../../src/renderer/modules/notes.js");

function makeDoc(text = "") {
  const doc = {
    text,
    getText: () => doc.text,
    setText: (v) => { doc.text = v; },
    getImages: () => null,
    setImages: () => {},
    onChange: () => {},
  };
  return doc;
}

let mount;

beforeEach(() => {
  document.body.innerHTML = '<div id="mount"></div>';
  mount = document.getElementById("mount");
});

afterEach(() => {
  // Close the popup through the editor so its module-level reference is cleared
  // too — ripping the node out of the DOM would leave a stale one behind.
  document.querySelectorAll(".notes-textarea").forEach((ta) => {
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
});

function type(textarea, value) {
  textarea.value = value;
  textarea.selectionStart = textarea.selectionEnd = value.length;
  textarea.dispatchEvent(new Event("input"));
}

describe("class emoji typeahead", () => {
  test("typing :fire offers Firebrand", () => {
    createNotesEditor(mount, makeDoc(), { classEmoji: true }).render();
    type(mount.querySelector(".notes-textarea"), ":fire");

    const popup = document.querySelector(".notes-autocomplete");
    expect(popup).not.toBeNull();
    const names = [...popup.querySelectorAll(".notes-autocomplete__item-name")].map((n) => n.textContent);
    expect(names).toContain("Firebrand");
  });

  test("picking a result inserts the :Name: token", () => {
    const doc = makeDoc();
    createNotesEditor(mount, doc, { classEmoji: true }).render();
    const ta = mount.querySelector(".notes-textarea");
    type(ta, ":firebrand");

    const row = [...document.querySelectorAll(".notes-autocomplete__item")]
      .find((r) => r.textContent.includes("Firebrand"));
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(ta.value).toBe(":Firebrand: ");
    expect(doc.text).toBe(":Firebrand: ");
  });

  test("a colon straight after a word does not open the typeahead", () => {
    createNotesEditor(mount, makeDoc(), { classEmoji: true }).render();
    type(mount.querySelector(".notes-textarea"), "Note:fire");
    expect(document.querySelector(".notes-autocomplete")).toBeNull();
  });

  test("the typeahead stays off when the editor does not opt in", () => {
    createNotesEditor(mount, makeDoc(), {}).render();
    type(mount.querySelector(".notes-textarea"), ":fire");
    expect(document.querySelector(".notes-autocomplete")).toBeNull();
  });
});

describe("class emoji preview rendering", () => {
  function preview(text) {
    createNotesEditor(mount, makeDoc(text), { readOnly: true }).render();
    return mount.querySelector(".notes-preview");
  }

  test("renders :Firebrand: as a class icon", () => {
    const el = preview("Bring :Firebrand: for quickness");
    const icon = el.querySelector(".notes-emoji");
    expect(icon).not.toBeNull();
    expect(icon.dataset.name).toBe("Firebrand");
    expect(el.textContent).not.toMatch(/:Firebrand:/);
  });

  test("matches the name case-insensitively", () => {
    expect(preview(":firebrand:").querySelector(".notes-emoji").dataset.name).toBe("Firebrand");
  });

  test("leaves unknown :tokens: alone", () => {
    const el = preview("ping :everyone: now");
    expect(el.querySelector(".notes-emoji")).toBeNull();
    expect(el.textContent).toMatch(/:everyone:/);
  });

  test("renders class icons even when the typeahead is off", () => {
    // Build notes can still contain a class emoji pasted from a comp.
    expect(preview(":Reaper:").querySelector(".notes-emoji")).not.toBeNull();
  });
});
