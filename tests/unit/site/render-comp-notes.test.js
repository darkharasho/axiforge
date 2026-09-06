/**
 * @jest-environment jsdom
 */
"use strict";

// Published comps render their notes through the same markdown pipeline as
// published builds (render-notes.js) instead of dumping raw text into a <pre>,
// so markdown, pasted screenshots, and video embeds survive publishing.

const fs = require("node:fs");
const path = require("node:path");

const { renderNotes } = require("../../../src/site/render-notes.js");

const RENDER_COMP_PATH = path.join(__dirname, "../../../src/site/render-comp.js");
const renderCompSrc = fs.readFileSync(RENDER_COMP_PATH, "utf-8");

describe("renderNotes with a comp", () => {
  test("renders comp markdown as HTML", () => {
    const el = renderNotes({ notes: "## Strat\n\n- hold mid" });
    expect(el.querySelector("h2").textContent).toBe("Strat");
    expect(el.querySelector("li").textContent).toBe("hold mid");
  });

  test("resolves ~img: tokens from comp.images", () => {
    const el = renderNotes({
      notes: "![image](~img:1)",
      images: { 1: "data:image/jpeg;base64,AAAA" },
    });
    expect(el.querySelector("img").getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });

  test("renders a placeholder when the comp has no notes", () => {
    expect(renderNotes({}).textContent).toMatch(/No notes/i);
  });
});

describe("class emoji on a published comp", () => {
  const SVG = '<svg viewBox="0 0 32 32"><path d="M0 0"/></svg>';

  test("renders :Firebrand: from the baked class icons", () => {
    const el = renderNotes({
      notes: "Bring :Firebrand: to mid",
      notesClassIcons: { Firebrand: SVG },
    });
    const icon = el.querySelector(".notes-emoji");
    expect(icon).not.toBeNull();
    expect(icon.dataset.name).toBe("Firebrand");
    expect(icon.querySelector("svg")).not.toBeNull();
    expect(el.textContent).not.toMatch(/:Firebrand:/);
  });

  test("matches the name case-insensitively", () => {
    const el = renderNotes({ notes: ":firebrand:", notesClassIcons: { Firebrand: SVG } });
    expect(el.querySelector(".notes-emoji").dataset.name).toBe("Firebrand");
  });

  test("leaves a :token: with no baked icon as text", () => {
    const el = renderNotes({ notes: "ping :everyone:", notesClassIcons: { Firebrand: SVG } });
    expect(el.querySelector(".notes-emoji")).toBeNull();
    expect(el.textContent).toMatch(/:everyone:/);
  });

  test("survives a payload published before class icons existed", () => {
    const el = renderNotes({ notes: "Bring :Firebrand:" });
    expect(el.querySelector(".notes-emoji")).toBeNull();
    expect(el.textContent).toMatch(/:Firebrand:/);
  });
});

describe("render-comp.js notes wiring", () => {
  test("uses the shared notes renderer instead of a raw <pre>", () => {
    expect(renderCompSrc).toMatch(/import\s*\{\s*renderNotes\s*\}\s*from\s*["']\.\/render-notes\.js["']/);
    expect(renderCompSrc).not.toMatch(/comp-detail__notes-textarea/);
  });

  test("puts the comp board and notes behind tabs", () => {
    expect(renderCompSrc).toMatch(/site-tab/);
    expect(renderCompSrc).toMatch(/NOTES/);
  });
});
