/** @jest-environment jsdom */
"use strict";
const { initChoiceModal, showChoiceModal } = require("../../../src/renderer/modules/choice-modal.js");

beforeEach(() => { document.body.innerHTML = ""; initChoiceModal(); });

test("resolves with the clicked choice id and renders labels/danger", async () => {
  const p = showChoiceModal({ title: "T", body: "<b>B</b>", choices: [{ id: "mine", label: "Keep mine" }, { id: "theirs", label: "Take theirs", danger: true }] });
  const btns = [...document.querySelectorAll(".choice-modal__btn")];
  expect(btns.map((b) => b.textContent)).toEqual(["Keep mine", "Take theirs"]);
  expect(btns[1].classList.contains("choice-modal__btn--danger")).toBe(true);
  expect(btns[0].classList.contains("choice-modal__btn--danger")).toBe(false);
  expect(document.getElementById("chm-title").textContent).toBe("T");
  expect(document.getElementById("chm-body").innerHTML).toBe("<b>B</b>");
  btns[0].click();
  expect(await p).toBe("mine");
  expect(document.querySelector(".choice-modal-overlay--hidden")).not.toBeNull();
});

test("Escape / close resolve null", async () => {
  const p = showChoiceModal({ title: "T", body: "", choices: [{ id: "x", label: "X" }] });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(await p).toBeNull();
  const p2 = showChoiceModal({ title: "T", body: "", choices: [{ id: "x", label: "X" }] });
  document.getElementById("chm-close").click();
  expect(await p2).toBeNull();
});

test("opening a second modal resolves the first with null and does not leak Escape handlers", async () => {
  const first = showChoiceModal({ title: "A", body: "", choices: [{ id: "a", label: "A" }] });
  const second = showChoiceModal({ title: "B", body: "", choices: [{ id: "b", label: "B" }] });
  expect(await first).toBeNull();
  document.querySelector(".choice-modal__btn").click();
  expect(await second).toBe("b");
  // A stale Escape listener from the first modal would throw or re-resolve; nothing should break.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
});
