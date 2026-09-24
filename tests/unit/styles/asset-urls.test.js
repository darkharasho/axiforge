"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// Same four directories and the same "every .css file except bridge.css"
// convention the design-rules gate uses to build its file list
// (tests/unit/styles/axi-design-rules.test.js), kept independent here since
// this file gates asset resolution, not the design language.
const DIRS = ["src/renderer/styles", "src/web", "src/site", "packages/forge-render/src"];

const FILES = DIRS.flatMap((dir) =>
  fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".css") && f !== "bridge.css")
    .map((f) => `${dir}/${f}`),
);

/** Every url(...) argument in a stylesheet, comments stripped, quotes trimmed.
    A CSS url() argument may be bare, single- or double-quoted. */
function urlsIn(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = [...withoutComments.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)];
  return matches.map((m) => m[2].trim()).filter(Boolean);
}

describe("CSS url() references resolve to a file on disk", () => {
  it.each(FILES)("%s", (file) => {
    const abs = path.join(ROOT, file);
    const css = fs.readFileSync(abs, "utf8");
    const urls = urlsIn(css).filter(
      (u) => !u.startsWith("data:") && !/^https?:/.test(u) && !u.startsWith("#"),
    );

    for (const url of urls) {
      const resolved = path.join(path.dirname(abs), url.split("?")[0].split("#")[0]);
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });
});
