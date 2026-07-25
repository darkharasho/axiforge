const { createShareApi } = require("../../src/web/webApi/share.js");

function fakeFetch(response) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    };
  };
  fn.calls = calls;
  return fn;
}

describe("share.importGw2Skills", () => {
  it("makes one request to the Worker with the url + gameMode, returns the Worker-resolved build", async () => {
    const build = { profession: "Guardian", title: "x", gameMode: "wvw" };
    const fetchImpl = fakeFetch({ body: { build } });
    const share = createShareApi({ fetch: fetchImpl });
    const out = await share.importGw2Skills("https://en.gw2skills.net/editor/?abc", "My Build", null, "pve");
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]).toContain("/api/gw2skills?url=");
    expect(fetchImpl.calls[0]).toContain("gameMode=pve"); // editor mode as fallback
    expect(out.profession).toBe("Guardian");
    expect(out.name).toBe("My Build");
    expect(out.gameMode).toBe("wvw"); // Worker's preload mode wins over the fallback
  });

  it("surfaces the Worker's error + detail", async () => {
    const share = createShareApi({
      fetch: fakeFetch({ ok: false, status: 502, body: { error: "gw2skills.net could not be reached.", detail: "429" } }),
    });
    await expect(
      share.importGw2Skills("https://en.gw2skills.net/editor/?abc")
    ).rejects.toThrow(/could not be reached.*429/);
  });
});
