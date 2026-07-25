"use strict";

// The route runs the full gw2skillsParse pipeline server-side, but the chat-link
// decode (decodeChatLinkToBuild) calls the live GW2 API via gw2buildlink — not
// something a unit test should hit. We mock buildChatLink.js the same way
// tests/unit/gw2skillsImport.test.js does, and require the route fresh (after
// jest.resetModules) so gw2skillsParse.js's require("./buildChatLink.js") picks
// up the stub.
function stubEnv() {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(
          JSON.stringify({ runes: [], sigils: [], infusions: [], enrichments: [], foods: [], utilities: [] }),
          { headers: { "content-type": "application/json; charset=utf-8" } }
        ),
    },
  };
}

describe("handleGw2Skills (server-side parse)", () => {
  afterEach(() => {
    jest.dontMock("../../src/main/buildChatLink.js");
    jest.resetModules();
  });

  it("rejects a non-gw2skills url with 400", async () => {
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const res = await handleGw2Skills("https://evil.example/x", stubEnv(), { fetchText: async () => "" });
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
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", stubEnv(), { fetchText });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.build).toBeTruthy();
    expect(body.build.profession).toBeDefined();
  });

  it("returns 502 with a detail when parsing fails on an unreachable upstream", async () => {
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const fetchText = async () => { throw new Error("Failed to fetch: network down"); };
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", stubEnv(), { fetchText });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.detail).toMatch(/network down/);
  });
});
