/**
 * @jest-environment jsdom
 *
 * The side-by-side version compare modal.
 *
 * `renderChangeTable` is the VISIBLE diff surface: the mini card's highlight
 * anchors are hidden zero-content spans (the card renders aggregates, not one
 * element per gear slot), so the table is what a teammate actually reads.
 * `highlightOps` is still pinned here against detached anchors, because that
 * op -> selector mapping is the contract Task 7's anchors were shaped for.
 *
 * NOTE: test files are not run through babel by this repo's jest transform
 * (only src/renderer, packages/forge-render, src/site, src/web are), so this
 * uses require() rather than the brief's import — same module, same exports.
 */
"use strict";

const {
  renderChangeTable,
  highlightOps,
} = require("../../../src/renderer/modules/library/history-compare.js");

describe("renderChangeTable", () => {
  test("renders one row per op with before and after", () => {
    const html = renderChangeTable([
      { t: "gear", slot: "head", part: "rune", before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" },
      { t: "field", path: "notes", before: "old", after: "new" },
    ]);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll("[data-hist-row]")).toHaveLength(2);
    expect(el.textContent).toContain("Superior Rune of the Scholar");
    expect(el.textContent).toContain("Superior Rune of Durability");
  });

  test("omits derived ops", () => {
    const html = renderChangeTable([
      { t: "derived", path: "skills.heal.description", before: "a", after: "b" },
      { t: "field", path: "notes", before: "a", after: "b" },
    ]);
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.querySelectorAll("[data-hist-row]")).toHaveLength(1);
  });

  test("escapes user-supplied text", () => {
    const html = renderChangeTable([
      { t: "field", path: "title", before: "<img src=x onerror=alert(1)>", after: "safe" },
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("says so when a version has nothing to show", () => {
    const el = document.createElement("div");
    el.innerHTML = renderChangeTable([]);
    expect(el.textContent).toMatch(/no changes/i);
  });
});

describe("highlightOps", () => {
  test("marks the anchored elements an op refers to", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <span data-hist-slot="head" data-hist-part="rune"></span>
      <span data-hist-slot="chest" data-hist-part="rune"></span>
      <span data-hist-skill="utility2"></span>
      <span data-hist-trait="0:2"></span>`;
    highlightOps(root, [
      { t: "gear", slot: "head", part: "rune", before: "a", after: "b" },
      { t: "skill", slot: "utility2", uw: false, before: null, after: null },
      { t: "trait", line: 0, tier: 2, before: 1, after: 2 },
    ]);
    expect(root.querySelectorAll(".hist-changed")).toHaveLength(3);
    expect(root.querySelector('[data-hist-slot="chest"]').classList.contains("hist-changed")).toBe(false);
  });

  test("an op with no matching anchor is ignored rather than throwing", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-hist-slot="head" data-hist-part="rune"></span>`;
    expect(() => highlightOps(root, [{ t: "gear", slot: "gloves", part: "rune", before: "a", after: "b" }])).not.toThrow();
  });

  test("underwater skill ops do not highlight the land skill of the same name", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span data-hist-skill="heal"></span>`;
    highlightOps(root, [{ t: "skill", slot: "heal", uw: true, before: null, after: null }]);
    expect(root.querySelectorAll(".hist-changed")).toHaveLength(0);
  });

  test("a spec op highlights its line, and an odd slot value cannot break the selector", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-hist-spec="1"></div><span data-hist-slot='ring1[2]' data-hist-part="infusion"></span>`;
    expect(() => highlightOps(root, [
      { t: "spec", line: 1, before: null, after: null },
      { t: "gear", slot: 'ring1[2]', part: "infusion", before: "a", after: "b" },
      { t: "gear", slot: 'he"ad', part: "rune", before: "a", after: "b" },
    ])).not.toThrow();
    expect(root.querySelectorAll(".hist-changed")).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ modal */

const {
  showCompareModal,
  closeCompareModal,
} = require("../../../src/renderer/modules/library/history-compare.js");
const { showHistoryPanel, closeHistoryPanel } = require("../../../src/renderer/modules/library/history-panel.js");
const { state } = require("../../../src/renderer/modules/state.js");

const flush = () => new Promise((r) => setTimeout(r, 0));

function build(over = {}) {
  return {
    id: "b1", title: "Power Berserker", profession: "Warrior", gameMode: "pve",
    specializations: [], tags: [],
    skills: { heal: { id: 9093, name: "Healing Signet" }, utility: [], elite: null },
    equipment: { statPackage: "Berserker", slots: {}, runes: { head: "Superior Rune of the Scholar" }, weapons: {}, sigils: {}, infusions: {} },
    ...over,
  };
}

// Three versions of one build. getHistoryOps returns the ops a version
// INTRODUCED, so v1 — the origin keyframe — has none.
function stubApi() {
  const versions = [
    { v: 3, ts: "2026-09-04T12:00:00Z", source: "local", author: "me", summary: "notes updated" },
    { v: 2, ts: "2026-09-04T11:00:00Z", source: "local", author: "me", summary: "helm rune: Scholar → Durability" },
    { v: 1, ts: "2026-09-04T10:00:00Z", source: "local", author: "me", kind: "key", summary: "" },
  ];
  const opsByVersion = {
    1: [],
    2: [{ t: "gear", slot: "head", part: "rune", before: "Superior Rune of the Scholar", after: "Superior Rune of Durability" }],
    3: [{ t: "field", path: "notes", before: "", after: "kite the adds" }],
  };
  return {
    versions,
    getBuildHistory: jest.fn().mockResolvedValue({ versions, nextCursor: null }),
    getHistoryVersion: jest.fn(async (kind, id, v) => build({ title: `Power Berserker v${v}` })),
    getHistoryOps: jest.fn(async (kind, id, v) => opsByVersion[v] || []),
    revertBuild: jest.fn().mockResolvedValue(build({ title: "Reverted" })),
  };
}

describe("the compare modal", () => {
  let api;

  beforeEach(() => {
    api = stubApi();
    window.desktopApi = api;
    state.builds = [build({ title: "Power Berserker (current)" })];
    state.upgradeCatalog = {};
  });

  afterEach(() => {
    closeCompareModal();
    closeHistoryPanel();
    document.body.innerHTML = "";
  });

  test("opens with the clicked version on the left and its predecessor on the right", async () => {
    await showCompareModal({ kind: "build", recordId: "b1", version: 3, title: "Power Berserker" });
    await flush();

    const [left, right] = document.querySelectorAll(".hist-compare__pick");
    expect(left.value).toBe("3");
    expect(right.value).toBe("2");
    // Current is always the first option on the right-hand picker.
    expect(right.options[0].value).toBe("current");
    expect(document.querySelectorAll(".hist-compare__col")).toHaveLength(2);
    expect(document.querySelectorAll("[data-hist-row]")).toHaveLength(1);
    expect(document.querySelector(".hist-compare__table").textContent).toMatch(/kite the adds/);
  });

  test("changing a picker re-fetches and re-renders", async () => {
    await showCompareModal({ kind: "build", recordId: "b1", version: 3, title: "Power Berserker" });
    await flush();

    const [left, right] = document.querySelectorAll(".hist-compare__pick");
    left.value = "3";
    right.value = "1";
    right.dispatchEvent(new Event("change"));
    await flush();
    await flush();

    // v1 -> v3 is the union of the ops v2 and v3 introduced.
    expect(document.querySelectorAll("[data-hist-row]")).toHaveLength(2);
    expect(document.querySelector(".hist-compare__body").textContent).toMatch(/Durability/);
  });

  test("v1 has no predecessor, so it opens against Current and shows the real diff", async () => {
    await showCompareModal({ kind: "build", recordId: "b1", version: 1, title: "Power Berserker" });
    await flush();

    const [left, right] = document.querySelectorAll(".hist-compare__pick");
    expect(left.value).toBe("1");
    expect(right.value).toBe("current");
    // Everything v2 and v3 introduced, not an empty table.
    expect(document.querySelectorAll("[data-hist-row]")).toHaveLength(2);
  });

  test("v1 against itself reads as the build's initial state, never as 'no changes'", async () => {
    // history:get-ops returns [] for v1 by design: the origin keyframe has no
    // predecessor to diff against. That is not the same claim as "nothing
    // changed", and the modal must not make it.
    await showCompareModal({ kind: "build", recordId: "b1", version: 1, title: "Power Berserker" });
    await flush();

    const right = document.querySelectorAll(".hist-compare__pick")[1];
    right.value = "1";
    right.dispatchEvent(new Event("change"));
    await flush();
    await flush();

    const body = document.querySelector(".hist-compare__body");
    expect(body.textContent).toMatch(/history begins/i);
    expect(body.textContent).not.toMatch(/no changes/i);
  });

  test("restore names the version and what it means, and takes two clicks", async () => {
    await showCompareModal({ kind: "build", recordId: "b1", version: 2, title: "Power Berserker" });
    await flush();

    const btn = document.querySelector(".hist-compare__restore");
    expect(btn.textContent).toContain("Restore v2");
    expect(btn.textContent).toContain("helm rune: Scholar → Durability");

    btn.click();
    expect(api.revertBuild).not.toHaveBeenCalled();
    document.querySelector(".hist-compare__confirm-yes").click();
    await flush();

    expect(api.revertBuild).toHaveBeenCalledWith("b1", 2);
    expect(document.querySelector(".hist-compare-overlay")).toBeNull();
  });

  test("clicking a history entry opens the compare modal for that version", async () => {
    await showHistoryPanel("b1");
    await flush();

    const rows = document.querySelectorAll(".history-panel__entry");
    expect(rows).toHaveLength(3);
    rows[1].querySelector(".history-panel__entry-body").click();
    await flush();
    await flush();

    expect(document.querySelector(".hist-compare-overlay")).not.toBeNull();
    expect(document.querySelectorAll(".hist-compare__pick")[0].value).toBe("2");
  });

  test("Escape closes the compare modal but leaves the history panel open", async () => {
    await showHistoryPanel("b1");
    await flush();
    document.querySelectorAll(".history-panel__entry")[0].querySelector(".history-panel__entry-body").click();
    await flush();
    await flush();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".hist-compare-overlay")).toBeNull();
    expect(document.querySelector(".history-panel")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".history-panel")).toBeNull();
  });
});
