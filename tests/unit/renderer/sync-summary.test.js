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
