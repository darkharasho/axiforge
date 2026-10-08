"use strict";
const { resolveDataBase } = require("../../../src/site/rawBase");

const sp = (s) => new URLSearchParams(s);

describe("resolveDataBase", () => {
  test("honors explicit remoteBase (dev)", () => {
    expect(resolveDataBase({ hostname: "localhost", pathname: "/" }, sp("remoteBase=http://x/site/")))
      .toBe("http://x/site/");
  });
  test("derives raw URL from github.io host + repo path", () => {
    expect(resolveDataBase({ hostname: "revan-malice.github.io", pathname: "/axibuilds/" }, sp("")))
      .toBe("https://raw.githubusercontent.com/revan-malice/axibuilds/main/site/");
  });
  test("handles deep pathname (build link)", () => {
    expect(resolveDataBase({ hostname: "gw2eww.github.io", pathname: "/axibuilds/index.html" }, sp("")))
      .toBe("https://raw.githubusercontent.com/gw2eww/axibuilds/main/site/");
  });
  test("falls back to relative base off github.io", () => {
    expect(resolveDataBase({ hostname: "example.com", pathname: "/" }, sp(""))).toBe("");
  });
});

const { resolvePinnedBase, pinnedRawBase, _resetPinnedBases } = require("../../../src/site/rawBase");

describe("resolvePinnedBase", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const loc = { hostname: "me.github.io", pathname: "/axibuilds/" };
  const textRes = (body, ok = true, status = 200) => ({ ok, status, text: async () => body });
  beforeEach(() => _resetPinnedBases());

  test("pins the base to the commit the API names", async () => {
    const fetchImpl = jest.fn(async () => textRes(`${SHA}\n`));
    await expect(resolvePinnedBase(loc, sp(""), fetchImpl))
      .resolves.toBe(`https://raw.githubusercontent.com/me/axibuilds/${SHA}/site/`);
    expect(fetchImpl).toHaveBeenCalledWith("https://api.github.com/repos/me/axibuilds/commits/main", expect.objectContaining({
      headers: { Accept: "application/vnd.github.sha" },
      cache: "no-store",
    }));
  });

  test.each([
    ["a 403", () => textRes("rate limited", false, 403)],
    ["a 429", () => textRes("slow down", false, 429)],
    ["a malformed body", () => textRes("<html>")],
    ["a network error", () => { throw new TypeError("Failed to fetch"); }],
  ])("falls back to main on %s", async (_label, respond) => {
    const fetchImpl = jest.fn(async () => respond());
    await expect(resolvePinnedBase(loc, sp(""), fetchImpl))
      .resolves.toBe("https://raw.githubusercontent.com/me/axibuilds/main/site/");
  });

  test("falls back to main after 3 s without an answer", async () => {
    jest.useFakeTimers();
    try {
      const pending = resolvePinnedBase(loc, sp(""), () => new Promise(() => {}));
      await jest.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toBe("https://raw.githubusercontent.com/me/axibuilds/main/site/");
    } finally {
      jest.useRealTimers();
    }
  });

  test("remoteBase wins and makes no lookup", async () => {
    const fetchImpl = jest.fn();
    await expect(resolvePinnedBase(loc, sp("remoteBase=http://x/site/"), fetchImpl)).resolves.toBe("http://x/site/");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("off github.io the base stays relative", async () => {
    await expect(resolvePinnedBase({ hostname: "localhost", pathname: "/" }, sp(""), jest.fn())).resolves.toBe("");
  });

  test("one lookup per owner per page load, even in parallel", async () => {
    const fetchImpl = jest.fn(async () => textRes(SHA));
    await Promise.all([pinnedRawBase("mate", "axibuilds", fetchImpl), pinnedRawBase("mate", "axibuilds", fetchImpl), pinnedRawBase("me", "axibuilds", fetchImpl)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
