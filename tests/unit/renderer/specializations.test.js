"use strict";

// makeTraitButton uses document.createElement — mock the DOM.
const _listeners = [];
function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    type: "",
    className: "",
    title: "",
    textContent: "",
    disabled: false,
    src: "",
    alt: "",
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(evt, fn) { _listeners.push({ evt, fn }); },
    append(...children) {},
  };
  return el;
}

global.document = { createElement: (tag) => makeElement(tag) };

const { makeTraitButton } = require("../../../src/renderer/modules/specializations");

const fakeTrait = (id, name = "Test Trait") => ({
  id,
  name,
  icon: `https://example.com/trait-${id}.png`,
});

describe("makeTraitButton", () => {
  test("inactive major trait button does NOT have trait-btn--active class", () => {
    const trait = fakeTrait(100, "Signet Mastery");
    const btn = makeTraitButton(trait, false, () => {});
    expect(btn.className).not.toContain("trait-btn--active");
    expect(btn.className).toContain("trait-btn");
  });

  test("active major trait button has trait-btn--active class", () => {
    const trait = fakeTrait(101, "Radiant Fire");
    const btn = makeTraitButton(trait, true, () => {});
    expect(btn.className).toContain("trait-btn--active");
  });

  test("CSS contains rule to visually dim inactive major trait buttons", () => {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(
      path.join(__dirname, "../../../src/renderer/styles/specializations.css"),
      "utf8"
    );
    const hasInactiveRule =
      css.includes("trait-btn:not(.trait-btn--active)") ||
      css.includes("trait-btn:not(.trait-btn--active):not(.trait-btn--always)");
    expect(hasInactiveRule).toBe(true);
  });

  test("inactive trait CSS rule applies opacity or grayscale to dim the icon", () => {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(
      path.join(__dirname, "../../../src/renderer/styles/specializations.css"),
      "utf8"
    );
    const hasOpacityOrGrayscale =
      /trait-btn:not\(\.trait-btn--active\)[^{]*\{[^}]*(opacity\s*:|grayscale)/s.test(css);
    expect(hasOpacityOrGrayscale).toBe(true);
  });
});
