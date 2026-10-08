/** @jest-environment jsdom */
"use strict";

const { compPublishView } = require("../../../src/renderer/modules/comps/comp-detail.js");

const CONNECTED = { isAuthenticated: true, repoReady: true };
const comp = { id: "c1", name: "Raid", publishedFileId: "cf", publishedHash: "h", contentHash: "h" };

test("queued comp → Publishing…", () => {
  expect(compPublishView(comp, { items: { "comp:c1": { state: "queued" } } }, CONNECTED))
    .toMatchObject({ label: "Publishing…", action: "copy" });
});

test("current comp → Copy link ✓", () => {
  expect(compPublishView(comp, { items: {} }, CONNECTED)).toMatchObject({ label: "Copy link", icon: "check" });
});

test("not connected → Set up publishing", () => {
  expect(compPublishView(comp, { items: {} }, { isAuthenticated: false })).toMatchObject({ action: "setup" });
});

test("a comp's receipt is judged on its own fields (v2 links members)", () => {
  expect(compPublishView({ ...comp, contentHash: "other" }, { items: {} }, CONNECTED)).toMatchObject({ action: "publish-and-copy" });
});

describe("comp board", () => {
  const { state } = require("../../../src/renderer/modules/state.js");
  const { renderCompDetail } = require("../../../src/renderer/modules/comps/comp-detail.js");
  const btn = () => document.getElementById("compPublishBtn");
  const menuItem = (action) => document.querySelector(`.comp-share-dropdown__menu [data-action='${action}']`);

  beforeEach(() => {
    document.body.innerHTML = '<div id="comps-container"></div>';
    state.builds = [];
    state.onboarding = CONNECTED;
    state.publishQueue = { items: {}, paused: null, published: [] };
    state.activeComp = { ...comp, partyLines: [], buildIds: [], publishedOwner: "me" };
    renderCompDetail();
  });

  test("draws the Copy link button from the comp's state", () => {
    expect(btn().textContent).toBe("Copy link");
    expect(btn().dataset.action).toBe("copy");
    expect(btn().classList.contains("publish-btn--ok")).toBe(true);
  });

  test("a click asks renderer.js to run the button's action for this comp", () => {
    const seen = [];
    const onAction = (e) => seen.push(e.detail);
    window.addEventListener("axi:publish-action", onAction);
    btn().click();
    window.removeEventListener("axi:publish-action", onAction);
    expect(seen).toEqual([{ action: "copy", kind: "comp", id: "c1", owner: "me" }]);
  });

  test("a queue snapshot redraws the button and the share gates", () => {
    state.activeComp = { ...state.activeComp, contentHash: "other" };
    state.publishQueue = { items: { "comp:c1": { state: "failed", error: "boom" } } };
    window.dispatchEvent(new CustomEvent("axi:publish-status"));
    expect(btn().dataset.action).toBe("retry");
    expect(menuItem("share-discord").disabled).toBe(true);
    expect(menuItem("share-discord").title).toBe("Publishing failed — retry it first");

    state.publishQueue = { items: { "comp:c1": { state: "publishing" } } };
    window.dispatchEvent(new CustomEvent("axi:publish-status"));
    expect(btn().textContent).toBe("Publishing…");
    expect(menuItem("share-discord").disabled).toBe(false);
    expect(menuItem("copy-plaintext").hasAttribute("title")).toBe(false);
  });

  test("a share in progress keeps Discord Embed disabled through queue snapshots", async () => {
    let finishShare;
    window.desktopApi = {
      listCompWebhooks: jest.fn(async () => [{ id: "w1", name: "Guild" }]),
      shareCompToDiscord: jest.fn(() => new Promise((resolve) => { finishShare = resolve; })),
    };
    const embed = menuItem("share-discord");
    embed.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(window.desktopApi.shareCompToDiscord).toHaveBeenCalledTimes(1);
    expect(embed.disabled).toBe(true);

    // The comp is current, so the gate alone would enable the button.
    window.dispatchEvent(new CustomEvent("axi:publish-status"));
    expect(embed.disabled).toBe(true);
    embed.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(window.desktopApi.shareCompToDiscord).toHaveBeenCalledTimes(1);

    finishShare({ success: true, results: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(embed.disabled).toBe(false);
  });

  test("a finished share leaves the button gated when the comp changed meanwhile", async () => {
    let finishShare;
    window.desktopApi = {
      listCompWebhooks: jest.fn(async () => [{ id: "w1", name: "Guild" }]),
      shareCompToDiscord: jest.fn(() => new Promise((resolve) => { finishShare = resolve; })),
    };
    const embed = menuItem("share-discord");
    embed.click();
    await new Promise((r) => setTimeout(r, 0));
    state.activeComp = { ...state.activeComp, contentHash: "edited" };
    finishShare({ success: false, error: "nope" });
    await new Promise((r) => setTimeout(r, 0));
    expect(embed.disabled).toBe(true);
    expect(embed.title).toBe("Your latest changes aren't published yet");
  });

  test("the click passes the owner of the comp as it is now, not as first drawn", () => {
    state.activeComp = { ...state.activeComp, publishedOwner: "guildie" };
    const seen = [];
    const onAction = (e) => seen.push(e.detail);
    window.addEventListener("axi:publish-action", onAction);
    btn().click();
    window.removeEventListener("axi:publish-action", onAction);
    expect(seen[0].owner).toBe("guildie");
  });

  test("Published Link unlocks once the first publish lands", () => {
    state.activeComp = { ...state.activeComp, publishedFileId: undefined, publishedHash: undefined };
    renderCompDetail();
    expect(menuItem("copy-published-link").disabled).toBe(true);
    state.activeComp = { ...state.activeComp, publishedFileId: "cf", publishedHash: "h" };
    window.dispatchEvent(new CustomEvent("axi:publish-status"));
    expect(menuItem("copy-published-link").disabled).toBe(false);
  });
});
