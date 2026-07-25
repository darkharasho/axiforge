"use strict";

// The Worker route is a thin CORS proxy for gw2skills.net (all parsing + the
// GW2-API chat-link decode happen client-side, where CORS works and the IP isn't
// rate-limited). So these tests cover the proxy contract: host allow-listing,
// pass-through of the upstream body, and upstream-error handling.
const { handleGw2Skills } = require("../../workers/share-shortener/src/gw2skills-route.js");

describe("handleGw2Skills (gw2skills.net proxy)", () => {
  it("rejects a non-gw2skills host with 400 and never fetches it", async () => {
    let fetched = false;
    const res = await handleGw2Skills("https://evil.example/x", {}, {
      fetch: async () => { fetched = true; return new Response("nope"); },
    });
    expect(res.status).toBe(400);
    expect(fetched).toBe(false);
  });

  it("rejects a malformed url with 400", async () => {
    const res = await handleGw2Skills("not a url", {}, { fetch: async () => new Response("x") });
    expect(res.status).toBe(400);
  });

  it("proxies a gw2skills.net url, passing the body and content-type through", async () => {
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", {}, {
      fetch: async (href) => {
        expect(href).toBe("https://en.gw2skills.net/editor/?abc");
        return new Response("<html>build editor</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<html>build editor</html>");
  });

  it("also proxies the ajax db sub-resource", async () => {
    const res = await handleGw2Skills("https://en.gw2skills.net/ajax/db/en.1780959497.json", {}, {
      fetch: async () => new Response('{"upgrade":{}}', { headers: { "content-type": "application/json" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"upgrade":{}}');
  });

  it("returns 502 when gw2skills is unreachable", async () => {
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", {}, {
      fetch: async () => { throw new Error("network down"); },
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/could not be reached/i);
  });

  it("returns 502 when gw2skills responds non-2xx", async () => {
    const res = await handleGw2Skills("https://en.gw2skills.net/editor/?abc", {}, {
      fetch: async () => new Response("rate limited", { status: 429 }),
    });
    expect(res.status).toBe(502);
  });
});
