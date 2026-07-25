"use strict";

// The route drives the real gw2skillsParse core, but the chat-link decode step
// (decodeChatLinkToBuild) calls out to the live GW2 API via gw2buildlink — not
// something a Worker unit test should depend on. We mock buildChatLink.js the
// same way tests/unit/gw2skillsImport.test.js does for its integration test,
// and require the route module fresh (via jest.resetModules) after mocking so
// gw2skillsParse.js's `require("./buildChatLink.js")` picks up the stub.
function stubEnv(upgrades) {
  return { ASSETS: { fetch: async () => new Response(JSON.stringify(upgrades)) } };
}

describe("handleGw2Skills", () => {
  afterEach(() => {
    jest.dontMock("../../src/main/buildChatLink.js");
    jest.resetModules();
  });

  it("rejects a non-gw2skills url with 400", async () => {
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const res = await handleGw2Skills("https://evil.example/x", stubEnv({}), { fetchText: async () => "" });
    expect(res.status).toBe(400);
  });

  it("returns a build for a valid gw2skills url", async () => {
    jest.doMock("../../src/main/buildChatLink.js", () => ({
      decodeChatLinkToBuild: async () => ({
        profession: "Guardian",
        specializations: [],
        equipment: { weapons: {} },
      }),
    }));
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const html = `new BuildEditor({ dbid: 1, showinfo: SI, preload: { chatlink: "DQYfHSkb", mode: "pve", equipment: {} } })`;
    const fetchText = async (u) =>
      u.includes("/ajax/db/") ? JSON.stringify({ upgrade: { desc: [], rows: [] } }) : html;
    const res = await handleGw2Skills(
      "https://en.gw2skills.net/editor/?abc",
      // Minimal but complete upgrade-catalog shape (same shape as desktop's
      // getUpgradeCatalog("en")): gw2skillsParse.js maps over each of these
      // arrays unconditionally, so an empty `{}` throws before assembly.
      stubEnv({ runes: [], sigils: [], infusions: [], enrichments: [], foods: [], utilities: [] }),
      { fetchText }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.build).toBeTruthy();
    expect(body.build.profession).toBeDefined();
  });
});
