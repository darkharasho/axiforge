/** @jest-environment jsdom */
"use strict";

const {
  ownerChoiceBody, askOwnerChoice, bulkPromptBody, maybeShowBulkPublishPrompt, BULK_PROMPT_SETTING,
} = require("../../../src/renderer/modules/publish-prompts.js");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("owner choice prompt", () => {
  test("the login is escaped", () => {
    const html = ownerChoiceBody("build", "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Your link will point at your account; their link keeps working but stops updating.");
  });

  test.each([["confirm", true, "mine"], ["cancel", false, "theirs"]])("%s stores %s", async (outcome, result, choice) => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    const confirm = jest.fn(async () => outcome);
    await expect(askOwnerChoice("comp", "c1", "mate", { confirm, api })).resolves.toBe(result);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Publish my copy", cancelLabel: "Keep theirs", detailed: true }));
    expect(api.setPublishChoice).toHaveBeenCalledWith("comp", "c1", choice);
  });

  test.each(["close", "displaced"])("%s leaves the item undecided: nothing is stored", async (outcome) => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    await expect(askOwnerChoice("comp", "c2", "mate", { confirm: async () => outcome, api })).resolves.toBeNull();
    expect(api.setPublishChoice).not.toHaveBeenCalled();
  });

  test("prompts take turns: the second waits for the first answer", async () => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    const answers = [];
    const confirm = jest.fn(() => new Promise((resolve) => answers.push(resolve)));
    const first = askOwnerChoice("comp", "a", "mate", { confirm, api });
    const second = askOwnerChoice("comp", "b", "mate", { confirm, api });
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    answers[0]("cancel");
    await expect(first).resolves.toBe(false);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    answers[1]("confirm");
    await expect(second).resolves.toBe(true);
    expect(api.setPublishChoice.mock.calls).toEqual([["comp", "a", "theirs"], ["comp", "b", "mine"]]);
  });

  test("the same item asked twice shows one prompt", async () => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    let answer;
    const confirm = jest.fn(() => new Promise((resolve) => { answer = resolve; }));
    const one = askOwnerChoice("build", "x", "mate", { confirm, api });
    const two = askOwnerChoice("build", "x", "mate", { confirm, api });
    expect(two).toBe(one);
    await flush();
    answer("confirm");
    await one;
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("a prompt waits until any open confirm closes", async () => {
    const api = { setPublishChoice: jest.fn(async () => true) };
    let idle;
    const whenIdle = jest.fn(() => new Promise((resolve) => { idle = resolve; }));
    const confirm = jest.fn(async () => "confirm");
    const asked = askOwnerChoice("build", "y", "mate", { confirm, api, whenIdle });
    await flush();
    expect(whenIdle).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    idle();
    await expect(asked).resolves.toBe(true);
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
    const confirm = jest.fn(async () => "confirm");
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm })).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Publish your library?", confirmLabel: "Publish all", cancelLabel: "Not now" }));
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).toHaveBeenCalled();
  });

  test("\"Not now\" is remembered and publishes nothing", async () => {
    const a = api();
    await maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm: async () => "cancel" });
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    expect(a.bulkPublish).not.toHaveBeenCalled();
  });

  test("replaced by another confirm, it is not remembered and asks again later", async () => {
    const a = api();
    await expect(maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm: async () => "displaced" })).resolves.toBe(false);
    expect(a.setSetting).not.toHaveBeenCalled();
    expect(a.bulkPublish).not.toHaveBeenCalled();
  });

  test("an owner prompt arriving during the bulk prompt waits its turn", async () => {
    const a = api();
    const answers = [];
    const confirm = jest.fn(() => new Promise((resolve) => answers.push(resolve)));
    const bulk = maybeShowBulkPublishPrompt({ api: a, onboarding: CONNECTED, confirm });
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    const choiceApi = { setPublishChoice: jest.fn(async () => true) };
    const owner = askOwnerChoice("comp", "late", "mate", { confirm, api: choiceApi });
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    answers[0]("confirm");
    await expect(bulk).resolves.toBe(true);
    expect(a.setSetting).toHaveBeenCalledWith(BULK_PROMPT_SETTING, true);
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0].title).toBe("Publish your own copy?");
    answers[1]("cancel");
    await expect(owner).resolves.toBe(false);
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
