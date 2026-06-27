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
