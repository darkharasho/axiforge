/** @jest-environment jsdom */
"use strict";

const {
  publishButtonState, queueItemFor, connectionFrom, applyPublishButton, runPublishButtonAction,
} = require("../../../src/renderer/modules/publish-button.js");

const CONNECTED = { signedIn: true, connected: true };

describe("publishButtonState — every row of the spec's table", () => {
  test("disconnected → Set up publishing", () => {
    expect(publishButtonState({ receipt: "current", connection: { signedIn: false, connected: false } }))
      .toMatchObject({ label: "Set up publishing", action: "setup" });
    expect(publishButtonState({ queueItem: { state: "disconnected" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Set up publishing", action: "setup" });
  });

  test.each(["queued", "publishing"])("%s → Publishing… with a spinner, copies", (state) => {
    expect(publishButtonState({ queueItem: { state }, receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Publishing…", action: "copy", tone: "busy", icon: "spinner" });
  });

  test("current → Copy link ✓", () => {
    expect(publishButtonState({ receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "copy", tone: "ok", icon: "check" });
  });

  test("waiting → Copy link with a clock and the reason and retry time", () => {
    const view = publishButtonState({
      queueItem: { state: "waiting", reason: "rate-limit", retryAt: 61000 },
      receipt: "stale", connection: CONNECTED, now: 1000,
    });
    expect(view).toMatchObject({ label: "Copy link", action: "copy", icon: "clock" });
    expect(view.title).toMatch(/rate limit/i);
    expect(view.title).toMatch(/60s/);
    expect(publishButtonState({ queueItem: { state: "waiting", reason: "offline", retryAt: 0 }, receipt: "stale", connection: CONNECTED, now: 0 }).title)
      .toMatch(/offline/i);
  });

  test("failed → Retry, warning tone, error in the tooltip", () => {
    expect(publishButtonState({ queueItem: { state: "failed", error: "Not Found" }, receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Retry", action: "retry", tone: "warn", title: "Publishing failed: Not Found" });
  });

  test("unauthorized → Sign in to publish, even though onboarding still says connected", () => {
    expect(publishButtonState({ queueItem: { state: "unauthorized" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Sign in to publish", action: "sign-in" });
  });

  test("declined → Publish my copy", () => {
    expect(publishButtonState({ queueItem: { state: "declined", owner: "mate" }, receipt: "current", connection: CONNECTED }))
      .toMatchObject({ label: "Publish my copy", action: "choose-owner", title: "Published by @mate" });
  });

  test("never published and not queued → Copy link (publishes, then copies)", () => {
    expect(publishButtonState({ receipt: "never", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "copy", icon: "" });
  });

  test("stale and not queued → Copy link that also publishes", () => {
    expect(publishButtonState({ receipt: "stale", connection: CONNECTED }))
      .toMatchObject({ label: "Copy link", action: "publish-and-copy" });
  });
});

describe("publishButtonState — unsaved editor edits", () => {
  test.each([
    [{ receipt: "current" }, "Copy link"],
    [{ receipt: "stale" }, "Copy link"],
    [{ receipt: "never" }, "Copy link"],
    [{ queueItem: { state: "queued" }, receipt: "stale" }, "Publishing…"],
    [{ queueItem: { state: "waiting", reason: "offline" }, receipt: "stale" }, "Copy link"],
  ])("%o is disabled with Save your changes first", (input, label) => {
    const v = publishButtonState({ ...input, connection: CONNECTED, dirty: true });
    expect(v).toMatchObject({ label, disabled: true, title: "Save your changes first" });
  });

  test.each([
    [{ connection: { signedIn: false, connected: false } }, "setup"],
    [{ queueItem: { state: "unauthorized" }, connection: CONNECTED }, "sign-in"],
    [{ queueItem: { state: "failed", error: "x" }, connection: CONNECTED }, "retry"],
    [{ queueItem: { state: "declined", owner: "m" }, connection: CONNECTED }, "choose-owner"],
  ])("%o stays enabled: it copies nothing", (input, action) => {
    expect(publishButtonState({ ...input, receipt: "current", dirty: true })).toMatchObject({ action, disabled: false });
  });

  test("a saved editor is enabled", () => {
    expect(publishButtonState({ receipt: "current", connection: CONNECTED }).disabled).toBe(false);
  });
});

describe("helpers", () => {
  test("queueItemFor", () => {
    const snap = { items: { "build:a": { state: "queued" } } };
    expect(queueItemFor(snap, "build", "a")).toEqual({ state: "queued" });
    expect(queueItemFor(snap, "comp", "a")).toBeNull();
    expect(queueItemFor(null, "build", "a")).toBeNull();
  });

  test("connectionFrom", () => {
    expect(connectionFrom(null)).toEqual({ signedIn: false, connected: false });
    expect(connectionFrom({ isAuthenticated: true })).toEqual({ signedIn: true, connected: false });
    expect(connectionFrom({ isAuthenticated: true, repoReady: true })).toEqual({ signedIn: true, connected: true });
    expect(connectionFrom({ isAuthenticated: true }, { publishOwner: "guild" })).toEqual({ signedIn: true, connected: true, team: true });
    expect(connectionFrom({ isAuthenticated: false }, { publishOwner: "guild" })).toEqual({ signedIn: false, connected: false, team: true });
    expect(connectionFrom({ isAuthenticated: true }, { teamId: "T" })).toEqual({ signedIn: true, connected: false, team: true });
    // A personal site never makes a team item ready: it would publish there.
    expect(connectionFrom({ isAuthenticated: true, repoReady: true }, { teamId: "T" })).toEqual({ signedIn: true, connected: false, team: true });
  });

  describe("team items", () => {
    const TEAM = { signedIn: true, connected: true, team: true };

    test("a team with no target says so rather than offering personal setup", () => {
      const v = publishButtonState({ receipt: "never", connection: { signedIn: true, connected: false, team: true } });
      expect(v).toMatchObject({ label: "Not published", tone: "warn", disabled: true });
      expect(v.title).toMatch(/team owner can set it/);
      expect(v.action).not.toBe("setup");
      // An older link still copies.
      expect(publishButtonState({ receipt: "current", connection: { signedIn: true, connected: false, team: true } }).disabled).toBe(false);
    });

    test("held for repo access: says why; retries a first publish, copies an older link", () => {
      const queueItem = { state: "disconnected", error: "Waiting for access to owner/axibuilds." };
      expect(publishButtonState({ queueItem, receipt: "never", connection: TEAM }))
        .toMatchObject({ label: "Waiting to publish", action: "retry", title: "Waiting for access to owner/axibuilds." });
      expect(publishButtonState({ queueItem, receipt: "stale", connection: TEAM }))
        .toMatchObject({ label: "Copy link", action: "copy", title: expect.stringMatching(/^Waiting for access.*last published version/) });
    });

    test("signed out still asks to sign in", () => {
      expect(publishButtonState({ receipt: "never", connection: { signedIn: false, connected: false, team: true } }))
        .toMatchObject({ action: "setup" });
    });
  });

  test("applyPublishButton draws label, tone, icon, action and tooltip; the label is text", () => {
    const btn = document.createElement("button");
    applyPublishButton(btn, { label: "<b>x</b>", action: "copy", tone: "busy", icon: "spinner", title: "t" });
    expect(btn.dataset.action).toBe("copy");
    expect(btn.title).toBe("t");
    expect(btn.classList.contains("publish-btn--busy")).toBe(true);
    expect(btn.querySelector(".publish-btn__icon--spinner")).not.toBeNull();
    expect(btn.querySelector(".publish-btn__label").textContent).toBe("<b>x</b>");
    applyPublishButton(btn, { label: "Copy link", action: "copy", tone: "", icon: "", title: "" });
    expect(btn.classList.contains("publish-btn--busy")).toBe(false);
    expect(btn.querySelector(".publish-btn__icon")).toBeNull();
  });

  test("applyPublishButton disables the button for a disabled view and enables it again", () => {
    const btn = document.createElement("button");
    applyPublishButton(btn, { label: "Copy link", action: "copy", tone: "", icon: "", title: "Save your changes first", disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Save your changes first");
    applyPublishButton(btn, { label: "Copy link", action: "copy", tone: "", icon: "", title: "", disabled: false });
    expect(btn.disabled).toBe(false);
  });
});

describe("runPublishButtonAction", () => {
  const deps = () => ({
    api: {
      retryPublish: jest.fn(async () => true),
      getPublishLink: jest.fn(async () => "https://me.github.io/axibuilds/?n=x&b=f.k"),
      writeClipboardText: jest.fn(async () => {}),
    },
    openSetup: jest.fn(),
    signIn: jest.fn(),
    askOwnerChoice: jest.fn(),
    notify: jest.fn(),
  });

  test("copy fetches the link and copies it", async () => {
    const d = deps();
    await runPublishButtonAction("copy", { kind: "build", id: "a" }, d);
    expect(d.api.getPublishLink).toHaveBeenCalledWith("build", "a");
    expect(d.api.writeClipboardText).toHaveBeenCalledWith("https://me.github.io/axibuilds/?n=x&b=f.k");
    expect(d.notify).toHaveBeenCalledWith("Link copied!");
    expect(d.api.retryPublish).not.toHaveBeenCalled();
  });

  test("publish-and-copy queues a publish first", async () => {
    const d = deps();
    await runPublishButtonAction("publish-and-copy", { kind: "comp", id: "c" }, d);
    expect(d.api.retryPublish).toHaveBeenCalledWith("comp", "c");
    expect(d.api.writeClipboardText).toHaveBeenCalled();
  });

  test("a missing link is an error, not an empty clipboard", async () => {
    const d = deps();
    d.api.getPublishLink.mockResolvedValue(null);
    await expect(runPublishButtonAction("copy", { kind: "build", id: "a" }, d)).rejects.toThrow(/link/i);
    expect(d.api.writeClipboardText).not.toHaveBeenCalled();
  });

  test.each([
    ["setup", "openSetup"],
    ["sign-in", "signIn"],
  ])("%s calls %s", async (action, dep) => {
    const d = deps();
    await runPublishButtonAction(action, { kind: "build", id: "a" }, d);
    expect(d[dep]).toHaveBeenCalled();
  });

  test("retry and choose-owner", async () => {
    const d = deps();
    await runPublishButtonAction("retry", { kind: "build", id: "a" }, d);
    expect(d.api.retryPublish).toHaveBeenCalledWith("build", "a");
    await runPublishButtonAction("choose-owner", { kind: "build", id: "a", owner: "mate" }, d);
    expect(d.askOwnerChoice).toHaveBeenCalledWith("build", "a", "mate");
  });
});
