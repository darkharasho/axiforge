/**
 * @jest-environment jsdom
 */
"use strict";

// Round trip: a comp's notes go through serializeCompForPublish, over the wire
// as JSON, and back out of the SPA's notes renderer. Catches field-name drift
// between what the publisher writes and what the published page reads.

const { serializeCompForPublish } = require("../../../src/main/compPublish");
const { renderNotes } = require("../../../src/site/render-notes.js");

const COMP = {
  id: "comp-1",
  name: "Zerg Comp",
  notes: [
    "## Push",
    "",
    "Bring :Firebrand: and :Scourge: to mid.",
    "",
    "![image](~img:1)",
  ].join("\n"),
  images: { 1: "data:image/jpeg;base64,AAAA" },
  tags: [],
  gameMode: "wvw",
  partyLines: [],
};

function publishAndRender(comp) {
  const payload = JSON.parse(JSON.stringify(serializeCompForPublish(comp, {})));
  return renderNotes(payload);
}

describe("comp notes publish round trip", () => {
  test("markdown survives", () => {
    expect(publishAndRender(COMP).querySelector("h2").textContent).toBe("Push");
  });

  test("class emoji arrive as icons, not raw tokens", () => {
    const el = publishAndRender(COMP);
    const names = [...el.querySelectorAll(".notes-emoji")].map((n) => n.dataset.name);
    expect(names).toEqual(["Firebrand", "Scourge"]);
    expect(el.querySelector('.notes-emoji svg')).not.toBeNull();
    expect(el.textContent).not.toMatch(/:Firebrand:|:Scourge:/);
  });

  test("pasted screenshots arrive as data URLs", () => {
    expect(publishAndRender(COMP).querySelector("img").getAttribute("src"))
      .toBe("data:image/jpeg;base64,AAAA");
  });

  test("a comp with no notes renders the placeholder rather than throwing", () => {
    expect(publishAndRender({ ...COMP, notes: "", images: {} }).textContent).toMatch(/No notes/i);
  });
});
