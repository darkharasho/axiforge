/** @jest-environment jsdom */
"use strict";

const { applyBadge, badgeHtml } = require("../../../src/renderer/modules/sync-status.js");

test("applyBadge creates, updates, wires conflict click, and removes", () => {
  const host = document.createElement("span");
  const onClick = jest.fn();
  applyBadge(host, "pending", { className: "lib-content-sync-indicator", onClick });
  let badge = host.querySelector(".lib-content-sync-indicator");
  expect(badge.className).toBe("lib-content-sync-indicator lib-content-sync-indicator--pending");
  expect(badge.title).toBe("Waiting to sync");
  applyBadge(host, "conflict", { className: "lib-content-sync-indicator", onClick });
  badge = host.querySelector(".lib-content-sync-indicator");
  expect(badge.className).toContain("--conflict");
  expect(badge.title).toBe("Sync conflict — click to resolve");
  badge.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  applyBadge(host, "synced", { className: "lib-content-sync-indicator", onClick });
  host.querySelector(".lib-content-sync-indicator").click();
  expect(onClick).toHaveBeenCalledTimes(1); // click only active while conflicted
  applyBadge(host, null, { className: "lib-content-sync-indicator" });
  expect(host.querySelector(".lib-content-sync-indicator")).toBeNull();
});

test("applyBadge reuses an existing badge element rather than appending a second", () => {
  const host = document.createElement("span");
  applyBadge(host, "syncing", { className: "lib-nav-item__sync-indicator" });
  const first = host.querySelector(".lib-nav-item__sync-indicator");
  applyBadge(host, "synced", { className: "lib-nav-item__sync-indicator" });
  expect(host.querySelectorAll(".lib-nav-item__sync-indicator")).toHaveLength(1);
  expect(host.querySelector(".lib-nav-item__sync-indicator")).toBe(first);
});

test("applyBadge tolerates an unknown status by removing the badge", () => {
  const host = document.createElement("span");
  applyBadge(host, "pending", { className: "lib-content-sync-indicator" });
  applyBadge(host, "who-knows", { className: "lib-content-sync-indicator" });
  expect(host.querySelector(".lib-content-sync-indicator")).toBeNull();
});

test("applyBadge conflict click does not bubble to the card underneath", () => {
  const card = document.createElement("div");
  const host = document.createElement("span");
  card.appendChild(host);
  const cardClick = jest.fn();
  card.addEventListener("click", cardClick);
  applyBadge(host, "conflict", { className: "lib-content-sync-indicator", onClick: () => {} });
  host.querySelector(".lib-content-sync-indicator").click();
  expect(cardClick).not.toHaveBeenCalled();
});

test("badgeHtml renders the same class/title/svg as applyBadge", () => {
  const host = document.createElement("span");
  applyBadge(host, "conflict", { className: "lib-content-sync-indicator" });
  const wrapper = document.createElement("div");
  wrapper.innerHTML = badgeHtml("lib-content-sync-indicator", "conflict");
  const rendered = wrapper.firstElementChild;
  const applied = host.firstElementChild;
  expect(rendered.className).toBe(applied.className);
  expect(rendered.title).toBe(applied.title);
  expect(rendered.innerHTML).toBe(applied.innerHTML);
});

test("badgeHtml returns an empty string for no/unknown status", () => {
  expect(badgeHtml("lib-nav-item__sync-indicator", null)).toBe("");
  expect(badgeHtml("lib-nav-item__sync-indicator", "detached")).toBe("");
});
