/** @jest-environment jsdom */
"use strict";

const { describeIncomingChange } = require("../../../src/renderer/modules/sync-summary.js");

describe("describeIncomingChange", () => {
  test("names who changed it and what they changed", () => {
    expect(describeIncomingChange("vette", "notes updated"))
      .toBe("vette changed this build — notes updated.");
  });

  test("an unresolved author reads as a person, not as the placeholder", () => {
    expect(describeIncomingChange("teammate", "notes updated")).toMatch(/^A teammate changed/);
    expect(describeIncomingChange(null, "notes updated")).toMatch(/^A teammate changed/);
  });

  test("a long list is cut down and admits what it left out", () => {
    const summary = 'title: "A" → "B"; equipment changed; notes updated; tags changed';
    expect(describeIncomingChange("vette", summary))
      .toBe('vette changed this build — title: "A" → "B"; equipment changed (+2 more).');
  });

  test("exactly the shown count says nothing about more", () => {
    expect(describeIncomingChange("vette", "skills changed; notes updated"))
      .toBe("vette changed this build — skills changed; notes updated.");
  });

  test("how many clauses to name is adjustable", () => {
    const summary = "a; b; c";
    expect(describeIncomingChange("vette", summary, { max: 1 }))
      .toBe("vette changed this build — a (+2 more).");
  });

  test("an event with no summary still announces that something arrived", () => {
    expect(describeIncomingChange("vette", null)).toBe("vette changed this build.");
    expect(describeIncomingChange("vette", "  ")).toBe("vette changed this build.");
  });

  test('"Created" is the sync placeholder for a build we had never seen — not a field change', () => {
    expect(describeIncomingChange("vette", "Created")).toBe("vette changed this build.");
    expect(describeIncomingChange("vette", "build created")).toBe("vette changed this build.");
  });
});

// ─── final review, B3 ───────────────────────────────────────────────────────

describe("a semicolon inside a value is not a clause boundary", () => {
  // renderSummary joins clauses with "; ". A title or notes value is user free
  // text and may contain a bare ";" of its own — splitting on ";" cut this
  // title in half and reported a third clause that does not exist.
  test("a title containing a semicolon stays in one piece", () => {
    const summary = 'title: "Heal" → "Support; DPS"';
    expect(describeIncomingChange("ana", summary)).toBe(
      'ana changed this build — title: "Heal" → "Support; DPS".',
    );
  });

  test("the +N count is not inflated by semicolons inside values", () => {
    const summary = 'title: "A" → "B; C"; notes updated; folder changed';
    expect(describeIncomingChange("ana", summary)).toBe(
      'ana changed this build — title: "A" → "B; C"; notes updated (+1 more).',
    );
  });

  test("a semicolon with no space after it is not a boundary either", () => {
    expect(describeIncomingChange("ana", 'title: "A" → "B;C"; notes updated; folder changed')).toBe(
      'ana changed this build — title: "A" → "B;C"; notes updated (+1 more).',
    );
  });

  test("real clauses still split", () => {
    expect(describeIncomingChange("ana", "title updated; notes updated; gear changed")).toBe(
      "ana changed this build — title updated; notes updated (+1 more).",
    );
  });
});
