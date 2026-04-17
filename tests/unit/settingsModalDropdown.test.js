"use strict";

/**
 * Regression tests for the "publishing repo dropdown doesn't work" bug.
 *
 * Root cause: .settings-modal__section uses `animation-fill-mode: forwards`
 * with a final keyframe of `transform: translateY(0)`. Any non-`none`
 * transform value creates a new containing block for `position: fixed`
 * descendants, so the custom-select menu (positioned fixed) is constrained
 * to the section's bounds and gets clipped by .settings-modal's
 * `overflow: hidden`.
 *
 * Fix: end the keyframe at `transform: none` so no containing block is
 * created after the animation completes.
 */

const fs = require("fs");
const path = require("path");

describe("settings-modal dropdown CSS — no transform containing block", () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/styles/settings-modal.css"),
      "utf8"
    );
  });

  test("sm-section-in keyframe to-state does not use transform: translateY(0)", () => {
    // If the keyframe ends at translateY(0), it creates a containing block
    // for position:fixed descendants, breaking the custom-select dropdown.
    // The to-state must use `transform: none` (or omit transform entirely).
    const keyframeBlock = css.match(/@keyframes\s+sm-section-in\s*\{[\s\S]*?\}/)?.[0] || "";
    expect(keyframeBlock).toBeTruthy();

    // Must NOT contain translateY(0) in the final state
    const toBlock = keyframeBlock.match(/to\s*\{[\s\S]*?\}/)?.[0] || "";
    expect(toBlock).not.toMatch(/transform\s*:\s*translateY\s*\(\s*0\s*(px)?\s*\)/);
  });

  test("sm-section-in keyframe to-state explicitly resets transform to none", () => {
    const keyframeBlock = css.match(/@keyframes\s+sm-section-in\s*\{[\s\S]*?\}/)?.[0] || "";
    const toBlock = keyframeBlock.match(/to\s*\{[\s\S]*?\}/)?.[0] || "";
    // The to-state should set transform: none so no containing block persists
    expect(toBlock).toMatch(/transform\s*:\s*none/);
  });
});
