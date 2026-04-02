"use strict";

// Test that the underline toolbar action wraps selected text with <u></u>
// and does not delete the selection.
//
// Bug: insertMarkdown only preserved selected text for "bold" and "italic",
// dropping it for "underline" and other inline actions.

jest.mock("../../../src/renderer/modules/state.js", () => ({
  state: { editor: { notes: "" } },
}));
jest.mock("../../../src/renderer/modules/detail-panel.js", () => ({
  bindHoverPreview: jest.fn(),
}));
jest.mock("../../../src/renderer/modules/utils.js", () => ({
  decodeHtmlEntities: (s) => s,
}));
jest.mock("marked", () => ({ marked: { parse: (s) => s, use: jest.fn() } }));

const { insertMarkdown } = require("../../../src/renderer/modules/notes.js");

function makeTextarea(value, selStart, selEnd) {
  return {
    value,
    selectionStart: selStart,
    selectionEnd: selEnd,
    focus: jest.fn(),
  };
}

describe("insertMarkdown — underline", () => {
  test("wraps selected text with <u></u> tags", () => {
    const ta = makeTextarea("hello world", 6, 11); // "world" selected
    insertMarkdown("underline", ta);
    expect(ta.value).toBe("hello <u>world</u>");
  });

  test("inserts empty <u></u> tags when no text is selected", () => {
    const ta = makeTextarea("hello ", 6, 6); // cursor after "hello "
    insertMarkdown("underline", ta);
    expect(ta.value).toBe("hello <u></u>");
    expect(ta.selectionStart).toBe(9); // cursor between tags
  });

  test("does not delete selected text (the reported bug)", () => {
    const ta = makeTextarea("some important text", 5, 14); // "important" selected
    insertMarkdown("underline", ta);
    expect(ta.value).toContain("important");
    expect(ta.value).toBe("some <u>important</u> text");
  });
});

describe("insertMarkdown — bold and italic preserve selection", () => {
  test("bold wraps selected text", () => {
    const ta = makeTextarea("hello world", 6, 11);
    insertMarkdown("bold", ta);
    expect(ta.value).toBe("hello **world**");
  });

  test("italic wraps selected text", () => {
    const ta = makeTextarea("hello world", 6, 11);
    insertMarkdown("italic", ta);
    expect(ta.value).toBe("hello *world*");
  });
});
