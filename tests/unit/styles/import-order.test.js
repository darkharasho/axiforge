"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// The package must be in the cascade before the app's own sheet, in every
// entry. If the app sheet won the order, the app would still be overriding
// tokens it is supposed to be consuming.
const ENTRIES = [
  "src/renderer/renderer.js",
  "src/web/main-web.js",
  "src/site/main.js",
];

describe("axi-design import order", () => {
  it("declares the package as a dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["@axiapps/axi-design"]).toBeTruthy();
  });

  it.each(ENTRIES)("imports axi.css then accents.css before app CSS in %s", (entry) => {
    const src = read(entry);
    const axi = src.indexOf('@axiapps/axi-design/axi.css');
    const accents = src.indexOf('@axiapps/axi-design/accents.css');
    const app = src.search(/import ["']\.\/(styles|web)\.css["']/);

    expect(axi).toBeGreaterThan(-1);
    expect(accents).toBeGreaterThan(axi);
    expect(app).toBeGreaterThan(accents);
  });

  it("no longer link-tags the app stylesheet from the renderer HTML", () => {
    // Order between an HTML <link> and JS-imported CSS is not stable across
    // vite dev and vite build, so styles.css is imported from renderer.js.
    expect(read("src/renderer/index.html")).not.toMatch(/<link[^>]+styles\.css/);
  });

  it.each(["src/renderer/index.html", "src/site/index.html"])(
    "fetches no remote webfont in %s",
    (file) => {
      expect(read(file)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    },
  );
});
