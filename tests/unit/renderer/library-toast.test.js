/**
 * @jest-environment jsdom
 */
"use strict";

// The toast is how an undoable action announces itself. Ten of the twelve
// pushUndo sites used to be silent, so the whole undo stack was invisible unless
// you already knew Ctrl+Z existed. These cover the Undo affordance itself.

const { showToast, _resetToastForTests } = require("../../../src/renderer/modules/library/toast.js");

const toastEl = () => document.querySelector(".lib-toast");
const actionBtn = () => document.querySelector(".lib-toast__action");

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = "";
  _resetToastForTests();
});
afterEach(() => jest.useRealTimers());

describe("showToast", () => {
  test("shows the message", () => {
    showToast("Build copied!");
    expect(toastEl().textContent).toContain("Build copied!");
  });

  test("renders the message as text, never as markup", () => {
    // Build titles are user-supplied and land in toasts verbatim
    // (`"${saved.title}" imported`).
    showToast('<img src=x onerror="boom()"> imported');
    expect(toastEl().querySelector("img")).toBeNull();
    expect(toastEl().textContent).toContain("<img src=x");
  });

  test("has no action button when no action is given", () => {
    showToast("Build copied!");
    expect(actionBtn()).toBeNull();
  });
});

describe("undo affordance", () => {
  test("renders a button labelled with the action", () => {
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });
    expect(actionBtn().textContent).toBe("Undo");
  });

  test("runs the action when clicked", () => {
    const clicks = [];
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => clicks.push(1) });

    actionBtn().click();

    expect(clicks).toHaveLength(1);
  });

  test("dismisses itself once the action is taken", () => {
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });
    actionBtn().click();
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("only fires the action once even if clicked twice", () => {
    const clicks = [];
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => clicks.push(1) });

    actionBtn().click();
    actionBtn().click();

    expect(clicks).toHaveLength(1);
  });

  test("stays up long enough to be clicked", () => {
    // A plain toast dwells 2s. That is not enough time to notice an Undo button,
    // move the mouse to it and click.
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });

    jest.advanceTimersByTime(2000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);

    jest.advanceTimersByTime(4000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("does not steal the dwell time from a plain toast", () => {
    showToast("Build copied!");
    jest.advanceTimersByTime(2000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("does not expire while the pointer is over it", () => {
    // Reaching for the button must not race the timer out from under you.
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });

    toastEl().dispatchEvent(new Event("mouseenter"));
    jest.advanceTimersByTime(60000);

    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);
  });

  test("resumes expiring after the pointer leaves", () => {
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });
    toastEl().dispatchEvent(new Event("mouseenter"));
    jest.advanceTimersByTime(60000);

    toastEl().dispatchEvent(new Event("mouseleave"));
    jest.advanceTimersByTime(6000);

    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("is clickable — the toast opts back into pointer events when it has an action", () => {
    // .lib-toast sets pointer-events:none so it never blocks the UI behind it.
    // A toast carrying a button has to opt out of that or the button is dead.
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });
    expect(toastEl().classList.contains("lib-toast--interactive")).toBe(true);
  });

  test("drops the previous toast's action when replaced by a plain one", () => {
    showToast("Moved 3 builds", "success", { label: "Undo", onClick: () => {} });
    showToast("Build copied!");
    expect(actionBtn()).toBeNull();
  });

  test("a loading toast never auto-dismisses", () => {
    showToast("Publishing…", "loading");
    jest.advanceTimersByTime(60000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);
  });
});

describe("failures get long enough to read", () => {
  // A failure toast is often the ONLY account the user gets of why an action did
  // nothing — "That build isn't published anymore (the link's file is gone)" is
  // a whole sentence delivered in the two seconds "Build copied!" needs. Errors
  // and warnings get the Undo window instead.
  test("an error dwells past the plain 2s", () => {
    showToast("That build isn't published anymore (the link's file is gone).", "error");

    jest.advanceTimersByTime(2000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);

    jest.advanceTimersByTime(4000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("a warning gets the same window", () => {
    showToast("Leave or delete the team in Settings → Teams.", "warning");
    jest.advanceTimersByTime(2000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);
    jest.advanceTimersByTime(4000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("a success toast is unchanged", () => {
    showToast("Build copied!", "success");
    jest.advanceTimersByTime(2000);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });

  test("an error still never blocks clicks on the library behind it", () => {
    // .lib-toast is pointer-events:none. Opting an error back in would buy the
    // mouseenter-to-hold at the price of swallowing every click at
    // bottom-centre for six seconds — a worse problem than the one the longer
    // timeout solves.
    showToast("Import failed", "error");
    expect(toastEl().classList.contains("lib-toast--interactive")).toBe(false);
  });

  test("an error carrying an action keeps the action's window, not a longer one", () => {
    showToast("Couldn't undo that.", "error", { label: "Retry", onClick: () => {} });
    jest.advanceTimersByTime(5999);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(true);
    jest.advanceTimersByTime(2);
    expect(toastEl().classList.contains("lib-toast--visible")).toBe(false);
  });
});
