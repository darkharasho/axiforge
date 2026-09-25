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
  "src/renderer/styles/forge-render-bridge.css",
  "src/web/web.css",
  "src/web/web-mobile.css",
  "src/site/styles.css",
  "src/site/site-mobile.css",
  "packages/forge-render/src/forge-render.css",
];

const CONVERTED = APP_CSS.filter((f) => !PENDING.includes(f));

const PENDING_JS = [];

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

// Genuine exemptions to the static-opacity scanner below: an element that is
// itself a representation of a thing being dragged, not a colour resting at
// partial strength over the ground (RULES.md rule 2). Every entry is a
// selector exactly as it appears as its own rule block (or as one member of a
// comma-separated selector list), so a compound or grouped selector needs one
// entry per piece that carries the opacity.
// Fix round 1, F4: verified against the vendored SortableJS source
// (node_modules/sortablejs/modular/sortable.esm.js) which class lands on a
// clone versus the live element still in the list. ghostClass and
// chosenClass land on the live element (sortable.esm.js:1416, :1302); with
// forceFallback: true (this app's setting), fallbackClass and dragClass both
// land on ghostEl, the floating clone (:1536-1537). A "ghost" class landing
// on a live element is not a representation of a thing being moved — it IS
// the thing, resting at a partial colour — so only the genuine clones stay
// allowlisted here; the comp-slot-ghost/comp-line-ghost/lib-drag-ghost/
// lib-drag-chosen cases were fixed instead (see comps.css and library.css).
const OPACITY_ALLOWLIST = [
  // comps.css — comp-drag-drop.js:46,96 set both of these as SortableJS's
  // fallbackClass, which lands on the floating body-level clone, not the
  // source card still in its list.
  [".comp-cat-drag-ghost", "SortableJS fallbackClass (comp-drag-drop.js:96) — lands on the floating clone, not the source chip; a representation of the thing being moved, not a colour at rest."],
  [".comp-drag-icon-ghost", "SortableJS fallbackClass (comp-drag-drop.js:46) — lands on the floating clone, not the source card; same reasoning as .comp-cat-drag-ghost."],
  // library.css — library/drag-drop.js:401-407 sets forceFallback: true, so
  // dragClass and fallbackClass both land on the floating clone SortableJS
  // appends to <body> (sortable.esm.js:1536-1537), not on the row still in
  // the list.
  [".lib-drag-active", "SortableJS dragClass under forceFallback: true (library/drag-drop.js:403,406) — lands on the floating clone (sortable.esm.js:1536-1537), not the source row; a representation of the thing being moved, not a colour at rest."],
  [".lib-drag-fallback", "SortableJS fallbackClass under forceFallback: true (library/drag-drop.js:407) — the floating clone itself; same reasoning as .lib-drag-active."],
];

/** True when `header` — a rule's selector text, exactly as written between
    the previous `}`/`{`/`;` and its own `{` — is, or contains as one
    comma-separated member, an allowlisted selector. Internal whitespace
    (including the newlines a wrapped multi-selector list carries) is
    collapsed first so formatting differences never defeat the match. */
function isOpacityAllowlisted(header) {
  const pieces = header.split(",").map((p) => p.trim().replace(/\s+/g, " "));
  return OPACITY_ALLOWLIST.some(([selector]) => pieces.includes(selector));
}

/** Every rule block in a sheet — comments stripped — as `{ header, body,
    inKeyframes }`, where `body` is the block's own text with any nested
    blocks removed (each nested block becomes its own entry). This exists
    because `declarations()` deliberately discards which rule a declaration
    came from, and the opacity scanner below needs that context: whether a
    block sits inside `@keyframes` (motion, permitted outright by RULES.md
    line 308) and whether the block declares `animation` are both
    block-level questions a flat declaration list cannot answer. */
/** If `css[i]` opens a quoted string or a `url(...)` span, returns the index
    just past its end; otherwise -1. Shared by both scans in `ruleBlocks`
    below so a `{` or `}` inside `content: "{"` or a data-URI `url(...)`
    is never read as a structural brace (fix round 1, F7 —
    `findStaticOpacity('.a { content: "}"; opacity: 0.5; }')` used to
    return `[]`, swallowing the declaration whole). */
function skipSpan(css, i) {
  const ch = css[i];
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < css.length) {
      if (css[j] === "\\") { j += 2; continue; }
      if (css[j] === ch) return j + 1;
      j++;
    }
    return css.length;
  }
  if (/^url\(/i.test(css.slice(i, i + 4))) {
    let j = i + 4;
    while (j < css.length && css[j] !== ")") {
      const inner = skipSpan(css, j);
      if (inner !== -1) { j = inner; continue; }
      j++;
    }
    return j + 1;
  }
  return -1;
}

/** True when `str` contains a `{` outside any string/`url(...)` span — the
    string-aware replacement for a naive `str.includes("{")`, which
    misreads `content: "{"` as introducing a nested block and, worse, then
    recurses into a body with no *real* opening brace at all, silently
    discarding it (fix round 1, F7: this was the second half of the same
    bug `skipSpan` alone did not cover). */
function hasStructuralBrace(str) {
  let i = 0;
  while (i < str.length) {
    const skip = skipSpan(str, i);
    if (skip !== -1) { i = skip; continue; }
    if (str[i] === "{") return true;
    i++;
  }
  return false;
}

function ruleBlocks(css, inKeyframes = false) {
  const blocks = [];
  let i = 0;
  while (i < css.length) {
    let j = i;
    while (j < css.length) {
      const skip = skipSpan(css, j);
      if (skip !== -1) { j = skip; continue; }
      if (css[j] === "{") break;
      j++;
    }
    if (j >= css.length) break;
    const header = css.slice(i, j).trim();
    let depth = 1;
    let k = j + 1;
    while (k < css.length && depth > 0) {
      const skip = skipSpan(css, k);
      if (skip !== -1) { k = skip; continue; }
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      k++;
    }
    const body = css.slice(j + 1, k - 1);
    const thisInKeyframes = inKeyframes || /^@keyframes\b/i.test(header);
    if (hasStructuralBrace(body)) {
      blocks.push(...ruleBlocks(body, thisInKeyframes));
    } else {
      blocks.push({ header, body, inKeyframes: thisInKeyframes });
    }
    i = k;
  }
  return blocks;
}

/** Rule 2 applied to opacity specifically: a colour is either present at full
    strength or absent, never resting in between. `opacity: 0` and
    `opacity: 1` are the two legitimate endpoints (absence and full strength),
    so a show/hide pair built from exactly those two values passes without
    needing a special case. A block inside `@keyframes`, or a block that
    declares `animation` itself, is motion rather than a resting value
    (RULES.md line 308 permits animating opacity outright) — `transition` is
    deliberately NOT exempting: it describes how a property moves between
    values, not whether the value it rests on is legitimate, and exempting it
    would launder any rule-2 violation by adding one line. */
/** Parses a CSS `<alpha-value>` (an `opacity`/`filter-function` argument):
    a bare number (`0.3`) or a percentage (`50%`, fix round 1 F5 — `opacity:
    50%` is valid CSS and `parseFloat("50%") === 50`, which used to read as
    "well above 1" and never fire). Returns NaN for anything else. */
function parseAlphaValue(raw) {
  const trimmed = raw.trim();
  const num = parseFloat(trimmed);
  if (Number.isNaN(num)) return NaN;
  return trimmed.endsWith("%") ? num / 100 : num;
}

/** True when `name` (a `@keyframes` name referenced from an `animation`
    shorthand) names a `@keyframes` block, anywhere in `css`, whose own body
    declares `opacity` or a dimming `filter` function (`opacity()` /
    `brightness()`). Fix round 1, F7 tightens the original brief's "exempt
    any block that declares animation" — too wide, since
    `.spin { animation: spin 1s linear infinite; opacity: 0.6 }` would pass
    even though `spin`'s keyframes touch only `transform`, the same
    laundering the round-1 `transition` exemption was removed over. Motion
    is only a legitimate excuse for a property the referenced keyframes
    actually animates. */
function keyframesAnimatesDimming(css, name) {
  const re = new RegExp(`@keyframes\\s+${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*\\{`, "i");
  const m = re.exec(css);
  if (!m) return false;
  let depth = 1;
  let k = m.index + m[0].length;
  while (k < css.length && depth > 0) {
    const skip = skipSpan(css, k);
    if (skip !== -1) { k = skip; continue; }
    if (css[k] === "{") depth++;
    else if (css[k] === "}") depth--;
    k++;
  }
  const body = css.slice(m.index + m[0].length, k - 1);
  // Fix round 2, G3: `\b` matches between the `-` and the `f` of
  // `backdrop-filter`, so a keyframes block that only animates
  // `backdrop-filter: brightness(...)` would wrongly read as animating
  // `filter`'s dimming functions and exempt an unrelated resting opacity
  // elsewhere. `(?<![\w-])` requires the property name not be preceded by a
  // word character or a hyphen, so `backdrop-filter:` is rejected while a
  // leading-whitespace `filter:` still matches.
  return /(?<![\w-])opacity\s*:/.test(body) || /(?<![\w-])filter\s*:\s*[^;]*\b(?:opacity|brightness)\(/i.test(body);
}

/** True when a block's own `animation` shorthand names a `@keyframes` block
    that itself animates opacity (directly, or through a dimming `filter`
    function) — see `keyframesAnimatesDimming` above. */
function exemptByAnimation(css, body) {
  const m = /(?:^|[;{\s])animation\s*:\s*([^;]+)/.exec(body);
  if (!m) return false;
  const value = m[1];
  for (const nameMatch of value.matchAll(/[A-Za-z_-][\w-]*/g)) {
    if (keyframesAnimatesDimming(css, nameMatch[0])) return true;
  }
  return false;
}

/** `filter` functions that fade a colour toward the ground the same way
    `opacity` does — fix round 1, F5. `opacity()` and `brightness()` below
    full strength are the identical rendering `opacity` produces (or, for
    brightness, the same laundering one step removed) and would otherwise
    let this exact commit's own `filter: grayscale(1)` precedent get copied
    as `filter: brightness(0.4)` with the gate staying silent.
    `grayscale()` is deliberately left alone: it rests at full strength and
    asserts no hue, which is the letter of rule 2, and no ramp token can
    reach inside a bitmap `<img>` the way it can a text colour. */
function findDimmingFilters(value) {
  const hits = [];
  for (const m of value.matchAll(/\b(opacity|brightness)\(\s*([^)]+)\)/gi)) {
    const alpha = parseAlphaValue(m[2]);
    if (!Number.isNaN(alpha) && alpha < 1) hits.push(`${m[1].toLowerCase()}(${m[2].trim()})`);
  }
  return hits;
}

function findStaticOpacity(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const violations = [];
  for (const { header, body, inKeyframes } of ruleBlocks(withoutComments)) {
    if (inKeyframes) continue;
    if (isOpacityAllowlisted(header)) continue;
    if (exemptByAnimation(withoutComments, body)) continue;
    // Fix round 2, G3: same anchoring hole as the filter scan below —
    // unanchored, this would match inside `fill-opacity:`/`stroke-opacity:`
    // and report it under the wrong property name if either ever appears in
    // a scanned sheet. Neither is scanned deliberately: if one needs to be,
    // it gets added as its own matched property in a later task.
    for (const m of body.matchAll(/(?<![\w-])opacity\s*:\s*([^;]+)/gi)) {
      const raw = m[1].trim().replace(/\s*!\s*important\s*$/i, "");
      const value = parseAlphaValue(raw);
      if (Number.isNaN(value)) continue;
      if (value > 0 && value < 1) violations.push(`${header} { opacity: ${raw} }`);
    }
    // Fix round 2, G3: unanchored, this also matched inside
    // `backdrop-filter:` — harmless today only because `findBlurs` already
    // flags every `backdrop-filter` declaration regardless of function, so
    // this scanner has no coverage to lose by excluding it, and a future
    // `backdrop-filter: brightness(.4)` would otherwise report as
    // `{ filter: brightness(.4) }`, naming the wrong property.
    for (const m of body.matchAll(/(?<![\w-])filter\s*:\s*([^;]+)/gi)) {
      const raw = m[1].trim().replace(/\s*!\s*important\s*$/i, "");
      for (const hit of findDimmingFilters(raw)) violations.push(`${header} { filter: ${hit} }`);
    }
  }
  return violations;
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

/** Every class name a JS module writes into markup: `class="..."` inside a
    template literal, `classList.add/remove/toggle(...)`, and
    `className = "..."`/`className += "..."`. `classList.contains(...)` is
    deliberately not matched (fix round 1, F14): it is a query, and reading
    it as markup only inflates the allowlist with classes nothing actually
    writes. `${...}` interpolations are
    blanked first (same loop `injectedCssBlocks` uses above), so a ternary
    that embeds its own quoted strings — e.g.
    `class="… ${covered ? "" : "party-cov__pill--uncovered"}"` — cannot
    truncate the attribute early, and a name assembled at runtime
    (`lib-toast--${type}`) is left as a harmless, incomplete fragment rather
    than read as a real class. Any token still ending in `-` after blanking
    is exactly that kind of fragment and is dropped: no real class name in
    this codebase ends in a bare hyphen. */
function emittedClasses(js) {
  let blanked = js;
  let prev;
  do {
    prev = blanked;
    blanked = blanked.replace(/\$\{[^{}]*\}/g, " ");
  } while (blanked !== prev);

  const names = new Set();
  const isRealName = (s) => /^[A-Za-z_-][\w-]*$/.test(s) && !s.endsWith("-");

  for (const m of blanked.matchAll(/\bclass(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)) {
    for (const piece of m[1].split(/\s+/)) if (isRealName(piece)) names.add(piece);
  }
  for (const m of blanked.matchAll(/\bclassList\.(?:add|remove|toggle)\(\s*([^)]*)\)/g)) {
    for (const argm of m[1].matchAll(/["'`]([\w-]+)["'`]/g)) if (isRealName(argm[1])) names.add(argm[1]);
  }
  return names;
}

// A deliberately narrow scope, corrected in fix round 1 (F12) after a review
// found the prior comment overclaiming: these four prefixes cover 433 of the
// roughly 1232 class names emitted from src/renderer, not "the app's own
// components" as a whole. Several app-owned, already-CONVERTED families are
// knowingly excluded — layout.css's `titlebar__*` and `subnav__*`,
// custom-select.css's `cselect*`, build-sources.css's `src-chip*`, and
// cards.css's `editor-share-dropdown__*` and `build-code-group__*` — plus
// everything the package's own `.axi-*` vocabulary, third-party library
// hooks, and unprefixed structural utility classes bring in. The four
// prefixes here are what keeps EMITTED_CLASS_ALLOWLIST below short enough to
// read; widening it is future work, not a one-line change — a plain prefix
// widen would surface `skel-d`, the fragment `` `skel-d${d}` `` leaves after
// blanking (skeleton.js), and the "nothing ends in a bare hyphen" heuristic
// `emittedClasses` relies on does not catch a fragment that doesn't end in a
// hyphen. That needs a companion heuristic, which is not this round's work.
const EMITTED_CLASS_PREFIX = /^(?:af-|lib-|comp-|party-cov__)/;

// Classes deliberately not backed by a CSS selector. Each is either a JS-only
// hook laid down alongside a class the package (or a sibling app class)
// already styles, a state-tracking class whose "off" value needs no rule of
// its own, or a plain text child that inherits its type/colour from an
// ancestor. Discovered by running the scanner unfiltered and reading every
// result (2026-09-24, commit 94c58e17): the four real defects it found
// (Task 5's deleted .lib-grid-card family) are fixed below instead of
// allowlisted.
const EMITTED_CLASS_ALLOWLIST = [
  ["af-accent-card__label", "Plain text child of .af-accent-card; inherits that ancestor's color/font (app.css), no rule of its own needed."],
  ["af-libpicker", "JS-only companion class on the package's own .axi-picker; carries no styling of its own."],
  ["comp-badge--draft", "JS-only modifier alongside .axi-chip/.comp-badge, which carry the fill; the state itself needs no separate rule."],
  ["comp-badge--published", "Same as comp-badge--draft — the .axi-chip--ok pairing carries the colour."],
  ["comp-badge--pve", "Same as comp-badge--draft — a JS/data hook, not a paint instruction."],
  ["comp-badge--wvw", "Same as comp-badge--draft — the .axi-chip--meta pairing carries the colour."],
  ["comp-boon-cov__title", "Plain text child of .comp-boon-cov__header; inherits its ancestor's typography."],
  ["comp-cat-chip__name", "Plain text child of .comp-cat-chip; inherits its ancestor's typography."],
  ["comp-list-toolbar__filters-btn", "JS-only hook alongside .axi-pill, which carries the control's paint."],
  ["comp-list-toolbar__view-btn", "Same as comp-list-toolbar__filters-btn."],
  ["comp-picker-modal__btn--cancel", "JS-only modifier alongside .axi-btn/--ghost, which carries the paint."],
  ["comp-picker-row__badge--comps", "JS-only modifier alongside .axi-chip, which carries the paint."],
  ["comp-picker-row__badge--shared", "JS-only modifier alongside .axi-chip/--meta, which carries the paint."],
  ["comp-cat-name-input", "Base class carrying only its --error modifier's styling (comps.css); the input itself is paired with .comp-picker-modal__search/.axi-input for paint and this is a querySelector hook. (Fix round 1, F6.)"],
  ["comp-picker-row__prof", "Plain text child of .comp-picker-row; inherits its ancestor's typography."],
  ["comp-tag-chip", "JS-only hook alongside .axi-pill, which carries the control's paint."],
  ["lib-banner--info", "JS-only modifier alongside .lib-banner, which carries the paint; only one banner kind exists today."],
  ["lib-col__item--folder", "JS/query hook alongside .lib-col__item, which carries the paint; used to re-select folder rows."],
  ["lib-ctx-item--submenu", "JS-only hook alongside .lib-ctx-item; the submenu behaviour is script, not paint."],
  ["lib-fd", "JS-only companion class on the package's own .axi-picker (filter dropdown); carries no styling of its own."],
  ["lib-fd__icon--prof", "JS-only modifier alongside .lib-fd__icon; distinguishes profession vs spec icons for script, not paint."],
  ["lib-fd__trigger--active", "JS state class toggled on .lib-fd__trigger when a filter is set; no dedicated rule, the trigger's own states carry it."],
  ["lib-icon-item--build", "JS/query hook alongside .lib-icon-item, which carries the paint."],
  ["lib-icon-item--folder", "JS/query hook alongside .lib-icon-item, which carries the paint."],
  ["lib-list-row--build", "JS/query hook alongside .lib-list-row, which carries the paint."],
  ["lib-list-row__icon", "Base class carrying only its --folder modifier's styling (library.css); no independent rule of its own. (Fix round 1, F6.)"],
  ["lib-sidebar--open", "The sidebar's default (non-collapsed) state; every rule is keyed off .lib-sidebar--collapsed instead, so --open needs none of its own."],
  // lib-table__folder-icon is NOT here (fix round 1, F11): it IS styled
  // (library.css:867-874) and emitted live from the real lib-tv tree view
  // (library/content.js:419) — it would never have reported as an orphan,
  // and the entry's "dead code" reason was wrong (it isn't the same
  // isTable branch as the six entries below).
  ["lib-table__row", "Dead code: the isTable branch of insertInlineInput() (library/sidebar.js) only runs against a <table> element, and no current view renders one."],
  ["lib-table__row--folder", "Same dead-code path as lib-table__row."],
  ["lib-table__td", "Same dead-code path as lib-table__row."],
  ["lib-table__td--icon", "Same dead-code path as lib-table__row."],
  ["lib-table__td--name", "Same dead-code path as lib-table__row."],
  ["lib-table__td--pin", "Same dead-code path as lib-table__row."],
  ["lib-toast__msg", "Plain text child of .lib-toast; inherits its ancestor's typography/colour."],
  ["lib-toolbar__search", "Base class paired with the package's .axi-search for paint; the only independent rule is on the sibling -input class. (Fix round 1, F6.)"],
  ["lib-tv__row--build", "JS/query hook alongside .lib-tv__row, which carries the paint."],
];

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
  ["static partial opacity", findStaticOpacity],
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

    it("still finds blocks in the app's real injected stylesheets", () => {
      // The synthetic cases above could pass against an extractor that only
      // handles the shapes they were written for, and the scan loop skips any
      // file it finds no blocks in -- so a broken extractor reports success
      // over an unscanned repo. These are the real files, named directly
      // rather than through PENDING_JS, which is empty from this task on.
      for (const file of ["src/renderer/modules/library/history-panel.js",
                          "src/renderer/modules/library/history-compare.js"]) {
        expect(injectedCssBlocks(fs.readFileSync(path.join(ROOT, file), "utf8")).length)
          .toBeGreaterThan(0);
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

  describe("classes emitted from JavaScript have a selector", () => {
    // The app's own stylesheets, comments stripped so a class name mentioned
    // in prose (e.g. the deletion note at build-sources.css:79-80, which
    // names .lib-grid-card__header only to say it no longer exists) cannot
    // read as the selector that backs it. Every APP_CSS file is included,
    // not just CONVERTED: a class can legitimately be styled from a PENDING
    // file, and this scanner is about whether a selector exists anywhere,
    // not about rule-2/3-style compliance.
    const appCssBundle = APP_CSS.map((f) =>
      fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
    ).join("\n");
    const packageCssBundle = fs
      .readFileSync(path.join(ROOT, "node_modules/@axiapps/axi-design/dist/axi.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const cssBundle = `${appCssBundle}\n${packageCssBundle}`;

    function hasSelector(className) {
      const esc = className.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      // Fix round 1, F6: `\b` treats `-` as a non-word character, so it is a
      // boundary — `.lib-drag\b` matches inside `.lib-drag-ghost`, meaning a
      // hyphen-suffixed relative of a real selector could certify a class
      // that has no rule of its own (hasSelector("lib-drag") used to return
      // true). `(?![\w-])` requires the match not be followed by another
      // word character OR hyphen, so only an exact class boundary passes.
      // `__` stays safe either way, since `_` is a word character.
      return new RegExp(`\\.${esc}(?![\\w-])`).test(cssBundle);
    }

    it("finds a selector for every emitted class in the app's own components", () => {
      const emitted = new Set();
      for (const file of jsFilesUnder("src/renderer")) {
        for (const cls of emittedClasses(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
          if (EMITTED_CLASS_PREFIX.test(cls)) emitted.add(cls);
        }
      }
      const allowlisted = new Set(EMITTED_CLASS_ALLOWLIST.map(([cls]) => cls));
      const orphans = [...emitted]
        .filter((cls) => !allowlisted.has(cls) && !hasSelector(cls))
        .sort();
      expect(orphans).toEqual([]);
    });

    it("names every allowlisted class as one a real emitter still writes", () => {
      // An allowlist entry for a class nothing emits anymore is dead
      // weight — worse, it is a class that could quietly rot as its own
      // undetected orphan since nothing checks it once it is excused here.
      const emitted = new Set();
      for (const file of jsFilesUnder("src/renderer")) {
        for (const cls of emittedClasses(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
          emitted.add(cls);
        }
      }
      const stale = EMITTED_CLASS_ALLOWLIST.map(([cls]) => cls).filter((cls) => !emitted.has(cls));
      expect(stale).toEqual([]);
    });

    it("extracts a class from a class=\"...\" attribute, including one whose interpolation embeds its own quotes", () => {
      const js = 'return `<div class="foo ${covered ? "" : "bar--baz"}">`;';
      const classes = emittedClasses(js);
      expect(classes.has("foo")).toBe(true);
      // The interpolated piece is unresolvable statically and is dropped
      // rather than misread as "bar--baz" unconditionally or as garbage.
      expect(classes.has("bar--baz")).toBe(false);
    });

    it("extracts classList.add/remove/toggle arguments and drops a classList query (fix round 1, F14)", () => {
      const js = [
        'el.classList.add("comp-foo", "comp-bar");',
        'el.classList.remove("comp-baz");',
        'el.classList.toggle("comp-qux", isOn);',
        'if (el.classList.contains("comp-quux")) {}',
      ].join("\n");
      const classes = emittedClasses(js);
      for (const cls of ["comp-foo", "comp-bar", "comp-baz", "comp-qux"]) {
        expect(classes.has(cls)).toBe(true);
      }
      // A query proves nothing about markup — collecting it would inflate
      // the allowlist with classes nothing actually writes.
      expect(classes.has("comp-quux")).toBe(false);
    });

    it("drops an incomplete fragment left by an unresolved interpolation", () => {
      // `lib-toast--${type}` blanks to the fragment "lib-toast--", which is
      // not a real class name (nothing in this codebase ends in a bare `-`)
      // and would otherwise report as a false orphan.
      const js = 'el.className = `lib-toast lib-toast--${type}`;';
      const classes = emittedClasses(js);
      expect(classes.has("lib-toast")).toBe(true);
      expect([...classes].some((c) => c.endsWith("-"))).toBe(false);
    });

    it("finds a selector for a real, styled class and not for an invented one", () => {
      expect(hasSelector("comp-list-row")).toBe(true);
      expect(hasSelector("comp-does-not-exist-anywhere")).toBe(false);
    });

    it("does not certify a class from a hyphen-suffixed relative's selector (fix round 1, F6)", () => {
      // `.lib-drag-ghost` (a real selector, library.css) must not certify
      // the unrelated class "lib-drag": `\b` treats `-` as a boundary, so
      // `\.lib-drag\b` used to match inside `.lib-drag-ghost` and return
      // true for a class with no rule of its own.
      expect(cssBundle).toMatch(/\.lib-drag-ghost\b/);
      expect(hasSelector("lib-drag")).toBe(false);
      // `__` stays safe either way, since `_` is a word character — this is
      // why the `.lib-grid-card` family was caught in the original commit.
      expect(hasSelector("comp-list-row")).toBe(true);
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

    it("detects a resting partial opacity", () => {
      expect(findStaticOpacity(".a { opacity: 0.3; }")).not.toEqual([]);
    });

    it("does not flag a partial opacity whose own block declares a transition", () => {
      // A transition says how a value moves, not whether the value it rests
      // on is legitimate — the round-1 brief's own worked example
      // (.comp-list-row__checkbox) made this point; the checkbox itself was
      // fixed a different way in fix round 1 (F1), but the scanner rule
      // still has to hold for any other transition-paired resting value.
      expect(
        findStaticOpacity(".a { opacity: 0.3; transition: opacity 0.15s; }"),
      ).not.toEqual([]);
    });

    it("exempts an animation only when the keyframes it names actually animates opacity", () => {
      // Fix round 1, F7: the original brief's exemption ("declares
      // animation") was too wide — a block referencing a keyframes that
      // never touches opacity would still have passed. .fade's keyframes
      // move opacity, so it is motion; .spin's keyframes move only
      // transform, so its own resting 0.6 is still a violation.
      expect(
        findStaticOpacity(
          "@keyframes fade { from { opacity: 0; } to { opacity: 1; } } .a { opacity: 0.3; animation: fade 0.2s ease; }",
        ),
      ).toEqual([]);
      expect(
        findStaticOpacity(
          "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; opacity: 0.6; }",
        ),
      ).not.toEqual([]);
    });

    it("does not change any current CONVERTED-file result now that the animation exemption is tightened", () => {
      // No block in the tree pairs `animation:` with its own `opacity:`
      // declaration (verified separately with
      // `awk 'BEGIN{RS="}"} /animation:/ && /opacity:/' <file>` over every
      // CONVERTED file, printing nothing) — this just pins that the tighter
      // exemption still reports zero violations across the real files.
      for (const file of CONVERTED) {
        const css = fs.readFileSync(path.join(ROOT, file), "utf8");
        expect(findStaticOpacity(css)).toEqual([]);
      }
    });

    it("does not flag a partial opacity inside @keyframes", () => {
      expect(
        findStaticOpacity("@keyframes fade-in { from { opacity: 0; } 50% { opacity: 0.3; } to { opacity: 1; } }"),
      ).toEqual([]);
    });

    it("does not flag opacity: 0 or opacity: 1 on their own", () => {
      expect(findStaticOpacity(".a { opacity: 0; }")).toEqual([]);
      expect(findStaticOpacity(".a { opacity: 1; }")).toEqual([]);
      // A show/hide pair built only from the two legitimate endpoints.
      expect(
        findStaticOpacity(".a { opacity: 0; } .a:hover { opacity: 1; }"),
      ).toEqual([]);
    });

    it("exempts only an allowlisted selector, not a lookalike", () => {
      expect(findStaticOpacity(".comp-cat-drag-ghost { opacity: 0.9; }")).toEqual([]);
      expect(findStaticOpacity(".comp-cat-drag-ghost-2 { opacity: 0.9; }")).not.toEqual([]);
    });

    it("detects a percentage opacity (fix round 1, F5)", () => {
      // parseFloat("50%") === 50, which used to read as "above 1" and never
      // fire at all.
      expect(findStaticOpacity(".a { opacity: 50%; }")).not.toEqual([]);
      expect(findStaticOpacity(".a { opacity: 100%; }")).toEqual([]);
      expect(findStaticOpacity(".a { opacity: 0%; }")).toEqual([]);
    });

    it("detects a dimming filter() function but leaves grayscale() alone (fix round 1, F5)", () => {
      expect(findStaticOpacity(".a { filter: opacity(0.3); }")).not.toEqual([]);
      expect(findStaticOpacity(".a { filter: brightness(0.4); }")).not.toEqual([]);
      expect(findStaticOpacity(".a { filter: opacity(50%); }")).not.toEqual([]);
      // Full strength or brighter is not a fade.
      expect(findStaticOpacity(".a { filter: opacity(1); }")).toEqual([]);
      expect(findStaticOpacity(".a { filter: brightness(1.2); }")).toEqual([]);
      // grayscale() rests at full strength and asserts no hue — the
      // sanctioned answer this commit installs for a bitmap <img>.
      expect(findStaticOpacity(".a { filter: grayscale(1); }")).toEqual([]);
      expect(findStaticOpacity(".a { filter: grayscale(0.5); }")).toEqual([]);
    });

    it("does not read backdrop-filter as filter, or fill-opacity/stroke-opacity as opacity (fix round 2, G3)", () => {
      // `\b`/no anchor at all both let a hyphen-prefixed property slip
      // through and get reported under the wrong name. `findBlurs` already
      // flags every backdrop-filter declaration on its own, so excluding it
      // here loses no coverage — it just stops the double-report under a
      // misnamed property.
      expect(findStaticOpacity(".a { backdrop-filter: brightness(.5); }")).toEqual([]);
      expect(findStaticOpacity(".a { fill-opacity: 0.5; }")).toEqual([]);
      // A real, correctly-anchored violation of each property still fires.
      expect(findStaticOpacity(".a { filter: brightness(.5); }")).not.toEqual([]);
      expect(findStaticOpacity(".a { opacity: 0.5; }")).not.toEqual([]);
    });

    it("does not let a hyphen-prefixed property exempt an unrelated resting opacity via the animation route (fix round 2, G3)", () => {
      // keyframesAnimatesDimming's own opacity/filter checks have the same
      // anchoring hole: a keyframes block that only touches
      // fill-opacity/backdrop-filter must not be read as "animates opacity"
      // and wrongly exempt a real violation elsewhere in the same block.
      expect(
        findStaticOpacity(
          "@keyframes k { to { fill-opacity: 0.5; } } .a { opacity: 0.3; animation: k 1s; }",
        ),
      ).not.toEqual([]);
      expect(
        findStaticOpacity(
          "@keyframes k { to { backdrop-filter: brightness(.4); } } .a { opacity: 0.3; animation: k 1s; }",
        ),
      ).not.toEqual([]);
    });

    it("keeps a { or } inside a string or url() from being read as a structural brace (fix round 1, F7)", () => {
      expect(
        findStaticOpacity('.a { content: "}"; opacity: 0.5; }'),
      ).not.toEqual([]);
      expect(
        findStaticOpacity('.a { content: "{"; opacity: 0.5; }'),
      ).not.toEqual([]);
      expect(
        findStaticOpacity(".a { background: url(\"data:image/svg+xml,<svg>{}</svg>\"); opacity: 0.5; }"),
      ).not.toEqual([]);
      // The violation's own header and value still come through intact.
      expect(findStaticOpacity('.a { content: "}"; opacity: 0.5; }')).toEqual([
        '.a { opacity: 0.5 }',
      ]);
    });
  });

  // Fix round 1, F3: OPACITY_ALLOWLIST had no equivalent of the staleness
  // check EMITTED_CLASS_ALLOWLIST already has, which is exactly how six dead
  // `lib-dragging`/`.sortable-drag` entries went unnoticed — nothing in the
  // codebase applied those classes at all, so their exemption was pure dead
  // weight that could have pre-authorised a future violation.
  it("names every OPACITY_ALLOWLIST selector as one that still carries a resting partial opacity", () => {
    const bundle = CONVERTED.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
    const withoutComments = bundle.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = ruleBlocks(withoutComments);
    const stale = OPACITY_ALLOWLIST.filter(([selector]) => {
      return !blocks.some(({ header, body }) => {
        const pieces = header.split(",").map((p) => p.trim().replace(/\s+/g, " "));
        if (!pieces.includes(selector)) return false;
        // Fix round 3, G4: anchored the same way round 2 anchored the other
        // four occurrences (unanchored, a `fill-opacity: 0.5`-only block
        // would satisfy "still carries a resting partial opacity" and keep
        // a stale allowlist entry alive — the exact F3 defect class this
        // test exists to close). parseAlphaValue (not a bare parseFloat)
        // so a percentage opacity like `50%` is read as 0.5, not as the
        // literal 50 a bare parseFloat would leave it as — which would
        // otherwise report a genuine resting partial opacity as stale.
        return [...body.matchAll(/(?<![\w-])opacity\s*:\s*([^;]+)/gi)].some((m) => {
          const v = parseAlphaValue(m[1].trim().replace(/\s*!\s*important\s*$/i, ""));
          return !Number.isNaN(v) && v > 0 && v < 1;
        });
      });
    }).map(([selector]) => selector);
    expect(stale).toEqual([]);
  });

  // Fix round 3, G4: both defects were confirmed latent, not live — neither
  // changes a current result — but the staleness check above exists
  // specifically to catch dead allowlist weight (F3), so its own leniency
  // direction is the one that matters. These pin the two failure modes
  // directly against the same matching this test's `stale` filter uses.
  it("does not let a fill-opacity-only block satisfy the OPACITY_ALLOWLIST staleness check", () => {
    // Unanchored, `fill-opacity: 0.5` would have satisfied "still carries a
    // resting partial opacity" and kept a stale allowlist entry alive.
    const body = "fill-opacity: 0.5;";
    const hasRestingOpacity = [...body.matchAll(/(?<![\w-])opacity\s*:\s*([^;]+)/gi)].some((m) => {
      const v = parseAlphaValue(m[1].trim().replace(/\s*!\s*important\s*$/i, ""));
      return !Number.isNaN(v) && v > 0 && v < 1;
    });
    expect(hasRestingOpacity).toBe(false);
  });

  it("recognises a percentage opacity as a genuine resting partial value, not stale", () => {
    // A bare parseFloat("50%") is 50, which fails v > 0 && v < 1 — reporting
    // a genuine resting partial opacity as stale (fail-loud, but still
    // wrong). parseAlphaValue reads it as 0.5.
    const body = "opacity: 50%;";
    const hasRestingOpacity = [...body.matchAll(/(?<![\w-])opacity\s*:\s*([^;]+)/gi)].some((m) => {
      const v = parseAlphaValue(m[1].trim().replace(/\s*!\s*important\s*$/i, ""));
      return !Number.isNaN(v) && v > 0 && v < 1;
    });
    expect(hasRestingOpacity).toBe(true);
  });
});

describe("the installed axi-design ships the primitives this app uses", () => {
  // Batch 2 is written against 1.10.0. In 1.8.0 `.axi-ticks` and `.axi-picker`
  // do not exist, and markup that reaches for them renders as unstyled divs
  // with nothing failing. This pins the floor where a human will see it.
  // require.resolve("@axiapps/axi-design/dist/axi.css") throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED: the package's exports map only publishes
  // "./axi.css", not "./dist/axi.css". Reach the file on disk instead.
  const pkgCss = fs.readFileSync(
    path.join(ROOT, "node_modules/@axiapps/axi-design/dist/axi.css"),
    "utf8",
  );

  it.each([
    ".axi-ticks",
    ".axi-ticks__tick--on",
    ".axi-picker__btn",
    ".axi-picker__pop",
    ".axi-picker__opt",
    ".axi-card--strip",
    ".axi-meter-list",
    ".axi-diamond",
    ".axi-stat",
    ".axi-table",
  ])("defines %s", (selector) => {
    expect(pkgCss).toContain(`${selector}`);
  });
});
