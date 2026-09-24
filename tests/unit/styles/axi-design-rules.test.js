"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// Every stylesheet the app owns. The package's own dist/ is exempt: tokens.css
// is the one file in the system allowed to hold a colour literal.
const APP_CSS = [
  "src/renderer/styles/app.css",
  // Deleted by Task 3, which removes these two lines with them.
  "src/renderer/styles/base.css",
  "src/renderer/styles/themes.css",
  "src/renderer/styles/layout.css",
  "src/renderer/styles/buttons.css",
  "src/renderer/styles/forms.css",
  "src/renderer/styles/custom-select.css",
  "src/renderer/styles/cards.css",
  "src/renderer/styles/specializations.css",
  "src/renderer/styles/skills.css",
  "src/renderer/styles/detail-panel.css",
  "src/renderer/styles/equipment.css",
  "src/renderer/styles/wiki-modal.css",
  "src/renderer/styles/detail-modal.css",
  "src/renderer/styles/skeleton.css",
  "src/renderer/styles/notes.css",
  "src/renderer/styles/confirm-modal.css",
  "src/renderer/styles/whats-new-modal.css",
  "src/renderer/styles/import-conflict-modal.css",
  "src/renderer/styles/share-modal.css",
  "src/renderer/styles/smart-folder-modal.css",
  "src/renderer/styles/team-modal.css",
  "src/renderer/styles/settings-modal.css",
  "src/renderer/styles/library.css",
  "src/renderer/styles/comps.css",
  "src/renderer/styles/build-sources.css",
  "src/renderer/styles/forge-render-bridge.css",
  "src/web/web.css",
  "src/web/web-mobile.css",
  "src/site/styles.css",
  "src/site/site-mobile.css",
  "packages/forge-render/src/forge-render.css",
];

// Not yet converted. Shrinks by one entry per conversion task; when this is
// empty the conversion is done. bridge.css is deliberately absent from
// APP_CSS: its whole job is to hold legacy names, and it is deleted in batch 5.
const PENDING = [
  // app.css does not exist until Task 3, which removes this line; base.css
  // and themes.css are deleted by the same task, which removes theirs.
  "src/renderer/styles/app.css",
  "src/renderer/styles/base.css",
  "src/renderer/styles/themes.css",
  "src/renderer/styles/cards.css",
  "src/renderer/styles/specializations.css",
  "src/renderer/styles/skills.css",
  "src/renderer/styles/detail-panel.css",
  "src/renderer/styles/equipment.css",
  "src/renderer/styles/wiki-modal.css",
  "src/renderer/styles/detail-modal.css",
  "src/renderer/styles/skeleton.css",
  "src/renderer/styles/notes.css",
  "src/renderer/styles/confirm-modal.css",
  "src/renderer/styles/whats-new-modal.css",
  "src/renderer/styles/import-conflict-modal.css",
  "src/renderer/styles/share-modal.css",
  "src/renderer/styles/smart-folder-modal.css",
  "src/renderer/styles/team-modal.css",
  "src/renderer/styles/settings-modal.css",
  "src/renderer/styles/library.css",
  "src/renderer/styles/comps.css",
  "src/renderer/styles/build-sources.css",
  "src/renderer/styles/forge-render-bridge.css",
  "src/web/web.css",
  "src/web/web-mobile.css",
  "src/site/styles.css",
  "src/site/site-mobile.css",
  "packages/forge-render/src/forge-render.css",
  // Batch 1 converts these; each task below removes its own line.
  "src/renderer/styles/layout.css",
  "src/renderer/styles/buttons.css",
  "src/renderer/styles/forms.css",
  "src/renderer/styles/custom-select.css",
];

const CONVERTED = APP_CSS.filter((f) => !PENDING.includes(f));

// --- the scanners ---------------------------------------------------------

// Properties that can legally carry a colour. A selector or at-rule prelude
// never starts with one of these, which is why a pseudo-class's colon is
// harmless (RULES.md, "Colour literal scan, precisely").
const COLOUR_PROP =
  /^(?:-webkit-)?(?:color|background|background-image|background-color|border-color|border-(?:top|right|bottom|left)-color|outline-color|box-shadow|text-shadow|filter|fill|stroke|caret-color|column-rule-color|text-decoration-color|accent-color|scrollbar-color)\s*:/;

// Hex and the colour functions have no other meaning in CSS. color-mix is
// included because `color-mix(in srgb, X 12%, transparent)` is rule 2's
// violation written a third way.
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/;

/** Every `prop: value` declaration in a sheet, comments stripped. */
function declarations(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/[;{}]/)
    .map((d) => d.trim())
    .filter((d) => d.includes(":"));
}

function findColourLiterals(css) {
  return declarations(css).filter((d) => COLOUR_PROP.test(d) && COLOUR_LITERAL.test(d));
}

function findRadiusLiterals(css) {
  return declarations(css).filter(
    (d) => /^border(?:-[a-z]+)*-radius\s*:/.test(d) && !/var\(--axi-radius/.test(d),
  );
}

/** A legal block is `<offset> <offset> 0 var(--axi-ink-line)` and nothing else. */
function findBadShadows(css) {
  return declarations(css).filter((d) => {
    if (!/^box-shadow\s*:/.test(d)) return false;
    const value = d.slice(d.indexOf(":") + 1).trim();
    if (value === "none") return false;
    // A length literal in a shadow is either an invented offset or a blur.
    if (/\d*\.?\d+(px|rem|em|%)/.test(value)) return true;
    return !value.includes("var(--axi-ink-line)");
  });
}

function findBlurs(css) {
  return declarations(css).filter(
    (d) =>
      /^backdrop-filter\s*:/.test(d) ||
      /^text-shadow\s*:/.test(d) ||
      /drop-shadow\s*\(/.test(d) ||
      (/^filter\s*:/.test(d) && /blur\s*\(/.test(d)),
  );
}

function findGradients(css) {
  return declarations(css).filter((d) => /gradient\s*\(/.test(d));
}

/** A border/outline width must come through a form token, never a literal. */
function findBorderLiterals(css) {
  return declarations(css).filter((d) => {
    if (!/^(?:border|outline)(?:-(?:top|right|bottom|left))?(?:-width)?\s*:/.test(d)) return false;
    const value = d.slice(d.indexOf(":") + 1).trim();
    if (value === "none" || value === "0") return false;
    if (/\bvar\(--axi-border-(?:panel|control|hairline)\)/.test(value)) return false;
    return /\d*\.?\d+(px|rem|em)|\b(?:thin|medium|thick)\b/.test(value);
  });
}

function findFontFamilies(css) {
  return declarations(css).filter(
    (d) => /^font-family\s*:/.test(d) && !/var\(--axi-(?:sans|mono)\)/.test(d),
  );
}

/** The legacy palette. Its presence means the file still leans on bridge.css. */
function findLegacyVars(css) {
  return declarations(css).filter((d) =>
    /var\(--(?:bg|bg-2|panel|panel-2|line|line-soft|text|text-light|text-dim|muted|accent|accent-2|accent-rgb|accent-2-rgb|gold|danger|danger-text|link|input-bg|input-border|surface|surface-hover|panel-gradient|hover-subtle|hover-accent|hover-accent-strong|focus-ring|radius|radius-sm|radius-xs|shadow-sm|shadow-md|shadow-lg|overlay|btn-primary-[a-z-]+)\b/.test(d),
  );
}

const SCANNERS = [
  ["colour literal", findColourLiterals],
  ["border-radius literal", findRadiusLiterals],
  ["illegal box-shadow", findBadShadows],
  ["blur", findBlurs],
  ["gradient", findGradients],
  ["border width literal", findBorderLiterals],
  ["non-token font-family", findFontFamilies],
  ["legacy palette variable", findLegacyVars],
];

// --- the gate ------------------------------------------------------------

describe("axi design language rules", () => {
  // Guarded: jest throws "`.each` called with an empty Array" rather than
  // registering zero blocks, and CONVERTED is empty until the first file
  // leaves PENDING.
  if (CONVERTED.length) {
    describe.each(CONVERTED)("%s", (file) => {
      const css = fs.readFileSync(path.join(ROOT, file), "utf8");

      it.each(SCANNERS)("has no %s", (_label, scan) => {
        expect(scan(css)).toEqual([]);
      });
    });
  }

  it("lists every app stylesheet, so a new file cannot dodge the gate", () => {
    const onDisk = [
      ...fs.readdirSync(path.join(ROOT, "src/renderer/styles"))
        .filter((f) => f.endsWith(".css") && f !== "bridge.css")
        .map((f) => `src/renderer/styles/${f}`),
    ];
    expect(APP_CSS).toEqual(expect.arrayContaining(onDisk));
  });

  it("names every pending file as one it knows about", () => {
    // A typo in PENDING would silently exempt nothing and scan a file that
    // does not exist, or silently exempt a file forever.
    expect(APP_CSS).toEqual(expect.arrayContaining(PENDING));
  });

  // The scanners are the load-bearing part of this suite, so they get their
  // own fixture: a file that violates every rule at once.
  describe("the scanners themselves", () => {
    const bad = fs.readFileSync(path.join(__dirname, "__fixtures__/violation.css"), "utf8");

    it.each(SCANNERS)("detects a planted %s", (_label, scan) => {
      expect(scan(bad).length).toBeGreaterThan(0);
    });

    it("does not flag a pseudo-class colon or a font stack in a string", () => {
      const clean = `
        .a:not(.gold) { color: var(--axi-text); }
        .b::after { content: "tan linen gold"; background: var(--axi-surface); }
        .c { font: var(--axi-t-label); letter-spacing: var(--axi-ls-label); }
        .d { border: var(--axi-border-control) solid var(--axi-ink-line);
             box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line); }
        .d:hover { transform: translate(-2px, -2px);
                   box-shadow: var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0 var(--axi-ink-line); }
        .e { border-radius: var(--axi-radius-sm); border: none; }
        /* The frameless window's inward block (Task 8). calc() and inset are
           legal here: no length literal, and the ink line is present. */
        .w { box-shadow: inset calc(-1 * var(--axi-offset-panel)) calc(-1 * var(--axi-offset-panel)) 0 0 var(--axi-ink-line); }
      `;
      for (const [, scan] of SCANNERS) expect(scan(clean)).toEqual([]);
    });
  });
});
