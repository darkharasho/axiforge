/** @jest-environment jsdom */
"use strict";

const {
  ownerChoiceBody, askOwnerChoice, bulkPromptBody, maybeShowBulkPublishPrompt, BULK_PROMPT_SETTING,
} = require("../../../src/renderer/modules/publish-prompts.js");

describe("owner choice prompt", () => {
  test("the login is escaped", () => {
    const html = ownerChoiceBody("build", "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Your link will point at your account; their link keeps working but stops updating.");
  });

  test.each([[true, "mine"], [false, "theirs"]])("confirm %s stores %s", async (answer, choice) => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    const confirm = jest.fn(async () => answer);
    await expect(askOwnerChoice("comp", "c1", "mate", { confirm, api })).resolves.toBe(answer);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Publish my copy", cancelLabel: "Keep theirs" }));
    expect(api.setPublishChoice).toHaveBeenCalledWith("comp", "c1", choice);
  });
});

describe("bulk prompt", () => {
  const api = (over = {}) => ({
    getSetting: jest.fn(async () => null),
    setSetting: jest.fn(async () => {}),
    getBulkPublishCount: jest.fn(async () => 7),
    bulkPublish: jest.fn(async () => 7),
    ...over,
  });
  const CONNECTED = { isAuthenticated: true, repoReady: true };

  test("asks once, remembers the answer, publishes on yes", async () => {
    const a = api();
    const confirm = jest.fn(async () => true);
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm })).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Publish your library?", confirmLabel: "Publish all", cancelLabel: "Not now" }));
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).toHaveBeenCalled();
  });

  test("\"Not now\" is remembered and publishes nothing", async () => {
    const a = api();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm: async () => false });
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).not.toHaveBeenCalled();
  });

  test("never shown twice", async () => {
    const a = api({ getSetting: jest.fn(async () => true) });
    const confirm = jest.fn();
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm })).resolves.toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("waits for setup: nothing happens while disconnected", async () => {
    const a = api();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: { isAuthenticated: true }, confirm: jest.fn() });
    expect(a.getSetting).not.toHaveBeenCalled();
  });

  test("with nothing unpublished it is marked done without asking", async () => {
    const a = api({ getBulkPublishCount: jest.fn(async () => 0) });
    const confirm = jest.fn();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
  });

  test("body text", () => {
    expect(bulkPromptBody(7)).toContain("You have 7 that have never been published.");
    expect(bulkPromptBody(1)).toContain("You have 1 that has never been published.");
    expect(bulkPromptBody(7)).toContain("It runs in the background, 50 at a time.");
  });
});
