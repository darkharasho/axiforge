/** @jest-environment jsdom */
"use strict";
const { state } = require("../../../src/renderer/modules/state.js");
const {
  openCompTagPopover,
  closeCompTagPopover,
  collectAllCompTags,
  renderCompTagsRow,
} = require("../../../src/renderer/modules/comps/comp-tags.js");

const comp = (id, tags) => ({ id, name: id, tags });

beforeEach(() => {
  document.body.innerHTML = "";
  closeCompTagPopover();
  state.comps = [
    comp("a", ["Raid", "Quickness"]),
    comp("b", ["Raid"]),
    comp("c", []),
  ];
});

afterEach(() => closeCompTagPopover());

function anchor() {
  const el = document.createElement("button");
  document.body.appendChild(el);
  return el;
}

function boxes() {
  return [...document.querySelectorAll("[data-comp-tag]")];
}

test("offers every tag anyone has used, sorted", () => {
  expect(collectAllCompTags()).toEqual(["Quickness", "Raid"]);
  openCompTagPopover(anchor(), { ids: ["a"] });
  expect(boxes().map((b) => b.dataset.compTag)).toEqual(["Quickness", "Raid"]);
});

test("a box is checked only when EVERY selected comp carries the tag", () => {
  openCompTagPopover(anchor(), { ids: ["a", "b"] });
  const byTag = Object.fromEntries(boxes().map((b) => [b.dataset.compTag, b.checked]));
  // Both have Raid; only "a" has Quickness, so it reads as unset rather than
  // lying about a tag two-thirds of the selection lacks.
  expect(byTag).toEqual({ Raid: true, Quickness: false });
});

test("toggling on adds across the whole selection, toggling off removes", async () => {
  const onAddTags = jest.fn().mockResolvedValue();
  const onRemoveTags = jest.fn().mockResolvedValue();
  openCompTagPopover(anchor(), { ids: ["a", "b"], onAddTags, onRemoveTags });

  const quickness = boxes().find((b) => b.dataset.compTag === "Quickness");
  quickness.checked = true;
  quickness.dispatchEvent(new Event("change"));
  expect(onAddTags).toHaveBeenCalledWith(["a", "b"], ["Quickness"]);

  const raid = boxes().find((b) => b.dataset.compTag === "Raid");
  raid.checked = false;
  raid.dispatchEvent(new Event("change"));
  expect(onRemoveTags).toHaveBeenCalledWith(["a", "b"], ["Raid"]);
});

test("a brand new tag is added and the field cleared", () => {
  const onAddTags = jest.fn().mockResolvedValue();
  openCompTagPopover(anchor(), { ids: ["c"], onAddTags });
  const input = document.querySelector(".comp-tag-popover__input");
  input.value = "  Strike  ";
  document.querySelector(".comp-tag-popover__add-btn").click();
  expect(onAddTags).toHaveBeenCalledWith(["c"], ["Strike"]);
  expect(input.value).toBe("");
});

test("blank input adds nothing", () => {
  const onAddTags = jest.fn().mockResolvedValue();
  openCompTagPopover(anchor(), { ids: ["c"], onAddTags });
  document.querySelector(".comp-tag-popover__input").value = "   ";
  document.querySelector(".comp-tag-popover__add-btn").click();
  expect(onAddTags).not.toHaveBeenCalled();
});

test("a comp with no tags yet still gets the add field, and says so", () => {
  state.comps = [comp("c", [])];
  openCompTagPopover(anchor(), { ids: ["c"] });
  expect(boxes()).toHaveLength(0);
  expect(document.querySelector(".comp-tag-popover__empty").textContent).toBe("No tags yet");
  expect(document.querySelector(".comp-tag-popover__input")).not.toBeNull();
});

test("opening twice leaves one popover, not two", () => {
  openCompTagPopover(anchor(), { ids: ["a"] });
  openCompTagPopover(anchor(), { ids: ["b"] });
  expect(document.querySelectorAll(".comp-tag-popover")).toHaveLength(1);
});

test("an empty selection opens nothing", () => {
  expect(openCompTagPopover(anchor(), { ids: [] })).toBeNull();
  expect(document.querySelector(".comp-tag-popover")).toBeNull();
});

test("Escape and an outside click close it; a click inside does not", () => {
  jest.useFakeTimers();
  const a = anchor();
  openCompTagPopover(a, { ids: ["a"] });
  jest.runAllTimers();

  document.querySelector(".comp-tag-popover__input")
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(document.querySelector(".comp-tag-popover")).not.toBeNull();

  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(document.querySelector(".comp-tag-popover")).toBeNull();

  openCompTagPopover(a, { ids: ["a"] });
  jest.runAllTimers();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(document.querySelector(".comp-tag-popover")).toBeNull();
  jest.useRealTimers();
});

test("it can be anchored to a bare point, for the context menu", () => {
  openCompTagPopover({ left: 120, bottom: 40 }, { ids: ["a"] });
  const el = document.querySelector(".comp-tag-popover");
  expect(el.style.left).toBe("120px");
  expect(el.style.top).toBe("44px");
});

test("tag names are text, never markup", () => {
  state.comps = [comp("a", ['<img src=x onerror="boom()">'])];
  openCompTagPopover(anchor(), { ids: ["a"] });
  expect(document.querySelector(".comp-tag-popover img")).toBeNull();
  expect(document.querySelector(".comp-tag-popover__item span").textContent)
    .toBe('<img src=x onerror="boom()">');
});

describe("the tags row on the comp detail", () => {
  const row = (c) => {
    const host = document.createElement("div");
    host.innerHTML = renderCompTagsRow(c);
    return host;
  };

  test("draws a pill per tag, each with its own remove button", () => {
    const el = row(comp("a", ["Raid", "Quickness"]));
    expect([...el.querySelectorAll(".comp-detail__tag")].map((p) => p.textContent.trim().replace(/\s*×$/, "")))
      .toEqual(["Raid", "Quickness"]);
    expect([...el.querySelectorAll("[data-action='remove-tag']")].map((b) => b.dataset.tag))
      .toEqual(["Raid", "Quickness"]);
  });

  test("an untagged comp still gets a row, so there is somewhere to start", () => {
    const el = row(comp("c", []));
    expect(el.querySelector(".comp-detail__tags-row")).not.toBeNull();
    expect(el.querySelectorAll(".comp-detail__tag")).toHaveLength(0);
    expect(el.querySelector("[data-action='edit-tags']").textContent).toBe("+ Add tags");
  });

  test("the add button shortens once there are tags to sit beside", () => {
    expect(row(comp("a", ["Raid"])).querySelector("[data-action='edit-tags']").textContent).toBe("+ Tag");
  });

  test("a comp with no tags field at all does not throw", () => {
    expect(() => row({ id: "x" })).not.toThrow();
    expect(() => row(null)).not.toThrow();
  });

  test("tag names are text, never markup", () => {
    const el = row(comp("a", ['<img src=x onerror="boom()">']));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("[data-action='remove-tag']").dataset.tag)
      .toBe('<img src=x onerror="boom()">');
  });
});
