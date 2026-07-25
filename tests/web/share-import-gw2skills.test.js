const { createShareApi } = require("../../src/web/webApi/share.js");

function fakeFetch(response) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return {
      ok: response.ok ?? true,
      json: async () => response.body,
      status: response.status ?? 200,
    };
  };
  fn.calls = calls;
  return fn;
}

describe("share.importGw2Skills", () => {
  it("threads gameMode as a fallback query param and returns the Worker-resolved mode", async () => {
    const build = { profession: "Guardian", title: "x", gameMode: "wvw" };
    const fetchImpl = fakeFetch({ body: { build } });
    const share = createShareApi({ fetch: fetchImpl });
    const out = await share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "pve");
    // The editor's current mode ("pve") is passed through as a fallback query
    // param, NOT used to override the Worker's resolved mode.
    expect(fetchImpl.calls[0]).toContain("gameMode=pve");
    expect(out.profession).toBe("Guardian");
    expect(out.name).toBe("My Build");
    expect(out.gameMode).toBe("wvw");
  });

  it("defaults to pve when the Worker's build has no gameMode", async () => {
    const build = { profession: "Guardian", title: "x" };
    const share = createShareApi({ fetch: fakeFetch({ body: { build } }) });
    const out = await share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "wvw");
    expect(out.gameMode).toBe("pve");
  });

  it("throws a clear error when the worker returns an error", async () => {
    const share = createShareApi({
      fetch: fakeFetch({ ok: false, status: 502, body: { error: "gw2skills.net could not be reached." } }),
    });
    await expect(share.importGw2Skills("https://en.gw2skills.net/editor/?abc")).rejects.toThrow(/gw2skills/i);
  });
});
