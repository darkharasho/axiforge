"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src", "renderer");

/**
 * .axi-picker__btn paints its own caret -- two triangles in the button's
 * background, in the accent colour. A template that also drops a chevron icon
 * inside the button shows the user two arrows on one control, which is what
 * the library's filter triggers did while they still carried the pre-
 * conversion markup. So: a picker button renders no chevron of its own.
 */
function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(full);
    return e.isFile() && e.name.endsWith(".js") ? [full] : [];
  });
}

describe("a picker button draws no chevron beside its own caret", () => {
  const files = jsFiles(SRC).filter((f) => fs.readFileSync(f, "utf8").includes("axi-picker__btn"));

  it("finds the picker buttons it is meant to guard", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s", (_rel, file) => {
    const src = fs.readFileSync(file, "utf8");
    // Every <button ...>...</button> whose class list names the picker button.
    const buttons = src.match(/<button\b[^>]*axi-picker__btn[\s\S]*?<\/button>/g) || [];
    for (const button of buttons) {
      expect(button).not.toMatch(/chevron/i);
    }
  });
});
