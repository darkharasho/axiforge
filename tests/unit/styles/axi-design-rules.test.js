"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// Every stylesheet the app owns. The package's own dist/ is exempt: tokens.css
// is the one file in the system allowed to hold a colour literal.
const APP_CSS = [
  // The @import manifest. It holds only @import lines today, which is exactly
  // why it has to be listed: it lives in src/renderer/ rather than
  // src/renderer/styles/, so nothing used to scan it and a rule added here
  // would have been invisible.
  "src/renderer/styles.css",
  "src/renderer/styles/app.css",
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

const CONVERTED = APP_CSS.filter((f) => !PENDING.includes(f));

// Renderer modules that build a stylesheet as a string and inject it. The
// rules apply to CSS, not to the file extension it arrives in: these two
// sheets are as live as any partial, and until this list existed nothing in
// the repo scanned them. They belong to the library screen (batch 2), so they
// are acknowledged here the way PENDING acknowledges a stylesheet — every
// OTHER renderer JS file is enforced from now on, so a new injected sheet
// cannot appear unscanned. Batch 2 must empty this list (converting the CSS in
// place or moving it into library.css) at the same time it drops library.css
// from PENDING.
const PENDING_JS = [
  "src/renderer/modules/library/history-panel.js",
  "src/renderer/modules/library/history-compare.js",
];

// --- the scanners ---------------------------------------------------------

// Properties that can legally carry a colour. A selector or at-rule prelude
// never starts with one of these, which is why a pseudo-class's colon is
// harmless (RULES.md, "Colour literal scan, precisely"). The shorthands
// (border, border-top, ..., outline) are included: `border: 1px solid #000`
// is exactly the shape a converted rule takes, and a literal colour hiding
// in the shorthand is just as much a violation as one in `border-color`.
const COLOUR_PROP =
  /^(?:-webkit-)?(?:color|background|background-image|background-color|border|border-top|border-right|border-bottom|border-left|border-color|border-(?:top|right|bottom|left)-color|outline|outline-color|box-shadow|text-shadow|filter|fill|stroke|caret-color|column-rule-color|text-decoration-color|accent-color|scrollbar-color)\s*:/;

// Hex and the colour functions have no other meaning in CSS. color-mix is
// included because `color-mix(in srgb, X 12%, transparent)` is rule 2's
// violation written a third way.
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/;

// The 148 CSS named colours, minus the two documented exemptions:
// `transparent` and `currentColor` are not themeable values, so tokenising
// them would add indirection without buying anything. `background: white`
// reads as harmless, which is exactly why it has to be caught here. This is
// the list the package carries in tests/tokens.test.mjs; the scan below is
// the same scan, so the two stay comparable.
const NAMED_COLOURS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow",
  "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple",
  "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen",
];

// A named colour only counts as a whole value token: bounded by neither a word
// character nor a hyphen on either side, so no identifier (`redraw`) and no
// custom-property segment (`--axi-gold-thing`) can trip it.
const NAMED_COLOUR = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join("|")})(?![\\w-])`, "i");

/** A value with every url(...) span and every quoted string replaced by a
    space. A bare named colour is ambiguous with an ordinary word, which is
    what makes a font stack, a `content` string, a texture filename or a
    cursor list a field of false positives for it — so it is only trusted in
    the plain value. Hex and the colour functions are unambiguous and stay
    caught everywhere, including inside a data-URI SVG (RULES.md, "Colour
    literal scan, precisely": the asymmetry is deliberate). */
function withoutOpaqueSpans(value) {
  return value
    .replace(/url\(\s*(['"]?)[\s\S]*?\1\s*\)/gi, " ")
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, " ");
}

/** True when the plain value carries a bare named CSS colour. Custom-property
    NAMES are stripped first so a token name is never read as a value. */
function hasNamedColour(value) {
  const bare = withoutOpaqueSpans(value).replace(/--[\w-]+/g, " ");
  return NAMED_COLOUR.test(bare);
}

/** The value with every var(...) expression removed, so what is left is
    whatever the author wrote outside a token. Handles nesting via a loop
    (e.g. `calc(var(--axi-radius-sm) + 40px)` still exposes the `+ 40px`). */
function withoutVars(value) {
  let out = value;
  let prev;
  do {
    prev = out;
    out = out.replace(/var\([^()]*\)/g, " ");
  } while (out !== prev);
  return out;
}

/** Every `prop: value` declaration in a sheet, comments stripped. A `;` or
    brace baked into a quoted string or a url(...) (e.g. a data-URI SVG) must
    not truncate the declaration early and hide whatever comes after it
    (RULES.md: a hex inside url(...) must still be caught) — so separators
    inside those spans are protected before the split and restored after. */
function declarations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const protectedCss = withoutComments.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\)/g,
    (span) => span.replace(/[;{}]/g, (ch) => `\u0000${ch.charCodeAt(0)}\u0000`),
  );
  return protectedCss
    .split(/[;{}]/)
    .map((d) => d.replace(/\u0000(\d+)\u0000/g, (_, code) => String.fromCharCode(Number(code))))
    .map((d) => d.trim())
    .map((d) => d.replace(/\s*!\s*important\s*$/i, ""))
    .filter((d) => d.includes(":"));
}

function findColourLiterals(css) {
  return declarations(css).filter((d) => {
    if (!COLOUR_PROP.test(d)) return false;
    if (COLOUR_LITERAL.test(d)) return true;
    return hasNamedColour(d.slice(d.indexOf(":") + 1));
  });
}

/** A custom property (`--foo: ...`) can hide any other violation behind
    indirection (`--my-color: #ff0000; color: var(--my-color);` is invisible
    to every property-name-based scanner). Only colour is checked here: a
    length is a legitimate custom-property value (e.g.
    `--af-titlebar-h: 42px`), so this must not fire on those. */
function findCustomPropertyColours(css) {
  return declarations(css).filter((d) => {
    if (!/^--[a-zA-Z0-9-]+\s*:/.test(d)) return false;
    // Only the VALUE is scanned, so the property's own name never reaches the
    // named-colour match: `--axi-gold-thing: 0` is a length, `--brand: white`
    // is a colour literal one indirection deep. hasNamedColour still strips
    // the `--name` of any token referenced *inside* the value, and still
    // blanks quoted strings and url() spans.
    const value = d.slice(d.indexOf(":") + 1).trim();
    return COLOUR_LITERAL.test(value) || hasNamedColour(value);
  });
}

function findRadiusLiterals(css) {
  return declarations(css).filter((d) => {
    if (!/^border(?:-[a-z]+)*-radius\s*:/.test(d)) return false;
    const value = d.slice(d.indexOf(":") + 1).trim();
    return /\d/.test(withoutVars(value));
  });
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
    const stripped = withoutVars(value);
    return /\d*\.?\d+(px|rem|em)|\b(?:thin|medium|thick)\b/.test(stripped);
  });
}

function findFontFamilies(css) {
  return declarations(css).filter((d) => {
    if (!/^font-family\s*:/.test(d)) return false;
    const value = d.slice(d.indexOf(":") + 1).trim();
    return /[^\s,]/.test(withoutVars(value));
  });
}

/** The legacy palette. Its presence means the file still leans on bridge.css. */
function findLegacyVars(css) {
  return declarations(css).filter((d) =>
    /var\(--(?:bg|bg-2|panel|panel-2|line|line-soft|text|text-light|text-dim|muted|accent|accent-2|accent-rgb|accent-2-rgb|gold|danger|danger-text|link|input-bg|input-border|surface|surface-hover|panel-gradient|hover-subtle|hover-accent|hover-accent-strong|focus-ring|radius|radius-sm|radius-xs|shadow-sm|shadow-md|shadow-lg|overlay|btn-primary-[a-z-]+)\b/.test(d),
  );
}

/** Every CSS block a JS module injects into the document.

    Two shapes exist in this codebase and both are covered: a literal
    `<style>...</style>` span inside a template literal (the HTML-string
    shape), and `document.createElement("style")` followed by an assignment to
    that element's textContent/innerHTML (the shape history-panel.js and
    history-compare.js actually use). `${...}` interpolations are blanked
    first, so a JS expression is never read as a declaration; the loop handles
    a nested brace. */
function injectedCssBlocks(js) {
  const blocks = [];

  for (const m of js.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) blocks.push(m[1]);

  const styleVars = new Set();
  for (const m of js.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*["'`]style["'`]\s*\)/g,
  )) {
    styleVars.add(m[1]);
  }
  for (const name of styleVars) {
    const assignment = new RegExp(
      `\\b${name}\\.(?:textContent|innerHTML|innerText)\\s*\\+?=\\s*\`([\\s\\S]*?)\``,
      "g",
    );
    for (const m of js.matchAll(assignment)) blocks.push(m[1]);
  }

  return blocks.map((block) => {
    let out = block;
    let prev;
    do {
      prev = out;
      out = out.replace(/\$\{[^{}]*\}/g, " ");
    } while (out !== prev);
    return out;
  });
}

/** Every `.css` file under a directory, recursively, so a file added in a new
    subdirectory (src/renderer/styles/modals/...) cannot dodge the gate.
    bridge.css is excluded by name: it exists to hold legacy names. */
function cssFilesUnder(root, dir = root) {
  const abs = path.join(ROOT, dir);
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") return [];
        return cssFilesUnder(root, `${dir}/${entry.name}`);
      }
      if (!entry.name.endsWith(".css") || entry.name === "bridge.css") return [];
      return [`${dir}/${entry.name}`];
    })
    .sort();
}

/** Every `.js` file under a directory, recursively. */
function jsFilesUnder(root, dir = root) {
  const abs = path.join(ROOT, dir);
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") return [];
        return jsFilesUnder(root, `${dir}/${entry.name}`);
      }
      if (!entry.name.endsWith(".js")) return [];
      return [`${dir}/${entry.name}`];
    })
    .sort();
}

const SCANNERS = [
  ["colour literal", findColourLiterals],
  ["custom property colour literal", findCustomPropertyColours],
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
    // Recursive and rooted one level up from styles/, so both blind spots are
    // closed: src/renderer/styles.css (the @import manifest) is reachable, and
    // so is a .css file dropped into a subdirectory that does not exist yet.
    const dirs = ["src/renderer", "src/web", "src/site", "packages/forge-render/src"];
    const onDisk = dirs.flatMap((dir) => cssFilesUnder(dir));
    expect(APP_CSS).toEqual(expect.arrayContaining(onDisk));
  });

  it("scans the @import manifest", () => {
    expect(CONVERTED).toContain("src/renderer/styles.css");
  });

  it("discovers a stylesheet in a subdirectory", () => {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "axi-gate-"));
    try {
      fs.mkdirSync(path.join(tmp, "modals", "deep"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "top.css"), "");
      fs.writeFileSync(path.join(tmp, "modals", "deep", "buried.css"), "");
      fs.writeFileSync(path.join(tmp, "modals", "bridge.css"), "");
      fs.writeFileSync(path.join(tmp, "modals", "notes.txt"), "");
      // cssFilesUnder resolves against ROOT, so hand it a ROOT-relative path.
      const rel = path.relative(ROOT, tmp);
      expect(cssFilesUnder(rel)).toEqual([`${rel}/modals/deep/buried.css`, `${rel}/top.css`]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  describe("CSS injected from JavaScript", () => {
    const rendererJs = jsFilesUnder("src/renderer");
    const enforced = rendererJs.filter((f) => !PENDING_JS.includes(f));

    it("finds the two known injected stylesheets", () => {
      // Proven, not assumed: the extraction has to actually reach these blocks
      // or the whole scan below is a no-op that reports success.
      for (const file of PENDING_JS) {
        const blocks = injectedCssBlocks(fs.readFileSync(path.join(ROOT, file), "utf8"));
        expect(blocks.length).toBeGreaterThan(0);
        expect(blocks.join("\n")).toMatch(/linear-gradient\(180deg/);
        expect(findGradients(blocks.join("\n")).length).toBeGreaterThan(0);
        expect(findColourLiterals(blocks.join("\n")).length).toBeGreaterThan(0);
      }
    });

    it("names every pending JS file as one that exists and injects CSS", () => {
      for (const file of PENDING_JS) {
        expect(rendererJs).toContain(file);
      }
    });

    it.each(SCANNERS)("has no %s in any enforced renderer module", (_label, scan) => {
      const offenders = [];
      for (const file of enforced) {
        const blocks = injectedCssBlocks(fs.readFileSync(path.join(ROOT, file), "utf8"));
        if (!blocks.length) continue;
        for (const hit of scan(blocks.join("\n"))) offenders.push(`${file}: ${hit}`);
      }
      expect(offenders).toEqual([]);
    });

    it("extracts a <style> block out of an HTML template literal", () => {
      const js = 'el.innerHTML = `<div><style>.x { color: red; }</style></div>`;';
      expect(injectedCssBlocks(js)).toEqual([".x { color: red; }"]);
      expect(findColourLiterals(injectedCssBlocks(js).join("\n"))).not.toEqual([]);
    });

    it("extracts a createElement('style') textContent assignment", () => {
      const js = [
        'const style = document.createElement("style");',
        "style.textContent = `.y { background: linear-gradient(180deg, #fff, #000); }`;",
      ].join("\n");
      expect(findGradients(injectedCssBlocks(js).join("\n"))).not.toEqual([]);
    });

    it("blanks an interpolation rather than reading it as CSS", () => {
      const js = [
        'const style = document.createElement("style");',
        "style.textContent = `.z { width: ${size}px; color: var(--axi-text); }`;",
      ].join("\n");
      const css = injectedCssBlocks(js).join("\n");
      expect(css).not.toContain("size");
      for (const [, scan] of SCANNERS) expect(scan(css)).toEqual([]);
    });
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

    it("strips a trailing !important before any scanner sees the value", () => {
      // box-shadow: none !important is a reset, not an illegal shadow.
      expect(findBadShadows('.v16 { box-shadow: none !important; }')).toEqual([]);
      // box-shadow: <literal> !important is still a real violation.
      expect(
        findBadShadows('.v18 { box-shadow: 0 2px 8px #000 !important; }'),
      ).not.toEqual([]);
      // border: none !important is a reset, not an illegal border width.
      expect(findBorderLiterals('.v17 { border: none !important; }')).toEqual([]);
      // a genuine violation with !important still fires for another scanner
      // (colour literal).
      expect(
        findColourLiterals('.v19 { color: #ff0000 !important; }'),
      ).not.toEqual([]);
    });

    it("detects a bare named colour in the plain value", () => {
      expect(findColourLiterals(".a { color: red; }")).not.toEqual([]);
      expect(findColourLiterals(".a { background: tomato; }")).not.toEqual([]);
      expect(findColourLiterals(".a { accent-color: red; }")).not.toEqual([]);
      expect(findColourLiterals(".a { text-decoration-color: red; }")).not.toEqual([]);
      expect(findColourLiterals(".a { background: WHITE; }")).not.toEqual([]);
      expect(findColourLiterals(".a { border: var(--axi-border-control) solid black; }")).not.toEqual([]);
      // Behind a var() fallback is still a hand-written colour.
      expect(findColourLiterals(".a { color: var(--nope, white); }")).not.toEqual([]);
    });

    it("does not flag a word that only looks like a named colour", () => {
      // One guard per line, so a regression names which guard broke.
      const clean = [
        ".a { background: none; }",
        ".a { color: inherit; }",
        ".a { color: initial; }",
        ".a { color: unset; }",
        ".a { background: transparent; }",
        ".a { border-color: currentColor; }",
        ".a { border-color: currentcolor; }",
        ".a { color: var(--axi-gold-thing); }",       // colour word in a token NAME
        ".a { background: var(--axi-surface-silver); }",
        '.a { font-family: "Times", Georgia, serif; }', // not a colour property at all
        '.b::after { content: "tan linen gold"; background: var(--axi-surface); }',
        ".c { animation-name: redraw; }",
        ".d { background-image: url(/img/linen.png); }",
        '.e { background-image: url("./textures/tan.png"); }',
        ".f { background: url(gold.svg) no-repeat; }",
        ".g { filter: url(#duotone); }",
        ".h { font: var(--axi-t-body); }",
        ".i { border: var(--axi-border-control) solid var(--axi-ink-line); }",
        ".j { color: var(--axi-text); background: var(--axi-surface-raised); }",
      ];
      for (const css of clean) expect(findColourLiterals(css)).toEqual([]);
    });

    it("detects a bare named colour hidden behind a custom property", () => {
      expect(findCustomPropertyColours(":root { --x: white; }")).not.toEqual([]);
      expect(findCustomPropertyColours(":root { --x: RED; }")).not.toEqual([]);
      // In a shorthand value, alongside legal parts.
      expect(
        findCustomPropertyColours(":root { --edge: var(--axi-border-control) solid tomato; }"),
      ).not.toEqual([]);
    });

    it("does not flag a custom property whose value is not a colour", () => {
      const clean = [
        ":root { --axi-gold-thing: 0; }",       // colour word in the NAME only
        ":root { --af-titlebar-h: 42px; }",
        ":root { --x: none; }",
        ":root { --x: transparent; }",
        ":root { --x: currentColor; }",
        ":root { --x: var(--axi-accent); }",
        ':root { --x: "Times"; }',
        ':root { --x: url("./textures/tan.png"); }',
      ];
      for (const css of clean) expect(findCustomPropertyColours(css)).toEqual([]);
    });

    it("does not flag a pseudo-class colon or a font stack in a string", () => {
      const clean = `
        .a:not(.gold) { color: var(--axi-text); }
        .b::after { content: "tan linen gold"; background: var(--axi-surface); }
        .c { font: var(--axi-t-label); letter-spacing: var(--axi-ls-label); }
        .c2 { font-family: var(--axi-sans); }
        .d { border: var(--axi-border-control) solid var(--axi-ink-line);
             box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line); }
        .d:hover { transform: translate(-2px, -2px);
                   box-shadow: var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0 var(--axi-ink-line); }
        .e { border-radius: var(--axi-radius-sm); border: none; }
        .f { border-width: 0; }
        :root { --af-titlebar-h: 42px; }
        /* The frameless window's inward block (Task 8). calc() and inset are
           legal here: no length literal, and the ink line is present. */
        .w { box-shadow: inset calc(-1 * var(--axi-offset-panel)) calc(-1 * var(--axi-offset-panel)) 0 0 var(--axi-ink-line); }
      `;
      for (const [, scan] of SCANNERS) expect(scan(clean)).toEqual([]);
    });
  });
});
