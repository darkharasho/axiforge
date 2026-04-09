# Design Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize AxiForge's visual design with a Cool Midnight + Clean Orange color scheme, updated typography, slimmer navigation, refined components, and polished animations.

**Architecture:** Pure CSS changes + one HTML font import update. All 21 CSS files in `src/renderer/styles/` are affected. The design token system in `base.css` provides the foundation — updating tokens there propagates to everything using `var()` references. Hardcoded color values (there are ~80+ across files) need individual updates. Modal visibility uses `display:none` toggling via `--hidden` classes, which will be converted to opacity/visibility for animation support.

**Tech Stack:** CSS3 (custom properties, keyframes, transitions), Google Fonts (Outfit, DM Sans additions)

**Spec:** `docs/superpowers/specs/2026-04-09-design-modernization.md`

---

## File Map

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `index.html` (root) | Google Font imports | Modify: add Outfit + DM Sans, keep Cinzel + IBM Plex Mono, remove Exo 2 |
| `src/renderer/styles/base.css` | Design tokens, body bg, scrollbars, font-family | Modify: all token values, body background, scrollbar colors, font-family |
| `src/renderer/styles/layout.css` | App grid, sidebar, subnav, titlebar | Modify: grid columns, leftnav width/style, subnav pill tabs |
| `src/renderer/styles/cards.css` | Button styles, card chrome | Modify: .btn padding, .btn-primary gradient, hardcoded colors |
| `src/renderer/styles/forms.css` | Form inputs, tag pills | Modify: tag-pill colors, Cinzel→Outfit for headings |
| `src/renderer/styles/custom-select.css` | Dropdown selects | Modify: hardcoded accent colors, open animation |
| `src/renderer/styles/detail-modal.css` | Detail modal | Modify: overlay visibility pattern, entrance/exit animation |
| `src/renderer/styles/confirm-modal.css` | Confirm dialog | Modify: overlay visibility pattern, entrance/exit animation, hardcoded colors |
| `src/renderer/styles/wiki-modal.css` | Wiki reference modal | Modify: overlay visibility pattern, entrance/exit animation |
| `src/renderer/styles/import-conflict-modal.css` | Import conflict dialog | Modify: overlay visibility pattern, entrance/exit animation, hardcoded colors |
| `src/renderer/styles/settings-modal.css` | Settings dialog | Modify: overlay visibility pattern, entrance/exit animation, hardcoded colors |
| `src/renderer/styles/specializations.css` | Trait/spec selection | Modify: hardcoded accent colors |
| `src/renderer/styles/skills.css` | Skill bar | Modify: Cinzel→Outfit for display font var |
| `src/renderer/styles/equipment.css` | Equipment editor | Modify: hardcoded accent colors, Cinzel→Outfit |
| `src/renderer/styles/detail-panel.css` | Reference panel | Modify: token-based (mostly automatic) |
| `src/renderer/styles/notes.css` | Notes editor | Modify: hardcoded accent colors |
| `src/renderer/styles/library.css` | Build library | Modify: hardcoded accent colors, card entrance animations |
| `src/renderer/styles/comps.css` | Team compositions | Modify: token-based updates |
| `src/renderer/styles/mini-build-card.css` | Compact build card | Modify: token-based updates |
| `src/renderer/styles/skeleton.css` | Loading placeholders | Modify: hardcoded accent colors for borders |
| `src/renderer/styles/role-badge.css` | Role badges | No changes (profession colors are game-defined) |

---

### Task 1: Font Imports

**Files:**
- Modify: `index.html:9-12`

- [ ] **Step 1: Update Google Fonts link**

Replace the existing font import (lines 9-12) with:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

This adds Outfit and DM Sans, keeps Cinzel (for the brand), and removes Exo 2.

- [ ] **Step 2: Verify fonts load**

Run: `npm run dev` (or the Electron dev command)
Expected: App launches without font loading errors in DevTools console. Text may look different since base.css still references Exo 2 — that's expected, will be fixed in Task 2.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: update Google Font imports (add Outfit, DM Sans; remove Exo 2)"
```

---

### Task 2: Design Tokens & Base Styles

**Files:**
- Modify: `src/renderer/styles/base.css:2-99`

- [ ] **Step 1: Update CSS custom properties**

Replace the `:root` block (lines 2-58) with:

```css
:root {
  color-scheme: dark;

  /* ── Core palette ─────────────────────────────────────────────────────── */
  --bg: #090a10;
  --bg-2: #0d0e16;
  --panel: #14161e;
  --panel-2: #10121a;
  --line: #1e2030;
  --line-soft: #181a26;
  --text: #e4e6ee;
  --text-light: #b0b4c0;
  --text-dim: #6a6e80;
  --muted: #8890a6;
  --accent: #f09040;
  --accent-2: #64aaf0;
  --danger: #c5485f;
  --danger-text: #f87171;
  --gold: #e8b050;
  --link: #64aaf0;

  /* ── Surfaces ─────────────────────────────────────────────────────────── */
  --input-bg: #0c0e16;
  --input-border: #252838;
  --surface: rgba(10, 12, 18, 0.92);
  --surface-hover: rgba(14, 16, 24, 0.95);
  --panel-gradient: linear-gradient(180deg, rgba(20, 22, 30, 0.95), rgba(16, 18, 26, 0.95));

  /* ── Interactive states ───────────────────────────────────────────────── */
  --hover-subtle: rgba(255, 255, 255, 0.05);
  --hover-accent: rgba(240, 144, 64, 0.12);
  --hover-accent-strong: rgba(240, 144, 64, 0.2);
  --focus-ring: rgba(240, 144, 64, 0.26);

  /* ── Radius ───────────────────────────────────────────────────────────── */
  --radius: 14px;
  --radius-sm: 6px;
  --radius-xs: 4px;

  /* ── Shadows ──────────────────────────────────────────────────────────── */
  --shadow-sm: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.6);
  --shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.7);

  /* ── Overlay ──────────────────────────────────────────────────────────── */
  --overlay: rgba(0, 0, 0, 0.72);

  /* ── Z-index scale ────────────────────────────────────────────────────── */
  --z-sticky: 10;
  --z-titlebar: 50;
  --z-dropdown: 90;
  --z-autocomplete: 100;
  --z-tooltip: 120;
  --z-menu: 200;
  --z-modal: 1000;
  --z-modal-confirm: 1100;
}
```

- [ ] **Step 2: Update scrollbar colors**

Replace the scrollbar styles (lines 60-81) with:

```css
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(240, 144, 64, 0.3) transparent;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(240, 144, 64, 0.3);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(240, 144, 64, 0.5);
}
```

- [ ] **Step 3: Update body font-family and background**

Replace the `html, body` block (lines 89-99) with:

```css
html,
body {
  margin: 0;
  min-height: 100vh;
  font-family: "DM Sans", system-ui, sans-serif;
  background:
    radial-gradient(1300px 550px at -5% -10%, rgba(240, 144, 64, 0.08), transparent 55%),
    radial-gradient(1000px 550px at 110% 0%, rgba(100, 170, 240, 0.08), transparent 55%),
    var(--bg);
  color: var(--text);
}
```

- [ ] **Step 4: Verify base token changes**

Run the app. Expected: Background shifts from blue-black to cool midnight. Text color slightly cooler. Body font changes to DM Sans. Scrollbars show orange tint. Any element using `var(--accent)` now shows orange instead of green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/base.css
git commit -m "feat(design): update design tokens to Cool Midnight + Clean Orange palette"
```

---

### Task 3: Navigation & Layout

**Files:**
- Modify: `src/renderer/styles/layout.css:197-437`

- [ ] **Step 1: Update app-layout grid**

Replace `.app-layout` (line 199) grid-template-columns:

```css
grid-template-columns: 54px 1fr;
```

- [ ] **Step 2: Update subnav to pill/segment style**

Replace `.subnav` background (line 211):

```css
background: rgba(10, 12, 18, 0.98);
```

Replace `.subnav__item` styles (lines 222-238) with:

```css
.subnav__item {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: background 0.2s, color 0.2s, transform 0.15s;
  white-space: nowrap;
}
```

Replace `.subnav__item:hover` (lines 247-250):

```css
.subnav__item:hover {
  background: var(--hover-subtle);
  color: var(--text);
}
```

Replace `.subnav__item--active` (lines 252-255):

```css
.subnav__item--active {
  background: var(--hover-accent);
  color: var(--accent);
}
```

- [ ] **Step 3: Update leftnav sidebar**

Replace `.leftnav` (lines 388-396) with:

```css
.leftnav {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  background: rgba(10, 12, 18, 0.98);
  border-right: 1px solid var(--line);
}
```

Replace `.leftnav__item` (lines 398-412) with:

```css
.leftnav__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: var(--text-dim);
  position: relative;
  transition: background 0.2s, color 0.2s, transform 0.2s;
}
```

Replace `.leftnav__item:hover` (lines 414-417):

```css
.leftnav__item:hover {
  background: var(--hover-accent);
  color: var(--text);
  transform: translateY(-1px);
}
```

Replace `.leftnav__item--active` (lines 419-422) with:

```css
.leftnav__item--active {
  background: var(--hover-accent-strong);
  color: var(--accent);
}

.leftnav__item--active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 20px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}
```

Hide the label (lines 430-437):

```css
.leftnav__label {
  display: none;
}
```

- [ ] **Step 4: Verify navigation changes**

Run the app. Expected: Sidebar is now slim (~54px) with icon-only buttons. Active nav item has orange left edge bar. Subnav tabs have pill-style active state with orange tint. Overall layout has more horizontal space.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/layout.css
git commit -m "feat(design): modernize navigation — slim icon rail + pill tabs"
```

---

### Task 4: Button & Card Chrome

**Files:**
- Modify: `src/renderer/styles/cards.css:18-66`

- [ ] **Step 1: Update base button styles**

Replace `.btn` (lines 18-27):

```css
.btn {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--text);
  background: var(--panel);
  transition: background 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
```

Replace `.btn:hover` (lines 29-31):

```css
.btn:hover {
  background: var(--line);
  transform: scale(1.02);
}
```

- [ ] **Step 2: Update primary button gradient**

Replace `.btn-primary` and `.btn-primary:hover` (lines 38-45):

```css
.btn-primary {
  border-color: rgba(240, 144, 64, 0.5);
  background: linear-gradient(180deg, #f09040, #e07020);
  color: #0a0a10;
}

.btn-primary:hover {
  background: linear-gradient(180deg, #f8a050, #e88030);
  box-shadow: 0 2px 12px rgba(240, 144, 64, 0.25);
}
```

- [ ] **Step 3: Update hardcoded accent colors in cards.css**

Replace the `.btn-save--saved` green accent (around lines 99-100):
- `rgba(79, 216, 151, 0.48)` → `rgba(240, 144, 64, 0.48)`
- `rgba(79, 216, 151, 0.12)` → `rgba(240, 144, 64, 0.12)`

Replace the ticker border (around line 468):
- `rgba(72, 168, 255, 0.3)` → `rgba(100, 170, 240, 0.3)`

- [ ] **Step 4: Verify button changes**

Run the app. Expected: Primary buttons show orange gradient. Hover adds subtle scale + glow. Default buttons have slightly larger padding. Danger buttons unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/cards.css
git commit -m "feat(design): update buttons to orange gradient + hover animations"
```

---

### Task 5: Forms & Tag Pills

**Files:**
- Modify: `src/renderer/styles/forms.css:25,92-104`

- [ ] **Step 1: Update Cinzel reference to Outfit**

Replace `font-family: "Cinzel", serif;` (line 25) with:

```css
font-family: "Outfit", sans-serif;
```

- [ ] **Step 2: Update tag pill colors**

Replace `.tag-pill` background and border (lines 96-97):

```css
  background: rgba(240, 144, 64, 0.18);
  border: 1px solid rgba(240, 144, 64, 0.35);
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/forms.css
git commit -m "feat(design): update forms — Outfit headings, orange tag pills"
```

---

### Task 6: Custom Select Dropdown

**Files:**
- Modify: `src/renderer/styles/custom-select.css`

- [ ] **Step 1: Update hardcoded accent color**

Replace `rgba(79, 216, 151, 0.45)` (line 93) with:

```css
rgba(240, 144, 64, 0.45)
```

- [ ] **Step 2: Add dropdown open animation**

Find the `.cselect__menu` rule and add these properties (if not already present):

```css
  animation: cselect-open 0.15s ease-out;
```

Add after the last rule in the file:

```css
@keyframes cselect-open {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/custom-select.css
git commit -m "feat(design): update custom select colors + open animation"
```

---

### Task 7: Modal Entrance/Exit Animations

All five modal files follow the same pattern: overlay uses `display: none` via `--hidden` class. We need to switch to `opacity + visibility + pointer-events` for animatable show/hide.

**Files:**
- Modify: `src/renderer/styles/detail-modal.css:3-15`
- Modify: `src/renderer/styles/confirm-modal.css:3-15`
- Modify: `src/renderer/styles/wiki-modal.css:3-15`
- Modify: `src/renderer/styles/import-conflict-modal.css:1-15`
- Modify: `src/renderer/styles/settings-modal.css:3-15`

- [ ] **Step 1: Update detail-modal overlay**

Replace `.detail-modal-overlay` and `.detail-modal-overlay--hidden` (lines 3-15):

```css
.detail-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease-out, visibility 0.2s;
}

.detail-modal-overlay--hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
```

Add animation to `.detail-modal` (after line 17 or within the `.detail-modal` rule):

```css
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
  transform: scale(1);
```

Add to `.detail-modal-overlay--hidden .detail-modal`:

```css
.detail-modal-overlay--hidden .detail-modal {
  transform: scale(0.96);
  opacity: 0;
}
```

- [ ] **Step 2: Update confirm-modal overlay**

Replace `.confirm-modal-overlay` and `.confirm-modal-overlay--hidden` (lines 3-15):

```css
.confirm-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal-confirm);
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease-out, visibility 0.2s;
}

.confirm-modal-overlay--hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
```

Add to the `.confirm-modal` rule:

```css
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
```

Add new rule:

```css
.confirm-modal-overlay--hidden .confirm-modal {
  transform: scale(0.96);
  opacity: 0;
}
```

Update hardcoded blue colors in confirm-modal.css:
- `rgba(72, 168, 255, 0.15)` → `rgba(100, 170, 240, 0.15)` (line 132)
- `#48a8ff` → `#64aaf0` (lines 133, 140)
- `rgba(72, 168, 255, 0.4)` → `rgba(100, 170, 240, 0.4)` (line 134)
- `rgba(72, 168, 255, 0.3)` → `rgba(100, 170, 240, 0.3)` (line 138)

- [ ] **Step 3: Update wiki-modal overlay**

Replace `.wiki-modal-overlay` and `.wiki-modal-overlay--hidden` (lines 3-15) with the same opacity/visibility pattern (use `--z-modal` for z-index):

```css
.wiki-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease-out, visibility 0.2s;
}

.wiki-modal-overlay--hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
```

Add transition to `.wiki-modal` rule and hidden child rule:

```css
/* Add to .wiki-modal */
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;

/* New rule */
.wiki-modal-overlay--hidden .wiki-modal {
  transform: scale(0.96);
  opacity: 0;
}
```

- [ ] **Step 4: Update import-conflict-modal overlay**

Apply the same pattern to `.icm-overlay` and `.icm-overlay--hidden`. Also update hardcoded colors:
- `rgba(72, 168, 255, 0.2)` → `rgba(100, 170, 240, 0.2)` (line 101)
- `rgba(72, 168, 255, 0.15)` → `rgba(100, 170, 240, 0.15)` (line 181)
- `rgba(72, 168, 255, 0.4)` → `rgba(100, 170, 240, 0.4)` (line 183)
- `rgba(72, 168, 255, 0.3)` → `rgba(100, 170, 240, 0.3)` (line 187)

Add transition + hidden child scale rule for `.icm` (the modal content class).

- [ ] **Step 5: Update settings-modal overlay**

Apply the same pattern to `.settings-modal-overlay` and `.settings-modal-overlay--hidden`. Also update hardcoded colors:
- `rgba(72, 168, 255, ...)` → `rgba(100, 170, 240, ...)` at all opacity levels (lines 153-154, 256-258, 310-312, 316, 318)
- `#48a8ff` → `#64aaf0` (lines 183, 187, 258, 311, 318)
- `rgba(79, 216, 151, 0.12)` → `rgba(240, 144, 64, 0.12)` (line 354)
- `rgba(79, 216, 151, 0.3)` → `rgba(240, 144, 64, 0.3)` (line 355)

Add transition + hidden child scale rule for `.settings-modal`.

- [ ] **Step 6: Verify modal animations**

Run the app. Open and close each modal type (detail panel expand, confirm dialog, wiki modal, settings). Expected: Modals fade in with subtle scale-up (0.96→1). Closing fades out with scale-down. Overlay background fades smoothly.

**Important:** If any modal JS toggles `display:none` directly (rather than toggling the `--hidden` class), the CSS animation won't work. Check that the JS uses the `--hidden` class toggle pattern. If it does, no JS changes needed.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/styles/detail-modal.css src/renderer/styles/confirm-modal.css src/renderer/styles/wiki-modal.css src/renderer/styles/import-conflict-modal.css src/renderer/styles/settings-modal.css
git commit -m "feat(design): add modal entrance/exit animations + update accent colors"
```

---

### Task 8: Specializations & Skills

**Files:**
- Modify: `src/renderer/styles/specializations.css`
- Modify: `src/renderer/styles/skills.css`

- [ ] **Step 1: Update specializations hardcoded colors**

In `specializations.css`:
- `rgba(80, 132, 163, 0.48)` (line 80) → `rgba(100, 170, 240, 0.35)`
- `rgba(79, 216, 151, 0.35)` (line 383) → `rgba(240, 144, 64, 0.35)`
- `rgba(79, 216, 151, 0.03)` (line 384) → `rgba(240, 144, 64, 0.03)`

- [ ] **Step 2: Update skills display font variable**

In `skills.css`, the `--font-display` variable reference (line 418):
- `var(--font-display, 'Cinzel', serif)` → `var(--font-display, 'Outfit', sans-serif)`

- [ ] **Step 3: Update specializations display font variable**

In `specializations.css` (line 357):
- `var(--font-display, 'Cinzel', serif)` → `var(--font-display, 'Outfit', sans-serif)`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/specializations.css src/renderer/styles/skills.css
git commit -m "feat(design): update spec/skill colors + Outfit display font"
```

---

### Task 9: Equipment

**Files:**
- Modify: `src/renderer/styles/equipment.css`

- [ ] **Step 1: Update Cinzel reference**

Replace `font-family: "Cinzel", serif;` (line 56) with:

```css
font-family: "Outfit", sans-serif;
```

- [ ] **Step 2: Update hardcoded accent colors**

Replace all `rgba(80, 132, 163, ...)` references with updated cool neutral values:
- `rgba(80, 132, 163, 0.3)` → `rgba(100, 170, 240, 0.2)` (lines 62, 289)
- `rgba(80, 132, 163, 0.5)` → `rgba(100, 170, 240, 0.35)` (line 71)
- `rgba(80, 132, 163, 0.1)` → `rgba(100, 170, 240, 0.08)` (line 72)
- `rgba(80, 132, 163, 0.6)` → `rgba(100, 170, 240, 0.4)` (line 317)
- `rgba(80, 132, 163, 0.15)` → `rgba(100, 170, 240, 0.1)` (line 393)
- `rgba(80, 132, 163, 0.4)` → `rgba(100, 170, 240, 0.3)` (line 550)
- `rgba(80, 132, 163, 0.18)` → `rgba(100, 170, 240, 0.14)` (line 554)
- `rgba(80, 132, 163, 0.08)` → `rgba(100, 170, 240, 0.06)` (line 613)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/equipment.css
git commit -m "feat(design): update equipment panel colors + Outfit font"
```

---

### Task 10: Notes

**Files:**
- Modify: `src/renderer/styles/notes.css`

- [ ] **Step 1: Update hardcoded accent colors**

Replace green accent references:
- `rgba(79, 216, 151, 0.1)` (lines 42, 97) → `rgba(240, 144, 64, 0.1)`
- `rgba(79, 216, 151, 0.08)` (line 373) → `rgba(240, 144, 64, 0.08)`

Replace blue accent references:
- `rgba(72, 168, 255, 0.12)` (line 309) → `rgba(100, 170, 240, 0.12)`
- `rgba(72, 168, 255, 0.25)` (line 310) → `rgba(100, 170, 240, 0.25)`
- `rgba(72, 168, 255, 0.2)` (line 320) → `rgba(100, 170, 240, 0.2)`
- `rgba(72, 168, 255, 0.4)` (line 321) → `rgba(100, 170, 240, 0.4)`
- `rgba(72, 168, 255, 0.06)` (line 408) → `rgba(100, 170, 240, 0.06)`
- `rgba(72, 168, 255, 0.15)` (line 409) → `rgba(100, 170, 240, 0.15)`

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/notes.css
git commit -m "feat(design): update notes editor accent colors"
```

---

### Task 11: Library

**Files:**
- Modify: `src/renderer/styles/library.css`

- [ ] **Step 1: Update hardcoded blue accent colors**

Replace all `rgba(72, 168, 255, ...)` references:
- `rgba(72, 168, 255, 0.1)` → `rgba(100, 170, 240, 0.1)` (lines 998, 1047, 1634, 1659, 1682)
- `rgba(72, 168, 255, 0.4)` → `rgba(100, 170, 240, 0.4)` (lines 999, 1346)
- `rgba(72, 168, 255, 0.5)` → `rgba(100, 170, 240, 0.5)` (lines 1217, 1683)
- `rgba(72, 168, 255, 0.06)` → `rgba(100, 170, 240, 0.06)` (line 1218)
- `rgba(72, 168, 255, 0.08)` → `rgba(100, 170, 240, 0.08)` (line 1345)
- `rgba(72, 168, 255, 0.6)` → `rgba(100, 170, 240, 0.6)` (lines 1657, 1664)
- `rgba(72, 168, 255, 0.15)` → `rgba(100, 170, 240, 0.15)` (line 1666)

- [ ] **Step 2: Add card entrance animations**

Add at the end of library.css:

```css
/* ── Card entrance animation ────────────────────────────────────────── */
@keyframes lib-card-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.lib-card {
  animation: lib-card-enter 0.25s ease-out both;
}

.lib-card:nth-child(1) { animation-delay: 0ms; }
.lib-card:nth-child(2) { animation-delay: 40ms; }
.lib-card:nth-child(3) { animation-delay: 80ms; }
.lib-card:nth-child(4) { animation-delay: 120ms; }
.lib-card:nth-child(5) { animation-delay: 160ms; }
.lib-card:nth-child(6) { animation-delay: 200ms; }
.lib-card:nth-child(7) { animation-delay: 240ms; }
.lib-card:nth-child(8) { animation-delay: 280ms; }
.lib-card:nth-child(n+9) { animation-delay: 320ms; }
```

Note: If the library card class is not `.lib-card`, check the actual class name in library.css and adjust the selector accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/library.css
git commit -m "feat(design): update library colors + staggered card entrance"
```

---

### Task 12: Skeleton Loaders

**Files:**
- Modify: `src/renderer/styles/skeleton.css`

- [ ] **Step 1: Update hardcoded border colors**

Replace all `rgba(80, 132, 163, ...)` references:
- `rgba(80, 132, 163, 0.48)` (line 117) → `rgba(100, 170, 240, 0.35)`
- `rgba(80, 132, 163, 0.2)` (lines 197, 198, 239) → `rgba(100, 170, 240, 0.15)`
- `rgba(80, 132, 163, 0.3)` (lines 219, 291) → `rgba(100, 170, 240, 0.2)`
- `rgba(80, 132, 163, 0.5)` (line 228) → `rgba(100, 170, 240, 0.35)`
- `rgba(80, 132, 163, 0.15)` (line 254) → `rgba(100, 170, 240, 0.1)`

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/skeleton.css
git commit -m "feat(design): update skeleton loader border colors"
```

---

### Task 13: Layout Hardcoded Colors

**Files:**
- Modify: `src/renderer/styles/layout.css`

- [ ] **Step 1: Update remaining hardcoded colors in layout.css**

These are workspace menu and status indicator colors:
- `rgba(72, 168, 255, 0.1)` (line 299) → `rgba(100, 170, 240, 0.1)`
- `rgba(79, 216, 151, 0.1)` (line 308) → `rgba(240, 144, 64, 0.1)`
- `rgba(79, 216, 151, 0.3)` (line 309) → `rgba(240, 144, 64, 0.3)`
- `rgba(79, 216, 151, 0.15)` (line 496) → `rgba(240, 144, 64, 0.15)`
- `rgba(72, 168, 255, 0.15)` (line 502) → `rgba(100, 170, 240, 0.15)`

Also update the titlebar font if it uses Cinzel for brand (line 20 — this one STAYS as Cinzel since it's the brand).

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/layout.css
git commit -m "feat(design): update layout hardcoded accent colors"
```

---

### Task 14: Ambient Background Animation

**Files:**
- Modify: `src/renderer/styles/base.css`

- [ ] **Step 1: Add ambient gradient drift**

Add after the `html, body` rule in base.css:

```css
@keyframes ambient-drift {
  0%, 100% {
    background-position: 0% 0%, 100% 0%;
  }
  50% {
    background-position: 2% 3%, 97% 2%;
  }
}

html, body {
  background-size: 100% 100%, 100% 100%, 100% 100%;
  animation: ambient-drift 60s ease-in-out infinite;
}
```

Note: This needs to be added carefully — the body already has `background` set. The `background-size` and `animation` should be added to the existing `html, body` rule, not a new one. Merge them into the existing rule.

- [ ] **Step 2: Verify ambient animation**

Run the app. Expected: Very subtle, barely perceptible gradient movement over 60 seconds. Should not be distracting.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/base.css
git commit -m "feat(design): add subtle ambient background drift animation"
```

---

### Task 15: Final Verification & Cleanup

- [ ] **Step 1: Visual audit**

Run the app and check every major view:
1. Library page — cards, sidebar, search, filters
2. Build editor — specializations, skills, equipment tabs
3. Comps page — team composition layout
4. Settings modal — all form controls
5. Detail/wiki modals — open/close animations
6. Notes editor — mention chips, formatting

For each view, verify:
- No leftover blue-black backgrounds (should all be cool midnight)
- No green accent remnants (should be orange)
- No blue accent that's the old `#48a8ff` (should be `#64aaf0`)
- Text is readable against new backgrounds
- Buttons have correct gradient
- Modals animate in/out

- [ ] **Step 2: Search for any remaining old colors**

Run a grep for any remaining hardcoded old-palette values across all CSS files:

```bash
grep -rn "rgba(79, 216, 151\|rgba(72, 168, 255\|rgba(80, 132, 163\|#4fd897\|#48a8ff\|#04070f\|#070d1b\|#101930\|#0c1325\|#223458\|#1a2a49" src/renderer/styles/
```

Any hits (except in comments) need updating. Fix them.

- [ ] **Step 3: Final commit**

```bash
git add -A src/renderer/styles/
git commit -m "feat(design): final cleanup — remaining color references"
```
