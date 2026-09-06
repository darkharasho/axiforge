/**
 * @jest-environment jsdom
 *
 * Every "fill this in" dialog — the four import dialogs, the AxiCode build
 * picker, showPrompt — is built on showFormModal. Before it existed each one
 * carried its own copy of this scaffolding and they had drifted: Import Build
 * Link was the only one you could not dismiss by clicking outside it. These
 * tests pin the behaviour they now all share, so the next dialog inherits it
 * instead of re-deciding it.
 */
"use strict";

const { showFormModal } = require("../../../src/renderer/modules/form-modal.js");

const overlay = () => document.querySelector(".confirm-modal-overlay");
const btn = (action) => overlay().querySelector(`[data-action="${action}"]`);
const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key }));

const open = (over = {}) =>
  showFormModal({
    title: "Import something",
    body: `<input id="f" />`,
    confirmLabel: "Import",
    setup: ({ overlay: el, confirm }) => {
      confirm.disabled = false;
      return () => el.querySelector("#f").value.trim();
    },
    ...over,
  });

afterEach(() => { document.body.innerHTML = ""; });

test("the confirm button resolves with what submit() returns", async () => {
  const p = open();
  overlay().querySelector("#f").value = "  a link  ";
  btn("confirm").click();
  await expect(p).resolves.toBe("a link");
  expect(overlay()).toBeNull();
});

test("Enter does exactly what the confirm button does", async () => {
  const p = open();
  overlay().querySelector("#f").value = "a link";
  press("Enter");
  await expect(p).resolves.toBe("a link");
});

test("Enter cannot submit what the button refuses to", async () => {
  const p = open({ setup: ({ confirm }) => { confirm.disabled = true; return () => "submitted"; } });
  press("Enter");
  expect(overlay()).not.toBeNull();
  press("Escape");
  await expect(p).resolves.toBeNull();
});

test("Cancel, Escape and a click on the backdrop are all the same no", async () => {
  let p = open();
  btn("cancel").click();
  await expect(p).resolves.toBeNull();

  p = open();
  press("Escape");
  await expect(p).resolves.toBeNull();

  p = open();
  overlay().click();
  await expect(p).resolves.toBeNull();
});

test("a click inside the dialog is not a dismissal", async () => {
  const p = open();
  overlay().querySelector(".confirm-modal").click();
  expect(overlay()).not.toBeNull();
  press("Escape");
  await p;
});

test("the keydown listener does not outlive the dialog", async () => {
  const p = open();
  btn("cancel").click();
  await p;
  expect(() => press("Enter")).not.toThrow();
});

test("a dialog whose body carries its own choices gets no confirm button", async () => {
  const p = showFormModal({
    title: "Choose a build",
    body: `<button data-index="0">One</button>`,
    setup: ({ overlay: el, close }) => {
      el.querySelector("[data-index]").addEventListener("click", () => close("picked"));
    },
  });
  expect(btn("confirm")).toBeNull();
  overlay().querySelector("[data-index]").click();
  await expect(p).resolves.toBe("picked");
});

test("the first field is focused, so the dialog is typeable on arrival", async () => {
  const p = open();
  expect(document.activeElement.id).toBe("f");
  press("Escape");
  await p;
});

test("the title is escaped — folder and build names reach it verbatim", async () => {
  const p = open({ title: "<img src=x onerror=alert(1)>" });
  expect(overlay().innerHTML).not.toContain("<img");
  expect(overlay().querySelector(".confirm-modal__title").textContent)
    .toBe("<img src=x onerror=alert(1)>");
  press("Escape");
  await p;
});
