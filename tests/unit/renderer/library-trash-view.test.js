/** @jest-environment jsdom */
"use strict";

const {
  renderTrashView,
  trashItemLabel,
  daysLeft,
  RETENTION_DAYS,
} = require("../../../src/renderer/modules/library/trash-view.js");

const NOW = new Date("2026-09-05T00:00:00.000Z");

function item(overrides = {}) {
  return {
    type: "build",
    id: "b1",
    name: "Power Berserker",
    deletedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

function render(items, handlers = {}, now = NOW) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  renderTrashView(el, items, { now, ...handlers });
  return el;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("trash view — empty state", () => {
  test("says the trash is empty rather than rendering a blank pane", () => {
    const el = render([]);
    expect(el.textContent).toMatch(/trash is empty/i);
  });

  test("offers no Empty Trash button when there is nothing to empty", () => {
    const el = render([]);
    expect(el.querySelector("[data-trash-empty]")).toBeNull();
  });
});

describe("trash view — rows", () => {
  test("renders a row per item with its name", () => {
    const el = render([item(), item({ id: "b2", name: "Scourge" })]);
    const rows = el.querySelectorAll("[data-trash-row]");
    expect(rows).toHaveLength(2);
    expect(el.textContent).toContain("Power Berserker");
    expect(el.textContent).toContain("Scourge");
  });

  // Build titles are user text and land here verbatim.
  test("renders names as text, not markup", () => {
    const el = render([item({ name: '<img src=x onerror="alert(1)">' })]);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x");
  });

  test("labels a folder row as a folder so it reads differently from a build", () => {
    const el = render([item({ type: "folder", id: "f1", name: "WvW" })]);
    const row = el.querySelector("[data-trash-row]");
    expect(row.getAttribute("data-trash-type")).toBe("folder");
  });

  test("tells the user how long they have left to restore", () => {
    const el = render([item({ deletedAt: "2026-09-04T00:00:00.000Z" })]);
    expect(el.textContent).toMatch(/29 days left/);
  });

  test("an item on its last day reads as a day, not zero days", () => {
    const el = render([item({ deletedAt: "2026-08-07T00:00:00.000Z" })]);
    expect(el.textContent).toMatch(/1 day left/);
  });
});

describe("trash view — actions", () => {
  test("Restore calls back with the item's type and id", () => {
    const onRestore = jest.fn();
    const el = render([item({ type: "comp", id: "c1", name: "Zerg" })], { onRestore });

    el.querySelector("[data-trash-restore]").click();

    expect(onRestore).toHaveBeenCalledWith({ type: "comp", id: "c1" });
  });

  test("Delete Permanently calls back with the item's type and id", () => {
    const onPurge = jest.fn();
    const el = render([item()], { onPurge });

    el.querySelector("[data-trash-purge]").click();

    expect(onPurge).toHaveBeenCalledWith({ type: "build", id: "b1" });
  });

  test("Empty Trash is offered once the trash has anything in it", () => {
    const onEmpty = jest.fn();
    const el = render([item()], { onEmpty });

    el.querySelector("[data-trash-empty]").click();

    expect(onEmpty).toHaveBeenCalled();
  });

  test("each row's buttons act on that row, not the first one", () => {
    const onRestore = jest.fn();
    const el = render([item(), item({ id: "b2", name: "Scourge" })], { onRestore });

    el.querySelectorAll("[data-trash-restore]")[1].click();

    expect(onRestore).toHaveBeenCalledWith({ type: "build", id: "b2" });
  });
});

describe("trash view — expiry warning", () => {
  test("an item close to expiry is marked so the countdown is noticed, not just read", () => {
    const el = render([item({ deletedAt: "2026-08-12T00:00:00.000Z" })]); // 6 days left
    expect(el.querySelector("[data-trash-row]").classList).toContain("lib-trash__row--expiring");
  });

  test("an item with plenty of time left is not marked", () => {
    const el = render([item({ deletedAt: "2026-09-04T00:00:00.000Z" })]); // 29 days left
    expect(el.querySelector("[data-trash-row]").classList).not.toContain("lib-trash__row--expiring");
  });
});

describe("trash view — helpers", () => {
  test("a folder row says what it takes back with it", () => {
    expect(trashItemLabel({ type: "folder", name: "WvW" }))
      .toMatch(/folder/i);
  });

  test("daysLeft counts down from the retention window", () => {
    expect(daysLeft("2026-09-05T00:00:00.000Z", NOW)).toBe(RETENTION_DAYS);
  });

  test("daysLeft never goes below zero for an item past its window", () => {
    expect(daysLeft("2020-01-01T00:00:00.000Z", NOW)).toBe(0);
  });
});
