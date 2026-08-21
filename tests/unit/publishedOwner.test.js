"use strict";
const { publishedOwnerFor, shortUrl } = require("../../src/main/shortUrl");

test("publishedOwnerFor prefers the record's owner, falls back to the account owner", () => {
  expect(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me")).toBe("gw2eww");
  expect(publishedOwnerFor({ publishedOwner: "" }, "me")).toBe("me");
  expect(publishedOwnerFor({}, "me")).toBe("me");
  expect(shortUrl(publishedOwnerFor({ publishedOwner: "gw2eww" }, "me"), "axibuilds", "abc")).toBe("https://gw2eww.github.io/axibuilds/r/abc");
});
