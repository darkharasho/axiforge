"use strict";

/**
 * Verifies that spec connector lines are redrawn on window resize.
 * Bug: #148 — Published Build window scaling issue in web browser.
 *
 * The SVG connector coordinates are computed from getBoundingClientRect at draw
 * time. Without a resize handler the lines become misaligned when the browser
 * window changes size.
 */

const fs = require("fs");
const path = require("path");

describe("spec connector resize handling", () => {
  test("render-build.js imports drawSpecConnector", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/site/render-build.js"),
      "utf8"
    );
    expect(src).toMatch(/drawSpecConnector/);
  });

  test("render-build.js registers a window resize listener that redraws connectors", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../../../src/site/render-build.js"),
      "utf8"
    );
    // Must add a resize event listener
    expect(src).toMatch(/addEventListener\s*\(\s*["']resize["']/);
    // The resize handler must reference drawSpecConnector or spec-card__body
    expect(src).toMatch(/resize[\s\S]{0,300}(drawSpecConnector|spec-card__body)/);
  });
});
