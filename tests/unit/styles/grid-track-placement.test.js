"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/**
 * A grid whose tracks are positional -- rail, handle, content -- breaks the
 * moment one of its children is taken out of flow, because auto-placement
 * slides every later child one track to the left. The library hit this twice
 * from a single declaration: `.lib-resizer { display: none }` fires both when
 * the sidebar is collapsed and on coarse pointers, and both of those rules
 * size track 2 at zero, so .lib-main auto-placed into a zero-width column and
 * the whole library rendered as a rail and nothing else.
 *
 * The fix is explicit placement, and this is the guard: a stylesheet that
 * hides a grid child with display: none must name the columns, so a missing
 * child costs nothing but its own track.
 */
const SHEETS = [
  ["src/renderer/styles/library.css", ".lib-page", [".lib-sidebar", ".lib-resizer", ".lib-main"]],
];

describe("positional grid children are placed explicitly", () => {
  it.each(SHEETS)("%s: every child of %s names its own column", (sheet, _parent, children) => {
    const css = fs.readFileSync(path.join(ROOT, sheet), "utf8");
    for (const child of children) {
      // `.lib-main { ... grid-column: 3; ... }` -- the selector standing alone
      // as its own rule, with a grid-column inside it.
      const rule = new RegExp(
        `\\${child}\\s*\\{[^}]*grid-column\\s*:`,
      );
      expect(rule.test(css)).toBe(true);
    }
  });
});
