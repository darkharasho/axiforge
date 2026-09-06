/** @jest-environment jsdom */
"use strict";

const { describeDuplicates, askAboutDuplicates, summarizeImport } =
  require("../../../src/renderer/modules/library/import-dedupe.js");

const dupe = (over = {}) => ({
  incomingId: "in-1",
  incomingTitle: "Quickness Firebrand",
  existingId: "mine",
  existingTitle: "qFB (mine)",
  ...over,
});

const compPreview = (over = {}) => ({
  kind: "comp",
  token: "t1",
  name: "Raid Squad",
  buildCount: 5,
  duplicates: [dupe()],
  ...over,
});

describe("describeDuplicates", () => {
  test("names both copies so you know what you are choosing between", () => {
    const html = describeDuplicates(compPreview());
    expect(html).toContain("Quickness Firebrand");
    expect(html).toContain("qFB (mine)");
  });

  test("counts the duplicates against the comp's size", () => {
    expect(describeDuplicates(compPreview())).toContain("1 of the 5 builds");
  });

  test("says so outright when the whole comp is already here", () => {
    const preview = compPreview({ buildCount: 2, duplicates: [dupe(), dupe({ incomingId: "in-2" })] });
    expect(describeDuplicates(preview)).toContain("Every build in");
  });

  test("a build link gets the single-build wording, not a count", () => {
    const html = describeDuplicates({ kind: "build", buildCount: 1, duplicates: [dupe()] });
    expect(html).toContain("You already have this build");
    expect(html).not.toContain("of the 1 builds");
  });

  test("titles are text, never markup", () => {
    const html = describeDuplicates(compPreview({
      name: "<img src=x onerror=alert(1)>",
      duplicates: [dupe({ incomingTitle: "<script>bad()</script>" })],
    }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });
});

describe("askAboutDuplicates", () => {
  test("does not ask when nothing is duplicated", async () => {
    const showChoice = jest.fn();
    await expect(askAboutDuplicates(compPreview({ duplicates: [] }), showChoice)).resolves.toBe("copy");
    expect(showChoice).not.toHaveBeenCalled();
  });

  test("does not ask when the preview never arrived", async () => {
    const showChoice = jest.fn();
    await expect(askAboutDuplicates(null, showChoice)).resolves.toBe("copy");
    expect(showChoice).not.toHaveBeenCalled();
  });

  test("offers exactly two ways forward", async () => {
    const showChoice = jest.fn().mockResolvedValue("reuse");
    await askAboutDuplicates(compPreview(), showChoice);
    const ids = showChoice.mock.calls[0][0].choices.map((c) => c.id);
    expect(ids).toEqual(["reuse", "copy"]);
  });

  test("passes the chosen answer straight back", async () => {
    await expect(askAboutDuplicates(compPreview(), async () => "reuse")).resolves.toBe("reuse");
    await expect(askAboutDuplicates(compPreview(), async () => "copy")).resolves.toBe("copy");
  });

  test("backing out is null, not a silent import", async () => {
    await expect(askAboutDuplicates(compPreview(), async () => null)).resolves.toBeNull();
  });

  test("a build link is asked about in its own words", async () => {
    const showChoice = jest.fn().mockResolvedValue("reuse");
    await askAboutDuplicates({ kind: "build", buildCount: 1, duplicates: [dupe()] }, showChoice);
    const { title, choices } = showChoice.mock.calls[0][0];
    expect(title).toBe("You already have this build");
    expect(choices[0].label).toBe("Open the one I have");
  });
});

describe("summarizeImport", () => {
  test("a comp with nothing reused reads as it always did", () => {
    const saved = { kind: "comp", comp: { name: "Raid Squad" }, builds: [{}, {}], reused: [] };
    expect(summarizeImport(saved, "copy")).toBe("“Raid Squad” imported with 2 builds");
  });

  test("a comp that reused everything says nothing new was made", () => {
    const saved = { kind: "comp", comp: { name: "Raid Squad" }, builds: [], reused: [{}, {}] };
    expect(summarizeImport(saved, "reuse")).toBe("“Raid Squad” imported using 2 builds you already had");
  });

  test("a mixed comp accounts for both halves", () => {
    const saved = { kind: "comp", comp: { name: "Raid Squad" }, builds: [{}], reused: [{}, {}] };
    expect(summarizeImport(saved, "reuse")).toBe("“Raid Squad” imported — 1 new build, 2 you already had");
  });

  test("a reused build says which one you got", () => {
    expect(summarizeImport({ title: "qFB (mine)", reusedExisting: true }, "reuse"))
      .toBe("You already had “qFB (mine)” — opened that one");
  });

  test("an ordinary build import is still just imported", () => {
    expect(summarizeImport({ title: "New Build" }, "copy")).toBe("“New Build” imported");
  });
});
