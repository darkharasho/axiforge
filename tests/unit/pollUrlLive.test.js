const { pollUrlLive } = require("../../src/main/githubApi");

describe("pollUrlLive", () => {
  test("resolves true immediately when the URL is already live", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true });
    const delayImpl = jest.fn().mockResolvedValue(undefined);
    const nowImpl = jest.fn().mockReturnValue(0);

    const result = await pollUrlLive("https://example.com/build.enc", {
      fetchImpl,
      delayImpl,
      nowImpl,
      intervalMs: 100,
      timeoutMs: 5000,
    });

    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(delayImpl).not.toHaveBeenCalled();
  });

  test("retries until the URL becomes live", async () => {
    let calls = 0;
    const fetchImpl = jest.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve({ ok: calls >= 3 });
    });
    const delayImpl = jest.fn().mockResolvedValue(undefined);
    let now = 0;
    const nowImpl = jest.fn().mockImplementation(() => now);

    const result = await pollUrlLive("https://example.com/build.enc", {
      fetchImpl,
      delayImpl,
      nowImpl,
      intervalMs: 100,
      timeoutMs: 5000,
    });

    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delayImpl).toHaveBeenCalledTimes(2);
  });

  test("returns false when the deadline is exceeded", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false });
    const delayImpl = jest.fn().mockResolvedValue(undefined);
    let now = 0;
    const nowImpl = jest.fn().mockImplementation(() => {
      const val = now;
      now += 1000;
      return val;
    });

    const result = await pollUrlLive("https://example.com/build.enc", {
      fetchImpl,
      delayImpl,
      nowImpl,
      intervalMs: 100,
      timeoutMs: 2000,
    });

    expect(result).toBe(false);
  });
});
