"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src", "renderer");
const STYLES = path.join(SRC, "styles");

/**
 * Every heroicon in this app ships as an <svg> with a viewBox and no width or
 * height, so it has no intrinsic size: whatever renders it has to say how big
 * it is. The package gives .axi-btn no icon rule, and the conversion removed
 * the `.lib-toolbar__new-btn svg` rule that used to do the job (599c3dc2)
 * along with the class it was scoped to. The result rendered every icon in
 * every .axi-btn at zero -- the New button's plus and the Import arrow both
 * silently disappeared, with nothing in the markup or the CSS individually
 * wrong. So: if a button carries .axi-btn and an icon, something must size it.
 */
function read(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return read(full, ext);
    return e.isFile() && e.name.endsWith(ext) ? [full] : [];
  });
}

const allCss = read(STYLES, ".css").map((f) => fs.readFileSync(f, "utf8")).join("\n");

describe("an icon inside a button has a size", () => {
  it("finds .axi-btn buttons that actually carry an icon", () => {
    const sources = [...read(SRC, ".js"), path.join(SRC, "index.html")];
    const withIcon = sources.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8");
      const buttons = src.match(/<button\b[^>]*class="[^"]*\baxi-btn\b[^"]*"[^>]*>[\s\S]*?<\/button>/g) || [];
      return buttons.filter((b) => /<svg|Icon\b/.test(b));
    });
    expect(withIcon.length).toBeGreaterThan(0);
  });

  it("sizes svg inside .axi-btn, which the package does not", () => {
    // The rule may live in any of the app's stylesheets; what matters is that
    // one exists and gives both dimensions.
    const rule = allCss.match(/\.axi-btn\s+svg\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/width\s*:/);
    expect(rule[1]).toMatch(/height\s*:/);
  });
});
