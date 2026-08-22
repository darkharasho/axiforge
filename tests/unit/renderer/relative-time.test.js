/** @jest-environment jsdom */
"use strict";

const { relativeTime } = require("../../../src/renderer/modules/utils.js");

const ago = (ms) => new Date(Date.now() - ms).toISOString();

test("relativeTime buckets by minutes, hours and days", () => {
  expect(relativeTime(ago(5_000))).toBe("just now");
  expect(relativeTime(ago(60_000))).toBe("1 minute ago");
  expect(relativeTime(ago(5 * 60_000))).toBe("5 minutes ago");
  expect(relativeTime(ago(60 * 60_000))).toBe("1 hour ago");
  expect(relativeTime(ago(3 * 60 * 60_000))).toBe("3 hours ago");
  expect(relativeTime(ago(26 * 60 * 60_000))).toBe("1 day ago");
  expect(relativeTime(ago(3 * 24 * 60 * 60_000))).toBe("3 days ago");
});

test("relativeTime falls back to 'just now' for unusable input", () => {
  expect(relativeTime(undefined)).toBe("just now");
  expect(relativeTime("not-a-date")).toBe("just now");
});
