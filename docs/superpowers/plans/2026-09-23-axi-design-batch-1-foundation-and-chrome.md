# axi-design Conversion — Batch 1: Foundation and Chrome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put AxiForge on the axi design language's tokens and components, replace its 17-theme system with the package's 11 accents end to end (including the publish boundary), and convert the app chrome — titlebar, nav, buttons, inputs, selects — so that every later batch has an approved pattern to copy.

**Architecture:** The package's `axi.css` + `accents.css` are imported ahead of the app sheet from JS (not `<link>`, so Vite's order is deterministic). `base.css` and `themes.css` are deleted and replaced by `app.css` (the app layer, `af-` prefix) plus a temporary `bridge.css` that re-points legacy variable names at axi tokens so unconverted screens stay usable. A jest test, `axi-design-rules.test.js`, is the enforcement spine: it scans app CSS for the language's forbidden constructs and carries a `PENDING` allowlist of not-yet-converted files that shrinks with every batch until it is empty.

**Tech Stack:** `@axiapps/axi-design@^1.8.0` (public npm), Vite 5 (three builds: renderer, web, site), Electron, vanilla ES modules, jest 30 + babel-jest, Playwright (release-only).

**Spec:** `docs/superpowers/specs/2026-09-23-axi-design-conversion-design.md`

## Global Constraints

- **No colour literal in app CSS.** Sanctioned homes for a hex: the package's `tokens.css`, the package's `accents.json`, and `forge-render.css`'s `var(--axi-…, #literal)` fallbacks (batch 5 only, not this batch).
- **No `border-radius`.** `--axi-radius` and `--axi-radius-sm` are `0`; read the token, never a literal.
- **Every `box-shadow` is exactly** `<offset> <offset> 0 var(--axi-ink-line)`, offset drawn from `--axi-offset-panel`, `--axi-offset-control`, `--axi-offset-panel-hover`, `--axi-offset-control-hover`. No blur, no spread, no other colour. `filter: drop-shadow(...)`, `text-shadow` and `backdrop-filter` are forbidden outright.
- **No gradient on a surface. No `color-mix(…, transparent)`. No `rgba(var(--accent-rgb), …)`.** A quiet colour comes from the neutral ramp, never from a strong colour at partial opacity.
- **Two form steps only.** Panel = `--axi-border-panel` (4px) / `--axi-offset-panel` (6px). Control = `--axi-border-control` (3px) / `--axi-offset-control` (3px). `--axi-border-hairline` (2px) is a prose rule weight, not a step. Never write a literal border width.
- **Hover lift:** control = `transform: translate(-2px, -2px)` + gain the `--axi-offset-control` block from nothing; control-already-blocked = same translate, block 3px→6px; panel = `translate(-3px, -3px)`, block 6px→10px. Never opacity, never a glow, never `scale()`.
- **Type through tokens:** `font: var(--axi-t-*)` paired with `letter-spacing: var(--axi-ls-*)`. No `font-family` except `var(--axi-sans)` / `var(--axi-mono)`. Eyebrows use `.axi-eyebrow`.
- **Every animation is `transform`/`opacity` only**, and `@media (prefers-reduced-motion: reduce)` kills it while leaving state legible.
- **Behaviour is unchanged.** This is a reskin. No feature, IPC, state or data-shape change. Anything noticed goes to `docs/BACKLOG.md`.
- **Default accent id is `axi-gold`.** Accent ids and labels come from `accents.json`; the app never hard-codes the list.
- **The `appearance.theme` setting key does not change**, and nothing migrates the stored value on read — `resolveAccentId` absorbs legacy ids, so downgrading to an older build still works.
- Test runner is `npm test` (jest, configured under the `jest` key in `package.json`). Playwright suites are release-only; do not run them in this batch.

## Review Focus

Five things the spec implies but that no obvious task would test, most likely to bite first:

1. **A share URL already posted to Discord carries `?t=prof-guardian`.** Those URLs are immutable in the wild (`src/main/index.js:1640,1704,1840`). The published SPA must still theme correctly for every legacy id, forever — not just for pages published by an older build. *Pinned in Task 7.*
2. **`appearance.theme` holding `""` (the default "Golden Amber") is falsy.** `renderer.js:650` guards with `if (savedTheme)`, so the empty string means "default" today. `resolveAccentId("")` must return `axi-gold`, and `resolveAccentId(undefined)` must too. *Pinned in Task 4.*
3. **An unknown or hand-edited theme id** — a value from a future version, or a typo in a URL — must fall back to the default rather than setting `data-axi-accent` to garbage, which would silently leave the app gold-by-fallthrough with a bogus attribute in the DOM. *Pinned in Task 4.*
4. **Profession tinting stashes and restores the user's own accent.** `applyProfessionThemeIfEnabled` / `restoreUserThemeIfNeeded` currently detect "am I showing a profession theme?" with a `prof-` string prefix, which no longer exists once ids are accents. Leaving a build must restore the accent the user picked, not the default. *Pinned in Task 5.*
5. **Two professions map to the same accent.** Elementalist and Revenant both resolve to `crimson-red`, so a uniqueness assertion over the profession map — which the current `profession-themes.test.js` has — would be wrong after the conversion and must be replaced deliberately, not deleted. *Pinned in Task 4.*

---

### Task 1: Install the package and fix CSS import order

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/renderer/index.html:7-13` (drop font links, drop the stylesheet link)
- Modify: `src/renderer/renderer.js:1` (add the three CSS imports)
- Modify: `src/web/main-web.js:2-3`
- Modify: `src/site/main.js:1`
- Modify: `src/site/index.html` (drop font links if present)
- Test: `tests/unit/styles/import-order.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `@axiapps/axi-design` resolvable at `@axiapps/axi-design/axi.css`, `/accents.css`, `/accents.json`. Every later task assumes the package's tokens are in scope.

Why CSS moves out of `<link>`: `src/renderer/index.html` currently does `<link rel="stylesheet" href="./styles.css" />`. A bare specifier (`@axiapps/...`) cannot go in an HTML `href`, and mixing an HTML `<link>` with JS-imported CSS makes the cascade order differ between `vite dev` and `vite build`. Importing all three from `renderer.js` makes the order explicit and identical in both. `src/web/main-web.js` and `src/site/main.js` already import their CSS from JS, so they only gain two lines.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/styles/import-order.test.js`:

```js
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// The package must be in the cascade before the app's own sheet, in every
// entry. If the app sheet won the order, the app would still be overriding
// tokens it is supposed to be consuming.
const ENTRIES = [
  "src/renderer/renderer.js",
  "src/web/main-web.js",
  "src/site/main.js",
];

describe("axi-design import order", () => {
  it("declares the package as a dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["@axiapps/axi-design"]).toBeTruthy();
  });

  it.each(ENTRIES)("imports axi.css then accents.css before app CSS in %s", (entry) => {
    const src = read(entry);
    const axi = src.indexOf('@axiapps/axi-design/axi.css');
    const accents = src.indexOf('@axiapps/axi-design/accents.css');
    const app = src.search(/import ["']\.\/(styles|web)\.css["']/);

    expect(axi).toBeGreaterThan(-1);
    expect(accents).toBeGreaterThan(axi);
    expect(app).toBeGreaterThan(accents);
  });

  it("no longer link-tags the app stylesheet from the renderer HTML", () => {
    // Order between an HTML <link> and JS-imported CSS is not stable across
    // vite dev and vite build, so styles.css is imported from renderer.js.
    expect(read("src/renderer/index.html")).not.toMatch(/<link[^>]+styles\.css/);
  });

  it.each(["src/renderer/index.html", "src/site/index.html"])(
    "fetches no remote webfont in %s",
    (file) => {
      expect(read(file)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    },
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/unit/styles/import-order.test.js`
Expected: FAIL — `pkg.dependencies["@axiapps/axi-design"]` is undefined.

- [ ] **Step 3: Install the package**

```bash
npm install @axiapps/axi-design@^1.8.0
```

- [ ] **Step 4: Rewrite the renderer HTML head**

In `src/renderer/index.html`, replace lines 7-13 (the two `preconnect`s, the Google Fonts `<link>`, and the `styles.css` `<link>`) with nothing — the head keeps only `<meta>` and `<title>`. The stylesheet arrives via `renderer.js` instead.

- [ ] **Step 5: Add the imports to the three entries**

At the very top of `src/renderer/renderer.js`, above every other import:

```js
import "@axiapps/axi-design/axi.css";
import "@axiapps/axi-design/accents.css";
import "./styles.css";
```

In `src/web/main-web.js`, above the existing `import "./web.css"`:

```js
import "@axiapps/axi-design/axi.css";
import "@axiapps/axi-design/accents.css";
```

In `src/site/main.js`, above the existing `import "./styles.css"`:

```js
import "@axiapps/axi-design/axi.css";
import "@axiapps/axi-design/accents.css";
```

- [ ] **Step 6: Strip the font links from the site entry**

In `src/site/index.html`, delete any `fonts.googleapis.com` / `fonts.gstatic.com` `<link>` tags.

- [ ] **Step 7: Run the test**

Run: `npm test -- tests/unit/styles/import-order.test.js`
Expected: PASS, 8 assertions.

- [ ] **Step 8: Confirm nothing else broke**

Run: `npm test`
Expected: PASS. The app now loads both stylesheets; it looks unchanged, because the app's own rules still win on specificity.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/renderer/index.html src/renderer/renderer.js \
        src/web/main-web.js src/site/main.js src/site/index.html tests/unit/styles/import-order.test.js
git commit -m "build: import @axiapps/axi-design ahead of the app stylesheet

Moves the renderer's app CSS from an HTML <link> into renderer.js so the
cascade order is identical under vite dev and vite build, and drops the
three Google webfonts from every entry."
```

---

### Task 2: The rules gate test

**Files:**
- Create: `tests/unit/styles/axi-design-rules.test.js`
- Create: `tests/unit/styles/__fixtures__/violation.css`
- Test: the file above is itself the test

**Interfaces:**
- Consumes: nothing.
- Produces: `PENDING` — an exported-by-convention array at the top of `axi-design-rules.test.js` listing every app CSS file not yet converted. **Every later task in every later batch removes its file from `PENDING` as its final step.** When `PENDING` is `[]`, the conversion is complete and the test is the proof.

This is the batch's most important artifact: it turns "grep for hex literals by hand" into a gate that runs on every commit and cannot be forgotten.

- [ ] **Step 1: Write the test**

Create `tests/unit/styles/axi-design-rules.test.js`:

```js
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// Every stylesheet the app owns. The package's own dist/ is exempt: tokens.css
// is the one file in the system allowed to hold a colour literal.
const APP_CSS = [
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
  // app.css does not exist until Task 3, which removes this line.
  "src/renderer/styles/app.css",
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
  describe.each(CONVERTED)("%s", (file) => {
    const css = fs.readFileSync(path.join(ROOT, file), "utf8");

    it.each(SCANNERS)("has no %s", (_label, scan) => {
      expect(scan(css)).toEqual([]);
    });
  });

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
```

- [ ] **Step 2: Write the violation fixture**

Create `tests/unit/styles/__fixtures__/violation.css`:

```css
/* Every rule broken at once. Fixture for the scanner self-test. */
.v1 { color: #ffc53d; background: rgba(200, 152, 72, 0.12); }
.v2 { border-radius: 14px; }
.v3 { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6); }
.v4 { backdrop-filter: blur(8px); text-shadow: 0 1px 2px #000; }
.v5 { background: linear-gradient(180deg, #141518, #101114); }
.v6 { border: 1px solid var(--axi-ink-line); }
.v7 { font-family: "Cinzel", serif; }
.v8 { background: var(--panel-gradient); color: var(--text-dim); }
.v9 { background: color-mix(in srgb, var(--accent) 12%, transparent); }
```

- [ ] **Step 3: Run the gate**

Run: `npm test -- tests/unit/styles/axi-design-rules.test.js`
Expected: PASS. `CONVERTED` is empty at this point — every file is still in `PENDING`, including `app.css`, which Task 3 creates — so the assertions that run are the scanner self-tests against the fixture and the two list-consistency checks. Those are the ones that matter now: they prove the scanners actually catch what they claim to before any file is held to them.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/styles/
git commit -m "test: gate app CSS against the axi design language rules

Scans for colour literals, radius literals, illegal box-shadows, blurs,
gradients, literal border widths, non-token font stacks and leftover
legacy palette variables. PENDING lists the files not yet converted and
shrinks with every conversion task; when it is empty the conversion is
complete and this test is the proof."
```

---

### Task 3: Replace base.css and themes.css with app.css + bridge.css

**Files:**
- Delete: `src/renderer/styles/base.css`, `src/renderer/styles/themes.css`
- Create: `src/renderer/styles/app.css`, `src/renderer/styles/bridge.css`
- Modify: `src/renderer/styles.css` (the manifest)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (remove `app.css` from `PENDING`)

**Interfaces:**
- Consumes: the package tokens from Task 1.
- Produces: `app.css` holding `.af-*` shared shapes, the `.theme-transitioning` crossfade class (Task 5 toggles it) and the reduced-motion block; `bridge.css` holding every legacy variable name still referenced by a `PENDING` file.

- [ ] **Step 1: Rewrite the manifest**

`src/renderer/styles.css` becomes — note `app.css` first so later partials can override its shared shapes, and `bridge.css` immediately after it:

```css
/* AxiForge — styles entry point.
   @axiapps/axi-design is imported ahead of this file from renderer.js. */
@import "./styles/app.css";
@import "./styles/bridge.css";
@import "./styles/layout.css";
@import "./styles/buttons.css";
@import "./styles/forms.css";
@import "./styles/custom-select.css";
@import "./styles/cards.css";
@import "./styles/specializations.css";
@import "./styles/skills.css";
@import "./styles/detail-panel.css";
@import "./styles/equipment.css";
@import "./styles/wiki-modal.css";
@import "./styles/detail-modal.css";
@import "./styles/skeleton.css";
@import "./styles/notes.css";
@import "./styles/confirm-modal.css";
@import "./styles/whats-new-modal.css";
@import "./styles/import-conflict-modal.css";
@import "./styles/share-modal.css";
@import "./styles/smart-folder-modal.css";
@import "./styles/team-modal.css";
@import "./styles/settings-modal.css";
@import "./styles/library.css";
@import "./styles/comps.css";
@import "./styles/build-sources.css";
@import "../../packages/forge-render/src/forge-render.css";
@import "./styles/forge-render-bridge.css";
```

- [ ] **Step 2: Write app.css**

Create `src/renderer/styles/app.css`. This is AxiForge's answer to AxiAM's `index.css`; keep the comments, they explain the non-obvious parts:

```css
/* AxiForge app layer over @axiapps/axi-design (imported first in renderer.js).
   Window plumbing, the z-index scale the app's own JS reads, and the shapes
   shared across screens. No colour literals: every colour is a token. */

/* --- layout constants the app's JS and partials both read --- */
:root {
  /* The fixed titlebar's height. Everything below it is positioned against
     this; it was written by hand in five places once, as 42px in two of them
     and 40px in the other three, which let the page scroll 2px and slide the
     left nav under the titlebar. One name, one value. */
  --af-titlebar-h: 42px;

  --z-sticky: 10;
  --z-titlebar: 50;
  --z-dropdown: 90;
  --z-autocomplete: 100;
  --z-tooltip: 120;
  --z-menu: 200;
  --z-modal: 1000;
  --z-modal-confirm: 1100;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  min-height: 100vh;
  background: var(--axi-ground);
  color: var(--axi-text);
  font: var(--axi-t-body);
}

/* Clear the fixed titlebar with PADDING, not a margin on the first child: an
   adjoining top margin collapses out through a parent with no top padding or
   border, so it would land on <body>, make <html> taller than the viewport
   and let the whole document scroll under the titlebar. */
body { padding-top: var(--af-titlebar-h); }

a { color: var(--axi-accent); }

.app-drag { -webkit-app-region: drag; }
.no-drag, .no-drag * { -webkit-app-region: no-drag; }
.hidden { display: none !important; }

/* --- scrollbars --- */

* { scrollbar-width: thin; scrollbar-color: var(--axi-rule) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--axi-ground); }
::-webkit-scrollbar-thumb {
  background: var(--axi-surface-raised);
  border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
::-webkit-scrollbar-thumb:hover { background: var(--axi-rule); }

/* --- the background wordmark ---
   Replaces the animated radial-gradient wash base.css used to draw: a
   gradient across the ground at partial opacity broke rules 1 and 2 at once.
   AxiAM's .am-mark pattern instead — one static, solid surface-ink shape
   punched through a mask, which costs nothing to composite and says the same
   thing. */
.af-mark {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: var(--axi-surface);
  -webkit-mask: url("./svg/axiforge-glyph.svg") no-repeat center 55% / 130%;
  mask: url("./svg/axiforge-glyph.svg") no-repeat center 55% / 130%;
}

/* --- status --- */

.af-dot {
  width: 9px;
  height: 9px;
  display: inline-block;
  border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
.af-dot--ok { background: var(--axi-ok); }
.af-dot--warn { background: var(--axi-warn); }
.af-dot--danger { background: var(--axi-danger); }
.af-dot--idle { background: var(--axi-surface-raised); }

/* --- work indicator ---
   Compositor-only (rule 11). These report on a save, a publish or a sync, all
   of which can block the main thread; anything animated by layout or paint
   would freeze exactly when it most needs to look alive. */
@keyframes af-work { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
.af-work { animation: af-work 1.1s ease-in-out infinite; }

/* --- accent crossfade, toggled by applyAccent() for 500ms --- */

.theme-transitioning *,
.theme-transitioning *::before,
.theme-transitioning *::after {
  transition: background-color .4s ease, border-color .4s ease,
    color .2s ease, box-shadow .4s ease, outline-color .4s ease !important;
}

/* --- reduced motion: kill every loop; state stays legible in the chips --- */

@media (prefers-reduced-motion: reduce) {
  .af-work { animation: none; }
  .theme-transitioning *,
  .theme-transitioning *::before,
  .theme-transitioning *::after { transition: none !important; }
}
```

- [ ] **Step 3: Write bridge.css**

Create `src/renderer/styles/bridge.css`. Derive the name list mechanically — every legacy variable the `PENDING` files still read:

```bash
grep -ho 'var(--[a-z0-9-]*' src/renderer/styles/*.css src/web/*.css src/site/*.css \
  | sed 's/var(//' | sort -u | grep -v '^--axi-\|^--af-\|^--fr-\|^--z-'
```

```css
/* TEMPORARY — deleted in batch 5.
   Re-points the legacy palette at axi tokens so screens not yet converted keep
   rendering: flat, on the right ground, wrong in detail, but usable and
   reviewable. Every name here is a screen still to do, which makes this file
   the conversion's checklist. When PENDING in tests/unit/styles/
   axi-design-rules.test.js is empty, delete this file and the @import above
   it; the build failing without it would mean a converted sheet still leans
   on a legacy name.

   --accent-rgb is deliberately NOT defined. It exists only to be interpolated
   into rgba(var(--accent-rgb), .12), which is the partial-opacity colour rule
   2 forbids, so those rules are meant to fail visibly (transparent) rather
   than survive in a muted form. Each batch converts its own. */
:root {
  --bg: var(--axi-ground);
  --bg-2: var(--axi-ground);
  --panel: var(--axi-surface);
  --panel-2: var(--axi-surface);
  --panel-gradient: var(--axi-surface);
  --surface: var(--axi-surface);
  --surface-hover: var(--axi-surface-raised);
  --line: var(--axi-ink-line);
  --line-soft: var(--axi-ink-line);
  --text: var(--axi-text);
  --text-light: var(--axi-text-dim);
  --text-dim: var(--axi-text-faint);
  --muted: var(--axi-text-faint);
  --accent: var(--axi-accent);
  --accent-2: var(--axi-meta);
  --gold: var(--axi-accent);
  --link: var(--axi-accent);
  --danger: var(--axi-danger);
  --danger-text: var(--axi-danger);
  --input-bg: var(--axi-ground);
  --input-border: var(--axi-ink-line);
  --hover-subtle: var(--axi-surface-raised);
  --hover-accent: var(--axi-surface-raised);
  --hover-accent-strong: var(--axi-rule);
  --focus-ring: var(--axi-accent);
  --overlay: var(--axi-scrim);
  --btn-primary-from: var(--axi-accent);
  --btn-primary-to: var(--axi-accent);
  --btn-primary-from-hover: var(--axi-accent);
  --btn-primary-to-hover: var(--axi-accent);
  --radius: var(--axi-radius);
  --radius-sm: var(--axi-radius-sm);
  --radius-xs: var(--axi-radius-sm);
  --shadow-sm: none;
  --shadow-md: none;
  --shadow-lg: none;
  --titlebar-h: var(--af-titlebar-h);
}
```

- [ ] **Step 4: Delete the old foundation**

```bash
git rm src/renderer/styles/base.css src/renderer/styles/themes.css
```

- [ ] **Step 5: Add the background mark to the markup**

In `src/renderer/index.html`, immediately after `<body>`, add:

```html
<div class="af-mark" aria-hidden="true"></div>
```

(`base.css` drew this with `body::before`; a real element is needed because the mask references an asset path that must resolve relative to the document, and because `body` now carries `padding-top`.)

- [ ] **Step 6: Hold app.css to the gate**

Delete the `"src/renderer/styles/app.css"` line from `PENDING` in `tests/unit/styles/axi-design-rules.test.js`, so `app.css` becomes the first converted file.

Run: `npm test -- tests/unit/styles/axi-design-rules.test.js`
Expected: PASS — `app.css` must survive all eight scanners.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Look at it**

Launch the app. Expected: near-black axi ground, no ambient wash, square corners everywhere, no blurred shadows, the wordmark faint behind the content. Screens are visibly unfinished — that is the bridge doing its job. Nothing should be unreadable; if a region is invisible, a legacy name is missing from `bridge.css`.

- [ ] **Step 9: Commit**

```bash
git add -A src/renderer/styles src/renderer/index.html src/renderer/styles.css
git commit -m "style: replace base.css and themes.css with the axi app layer

app.css carries window plumbing, the z-index scale, the status dot, the
compositor-only work indicator and the reduced-motion block. bridge.css
temporarily re-points the legacy palette at axi tokens so unconverted
screens stay usable; --accent-rgb is deliberately left undefined so
partial-opacity accent rules fail visibly instead of surviving muted.

The animated radial-gradient wash is gone, replaced by a static masked
wordmark (AxiAM's .am-mark pattern)."
```

---

### Task 4: The accents module

**Files:**
- Create: `src/renderer/modules/accents.js`
- Modify: `src/renderer/modules/constants.js:182-192` (replace `PROFESSION_THEMES`)
- Rewrite: `tests/unit/renderer/profession-themes.test.js`
- Test: `tests/unit/renderer/accents.test.js`

**Interfaces:**
- Consumes: `@axiapps/axi-design/accents.json`.
- Produces:
  - `ACCENTS: Array<{id: string, label: string, hex: string}>`
  - `DEFAULT_ACCENT_ID: "axi-gold"`
  - `resolveAccentId(id?: string): string` — always returns a valid accent id
  - `PROFESSION_ACCENTS: Record<string, string>` (9 professions → accent id), re-exported from `constants.js` in place of `PROFESSION_THEMES`
  - `applyAccent(id?: string): string` — sets `data-axi-accent` on `<html>`, adds `.theme-transitioning` for 500ms, returns the resolved id

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/renderer/accents.test.js`:

```js
"use strict";

const {
  ACCENTS,
  DEFAULT_ACCENT_ID,
  PROFESSION_ACCENTS,
  resolveAccentId,
} = require("../../../src/renderer/modules/accents.js");
const { PROFESSION_WEIGHT } = require("../../../src/renderer/modules/constants.js");

describe("ACCENTS", () => {
  it("comes from the package, not a local copy", () => {
    const fromPackage = require("@axiapps/axi-design/accents.json");
    expect(ACCENTS).toEqual(fromPackage);
  });

  it("contains the default", () => {
    expect(ACCENTS.some((a) => a.id === DEFAULT_ACCENT_ID)).toBe(true);
  });
});

describe("resolveAccentId", () => {
  it("passes through a valid accent id", () => {
    expect(resolveAccentId("violet-purple")).toBe("violet-purple");
  });

  // Review Focus 2: appearance.theme === "" is how "Golden Amber" (the old
  // default) is stored, and it is falsy.
  it.each([["", "empty string"], [undefined, "undefined"], [null, "null"]])(
    "resolves %s (%s) to the default",
    (input) => {
      expect(resolveAccentId(input)).toBe(DEFAULT_ACCENT_ID);
    },
  );

  // Review Focus 3: never return something that is not an accent.
  it.each(["not-a-theme", "prof-necromancy", "AXI-GOLD", "../../etc/passwd"])(
    "resolves the unknown id %s to the default",
    (input) => {
      const resolved = resolveAccentId(input);
      expect(ACCENTS.some((a) => a.id === resolved)).toBe(true);
      expect(resolved).toBe(DEFAULT_ACCENT_ID);
    },
  );

  it.each([
    ["", "axi-gold"],
    ["molten-core", "amber-warm"],
    ["cinderfall", "crimson-red"],
    ["frostforge", "refined-cyan"],
    ["verdant-crucible", "emerald-mint"],
    ["copper", "gold-bronze"],
    ["rose-gold", "rose-pink"],
    ["cobalt", "electric-blue"],
    ["mithril", "slate-silver"],
    ["prof-guardian", "electric-blue"],
    ["prof-warrior", "amber-warm"],
    ["prof-engineer", "gold-bronze"],
    ["prof-ranger", "emerald-mint"],
    ["prof-necromancer", "teal-ocean"],
    ["prof-thief", "rose-pink"],
    ["prof-mesmer", "violet-purple"],
    ["prof-elementalist", "crimson-red"],
    ["prof-revenant", "crimson-red"],
  ])("maps the legacy id %s to %s", (legacy, accent) => {
    expect(resolveAccentId(legacy)).toBe(accent);
  });

  it("resolves every legacy id to an id that exists in the package", () => {
    const legacy = [
      "", "molten-core", "cinderfall", "frostforge", "verdant-crucible",
      "copper", "cobalt", "mithril", "rose-gold",
      "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
      "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
      "prof-revenant",
    ];
    for (const id of legacy) {
      expect(ACCENTS.some((a) => a.id === resolveAccentId(id))).toBe(true);
    }
  });
});

describe("PROFESSION_ACCENTS", () => {
  it("covers every profession in PROFESSION_WEIGHT", () => {
    for (const profession of Object.keys(PROFESSION_WEIGHT)) {
      expect(PROFESSION_ACCENTS).toHaveProperty(profession);
    }
  });

  it("has exactly 9 entries", () => {
    expect(Object.keys(PROFESSION_ACCENTS)).toHaveLength(9);
  });

  it("maps every profession to a real package accent", () => {
    for (const id of Object.values(PROFESSION_ACCENTS)) {
      expect(ACCENTS.some((a) => a.id === id)).toBe(true);
    }
  });

  // Review Focus 5: the old test asserted uniqueness. Elementalist and
  // Revenant deliberately share crimson-red - their pre-conversion colours
  // were #d06050 and #b05050, and the palette has one red at that hue. This
  // assertion replaces the uniqueness one so the sharing stays deliberate: if
  // a third profession joins them, this fails and someone has to decide.
  it("shares an accent only between Elementalist and Revenant", () => {
    const counts = {};
    for (const id of Object.values(PROFESSION_ACCENTS)) counts[id] = (counts[id] || 0) + 1;
    const shared = Object.entries(counts).filter(([, n]) => n > 1);
    expect(shared).toEqual([["crimson-red", 2]]);
    expect(PROFESSION_ACCENTS.Elementalist).toBe("crimson-red");
    expect(PROFESSION_ACCENTS.Revenant).toBe("crimson-red");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- tests/unit/renderer/accents.test.js`
Expected: FAIL — `Cannot find module '.../modules/accents.js'`.

- [ ] **Step 3: Write the module**

Create `src/renderer/modules/accents.js`:

```js
// Accent selection for AxiForge, over @axiapps/axi-design.
//
// The design language themes exactly one variable, --axi-accent, against a
// single fixed ground. AxiForge used to ship 17 themes: 8 that rewrote the
// backgrounds and 9 applied per profession. All of them collapse to an accent
// id here, and LEGACY_THEME_TO_ACCENT is what keeps ids already persisted in
// settings - and already baked into share URLs in the wild - working.
import accentsJson from "@axiapps/axi-design/accents.json";

export const ACCENTS = accentsJson;

export const DEFAULT_ACCENT_ID = "axi-gold";

// Each profession keeps the hue it already had in themes.css. Elementalist and
// Revenant share crimson-red: their old colours were #d06050 and #b05050, and
// the family palette has one red at that hue. Necromancer takes the cooler
// green so it stays distinguishable from Ranger.
export const PROFESSION_ACCENTS = {
  Guardian: "electric-blue",
  Warrior: "amber-warm",
  Necromancer: "teal-ocean",
  Engineer: "gold-bronze",
  Ranger: "emerald-mint",
  Thief: "rose-pink",
  Mesmer: "violet-purple",
  Elementalist: "crimson-red",
  Revenant: "crimson-red",
};

// Every theme id a pre-conversion version could have written to
// appearance.theme or into a published page's ?t= parameter. Those URLs are
// immutable once shared, so this map is permanent, not a migration.
const LEGACY_THEME_TO_ACCENT = {
  "": DEFAULT_ACCENT_ID, // "Golden Amber", the old default
  "molten-core": "amber-warm",
  cinderfall: "crimson-red",
  frostforge: "refined-cyan",
  "verdant-crucible": "emerald-mint",
  copper: "gold-bronze",
  "rose-gold": "rose-pink",
  cobalt: "electric-blue",
  mithril: "slate-silver",
  "prof-guardian": PROFESSION_ACCENTS.Guardian,
  "prof-warrior": PROFESSION_ACCENTS.Warrior,
  "prof-necromancer": PROFESSION_ACCENTS.Necromancer,
  "prof-engineer": PROFESSION_ACCENTS.Engineer,
  "prof-ranger": PROFESSION_ACCENTS.Ranger,
  "prof-thief": PROFESSION_ACCENTS.Thief,
  "prof-mesmer": PROFESSION_ACCENTS.Mesmer,
  "prof-elementalist": PROFESSION_ACCENTS.Elementalist,
  "prof-revenant": PROFESSION_ACCENTS.Revenant,
};

/** Always returns an id that exists in ACCENTS. */
export function resolveAccentId(id) {
  if (id && ACCENTS.some((a) => a.id === id)) return id;
  // "" is a legacy value and is falsy, so it has to be tested explicitly.
  if (id === "" || id == null) return DEFAULT_ACCENT_ID;
  return LEGACY_THEME_TO_ACCENT[id] || DEFAULT_ACCENT_ID;
}

let _transitionTimer = null;

/** Sets the accent on <html>, crossfading for 500ms. Returns the resolved id. */
export function applyAccent(id) {
  const resolved = resolveAccentId(id);
  const root = document.documentElement;

  root.classList.add("theme-transitioning");
  if (_transitionTimer) clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(() => {
    root.classList.remove("theme-transitioning");
    _transitionTimer = null;
  }, 500);

  root.setAttribute("data-axi-accent", resolved);
  return resolved;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/unit/renderer/accents.test.js`
Expected: PASS.

- [ ] **Step 5: Re-point constants.js**

In `src/renderer/modules/constants.js`, delete the `PROFESSION_THEMES` block at lines 182-192 and replace it with a re-export, so the 9-entry map has exactly one definition:

```js
// Profession -> accent id. Defined in accents.js next to the legacy map that
// has to agree with it; re-exported here because this is where callers look.
export { PROFESSION_ACCENTS } from "./accents.js";
```

- [ ] **Step 6: Rewrite the old theme test**

Replace `tests/unit/renderer/profession-themes.test.js` entirely — it asserted `/^prof-/` ids and map-wide uniqueness, both of which are now wrong:

```js
"use strict";

// The profession map's contract now lives in accents.test.js, which owns both
// the map and the legacy ids it has to stay consistent with. This file keeps
// only the one thing it uniquely covered: that constants.js - where the app's
// callers look - exposes the same map, so the re-export cannot silently rot.
const constants = require("../../../src/renderer/modules/constants.js");
const accents = require("../../../src/renderer/modules/accents.js");

describe("constants re-exports the profession accent map", () => {
  it("exposes PROFESSION_ACCENTS", () => {
    expect(constants.PROFESSION_ACCENTS).toBe(accents.PROFESSION_ACCENTS);
  });

  it("no longer exposes the removed PROFESSION_THEMES", () => {
    expect(constants.PROFESSION_THEMES).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run the suite and fix the fallout**

Run: `npm test`
Expected: failures anywhere `PROFESSION_THEMES` is still imported. Find them and re-point the name:

```bash
grep -rn "PROFESSION_THEMES" src tests --include=*.js | grep -v node_modules
```

Rename the identifier only — **do not** change any surrounding logic; Task 5 owns the behaviour.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/modules/accents.js src/renderer/modules/constants.js \
        tests/unit/renderer/accents.test.js tests/unit/renderer/profession-themes.test.js
git commit -m "feat: accent module over the axi-design palette

Collapses the 8 full themes and 9 profession themes to accent ids from
the package's accents.json, with a permanent legacy map: theme ids are
baked into share URLs already posted, so they have to resolve forever.
Elementalist and Revenant deliberately share crimson-red."
```

---

### Task 5: Wire the accent into the renderer

**Files:**
- Modify: `src/renderer/renderer.js:436-438`, `:648-651`, `:1166-1192`
- Test: `tests/unit/renderer/accent-stash.test.js`

**Interfaces:**
- Consumes: `applyAccent`, `resolveAccentId`, `PROFESSION_ACCENTS`, `DEFAULT_ACCENT_ID` from Task 4.
- Produces: `applyProfessionAccentIfEnabled()`, `restoreUserAccentIfNeeded()` — same call sites and same behaviour as the `prof-` versions they replace.

The behaviour to preserve exactly: opening a build tints the app to its profession; leaving it restores the accent the user chose; changing the accent while a profession tint is showing updates what will be restored, not what is showing. The `prof-` string-prefix test that detected "a profession tint is showing" no longer works, because a profession's accent id is now an ordinary accent id — `crimson-red` could equally be the user's own pick. So the stash becomes the state: **`_stashedAccent !== null` means a profession tint is showing.**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/accent-stash.test.js`:

```js
"use strict";

// renderer.js is a large module with Electron-dependent side effects at import
// time, so the stash/restore logic is tested through a faithful copy of its
// shape. This test's job is to pin the state machine described in the plan:
// the stash - not a string prefix on the DOM attribute - is what records that
// a profession tint is showing.
const { PROFESSION_ACCENTS, resolveAccentId, DEFAULT_ACCENT_ID } =
  require("../../../src/renderer/modules/accents.js");

function makeTinting({ themedBuildsEnabled }) {
  let shown = DEFAULT_ACCENT_ID; // what data-axi-accent currently holds
  let stashed = null;            // the user's own accent, while a tint shows
  let userChoice = DEFAULT_ACCENT_ID;

  return {
    get shown() { return shown; },
    get tinting() { return stashed !== null; },
    setUserAccent(id) {
      userChoice = resolveAccentId(id);
      // Changing the accent behind a tint updates what gets restored.
      if (stashed !== null) stashed = userChoice;
      else shown = userChoice;
    },
    openBuild(profession) {
      if (!themedBuildsEnabled) return;
      const accent = PROFESSION_ACCENTS[profession];
      if (!accent) return;
      if (stashed === null) stashed = userChoice;
      shown = accent;
    },
    leaveBuild() {
      if (stashed === null) return;
      shown = stashed;
      stashed = null;
    },
  };
}

describe("profession tinting", () => {
  it("tints to the build's profession and restores the user's accent", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("violet-purple");
    expect(t.shown).toBe("violet-purple");

    t.openBuild("Guardian");
    expect(t.shown).toBe("electric-blue");
    expect(t.tinting).toBe(true);

    t.leaveBuild();
    expect(t.shown).toBe("violet-purple");
    expect(t.tinting).toBe(false);
  });

  // Review Focus 4: the prof- prefix used to mark "a tint is showing". A
  // profession accent is now an ordinary id, so a user who picks the same
  // colour as the build's profession must still get it back.
  it("restores the user's accent even when it equals the profession's", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("electric-blue");
    t.openBuild("Guardian");
    expect(t.shown).toBe("electric-blue");
    t.leaveBuild();
    expect(t.shown).toBe("electric-blue");
    expect(t.tinting).toBe(false);
  });

  it("changing the accent behind a tint changes what is restored, not what shows", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("violet-purple");
    t.openBuild("Mesmer");
    t.setUserAccent("teal-ocean");
    expect(t.shown).toBe("violet-purple"); // the Mesmer tint, still showing
    t.leaveBuild();
    expect(t.shown).toBe("teal-ocean");
  });

  it("does nothing when themed builds are off", () => {
    const t = makeTinting({ themedBuildsEnabled: false });
    t.setUserAccent("rose-pink");
    t.openBuild("Guardian");
    expect(t.shown).toBe("rose-pink");
    expect(t.tinting).toBe(false);
  });

  it("leaves a build with no profession alone", () => {
    const t = makeTinting({ themedBuildsEnabled: true });
    t.setUserAccent("rose-pink");
    t.openBuild(undefined);
    expect(t.shown).toBe("rose-pink");
    expect(t.tinting).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/unit/renderer/accent-stash.test.js`
Expected: PASS immediately — it pins the intended state machine before `renderer.js` implements it. That is deliberate: the next steps must make `renderer.js` match this shape, and the test is the written statement of what to match.

- [ ] **Step 3: Import the module in renderer.js**

Add to the imports in `src/renderer/renderer.js`:

```js
import { applyAccent, resolveAccentId, PROFESSION_ACCENTS, DEFAULT_ACCENT_ID } from "./modules/accents.js";
```

Remove `PROFESSION_THEMES` from the `constants.js` import list if it is still there.

- [ ] **Step 4: Replace the three theme functions**

Replace `applyThemeWithTransition`, `applyProfessionThemeIfEnabled` and `restoreUserThemeIfNeeded` (currently `renderer.js:1166-1192`) with:

```js
// The user's own accent, held while a profession tint is showing. Non-null is
// what marks "a tint is showing" - the old prof- id prefix cannot do that job
// any more, because a profession's accent is an ordinary accent id and could
// equally be the user's own pick.
let _userAccent = DEFAULT_ACCENT_ID;

function applyProfessionAccentIfEnabled() {
  if (!_themedBuildsEnabled) return;
  const profession = state.editor?.profession;
  const accent = profession ? PROFESSION_ACCENTS[profession] : null;
  if (!accent) return;
  if (_stashedAccent === null) _stashedAccent = _userAccent;
  applyAccent(accent);
}

function restoreUserAccentIfNeeded() {
  if (_stashedAccent === null) return;
  applyAccent(_stashedAccent);
  _stashedAccent = null;
}
```

Rename the existing `_stashedTheme` declaration to `_stashedAccent` and initialise it to `null`:

```js
let _stashedAccent = null;
```

- [ ] **Step 5: Update the two call sites of the renamed functions**

```bash
grep -n "applyProfessionThemeIfEnabled\|restoreUserThemeIfNeeded\|applyThemeWithTransition" src/renderer/renderer.js
```

Rename each to `applyProfessionAccentIfEnabled` / `restoreUserAccentIfNeeded`. `applyThemeWithTransition` has no remaining callers — `applyAccent` replaces it.

- [ ] **Step 6: Update the settings callback**

`renderer.js:436-438` currently reads the DOM attribute to decide whether to stash. Replace the `onThemeChange` callback body with:

```js
  onThemeChange: (accentId) => {
    const resolved = resolveAccentId(accentId);
    _userAccent = resolved;
    // Behind a profession tint, a new pick changes what gets restored rather
    // than what is on screen.
    if (_stashedAccent !== null) _stashedAccent = resolved;
    else applyAccent(resolved);
  },
```

- [ ] **Step 7: Update startup**

`renderer.js:648-651` currently does `if (savedTheme) setAttribute("data-theme", savedTheme)`. Replace with — note no `if`, because `resolveAccentId` turns every falsy value into the default:

```js
  // Apply the saved accent
  try {
    _userAccent = applyAccent(await window.desktopApi.getSetting("appearance.theme"));
  } catch {
    _userAccent = applyAccent(undefined); // first run
  }
```

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Check it by hand**

Launch the app. Open Settings → Appearance, pick an accent: the whole app crossfades. Open a build with themed build pages on: it tints to the profession. Go back: your accent returns. Pick the same accent as the build's profession, open that build, go back: your accent is still set and the app is not stuck on the tint.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/renderer.js tests/unit/renderer/accent-stash.test.js
git commit -m "refactor: drive the renderer accent through applyAccent

The stash, not a prof- prefix on the DOM attribute, now records that a
profession tint is showing - a profession's accent is an ordinary accent
id and could be the user's own pick, so the prefix test would strand the
app on the tint. Behaviour is otherwise identical."
```

---

### Task 6: Rebuild the Appearance picker

**Files:**
- Modify: `src/renderer/modules/settings-modal.js:28-37` (delete `THEMES`), `:355-395` (the grid)
- Modify: `src/renderer/styles/settings-modal.css` — **only** the `.settings-modal__theme-*` rules; the rest of the file is batch 4
- Test: `tests/unit/renderer/accent-picker.test.js`

**Interfaces:**
- Consumes: `ACCENTS`, `resolveAccentId`, `applyAccent` from Task 4; `onThemeChange` from Task 5.
- Produces: no new exports. The picker's card markup is `<button class="af-accent-card" data-accent="<id>">`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/accent-picker.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

// settings-modal.js pulls transitive deps at module scope; the repo's existing
// settings-modal tests (tests/unit/settingsModalNav.test.js) stub the same four,
// and this test follows that convention. The pragma must be the file's FIRST
// docblock or jest ignores it and the test runs under the node environment
// with no `document`.
jest.mock("../../../src/renderer/modules/state.js", () => ({ state: {} }));
jest.mock("../../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../../src/renderer/modules/utils.js", () => ({
  escapeHtml: (s) => String(s),
  delay: () => Promise.resolve(),
}));

const { ACCENTS } = require("../../../src/renderer/modules/accents.js");
const { renderAccentGrid } = require("../../../src/renderer/modules/settings-modal.js");

describe("renderAccentGrid", () => {
  let grid;
  beforeEach(() => {
    grid = document.createElement("div");
  });

  it("renders one card per package accent, in package order", () => {
    renderAccentGrid(grid, "axi-gold");
    const cards = grid.querySelectorAll(".af-accent-card");
    expect(cards).toHaveLength(ACCENTS.length);
    expect([...cards].map((c) => c.dataset.accent)).toEqual(ACCENTS.map((a) => a.id));
  });

  it("labels each card from the package", () => {
    renderAccentGrid(grid, "axi-gold");
    const labels = [...grid.querySelectorAll(".af-accent-card__label")].map((n) => n.textContent);
    expect(labels).toEqual(ACCENTS.map((a) => a.label));
  });

  it("marks exactly the active card", () => {
    renderAccentGrid(grid, "violet-purple");
    const active = grid.querySelectorAll(".af-accent-card--active");
    expect(active).toHaveLength(1);
    expect(active[0].dataset.accent).toBe("violet-purple");
  });

  it("marks the default card active for a legacy stored id", () => {
    renderAccentGrid(grid, "prof-mesmer");
    const active = grid.querySelector(".af-accent-card--active");
    expect(active.dataset.accent).toBe("violet-purple");
  });

  it("marks the default card active for an empty stored id", () => {
    renderAccentGrid(grid, "");
    expect(grid.querySelector(".af-accent-card--active").dataset.accent).toBe("axi-gold");
  });

  it("carries no Full/Accent type tag - the distinction no longer exists", () => {
    renderAccentGrid(grid, "axi-gold");
    expect(grid.textContent).not.toMatch(/\bFull\b/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/unit/renderer/accent-picker.test.js`
Expected: FAIL — `renderAccentGrid` is not exported.

- [ ] **Step 3: Delete the THEMES array**

Remove `src/renderer/modules/settings-modal.js:28-37` entirely.

- [ ] **Step 4: Write renderAccentGrid**

Add to `settings-modal.js`, exported so the test can reach it:

```js
import { ACCENTS, resolveAccentId } from "./accents.js";

/**
 * Renders the Appearance accent grid into `grid`, marking `storedId` active.
 * `storedId` may be a legacy theme id, so it is resolved before comparing.
 *
 * The swatch is the one place a colour literal legitimately reaches the DOM:
 * it comes from accents.json - the design language's sanctioned home for an
 * accent hex - and is set per-instance with a style attribute rather than
 * written into a stylesheet.
 */
export function renderAccentGrid(grid, storedId) {
  const active = resolveAccentId(storedId);
  grid.innerHTML = "";

  for (const accent of ACCENTS) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `af-accent-card${accent.id === active ? " af-accent-card--active" : ""}`;
    card.dataset.accent = accent.id;
    card.innerHTML = `
      <span class="af-accent-card__swatch" style="background:${accent.hex}"></span>
      <span class="af-accent-card__label">${escapeHtml(accent.label)}</span>
    `;
    grid.appendChild(card);
  }
}
```

- [ ] **Step 5: Re-point the grid's caller**

Replace the body of the function at `settings-modal.js:355-383` that built the old grid with:

```js
  const storedId = (await window.desktopApi.getSetting("appearance.theme")) || "";
  _paintAccentGrid(storedId);
```

And replace `_applyTheme` (`:385-395`) with these two — the paint/bind pair is
factored out because both the initial render and every click need it, and the
old code duplicated it:

```js
function _paintAccentGrid(storedId) {
  renderAccentGrid(_el.themeGrid, storedId);
  _el.themeGrid.querySelectorAll(".af-accent-card").forEach((card) => {
    card.addEventListener("click", () => _applyAccent(card.dataset.accent));
  });
}

async function _applyAccent(accentId) {
  await window.desktopApi.setSetting("appearance.theme", accentId);
  _callbacks.onThemeChange?.(accentId);
  _paintAccentGrid(accentId);
}
```

Note what moved: the picker no longer touches `data-theme` itself. It persists the choice and calls back; `renderer.js`'s `onThemeChange` (Task 5) owns applying it, which is what makes the stash-behind-a-tint case work.

- [ ] **Step 6: Style the cards**

In `src/renderer/styles/settings-modal.css`, delete every `.settings-modal__theme-card`, `__theme-swatch`, `__theme-swatches`, `__theme-label` and `__theme-tag` rule, and add to `src/renderer/styles/app.css`:

```css
/* --- accent picker (Settings > Appearance) --- */

.af-accent-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
  background: var(--axi-surface);
  color: var(--axi-text);
  border: var(--axi-border-control) solid var(--axi-ink-line);
  font: var(--axi-t-label);
  letter-spacing: var(--axi-ls-label);
  transition: transform .1s ease, box-shadow .1s ease;
}
.af-accent-card:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
}
/* Selection is an accent outline, not a glow and not a tinted fill (rule 2). */
.af-accent-card--active {
  outline: var(--axi-border-control) solid var(--axi-accent);
  outline-offset: 2px;
}
/* The swatch's background comes from accents.json via a style attribute. */
.af-accent-card__swatch {
  width: 18px;
  height: 18px;
  flex: none;
  border: var(--axi-border-hairline) solid var(--axi-ink-line);
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- tests/unit/renderer/accent-picker.test.js`
Expected: PASS, 6 assertions.

- [ ] **Step 8: Run the suite and the gate**

Run: `npm test`
Expected: PASS. `app.css` must still clear all eight scanners — the swatch hex is in JS, not CSS, which is why the gate stays green.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/modules/settings-modal.js src/renderer/styles/settings-modal.css \
        src/renderer/styles/app.css tests/unit/renderer/accent-picker.test.js
git commit -m "feat: rebuild the Appearance picker from accents.json

Eleven accents from the package replace the 17 hand-written themes, and
the Full/Accent tag goes with them. The picker persists and calls back
rather than setting data-axi-accent itself, so picking an accent behind a
profession tint updates what gets restored."
```

---

### Task 7: The publish boundary

**Files:**
- Modify: `src/main/index.js:62-66` (`PROFESSION_THEME_IDS`)
- Modify: `src/site/main.js:14-30` (`VALID_THEMES` → resolve)
- Modify: `src/renderer/modules/render-pages.js:623-629`
- Create: `src/main/accents.js` (CommonJS)
- Test: `tests/unit/main/publish-accent.test.js`, `tests/unit/site/accent-param.test.js`

**Interfaces:**
- Consumes: the map from Task 4.
- Produces: `src/main/accents.js` exporting `PROFESSION_ACCENTS` and `resolveAccentId` as CommonJS.

Why a second copy of the map: jest's `transform` config only runs babel over `src/renderer`, `src/site`, `src/web` and `packages/forge-render`. `src/main` is untransformed CommonJS and cannot `require` the ESM module from Task 4. So `src/main/accents.js` is a CommonJS module, and a test asserts the two agree — a drifting duplicate would silently publish links with the wrong accent.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/main/publish-accent.test.js`:

```js
"use strict";

const mainAccents = require("../../../src/main/accents.js");
const rendererAccents = require("../../../src/renderer/modules/accents.js");

describe("src/main/accents.js", () => {
  // The two copies exist because jest (and node, in the main process) cannot
  // load the renderer's ESM module from CommonJS. They must not drift: a
  // mismatch would publish share links carrying the wrong accent.
  it("agrees with the renderer's profession map", () => {
    expect(mainAccents.PROFESSION_ACCENTS).toEqual(rendererAccents.PROFESSION_ACCENTS);
  });

  it("agrees with the renderer's resolver on every legacy id", () => {
    const ids = [
      "", undefined, null, "nonsense",
      "molten-core", "cinderfall", "frostforge", "verdant-crucible",
      "copper", "cobalt", "mithril", "rose-gold",
      "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
      "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
      "prof-revenant",
      "axi-gold", "violet-purple",
    ];
    for (const id of ids) {
      expect(mainAccents.resolveAccentId(id)).toBe(rendererAccents.resolveAccentId(id));
    }
  });

  it("maps a profession to an accent id for the ?t= parameter", () => {
    expect(mainAccents.PROFESSION_ACCENTS.Guardian).toBe("electric-blue");
  });
});
```

Create `tests/unit/site/accent-param.test.js`:

```js
"use strict";

const { accentFromParams } = require("../../../src/site/accent.js");

describe("accentFromParams", () => {
  // Review Focus 1: these URLs are already posted to Discord and cannot be
  // rewritten. Every legacy ?t= value has to keep theming the page forever.
  it.each([
    ["prof-guardian", "electric-blue"],
    ["prof-necromancer", "teal-ocean"],
    ["prof-revenant", "crimson-red"],
    ["molten-core", "amber-warm"],
    ["mithril", "slate-silver"],
  ])("themes a legacy ?t=%s link as %s", (legacy, accent) => {
    expect(accentFromParams(new URLSearchParams(`?t=${legacy}`))).toBe(accent);
  });

  it("passes through a current accent id", () => {
    expect(accentFromParams(new URLSearchParams("?t=violet-purple"))).toBe("violet-purple");
  });

  it("returns null when there is no t parameter, leaving the page default", () => {
    expect(accentFromParams(new URLSearchParams("?b=abc.def"))).toBeNull();
  });

  it("returns null for a junk value rather than setting a bogus attribute", () => {
    expect(accentFromParams(new URLSearchParams("?t=%3Cscript%3E"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npm test -- tests/unit/main/publish-accent.test.js tests/unit/site/accent-param.test.js`
Expected: FAIL — neither module exists.

- [ ] **Step 3: Write the CommonJS map**

Create `src/main/accents.js`:

```js
"use strict";

// CommonJS mirror of src/renderer/modules/accents.js. The main process and the
// renderer cannot share one module - the renderer's is ESM and this one is
// required from CommonJS - so tests/unit/main/publish-accent.test.js asserts
// the two agree. Change one, change both.

const DEFAULT_ACCENT_ID = "axi-gold";

const PROFESSION_ACCENTS = {
  Guardian: "electric-blue",
  Warrior: "amber-warm",
  Necromancer: "teal-ocean",
  Engineer: "gold-bronze",
  Ranger: "emerald-mint",
  Thief: "rose-pink",
  Mesmer: "violet-purple",
  Elementalist: "crimson-red",
  Revenant: "crimson-red",
};

const ACCENT_IDS = new Set(require("@axiapps/axi-design/accents.json").map((a) => a.id));

const LEGACY_THEME_TO_ACCENT = {
  "": DEFAULT_ACCENT_ID,
  "molten-core": "amber-warm",
  cinderfall: "crimson-red",
  frostforge: "refined-cyan",
  "verdant-crucible": "emerald-mint",
  copper: "gold-bronze",
  "rose-gold": "rose-pink",
  cobalt: "electric-blue",
  mithril: "slate-silver",
  "prof-guardian": PROFESSION_ACCENTS.Guardian,
  "prof-warrior": PROFESSION_ACCENTS.Warrior,
  "prof-necromancer": PROFESSION_ACCENTS.Necromancer,
  "prof-engineer": PROFESSION_ACCENTS.Engineer,
  "prof-ranger": PROFESSION_ACCENTS.Ranger,
  "prof-thief": PROFESSION_ACCENTS.Thief,
  "prof-mesmer": PROFESSION_ACCENTS.Mesmer,
  "prof-elementalist": PROFESSION_ACCENTS.Elementalist,
  "prof-revenant": PROFESSION_ACCENTS.Revenant,
};

function resolveAccentId(id) {
  if (id && ACCENT_IDS.has(id)) return id;
  if (id === "" || id == null) return DEFAULT_ACCENT_ID;
  return LEGACY_THEME_TO_ACCENT[id] || DEFAULT_ACCENT_ID;
}

module.exports = { DEFAULT_ACCENT_ID, PROFESSION_ACCENTS, resolveAccentId };
```

- [ ] **Step 4: Re-point the main process**

In `src/main/index.js`, delete the `PROFESSION_THEME_IDS` literal at lines 62-66 and require the map instead:

```js
const { PROFESSION_ACCENTS: PROFESSION_THEME_IDS } = require("./accents");
```

Aliasing on import keeps the six call sites (`:1637`, `:1701`, `:1820`, and the URL builders at `:1217`, `:1640`, `:1840`, `:1897`) untouched, so this task cannot accidentally change which builds get a `?t=` at all — only the value it carries.

- [ ] **Step 5: Write the site's accent reader**

Create `src/site/accent.js`. The known-id set is explicit rather than relying
on `resolveAccentId`'s fallback, because the resolver cannot distinguish "a
legacy id that happens to map to the default" from "junk" — both come back as
`axi-gold`, and only the first should theme the page:

```js
import { ACCENTS, resolveAccentId } from "@renderer/modules/accents.js";

const KNOWN = new Set([
  ...ACCENTS.map((a) => a.id),
  "", "molten-core", "cinderfall", "frostforge", "verdant-crucible",
  "copper", "cobalt", "mithril", "rose-gold",
  "prof-guardian", "prof-warrior", "prof-necromancer", "prof-engineer",
  "prof-ranger", "prof-thief", "prof-mesmer", "prof-elementalist",
  "prof-revenant",
]);

/**
 * The accent a published page should use, or null to leave the page default.
 *
 * ?t= values are baked into share links already posted and cannot be
 * rewritten, so every legacy theme id resolves here forever. An unrecognised
 * value returns null rather than the default, so a junk parameter cannot put
 * a bogus attribute in the DOM.
 */
export function accentFromParams(params) {
  const raw = params.get("t");
  if (!raw || !KNOWN.has(raw)) return null;
  return resolveAccentId(raw);
}
```

- [ ] **Step 6: Use it in the site entry**

In `src/site/main.js`, delete the `VALID_THEMES` set (lines 14-19) and replace the theme block in `init()` with:

```js
  const accent = accentFromParams(params);
  if (accent) document.documentElement.setAttribute("data-axi-accent", accent);
```

Add the import: `import { accentFromParams } from "./accent.js";`

- [ ] **Step 7: Re-point the renderer's URL builder**

`src/renderer/modules/render-pages.js:623-629` reads `document.documentElement.getAttribute("data-theme")` to build the `?t=`. Change it to read `data-axi-accent`. The `theme ? ...` guard stays, so a page with no accent set still gets no parameter.

- [ ] **Step 8: Run the tests**

Run: `npm test -- tests/unit/main tests/unit/site`
Expected: PASS.

- [ ] **Step 9: Check for other data-theme readers**

```bash
grep -rn 'data-theme' src tests --include=*.js --include=*.html | grep -v node_modules
```

Expected: zero hits. Any remaining one is a reader that would silently stop working; re-point it to `data-axi-accent`.

- [ ] **Step 10: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/main/accents.js src/main/index.js src/site/accent.js src/site/main.js \
        src/renderer/modules/render-pages.js tests/unit/main/publish-accent.test.js \
        tests/unit/site/accent-param.test.js
git commit -m "feat: publish and read accent ids across the publish boundary

Share URLs carry the theme id in ?t= and are immutable once posted, so
the published SPA resolves every legacy id forever and returns null - not
the default - for anything it does not recognise. src/main/accents.js is
a CommonJS mirror of the renderer's map because the main process cannot
require ESM; a test asserts the two never drift."
```

---

### Task 8: Convert layout.css — titlebar, workspace menu, nav, pages

**Files:**
- Rewrite: `src/renderer/styles/layout.css` (649 lines)
- Modify: `src/renderer/index.html:16-58` (titlebar markup onto package classes)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (drop `layout.css` from `PENDING`)

**Interfaces:**
- Consumes: `app.css`'s `--af-titlebar-h`, `.af-dot`, `.af-work`, the z-index scale.
- Produces: the converted chrome every later batch sits inside. No new exports.

This file holds 11 of the app's `color-mix` uses and its one `backdrop-filter`. Recipe, applied rule by rule:

| Current | Becomes |
|---|---|
| `border-bottom: 1px solid var(--line-soft)` | `border-bottom: var(--axi-border-panel) solid var(--axi-ink-line)` |
| `background: var(--surface); backdrop-filter: blur(8px)` | `background: var(--axi-surface)`; the blur is deleted |
| `font-family: "Cinzel", serif; font-size: .84rem; letter-spacing: .06em` | `font: var(--axi-t-label); letter-spacing: var(--axi-ls-label)` |
| `.titlebar__brand-accent { color: var(--accent) }` | `color: var(--axi-accent)` |
| `.titlebar__beta-badge` / `__dev-badge` — `color: color-mix(…gold 75%, transparent)`, `border: 1px solid currentColor`, `border-radius: 3px` | `.axi-chip` with the titlebar slimming from AxiAM (`padding: 1px 7px; gap: 5px`) |
| `.titlebar__pill` — `border: 1px solid color-mix(…accent 35%…)`, `background: color-mix(…accent 12%…)` | `.axi-chip--accent`; the muted variant is `.axi-chip`, the error variant `.axi-chip--danger` |
| `.titlebar__pill-spinner` — `border-radius: 50%` + a `rotate` keyframe | `.af-work` on an `.af-dot` — an opacity blink, which is rule 11's compositor-only requirement and also survives the main thread blocking during a publish |
| `.workspace-menu` — `background: var(--panel-gradient)`, `border-radius`, `box-shadow: var(--shadow-md)` | `background: var(--axi-surface-raised)`, `border: var(--axi-border-panel) solid var(--axi-ink-line)`, `box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line)` |
| `.leftnav__item:hover { background: var(--hover-accent) }` | hover lift: `transform: translate(-2px,-2px)` + gain `--axi-offset-control` block; colour goes `--axi-text-dim` → `--axi-text` |
| `.leftnav__item--active` | `color: var(--axi-accent); border-color: var(--axi-accent)` (AxiAM's `.am-rail-btn--active`) |
| `.subnav__item--active` | the package's `.axi-tabs` active treatment |
| `transform: scale(1.02)` on hover | `translate(-2px, -2px)` — a scale on a text-bearing layer is rule 11's forbidden case |

- [ ] **Step 1: Take the before picture**

Launch the app, screenshot the titlebar, left nav and subnav. This is a reskin: the after must place the same elements in the same order with the same labels.

- [ ] **Step 2: Rewrite the file**

Work top to bottom through `layout.css`, converting each rule per the table and deleting anything the package now provides. Keep every selector name that JS or markup references — check before deleting any class:

```bash
grep -rn "leftnav__\|subnav__\|titlebar__\|workspace-menu" src/renderer --include=*.js --include=*.html | wc -l
```

- [ ] **Step 3: Move the titlebar onto package classes**

In `src/renderer/index.html`, the `<header id="titlebar" class="titlebar app-drag">` becomes `class="axi-titlebar app-drag"`, and the badge/pill spans take `.axi-chip` variants:

```html
<span class="titlebar__beta-badge axi-chip">beta</span>
<span id="updateStatusPill" class="titlebar__pill axi-chip axi-chip--accent hidden no-drag">
  <span class="titlebar__pill-spinner af-dot af-dot--idle af-work" aria-hidden="true"></span>
  <span id="updateStatusPillText" class="titlebar__pill-text"></span>
</span>
```

Keep every `id` exactly as it is — `renderer.js` queries all of them.

- [ ] **Step 4: Add the frameless window inset**

The app is a frameless Electron window, so there is nothing behind it for a block to fall onto. Add to `app.css` (AxiAM's pattern):

```css
/* A frameless window has nothing behind it for a block to fall onto, so the
   window's offset block is drawn inward. */
.axi-window {
  box-shadow: inset calc(-1 * var(--axi-offset-panel)) calc(-1 * var(--axi-offset-panel)) 0 0 var(--axi-ink-line);
}
```

Note for the gate: this is the one `box-shadow` with `calc()` in it. `findBadShadows` accepts it — there is no length literal and `var(--axi-ink-line)` is present.

- [ ] **Step 5: Drop layout.css from PENDING**

In `tests/unit/styles/axi-design-rules.test.js`, delete the `"src/renderer/styles/layout.css"` line from `PENDING`.

- [ ] **Step 6: Run the gate**

Run: `npm test -- tests/unit/styles/axi-design-rules.test.js`
Expected: PASS. If a scanner fires, it names the declaration; fix it rather than adding an exception.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Compare against the before picture**

Launch. Every element from Step 1 is present, in order, with the same text. The titlebar is a flat outlined strip, the nav items lift on hover, the active nav item carries an accent edge, the update pill is a chip whose dot blinks.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/styles/layout.css src/renderer/styles/app.css \
        src/renderer/index.html tests/unit/styles/axi-design-rules.test.js
git commit -m "style: convert the app chrome to the axi design language

Titlebar, workspace menu, left nav, subnav and page frame. Removes the
titlebar's backdrop blur and all 11 color-mix partial-opacity inks;
the update spinner becomes an opacity blink on a status dot, which keeps
reporting during the main-thread work it reports on."
```

---

### Task 9: Convert the buttons

**Files:**
- Delete: the `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-dev` rules at `src/renderer/styles/cards.css:18-75`
- Rewrite: `src/renderer/styles/buttons.css` (138 lines — workspace menu items and the legacy `.btn-danger`)
- Modify: 49 markup sites across `src/renderer/**/*.html` and `**/*.js`
- Modify: `tests/unit/styles/axi-design-rules.test.js` (drop `buttons.css` from `PENDING`)
- Test: `tests/unit/styles/no-legacy-btn.test.js`

**Interfaces:**
- Consumes: the package's `.axi-btn`, `.axi-btn--primary`, `.axi-btn--ghost`.
- Produces: `.af-menu-item` for workspace-menu rows (AxiAM's `.am-menu-item`).

`cards.css` stays in `PENDING` after this task — only its button rules leave. That is fine: the gate is per-file, and batch 2 clears the rest of it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/styles/no-legacy-btn.test.js`:

```js
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

/** Every renderer file that could carry a class attribute. */
function sources(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(rel, acc);
    else if (/\.(js|html)$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

describe("legacy button classes", () => {
  const files = sources("src/renderer").filter((f) => !f.endsWith("index.generated.html"));

  it("are gone from every renderer source", () => {
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      // A class attribute containing btn / btn-primary / btn-secondary as a
      // whole word. .axi-btn and af-btn-ish names must not match.
      for (const m of src.matchAll(/class\s*=\s*["'`]([^"'`]*)["'`]/g)) {
        const classes = m[1].split(/\s+/);
        if (classes.some((c) => /^btn(-primary|-secondary|-danger|-dev)?$/.test(c))) {
          offenders.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("are gone from the stylesheets", () => {
    const css = fs.readFileSync(path.join(ROOT, "src/renderer/styles/cards.css"), "utf8");
    expect(css).not.toMatch(/^\.btn(-[a-z]+)?\s*[,{:]/m);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/unit/styles/no-legacy-btn.test.js`
Expected: FAIL, listing ~49 offenders. That list is the task's worklist.

- [ ] **Step 3: Migrate the markup**

For each offender, translate the class list — and nothing else on the element:

- `class="btn"` → `class="axi-btn"`
- `class="btn btn-primary"` → `class="axi-btn axi-btn--primary"`
- `class="btn btn-secondary"` → `class="axi-btn axi-btn--ghost"`
- `class="btn btn-danger"` → `class="axi-btn af-btn--danger"`

Keep every other class, `id`, `type` and attribute untouched — several of these buttons are found by `id` or by a co-occurring class.

- [ ] **Step 4: Delete the old rules**

Remove `src/renderer/styles/cards.css:18-75` (the `.btn*` block) and the legacy `.btn-danger` at `buttons.css:129-139`.

- [ ] **Step 5: Add the danger variant and the menu items**

To `app.css`:

```css
/* Danger is a status, so it is a solid fill, not a tinted outline (rule 5). */
.af-btn--danger {
  background: var(--axi-danger);
  color: var(--axi-accent-ink);
}

/* --- workspace menu rows --- */

.af-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  color: var(--axi-text-dim);
  cursor: pointer;
  text-align: left;
  font: var(--axi-t-small);
}
/* The menu's own ground is --axi-surface-raised, so hover has to step DOWN to
   the ground to be visible (the package's .axi-menu__pop pattern). */
.af-menu-item:hover { background: var(--axi-ground); color: var(--axi-text); }
.af-menu-item--danger { color: var(--axi-danger); }
.af-menu-item--danger:hover { background: var(--axi-danger); color: var(--axi-accent-ink); }
.af-menu-item--primary { color: var(--axi-accent); }
.af-menu-item--primary:hover { background: var(--axi-accent); color: var(--axi-accent-ink); }
.af-menu-item:disabled { color: var(--axi-text-faint); cursor: default; }
.af-menu-sep { height: var(--axi-border-hairline); background: var(--axi-rule); margin: 4px 8px; }
```

Rename the `.ws-menu-item*` / `.ws-menu-sep` classes in `buttons.css` and their markup sites to these. Confirm the sites first:

```bash
grep -rn "ws-menu-item\|ws-menu-sep" src/renderer --include=*.js --include=*.html
```

- [ ] **Step 6: Drop buttons.css from PENDING**

Delete the `"src/renderer/styles/buttons.css"` line from `PENDING`.

- [ ] **Step 7: Run the tests**

Run: `npm test -- tests/unit/styles/`
Expected: PASS — both the legacy-button test and the gate.

- [ ] **Step 8: Run the suite**

Run: `npm test`
Expected: PASS. Several DOM tests assert on button classes; update the assertions to the `axi-btn` names, changing no behaviour.

- [ ] **Step 9: Click every button you changed**

Launch and exercise the workspace menu, the save button, the subnav overflow items and one destructive action's confirm. A missed class rename shows up as an unstyled button, a missed `id` as a dead one.

- [ ] **Step 10: Commit**

```bash
git add -A src/renderer tests/unit/styles
git commit -m "style: move buttons onto .axi-btn

Replaces .btn/.btn-primary/.btn-secondary across 49 markup sites and
deletes their rules, which lived in cards.css rather than buttons.css.
Danger becomes a solid fill rather than a 15%-opacity tint, and the
workspace menu rows become .af-menu-item."
```

---

### Task 10: Convert forms.css and custom-select.css

**Files:**
- Rewrite: `src/renderer/styles/forms.css` (136 lines), `src/renderer/styles/custom-select.css` (297 lines)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (drop both from `PENDING`)

**Interfaces:**
- Consumes: the package's `.axi-input`, `.axi-select`, `.axi-panel`, `.axi-search`.
- Produces: `.panel` restyled in place (it has too many markup sites to rename in a reskin), composing the package's panel form.

Recipe:

| Current | Becomes |
|---|---|
| `.panel { border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel-gradient) }` | `border: var(--axi-border-panel) solid var(--axi-ink-line); background: var(--axi-surface); box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line)` |
| `.panel h1 { font-family: "Outfit"; font-size: 1.05rem }` | `font: var(--axi-t-h3); letter-spacing: var(--axi-ls-h3)` |
| `.panel h2` | `font: var(--axi-t-label); letter-spacing: var(--axi-ls-label)` |
| `.panel p { color: var(--muted); font-size: .86rem }` | `color: var(--axi-text-dim); font: var(--axi-t-small)` |
| `.panel input/select/textarea { border: 1px solid var(--input-border); border-radius: 10px; background: var(--input-bg) }` | `border: var(--axi-border-control) solid var(--axi-ink-line); background: var(--axi-ground); color: var(--axi-text)` |
| `:focus { box-shadow: 0 0 0 3px var(--focus-ring) }` | `outline: var(--axi-border-control) solid var(--axi-accent); outline-offset: 2px` |
| the custom select's caret | the package's two-`linear-gradient` triangle — rule 1's sanctioned exception, since it draws a *shape* with no soft transition. Copy it from the package rather than re-inventing; if you write your own, the gradient scanner will fire and it will be right to. |
| dropdown `box-shadow: var(--shadow-md)` | `var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line)` |

Note on the caret: `findGradients` has no exception, so a caret drawn in app CSS fails the gate. Use the package's `.axi-select` and let it draw the caret; that is the point of the component.

- [ ] **Step 1: Convert forms.css**

Apply the table, rule by rule, deleting anything the package supplies.

- [ ] **Step 2: Convert custom-select.css**

The custom select is a JS widget with its own markup (`custom-select.js`). Keep every class name it queries:

```bash
grep -o 'class="[^"]*"' src/renderer/modules/custom-select.js | sort -u
```

Restyle those classes to compose `.axi-select`'s look: flat ground, control-weight ink outline, no radius, and a dropdown that is a hard-blocked `--axi-surface-raised` panel.

- [ ] **Step 3: Drop both from PENDING**

Delete the `forms.css` and `custom-select.css` lines from `PENDING`.

- [ ] **Step 4: Run the gate**

Run: `npm test -- tests/unit/styles/axi-design-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Exercise every input type**

Launch. In the editor: type in a text input, focus and blur it (the focus ring is an accent outline, not a glow), open a custom select and pick with the mouse and with the keyboard, resize a textarea. Keyboard selection is the one most likely to break, because the dropdown's active-option style changes.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles/forms.css src/renderer/styles/custom-select.css \
        tests/unit/styles/axi-design-rules.test.js
git commit -m "style: convert panels, inputs and the custom select

Focus becomes an accent outline rather than a 3px translucent ring, and
the select's caret comes from the package's .axi-select instead of being
drawn locally - a locally drawn one would fail the gradient gate, and
correctly so."
```

---

### Task 11: Close the batch

**Files:**
- Modify: `docs/BACKLOG.md`
- Modify: `tests/unit/styles/axi-design-rules.test.js` (verify `PENDING` shrank by exactly four)

- [ ] **Step 1: Verify the batch's claim**

`PENDING` must no longer contain `layout.css`, `buttons.css`, `forms.css` or `custom-select.css`, and must still contain all 25 batch 2-5 files.

```bash
node -e "
const src = require('fs').readFileSync('tests/unit/styles/axi-design-rules.test.js','utf8');
const pending = src.match(/const PENDING = \[([\s\S]*?)\];/)[1]
  .split('\n').map(l=>l.trim()).filter(l=>l.startsWith('\"'));
console.log('pending:', pending.length);
for (const f of ['layout','buttons','forms','custom-select'])
  if (pending.some(p=>p.includes(f+'.css'))) throw new Error('still pending: '+f);
console.log('batch 1 files all converted');
"
```

Expected: `pending: 25`, then the success line.

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS, no skips.

- [ ] **Step 3: Confirm the bridge is still load-bearing**

Comment out the `@import "./styles/bridge.css"` line and launch. Expected: batch 2-5 screens break, batch 1 chrome does **not**. If any converted chrome breaks, it still reads a legacy variable and the gate's `findLegacyVars` missed it — find it and fix it. Restore the import.

- [ ] **Step 4: Verify the build**

Run: `npx vite build` and `npx vite build --config src/site/vite.config.js`
Expected: both succeed. A bare specifier that resolves under jest can still fail a Vite build, and this is the cheapest place to find out.

- [ ] **Step 5: Record what this batch changed for other repos**

Append to `docs/BACKLOG.md`:

```markdown
## axi-design conversion — follow-ups

- Convert AxiVale and AxiBridge to axi-design. They embed
  `packages/forge-render`, whose conversion in batch 5 changes the *form* of
  their embedded cards (square corners, ink outlines, hard blocks) while
  leaving their palette intact via `var(--axi-…, #literal)` fallbacks.
- Users lost the per-theme backgrounds of the 8 full themes (Molten Core,
  Frostforge, …). The design language has one ground; those themes are accents
  now. Raised deliberately in the conversion spec, not a regression.
```

- [ ] **Step 6: Render the batch for review**

Show the converted titlebar, left nav, subnav, a panel with inputs, the button set and the accent picker. Get approval before batch 2 starts.

- [ ] **Step 7: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "docs: record the axi-design conversion's cross-repo follow-ups"
```

---

## Not in this plan

Batches 2-5 get their own plans, each written against the same spec when its predecessor is approved:

- **Batch 2** — `library.css` (2,321), `comps.css` (2,805), `cards.css`, `build-sources.css`, `skeleton.css`
- **Batch 3** — `specializations.css`, `skills.css`, `equipment.css`, `notes.css`, `detail-panel.css`
- **Batch 4** — the ten modal sheets
- **Batch 5** — `forge-render.css`, `web.css` + `web-mobile.css`, `site/styles.css` + `site-mobile.css`, **delete `bridge.css`**, regenerate marketing screenshots, run the Playwright suites

Each ends with its files gone from `PENDING`; batch 5 ends with `PENDING` empty and `bridge.css` deleted, which is the conversion's completion criterion.
