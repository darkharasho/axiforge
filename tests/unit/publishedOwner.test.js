"use strict";
const { publishedOwnerFor, shortUrl } = require("../../src/main/shortUrl");

test("publishedOwnerFor prefers the record's owner, falls back to the account owner", () => {
  expect(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me")).toBe("gw2eww");
  expect(publishedOwnerFor({ publishedOwner: "" }, "me")).toBe("me");
  expect(publishedOwnerFor({}, "me")).toBe("me");
  expect(shortUrl(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me"), "axibuilds", "abc")).toBe("https://gw2eww.github.io/axibuilds/r/abc");
});

test("a comp publish links a teammate's build at THEIR owner, not the publisher's", () => {
  const { decideCompBuildPublish } = require("../../src/main/teamGuards");
  const build = { id: "b1", publishedFileId: "abc", publishedKey: "k", publishedSlug: "s", publishedOwner: "alice" };
  const { foreignOwner } = decideCompBuildPublish({ build, owner: "bob", force: false, slug: "s" });
  expect(foreignOwner).toBe("alice");
  expect(shortUrl(publishedOwnerFor(build, "bob"), "axibuilds", build.publishedFileId))
    .toBe("https://alice.github.io/axibuilds/r/abc");
});
