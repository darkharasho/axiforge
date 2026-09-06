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

// ─── The shared team trash ────────────────────────────────────────────────────
//
// A second list, from the server, answering a different question: your rows are
// "what did I remove", these are "what did the TEAM remove". Only the server can
// answer that for everyone — a teammate who was offline when the tombstone
// landed has no local copy to offer back.

function teamItem(overrides = {}) {
  return {
    teamId: "t1",
    teamName: "EWW",
    type: "build",
    id: "tb1",
    name: "Mate's Reaper",
    carried: 0,
    deletedAt: "2026-09-04T12:00:00.000Z",
    deletedBy: { userId: "u-mate", login: "mate" },
    ...overrides,
  };
}

describe("team trash section", () => {
  test("lists team deletions alongside your own", () => {
    const el = render([item()], { teamItems: [teamItem()] });
    expect(el.querySelectorAll("[data-trash-row]")).toHaveLength(1);
    expect(el.querySelectorAll("[data-team-trash-row]")).toHaveLength(1);
    expect(el.querySelector("[data-team-trash-row] .lib-trash__name").textContent).toBe("Mate's Reaper");
  });

  test("says who removed it, so it does not read as your own deletion", () => {
    const el = render([], { teamItems: [teamItem()] });
    expect(el.querySelector("[data-team-trash-row] .lib-trash__meta").textContent).toContain("deleted by mate");
  });

  test("a folder delete says how much went with it", () => {
    const el = render([], { teamItems: [teamItem({ type: "folder", name: "Raids", carried: 4 })] });
    const meta = el.querySelector("[data-team-trash-row] .lib-trash__meta").textContent;
    expect(meta).toContain("Folder, with everything inside it");
    expect(meta).toContain("4 items went with it");
  });

  test("offers no permanent delete — that is the team's retention, not one member's", () => {
    const el = render([], { teamItems: [teamItem()] });
    const row = el.querySelector("[data-team-trash-row]");
    expect(row.querySelector("[data-trash-purge]")).toBeNull();
    expect(row.querySelector("[data-team-trash-restore]").textContent.trim()).toBe("Put Back");
  });

  test("Put Back reports the team and the item, not just the item", () => {
    const calls = [];
    const el = render([], { teamItems: [teamItem()], onTeamRestore: (ref) => calls.push(ref) });
    el.querySelector("[data-team-trash-restore]").click();
    expect(calls).toEqual([{ teamId: "t1", id: "tb1" }]);
  });

  test("does not claim the trash is empty while the team has rows in it", () => {
    // The empty state would otherwise render above a visible list.
    const el = render([], { teamItems: [teamItem()] });
    expect(el.querySelector(".lib-trash--empty")).toBeNull();
    expect(el.textContent).toContain("You have not deleted anything");
    expect(el.querySelectorAll("[data-team-trash-row]")).toHaveLength(1);
  });

  test("with nothing anywhere, the ordinary empty state still shows", () => {
    const el = render([], { teamItems: [] });
    expect(el.querySelector(".lib-trash--empty")).not.toBeNull();
  });

  test("names arrive as text, never as markup", () => {
    const el = render([], { teamItems: [teamItem({ name: '<img src=x onerror="boom()">' })] });
    expect(el.querySelector("[data-team-trash-row] img")).toBeNull();
    expect(el.querySelector("[data-team-trash-row] .lib-trash__name").textContent).toContain("<img");
  });
});

describe("team trash — who may put it back", () => {
  test("a row you may not restore says so instead of offering a 403", () => {
    const el = render([], { teamItems: [teamItem({ canRestore: false })] });
    const btn = el.querySelector("[data-team-trash-restore]");
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toMatch(/owner, the item's creator, or whoever deleted it/);
  });

  test("a row you may restore is live", () => {
    const el = render([], { teamItems: [teamItem({ canRestore: true })] });
    expect(el.querySelector("[data-team-trash-restore]").disabled).toBe(false);
  });

  test("an older server that says nothing about it leaves the button alone", () => {
    // canRestore is additive; a client ahead of the Worker must not lock
    // everybody out of their own trash.
    const el = render([], { teamItems: [teamItem()] });
    expect(el.querySelector("[data-team-trash-restore]").disabled).toBe(false);
  });
});
