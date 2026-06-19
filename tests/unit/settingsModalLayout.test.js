"use strict";

const fs = require("fs");
const path = require("path");

describe("settings-modal CSS — sidebar-nav layout", () => {
  let css;
  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/styles/settings-modal.css"),
      "utf8"
    );
  });

  test(".settings-modal is a horizontal flex container", () => {
    const block = css.match(/\.settings-modal\s*\{[^}]*\}/)?.[0] || "";
    expect(block).toMatch(/display\s*:\s*flex/);
    expect(block).not.toMatch(/flex-direction\s*:\s*column/);
  });

  test(".settings-modal is wider than the old 520px", () => {
    const block = css.match(/\.settings-modal\s*\{[^}]*\}/)?.[0] || "";
    const width = block.match(/width\s*:\s*(\d+)px/)?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(760);
  });

  test("sidebar and nav-item classes exist", () => {
    expect(css).toMatch(/\.settings-modal__sidebar\s*\{/);
    expect(css).toMatch(/\.settings-modal__nav-item\s*\{/);
    expect(css).toMatch(/\.settings-modal__nav-item--active\s*\{/);
  });

  test("active nav item uses the accent tint", () => {
    const block = css.match(/\.settings-modal__nav-item--active\s*\{[^}]*\}/)?.[0] || "";
    expect(block).toMatch(/rgba\(var\(--accent-rgb\)\s*,\s*0?\.16\)/);
  });

  test("inactive panes are hidden, active pane shown", () => {
    const pane = css.match(/\.settings-modal__pane\s*\{[^}]*\}/)?.[0] || "";
    expect(pane).toMatch(/display\s*:\s*none/);
    const active = css.match(/\.settings-modal__pane--active\s*\{[^}]*\}/)?.[0] || "";
    expect(active).toMatch(/display\s*:\s*block/);
  });

  test("sm-section-in keyframe to-state still resets transform to none (issue regression)", () => {
    const kf = css.match(/@keyframes\s+sm-section-in\s*\{[\s\S]*?\n\}/)?.[0] || "";
    const to = kf.match(/to\s*\{[\s\S]*?\}/)?.[0] || "";
    expect(to).not.toMatch(/transform\s*:\s*translateY\s*\(\s*0/);
    expect(to).toMatch(/transform\s*:\s*none/);
  });
});
