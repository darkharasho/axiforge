# Converting AxiForge to the axi design language

**Date:** 2026-09-23
**Status:** design, approved in conversation; not yet planned
**Normative reference:** `../axi-design/docs/RULES.md` (11 rules + token/theming
sections). Where this document and RULES.md disagree, RULES.md wins.
**Reference conversion:** `../axiam` — `src/index.css`, `src/themes/`,
`src/components/SettingsModal.tsx`, `src/components/Tooltip.tsx`.

## 1. Intent

AxiForge should look like it belongs to the same family as AxiAM: flat,
outlined, square-cornered, every raised thing drawn with a hard offset block
instead of a blur. Today it is the opposite house style — 14px radii, blurred
drop shadows, panel gradients, accent-at-12%-opacity hovers, and an ambient
animated radial-gradient wash behind the whole page.

This is a **reskin, not a refactor**. Behaviour, IPC, state, data shapes and
user-visible flows stay identical. Markup changes only where adopting a
package component requires it (a `<button class="btn btn-secondary">` becoming
`<button class="axi-btn">`), never to restructure a feature.

Success: every screen of the desktop app, the web playground and the published
SPA reads as one system with AxiAM; `npm test` is green; and a literal-scan
grep over the app's own CSS returns nothing.

## 2. Scope

**In scope — the three consumer surfaces and the card library they share:**

| Surface | Entry | CSS |
|---|---|---|
| Desktop renderer | `src/renderer/index.html` | `src/renderer/styles.css` + 26 partials (~13.5k lines) |
| Web playground (build.axi.link) | `src/web/main-web.js` | shares the renderer sheet; overlays `web.css`, `web-mobile.css` |
| Published SPA | `src/site/index.html` | `src/site/styles.css`, `site-mobile.css` |
| Shared card renderer | — | `packages/forge-render/src/forge-render.css` (853 lines) |

**Out of scope, explicitly:**

- **AxiVale and AxiBridge.** They embed `forge-render`, so its conversion
  changes their appearance (see §6). Converting *their* chrome is a separate
  project.
- Marketing assets in `marketing/`. Screenshots are regenerated once at the
  end; the copy and layout of the marketing site are not touched.
- Any behavioural change, feature, or refactor. Items noticed along the way go
  to `docs/BACKLOG.md`, not into this work.

## 3. Hard constraints

Restated from RULES.md because every batch is checked against them:

1. **No colour literal in app CSS.** Every colour resolves through an
   `--axi-*` token. The only sanctioned homes for a hex are the package's
   `tokens.css` and `accents.json`.
2. **No gradient on a surface, no colour at partial opacity over the ground,
   no glow, no blur, no radius.** `--axi-radius` and `--axi-radius-sm` are `0`.
3. **Two form steps only.** Panel = `--axi-border-panel` / `--axi-offset-panel`;
   control = `--axi-border-control` / `--axi-offset-control`.
   `--axi-border-hairline` is a prose rule weight, not a third step.
4. **Every `box-shadow` is exactly** `<offset> <offset> 0 var(--axi-ink-line)`
   with the offset from the four enumerated tokens. No `filter: drop-shadow`,
   no `text-shadow`.
5. **Hover lifts**: `translate(-2px,-2px)` + gain/deepen the block for a
   control; `translate(-3px,-3px)` + 6px→10px for a panel. Never opacity,
   never a glow.
6. **Filled = status, outlined = annotation.** Status caps the thing it judges
   (a top bar), never a full-height stripe.
7. **Work indicators animate `transform`/`opacity` only**, and a
   `prefers-reduced-motion` block kills all animation while leaving state
   legible.
8. **Type through the tokens**: `font: var(--axi-t-*)` with the paired
   `letter-spacing: var(--axi-ls-*)`; eyebrows use `.axi-eyebrow`.

Two consequences worth naming up front, because they delete features users can
see today:

- `body::before` — the animated ambient radial-gradient wash in `base.css` —
  is removed outright. It is a gradient across the ground at partial opacity,
  which rules 1 and 2 both forbid. AxiAM's equivalent is `.am-mark`: a static
  solid-`--axi-surface` shape drawn through a mask. AxiForge gets the same
  treatment with its own wordmark.
- The 8 full themes lose their backgrounds (§5).

## 4. Architecture

### 4.1 Import order

`npm install @axiapps/axi-design` — AxiAM is on `^1.8.0`, resolved from the
public npm registry, so a plain install works with no linking. In each entry, the
package comes first and the app layer second:

- `src/renderer/index.html` — two `<link>`s to `axi.css` then `accents.css`
  ahead of `./styles.css`.
- `src/web/main-web.js` — `import '@axiapps/axi-design/axi.css'` then
  `accents.css`, before the existing `./web.css` import.
- `src/site/index.html` — same pair ahead of `styles.css`.

The three Google font `<link>`s are deleted from all entries (§7).

### 4.2 File layout

`src/renderer/styles.css` keeps its role as the manifest. `base.css` and
`themes.css` are deleted. In their place:

- `styles/app.css` — the app layer, AxiAM's `index.css` for this app: window
  plumbing, the frameless inward-inset trick, `.draggable`/`.no-drag`,
  scrollbars, `.theme-transitioning`, the reduced-motion block, and the
  `af-`-prefixed shapes shared across screens.
- `styles/bridge.css` — **temporary**, see §4.3.

Every converted partial keeps its filename and screen ownership, is rewritten
under the **`af-`** prefix, and composes only tokens. Partials are rewritten in
place rather than added alongside: the old rules are deleted as each screen
converts, so the sheet never carries two styles for one element.

### 4.3 The bridge

`bridge.css` re-points the old variable names at axi tokens, so that screens
not yet converted keep rendering — flat, on the right ground, wrong in detail,
but usable and reviewable:

```css
/* TEMPORARY. Every name here is a screen not yet converted. Deleted in batch 5. */
:root {
  --bg: var(--axi-ground);
  --panel: var(--axi-surface);
  --panel-2: var(--axi-surface);
  --line: var(--axi-ink-line);
  --text: var(--axi-text);
  --text-dim: var(--axi-text-faint);
  --accent: var(--axi-accent);
  --radius: 0; --radius-sm: 0; --radius-xs: 0;
  --shadow-sm: none; --shadow-md: none; --shadow-lg: none;
  --panel-gradient: var(--axi-surface);
  /* ... */
}
```

It has two jobs: keep the app usable mid-conversion, and serve as the
checklist — whatever remains in it names the screens still to do. **Batch 5
deletes the file**, and the build failing without it is the proof no converted
screen still depends on a legacy name.

`--accent-rgb` is the one legacy name the bridge cannot honour: it is an
`R, G, B` triple that existing rules interpolate into `rgba(...)` at partial
opacity, which is the thing rule 2 forbids. Rather than keep it alive, every
`rgba(var(--accent-rgb), …)` use is converted in the batch that owns it, and
the bridge deliberately leaves `--accent-rgb` undefined so those rules fail
visibly (transparent) rather than silently. This is the one place the app looks
broken mid-conversion, and it is deliberate: it makes the remaining work
visible instead of plausible.

## 5. The accent subsystem

### 5.1 What replaces 17 themes

axi-design themes one variable, `--axi-accent`, against a single fixed ground.
The 8 full themes and 9 profession themes therefore collapse to accent-only
selections. Users keep a themed app and keep per-profession tinting; they lose
the per-theme *backgrounds*.

New module `src/renderer/modules/accents.js`, modelled on AxiAM's
`src/themes/accents.ts`: it imports `@axiapps/axi-design/accents.json` as the
single source of ids, labels and hexes, and exports `ACCENTS`,
`DEFAULT_ACCENT_ID = 'axi-gold'`, and `resolveAccentId(id)`.

`LEGACY_THEME_TO_ACCENT` covers every id persisted by a pre-conversion
version. The full and accent themes map by their own swatch:

| Legacy id | Accent |
|---|---|
| `""` (Golden Amber, default) | `axi-gold` |
| `molten-core` | `amber-warm` |
| `cinderfall` | `crimson-red` |
| `frostforge` | `refined-cyan` |
| `verdant-crucible` | `emerald-mint` |
| `copper` | `gold-bronze` |
| `rose-gold` | `rose-pink` |
| `cobalt` | `electric-blue` |
| `mithril` | `slate-silver` |

The professions map by the hue each already uses in `themes.css`:

| Profession | Current `--gold` | Accent |
|---|---|---|
| Guardian | `#78b0f0` | `electric-blue` |
| Warrior | `#f09030` | `amber-warm` |
| Engineer | `#c89040` | `gold-bronze` |
| Ranger | `#70c048` | `emerald-mint` |
| Necromancer | `#50c080` | `teal-ocean` |
| Thief | `#c87080` | `rose-pink` |
| Mesmer | `#a880c8` | `violet-purple` |
| Elementalist | `#d06050` | `crimson-red` |
| Revenant | `#b05050` | `crimson-red` |

Elementalist and Revenant share `crimson-red` because their current colours
are near-identical reds (`#d06050`, `#b05050`) and the palette has one red at
that hue; Necromancer takes the cooler green so it stays distinguishable from
Ranger.

### 5.2 Applying an accent

`applyAccent(id)` in `src/renderer/modules/accents.js` mirrors AxiAM's
`applyTheme.ts`: resolve the id, add `.theme-transitioning` to `<html>`, set
`data-axi-accent`, and drop the class after 500ms on a single shared timer.
The five call sites in `renderer.js` (lines ~436, ~650, ~1167–1189) and
`settings-modal.js` (~385) are re-pointed at it; the `prof-`-prefix checks that
stash and restore a user's chosen theme during profession tinting become
`data-axi-accent` comparisons against the stashed id. **The stash/restore
behaviour itself does not change.**

Persistence keeps the existing `appearance.theme` setting key and keeps storing
whatever id the user picked; `resolveAccentId` absorbs old values on read. No
migration writes to the store, so downgrading to a previous version still
works.

### 5.3 The publish boundary

Theme ids are persisted *data*, not only a local preference:
`src/main/index.js:63` maps profession → `prof-*` when publishing, and
`src/site/main.js:16` re-applies the id on the published page. Both are
converted to emit and consume accent ids, and `src/site/main.js` gets the same
`resolveAccentId` map so a page published by an older version still themes
correctly. The `appearance.themedBuildPages` setting keeps its meaning.

### 5.4 The picker

`settings-modal.js`'s `THEMES` array is deleted. The Appearance grid is
rebuilt from `ACCENTS`, so the ids and labels come from the package. Its
swatch currently interpolates a hex into `style="background:…"` in JS — the
one colour literal that legitimately survives, because it is read from
`accents.json`, the sanctioned data source, and set per-instance with a
`style` attribute rather than written into a stylesheet. The `Full`/`Accent`
type tag is removed; the distinction no longer exists. Cards become
`.axi-card`s with the package's control-weight block, and the active card is
marked with an accent outline, not a glow.

## 6. forge-render and AxiVale

`forge-render.css` namespaces its variables `--fr-*` with baked-in AxiForge
dark defaults, specifically so embedding apps cannot collide with it. That
design is what makes this tractable: **the `--fr-*` names stay**, and each is
re-pointed to an axi token with the current literal kept as the fallback —
`--fr-panel: var(--axi-surface, #141518)`. An app that imports `axi.css`
(AxiForge, after this work) gets the converted look; AxiVale and AxiBridge,
which do not, keep rendering exactly as they do today.

Form — radius, shadow, outline weight — is *not* made conditional: those become
flat outlined blocks unconditionally, because a half-converted card is worse
than either end state. So AxiVale's embedded cards do change shape, while
keeping their palette. That is a deliberate, stated cost; AxiVale's own
conversion is the follow-up that resolves it, and this is recorded in
`docs/BACKLOG.md` when the batch lands.

## 7. Typography

The three webfonts — Cinzel, Outfit, DM Sans — are dropped: the `<link>`s in
all three entries, and the ~12 `font-family` declarations across
`layout.css`, `forms.css`, `equipment.css`, `specializations.css`, `skills.css`,
`cards.css`, `site/styles.css` and `site-mobile.css`. Every one becomes a
`font: var(--axi-t-*)` + `letter-spacing: var(--axi-ls-*)` pair; the
uppercase-tracked section headings become `.axi-eyebrow`; the app wordmark uses
the package's `.axi-brand` / `.axi-sigil`.

Side effect worth stating: the renderer and every published page stop fetching
`fonts.googleapis.com` at startup, which removes a remote origin from both the
Electron app and the published pages.

## 8. Batches

Each batch: convert, delete the old rules, shrink the bridge, run the gates
(§9), render for review, commit. One branch, `feat/axi-design`, one commit per
batch.

**Batch 1 — foundation and chrome.** `package.json`; the three entries;
`base.css` + `themes.css` deleted; `app.css` and `bridge.css` created;
`accents.js` + the picker + the publish-boundary ids; then `layout.css`
(titlebar, left nav, subnav, pages), `buttons.css`, `forms.css`,
`custom-select.css`. This batch sets every pattern the rest of the app copies —
window, panel, button, input, select, nav item, eyebrow — and is the one to
review closely.

**Batch 2 — library and comps.** `library.css` (2,321) and `comps.css` (2,805),
the two largest files, plus `cards.css`, `build-sources.css`,
`mini-build-card`'s desktop rules and `skeleton.css`. Rule 8 and its
counterpart decide each list: the library's build rows end in a verb, so they
are a stack of control-weight cards; the stat tables inside a build are drawn
in rules.

**Batch 3 — editor.** `specializations.css`, `skills.css`, `equipment.css`,
`notes.css`, `detail-panel.css`. The densest screens, and where the
partial-opacity accent hovers concentrate.

**Batch 4 — modals.** The ten modal sheets — `settings-modal.css`,
`team-modal.css`, `share-modal.css`, `detail-modal.css`, `wiki-modal.css`,
`whats-new-modal.css`, `import-conflict-modal.css`, `smart-folder-modal.css`,
`confirm-modal.css` — onto `.axi-scrim` + `.axi-drawer`/`.axi-panel`, with
`.axi-switch` for toggles, following AxiAM's `SettingsModal.tsx`. Tooltips are
portaled to `<body>` per rule 4; the app has a `--z-tooltip` layer already, and
`Tooltip.tsx` is the reference for measuring the trigger.

**Batch 5 — web, site, and teardown.** `forge-render.css`; `web.css` +
`web-mobile.css`; `site/styles.css` + `site-mobile.css`; **`bridge.css`
deleted**; marketing screenshots regenerated; full Playwright suites run.

## 9. Verification

Per batch, in order:

1. **Literal gates** over the app's own CSS and JS (excluding `node_modules`
   and the package), all of which must return zero outside the noted
   exceptions:
   - hex / `rgb(` / `hsl(` / `oklch(` — exception: `accents.json` reads in
     `settings-modal.js`, and `forge-render.css`'s `var(--axi-…, #literal)`
     fallbacks per §6.
   - `border-radius`
   - `box-shadow` not matching `<offset> <offset> 0 var(--axi-ink-line)`;
     `drop-shadow`; `text-shadow`
   - `gradient` — exception: none in this app.
   - `opacity` on a colour-bearing rule, reviewed by hand rather than grepped,
     since opacity on a whole element (a dragging card) stays legal.
2. **`npm test`** (jest, configured under the `jest` key in `package.json`) —
   the dev loop. Class-name changes break DOM assertions in
   `profession-themes.test.js`, `detail-panel.test.js`, `skeleton.test.js`, the
   library drag/drop specs and the `forge-render` card tests; updating those
   assertions is part of the batch that breaks them.
3. **Render for review** — the batch's screens, for eyeball approval before
   commit.

At the end of batch 5 only: the Playwright `spa`, `playground` and `e2e`
suites, and the marketing screenshot script.

`profession-themes.test.js` deserves a note: it asserts on `prof-*` ids and is
the closest thing to a test of the theming contract. It is rewritten to assert
the profession → accent map and `resolveAccentId`'s legacy handling, which
makes it the regression test for §5.

## 10. Risks

- **Scale.** 16.5k lines of CSS is the dominant risk; the batch boundaries and
  the bridge exist to keep it reviewable rather than to make it smaller.
- **A dense screen may not survive the language.** `equipment.css` and
  `comps.css` draw tightly-packed grids of small boxes, and a 3px outline plus
  a 3px block around each is a lot of ink at that density. Rule 8 is the
  resolution — a dense grid of readings is a table's interior, drawn in rules,
  not forty raised things — but it is a judgment call per screen, and batch 3
  is where it will be tested hardest. If a screen genuinely cannot be
  justified by a rule, RULES.md's own instruction applies: write the rule
  first, or stop. That means a conversation, not a local exception.
- **AxiVale's cards change shape** (§6), accepted and recorded.
- **Users lose theme backgrounds** (§5.1), inherent to the language.

## 11. Follow-ups, not this project

- Convert AxiVale and AxiBridge to axi-design.
- Light mode is not shipped by the package and is not attempted here.
