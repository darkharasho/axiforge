# SPA Mobile Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GitHub Pages SPA fully usable on mobile devices with responsive layouts, touch-friendly interactions, and a bottom sheet detail panel.

**Architecture:** CSS-only mobile overrides in a new `site-mobile.css` (breakpoint: `max-width: 768px`) plus a new `mobile.js` module for interactive components (accordion specs, equipment sub-tabs, bottom sheet). Shared renderer CSS/JS is untouched — all changes are SPA-only.

**Tech Stack:** Vanilla CSS (media queries), vanilla JS (ES modules), Vite bundler.

**Spec:** `docs/superpowers/specs/2026-03-23-spa-mobile-responsiveness-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/site/site-mobile.css` | Create | All mobile media query overrides for layout, skill bar, specs, equipment, detail panel, comp page |
| `src/site/mobile.js` | Create | Mobile detection, skill bar meta row injection, spec accordion, equipment sub-tabs, bottom sheet |
| `src/site/styles.css` | Modify | Add `@import "./site-mobile.css"` |
| `src/site/render-build.js` | Modify | Import and call mobile init after page renders |
| `src/site/render-comp.js` | Modify | Import and call mobile init for comp page |

---

### Task 1: Create `site-mobile.css` with Global Layout Overrides

**Files:**
- Create: `src/site/site-mobile.css`
- Modify: `src/site/styles.css` (line 13 — add import after last existing import)

- [ ] **Step 1: Create `site-mobile.css` with the mobile media query wrapper and global overrides**

```css
/* AxiForge — SPA mobile overrides */
/* All rules scoped to max-width: 768px */

@media (max-width: 768px) {
  /* --- Global / Layout --- */
  #app {
    width: 100vw;
    margin: 12px 0 32px;
    padding: 0 12px;
    box-sizing: border-box;
  }

  .build-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .build-header__icon {
    width: 48px;
    height: 48px;
  }

  .build-header__icon img {
    width: 48px;
    height: 48px;
  }

  .build-code-group--header {
    align-self: stretch;
    justify-content: flex-start;
  }

  .site-tabs {
    width: 100%;
  }

  .site-tab {
    flex: 1;
    text-align: center;
  }
}
```

- [ ] **Step 2: Add import to `styles.css`**

In `src/site/styles.css`, add after the last existing import (line 13 — after `@import "../renderer/styles/role-badge.css";`):

```css
@import "./site-mobile.css";
```

- [ ] **Step 3: Verify the Vite dev server builds without errors**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes, no CSS import errors.

- [ ] **Step 4: Commit**

```bash
git add src/site/site-mobile.css src/site/styles.css
git commit -m "feat(site): add mobile CSS file with global layout overrides"
```

---

### Task 2: Skill Bar Mobile CSS

**Files:**
- Modify: `src/site/site-mobile.css`

- [ ] **Step 1: Add skill bar mobile overrides inside the existing `@media` block**

Add before the closing `}` of the `@media (max-width: 768px)` block:

```css
  /* --- Skill Bar --- */
  .skills-bar {
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .skills-bar__weapon-col {
    width: 100%;
  }

  .skills-bar__weapon-row {
    justify-content: center;
  }

  .skill-icon-large {
    width: 58px;
    height: 58px;
  }

  .skill-select-overlay {
    width: 58px;
    height: 58px;
  }

  .health-orb {
    display: none;
  }

  .skills-bar__orb-col {
    display: none;
  }

  .weapon-swap-btn {
    display: none;
  }

  .profession-mechanics-bar {
    padding-left: 0;
    justify-content: center;
  }

  .skill-icon--profession {
    width: 30px;
    height: 30px;
  }

  .legend-slot-btn {
    width: 30px;
    height: 30px;
  }

  /* Mobile meta row (swap pill + HP badge) — injected by mobile.js */
  .skills-bar__mobile-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
  }

  .mobile-swap-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(14, 11, 4, 0.7);
    border: 1px solid rgba(210, 175, 70, 0.5);
    border-radius: 16px;
    padding: 4px 12px 4px 6px;
    cursor: pointer;
    color: rgba(220, 185, 75, 0.85);
    font-size: 11px;
    font-weight: 600;
  }

  .mobile-swap-pill:hover {
    border-color: rgba(255, 215, 100, 1);
    color: #ffe06a;
  }

  .mobile-swap-pill__icon {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(210, 175, 70, 0.85);
    background: rgba(14, 11, 4, 0.96);
    display: grid;
    place-items: center;
    font-size: 10px;
  }

  .mobile-hp-badge {
    background: rgba(160, 20, 20, 0.2);
    border: 1px solid rgba(200, 60, 60, 0.4);
    border-radius: 16px;
    padding: 4px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mobile-hp-badge__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(200, 60, 60, 0.8);
    box-shadow: 0 0 4px rgba(200, 30, 30, 0.6);
  }

  .mobile-hp-badge__value {
    font-size: 12px;
    font-weight: 700;
    color: rgba(255, 200, 200, 0.95);
    letter-spacing: 0.3px;
  }

  .mobile-hp-badge__label {
    font-size: 8px;
    color: rgba(255, 180, 180, 0.6);
    text-transform: uppercase;
    font-weight: 600;
  }
```

Note: `.skills-bar__mobile-meta` is hidden on desktop by default because it only exists inside the media query styles. The element is injected by `mobile.js` (Task 4) and won't render on desktop since it has no styles outside the media query. Add a desktop hide rule above the media query as a safety net:

```css
/* Hidden on desktop — only styled inside @media */
.skills-bar__mobile-meta { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add src/site/site-mobile.css
git commit -m "feat(site): add skill bar mobile CSS overrides"
```

---

### Task 3: Specialization Accordion Mobile CSS

**Files:**
- Modify: `src/site/site-mobile.css`

- [ ] **Step 1: Add spec accordion styles inside the `@media` block**

```css
  /* --- Specializations Accordion --- */
  .specs-with-detail {
    flex-direction: column;
  }

  /* Note: .detail-panel and .hover-preview hiding is in Task 7 (bottom sheet) */

  .spec-card {
    --spec-scale: 0.9;
  }

  .spec-card__body {
    display: none;
  }

  .spec-connector {
    display: none;
  }

  .spec-card.expanded .spec-card__body {
    display: grid;
    grid-template-columns: 40px repeat(3, 32px);
    column-gap: 8px;
    row-gap: 8px;
    padding: 12px;
    justify-content: center;
  }

  .spec-card.expanded .spec-connector {
    display: none;
  }

  /* Collapsed header row — injected by mobile.js */
  .spec-card__mobile-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    cursor: pointer;
    border: 1px solid rgba(80, 132, 163, 0.48);
    border-radius: 4px;
    background: #070f1d;
  }

  .spec-card__mobile-header:active {
    background: rgba(16, 25, 48, 0.9);
  }

  .spec-card--elite .spec-card__mobile-header {
    border-color: rgba(210, 165, 50, 0.7);
    box-shadow: 0 0 20px rgba(190, 145, 30, 0.2) inset;
  }

  .spec-card__mobile-emblem {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
  }

  .spec-card__mobile-emblem img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .spec-card__mobile-name {
    font-family: "Cinzel", serif;
    font-size: 14px;
    color: #e8f0ff;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }

  .spec-card__mobile-traits {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .spec-card__mobile-traits img {
    width: 20px;
    height: 20px;
    border-radius: 2px;
    border: 1px solid rgba(100, 220, 255, 0.4);
  }

  .spec-card--elite .spec-card__mobile-traits img {
    border-color: rgba(210, 165, 50, 0.5);
  }

  .spec-card__mobile-chevron {
    color: rgba(166, 187, 222, 0.5);
    font-size: 16px;
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }

  .spec-card.expanded .spec-card__mobile-chevron {
    transform: rotate(180deg);
    color: rgba(100, 220, 255, 0.8);
  }

  .spec-card.expanded .spec-card__mobile-header {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom: none;
  }

  .spec-card.expanded .spec-card__panel {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  /* Mobile expanded layout: vertical tiers */
  .spec-card__mobile-tiers {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .spec-card__mobile-tier {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(80, 132, 163, 0.15);
  }

  .spec-card__mobile-tier:last-child {
    border-bottom: none;
  }

  .spec-card__mobile-tier-label {
    font-size: 10px;
    color: rgba(166, 187, 222, 0.4);
    width: 36px;
    flex-shrink: 0;
  }

  .spec-card__mobile-tier .trait-btn {
    height: auto;
  }

  .spec-card__mobile-tier .trait-btn img {
    width: 36px;
    height: 36px;
  }
```

Also add desktop hide rule above the media query:

```css
.spec-card__mobile-header { display: none; }
.spec-card__mobile-tiers { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add src/site/site-mobile.css
git commit -m "feat(site): add specialization accordion mobile CSS"
```

---

### Task 4: Create `mobile.js` — Mobile Detection + Skill Bar Meta Row

**Files:**
- Create: `src/site/mobile.js`
- Modify: `src/site/render-build.js` (line 7 — add import; after line 420 or wherever `renderBuildPage` ends — call init)

- [ ] **Step 1: Create `mobile.js` with mobile detection and skill bar meta row injection**

```javascript
/* AxiForge — SPA mobile enhancements */

const MOBILE_BREAKPOINT = 768;

/** True when viewport is at or below mobile breakpoint */
export function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Add `mobile` class to #app based on viewport width.
 * Updates on resize.
 */
export function initMobileDetection() {
  const app = document.getElementById("app");
  if (!app) return;

  function update() {
    app.classList.toggle("mobile", isMobile());
  }

  update();
  window.addEventListener("resize", update);
}

/**
 * Inject the swap pill + HP badge row between weapon and utility skill rows.
 * Only runs on mobile. The element is hidden on desktop via CSS.
 */
export function initSkillBarMobile() {
  const skillsBar = document.querySelector(".skills-bar");
  if (!skillsBar) return;

  // Find existing swap button to clone its click behavior
  const existingSwap = skillsBar.querySelector(".weapon-swap-btn");

  // Read HP value from the health orb
  const hpEl = skillsBar.querySelector(".health-orb__hp");
  const hpValue = hpEl ? hpEl.textContent : "";

  // Create the mobile meta row
  const metaRow = document.createElement("div");
  metaRow.className = "skills-bar__mobile-meta";

  // Swap pill
  const swapPill = document.createElement("button");
  swapPill.className = "mobile-swap-pill";
  swapPill.innerHTML = `<span class="mobile-swap-pill__icon">⇄</span> Swap`;
  if (existingSwap) {
    swapPill.disabled = existingSwap.disabled;
    swapPill.addEventListener("click", () => existingSwap.click());
  }

  // HP badge
  const hpBadge = document.createElement("div");
  hpBadge.className = "mobile-hp-badge";
  hpBadge.innerHTML = `
    <span class="mobile-hp-badge__dot"></span>
    <span class="mobile-hp-badge__value">${hpValue}</span>
    <span class="mobile-hp-badge__label">HP</span>
  `;

  metaRow.append(swapPill, hpBadge);

  // Insert after the weapon column (first child of skills-bar),
  // before the orb column
  const orbCol = skillsBar.querySelector(".skills-bar__orb-col");
  if (orbCol) {
    skillsBar.insertBefore(metaRow, orbCol);
  } else {
    // Fallback: just append
    skillsBar.appendChild(metaRow);
  }
}
```

- [ ] **Step 2: Import and call from `render-build.js`**

In `src/site/render-build.js`:

Add import at line 7 (after the `renderNotes` import):
```javascript
import { initMobileDetection, initSkillBarMobile } from "./mobile.js";
```

At the end of `renderBuildPage()` (before the closing `}`), add:
```javascript
  // Mobile enhancements
  initMobileDetection();
  initSkillBarMobile();
```

- [ ] **Step 3: Build to verify no errors**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add src/site/mobile.js src/site/render-build.js
git commit -m "feat(site): add mobile.js with detection and skill bar meta row"
```

---

### Task 5: Spec Accordion JS

**Files:**
- Modify: `src/site/mobile.js`
- Modify: `src/site/render-build.js`

- [ ] **Step 1: Add accordion logic to `mobile.js`**

Add to `mobile.js`:

```javascript
import { state } from "@renderer/modules/state.js";

/**
 * Convert spec cards to collapsible accordions on mobile.
 * Injects a collapsed header into each .spec-card with the spec emblem,
 * name, selected trait thumbnails, and a chevron.
 * Tap to expand/collapse. Only one expanded at a time.
 */
export function initSpecAccordion() {
  const specCards = document.querySelectorAll(".spec-card");
  if (!specCards.length) return;

  specCards.forEach((card, index) => {
    const panel = card.querySelector(".spec-card__panel");
    if (!panel) return;

    // Get spec data from state
    const specData = state.editor.specializations?.[index];
    const specId = specData?.id;
    const spec = specId ? state.activeCatalog.specializations?.get(specId) : null;

    // Build header
    const header = document.createElement("div");
    header.className = "spec-card__mobile-header";

    // Emblem — clone the existing one
    const existingEmblem = card.querySelector(".spec-emblem img");
    const emblemWrap = document.createElement("div");
    emblemWrap.className = "spec-card__mobile-emblem";
    if (existingEmblem) {
      emblemWrap.appendChild(existingEmblem.cloneNode(true));
    }

    // Spec name
    const nameEl = document.createElement("div");
    nameEl.className = "spec-card__mobile-name";
    nameEl.textContent = spec?.name || `Specialization ${index + 1}`;

    // Selected major trait thumbnails
    const traitsWrap = document.createElement("div");
    traitsWrap.className = "spec-card__mobile-traits";
    const activeTraits = card.querySelectorAll(".trait-column--major .trait-btn--active img");
    activeTraits.forEach(img => {
      const thumb = img.cloneNode(true);
      traitsWrap.appendChild(thumb);
    });

    // Chevron
    const chevron = document.createElement("span");
    chevron.className = "spec-card__mobile-chevron";
    chevron.textContent = "▾";

    header.append(emblemWrap, nameEl, traitsWrap, chevron);

    // Mark elite specs
    if (panel.classList.contains("spec-card__panel--elite")) {
      card.classList.add("spec-card--elite");
    }

    // Insert header before the panel
    card.insertBefore(header, panel);

    // Click handler
    header.addEventListener("click", () => {
      const wasExpanded = card.classList.contains("expanded");

      // Collapse all
      specCards.forEach(c => c.classList.remove("expanded"));

      // Toggle clicked
      if (!wasExpanded) {
        card.classList.add("expanded");
      }
    });
  });
}
```

- [ ] **Step 2: Call from `render-build.js`**

Update the import in `render-build.js`:
```javascript
import { initMobileDetection, initSkillBarMobile, initSpecAccordion } from "./mobile.js";
```

Add to the mobile init block at end of `renderBuildPage()`:
```javascript
  initSpecAccordion();
```

- [ ] **Step 3: Build to verify**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add src/site/mobile.js src/site/render-build.js
git commit -m "feat(site): add spec card accordion for mobile"
```

---

### Task 6: Equipment Sub-tabs CSS + JS

**Files:**
- Modify: `src/site/site-mobile.css`
- Modify: `src/site/mobile.js`
- Modify: `src/site/render-build.js`

- [ ] **Step 1: Add equipment mobile CSS inside the `@media` block**

```css
  /* --- Equipment Sub-tabs --- */
  .equip-layout {
    grid-template-columns: 1fr;
  }

  .equip-col--art {
    display: none;
  }

  /* Sub-tab bar — injected by mobile.js */
  .equip-mobile-tabs {
    display: flex;
    gap: 2px;
    background: rgba(8, 14, 28, 0.72);
    border: 1px solid var(--line-soft, rgba(100, 120, 160, 0.25));
    border-radius: 20px;
    padding: 3px;
    width: fit-content;
    margin-bottom: 12px;
  }

  .equip-mobile-tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 14px;
    border: none;
    border-radius: 16px;
    background: transparent;
    color: var(--text-dim, #7a9abf);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    line-height: 1.2;
  }

  .equip-mobile-tab:hover:not(.equip-mobile-tab--active) {
    background: rgba(100, 140, 200, 0.12);
    color: rgba(180, 200, 230, 0.9);
  }

  .equip-mobile-tab--active {
    background: rgba(74, 143, 214, 0.45);
    color: #fff;
    cursor: default;
  }
```

Also add desktop hide rule above the media query:
```css
.equip-mobile-tabs { display: none; }
```

- [ ] **Step 2: Add equipment sub-tab JS to `mobile.js`**

```javascript
/**
 * Inject sub-tab bar above equipment layout on mobile.
 * Toggles between "Armor & Runes" (left column) and "Weapons & Trinkets" (right column).
 */
export function initEquipmentSubTabs() {
  const equipLayout = document.querySelector(".equip-layout");
  if (!equipLayout) return;

  const leftCol = equipLayout.querySelector(".equip-col--left");
  const rightCol = equipLayout.querySelector(".equip-col--right");
  if (!leftCol || !rightCol) return;

  // Create sub-tab bar
  const tabBar = document.createElement("div");
  tabBar.className = "equip-mobile-tabs";

  const armorTab = document.createElement("button");
  armorTab.className = "equip-mobile-tab equip-mobile-tab--active";
  armorTab.textContent = "Armor & Runes";

  const weaponsTab = document.createElement("button");
  weaponsTab.className = "equip-mobile-tab";
  weaponsTab.textContent = "Weapons & Trinkets";

  tabBar.append(armorTab, weaponsTab);

  // Insert before the equipment layout
  equipLayout.parentElement.insertBefore(tabBar, equipLayout);

  // Initial state: show left, hide right
  function showArmor() {
    leftCol.style.display = "";
    rightCol.style.display = "none";
    armorTab.classList.add("equip-mobile-tab--active");
    weaponsTab.classList.remove("equip-mobile-tab--active");
  }

  function showWeapons() {
    leftCol.style.display = "none";
    rightCol.style.display = "";
    armorTab.classList.remove("equip-mobile-tab--active");
    weaponsTab.classList.add("equip-mobile-tab--active");
  }

  armorTab.addEventListener("click", showArmor);
  weaponsTab.addEventListener("click", showWeapons);

  // Only apply hide/show on mobile
  if (isMobile()) {
    showArmor();
  }

  // Handle resize — reset visibility when switching between mobile and desktop
  window.addEventListener("resize", () => {
    if (!isMobile()) {
      leftCol.style.display = "";
      rightCol.style.display = "";
    } else if (!weaponsTab.classList.contains("equip-mobile-tab--active")) {
      showArmor();
    }
  });
}
```

- [ ] **Step 3: Call from `render-build.js`**

Update import:
```javascript
import { initMobileDetection, initSkillBarMobile, initSpecAccordion, initEquipmentSubTabs } from "./mobile.js";
```

Add to the mobile init block:
```javascript
  initEquipmentSubTabs();
```

- [ ] **Step 4: Build to verify**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes successfully.

- [ ] **Step 5: Commit**

```bash
git add src/site/site-mobile.css src/site/mobile.js src/site/render-build.js
git commit -m "feat(site): add equipment sub-tabs for mobile"
```

---

### Task 7: Bottom Sheet Detail Panel — CSS

**Files:**
- Modify: `src/site/site-mobile.css`

- [ ] **Step 1: Add bottom sheet CSS**

Above the media query (these styles apply at all sizes but the sheet is only injected on mobile):

```css
/* Bottom sheet — injected by mobile.js on mobile viewports */
.bottom-sheet-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
}

.bottom-sheet-backdrop--active {
  display: block;
}

.bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 60vh;
  background: var(--panel, #101930);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bottom-sheet--active {
  transform: translateY(0);
}

.bottom-sheet__handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
  cursor: grab;
  flex-shrink: 0;
}

.bottom-sheet__handle-bar {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: rgba(166, 187, 222, 0.3);
}

.bottom-sheet__close {
  position: absolute;
  top: 8px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(100, 120, 160, 0.2);
  color: rgba(166, 187, 222, 0.7);
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
  z-index: 1;
}

.bottom-sheet__close:hover {
  background: rgba(100, 120, 160, 0.35);
  color: #e8f0ff;
}

.bottom-sheet__content {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 16px 24px;
}
```

Inside the `@media (max-width: 768px)` block:

```css
  /* --- Detail Panel / Hover Preview --- */
  .detail-panel {
    display: none !important;
  }

  .hover-preview {
    display: none !important;
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/site/site-mobile.css
git commit -m "feat(site): add bottom sheet CSS for mobile detail panel"
```

---

### Task 8: Bottom Sheet Detail Panel — JS

**Files:**
- Modify: `src/site/mobile.js`
- Modify: `src/site/render-build.js`

- [ ] **Step 1: Add bottom sheet JS to `mobile.js`**

```javascript
import { buildSkillCard } from "@renderer/modules/detail-panel.js";

let _bottomSheet = null;
let _backdrop = null;
let _sheetContent = null;
let _touchStartY = 0;
let _sheetStartTranslate = 0;

/**
 * Create and inject the bottom sheet DOM elements.
 */
function createBottomSheet() {
  // Backdrop
  _backdrop = document.createElement("div");
  _backdrop.className = "bottom-sheet-backdrop";
  _backdrop.addEventListener("click", closeBottomSheet);

  // Sheet
  _bottomSheet = document.createElement("div");
  _bottomSheet.className = "bottom-sheet";

  // Handle
  const handle = document.createElement("div");
  handle.className = "bottom-sheet__handle";
  handle.innerHTML = '<div class="bottom-sheet__handle-bar"></div>';

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "bottom-sheet__close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeBottomSheet);

  // Content
  _sheetContent = document.createElement("div");
  _sheetContent.className = "bottom-sheet__content";

  _bottomSheet.append(handle, closeBtn, _sheetContent);
  document.body.append(_backdrop, _bottomSheet);

  // Swipe to dismiss
  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  _bottomSheet.addEventListener("touchmove", onTouchMove, { passive: false });
  _bottomSheet.addEventListener("touchend", onTouchEnd, { passive: true });
}

function onTouchStart(e) {
  _touchStartY = e.touches[0].clientY;
  _sheetStartTranslate = 0;
  _bottomSheet.style.transition = "none";
}

function onTouchMove(e) {
  const deltaY = e.touches[0].clientY - _touchStartY;
  if (deltaY > 0) {
    _sheetStartTranslate = deltaY;
    _bottomSheet.style.transform = `translateY(${deltaY}px)`;
    e.preventDefault();
  }
}

function onTouchEnd() {
  _bottomSheet.style.transition = "";
  if (_sheetStartTranslate > 100) {
    closeBottomSheet();
  } else {
    _bottomSheet.style.transform = "";
    _bottomSheet.classList.add("bottom-sheet--active");
  }
}

export function openBottomSheet(kind, entity) {
  if (!_bottomSheet) createBottomSheet();
  _sheetContent.innerHTML = buildSkillCard(entity, kind || "skill");
  _backdrop.classList.add("bottom-sheet-backdrop--active");
  _bottomSheet.classList.add("bottom-sheet--active");
  _bottomSheet.style.transform = "";
  document.body.style.overflow = "hidden";
}

export function closeBottomSheet() {
  if (!_bottomSheet) return;
  _backdrop.classList.remove("bottom-sheet-backdrop--active");
  _bottomSheet.classList.remove("bottom-sheet--active");
  _bottomSheet.style.transform = "";
  document.body.style.overflow = "";
}

// Bottom sheet is lazily created on first openBottomSheet() call.
// No explicit init needed — render-build.js hooks openBottomSheet
// into the existing click-to-pin flow.
```

- [ ] **Step 2: Hook into render-build.js click-to-pin flow**

In `render-build.js`, the click-to-pin logic is around lines 359-373. It currently calls `updateReferencePanel()`. On mobile, we instead open the bottom sheet.

Update the import:
```javascript
import { initMobileDetection, initSkillBarMobile, initSpecAccordion, initEquipmentSubTabs, isMobile, openBottomSheet } from "./mobile.js";
```

Modify the click handler in `renderBuildPage()` (around line 359-373). The existing code checks if there's a hovered entity and calls `updateReferencePanel()`. Wrap that in a mobile check:

Find the click handler that calls `updateReferencePanel` and modify it to:
```javascript
if (isMobile()) {
  openBottomSheet(hoveredKind, hoveredEntity);
} else {
  updateReferencePanel(hoveredKind, hoveredEntity);
}
```

The exact code depends on how the hovered entity is tracked. Look for `setOnHoverPreview` usage and the click handler on `buildContent` that calls `updateReferencePanel`. The hover preview callback provides `(kind, entity)` — store these in local variables and use them in both paths.

- [ ] **Step 3: Build to verify**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add src/site/mobile.js src/site/render-build.js
git commit -m "feat(site): add bottom sheet detail panel for mobile"
```

---

### Task 9: Comp Page Mobile CSS

**Files:**
- Modify: `src/site/site-mobile.css`
- Modify: `src/site/render-comp.js`

- [ ] **Step 1: Add comp page mobile CSS inside the `@media` block**

```css
  /* --- Comp Page --- */
  .comp-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .party-lines {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .party-line {
    min-width: max-content;
  }

  .mini-build-card {
    width: 100%;
  }

  .boon-coverage-grid {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 8px;
  }

  .boon-coverage-grid > table,
  .boon-coverage-grid > div {
    min-width: max-content;
  }
```

- [ ] **Step 2: Import mobile detection in `render-comp.js`**

Add import at the top of `render-comp.js`:
```javascript
import { initMobileDetection } from "./mobile.js";
```

At the end of `renderCompPage()`, add:
```javascript
  initMobileDetection();
```

- [ ] **Step 3: Build to verify**

Run: `npx vite build --config src/site/vite.config.js`
Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add src/site/site-mobile.css src/site/render-comp.js
git commit -m "feat(site): add comp page mobile CSS overrides"
```

---

### Task 10: Integration Testing & Polish

**Files:**
- Possibly modify: `src/site/site-mobile.css`, `src/site/mobile.js`

- [ ] **Step 1: Run full build and existing tests**

```bash
npx vite build --config src/site/vite.config.js && npx jest tests/unit/siteBundle.test.js
```

Expected: Both pass. The site bundle test checks that the build produces valid HTML with expected files.

- [ ] **Step 2: Manual mobile testing checklist**

Start the Vite dev server and test in browser DevTools mobile emulation (375px iPhone SE and 390px iPhone 14):

```bash
npx vite --config src/site/vite.config.js
```

Test each section with a published build URL (`?b=fileId.key`):

1. **Global layout** — page fits viewport, no horizontal scroll on the page body
2. **Build header** — stacks vertically, profession icon is smaller, code widget is accessible
3. **Tabs** — evenly distributed, easy to tap
4. **Skill bar** — 3 rows (weapons / swap+HP / utils), no overflow, icons are tappable
5. **Specs** — all 3 collapsed by default, tap expands one, tap another collapses previous
6. **Equipment** — sub-tab bar visible, switching between Armor & Weapons works
7. **Bottom sheet** — tap a skill/trait, sheet slides up with details, tap backdrop or X dismisses, swipe down dismisses
8. **Comp page** — header stacks, party lines scroll horizontally, boon grid scrolls
9. **Desktop regression** — resize to >768px, everything looks normal (no mobile artifacts)

- [ ] **Step 3: Fix any issues found during testing**

Address spacing, overflow, or interaction bugs. Common things to watch for:
- Touch target sizes (minimum 44px recommended)
- Font readability at mobile sizes
- Z-index conflicts with bottom sheet
- Scroll locking when bottom sheet is open

- [ ] **Step 4: Final commit**

```bash
git add -u
git commit -m "fix(site): polish mobile responsiveness after testing"
```
