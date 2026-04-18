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

/**
 * Regression test for issue #241 — confirm modal appears behind settings modal.
 *
 * Root cause: .settings-modal-overlay used --z-modal-confirm (1100), the same
 * z-index as the confirm modal overlay. When both are open simultaneously the
 * settings modal occludes the confirm modal because DOM order makes it paint
 * on top at equal z-index.
 *
 * Fix: settings-modal-overlay must use --z-modal (1000) so the confirm modal
 * at --z-modal-confirm (1100) always stacks above it.
 */

describe("settings-modal CSS — z-index below confirm modal (issue #241)", () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/styles/settings-modal.css"),
      "utf8"
    );
  });

  test(".settings-modal-overlay uses --z-modal, not --z-modal-confirm", () => {
    // Extract the .settings-modal-overlay rule block
    const overlayBlock =
      css.match(/\.settings-modal-overlay\s*\{[^}]*\}/)?.[0] || "";
    expect(overlayBlock).toBeTruthy();
    // Must use --z-modal so the confirm modal (--z-modal-confirm) can stack above it
    expect(overlayBlock).toMatch(/z-index\s*:\s*var\(--z-modal\)/);
    expect(overlayBlock).not.toMatch(/z-index\s*:\s*var\(--z-modal-confirm\)/);
  });
});

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
