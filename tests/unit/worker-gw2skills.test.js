"use strict";

// The route runs the full gw2skillsParse pipeline server-side. The chat-link
// decode (decodeChatLinkToBuild) is exercised end-to-end against baked GW2 API
// data elsewhere; here we mock it (as tests/unit/gw2skillsImport.test.js does) so
// the route contract can be tested without shipping the baked datasets into Jest.
function stubEnv() {
  return {
    ASSETS: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (path.endsWith("upgrades.json")) {
          return new Response(
            JSON.stringify({ runes: [], sigils: [], infusions: [], enrichments: [], foods: [], utilities: [] }),
            { headers: { "content-type": "application/json; charset=utf-8" } }
          );
        }
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    },
  };
}

describe("handleGw2Skills (server-side parse, baked decode)", () => {
  afterEach(() => {
    delete globalThis.__GW2_BAKED_FETCH__;
    jest.dontMock("../../src/main/buildChatLink.js");
    jest.resetModules();
  });

  it("rejects a non-gw2skills url with 400", async () => {
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const res = await handleGw2Skills("https://evil.example/x", stubEnv(), { fetchText: async () => "" });
    expect(res.status).toBe(400);
  });

  it("installs the baked GW2-API hook so decode never hits the live API", async () => {
    let sawBakedHook = false;
    jest.doMock("../../src/main/buildChatLink.js", () => ({
      decodeChatLinkToBuild: async () => {
        sawBakedHook = typeof globalThis.__GW2_BAKED_FETCH__ === "function";
        return { profession: "Guardian", specializations: [], equipment: { weapons: {} } };
      },
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
    expect(sawBakedHook).toBe(true); // decode ran with the baked hook installed
  });

  it("returns 502 with a detail when the upstream fetch fails", async () => {
    const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");
    const fetchText = async () => { throw new Error("Failed to fetch: network down"); };
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", stubEnv(), { fetchText });
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toMatch(/network down/);
  });
});
