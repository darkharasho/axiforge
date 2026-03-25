"use strict";

// Test that @[category:id:name] mentions with HTML entities in the name
// (as produced by marked.parse encoding quotation marks) are decoded correctly.
//
// Bug: GW2 skill names containing quotation marks (e.g., "Advance!") were
// displayed as &quot;Advance!&quot; because marked.parse HTML-encodes the quotes,
// and the mention regex captured the entity-encoded name without decoding it.

const { decodeHtmlEntities } = require("../../../src/renderer/modules/utils.js");

describe("notes mention rendering — HTML entity decoding", () => {
  test("decodeHtmlEntities is exported", () => {
    expect(typeof decodeHtmlEntities).toBe("function");
  });

  test("decodes &quot; to quotation marks", () => {
    expect(decodeHtmlEntities("&quot;Advance!&quot;")).toBe('"Advance!"');
  });

  test("decodes &amp;, &lt;, &gt;, &#039;", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("&lt;")).toBe("<");
    expect(decodeHtmlEntities("&gt;")).toBe(">");
    expect(decodeHtmlEntities("&#039;")).toBe("'");
  });

  test("leaves plain text unchanged", () => {
    expect(decodeHtmlEntities("Advance!")).toBe("Advance!");
    expect(decodeHtmlEntities("Fireball")).toBe("Fireball");
  });

  test("handles multiple entities in one string", () => {
    expect(decodeHtmlEntities("&quot;Advance!&quot; &amp; &quot;Retreat!&quot;"))
      .toBe('"Advance!" & "Retreat!"');
  });

  test("mention name captured from marked HTML output is decoded correctly", () => {
    // marked.parse('@[skill:9084:"Advance!"]') produces HTML with &quot; for "
    const markedHtml = '<p>@[skill:9084:&quot;Advance!&quot;]</p>\n';
    const mentionRegex = /@\[(\w+):(\d+):([^\]]+)\]/g;
    const match = mentionRegex.exec(markedHtml);

    expect(match).not.toBeNull();
    expect(match[3]).toBe("&quot;Advance!&quot;");
    // After decoding, the name should have real quotes
    expect(decodeHtmlEntities(match[3])).toBe('"Advance!"');
  });
});
