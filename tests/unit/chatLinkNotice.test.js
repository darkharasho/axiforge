// A chat code drops any id the GW2 API no longer recognizes instead of failing. The
// copy still succeeds, so every copy surface (editor button, share menu, library menu,
// web top bar) has to get the drop list across the bridge and say what is missing.
const fs = require("fs");
const path = require("path");
const { chatLinkDroppedNotice } = require("../../src/renderer/modules/chatLinkNotice.js");

let exposed = null;
const ipcRenderer = { invoke: jest.fn(), on: jest.fn(), removeAllListeners: jest.fn() };
jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_key, api) => { exposed = api; } },
  ipcRenderer,
}));

describe("chatLinkDroppedNotice", () => {
  it("says nothing when the code is complete", () => {
    expect(chatLinkDroppedNotice([])).toBeNull();
    expect(chatLinkDroppedNotice(undefined)).toBeNull();
  });

  it("names every dropped entry", () => {
    expect(chatLinkDroppedNotice(["heal skill 999999", "underwater utility 1 skill 888888"])).toBe(
      "Chat code copied without 2 entries the GW2 API doesn't recognize: heal skill 999999, underwater utility 1 skill 888888"
    );
  });

  it("uses the singular for one entry", () => {
    expect(chatLinkDroppedNotice(["pet 777777"])).toBe(
      "Chat code copied without 1 entry the GW2 API doesn't recognize: pet 777777"
    );
  });
});

describe("the drop list reaches the renderer", () => {
  it("the preload exposes the report over its own channel", async () => {
    require("../../src/preload/index.js");
    ipcRenderer.invoke.mockResolvedValue({ link: "[&x]", dropped: ["pet 1"] });
    await expect(exposed.generateChatLinkReport({ id: "b" })).resolves.toEqual({ link: "[&x]", dropped: ["pet 1"] });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("builds:generate-chat-link-report", { id: "b" });
  });

  it("the main process answers that channel", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../../src/main/index.js"), "utf8");
    expect(main).toMatch(/handle\("builds:generate-chat-link-report"[\s\S]{0,200}generateChatLinkReport\(build\)/);
  });

  it("the web API offers the same report", () => {
    const { createShareApi } = require("../../src/web/webApi/share.js");
    expect(typeof createShareApi().generateChatLinkReport).toBe("function");
  });

  // Each copy surface must read the report, or a code missing slots is copied silently.
  it.each([
    "src/renderer/renderer.js",
    "src/renderer/modules/library/library.js",
    "src/web/chrome.js",
  ])("%s copies chat codes through the report", (file) => {
    const src = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
    expect(src).not.toMatch(/desktopApi\.generateChatLink\(/);
    expect(src).toMatch(/desktopApi\.generateChatLinkReport\(/);
    expect(src).toMatch(/chatLinkDroppedNotice\(dropped\)/);
  });
});
