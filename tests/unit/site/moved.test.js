"use strict";

// Links handed out before an item moved to its team's account: the old host
// leaves site/moved/<fileId>.json, and the viewer follows it.

const { movedOwner, movedPageUrl, isOwnSite } = require("../../../src/site/moved.js");

const res = (body, ok = true) => ({ ok, json: async () => body });

describe("movedOwner", () => {
  test("reads the new host from the pointer next to the missing payload", async () => {
    const fetchImpl = jest.fn(async () => res({ owner: "guild" }));
    expect(await movedOwner("BASE/", "ab12", fetchImpl)).toBe("guild");
    expect(fetchImpl).toHaveBeenCalledWith("BASE/moved/ab12.json", { cache: "no-store" });
  });

  test("no pointer, a bad one, or a network error is null", async () => {
    expect(await movedOwner("B/", "x", async () => res(null, false))).toBeNull();
    expect(await movedOwner("B/", "x", async () => res({ owner: "../evil" }))).toBeNull();
    expect(await movedOwner("B/", "x", async () => { throw new Error("offline"); })).toBeNull();
  });
});

test("the new page keeps the link's query, so file id, key, slug and theme carry over", () => {
  expect(movedPageUrl("guild", { search: "?n=fb&b=ab12.KEY&t=dark", hash: "" }))
    .toBe("https://guild.github.io/axibuilds/?n=fb&b=ab12.KEY&t=dark");
});

test("a pointer to this same site isn't followed", () => {
  expect(isOwnSite("Guild", { hostname: "guild.github.io" })).toBe(true);
  expect(isOwnSite("guild", { hostname: "mate.github.io" })).toBe(false);
});
