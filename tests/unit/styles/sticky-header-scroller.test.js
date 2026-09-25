"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/**
 * A sticky header comes to rest below its scroll container's top padding, not
 * at the container's top edge. That leaves a strip above the header that the
 * header does not cover and the scrolled-away card no longer fills, so rows
 * slide through it -- moving text above the thing that is meant to BE the top
 * edge. The library hit this the moment .lib-content took symmetric padding
 * for the card's offset block.
 *
 * The fix is to zero the scroller's top padding for the view that carries the
 * sticky header, and this is the guard: each pair below names a scroller and
 * the view whose header sticks inside it.
 */
const PAIRS = [
  ["src/renderer/styles/library.css", ".lib-content", ".lib-tv"],
];

describe("a scroller holding a sticky header carries no top padding", () => {
  it.each(PAIRS)("%s: %s zeroes its top padding for %s", (sheet, scroller, view) => {
    const css = fs.readFileSync(path.join(ROOT, sheet), "utf8");

    // The view's header is sticky to the top -- the precondition this guards.
    const header = new RegExp(`\\${view}__header\\s*\\{[^}]*position:\\s*sticky[^}]*top:\\s*0`);
    expect(header.test(css)).toBe(true);

    const zeroed = new RegExp(
      `\\${scroller}:has\\(\\${view}\\)\\s*\\{[^}]*padding-top:\\s*0`
    );
    expect(zeroed.test(css)).toBe(true);
  });
});
