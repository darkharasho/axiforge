const { createShareApi } = require("../../src/web/webApi/share.js");

function fakeFetch(response) {
  return async () => ({
    ok: response.ok ?? true,
    json: async () => response.body,
    status: response.status ?? 200,
  });
}

describe("share.importGw2Skills", () => {
  it("returns the build from the worker, applying name/gameMode", async () => {
    const build = { profession: "Guardian", title: "x" };
    const share = createShareApi({ fetch: fakeFetch({ body: { build } }) });
    const out = await share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "wvw");
    expect(out.profession).toBe("Guardian");
    expect(out.name).toBe("My Build");
    expect(out.gameMode).toBe("wvw");
  });

  it("throws a clear error when the worker returns an error", async () => {
    const share = createShareApi({
      fetch: fakeFetch({ ok: false, status: 502, body: { error: "gw2skills.net could not be reached." } }),
    });
    await expect(share.importGw2Skills("https://en.gw2skills.net/editor/?abc")).rejects.toThrow(/gw2skills/i);
  });
});
