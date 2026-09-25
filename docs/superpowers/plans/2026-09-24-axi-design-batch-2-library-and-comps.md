# AxiForge → axi-design, Batch 2: Library and Comps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the library and comps screens to the axi design language, and discharge §3.1's positive obligation by putting the expressive primitives — card, strip, stat, diamond, meter, ticks, table, pill, picker — on the screens that have been printing bare numerals and tinted pills.

**Architecture:** Five stylesheets and two injected stylesheets are rewritten in place, not layered on. The nine-profession palette — today copied into six files — collapses into one data module, `src/shared/professions.js`, and reaches CSS only through the per-instance `--axi-series` / `--axi-card-strip` knobs, which is rule 10's sanctioned route for real colour. The batch ends with `library.css`, `comps.css`, `cards.css`, `build-sources.css` and `skeleton.css` dropped from the gate's `PENDING` list and `PENDING_JS` emptied.

**Tech Stack:** `@axiapps/axi-design` (bumped to `^1.10.0`), plain ES modules, Electron + Vite, jest 30.

**Spec:** `docs/superpowers/specs/2026-09-23-axi-design-conversion-design.md` — read §3, §3.1 and the Batch 2 entry in §8 before Task 1. §3.1 is the section this batch exists to satisfy.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **No colour literals in app CSS.** No hex, `rgb()`, `hsl()`, `rgba()`, or bare named colour, in a declaration or behind a custom property, in any file under `src/renderer/styles/`, `src/web/`, `src/site/`, `packages/forge-render/src/`, or in any CSS string injected from a renderer JS module. `tests/unit/styles/axi-design-rules.test.js` is the gate; run it after every task.
2. **No `border-radius`, no `box-shadow` with a blur radius, no gradient on a surface, no colour at partial opacity over the ground.** Corners are square (`--axi-radius: 0`). Shadows are hard offset blocks: `box-shadow: <n>px <n>px 0 var(--axi-ink-line)`.
3. **Two form steps only.** Panel = `--axi-border-panel` (4px) + `--axi-offset-panel` (6px). Control = `--axi-border-control` (3px) + `--axi-offset-control` (3px). `--axi-border-hairline` (2px) is a rule weight for lines inside running content, not a third step.
4. **Hover lift has exactly three cases.** A control with no resting block gains one: `transform: translate(-2px, -2px)` + `box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line)`. A panel resting on 6px grows: `translate(-3px, -3px)` + `--axi-offset-panel-hover`. A control *already resting on a block* keeps `translate(-2px, -2px)` and deepens to `--axi-offset-control-hover`. Never opacity, never a glow, never a recoloured outline.
5. **Status fills; annotation outlines.** A status caps the thing it judges — a short bar across the head — never a full-height left stripe. Five cards in a row with coloured left edges are five coloured frames, and the colour stops saying anything.
6. **The profession palette lives in exactly one file: `src/shared/professions.js`.** It is the only place in the repo where a profession hex may appear after Task 2. CSS never names a profession; markup sets `style="--axi-series: …"` or `style="--axi-card-strip: …"` from that module.
7. **Per-instance knobs** (`--axi-series`, `--axi-card-strip`, `--axi-pill-fill`, `--axi-meter-v`, `--axi-tick-w`, `--axi-grid-min`) are set with a `style=""` attribute on one element, never in `:root`. Using them is not a rule-3 violation; it is how the language carries data.
8. **Typography is `font: var(--axi-t-*)` plus `letter-spacing: var(--axi-ls-*)`.** Never a bare `font-size` + `font-weight` pair where a `--axi-t-*` token fits.
9. **App-specific shapes take the `af-` prefix.** Package classes are used as shipped; a shape the package does not have becomes `.af-something`. Existing `lib-`, `comp-`, `src-`, `skel-` prefixes stay where the class survives — renaming them is churn this batch does not buy.
10. **This is a reskin, not a refactor.** Behaviour, event wiring, data flow and DOM structure stay identical except where a task explicitly changes markup to reach a package class. No logic changes, no new features, no "while I'm here".
11. **`PENDING_JS` must be emptied in the same commit that drops `library.css` from `PENDING`.** Otherwise the gate goes green while `library/history-panel.js` and `library/history-compare.js` still inject gradients and hex literals. Task 7 owns this and must land before Task 12.
12. **Delete as you go.** The old rule is removed in the same edit that adds its replacement. A converted file must not contain a dead `--line-soft` / `--panel-2` / `--radius-sm` rule left "just in case".

---

## Review Focus

Five things the spec implies that no task's own tests would otherwise exercise. Each line's test is pinned to the task that owns the code.

1. **A build with no profession, or an unrecognised one.** `profClass()` returns `""` today and the card renders uncoloured. After Task 2 the strip colour comes from a lookup; an unknown key must yield the neutral fallback, not `undefined` interpolated into a `style` attribute as `--axi-card-strip: undefined`. *Test in Task 2.*
2. **A profession name with unexpected casing or whitespace.** Builds imported from gw2skills have arrived with `"Elementalist "` and `"elementalist"`. The single lookup must normalise, because six divergent copies previously each normalised differently. *Test in Task 2.*
3. **A meter whose value is 0%, >100%, or `NaN`.** Boon coverage is computed from a cache and rendered into `--axi-meter-v`. A `NaN` reaching the style attribute silently renders a full-width bar in some engines. *Test in Task 10.*
4. **A ticks run of length 0 and of length 40.** `.axi-ticks` marks are a fixed width and never flex, so a long run overflows its cell rather than compressing. The consumer must cap the run and say so, not let it push a table column open. *Test in Task 10.*
5. **A downgrade of `@axiapps/axi-design` below 1.10.0.** `.axi-ticks` and `.axi-picker` do not exist in 1.8.0. A `npm install` that resolves lower would make several tasks' markup render as unstyled divs with no test failing. *Test in Task 1.*

---

## File Structure

**Created:**
- `src/shared/professions.js` — the nine-profession palette and its lookup helpers. The single source of truth named by Global Constraint 6. Lives in `src/shared/` (beside `publishState.js`) because batch 5 needs the same table in `src/site/render-comp.js` and `packages/forge-render/`.
- `tests/unit/shared/professions.test.js` — normalisation, fallback, and a guard that no other file in the repo carries a profession hex.

**Modified (stylesheets, converted and dropped from `PENDING`):**
- `src/renderer/styles/library.css` (2,321 lines) — Tasks 3, 4, 5, 6
- `src/renderer/styles/comps.css` (2,805) — Tasks 10, 11
- `src/renderer/styles/cards.css` (482) — Task 8
- `src/renderer/styles/build-sources.css` (393) — Task 8
- `src/renderer/styles/skeleton.css` (488) — Task 12

**Modified (markup and injected CSS):**
- `src/renderer/modules/library/content.js` — list, grid, icon and table view templates (Tasks 4, 5)
- `src/renderer/modules/library/history-panel.js`, `history-compare.js` — injected stylesheets, `PENDING_JS` (Task 7)
- `src/renderer/modules/library/sidebar.js`, `toolbar.js` — nav tints, filter dropdowns (Tasks 3, 6)
- `src/renderer/modules/comps/comp-list.js`, `comp-detail.js` — `PROF_COLORS` deleted, rows and slots (Tasks 2, 10, 11)
- `src/renderer/modules/render-pages.js` — the home page's build cards and header stats (Task 9)
- `src/renderer/renderer.js` — `PROF_COLORS` deleted (Task 2)

**Modified (gate):**
- `tests/unit/styles/axi-design-rules.test.js` — `PENDING` shrinks by five files, `PENDING_JS` empties (Tasks 1, 6, 7, 8, 11, 12)
- `package.json` — `@axiapps/axi-design` bumped to `^1.10.0` (Task 1)

---

## Rulings made while writing this plan

Recorded here so no implementer has to re-derive them, and so a reviewer can reject them on the record.

**Ruling A — the installed package is a version behind, and batch 2 needs the newer one.**
`package.json` pins `^1.8.0` and `node_modules` has 1.8.0; upstream `../axi-design` is at 1.10.0. `.axi-ticks` — named in spec §3.1 as one of batch 2's obligations — **does not exist in 1.8.0**. Neither does `.axi-picker`. The 1.8.0→1.10.0 diff is purely additive across `base.css`, `data.css` and `primitives.css`: `.axi-ticks` is new, `.axi-picker*` is new, and `.axi-select`'s existing block gains `.axi-picker__btn` as a second selector without changing a single declaration. Nothing is renamed and nothing is removed, so the bump cannot regress batch 1's converted files. Task 1 does the bump and pins a test against it. *Cost if wrong:* a version bump to revert, and Tasks 3 and 10 lose two classes they were written against.

**Ruling B — `.axi-picker` is adopted only where batch 2 already owns the file.**
1.10.0 added `.axi-picker` precisely for the case AxiForge is in: Electron on a Chromium without `appearance: base-select`, where the native `<select>` popup is a raised list the language cannot reach — no ink outline, no offset block, the OS's own selection colour. `src/renderer/styles/custom-select.css` was converted in batch 1 against 1.8.0 and has this defect today. It is **out of batch 2's file scope**; Task 12 parks it in `docs/BACKLOG.md` as batch 4 work, since batch 4 owns the modals where most selects live. Batch 2's *own* dropdowns — the library sort, filter and import dropdowns at `library.css:167-460` — are in scope, and Task 3 converts them to `.axi-picker`. *Cost if wrong:* the app has two dropdown treatments until batch 4, which is visible but not broken.

**Ruling C — the spec's "the library's build rows end in a verb" is wrong about the file it names, and right about a different one.**
Spec §8 says the library's build rows end in a verb and are therefore a stack of control-weight cards. Reading the markup: `.lib-list-row` (`content.js`, list view) is icon + title + pills + date + pin star — no verb, and the eye runs straight down the date column. By rule 8's own test that is **a table drawn in rules**, not a stack of cards. The template that actually ends in a verb is `.build-card` in `render-pages.js:228-238`, whose every row carries Load and Delete buttons. So:
- **List view and table view → rules.** `.axi-table`'s treatment: no outline, no block, hairline row rules, control-weight header rule. Task 4.
- **Grid view → cards at panel weight with the profession strip capping the head.** Task 5.
- **The template that does end in a verb → cards at control weight**, the anatomy approved against the live render.
This is a correction to the spec's argument, not to its conclusion: the approved anatomy is unchanged, it just attaches to the right templates. **Amended by Ruling F**, below: that verb-ending template turned out to be dead code, so the control-weight card lands in the comps build pool instead, where the condition that produced the weight — something raised inside a panel that already carries a block — is actually true. *Cost if wrong:* the list view reads as a table when the user wanted cards — a reversible CSS change, and the grid view already offers the card reading.

**Ruling D — `skeleton.css` converts its colours now and re-fits its geometry in batch 3.**
Two thirds of `skeleton.css` is placeholder shapes that mirror `specializations.css`, `skills.css`, `equipment.css` and `detail-panel.css` — all batch 3. The gate is file-granular, so dropping `skeleton.css` from `PENDING` requires the whole file to be literal-free, which is achievable independently of batch 3: a skeleton block is a grey rectangle, and its colour and corner are batch 2's business whatever its neighbour looks like. Its *dimensions* are not: they are comments-as-contract (`/* matches .spec-card__panel */`) against geometry batch 3 will change. Task 12 converts colour, radius, shadow and animation and leaves every width/height/padding exactly as found, and adds a note at the head of the file telling batch 3 to re-fit them. *Cost if wrong:* skeletons are mis-sized against the real screens for the length of batch 3, during a loading flash.

**Ruling E — the profession palette is data and lives in JS, not CSS.**
Rule 10 says domain data owns its own palette and arrives per-instance through `--axi-series`. A table of nine hex values is data; putting it in a stylesheet as `--af-prof-guardian: #6ea8ff` would be a colour literal in app CSS (Global Constraint 1) *and* would put it on the token surface, which Global Constraint 7 forbids. It goes in `src/shared/professions.js` and reaches the DOM through a `style` attribute. This also collapses six copies into one — `library.css:859-868`, `library.css:1720-1731`, `library.css:1735-1745`, `comps.css:1266-1276`, `comp-list.js:40`, `renderer.js:1251` — with two more (`src/site/styles.css`, `packages/forge-render/src/forge-render.css`) waiting for batch 5. *Cost if wrong:* a lookup call per rendered row instead of a CSS class, which is not a measurable cost at the list sizes this app renders.

---

### Task 1: Bump the package to 1.10.0 and pin the floor

The batch is written against classes that do not exist in the installed
version. This task makes them exist and makes a future downgrade fail loudly
instead of silently rendering unstyled divs (Review Focus 5).

**Files:**
- Modify: `package.json` (the `@axiapps/axi-design` dependency line)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (add one describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `.axi-ticks`, `.axi-ticks__tick`, `.axi-ticks__tick--on`, `.axi-picker`, `.axi-picker__btn`, `.axi-picker__pop`, `.axi-picker__pop--fixed`, `.axi-picker__opt` available to every later task. Knobs: `--axi-ticks-gap` (default 3px), `--axi-tick-h` (15px), `--axi-tick-w` (5px).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/styles/axi-design-rules.test.js`, at the end of the file:

```js
describe("the installed axi-design ships the primitives this app uses", () => {
  // Batch 2 is written against 1.10.0. In 1.8.0 `.axi-ticks` and `.axi-picker`
  // do not exist, and markup that reaches for them renders as unstyled divs
  // with nothing failing. This pins the floor where a human will see it.
  const pkgCss = fs.readFileSync(
    require.resolve("@axiapps/axi-design/dist/axi.css"),
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx jest tests/unit/styles/axi-design-rules.test.js -t "installed axi-design ships"`
Expected: FAIL — `.axi-ticks`, `.axi-ticks__tick--on`, `.axi-picker__btn`, `.axi-picker__pop` and `.axi-picker__opt` are all absent from 1.8.0's bundle.

- [ ] **Step 3: Bump the dependency**

In `package.json`, change the `@axiapps/axi-design` entry from `"^1.8.0"` to `"^1.10.0"`, then:

```bash
npm install @axiapps/axi-design@^1.10.0
node -p "require('@axiapps/axi-design/package.json').version"
```

Expected: prints `1.10.0` or higher.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/styles/axi-design-rules.test.js`
Expected: PASS, all describe blocks, including every pre-existing scanner.

- [ ] **Step 5: Confirm the bump did not regress batch 1**

The 1.8.0→1.10.0 diff is additive (Ruling A), so this should be clean. Prove it rather than assume it:

```bash
npx jest tests/unit/styles/
```

Expected: PASS. If `import-order.test.js` or any batch-1 assertion fails, STOP and report — the bump is not as additive as the ruling claims.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/unit/styles/axi-design-rules.test.js
git commit -m "build: raise axi-design to 1.10.0 for ticks and picker

Batch 2 is written against .axi-ticks and .axi-picker, neither of which
exists in 1.8.0. The gate now names the primitives the app depends on, so
a resolution below the floor fails a test instead of quietly rendering
unstyled divs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: One profession palette

Six copies of the same nine hex values, each normalising its input
differently, each drifting independently. They collapse into one module whose
output reaches CSS only as a per-instance knob (Ruling E). This is the task
rule 10 rests on: after it, real colour has exactly one way into the app.

**Files:**
- Create: `src/shared/professions.js`
- Create: `tests/unit/shared/professions.test.js`
- Modify: `src/renderer/renderer.js:1251-1255` (delete `PROF_COLORS`, import instead)
- Modify: `src/renderer/modules/comps/comp-list.js:40-45` (delete `PROF_COLORS`, import instead)

**Interfaces:**
- Consumes: nothing.
- Produces, for Tasks 4, 5, 7, 9, 10 and 11:
  - `professionColour(name: string | null | undefined): string` — the full-strength hex, or the neutral fallback for an unknown, empty or missing profession. Never returns `undefined`.
  - `professionSeriesStyle(name): string` — `'--axi-series: #6ea8ff'` or `''`, ready to drop into a `style="…"` attribute. Returns `''` (not a declaration naming the fallback) when the profession is unknown, so an unknown build inherits the accent rather than being painted grey on purpose.
  - `professionStripStyle(name): string` — the same for `--axi-card-strip`.
  - `PROFESSIONS: readonly string[]` — the nine canonical names, title-cased, in the game's own order.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/shared/professions.test.js`:

```js
import fs from "node:fs";
import path from "node:path";
import {
  PROFESSIONS,
  professionColour,
  professionSeriesStyle,
  professionStripStyle,
} from "../../../src/shared/professions.js";

const ROOT = path.resolve(__dirname, "../../..");

describe("professionColour", () => {
  it("returns the full-strength colour for each of the nine", () => {
    expect(PROFESSIONS).toHaveLength(9);
    for (const p of PROFESSIONS) {
      expect(professionColour(p)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    // Builds imported from gw2skills have arrived as "Elementalist " and as
    // "elementalist". Six divergent copies each normalised differently; this
    // is the one place that decides.
    const want = professionColour("Elementalist");
    for (const v of ["elementalist", "ELEMENTALIST", "  Elementalist  ", "eleMentalist"]) {
      expect(professionColour(v)).toBe(want);
    }
  });

  it("never returns undefined for a missing or unknown profession", () => {
    for (const v of [null, undefined, "", "   ", "Bard", 0, {}]) {
      expect(typeof professionColour(v)).toBe("string");
      expect(professionColour(v)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("the style-attribute helpers", () => {
  it("emit a declaration for a known profession", () => {
    expect(professionSeriesStyle("Ranger")).toBe(`--axi-series: ${professionColour("Ranger")}`);
    expect(professionStripStyle("Ranger")).toBe(`--axi-card-strip: ${professionColour("Ranger")}`);
  });

  it("emit nothing for an unknown profession, so it inherits the accent", () => {
    // The failure this pins: `--axi-card-strip: undefined` in a style
    // attribute, which some engines render as the initial value and others
    // drop, so an unknown build's strip was inconsistent across builds.
    for (const v of [null, undefined, "", "Bard"]) {
      expect(professionSeriesStyle(v)).toBe("");
      expect(professionStripStyle(v)).toBe("");
    }
  });

  it("never emits the string 'undefined'", () => {
    for (const v of [null, undefined, "Bard"]) {
      expect(professionSeriesStyle(v)).not.toContain("undefined");
      expect(professionStripStyle(v)).not.toContain("undefined");
    }
  });
});

describe("the palette has one home", () => {
  it("appears in no renderer file but professions.js", () => {
    // Global Constraint 6. Six copies is how the palette drifted; this is the
    // test that keeps it from happening again.
    const colours = PROFESSIONS.map((p) => professionColour(p));
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.(js|css)$/.test(e.name)) continue;
        const rel = path.relative(ROOT, full);
        if (rel === path.join("src", "shared", "professions.js")) continue;
        // src/site and packages/forge-render convert in batch 5.
        if (rel.startsWith(path.join("src", "site"))) continue;
        if (rel.startsWith("packages")) continue;
        const text = fs.readFileSync(full, "utf8").toLowerCase();
        for (const c of colours) if (text.includes(c)) offenders.push(`${rel}: ${c}`);
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/shared/professions.test.js`
Expected: FAIL — `Cannot find module '../../../src/shared/professions.js'`.

- [ ] **Step 3: Write the module**

Create `src/shared/professions.js`:

```js
/**
 * The nine professions and the colours they own.
 *
 * This is domain data, not style: a profession's colour belongs to Guild
 * Wars 2, not to the app's theme, and it does not change when the accent
 * does. RULES.md rule 10 is the reason it reaches CSS only through the
 * per-instance --axi-series / --axi-card-strip knobs rather than as a token
 * or a class — a stylesheet that named a profession would be a colour
 * literal in app CSS, and a token would put game data on the theme surface.
 *
 * It used to live in six places: two blocks in library.css, one in
 * comps.css, one in comp-list.js, one in renderer.js, and one more each in
 * src/site and packages/forge-render (both converting in batch 5). They had
 * already drifted — library.css's pills were the same hues at 15% opacity
 * over near-black, which rule 2 calls nine browns.
 */

/** Canonical names, title-cased, in the game's own order. */
export const PROFESSIONS = Object.freeze([
  "Guardian",
  "Warrior",
  "Engineer",
  "Ranger",
  "Thief",
  "Elementalist",
  "Mesmer",
  "Necromancer",
  "Revenant",
]);

/**
 * Full strength, as rule 10 requires. These are the hues the app has always
 * used for a profession's icon (library.css:1720-1731); what changes in this
 * batch is that the tinted variants derived from them are gone.
 */
const COLOURS = Object.freeze({
  guardian: "#6ea8ff",
  warrior: "#ff9944",
  engineer: "#cc8844",
  ranger: "#77cc55",
  thief: "#cc6677",
  elementalist: "#dd5555",
  mesmer: "#b07acc",
  necromancer: "#4dca7a",
  revenant: "#aa6655",
});

/** What an unknown profession reads as. Not in COLOURS, so it is never a key. */
const UNKNOWN = "#888888";

/**
 * Normalise a profession name to its lookup key.
 * Tolerant because the import paths are: gw2skills has produced
 * "Elementalist " and ".axicode" files have produced lowercase.
 * @param {unknown} name
 * @returns {string} a key of COLOURS, or "" when the name is not one of the nine
 */
function key(name) {
  if (typeof name !== "string") return "";
  const k = name.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(COLOURS, k) ? k : "";
}

/**
 * The colour a profession owns, at full strength.
 * @param {unknown} name
 * @returns {string} always a hex string, never undefined
 */
export function professionColour(name) {
  const k = key(name);
  return k ? COLOURS[k] : UNKNOWN;
}

/** True when the name is one of the nine. */
export function isProfession(name) {
  return key(name) !== "";
}

/**
 * A `style` attribute body setting --axi-series, or "" for an unknown
 * profession so that the element inherits the accent instead of being
 * deliberately painted grey.
 * @param {unknown} name
 * @returns {string}
 */
export function professionSeriesStyle(name) {
  const k = key(name);
  return k ? `--axi-series: ${COLOURS[k]}` : "";
}

/** The same, for a card's capping strip. */
export function professionStripStyle(name) {
  const k = key(name);
  return k ? `--axi-card-strip: ${COLOURS[k]}` : "";
}
```

- [ ] **Step 4: Run the test to verify the first three describes pass**

Run: `npx jest tests/unit/shared/professions.test.js`
Expected: the first two describe blocks PASS; `the palette has one home` FAILS, naming `src/renderer/renderer.js`, `src/renderer/modules/comps/comp-list.js`, `src/renderer/styles/library.css` and `src/renderer/styles/comps.css`.

- [ ] **Step 5: Delete the two JS copies**

In `src/renderer/renderer.js`, delete the `PROF_COLORS` object at lines 1251-1255 and add to the module's imports:

```js
import { professionColour } from "../shared/professions.js";
```

Then replace every `PROF_COLORS[x]` read in that file with `professionColour(x)`. Find them with `grep -n 'PROF_COLORS' src/renderer/renderer.js`. Note the call sites previously indexed with an already-lowercased key; `professionColour` normalises itself, so pass the raw name and drop any `.toLowerCase()` that existed only to feed the lookup.

Do the same in `src/renderer/modules/comps/comp-list.js`: delete lines 40-45 and import from `../../../shared/professions.js`.

The two CSS copies — `library.css:1720-1731` and `comps.css:1266-1276` — are deleted by Tasks 5 and 11, which are the tasks that replace what they style. Until then this describe block fails on those two files, which is correct and expected.

- [ ] **Step 6: Narrow the test to what this task can finish**

Change the `the palette has one home` walk to also skip the two stylesheets that later tasks own, with the skip carrying its own expiry:

```js
        // These two still carry the palette as CSS classes. Task 5 deletes
        // library.css's copy and Task 11 deletes comps.css's; when both are
        // done, delete these two lines and the test covers the whole app.
        if (rel === path.join("src", "renderer", "styles", "library.css")) continue;
        if (rel === path.join("src", "renderer", "styles", "comps.css")) continue;
```

- [ ] **Step 7: Run the full unit suite**

Run: `npx jest tests/unit/`
Expected: PASS. The comps tab and comp list still render the same colours; only their source moved.

- [ ] **Step 8: Commit**

```bash
git add src/shared/professions.js tests/unit/shared/professions.test.js src/renderer/renderer.js src/renderer/modules/comps/comp-list.js
git commit -m "refactor: give the profession palette one home

Six copies of the same nine hex values, each normalising its input its own
way. They are domain data, not style, so they live in src/shared and reach
CSS only through --axi-series and --axi-card-strip, which is rule 10's
route for real colour. A test fails if a seventh copy appears.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The library toolbar, filters and sidebar

The top of the library screen: search, sort, view toggle, New Build, the
import dropdown, the breadcrumb, the filter dropdowns and the sidebar. This is
where `.axi-toolbar`, `.axi-pill` and `.axi-picker` land.

**Files:**
- Modify: `src/renderer/styles/library.css:1-560` (page layout, resize handle, toolbar, filters) and `:569-840` (sidebar)
- Modify: `src/renderer/modules/library/toolbar.js` (the filter and sort dropdowns become `.axi-picker`)
- Modify: `src/renderer/modules/library/sidebar.js` (profession tints move to `--axi-series`)

**Interfaces:**
- Consumes: `professionSeriesStyle` from Task 2.
- Produces, for Tasks 4-6: the converted `.lib-sidebar`, `.lib-toolbar` and `.lib-content` shells the views render into; `.af-libpicker` as the app's name for a `.axi-picker` whose popover is portaled (the sidebar and content pane both scroll, and `.axi-picker__pop`'s block falls outside its own box).

- [ ] **Step 1: Convert the page shell and the resize handle (`:1-90`)**

The page is a two-pane split with a drag handle between. Delete the `border-radius`, the `--line-soft` borders and the `--panel-2` fills; the sidebar becomes a `.axi-panel`-weight surface separated from the content by a rule, not by a shadow:

```css
/* ── Page layout ─────────────────────────────────────────────────── */
.lib-page {
  display: grid;
  grid-template-columns: var(--af-lib-sidebar-w, 220px) 1fr;
  height: 100%;
  min-height: 0;
  background: var(--axi-ground);
}

.lib-sidebar {
  min-width: 0;
  overflow-y: auto;
  padding: 12px 10px;
  background: var(--axi-surface);
  border-right: var(--axi-border-panel) solid var(--axi-ink-line);
}

.lib-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

The resize handle keeps every dimension and every behaviour it has today (`:38-90` — the 5px target, the touch-media override, the during-drag rule). Only its colours change: the resting handle is `transparent`, the hovered and dragging handle is `var(--axi-accent)`. Do not give it a block; it is a slot edge, not a raised thing.

- [ ] **Step 2: Convert the toolbar (`:91-340`)**

Replace the toolbar shell with the package's:

```css
/* ── Toolbar ─────────────────────────────────────────────────────── */
.lib-toolbar {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-bottom: var(--axi-border-panel) solid var(--axi-ink-line);
}
```

Then, one by one:
- **Search (`:125-166`)** → `.axi-search` + `.axi-input`. The magnifier glyph is the consumer's; the package only reserves the room (`padding-left: 38px`) and positions `.axi-search__icon`. Keep the existing SVG, add the class.
- **Sort (`:167-183`)** and **Import dropdown (`:241-289`)** → `.axi-picker`, per Ruling B. Markup contract, from the package's own comment:

```html
<div class="axi-picker af-libpicker">
  <button class="axi-picker__btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="lib-sort">Modified</button>
  <div class="axi-picker__pop axi-picker__pop--fixed" id="lib-sort" role="listbox" hidden>
    <button class="axi-picker__opt" role="option" aria-selected="true">Modified</button>
  </div>
</div>
```

The package ships no script: `hidden`, `aria-expanded` and `aria-selected` are the whole state. `toolbar.js` already opens and closes these menus and already tracks the active sort field — rewire those handlers to toggle the three attributes instead of a `--open` class. Behaviour, including click-outside-to-close and the current keyboard handling, stays exactly as it is (Global Constraint 10).

Use `--fixed` and position from script: the toolbar sits inside `.lib-main`, which has `overflow: hidden`, and an absolutely positioned popover's offset block falls outside its own box, so the block is the first thing the clip eats. Measure the trigger with `getBoundingClientRect()` and set `left`/`top`, the same contract the tooltips use.

- **View toggle (`:184-225`)** → a run of `.axi-pill`s with `aria-pressed`. This is what `.axi-pill` is for: the pressed state fills and lifts, and the package spells out `[aria-pressed="true"]:hover` so a pressed pill under the cursor lifts rather than slides.
- **New build button (`:226-240`)** → `.axi-btn .axi-btn--primary`, already converted in batch 1. Delete the local rule entirely; do not restyle it here.
- **Breadcrumb (`:290-339`)** → `font: var(--axi-t-micro); letter-spacing: var(--axi-ls-micro); text-transform: uppercase; color: var(--axi-text-faint)`, separators as `.axi-diamond` at `--axi-tick-w`-scale. This is rule 7's cheapest appearance and the first diamond in the app.

- [ ] **Step 3: Convert the filters (`:340-559`)**

Each filter is a dropdown of checkable rows with an icon. Convert the container and menu to `.axi-picker` / `.axi-picker__pop` as above. The checkmark at `:454-471` is currently hidden-until-active, which shifts every label as the selection moves — the package already solved this: `.axi-picker__opt::before` puts a transparent tick in every row and inks only the selected one. Delete the local checkmark rule and use it.

The "Clear all" button at `:505-559` becomes `.axi-btn .axi-btn--ghost`.

- [ ] **Step 4: Convert the sidebar (`:569-840`) and move its profession tints**

The nav items at `:689-814` are the same shape as `.leftnav__item`, converted in batch 1 — match it exactly rather than inventing a second treatment. The inline inputs at `:815-841` become `.axi-input`.

Delete `library.css:1733-1756` — the nine `[data-profession="…"]` rules plus the three `opacity` rules that fade the icon. They are the palette's third copy (Ruling E) **and** they break rule 2: a profession hue at `opacity: 0.5` over near-black is a brown, and nine of them are nine browns. Replace with, in `library.css`:

```css
/* The profession's own colour, at full strength, delivered per-instance from
   src/shared/professions.js. Rule 10: the palette belongs to the game, not to
   the theme, so it arrives as data and not as a token. */
.lib-nav-item__icon { color: var(--axi-series, var(--axi-text-faint)); }
```

and in `sidebar.js`, on the element that carries `data-profession`, add `style="${professionSeriesStyle(profession)}"`. An unknown profession emits nothing and falls to `--axi-text-faint`, which is the behaviour the old `--unknown` grey had.

- [ ] **Step 5: Run the gate and the suite**

```bash
npx jest tests/unit/styles/ tests/unit/shared/
```

Expected: PASS. `library.css` is still on `PENDING`, so its own literals are not yet enforced — but `professions.test.js`'s walk now names one fewer block in `library.css`, and nothing else may regress.

Then check your own work the way the gate will in Task 6:

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|border-radius|opacity:' src/renderer/styles/library.css | sed -n '1,120p'
```

Every hit must be below line 560 in a section a later task owns, or in the profession block Task 5 deletes. A hit inside `:1-560` or `:569-841` is yours and is not done.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/styles/library.css src/renderer/modules/library/toolbar.js src/renderer/modules/library/sidebar.js
git commit -m "style: convert the library toolbar, filters and sidebar

The sort, import and filter menus become .axi-picker, which 1.10.0 added for
exactly this case: Electron has no appearance:base-select, so a native
select's popup is a raised list the language cannot reach. The sidebar's
nine profession tints are deleted — a hue at 0.5 opacity over near-black is
a brown, and nine of them are nine browns (rule 2). The colour now arrives
per-instance at full strength.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: List view and table view are drawn in rules

Ruling C: neither of these ends in a verb, and in both the eye runs down a
column. By rule 8's own test they are the panel's interior — a table — and the
package already draws one.

**Files:**
- Modify: `src/renderer/styles/library.css:842-877` (shared pills), `:907-1018` (list view), `:1019-1100` (comp rows), `:1101-1285` (table/tree view)
- Modify: `src/renderer/modules/library/content.js:200-215` (pill helpers), list view and table view templates

**Interfaces:**
- Consumes: `professionSeriesStyle` (Task 2); the converted shells (Task 3).
- Produces: `.lib-pill` is gone as a class; every caller emits `.axi-chip` or `.axi-chip--meta`. Task 5 and Task 9 depend on this.

- [ ] **Step 1: Delete `.lib-pill--prof` outright, and convert the neutral pills**

Delete `library.css:858-869` — all ten rules. They are not retokenised, because their whole construction is a colour at 15% opacity over the ground; there is nothing to convert them *to* (spec §8). Delete `:870-877` too.

Replace the whole `Shared pills` section with nothing: `.axi-chip` and `.axi-chip--meta` already exist in the package and are what these were approximating.

In `content.js`, rewrite the four pill helpers:

```js
function profPillHtml(build) {
  const prof = build.profession;
  if (!prof) return "";
  // Rule 7: the diamond carries the profession's colour, the label stays in
  // the neutral ramp. A chip filled with the profession hue would be status
  // (rule 5), and which profession a build is is not a status.
  return `<span class="axi-chip af-chip--prof"><span class="axi-diamond axi-diamond--series" style="${professionSeriesStyle(prof)}"></span>${escapeHtml(prof)}</span>`;
}

function eliteSpecPillHtml(build) {
  const spec = getEliteSpecName(build);
  if (!spec) return "";
  return `<span class="axi-chip">${escapeHtml(spec)}</span>`;
}

function gameModePillHtml(build) {
  const mode = gameModeLabel(build.gameMode || "pve");
  return `<span class="axi-chip axi-chip--meta">${escapeHtml(mode)}</span>`;
}

function tagPillsHtml(build) {
  return (build.tags || [])
    .map((t) => `<span class="axi-chip">${escapeHtml(t)}</span>`)
    .join("");
}
```

`.af-chip--prof` is the only new app shape and exists purely to tighten the gap between the diamond and its label:

```css
/* A chip whose bullet is the profession's colour. The colour is on the
   diamond, never on the chip's outline: an outlined chip is an annotation
   (rule 5), and a build's profession annotates it rather than judging it. */
.af-chip--prof { gap: 7px; }
```

- [ ] **Step 2: Convert the list view (`:907-1018`)**

```css
/* ── List view ───────────────────────────────────────────────────── */
/* Rule 8: the eye runs down the date column, so this is the panel's
   interior and is drawn in rules. No outline per row, no block per row —
   forty outlined rows inside an outlined panel is the grid-of-boxes the
   hairline weight exists to prevent. */
.lib-list { display: flex; flex-direction: column; }

.lib-list-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-bottom: var(--axi-border-hairline) solid var(--axi-rule);
  font: var(--axi-t-small);
  color: var(--axi-text-dim);
  cursor: pointer;
  min-width: 0;
  user-select: none;
}

/* The neutral ramp, not an ink: hovering a row is not a status, and forty
   rows that each flash a colour on the way past the one you want is exactly
   the tinted-everything failure rule 2 is about. */
.lib-list-row:hover { background: var(--axi-surface-raised); color: var(--axi-text); }

.lib-list-row--folder { color: var(--axi-text-faint); }

/* Pinned is a fact about the row, so it caps rather than frames: a short bar
   at the row's head, in the accent, at the control weight. */
.lib-list-row--pinned { box-shadow: inset 3px 0 0 var(--axi-accent); }

.lib-list-row__spec-icon { color: var(--axi-series, var(--axi-text-faint)); }
```

Keep every width, flex and ellipsis rule in `:948-1018` as found — they are layout, not style. Only `border-radius`, `--hover-subtle`, `--text-dim`, `--text-light`, the `rgba` pinned border and the `font-size` pairs change.

In `content.js`'s list view template, add the series style to the spec-icon span:

```js
<span class="lib-list-row__spec-icon" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</span>
```

and delete the `${profClass(b.profession)}` interpolation from it.

- [ ] **Step 3: Convert the table view (`:1101-1285`)**

This one is literally a table, so take the package's treatment wholesale. `.lib-tv__row` gets `border-bottom: var(--axi-border-hairline) solid var(--axi-rule)`, and the header row gets `border-bottom: var(--axi-border-control) solid var(--axi-rule)` so the head reads as a lid on the column. Header cells take `font: var(--axi-t-micro); letter-spacing: var(--axi-ls-micro); text-transform: uppercase; color: var(--axi-text-faint)`.

Keep the `grid-template-columns` at `:1103-1112` and the ROLE track note at `:1240-1268` exactly as found — that comment records a real measurement ("HEAL SUPPORT" does not fit), and this batch does not relitigate it.

Sort buttons (`:1269-1285`) take the hover lift's first case: no resting block, `translate(-2px, -2px)` plus a gained 3px block.

- [ ] **Step 4: Convert the comp rows (`:1019-1100`)**

Same treatment as the list rows. The three drag states at `:1084-1100` currently use `opacity` for selection and drop-target. Selection and drop-target are states, not quantities:

```css
.lib-list-row.lib-selected { background: var(--axi-surface-raised); box-shadow: inset 3px 0 0 var(--axi-accent); }
.lib-list-row.lib-drop-target { outline: var(--axi-border-control) dashed var(--axi-accent); outline-offset: -3px; }
```

`.lib-dragging` keeps its `opacity: 0.4` — that is a drag ghost, not colour mixing, and the gate's opacity scanner does not fire on a standalone `opacity` property. Verify that claim by running the gate in Step 5 rather than trusting it.

- [ ] **Step 5: Run the suite**

```bash
npx jest tests/unit/
```

Expected: PASS. Then confirm nothing in `:842-1285` still carries a literal:

```bash
sed -n '842,1285p' src/renderer/styles/library.css | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|border-radius'
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/styles/library.css src/renderer/modules/library/content.js
git commit -m "style: draw the library's list and table views in rules

Rule 8's test is whether the eye runs down a column, and in both of these it
does, so they are the panel's interior rather than a stack of cards. The ten
.lib-pill--prof rules are deleted rather than retokenised: their whole
construction was a hue at 15% over near-black. A build's profession is now a
diamond carrying --axi-series beside a neutral chip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Grid view becomes the card

The batch's centrepiece and the anatomy approved against a live render. A grid
tile is a card at panel weight with the profession strip *capping* the head.

**Files:**
- Modify: `src/renderer/styles/library.css:1286-1510` (grid and icon views), `:1720-1732` (the palette's last CSS copy)
- Modify: `src/renderer/modules/library/content.js` (grid and icon view templates)
- Modify: `tests/unit/shared/professions.test.js` (drop the `library.css` skip added in Task 2 Step 6)

**Interfaces:**
- Consumes: `professionStripStyle`, `professionSeriesStyle` (Task 2); `.axi-chip` helpers (Task 4).
- Produces: `.af-tile`, the app's grid card, at **panel** weight. Its control-weight sibling is the comps build pool's raised shapes (Task 11 Step 5); the two must not converge by accident — they are different weights for a reason the plan states in both places.

- [ ] **Step 1: Delete the grid card's old body (`:1286-1438`) and write the tile**

```css
/* ── Grid view ───────────────────────────────────────────────────── */
/* --axi-grid-min is a per-instance knob, so it is set on the grid element in
   markup, not here. Folders and comps ask for a narrower track than builds. */
.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--axi-grid-min, 200px), 1fr));
  gap: 14px;
}

.lib-grid + .lib-grid { margin-top: 18px; }

/* A grid tile is a card at PANEL weight: it sits on the page's content area,
   not inside a second panel, so it is the raised thing here and carries the
   6px block. Anything raised INSIDE a panel takes the control weight instead
   — the build pool in comps.css is the app's other case. */
.af-tile {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px 14px 12px;
  background: var(--axi-surface);
  border: var(--axi-border-panel) solid var(--axi-ink-line);
  box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line);
  cursor: pointer;
  user-select: none;
  min-width: 0;
  transition: transform .1s, box-shadow .1s;
}

/* Rule 4, the panel case: resting on 6px, so it grows to 10px and translates
   by 3. Never opacity, never a glow. */
.af-tile:hover {
  transform: translate(-3px, -3px);
  box-shadow: var(--axi-offset-panel-hover) var(--axi-offset-panel-hover) 0 var(--axi-ink-line);
}

/* Rule 5: the profession CAPS the tile. A full-height left edge reads as the
   box's own border, and a row of five tiles becomes five coloured frames with
   the colour saying nothing. The strip's colour arrives per-instance as
   --axi-card-strip; the tile's outline stays --axi-ink-line in every state. */
.af-tile--strip::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 9px;
  background: var(--axi-card-strip, var(--axi-accent));
  border-bottom: var(--axi-border-panel) solid var(--axi-ink-line);
}

.af-tile__head { display: flex; gap: 11px; align-items: flex-start; }

/* The one place the profession's colour FILLS, because a glyph tile is the
   thing being identified rather than a judgement about it. */
.af-tile__glyph {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: var(--axi-surface-raised);
  border: var(--axi-border-control) solid var(--axi-ink-line);
  color: var(--axi-series, var(--axi-text));
}

.af-tile__glyph svg { width: 26px; height: 26px; fill: currentColor; }

.af-tile__title {
  font: var(--axi-t-h3);
  letter-spacing: var(--axi-ls-h3);
  color: var(--axi-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.af-tile__pills { display: flex; flex-wrap: wrap; gap: 5px; }

/* margin-top:auto so that in an equalised grid row every tile's rule lands on
   the same line and reads as continuous across the grid. The cost is empty
   space on tiles with less content, and that is the trade the language makes. */
.af-tile__meta {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: auto;
  padding-top: 11px;
  border-top: var(--axi-border-control) solid var(--axi-rule);
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  text-transform: uppercase;
  color: var(--axi-text-faint);
}

/* Selected and drop-target are states of the tile, so they cap and outline
   rather than tint. Pinned caps in the accent the same way a list row does. */
.af-tile--pinned::after {
  content: "";
  position: absolute;
  inset: auto 0 0 0;
  height: 3px;
  background: var(--axi-accent);
}
.af-tile.lib-selected { outline: var(--axi-border-control) solid var(--axi-accent); outline-offset: -3px; }
.af-tile.lib-drop-target { outline: var(--axi-border-control) dashed var(--axi-accent); outline-offset: -3px; }
.af-tile.lib-dragging { opacity: 0.4; }

/* Folder and comp tiles are the same box laid on its side: an icon and a
   name, no strip, because neither owns a domain colour. */
.af-tile--row {
  flex-direction: row;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  color: var(--axi-text-dim);
}
```

- [ ] **Step 2: Rewrite the grid view template**

In `content.js`, the build card becomes:

```js
  const buildCards = builds
    .map(
      (b) => `
        <div class="af-tile af-tile--strip ${b.pinned ? "af-tile--pinned" : ""}" style="${professionStripStyle(b.profession)}" data-build-id="${escapeHtml(b.id)}">
          <div class="af-tile__head">
            <div class="af-tile__glyph" style="${professionSeriesStyle(b.profession)}">${getSpecIcon(b)}</div>
            <div class="af-tile__title">${escapeHtml(b.title || "Untitled")}${itemSyncIndicatorHtml("build", b)}</div>
            ${buildUsageChipHtml(b, { compact: true })}${pinStarHtml(b)}
          </div>
          ${folderPathHtml(b)}
          <div class="af-tile__pills">
            ${profPillHtml(b)}${eliteSpecPillHtml(b)}${gameModePillHtml(b)}${roleBadgeHtml(b, state.upgradeCatalog)}
          </div>
          <div class="af-tile__meta">${formatDate(b.updatedAt)}</div>
        </div>
      `
    )
    .join("");
```

Folder and comp cards become `.af-tile .af-tile--row`, keeping their existing inner structure and `data-` attributes verbatim. The `${profClass(...)}` interpolation disappears from all three.

The three `.lib-grid--*` variants at `:1294-1304` are replaced by a per-instance knob on the grid element, which is where a knob belongs:

```js
  if (folderCards) sections.push(`<div class="lib-grid" style="--axi-grid-min: 170px">${folderCards}</div>`);
  if (compCards) sections.push(`<div class="lib-grid" style="--axi-grid-min: 170px">${compCards}</div>`);
  if (buildCards) sections.push(`<div class="lib-grid" style="--axi-grid-min: 200px">${buildCards}</div>`);
```

Delete `.lib-grid-card` and its eighteen descendant rules once nothing references them. Confirm with `grep -rn 'lib-grid-card' src/` before deleting — `build-sources.css:77-87` and `skeleton.css:474` both reach into `.lib-grid-card__header`, and Tasks 8 and 12 must be told. Leave a one-line note in the commit message naming both.

- [ ] **Step 3: Convert the icon view (`:1439-1510`)**

Icon view is a grid of 34px glyphs with a label — small enough that a card would be all border. It stays flat, on the neutral ramp:

```css
.lib-icon-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 9px 5px;
  cursor: pointer;
  user-select: none;
}
.lib-icon-item:hover { background: var(--axi-surface-raised); }
.lib-icon-item.lib-selected { outline: var(--axi-border-control) solid var(--axi-accent); outline-offset: -3px; }
.lib-icon-item.lib-drop-target { outline: var(--axi-border-control) dashed var(--axi-accent); outline-offset: -3px; }
.lib-icon-item__icon { color: var(--axi-series, var(--axi-text-faint)); }
.lib-icon-item__label {
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  color: var(--axi-text-dim);
}
```

Keep every width/height/max-width as found. Add `style="${professionSeriesStyle(...)}"` to the item's icon span in the template.

- [ ] **Step 4: Delete the palette's last CSS copy**

Delete `library.css:1720-1732` — the ten `.lib-prof--*` rules. Then confirm nothing still emits the class:

```bash
grep -rn 'lib-prof--\|profClass' src/renderer/
```

Expected: no hits under `src/renderer/`. (`src/site/render-comp.js:34` keeps its own copy until batch 5; that is why `professions.test.js` skips `src/site`.)

Delete `profClass()` from `content.js` once its last caller is gone.

- [ ] **Step 5: Un-skip `library.css` in the palette test**

In `tests/unit/shared/professions.test.js`, delete the `library.css` skip line added in Task 2 Step 6, leaving only the `comps.css` one. Add nothing else.

- [ ] **Step 6: Run the suite**

```bash
npx jest tests/unit/
```

Expected: PASS, including `the palette has one home`, which now walks `library.css` and finds nothing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles/library.css src/renderer/modules/library/content.js tests/unit/shared/professions.test.js
git commit -m "style: the library grid becomes the card

A tile is a card at panel weight, and the profession caps its head rather
than framing its edge: a full-height stripe reads as the box's own border,
and five tiles in a row become five coloured frames with the colour saying
nothing (rule 5). The colour is full strength, arrives as --axi-card-strip,
and never touches the outline, which stays --axi-ink-line in every state.

build-sources.css:77-87 and skeleton.css:474 still reach into
.lib-grid-card__header; tasks 8 and 12 retarget them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The library's remainder, and the file leaves PENDING

Context menu, empty state, drag classes, columns view, pin button, folder
path, breadcrumb leftovers — everything in `library.css` no earlier task
claimed. Ends with the file enforced.

**Files:**
- Modify: `src/renderer/styles/library.css:878-906` (pin button), `:1511-1719` (columns view, context menu), `:1758-2321` (empty state, drag, and the tail)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (`PENDING` loses `library.css`)

**Interfaces:**
- Consumes: everything Tasks 3-5 produced.
- Produces: `library.css` enforced. Task 12 assumes it stays that way.

- [ ] **Step 1: Read the tail you have not seen**

```bash
sed -n '1511,2321p' src/renderer/styles/library.css
```

Tasks 3-5 covered `:1-1510` and `:1720-1757`. Everything else is yours. Work top to bottom and convert in place; do not add a new section.

- [ ] **Step 2: Convert the context menu (`:1607-1719`)**

The app already has a converted menu from batch 1 — `.axi-menu` / `.axi-menu__pop`. Match it exactly rather than writing a second treatment; `grep -n 'axi-menu' src/renderer/styles/*.css` shows how batch 1 used it. The danger item at `:1687-1719` takes `color: var(--axi-danger)`, and the disabled-but-hoverable item at `:1658-1686` keeps its `title` behaviour and takes `color: var(--axi-text-faint)`.

- [ ] **Step 3: Convert the columns view (`:1511-1606`)**

Miller columns: each column is a scrolling pane separated by a rule, not a border with a shadow. `border-right: var(--axi-border-hairline) solid var(--axi-rule)`.

- [ ] **Step 4: Convert the drag classes (`:1774` to the end)**

`.lib-drag-ghost` at `:1780` carries `background: rgba(var(--accent-rgb), 0.1) !important` — a colour at partial opacity over the ground, and behind an `!important` that the gate's scanner was specifically taught to see through. It becomes `background: var(--axi-surface-raised) !important`. `.lib-drag-fallback`'s `box-shadow: 0 4px 12px rgba(0,0,0,0.4)` becomes the offset block: `box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line)`. The `opacity` values on the four ghost states stay — a drag ghost is a ghost.

- [ ] **Step 5: Convert the pin button (`:878-906`) and the empty state (`:1758-1773`)**

The pin button's active state is `var(--axi-accent)` — the app's `--gold` was the accent by another name. The empty state takes `font: var(--axi-t-small); color: var(--axi-text-faint)`.

- [ ] **Step 6: Prove the file is clean, then enforce it**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bborder-radius|box-shadow:[^;]*[0-9]+px[[:space:]]+[0-9]+px[[:space:]]+[1-9]' src/renderer/styles/library.css
```

Expected: no output. If a hit remains, fix it — do not move to the next step.

Then delete `"src/renderer/styles/library.css"` from the `PENDING` array in `tests/unit/styles/axi-design-rules.test.js`.

- [ ] **Step 7: Run the gate**

```bash
npx jest tests/unit/styles/ tests/unit/shared/
```

Expected: PASS. `library.css` is now scanned by all nine scanners on every run. If the gate finds something the grep above missed, that is the gate working — fix it and note what the grep did not catch, because it means the grep in Step 6 is weaker than the gate and later tasks should not trust it.

- [ ] **Step 8: Run everything**

```bash
npx jest
```

Expected: PASS, all suites.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/styles/library.css tests/unit/styles/axi-design-rules.test.js
git commit -m "style: finish library.css and put it under the gate

The last partial-opacity fill was behind an !important, which is the case
the scanner was taught to see through in batch 1. library.css leaves
PENDING; all nine scanners run against it from here.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The two injected stylesheets, and the diamond timeline

`library/history-panel.js` and `library/history-compare.js` each build a
stylesheet as a string and inject it. Until batch 1 added `injectedCssBlocks()`
nothing in the repo scanned them, and they are the only reason `PENDING_JS`
exists. Global Constraint 11: this task must land before Task 12.

The history panel is also the batch's best diamond: a vertical timeline whose
events are today `border-radius: 50%` dots in three colours. A rotated outlined
square is the family motif (rule 7), and a timeline of them is the clearest
family resemblance to AxiAM the app can get for the price.

**Files:**
- Modify: `src/renderer/modules/library/history-panel.js` (the injected sheet, ~lines 30-260)
- Modify: `src/renderer/modules/library/history-compare.js` (the injected sheet, ~lines 185-420)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (`PENDING_JS` empties; the seed test that asserts those files contain gradients must go with it)

**Interfaces:**
- Consumes: the converted chrome from batch 1 (`.axi-panel`, `.axi-btn`, `.axi-chip`).
- Produces: `PENDING_JS = []`. Every renderer JS file's injected CSS is enforced from here.

- [ ] **Step 1: Read both sheets end to end**

```bash
sed -n '25,265p' src/renderer/modules/library/history-panel.js
sed -n '180,425p' src/renderer/modules/library/history-compare.js
```

Every declaration in these two blocks is in scope. The dominant pattern is
`var(--token, #literal)` — a token with a hex fallback. The fallback is the
violation: the tokens it names (`--panel`, `--line`, `--text-dim`, `--radius-xs`)
are bridge tokens that will not exist after batch 5, so the fallback is not a
safety net, it is the thing that will be left. Replace the whole declaration
with the axi token and **no fallback**.

Mapping, applied throughout both files:

| today | becomes |
|---|---|
| `var(--panel, #141518)` | `var(--axi-surface)` |
| `var(--bg-raised, #17181c)` / `var(--input-bg, #0f1013)` | `var(--axi-ground)` |
| `var(--line, #1e1f24)` (a panel edge) | `var(--axi-ink-line)` |
| `var(--line, #1e1f24)` (a rule inside content) | `var(--axi-rule)` |
| `var(--text, #e2e3e8)` | `var(--axi-text)` |
| `var(--text-light, #aeafb8)` | `var(--axi-text-dim)` |
| `var(--text-dim, #646670)` | `var(--axi-text-faint)` |
| `var(--accent, #c89848)` | `var(--axi-accent)` |
| `var(--accent-2, #64aaf0)` | `var(--axi-meta)` |
| `var(--danger, #d65c5c)` | `var(--axi-danger)` |
| `var(--hover-subtle, rgba(255,255,255,0.05))` | `var(--axi-surface-raised)` |
| `var(--radius-xs, 4px)` / `-sm` / `-md` / `999px` / `50%` | delete the declaration |
| `rgba(0,0,0,0.55)` (the compare scrim) | `var(--axi-scrim)` |
| `box-shadow: var(--shadow-lg, …)` | `box-shadow: var(--axi-offset-panel) var(--axi-offset-panel) 0 var(--axi-ink-line)` |

- [ ] **Step 2: Turn the history timeline into diamonds**

`history-panel.js` around line 113-130 draws a rail and a round dot per entry, with `--sync` and `--revert` recolouring the dot's border. Replace with:

```css
    /* The rail the events hang off. A rule, not an edge: it is inside the
       panel's running content. */
    .history-panel__rail {
      width: var(--axi-border-hairline);
      background: var(--axi-rule);
    }
    /* Rule 7. A local edit is the ordinary case and is outlined; a sync and a
       revert each get an ink, and nothing else on the timeline does — three
       inks is already the most a column of events can carry before the colour
       stops sorting anything. */
    .history-panel__dot {
      width: 11px;
      height: 11px;
      flex: none;
      transform: rotate(45deg);
      background: var(--axi-ground);
      border: var(--axi-border-control) solid var(--axi-ink-line);
    }
    .history-panel__dot--sync { background: var(--axi-meta); }
    .history-panel__dot--revert { background: var(--axi-accent); }
    .history-panel__dot--deleted { background: var(--axi-danger); }
```

The four `__badge--*` rules at lines 149-152 are accent-at-14%-opacity fills — rule 2's exact case. They become `.axi-chip` treatment: outlined in the ink they name, background `transparent`.

```css
    .history-panel__badge {
      display: inline-block;
      padding: 1px 7px;
      border: var(--axi-border-hairline) solid var(--axi-rule);
      background: transparent;
      color: var(--axi-text-faint);
      font: var(--axi-t-micro);
      letter-spacing: var(--axi-ls-micro);
      text-transform: uppercase;
    }
    .history-panel__badge--sync { border-color: var(--axi-meta); color: var(--axi-meta); }
    .history-panel__badge--revert { border-color: var(--axi-accent); color: var(--axi-accent); }
    .history-panel__badge--deleted { border-color: var(--axi-danger); color: var(--axi-danger); }
```

`.hist-strip__arrow` and friends (lines 185-210) are a build-state strip; the `999px` pills become square `.axi-chip` shapes and the dashed placeholder keeps its dash at `var(--axi-border-hairline)`.

- [ ] **Step 3: Convert `history-compare.js`**

Same mapping. Three specific shapes:
- The scrim at line 189 → `var(--axi-scrim)`, and the dialog at `:196-199` → panel border plus offset block, no radius.
- The diff rows at `:269-275` — `rgba(accent, 0.07)` fill inside a `rgba(accent, 0.28)` border — become `background: var(--axi-surface-raised)` with `border: var(--axi-border-hairline) solid var(--axi-accent)`. The change is an annotation on a row, so it outlines (rule 5).
- The before/after chips at `:353-390` lose their `999px` and their `--accent-bg` tint; `.hist-chip--after` outlines in `var(--axi-accent)`.

- [ ] **Step 4: Empty `PENDING_JS` and delete the seed test that contradicts it**

In `tests/unit/styles/axi-design-rules.test.js`:

```js
const PENDING_JS = [];
```

Delete the comment block above it that explains why the two files are listed, and delete the whole `it("finds the two known injected stylesheets", …)` test — it asserts those files *contain* `linear-gradient(180deg` and colour literals, which is exactly what this task removes, so leaving it turns a success into a failure.

That test was not ceremony: it proved `injectedCssBlocks()` actually reaches into a JS file rather than silently returning `[]` and reporting success over an unscanned repo. Deleting it removes that proof, so replace it with one that keeps the proof without depending on an unconverted file:

```js
    it("extracts CSS from a template literal assigned to a style element", () => {
      // Non-vacuity: if injectedCssBlocks ever stops finding blocks, every
      // scan below passes over an empty string and reports success on a repo
      // full of literals. This pins the extraction itself.
      const sample = [
        "const el = document.createElement('style');",
        "el.textContent = `",
        "  .x { color: #ff0000; border-radius: 4px; }",
        "`;",
      ].join("\n");
      const blocks = injectedCssBlocks(sample);
      expect(blocks.join("\n")).toContain("#ff0000");
      expect(findColourLiterals(blocks.join("\n"))).not.toHaveLength(0);
      expect(findRadiusLiterals(blocks.join("\n"))).not.toHaveLength(0);
    });

    it("still finds blocks in the app's real injected stylesheets", () => {
      // The synthetic case above could pass against an extractor that only
      // handles the shape it was written for. These are the real files.
      for (const file of ["src/renderer/modules/library/history-panel.js",
                          "src/renderer/modules/library/history-compare.js"]) {
        expect(injectedCssBlocks(fs.readFileSync(path.join(ROOT, file), "utf8")).length)
          .toBeGreaterThan(0);
      }
    });
```

- [ ] **Step 5: Run the gate**

```bash
npx jest tests/unit/styles/
```

Expected: PASS. Every renderer JS file is now scanned, so if any *other* module injects CSS with a literal, this is where it surfaces — and that is a real finding, not a regression. If one appears, convert it here and name it in the commit message.

- [ ] **Step 6: Verify by eye that the panel still opens**

The history panel injects its sheet once, guarded. Confirm the guard and the
injection point are untouched:

```bash
grep -n 'createElement("style")\|textContent =\|_injected\|appendChild' src/renderer/modules/library/history-panel.js src/renderer/modules/library/history-compare.js
```

Expected: the same lines as before your edit, with only the string between the backticks changed.

- [ ] **Step 7: Run everything and commit**

```bash
npx jest
```

```bash
git add src/renderer/modules/library/history-panel.js src/renderer/modules/library/history-compare.js tests/unit/styles/axi-design-rules.test.js
git commit -m "style: convert the two injected stylesheets, and PENDING_JS empties

These build CSS as a string, so nothing scanned them until batch 1 taught
the gate to read injected blocks. Every var(--token, #literal) drops its
fallback: the tokens named are bridge tokens that batch 5 deletes, so the
fallback was not a safety net, it was what would be left.

The history timeline's round dots become diamonds — rule 7's motif, and the
first place in AxiForge it appears at any size.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: cards.css and build-sources.css

Two smaller files with one shared job: the chips and status shapes that sit on
top of other screens. Both leave `PENDING` here.

**Files:**
- Modify: `src/renderer/styles/cards.css:1-123` and `:124-482` (share dropdown, build-code input, publish ticker, publish result)
- Modify: `src/renderer/styles/build-sources.css` (all 393 lines)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (`PENDING` loses both)

**Interfaces:**
- Consumes: `.axi-chip`, `.axi-diamond`, `.axi-btn` (batch 1), `.af-tile__head` (Task 5 — `build-sources.css:77-87` targets the now-deleted `.lib-grid-card__header` and must be retargeted).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: cards.css — leave the `.btn` rules alone**

`cards.css:18-70` holds `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-danger`, converted in **batch 1** because 49 markup sites depend on them. Do not touch them. Confirm which lines they occupy before editing anything:

```bash
grep -n '^\.btn' src/renderer/styles/cards.css
```

- [ ] **Step 2: Convert the leftovers at the head of the file**

`.pill` (`:10-16`) is a `999px` shape that predates everything; replace its body with the package's chip treatment and keep the class name, since markup depends on it:

```css
.pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border: var(--axi-border-hairline) solid var(--axi-rule);
  color: var(--axi-text-dim);
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  text-transform: uppercase;
}
```

`.status-card` (`:26-50`) becomes a `.axi-panel`-weight surface. Its `--done` variant is accent at 12% over the ground inside an accent-at-48% border — rule 5's case, and it is a real status, so it **fills**:

```css
.status-card {
  padding: 12px;
  background: var(--axi-surface);
  border: var(--axi-border-panel) solid var(--axi-ink-line);
  overflow: hidden;
  overflow-wrap: break-word;
}
.status-card h3 { margin: 0; font: var(--axi-t-h3); letter-spacing: var(--axi-ls-h3); }
.status-card p { margin: 5px 0 0; font: var(--axi-t-small); color: var(--axi-text-dim); }

/* Done is a status, so it caps: a bar across the head, not a tinted box. */
.status-card--done { position: relative; padding-top: 18px; }
.status-card--done::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: var(--axi-ok);
  border-bottom: var(--axi-border-panel) solid var(--axi-ink-line);
}
```

`--axi-ok` and not `--axi-accent`: "done" is a status the language has an ink for, and the accent is the theme. Task 12 flags this for the manual gate, since it is the one visible judgement call in this task.

`.title-input-group` (`:84-123`) loses its split radii and its two `color-mix` tints; `--success` and `--error` outline in `var(--axi-ok)` and `var(--axi-danger)` with a transparent background.

- [ ] **Step 3: Convert the publish ticker (`:305-434`)**

A rotating three-row step counter — a work indicator, so rule 4's animation
clause applies: compositor-only properties, and a `prefers-reduced-motion`
block. Check whether the existing scroll animates `transform` already:

```bash
sed -n '305,434p' src/renderer/styles/cards.css
```

If it animates `top` or `margin-top`, convert to `transform: translateY()`. Add, at the end of the section:

```css
@media (prefers-reduced-motion: reduce) {
  .publish-ticker__strip { animation: none; transform: none; }
}
```

The dismiss `×` at `:318-330` becomes `.axi-btn--icon` if batch 1 defined one — check `grep -n 'axi-btn--icon' node_modules/@axiapps/axi-design/dist/axi.css` first; if the package has no icon-button variant, keep the local rule and convert its colours only.

- [ ] **Step 4: Convert the share dropdown and build-code input (`:124-304`)**

The share dropdown is a `.axi-picker` by the same argument as Task 3 (Ruling B) — it lives in `cards.css`, which is this task's file, so convert it here. The build-code readonly input becomes `.axi-input` with `font-family: var(--axi-mono)`.

- [ ] **Step 5: Convert build-sources.css**

`.src-chip` (`:11-33`) is a `999px` pill with a `rgba(255,255,255,0.05)` fill; it becomes the square chip. The two loud variants at `:44-60` are accent at 14%/22% over the ground — the exact case rule 2 names. A foreign or external source is an annotation about where a build came from, not a judgement of it, so it **outlines**:

```css
.src-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 2px 7px;
  border: var(--axi-border-hairline) solid var(--axi-rule);
  background: transparent;
  color: var(--axi-text-faint);
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.src-chip:hover,
.src-chip:focus-visible { color: var(--axi-text); border-color: var(--axi-rule); outline: none; }

/* The two loud variants: a build sourced outside its comp's folder, and a
   build pulled into a comp that lives somewhere else. Same signal, both
   directions. They outline rather than fill, because where a build came from
   annotates it and does not judge it. */
.src-chip--foreign,
.src-chip--external { border-color: var(--axi-accent); color: var(--axi-accent); }
```

The file's header comment says the loud variants exist to "catch the eye in a list of twenty rows". An outline in the accent against a rule-grey outline still does that; verify it at the manual gate and say so in the commit if it does not.

`.comp-slot--foreign::after` (`:98-117`) is a 5px round corner dot with a `box-shadow` ring. It becomes a diamond — the same motif at the smallest size the language uses it:

```css
/* A comp slot is a 42px icon box with no room for a chip, so the fact becomes
   a corner mark. Rule 7's motif at its smallest: rotated, outlined in the ink
   line so it reads as a shape against whatever is behind it. */
.comp-slot--foreign::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 7px;
  height: 7px;
  transform: rotate(45deg);
  background: var(--axi-accent);
  border: var(--axi-border-hairline) solid var(--axi-ink-line);
  pointer-events: none;
}
```

- [ ] **Step 6: Retarget the two selectors Task 5 orphaned**

`build-sources.css:77-87` positions the chip inside `.lib-grid-card__header`, which no longer exists. Retarget to `.af-tile__head`:

```css
.af-tile__head .src-chip,
.lib-icon-item__label .src-chip { margin-left: auto; }
```

Verify nothing else in the repo still names the old class:

```bash
grep -rn 'lib-grid-card' src/
```

Expected: one remaining hit, in `skeleton.css`, which Task 12 owns. If there are others, fix them here.

- [ ] **Step 7: Convert the sources modal (`:145-393`)**

The matrix modal's scrim, dialog, table and expanded-row detail. The table at
`:295-335` is a table — `.axi-table`'s treatment, hairline row rules, control-weight header rule. The "make the outside-sourced rows findable" highlight at `:295` is currently a tint; it becomes a cap on the row's first cell, in the accent, the same 3px inset the library's pinned row uses.

- [ ] **Step 8: Enforce both files**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bborder-radius|color-mix' src/renderer/styles/cards.css src/renderer/styles/build-sources.css
```

Expected: no output. Then delete both from `PENDING` and run:

```bash
npx jest tests/unit/styles/ && npx jest
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/styles/cards.css src/renderer/styles/build-sources.css tests/unit/styles/axi-design-rules.test.js
git commit -m "style: convert cards.css and build-sources.css

The source chips outlined rather than filled: where a build came from
annotates it and does not judge it (rule 5). status-card--done fills,
because done is a status, and it caps rather than tinting the whole box.
The comp slot's corner dot becomes a diamond at the smallest size the
motif is used.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The stat strip, and the meter that replaces a traffic light

§3.1's obligation, discharged where the app already computes the numbers and
currently prints them as bare numerals or as a coloured dot.

Read **Ruling F** before starting: the template the approved control-weight
card was drawn from is dead code, and this task does not resurrect it.

**Files:**
- Modify: `src/renderer/styles/comps.css:547-573` (the boon indicator)
- Modify: `src/renderer/modules/comps/comp-list.js:415-440` (`renderBoonIndicator`)
- Modify: `src/renderer/styles/library.css` (add the stat strip; the file is already enforced, so the gate runs against your edit immediately)
- Modify: `src/renderer/modules/library/content.js` (emit the strip)
- Create: `tests/unit/renderer/boon-indicator.test.js`

**Interfaces:**
- Consumes: `.axi-stat`, `.axi-meter`, `.axi-ticks` (Task 1's bump made the last one exist).
- Produces: `.af-statstrip`. Nothing later depends on it.

- [ ] **Step 1: Write the failing test** (Review Focus 3 and 4)

Create `tests/unit/renderer/boon-indicator.test.js`:

```js
import { meterValue, tickRun } from "../../../src/renderer/modules/comps/comp-list.js";

describe("meterValue", () => {
  it("clamps to 0..100 and formats as a percentage", () => {
    expect(meterValue(0)).toBe("0%");
    expect(meterValue(63)).toBe("63%");
    expect(meterValue(100)).toBe("100%");
  });

  it("clamps out-of-range input rather than emitting it", () => {
    // A width over 100% on a flex fill overflows its track and paints over
    // the outline, so the bar reads as full AND broken.
    expect(meterValue(140)).toBe("100%");
    expect(meterValue(-10)).toBe("0%");
  });

  it("never emits NaN, which renders as a full bar in some engines", () => {
    for (const v of [NaN, undefined, null, "", "abc", {}]) {
      expect(meterValue(v)).toBe("0%");
    }
  });
});

describe("tickRun", () => {
  it("emits one mark per event, inked for the true ones", () => {
    const html = tickRun([true, false, true]);
    expect(html.match(/axi-ticks__tick\b/g)).toHaveLength(3);
    expect(html.match(/axi-ticks__tick--on/g)).toHaveLength(2);
  });

  it("renders an empty run as an empty strip, not as nothing", () => {
    // A row whose ticks cell collapses is a row that changes width, and a
    // table of them jitters as data loads.
    expect(tickRun([])).toContain("axi-ticks");
    expect(tickRun([])).not.toContain("axi-ticks__tick");
  });

  it("caps a long run and says it capped", () => {
    // Marks are a fixed width and never flex, so forty of them push the
    // column open rather than compressing.
    const html = tickRun(new Array(40).fill(true));
    expect(html.match(/axi-ticks__tick\b/g).length).toBeLessThanOrEqual(20);
    expect(html).toContain("+20");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/unit/renderer/boon-indicator.test.js`
Expected: FAIL — `meterValue` and `tickRun` are not exported.

- [ ] **Step 3: Write the two helpers in `comp-list.js`**

```js
/**
 * A percentage, clamped and formatted for --axi-meter-v.
 * Rule 9: a proportion is a length, so the number has to be a length the
 * layout can survive. An unclamped value overflows the track and paints over
 * its own outline; NaN renders as a full bar in some engines.
 * @param {unknown} n
 * @returns {string} e.g. "63%"
 */
export function meterValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0%";
  return `${Math.round(Math.min(100, Math.max(0, v)))}%`;
}

const TICK_CAP = 20;

/**
 * A run of yes/no as marks of one size, differing only in ink.
 * Rule 9 read the other way round: a fact has no magnitude, so drawing it as
 * a short bar would read as "a little bit", which is the same lie as a faded
 * fill. Marks never flex, so a long run is capped and the remainder counted.
 * @param {boolean[]} flags
 * @returns {string}
 */
export function tickRun(flags) {
  const all = Array.isArray(flags) ? flags : [];
  const shown = all.slice(0, TICK_CAP);
  const marks = shown
    .map((on) => `<span class="axi-ticks__tick${on ? " axi-ticks__tick--on" : ""}"></span>`)
    .join("");
  const rest = all.length - shown.length;
  return `<span class="axi-ticks">${marks}</span>${rest > 0 ? `<span class="af-ticks__more">+${rest}</span>` : ""}`;
}
```

- [ ] **Step 4: Replace the traffic-light dot with a meter**

`renderBoonIndicator` (`comp-list.js:415-440`) currently picks one of green / yellow / red and also writes `style="color:${textColor}"` into the markup — a colour literal in a style attribute, which the CSS gate does not scan and which no test would have caught.

Three inks that mean "high, medium, low" are a quantity drawn as intensity, which is exactly what rule 9 forbids. Replace with a length:

```js
function renderBoonIndicator(compId) {
  const cached = _boonCache.get(compId);
  if (!cached) {
    return `<span class="comp-list-row__boon" data-boon-id="${compId}">
      <span class="axi-meter" style="--axi-meter-v: 0%; --axi-meter-h: 10px"><span class="axi-meter__fill"></span></span>
      <span class="comp-list-row__boon-pct">--</span>
    </span>`;
  }
  const pct = cached.percentage;
  return `<span class="comp-list-row__boon" data-boon-id="${compId}">
    <span class="axi-meter" style="--axi-meter-h: 10px"><span class="axi-meter__fill" style="--axi-meter-v: ${meterValue(pct)}"></span></span>
    <span class="comp-list-row__boon-pct">${meterValue(pct)}</span>
  </span>`;
}
```

Note `--axi-meter-v` goes on the **fill**, not the track: the package reads it on `.axi-meter__fill`. Getting this wrong produces a meter that is always empty and nothing fails.

Then in `comps.css:547-573`, delete `.comp-list-row__boon-dot` and its four colour variants outright, and give the meter a width:

```css
/* ══ Boon Coverage Indicator ════════════════════════════════════════════ */
/* Rule 9: coverage is a proportion, so it is a length. It used to be one of
   three inks — green, yellow, red — which is a quantity drawn as intensity,
   and at a glance down a list of comps the three were only distinguishable
   from each other, never from "how much". */
.comp-list-row__boon {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.comp-list-row__boon .axi-meter { width: 54px; }
.comp-list-row__boon-pct {
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  color: var(--axi-text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

- [ ] **Step 5: Put the ticks where a run of yes/no already exists**

`comp-boon-coverage.js` computes per-line coverage against `BOON_DISPLAY_ORDER` — a fixed list of boons, each either covered by the party or not. That is a run of facts with no magnitude, which is `.axi-ticks`' exact case.

In the comp detail's party-line row, emit `tickRun(BOON_DISPLAY_ORDER.map((b) => lineBoonMap.has(b)))` beside the line label, with the run carrying the party's colour:

```html
<span class="af-boonticks" style="--axi-tick-w: 4px; --axi-ticks-gap: 2px"></span>
```

Add the one supporting rule to `comps.css`:

```css
.af-ticks__more {
  margin-left: 5px;
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  color: var(--axi-text-faint);
}
```

If the party-line row has no room for twenty marks at the widths the app actually renders, say so in the report rather than shrinking `--axi-tick-w` below 4px — below that the marks stop resolving and the run becomes a smear, which is the failure the package's own comment describes.

- [ ] **Step 6: The library header becomes stat tiles**

Spec §8: "the library header becomes `.axi-stat` tiles". The counts exist already — `getVisibleFolders().length`, `getVisibleBuilds().length`, `getVisibleComps().length`.

```css
/* A stat tile is flat on the ground inside its panel: an outline, no block.
   It is content, not something raised off the surface it sits on. */
.af-statstrip {
  display: flex;
  gap: 10px;
  padding: 12px 14px 0;
}
.af-statstrip .axi-stat { flex: 1 1 0; min-width: 0; }
```

Emit it from `content.js` above the view, with `.axi-stat__n` carrying the number and `.axi-stat__k` the label. Leave every tile in the default ink: the package's own comment is explicit that a tile coloured for emphasis is decoration impersonating status, and none of these three counts is a status.

- [ ] **Step 7: Run the suite**

```bash
npx jest
```

Expected: PASS, including the gate against `library.css`, which is enforced from Task 6.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/styles/comps.css src/renderer/styles/library.css src/renderer/modules/comps/comp-list.js src/renderer/modules/library/content.js tests/unit/renderer/boon-indicator.test.js
git commit -m "feat: draw the app's quantities as lengths

Boon coverage was one of three inks — green, yellow, red — which is rule 9's
exact prohibition: a quantity drawn as intensity. At a glance down a list the
three were distinguishable from each other and never from 'how much'. It is
now a meter. Party boon coverage, which is a run of facts with no magnitude,
becomes ticks. The library header becomes stat tiles.

Also removes an inline style='color:#…' from comp-list.js, which the CSS gate
does not scan and no test would have caught.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: comps.css, part one — the list

Toolbar, filters, tag chips, bulk bar, rows, badges, profession strip, empty
state, tag popover. `comps.css:1-700`.

**Files:**
- Modify: `src/renderer/styles/comps.css:1-697`
- Modify: `src/renderer/modules/comps/comp-list.js` (row templates, badge helpers)

**Interfaces:**
- Consumes: `professionSeriesStyle` (Task 2), `.axi-picker` (Task 1), the `.axi-chip` conventions from Task 4 — match them, do not invent a second chip.
- Produces: the converted comp list. Task 11 converts the detail view below it.

- [ ] **Step 1: Toolbar tiers, bulk bar and tag chips (`:1-322`)**

Tier 1 (`:15-132`) mirrors the library toolbar from Task 3 — read that section of `library.css` and match it declaration for declaration rather than writing a parallel treatment. The view toggle group (`:99-132`) is a run of `.axi-pill`s with `aria-pressed`, same as the library's.

Tier 2 filters (`:133-218`) and the tag filter chips (`:219-250`) become `.axi-pill`s. A tag pill is the case `--axi-pill-fill` exists for — a pressed pill fills with the colour of the thing it filters to — but a tag owns no colour, so leave the knob unset and let it fill with the accent.

The bulk selection bar (`:251-322`) is a status: a bar that appears when a selection exists. It fills, at panel weight, and caps the list it governs.

- [ ] **Step 2: Comp rows (`:323-459`)**

Rule 8: the eye runs down the timestamp column, so rows are drawn in rules. Use the same `.lib-list-row` treatment Task 4 wrote — hairline row rule, `--axi-surface-raised` on hover, no outline and no block per row. Keep the expanded/compact split (`:429-459`) as found; it is layout.

The pipe separator at `:392-398` becomes a diamond. A row's metadata separated by `·` or `|` is the app's most common small shape, and rule 7 says what it should be:

```css
/* Rule 7: the family bullet, at its metadata size. */
.comp-list-row__sep {
  display: inline-block;
  width: 5px;
  height: 5px;
  transform: rotate(45deg);
  background: var(--axi-text-faint);
  vertical-align: middle;
}
```

- [ ] **Step 3: Badges (`:460-508`)**

Five badges, all built the same wrong way: an ink at 12% over the ground inside the same ink at 30%. Rule 5 sorts them into two groups.

**Game mode annotates** — a comp is *for* WvW, which is not a judgement of it — so PVE and WVW outline. **Publish status judges** — published, draft and shared are states the comp is *in* — so those fill:

```css
.comp-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font: var(--axi-t-micro);
  letter-spacing: var(--axi-ls-micro);
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Annotations: what the comp is for. Outlined. */
.comp-badge--pve,
.comp-badge--wvw {
  border: var(--axi-border-hairline) solid var(--axi-rule);
  background: transparent;
  color: var(--axi-text-dim);
}
.comp-badge--wvw { border-color: var(--axi-meta); color: var(--axi-meta); }

/* Statuses: what state the comp is in. Filled. */
.comp-badge--published { background: var(--axi-ok); color: var(--axi-accent-ink); }
.comp-badge--shared { background: var(--axi-accent); color: var(--axi-accent-ink); }
.comp-badge--draft {
  border: var(--axi-border-hairline) solid var(--axi-rule);
  background: transparent;
  color: var(--axi-text-faint);
}
```

`--draft` outlines despite being a status, because draft is the *absence* of publication — filling it would make "not yet done" the loudest thing in the row. Flag this one for the manual gate in Task 12; it is the judgement call in this task.

`--axi-meta` on WvW and nowhere else: the package is explicit that `--axi-meta` is the one cool ink and is meta only, never a status. Game mode is meta.

- [ ] **Step 4: Profession icons strip (`:509-546`)**

The 22px icon boxes take `color: var(--axi-series, var(--axi-text-dim))`, with the series set per-icon in the template from `professionSeriesStyle`. The empty-slot box at `:540-546` keeps its dash at `var(--axi-border-hairline) dashed var(--axi-rule)`.

This is the shape that most rewards the change: a row of eight profession icons in eight real colours says what a comp is at a glance, and today they are all `fill: var(--text)`.

- [ ] **Step 5: Empty state (`:574-613`) and tag popover (`:614-697`)**

The empty state takes `font: var(--axi-t-body)` for the title and `--axi-t-small` for the sub. The popover is a raised surface: panel border plus the 6px offset block, no radius, and — like `.axi-picker__pop` — it must be positioned `fixed` from script if any ancestor clips, or the block is the first thing to go.

- [ ] **Step 6: Verify the range is clean**

```bash
sed -n '1,700p' src/renderer/styles/comps.css | grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bborder-radius'
```

Expected: no output. Then `npx jest`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles/comps.css src/renderer/modules/comps/comp-list.js
git commit -m "style: convert the comp list

The five badges were all built the same way — an ink at 12% inside the same
ink at 30% — and rule 5 splits them in two: game mode annotates what a comp
is for, so it outlines; published and shared are states the comp is in, so
they fill. Draft stays outlined because draft is the absence of publication,
and filling it would make 'not yet done' the loudest thing in the row.

The profession strip now carries eight real colours instead of eight
identical grey glyphs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: comps.css, part two — the detail view, and the file leaves PENDING

Top bar, share dropdown, tags row, tabs, the 40/60 body, party lines, slot
boxes, the build pool, category chips, the picker modal and the drag ghosts.
`comps.css:698-2805`.

**Files:**
- Modify: `src/renderer/styles/comps.css:698-2805`
- Modify: `src/renderer/modules/comps/comp-detail.js` (slot colours move to `--axi-series`)
- Modify: `tests/unit/shared/professions.test.js` (drop the last skip)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (`PENDING` loses `comps.css`)

**Interfaces:**
- Consumes: everything Tasks 2, 4 and 10 produced.
- Produces: `comps.css` enforced; `PENDING` down to the batch-3/4/5 files.

- [ ] **Step 1: Top bar, share dropdown, tags row (`:698-972`)**

The share dropdown is a `.axi-picker` (Ruling B). The tags row's hidden-until-hovered behaviour at `:927-972` **stays exactly as it is** — that comment records a deliberate decision ("a row of tags is something you read far less often than the name above it"), and Global Constraint 10 puts it out of scope.

- [ ] **Step 2: Tabs (`:973-1019`) become `.axi-tabs`**

The package ships this shape. The active tab currently fills with `--hover-accent` and inks its label in the accent — a tinted surface, rule 2's case. `.axi-tabs a[aria-current="page"]` is the package's answer; use it and delete the local `--active` rule.

The notes dot at `:1009-1019` is a diamond:

```css
/* Rule 7 again, marking a tab that has something behind it. */
.comp-detail__tab-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 7px;
  transform: rotate(45deg);
  background: var(--axi-accent);
  vertical-align: middle;
}
```

- [ ] **Step 3: Party lines and the slot box (`:1075-1265`)**

The 40/60 body split and the drag affordances keep every dimension. `.comp-slot` loses its radius; `--filled` takes the control weight, `--empty` and `--missing` keep their dashes at `var(--axi-border-hairline) dashed var(--axi-rule)`.

`.comp-slot--filled:hover` at `:1213-1216` uses `box-shadow: 0 0 0 1px rgba(255,255,255,0.1)` — a ring, which is rule 4's forbidden glow. A filled slot is a control with no resting block, so it takes the first hover case:

```css
.comp-slot--filled:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--axi-offset-control) var(--axi-offset-control) 0 var(--axi-ink-line);
}
```

Add `transition: transform .1s, box-shadow .1s` to `.comp-slot--filled` and delete the old `transition: background, box-shadow`.

The round icon mask at `:1244-1252` (`border-radius: 50%`) becomes square. A circular profession glyph inside a square outlined slot is the only round thing left on the screen once this batch lands.

- [ ] **Step 4: Delete the palette's last copy (`:1266-1280`)**

Delete the nine `.comp-slot--filled.lib-prof--*` rules and the two `[data-slot-color]` overrides. Replace with:

```css
/* The profession's colour on the slot's outline — the one place in the app
   an outline carries domain colour, because here the outline IS the
   identification: a 42px box has no room for a strip or a label. */
.comp-slot--filled { border-color: var(--axi-series, var(--axi-ink-line)); }
```

The two `[data-slot-color="red"|"blue"]` overrides existed to beat `.lib-prof--*` on specificity. They are Condi and Heal markers — domain data with their own colours — so they become a `--axi-series` the template sets instead, and the specificity problem disappears with the classes that caused it. In `comp-detail.js`, resolve the slot's colour once:

```js
const slotSeries = slot.color === "red" ? "--axi-series: #d63a3a"
  : slot.color === "blue" ? "--axi-series: #3a8fd6"
  : professionSeriesStyle(build?.profession);
```

Those two hexes are the last colour literals to place. They are domain data by the same argument as the professions, so move them into `src/shared/professions.js` beside the nine:

```js
/** Role markers a comp slot can be flagged with, overriding the profession. */
const SLOT_ROLES = Object.freeze({ red: "#d63a3a", blue: "#3a8fd6" });

/** A `style` body for a slot: the role marker if flagged, else the profession. */
export function slotSeriesStyle(role, profession) {
  if (Object.prototype.hasOwnProperty.call(SLOT_ROLES, role)) {
    return `--axi-series: ${SLOT_ROLES[role]}`;
  }
  return professionSeriesStyle(profession);
}
```

and call `slotSeriesStyle(slot.color, build?.profession)` from the template. Add a case to `tests/unit/shared/professions.test.js` asserting the role wins over the profession and that an unknown role falls through to it.

**Note for a reviewer:** this puts two non-profession hexes in a file named `professions.js`. The alternative — a second module for two values — is worse, and the file's docstring already frames it as "the colours domain data owns". If a reviewer disagrees, renaming the module is a one-line change and this plan does not defend the name.

- [ ] **Step 5: Build pool, category chips, picker modal, drag ghosts (`:1282-2805`)**

Mechanical, and the largest single stretch in the batch. Work top to bottom.
- The pool list rows sit **inside** a panel that already carries a 6px block, so anything raised in here is at **control** weight — 3px border, 3px block. 6px nested in 6px reads as two planes arguing rather than as the contents of a box.
- `.comp-picker-modal` (`:1645-1655`) is a modal sheet: panel border, 6px offset block, `var(--axi-scrim)` behind it. Batch 4 converts the other ten sheets and will copy whatever you do here, so match `.axi-drawer`/`.axi-panel` rather than inventing.
- The category chips' SortableJS ghost (`:1434-1457`) and the pool card ghost (`:1883-1960`) keep their `opacity` — drag ghosts are ghosts — and lose their radii and shadows.
- `.comp-pool-card` ghost's "styled to look like a filled slot box" comment at `:1883` is a contract with Step 3; if you changed the slot box's border weight, change this to match or the ghost stops resembling what it is dragging.
- The slot hover card (`:1962-2000`) is a tooltip and must be portaled to `<body>` per rule 4 — the app has a `--z-tooltip` layer already. If it is not portaled today, that is a behaviour change and therefore **out of scope**: convert its colours, leave its positioning, and record it in the report for Task 12 to park.

- [ ] **Step 6: Drop the last skip and enforce the file**

In `tests/unit/shared/professions.test.js`, delete the `comps.css` skip line, leaving the walk covering all of `src/` except `src/site` (batch 5).

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bborder-radius|color-mix' src/renderer/styles/comps.css
```

Expected: no output. Then delete `"src/renderer/styles/comps.css"` from `PENDING`.

- [ ] **Step 7: Run everything**

```bash
npx jest
```

Expected: PASS. `PENDING` is now the batch-3/4/5 files plus `skeleton.css`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/styles/comps.css src/renderer/modules/comps/comp-detail.js src/shared/professions.js tests/unit/shared/professions.test.js tests/unit/styles/axi-design-rules.test.js
git commit -m "style: convert the comp detail view, and comps.css leaves PENDING

The slot box is the one place an outline carries domain colour: at 42px
there is no room for a strip or a label, so the outline is the
identification. The two [data-slot-color] overrides existed only to beat
.lib-prof--* on specificity; with those classes gone the override becomes a
--axi-series the template sets, and the specificity problem goes with them.

The filled slot's hover ring was a glow, which rule 4 forbids; it is now the
ordinary control lift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: skeleton.css, and close the batch

The last file, the gate's final state, and the handover to batch 3.

**Files:**
- Modify: `src/renderer/styles/skeleton.css` (all 488 lines)
- Modify: `tests/unit/styles/axi-design-rules.test.js` (`PENDING` loses `skeleton.css`)
- Modify: `docs/BACKLOG.md` (park what this batch found and did not fix)

**Interfaces:**
- Consumes: `.af-tile__head` (Task 5 — `skeleton.css:474` targets the deleted `.lib-grid-card__spec-icon`).
- Produces: `PENDING` reduced to batch 3, 4 and 5's files only.

- [ ] **Step 1: Convert skeleton.css's colours, and nothing else** (Ruling D)

Every width, height, padding and `grid-template` in this file is a measurement against a real screen, recorded in a `/* matches .spec-card__panel */` comment. Two thirds of those screens convert in **batch 3**, so their measurements will change. Convert colour, radius, shadow and animation; **change no dimension**.

The shimmer at the head of the file animates a gradient. A gradient used to draw a moving highlight is not a surface gradient, but rule 4's animation clause still applies — compositor-only properties and a reduced-motion block:

```css
.skel {
  background: var(--axi-surface-raised);
  border: var(--axi-border-hairline) solid var(--axi-rule);
}

/* A loading placeholder pulses rather than sweeping: a sweep needs a
   gradient travelling across a surface, and the one compositor-only property
   that can carry it here is opacity on a flat block. */
@keyframes af-skel {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.skel { animation: af-skel 1.4s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .skel { animation: none; opacity: 1; }
}
```

The hexagonal clip-path at `:18-23` stays — it matches `specializations.css`'s minor trait shape, which is game iconography, not a corner.

Retarget `:474` from `.lib-grid-card__spec-icon` to `.af-tile__glyph`, and `:466` if it names a class Task 4 renamed. Verify:

```bash
grep -rn 'lib-grid-card\|lib-pill' src/
```

Expected: no output anywhere in `src/`.

- [ ] **Step 2: Add the handover note at the head of the file**

```css
/* AxiForge — skeleton loading placeholders
 *
 * Batch 2 converted this file's colours so it could come under the rules
 * gate; its DIMENSIONS were deliberately left alone. Every "matches .foo"
 * comment below is a measurement against a screen that specializations.css,
 * skills.css, equipment.css and detail-panel.css still own, and those
 * convert in batch 3. Re-fit the measurements there, in the same task that
 * changes the shape each one mirrors.
 */
```

- [ ] **Step 3: Enforce the file**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\bborder-radius|linear-gradient' src/renderer/styles/skeleton.css
```

Expected: no output. Delete `"src/renderer/styles/skeleton.css"` from `PENDING`.

- [ ] **Step 4: Confirm the gate's final state**

```bash
npx jest tests/unit/styles/
```

Then read the two lists back and check them against what this batch promised:

```bash
sed -n '/^const PENDING/,/^\]/p' tests/unit/styles/axi-design-rules.test.js
grep -n 'PENDING_JS = ' tests/unit/styles/axi-design-rules.test.js
```

Expected — `PENDING` holds exactly these twenty, and no others:

```
specializations.css  skills.css  detail-panel.css  equipment.css  notes.css   (batch 3)
wiki-modal.css  detail-modal.css  confirm-modal.css  whats-new-modal.css
import-conflict-modal.css  share-modal.css  smart-folder-modal.css
team-modal.css  settings-modal.css                                            (batch 4)
forge-render-bridge.css  web.css  web-mobile.css  site/styles.css
site-mobile.css  forge-render.css                                             (batch 5)
```

and `PENDING_JS = []`.

If `PENDING_JS` is not empty, Task 7 did not land and Global Constraint 11 is violated: the gate is green over live gradients. Stop and fix it before committing.

- [ ] **Step 5: Run the full suite**

```bash
npx jest
```

Expected: PASS, all suites. Record the suite and test counts in the report.

Do **not** run Playwright. E2E is release-only in this repo; batch 5 runs it.

- [ ] **Step 6: Park what this batch found and did not fix**

Append to `docs/BACKLOG.md`, with evidence inline rather than as a pointer into the plan workspace — the workspace is git-ignored and deleted when the batch closes:

```markdown
### Parked from the batch 2 conversion

- **`renderBuildList()` is dead code.** `src/renderer/modules/render-pages.js:175`
  returns immediately on `if (document.getElementById("lib-content")) return;`,
  and `#lib-content` is unconditionally present at `src/renderer/index.html:416`.
  Lines 179-323 have therefore never run since the library module landed. The
  `.build-card*` classes they emit have no CSS anywhere in the repo — confirmed
  with `grep -rn '\.build-card' src/ packages/ --include=*.css`, zero hits — so
  the dead branch also renders unstyled. `renderer.js:288` queries `#buildList`,
  which is not in `index.html` either, so `_el.buildList` is null. Deleting it is
  a refactor and was out of batch 2's scope (Global Constraint 10). ~145 lines.
- **`custom-select.css` should adopt `.axi-picker`.** Batch 1 converted it
  against axi-design 1.8.0, where the native `<select>` popup is OS chrome the
  language cannot reach — no ink outline, no offset block, its own selection
  colour. 1.10.0 added `.axi-picker` for exactly this case, and Electron is the
  case. Batch 2 adopted it in the library and comps dropdowns only (Ruling B);
  batch 4 owns the modals where the rest of the selects live.
- **The comp slot's hover card may not be portaled.** Rule 4 requires tooltips
  at `<body>`; `comps.css:1962-2000` styles one positioned relative to its slot.
  Moving it is a behaviour change, so batch 2 converted its colours only.
- **Decisions taken in batch 2 that want a human eye at the running app:**
  `.status-card--done` caps in `--axi-ok` rather than the accent (done is a
  status the language has an ink for); `.comp-badge--draft` outlines while
  `--published` and `--shared` fill (draft is the absence of publication, and
  filling it would make "not yet done" the loudest thing in the row);
  `.src-chip--foreign` outlines in the accent rather than filling, and its file
  header claims the variant exists to "catch the eye in a list of twenty rows"
  — check that it still does.
```

- [ ] **Step 7: Render the converted screens for review**

Build a preview page under `.superpowers/preview/` linking the real package
CSS and the converted app stylesheets, showing: the library grid with six
profession tiles, the library list and table views, a comp row with its badge
set and its meter, the comp detail's slot grid, and the history timeline's
diamonds. Render it in-app rather than writing screenshots to disk.

This is the batch's design review. The mechanical gate says no rule is broken;
only the render says whether the screens have a voice, which is what §3.1
exists to ask.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/styles/skeleton.css tests/unit/styles/axi-design-rules.test.js docs/BACKLOG.md
git commit -m "style: convert skeleton.css and close batch 2

Colours only: every dimension in this file is a measurement against a screen
batch 3 still owns, recorded in a 'matches .foo' comment, and re-fitting them
before those screens change would be measuring against the old shape twice.

PENDING is down to batch 3, 4 and 5's twenty files. PENDING_JS is empty, so
every stylesheet in the desktop renderer — including the two built as strings
in JS — is under all nine scanners.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Ruling F — the approved control-weight card's template is dead code

Discovered while writing Task 9, and it corrects Ruling C.

The card anatomy settled against the live render was drawn from
`.build-card` in `render-pages.js:228-238` — the one template in the app whose
every row ends in a verb. It is unreachable. `renderBuildList()` opens with
`if (document.getElementById("lib-content")) return;`, `#lib-content` is
unconditionally present in `index.html:416`, and the app has exactly three
pages: library, comps, editor. There is no builds page. `grep -rn '\.build-card'`
across `src/` and `packages/` for CSS returns **zero hits**, so even if the
branch ran it would render unstyled — which is consistent with it having been
dead since the library module replaced it.

What this changes, and what it does not:

- **The panel-weight strip tile is unaffected and lands in Task 5.** It is the
  half of the approved anatomy with a live home — the library grid — and it is
  the batch's centrepiece.
- **The control-weight card is not resurrected onto a dead template.** Its
  weight argument still governs, and it governs where the condition that
  produced it is actually true: anything raised *inside* a panel that already
  carries a 6px block takes the control weight. That is the comps build pool
  (Task 11 Step 5), and the plan says so there.
- **The dead code is not deleted.** Deleting ~145 lines of unreachable renderer
  is a refactor, and Global Constraint 10 rules it out of a reskin. It goes to
  `docs/BACKLOG.md` in Task 12 with the evidence inline.

*Cost if wrong:* if `renderBuildList` turns out to be reachable in a
configuration nobody checked — a web build with a different `index.html`, say —
then the home page keeps rendering the unstyled cards it renders today, which
is not a regression this batch introduced. Verify before acting on the backlog
entry: `grep -rn 'lib-content' src/web/ src/site/`.

---

## Task Order and Dependencies

```
1  package bump ──┬─> 3  toolbar/filters/sidebar ──┐
                  │                                 │
2  professions ───┼─> 4  list + table views ────────┼─> 6  library remainder → PENDING
                  │                                 │
                  ├─> 5  grid becomes the card ─────┘
                  │
                  ├─> 7  injected sheets → PENDING_JS = []
                  ├─> 8  cards.css + build-sources.css → PENDING
                  ├─> 9  stat strip + meter + ticks
                  ├─> 10 comps list ──┐
                  └─> 11 comps detail ┴─> comps.css → PENDING
                                            │
                                            └─> 12 skeleton.css + close
```

Hard orderings, and nothing else:
- **1 before 9 and 10** — `.axi-ticks` and `.axi-picker` do not exist until the bump.
- **2 before 3, 4, 5, 10, 11** — they all import from `professions.js`.
- **5 before 8 and 12** — both retarget selectors Task 5 orphans (`.lib-grid-card__header`, `.lib-grid-card__spec-icon`).
- **3, 4, 5 before 6** — Task 6 is "everything in `library.css` nobody else claimed", and it enforces the file.
- **7 before 12** — Global Constraint 11. Task 12 Step 4 fails loudly if this is violated.
- **10 before 11** — Task 11 matches conventions Task 10 sets, and drops the `comps.css` skip Task 10 still needs.
- **9 after 10** is *not* required, but is easier: Task 9 edits `comps.css:547-573`, which Task 10 also touches. If they run out of order, expect a small conflict in the boon indicator block and resolve it toward Task 9's version, which is the one with the meter.

Tasks **7, 8 and 9** are independent of the library chain and of each other.

---

## Ruling G — two of the spec's batch-2 items live in other batches' files

Found during the spec-coverage pass. Both are cases where spec §8 names a
*screen* and the screen's CSS turns out to sit in a file another batch owns.
Neither changes what batch 2 builds; both are recorded so the next planner does
not read them as gaps.

**"`mini-build-card`'s desktop rules."** `src/renderer/modules/mini-build-card.js`
is one line — a re-export of `packages/forge-render/src/mini-build-card.js`. The
classes it emits are `.mini-card*`, and every one of them is styled in
`packages/forge-render/src/forge-render.css`, which reaches the desktop renderer
through `src/renderer/styles/forge-render-bridge.css`. Both of those files are
on `PENDING` as **batch 5** work, and batch 5 already owns `forge-render.css` by
name. Converting them here would mean converting the shared package for the
desktop app's benefit and then converting it again for the web and the SPA.
They stay in batch 5. *Cost if wrong:* the mini card is the last unconverted
shape in the desktop app for the length of batches 3 and 4, visible inside the
comps build pool.

**"Attribute weighting inside a build becomes `.axi-meter-list`."** Attribute
weighting is drawn by `src/renderer/styles/equipment.css` — a **batch 3** file,
and one of the five spec §8 names for batch 3. The obligation is real and it is
`.axi-meter-list`'s clearest home in the app; it belongs in batch 3's plan, in
the task that converts `equipment.css`. Batch 2 discharges rule 9 on the data it
does own: boon coverage as `.axi-meter`, party boon presence as `.axi-ticks`
(Task 9). *Cost if wrong:* nothing in batch 2; batch 3's plan must carry it, and
this ruling is where that requirement is written down.

---

## Spec Coverage

Every spec §8 batch-2 item, and the task that discharges it.

| Spec requirement | Task |
|---|---|
| `library.css` converted | 3, 4, 5, 6 |
| `comps.css` converted | 10, 11 |
| `cards.css` converted | 8 |
| `build-sources.css` converted | 8 |
| `skeleton.css` converted | 12 |
| `mini-build-card`'s desktop rules | **deferred to batch 5 — Ruling G** |
| Rule 8 decides each list | 4 (list, table, comp rows), 10 (comp list) |
| A build row is a card at control weight | **Ruling F** — its template is dead; the weight argument lands in 11 |
| A grid tile is a card at panel weight, strip capping the head | 5 |
| Profession colour full-strength via `--axi-series`, never on the outline | 2, 4, 5, 10; 11 states the one deliberate exception and why |
| The meta line uses the diamond as separator | 10 |
| The tile's meta rule on `margin-top: auto` | 5 |
| The library header becomes `.axi-stat` tiles | 9 |
| Attribute weighting becomes `.axi-meter-list` | **deferred to batch 3 — Ruling G** |
| The nine `.lib-pill--prof` rules deleted, not retokenised | 4 |
| §3.1 rule 7 — the diamond appears | 3 (breadcrumb), 4 (profession bullet), 7 (timeline), 8 (slot corner), 10 (row separator), 11 (tab dot) |
| §3.1 rule 9 — quantities drawn as length | 9 (`.axi-meter`, `.axi-ticks`) |
| §3.1 rule 10 — domain palette per-instance | 2 (the module), 4/5/10/11 (the call sites) |
| Global Constraint 11 — `PENDING_JS` empties with `library.css` | 7, verified in 12 Step 4 |
| `PENDING` reduced to batches 3-5 | 6, 8, 11, 12 |
