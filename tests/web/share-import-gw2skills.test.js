const { createShareApi } = require("../../src/web/webApi/share.js");

// Records the URLs it's called with and returns a scripted response. The gw2skills
// happy path additionally decodes the chat link against the live GW2 API from the
// browser, which a unit test must not do — so these tests cover what lives in
// share.js: routing the gw2skills fetches through the Worker proxy, and surfacing
// the proxy's error. The end-to-end parse is covered by gw2skillsParse's own tests.
function recordingFetch(response) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
      text: async () => response.text ?? "",
    };
  };
  fn.calls = calls;
  return fn;
}

describe("share.importGw2Skills", () => {
  it("routes the gw2skills fetch through the Worker proxy (never fetches gw2skills.net directly)", async () => {
    const fetchImpl = recordingFetch({ ok: false, status: 502, body: { error: "gw2skills.net could not be reached." } });
    const share = createShareApi({ fetch: fetchImpl, getUpgradeCatalog: async () => ({}) });
    await expect(
      share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "pve")
    ).rejects.toThrow();
    // First network call is the proxy with the gw2skills page URL encoded in it.
    expect(fetchImpl.calls[0]).toContain("/api/gw2skills?url=");
    expect(fetchImpl.calls[0]).toContain(encodeURIComponent("https://en.gw2skills.net/editor/?abc"));
  });

  it("surfaces the proxy's error message", async () => {
    const share = createShareApi({
      fetch: recordingFetch({ ok: false, status: 502, body: { error: "gw2skills.net responded 429." } }),
      getUpgradeCatalog: async () => ({}),
    });
    await expect(
      share.importGw2Skills("https://en.gw2skills.net/editor/?abc")
    ).rejects.toThrow(/429/);
  });
});
