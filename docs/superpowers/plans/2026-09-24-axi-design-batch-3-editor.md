# axi-design Batch 3 — The Build Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the five build-editor stylesheets to the axi-design language so the desktop editor, the web playground and published build pages stop reading half-converted.

**Architecture:** Each sheet is retokenised and reformed in place against
bridge.css's mapping table, then removed from `PENDING` in
`tests/unit/styles/axi-design-rules.test.js`, which is what turns the gate on
for it. No markup restructuring beyond what a rule forces. `src/site/styles.css`
imports all five, so the SPA and build.axi.link inherit the batch with no work
of their own — that inheritance is the reason this batch exists.

**Tech Stack:** CSS, `@axiapps/axi-design` ≥1.10.0, jest.

**Spec:** `docs/superpowers/specs/2026-09-23-axi-design-conversion-design.md` (§8, batch 3)

## Global Constraints

- The gate is `tests/unit/styles/axi-design-rules.test.js`. A sheet is done
  when its `PENDING` entry is deleted and `npx jest tests/unit/styles` is green.
- Colour comes off `--axi-*` only. The legacy → axi mapping is
  `src/renderer/styles/bridge.css`; read a legacy name's line there and write
  the axi token it points at, not the legacy name.
- `rgba(var(--accent-rgb), …)` has no mapping on purpose (bridge.css header):
  every one is rule 2's violation. A hover tint becomes
  `background: var(--axi-surface-raised)`; a selected/active state becomes a
  full-strength `background: var(--axi-accent); color: var(--axi-accent-ink)`
  where it is a chosen control, or an accent outline where it is an annotation
  (rule 5).
- `border-radius` declarations are deleted unless they exist to override
  something rounder, in which case they become `var(--axi-radius)`. No literal.
- The only legal `box-shadow` is
  `<offset> <offset> 0 var(--axi-ink-line)` off `--axi-offset-panel` /
  `--axi-offset-control`; anything blurred is deleted. Hover lift is
  `box-shadow: var(--axi-offset-control-hover) var(--axi-offset-control-hover) 0
  var(--axi-ink-line); transform: translate(-2px, -2px)` (rule 4).
- `border`/`outline` widths come off `--axi-border-panel` (4px),
  `--axi-border-control` (3px) or `--axi-border-hairline` (2px). No literal.
- No gradients, no `backdrop-filter`, no `text-shadow`, no `drop-shadow`, no
  `color-mix`, no static `opacity` strictly between 0 and 1 on a rule that
  carries colour (motion inside `@keyframes` is exempt).
- Type comes off the `--axi-t-*` scale where a rule sets a font; a bare
  `font-size` on an existing rule may stay if it is not redefining the family.
- Rule 8 governs the dense screens: a packed grid of readings is a panel's
  interior drawn in rules (`--axi-rule`), not forty raised things. A thing you
  act on is a control-weight box.
- Never `--no-gpg-sign`. Run jest, never the Playwright suites.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

- A slot the user clicks must still read as clickable once its blurred hover
  glow is gone — the lift, not the tint, has to carry it.
- The skill bar's icons are square images; removing their radius must not
  leave the image bleeding past its own outline.
- `notes.css`'s preview is prose the user wrote; its table and `hr` are rule
  8's interior, not raised elements.
- The 11 `.breakdown-pill--*` hues are redundant with the pill's own text.
- `detail-panel.test.js`, `profession-themes.test.js` and the equipment specs
  assert on class names; any rename updates them in the same task.

---

### Task B3-1: detail-panel.css

**Files:** Modify `src/renderer/styles/detail-panel.css`,
`src/renderer/modules/detail-panel.js`; Test `tests/unit/styles`, `tests/unit/detail-panel.test.js`

- [ ] Retokenise every legacy var and literal (22 literals, 10 radii).
- [ ] Delete the 11 `.breakdown-pill--*` category hues and stop emitting the
  modifier from `detail-panel.js:398`. The pill's text already names the
  category, so the hue is redundant; the pill becomes one outlined annotation
  chip (`--axi-border-hairline` in `--axi-rule`, `--axi-text-dim` text) per
  rule 5. Keep the base `.breakdown-pill`.
- [ ] `.breakdown-value`'s `#6fdc6f` becomes `var(--axi-ok)`.
- [ ] `.breakdown-svg-icon`'s `opacity: .85` becomes `color: var(--axi-text-dim)`.
- [ ] Delete `src/renderer/styles/detail-panel.css` from `PENDING`.
- [ ] Run `npx jest tests/unit/styles tests/unit/detail-panel.test.js`; commit.

### Task B3-2: specializations.css

**Files:** Modify `src/renderer/styles/specializations.css`; Test `tests/unit/styles`

- [ ] Retokenise (18 literals, 8 radii, 11 shadows).
- [ ] The trait grid is rule 8's interior: the connector lines and minor-trait
  anchors are rules in `--axi-rule`, the trait buttons are control-weight boxes.
- [ ] `.trait-btn--active` / `--always` become full-strength accent, not a tint.
- [ ] Empty-state diamond keeps its `@keyframes` (motion is exempt).
- [ ] Delete from `PENDING`; run `npx jest tests/unit/styles`; commit.

### Task B3-3: notes.css

**Files:** Modify `src/renderer/styles/notes.css`; Test `tests/unit/styles`

- [ ] Retokenise (17 literals, 11 radii, 1 shadow).
- [ ] Toolbar buttons are control-weight; the active preview toggle is a
  full-strength accent fill.
- [ ] The preview's prose headings take the `--axi-t-h*` scale; its table and
  `hr` are drawn in `--axi-rule` (rule 8).
- [ ] Embeds, mentions and the autocomplete popover are panels: surface fill,
  panel outline in ink, hard offset block, square.
- [ ] Delete from `PENDING`; run `npx jest tests/unit/styles`; commit.

### Task B3-4: skills.css

**Files:** Modify `src/renderer/styles/skills.css`; Test `tests/unit/styles`, `tests/unit/profession-themes.test.js`

- [ ] Retokenise (117 literals, 26 radii, 27 shadows).
- [ ] Skill slots, legend slots, pet slots and weapon-swap buttons are
  control-weight boxes; their hover is the lift, not a glow.
- [ ] The health orb is a quantity, so it is length not intensity (rule 9): a
  flat accent fill against the surface, no gradient, no glow.
- [ ] `.skill-icon--profession*` selected states go full-strength accent.
- [ ] Keep every `@keyframes` (flip/swap motion is exempt).
- [ ] Delete from `PENDING`; run `npx jest tests/unit/styles tests/unit/profession-themes.test.js`; commit.

### Task B3-5: equipment.css

**Files:** Modify `src/renderer/styles/equipment.css`; Test `tests/unit/styles`

- [ ] Retokenise (117 literals, 26 radii, 21 shadows).
- [ ] The slot grid is the batch's hardest rule-8 call: a slot is a thing you
  act on, so it is a control-weight box, but the trinket/consumable grids stay
  a panel's interior with rules between them rather than a block per cell.
- [ ] `.slot-picker` is a popover panel; its tabs are control-weight, the
  active tab a full-strength accent fill, its options rows separated by rules.
- [ ] Delete from `PENDING`; run `npx jest tests/unit/styles`; commit.

### Task B3-6: Close the batch

**Files:** Modify `tests/unit/styles/axi-design-rules.test.js` (stale batch-5
comment about bridge.css), `docs/BACKLOG.md`

- [ ] Confirm `PENDING` holds only the nine batch-4 modal sheets.
- [ ] Correct the `PENDING` comment: bridge.css is deleted by whichever batch
  empties `PENDING`, which is batch 4, not batch 5.
- [ ] Run the full `npm test`.
- [ ] Screenshot the real SPA build and comp pages for review.
- [ ] Commit.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
