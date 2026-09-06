/** @jest-environment jsdom */
"use strict";

// Comp notes live in their own tab alongside the comp board, backed by the
// same editor the Build Editor's Notes tab uses.

jest.mock("../../../src/renderer/modules/detail-panel.js", () => ({
  bindHoverPreview: jest.fn(),
}));
jest.mock("marked", () => ({ marked: { parse: (s) => s, use: jest.fn() } }));

const {
  renderCompTabs,
  createCompNotesDoc,
  mountCompNotes,
} = require("../../../src/renderer/modules/comps/comp-notes.js");

describe("renderCompTabs", () => {
  test("renders a Comp tab and a Notes tab", () => {
    const host = document.createElement("div");
    host.innerHTML = renderCompTabs("comp");
    const tabs = [...host.querySelectorAll("[data-comp-tab]")];
    expect(tabs.map((t) => t.dataset.compTab)).toEqual(["comp", "notes"]);
    expect(tabs.map((t) => t.textContent.trim())).toEqual(["Comp", "Notes"]);
  });

  test("marks the active tab", () => {
    const host = document.createElement("div");
    host.innerHTML = renderCompTabs("notes");
    const active = host.querySelectorAll(".comp-detail__tab--active");
    expect(active.length).toBe(1);
    expect(active[0].dataset.compTab).toBe("notes");
  });

  test("defaults to the comp tab for an unknown value", () => {
    const host = document.createElement("div");
    host.innerHTML = renderCompTabs(undefined);
    expect(host.querySelector(".comp-detail__tab--active").dataset.compTab).toBe("comp");
  });

  test("shows a dot on the Notes tab when the comp has notes", () => {
    const withNotes = document.createElement("div");
    withNotes.innerHTML = renderCompTabs("comp", { hasNotes: true });
    expect(withNotes.querySelector(".comp-detail__tab-dot")).not.toBeNull();

    const without = document.createElement("div");
    without.innerHTML = renderCompTabs("comp", { hasNotes: false });
    expect(without.querySelector(".comp-detail__tab-dot")).toBeNull();
  });
});

describe("createCompNotesDoc", () => {
  test("reads and writes comp.notes", () => {
    const comp = { id: "c1", notes: "hold mid" };
    const doc = createCompNotesDoc(comp, () => {});
    expect(doc.getText()).toBe("hold mid");
    doc.setText("push north");
    expect(comp.notes).toBe("push north");
  });

  test("returns an empty string for a comp with no notes", () => {
    expect(createCompNotesDoc({ id: "c1" }, () => {}).getText()).toBe("");
  });

  test("reads and writes comp.images", () => {
    const comp = { id: "c1" };
    const doc = createCompNotesDoc(comp, () => {});
    expect(doc.getImages()).toBeUndefined();
    doc.setImages({ 1: "data:image/jpeg;base64,AAAA" });
    expect(comp.images).toEqual({ 1: "data:image/jpeg;base64,AAAA" });
  });

  test("notifies the caller on change so the comp gets saved", () => {
    const comp = { id: "c1", notes: "" };
    const onChange = jest.fn();
    const doc = createCompNotesDoc(comp, onChange);
    doc.setText("x");
    doc.onChange();
    expect(onChange).toHaveBeenCalledWith(comp);
  });
});

describe("mountCompNotes", () => {
  afterEach(() => {
    document.querySelectorAll(".notes-textarea").forEach((ta) => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
  });

  test("offers the class emoji typeahead", () => {
    document.body.innerHTML = '<div id="mount"></div>';
    mountCompNotes(document.getElementById("mount"), { id: "c1", notes: "" }, () => {});

    const ta = document.querySelector(".notes-textarea");
    ta.value = ":fire";
    ta.selectionStart = ta.selectionEnd = 5;
    ta.dispatchEvent(new Event("input"));

    const names = [...document.querySelectorAll(".notes-autocomplete__item-name")].map((n) => n.textContent);
    expect(names).toContain("Firebrand");
  });
});
