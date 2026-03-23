# SPA Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix boon tooltip clipping, add long-press-to-reset for individual boons, and add smooth spec card expand/collapse animations on mobile.

**Architecture:** Three independent changes touching equipment.js + equipment.css (boon fixes) and mobile.js + site-mobile.css (spec animation). No new files, no shared state between the changes.

**Tech Stack:** Vanilla JS, CSS transitions, touch events

---

### Task 1: Fix boon tooltip overflow on mobile

**Files:**
- Modify: `src/renderer/styles/equipment.css:1226` (append mobile media query)
- Modify: `src/renderer/modules/equipment.js:1258-1325` (boon item creation loop)

- [ ] **Step 1: Add mobile max-width CSS for tooltip**

At the end of `src/renderer/styles/equipment.css` (after line 1226), append:

```css

@media (max-width: 1024px) {
  .equip-boons__tooltip {
    max-width: calc(100vw - 24px);
  }
}
```

- [ ] **Step 2: Add JS bounds adjustment in boon item creation**

In `src/renderer/modules/equipment.js`, inside the `for (const def of BOON_DEFS)` loop, find the tooltip creation block (around line 1282-1286):

```javascript
    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "equip-boons__tooltip";
    tooltip.innerHTML = buildBoonTooltipHTML(def);
    item.append(tooltip);
```

Add a `pointerenter` listener on `item` right after `item.append(tooltip);` (before the click handler block at line 1289):

```javascript
    item.addEventListener("pointerenter", () => {
      tooltip.style.left = "";
      tooltip.style.transform = "";
      requestAnimationFrame(() => {
        const rect = tooltip.getBoundingClientRect();
        if (rect.left < 12) {
          tooltip.style.left = "0";
          tooltip.style.transform = `translateX(${12 - rect.left}px)`;
        } else if (rect.right > window.innerWidth - 12) {
          tooltip.style.left = "0";
          tooltip.style.transform = `translateX(${window.innerWidth - 12 - rect.right}px)`;
        }
      });
    });
    item.addEventListener("pointerleave", () => {
      tooltip.style.left = "";
      tooltip.style.transform = "";
    });
```

The `requestAnimationFrame` ensures the tooltip is visible (`display: block` via `:hover`) before measuring its rect.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (no unit tests touch tooltip positioning — this is a visual/DOM fix)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/equipment.css src/renderer/modules/equipment.js
git commit -m "fix: prevent boon tooltip overflow on mobile viewports"
```

---

### Task 2: Add long-press-to-reset for individual boons

**Files:**
- Modify: `src/renderer/modules/equipment.js:1258-1325` (boon item creation loop)

- [ ] **Step 1: Add long-press touch listeners to each boon item**

In `src/renderer/modules/equipment.js`, inside the `for (const def of BOON_DEFS)` loop, after the contextmenu handler blocks (after line 1310), add long-press touch handling:

```javascript
    // Long press to reset (mobile)
    let longPressTimer = null;
    iconWrap.addEventListener("touchstart", () => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        _assumedBoons[def.key] = def.stackable ? 0 : false;
        _render();
        iconWrap.style.opacity = "0.4";
        setTimeout(() => { iconWrap.style.opacity = ""; }, 150);
      }, 500);
    }, { passive: true });
    iconWrap.addEventListener("touchend", () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    iconWrap.addEventListener("touchmove", () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });
```

Note: `contextmenu` prevention is already handled by the existing `contextmenu` listeners on `iconWrap` (lines 1295-1299 and 1305-1309) which call `e.preventDefault()`.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/equipment.js
git commit -m "feat: long press to reset individual boon on mobile"
```

---

### Task 3: Smooth spec card expand/collapse animation

**Files:**
- Modify: `src/site/site-mobile.css:385-429` (spec card mobile rules inside `@media` block)
- Modify: `src/site/mobile.js:325-336` (click handler in `initSpecAccordion`)

- [ ] **Step 1: Replace display toggling with max-height/opacity transitions in CSS**

In `src/site/site-mobile.css`, replace the spec card panel/body rules inside the `@media (max-width: 1024px)` block.

Replace lines 385-397:

```css
  .spec-card__panel {
    display: none;
  }

  .spec-card.expanded .spec-card__panel {
    display: block;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .spec-card__body {
    display: none;
  }
```

With:

```css
  .spec-card__panel {
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-height 0.25s ease, opacity 0.2s ease;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .spec-card.expanded .spec-card__panel {
    opacity: 1;
  }
```

Remove the `.spec-card__body { display: none; }` rule entirely — the body stays visible inside the panel so `scrollHeight` measurement works. The panel's `max-height: 0; overflow: hidden` hides it.

- [ ] **Step 2: Update the JS click handler to animate max-height**

In `src/site/mobile.js`, replace the click handler (lines 326-336):

```javascript
    header.addEventListener("click", () => {
      const wasExpanded = card.classList.contains("expanded");

      // Collapse all
      specCards.forEach(c => c.classList.remove("expanded"));

      // Toggle clicked
      if (!wasExpanded) {
        card.classList.add("expanded");
      }
    });
```

With:

```javascript
    header.addEventListener("click", () => {
      const wasExpanded = card.classList.contains("expanded");

      // Collapse all others
      specCards.forEach(c => {
        if (c !== card && c.classList.contains("expanded")) {
          const p = c.querySelector(".spec-card__panel");
          if (p) {
            p.style.maxHeight = p.scrollHeight + "px";
            p.offsetHeight; // force reflow
            p.style.maxHeight = "0";
          }
          c.classList.remove("expanded");
        }
      });

      if (!wasExpanded) {
        // Expand
        card.classList.add("expanded");
        if (panel) {
          panel.style.maxHeight = panel.scrollHeight + "px";
          const onEnd = () => {
            panel.removeEventListener("transitionend", onEnd);
            if (card.classList.contains("expanded")) {
              panel.style.maxHeight = "none";
            }
          };
          panel.addEventListener("transitionend", onEnd);
        }
      } else {
        // Collapse
        if (panel) {
          panel.style.maxHeight = panel.scrollHeight + "px";
          panel.offsetHeight; // force reflow
          panel.style.maxHeight = "0";
        }
        card.classList.remove("expanded");
      }
    });
```

Key details:
- On **expand**: set `maxHeight` to `scrollHeight` so the CSS transition animates from 0 to content height. After transition ends, set `maxHeight = "none"` so content isn't clipped if it resizes.
- On **collapse**: first set `maxHeight` to current `scrollHeight` (replacing `none`), force reflow, then set to `0` — this gives the CSS transition a concrete start value to animate from.
- On **collapsing others**: same collapse pattern applied to any previously expanded card.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/site/site-mobile.css src/site/mobile.js
git commit -m "feat: smooth expand/collapse animation for spec cards on mobile"
```
