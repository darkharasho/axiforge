# SPA Mobile Polish — Boon Tooltips, Long Press Reset, Spec Animations

**Date:** 2026-03-23

## Overview

Three targeted improvements to the SPA mobile experience: fix boon tooltip clipping, add long-press-to-reset for individual boons, and smooth spec card expand/collapse animations.

## 1. Boon Tooltip Overflow Fix

### Problem

The assumed-boons tooltip uses `position: absolute; left: 50%; transform: translateX(-50%)` centered under each boon icon. No viewport bounds checking exists. On mobile, boons near the left or right edge produce tooltips that overflow the screen.

### Solution

After the tooltip is positioned (on hover/focus), measure its rect with `getBoundingClientRect()`. If it overflows left or right, shift `left` / `transform` to keep it within the viewport with 12px padding.

**CSS safety net** (equipment.css, inside `@media (max-width: 1024px)`):

```css
.equip-boons__tooltip {
  max-width: calc(100vw - 24px);
}
```

**JS bounds adjustment** (equipment.js — in `renderAssumedBoons` where tooltip elements are created):

On `pointerenter` / `focusin` of each `.equip-boons__item`, after the tooltip becomes visible:

```javascript
const rect = tooltip.getBoundingClientRect();
if (rect.left < 12) {
  tooltip.style.left = '0';
  tooltip.style.transform = `translateX(${12 - rect.left}px)`;
} else if (rect.right > window.innerWidth - 12) {
  tooltip.style.left = '0';
  tooltip.style.transform = `translateX(${window.innerWidth - 12 - rect.right}px)`;
}
```

Reset the inline styles on `pointerleave` / `focusout`.

### Files changed

- `src/renderer/modules/equipment.js` — add bounds adjustment logic in boon item creation
- `src/renderer/styles/equipment.css` — add mobile `max-width` for tooltip

## 2. Long Press to Reset Individual Boon

### Problem

On mobile there is no way to reset a single boon to its default value. Desktop users can right-click to decrement stackable boons, but mobile has no equivalent for quickly clearing a boon.

### Solution

Add a long-press gesture (500ms hold) on each `.equip-boons__item`. When triggered, reset that boon to its default value (`0` for stackable boons like Might/Stability, `false` for toggle boons) and re-render.

**Implementation** (equipment.js — in the boon item event wiring):

```javascript
let longPressTimer = null;
item.addEventListener('touchstart', (e) => {
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    // Reset this boon
    _assumedBoons[boonKey] = typeof _assumedBoons[boonKey] === 'number' ? 0 : false;
    _render();
    // Visual feedback: brief opacity pulse
    item.style.opacity = '0.4';
    setTimeout(() => { item.style.opacity = ''; }, 150);
  }, 500);
}, { passive: true });

item.addEventListener('touchend', () => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
item.addEventListener('touchmove', () => {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}, { passive: true });
```

Prevent context menu on long press so the browser menu doesn't appear:

```javascript
item.addEventListener('contextmenu', (e) => e.preventDefault());
```

### Files changed

- `src/renderer/modules/equipment.js` — add long-press event listeners to boon items

## 3. Spec Card Expand/Collapse Animation

### Problem

The mobile spec card accordion uses `display: none/block` toggling which causes instant show/hide with no transition. The chevron rotates smoothly (0.2s) but the content appears/disappears abruptly.

### Solution

Replace `display: none/block` with a `max-height` + `opacity` transition on both `.spec-card__panel` and `.spec-card__body`.

**CSS changes** (site-mobile.css, inside the `@media (max-width: 1024px)` block):

```css
/* Replace display:none with animated collapse */
.spec-card__panel {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-height 0.25s ease, opacity 0.2s ease;
}

.spec-card.expanded .spec-card__panel {
  opacity: 1;
  /* max-height set by JS to measured scrollHeight */
}

.spec-card__body {
  /* keep display:flex always so it contributes to scrollHeight measurement */
}
```

**JS changes** (mobile.js — in the click handler for `initSpecAccordion`):

On expand:
1. Set `panel.style.maxHeight = panel.scrollHeight + 'px'`
2. After transition ends, set `maxHeight = 'none'` to avoid clipping if content resizes

On collapse:
1. Set `panel.style.maxHeight = panel.scrollHeight + 'px'` (force current height)
2. Force reflow, then set `panel.style.maxHeight = '0'`
3. The CSS transition animates the collapse

The `transitionend` listener clears `maxHeight` to `none` when fully expanded so content isn't clipped.

### Files changed

- `src/site/site-mobile.css` — replace `display` toggling with `max-height`/`opacity` transitions
- `src/site/mobile.js` — measure and set `max-height` on expand/collapse, handle `transitionend`

## Testing

- **Boon tooltip**: on mobile viewport, tap boons near left and right edges — tooltip stays on screen
- **Long press reset**: hold a boon for 500ms — it resets to default, brief opacity flash confirms
- **Spec animation**: expand/collapse spec cards — smooth slide animation, no content clipping after expand
- **Desktop regression**: all three features should not affect desktop behavior (tooltips still hover-positioned, boons still click/right-click, specs not accordion on desktop)
