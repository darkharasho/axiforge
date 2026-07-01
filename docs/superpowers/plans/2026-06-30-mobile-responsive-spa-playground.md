# Mobile-friendly SPA viewer & Playground editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the published SPA viewer and the Playground editor usable and intentional-looking on phones and tablets, without changing the desktop Electron app.

**Architecture:** The Playground reuses the desktop renderer behind `body.is-web`. All new mobile behavior for the editor lives in a self-contained layer (`src/web/web-mobile.css` + `src/web/web-mobile.js`) scoped under `body.is-web`, imported only in the web build — so the desktop renderer is untouched. The editor already splits into a `Build | Equipment` subnav (`.subnav`), so that becomes the top-level mobile nav; within each subtab, content reflows to a single collapsible scroll (phone) or 2-column grid (tablet). The read-only SPA viewer extends its existing `mobile.js` + `site-mobile.css`.

**Tech Stack:** Vanilla JS (ESM), plain CSS (no framework), Vite build, Playwright for browser tests.

## Global Constraints

- All Playground mobile CSS/JS MUST be scoped under `body.is-web` and imported ONLY in the web build (`src/web/main-web.js`). The desktop renderer (`src/renderer/index.html`) must render identically before and after. Copied verbatim from spec: "Desktop Electron renderer layout is **unchanged**."
- Breakpoints: **phone ≤ 600px**, **tablet 601–1024px**, **desktop > 1024px**. The SPA's existing `1024px` breakpoint stays as the tablet boundary.
- Minimum tap target size: **44×44px** on all skill/trait/gear tiles and buttons at phone/tablet widths.
- No PWA, no offline, no swipe gestures, no persisting section open/closed state, no new features. Pure responsive adaptation.
- The custom-select widget (`#professionSelect button`, portal `[data-cselect-portal="1"]`, options `.cselect__option`) does NOT open under synthetic mouse clicks — always verify real touch behavior in a browser (chrome-devtools MCP), never trust curl/dev-boot.
- Run vitest/playwright with limited parallelism per machine constraints. Playwright: prefer the default worker count from config; do not raise it.

## Key selectors (reference — verified against current DOM)

- Injected web top bar: `.web-topbar` (built in `src/web/chrome.js`), buttons `#webCopyLink`, `#webCopyAxi`, `#webCopyChat`, CTA `.web-topbar__cta`.
- Top-level editor nav: `.subnav` (gets `.subnav--visible` on the editor page), items `.subnav__item[data-subtab="build"|"equipment"]` (Notes/Comps hidden on web).
- Build subtab: `#subtab-build` → `.toolbar-grid` (title + profession), `#skillsHost`, `#specializationsHost` (traits — 3 specialization lines).
- Equipment subtab: `#subtab-equipment` → `#equipmentPanel` (gear + computed attributes/stats).
- Editor container: `.page-content`; on web `.is-web .app-layout` is `grid-template-columns: 1fr`.
- SPA viewer: `src/site/mobile.js`, `src/site/site-mobile.css` (existing `@media (max-width: 1024px)`), build render `src/site/render-build.js`, comp render `src/site/render-comp.js`.

## File Structure

- **Create:** `src/web/web-mobile.css` — all Playground editor mobile CSS (subnav-as-tabs, skills/traits/equipment reflow, sticky stat summary, modal-as-sheet, tablet 2-col, touch targets).
- **Create:** `src/web/web-mobile.js` — collapsible section toggle + custom-select touch fix.
- **Create:** `tests/playground/specs/mobile.spec.js` — Playwright mobile-viewport tests.
- **Modify:** `src/web/main-web.js` — import the mobile layer.
- **Modify:** `tests/playground/playwright.config.js` — add a `mobile` project (390×844).
- **Modify:** `src/site/site-mobile.css` — add `≤600px` phone refinement + comp fixes.
- **Modify:** `src/site/mobile.js` — extend only if a phone refinement needs JS (likely not).

---

### Task 1: Wire up the Playground mobile layer + mobile test project

**Files:**
- Create: `src/web/web-mobile.css`
- Create: `src/web/web-mobile.js`
- Modify: `src/web/main-web.js:1`
- Modify: `tests/playground/playwright.config.js:19-24`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Produces: `initWebMobile()` exported from `src/web/web-mobile.js` — call with no args; idempotent; safe to call after renderer init. Attaches collapsible-toggle + custom-select touch handlers.
- Produces: a Playwright project named `mobile` (viewport 390×844) usable via `--project=mobile`.

- [ ] **Step 1: Create the empty mobile CSS file with a scoping guard comment**

```css
/* src/web/web-mobile.css
 * Playground mobile layer. EVERYTHING here must be scoped under `body.is-web`
 * so it never affects the desktop Electron renderer. Imported only by main-web.js.
 * Breakpoints: phone <=600px, tablet 601-1024px, desktop >1024px (untouched).
 */
```

- [ ] **Step 2: Create the mobile JS module with an idempotent init**

```js
/* src/web/web-mobile.js — Playground mobile behavior (web build only). */

let installed = false;

/** Wire collapsible sections + custom-select touch fix. Idempotent. */
export function initWebMobile() {
  if (installed) return;
  installed = true;
  // Handlers added in later tasks (collapsible toggle, custom-select touch).
}
```

- [ ] **Step 3: Import the mobile layer in main-web.js**

Modify `src/web/main-web.js`. After the existing `import "./web.css";` add the CSS import, and call `initWebMobile()` after `initWebChrome`:

```js
import "./web.css";
import "./web-mobile.css";
import { createWebApi } from "./webApi/index.js";
import { seedDraftFromHash, initWebChrome } from "./chrome.js";
import { initWebMobile } from "./web-mobile.js";
```

Then at the end of the file, after `await initWebChrome(sharedBuild);`:

```js
await initWebChrome(sharedBuild);
initWebMobile();
```

- [ ] **Step 4: Add a mobile project to the Playwright config**

Modify `tests/playground/playwright.config.js` `projects` array to add a second entry:

```js
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
```

- [ ] **Step 5: Write the failing baseline test**

Create `tests/playground/specs/mobile.spec.js`:

```js
const { test, expect } = require("playwright/test");

const ENTRY = "/index.generated.html";
const READY_TIMEOUT = 20_000;

// Only run these on the mobile project (390x844).
test.skip(({ viewport }) => (viewport?.width ?? 0) > 600, "mobile-only");

test("editor loads with web chrome at phone width", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(page.locator(".leftnav")).toBeHidden();
});

test("page has no horizontal overflow at phone width", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1); // allow 1px rounding
});
```

- [ ] **Step 6: Run the mobile tests**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile`
Expected: "editor loads with web chrome" PASSES; "no horizontal overflow" MAY FAIL (proves work remains). Record which. If overflow already ≤1, note it — later tasks must keep it that way.

- [ ] **Step 7: Commit**

```bash
git add src/web/web-mobile.css src/web/web-mobile.js src/web/main-web.js \
  tests/playground/playwright.config.js tests/playground/specs/mobile.spec.js
git commit -m "feat(web): scaffold playground mobile layer + mobile playwright project"
```

---

### Task 2: Top-level subnav as mobile tabs

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `.subnav` / `.subnav__item[data-subtab]` from the renderer DOM.
- Produces: at ≤1024px the subnav is a sticky, full-width, touch-friendly tab strip. No new JS (subtab switching already works via the renderer's existing click handler).

- [ ] **Step 1: Write the failing test**

Add to `tests/playground/specs/mobile.spec.js`:

```js
test("subnav Build/Equipment tabs are tappable and switch subtabs", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  const buildTab = page.locator('.subnav__item[data-subtab="build"]');
  const equipTab = page.locator('.subnav__item[data-subtab="equipment"]');
  await expect(buildTab).toBeVisible();
  await expect(equipTab).toBeVisible();
  // Each tab must be at least 44px tall (touch target).
  const box = await equipTab.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await equipTab.click();
  await expect(page.locator("#subtab-equipment")).toBeVisible();
  await expect(page.locator("#subtab-build")).toBeHidden();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "subnav Build/Equipment"`
Expected: FAIL (touch height < 44px, or tabs cramped).

- [ ] **Step 3: Implement subnav-as-tabs CSS**

Append to `src/web/web-mobile.css`:

```css
@media (max-width: 1024px) {
  .is-web .subnav {
    position: sticky;
    top: 0;
    z-index: 20;
    gap: 0;
    padding: 0;
    min-height: 0;
  }
  .is-web .subnav__item {
    flex: 1 1 0;
    justify-content: center;
    min-height: 48px;
    border-radius: 0;
    font-size: 13px;
    border-bottom: 2px solid transparent;
  }
  .is-web .subnav__item--active {
    border-bottom-color: var(--accent, #c8a85a);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "subnav Build/Equipment"`
Expected: PASS.

- [ ] **Step 5: Verify no regression in overflow test + desktop**

Run: `npx playwright test --config tests/playground/playwright.config.js`
Expected: all desktop + mobile tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): mobile subnav as full-width sticky tabs"
```

---

### Task 3: Compact the web top bar on phones

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `.web-topbar`, `.web-topbar__btn`, `.web-topbar__btn-label`, `.web-topbar__cta`, `.web-topbar__beta`.
- Produces: at ≤600px, top bar fits one row without horizontal overflow — button text labels hidden (icons kept), "Get the desktop app" CTA hidden (available elsewhere), brand shrinks.

- [ ] **Step 1: Write the failing test**

Add to `mobile.spec.js`:

```js
test("web topbar fits without overflow and hides button labels on phone", async ({ page }) => {
  await page.goto(ENTRY);
  const bar = page.locator(".web-topbar");
  await expect(bar).toBeVisible({ timeout: READY_TIMEOUT });
  const barBox = await bar.boundingBox();
  expect(barBox.width).toBeLessThanOrEqual(391); // within 390 viewport (+1 rounding)
  // Button text labels collapse to icon-only on phone.
  await expect(page.locator(".web-topbar__btn-label").first()).toBeHidden();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "web topbar fits"`
Expected: FAIL (labels visible / bar overflows).

- [ ] **Step 3: Implement compact top bar CSS**

Append to `src/web/web-mobile.css`:

```css
@media (max-width: 600px) {
  .is-web .web-topbar {
    padding-inline: 12px;
    gap: 6px;
  }
  .is-web .web-topbar__btn-label {
    display: none;
  }
  .is-web .web-topbar__btn {
    padding: 8px;            /* icon-only, keep 44px-ish target */
    min-width: 40px;
    justify-content: center;
  }
  .is-web .web-topbar__cta {
    display: none;           /* "Get desktop app" not essential on phone */
  }
  .is-web .web-topbar__brand {
    font-size: 15px;
  }
  .is-web .web-topbar__beta {
    display: none;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "web topbar fits"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): compact icon-only top bar on phone"
```

---

### Task 4: Skills reflow within the Build subtab

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `#subtab-build`, `.toolbar-grid`, `#skillsHost` and the skills markup rendered inside it.
- Produces: at ≤600px, toolbar grid is single-column, skills wrap within viewport, tiles are ≥44px, no horizontal overflow in the Build subtab.

- [ ] **Step 1: Write the failing test** (drives a profession so real skills render)

Add a shared helper at top of `mobile.spec.js` (copy the picker approach from `playground.spec.js` — repeated here so this file is self-contained):

```js
async function pickCoreGuardian(page) {
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("#professionSelect button").click();
    await sleep(200);
    const portal = document.querySelector('[data-cselect-portal="1"]');
    const opt = [...(portal?.querySelectorAll(".cselect__option") || [])].find(
      (b) => b.textContent.trim() === "Core Guardian"
    );
    opt?.click();
  });
  await expect(page.locator("#professionSelect button").first()).toContainText("Core Guardian", {
    timeout: READY_TIMEOUT,
  });
}

test("build subtab has no horizontal overflow after picking a profession", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#subtab-build");
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "build subtab has no horizontal overflow"`
Expected: FAIL (skills row wider than viewport).

- [ ] **Step 3: Manually inspect real skill markup, then implement reflow CSS**

First, inspect the live skills DOM to get exact child class names (do not guess): use chrome-devtools MCP to open the dev server, pick Core Guardian, and read the `#skillsHost` subtree. Then append reflow rules to `src/web/web-mobile.css`, adapting selectors to what you observed. Baseline rules that should hold regardless:

```css
@media (max-width: 600px) {
  .is-web .toolbar-grid {
    grid-template-columns: 1fr !important; /* single column: title, then profession */
  }
  .is-web #skillsHost {
    overflow-x: hidden;
  }
  /* Skill/weapon rows wrap instead of forcing a fixed wide track. Adjust the
     child selector to the observed skill-row/slot container class. */
  .is-web #skillsHost [class*="skill-row"],
  .is-web #skillsHost [class*="skills__group"] {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 4: Verify in a real browser (chrome-devtools MCP)**

Open `http://localhost:5180/index.generated.html` at 390px, pick Core Guardian, confirm skills fit within width and tiles are tappable (≥44px). Adjust tile min-size if needed:

```css
@media (max-width: 600px) {
  .is-web #skillsHost [class*="slot"],
  .is-web #skillsHost [class*="skill-icon"] {
    min-width: 44px;
    min-height: 44px;
  }
}
```

- [ ] **Step 5: Run to verify the test passes**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "build subtab has no horizontal overflow"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): reflow skills + toolbar to single column on phone"
```

---

### Task 5: Traits reflow — stack the 3 specialization lines

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `#specializationsHost` and its per-specialization row markup.
- Produces: at ≤600px the 3 specialization lines stack vertically (each full width); trait tiers reflow within each line; no horizontal overflow.

- [ ] **Step 1: Write the failing test**

Add to `mobile.spec.js`:

```js
test("specialization lines stack vertically on phone", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // Read the direct specialization children and assert they stack (increasing top).
  const tops = await page.evaluate(() => {
    const host = document.querySelector("#specializationsHost");
    const lines = [...host.children].filter((c) => c.getBoundingClientRect().height > 20);
    return lines.slice(0, 3).map((l) => Math.round(l.getBoundingClientRect().top));
  });
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i]).toBeGreaterThan(tops[i - 1]);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "specialization lines stack"`
Expected: FAIL if specs are side-by-side (equal tops) OR overflow. If it happens to pass because the host is already column-flow, still complete steps 3–4 for tier wrapping + touch targets and keep the test as a guard.

- [ ] **Step 3: Inspect real trait markup, then implement stacking CSS**

Inspect `#specializationsHost` children in the browser for exact class names, then append to `src/web/web-mobile.css`:

```css
@media (max-width: 600px) {
  .is-web #specializationsHost {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .is-web #specializationsHost > * {
    width: 100%;
  }
  /* Trait tiers (Adept/Master/Grandmaster rows) wrap within a line. Adapt the
     child selector to the observed tier/trait-choice container. */
  .is-web #specializationsHost [class*="trait"] {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 4: Verify in a real browser + check overflow**

At 390px with Core Guardian: confirm 3 lines stack, trait choices are tappable (≥44px), no horizontal scroll. Add tile min-size if trait dots are too small.

- [ ] **Step 5: Run to verify it passes**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "specialization lines stack"`
Expected: PASS. Then run the whole mobile project to confirm no overflow regressions.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): stack specialization lines vertically on phone"
```

---

### Task 6: Equipment reflow + sticky stat summary

**Files:**
- Modify: `src/web/web-mobile.css`
- Modify: `src/web/web-mobile.js`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `#subtab-equipment`, `#equipmentPanel` (gear slots + computed attributes).
- Produces: at ≤600px, gear slots are a single full-width column; the computed attributes summary is sticky at the bottom of the equipment subtab so edits show live feedback; no horizontal overflow.

- [ ] **Step 1: Write the failing test**

Add to `mobile.spec.js`:

```js
test("equipment subtab is single-column with no overflow on phone", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  await page.locator('.subnav__item[data-subtab="equipment"]').click();
  await expect(page.locator("#subtab-equipment")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.querySelector("#equipmentPanel");
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "equipment subtab is single-column"`
Expected: FAIL (equipment grid wider than viewport).

- [ ] **Step 3: Inspect equipment markup, then implement single-column reflow**

Inspect `#equipmentPanel` in the browser for the gear-grid and attributes container class names. Append to `src/web/web-mobile.css` (adapt selectors to observed markup):

```css
@media (max-width: 600px) {
  .is-web #equipmentPanel [class*="equip-grid"],
  .is-web #equipmentPanel [class*="equipment__grid"] {
    grid-template-columns: 1fr !important;
    display: grid;
  }
  .is-web #equipmentPanel [class*="slot"] {
    width: 100%;
    min-height: 44px;
  }
  /* Sticky computed attributes summary at the bottom of the scroll. Adapt the
     selector to the observed attributes/stat-summary container. */
  .is-web #equipmentPanel [class*="attributes"],
  .is-web #equipmentPanel [class*="stat-summary"] {
    position: sticky;
    bottom: 0;
    z-index: 10;
    background: var(--panel, #14161c);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
}
```

- [ ] **Step 4: Verify sticky behavior in a real browser**

At 390px, Equipment subtab: scroll gear list, confirm the attributes summary stays pinned at the bottom and updates when you change a stat. If the attributes block is huge, condense it via CSS (smaller font/padding at ≤600px) rather than adding JS. Only if a condensed *mini* summary genuinely needs DOM changes, add a minimal helper in `web-mobile.js` inside `initWebMobile()`; otherwise leave `web-mobile.js` unchanged and note that in the commit.

- [ ] **Step 5: Run to verify it passes**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "equipment subtab is single-column"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.css src/web/web-mobile.js tests/playground/specs/mobile.spec.js
git commit -m "feat(web): single-column equipment with sticky stat summary on phone"
```

---

### Task 7: Custom-select touch fix + menu height cap

**Files:**
- Modify: `src/web/web-mobile.js`
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: `#professionSelect button` (trigger), `[data-cselect-portal="1"]` (menu portal), `.cselect__option`, `.cselect__menu`.
- Produces: the profession/skill selects open on real touch (`hasTouch` context) and the open menu is height-capped and scrollable within the viewport.

- [ ] **Step 1: Write the failing test (real touch, not DOM click)**

Add to `mobile.spec.js`:

```js
test("profession select opens on a real tap", async ({ page }) => {
  await page.goto(ENTRY);
  await expect(page.locator(".web-topbar")).toBeVisible({ timeout: READY_TIMEOUT });
  await page.locator("#professionSelect button").tap();  // real touch, not .evaluate click
  const portal = page.locator('[data-cselect-portal="1"]');
  await expect(portal).toBeVisible({ timeout: 5000 });
  // Menu stays within the viewport height.
  const box = await portal.boundingBox();
  expect(box.height).toBeLessThanOrEqual(844);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "profession select opens on a real tap"`
Expected: FAIL (menu doesn't open on touch and/or exceeds viewport). If it opens but overflows, that still fails on the height assertion — proceed to fix both.

- [ ] **Step 3: Inspect the custom-select source to find why touch fails**

Read `src/renderer/styles/custom-select.css` and the custom-select JS module to see how the trigger opens (likely a `mousedown`/`click` listener). Determine whether touch needs a `touchstart`/`pointerup` bridge. Do NOT modify the desktop module; instead add a web-only bridge in `web-mobile.js`.

- [ ] **Step 4: Implement the touch bridge + menu cap**

In `src/web/web-mobile.js`, inside `initWebMobile()`, add a delegated pointer handler that forwards taps on a custom-select trigger to a click (only when the native path didn't already open it):

```js
  // Some touch browsers don't synthesize a click that the custom-select opens on.
  // Bridge pointerup -> click on select triggers (web build only).
  document.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType !== "touch") return;
      const trigger = e.target.closest?.(".cselect__trigger, #professionSelect button");
      if (!trigger) return;
      const alreadyOpen = document.querySelector('[data-cselect-portal="1"]');
      if (!alreadyOpen) trigger.click();
    },
    { passive: true }
  );
```

Append to `src/web/web-mobile.css`:

```css
@media (max-width: 1024px) {
  .is-web .cselect__menu {
    max-height: 60vh;
    overflow-y: auto;
  }
}
```

- [ ] **Step 5: Verify on real touch in a browser + run test**

Verify with chrome-devtools MCP (touch emulation) that the profession picker opens on tap and scrolls. Then:

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "profession select opens on a real tap"`
Expected: PASS. Confirm the existing `playground.spec.js` desktop share/restore test still passes (the bridge must not double-fire on desktop):
Run: `npx playwright test --config tests/playground/playwright.config.js --project=desktop`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.js src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): open custom-select on touch + cap menu height on mobile"
```

---

### Task 8: Detail/wiki modals as bottom sheets on phone

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`

**Interfaces:**
- Consumes: the skill/trait detail modal + wiki modal containers (from `src/renderer/styles/detail-modal.css`, `wiki-modal.css`).
- Produces: at ≤600px these modals render as near-fullscreen sheets instead of desktop-positioned floating panels.

- [ ] **Step 1: Inspect modal markup + open one in the browser**

Read `src/renderer/styles/detail-modal.css` and `wiki-modal.css` for the modal root class names. In the browser at 390px, pick Core Guardian and tap a skill to open the detail modal; note its root selector and current sizing.

- [ ] **Step 2: Write the failing test**

Add to `mobile.spec.js` (replace `.detail-modal` with the observed modal root if different):

```js
test("skill detail modal is near-fullscreen on phone", async ({ page }) => {
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // Open a skill detail — adapt the trigger selector to the observed skill tile.
  await page.locator("#skillsHost [class*='slot']").first().click();
  const modal = page.locator("[class*='detail-modal']").first();
  await expect(modal).toBeVisible({ timeout: 5000 });
  const box = await modal.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(390 * 0.9); // >=90% of viewport width
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "skill detail modal is near-fullscreen"`
Expected: FAIL (modal narrower / desktop-positioned).

- [ ] **Step 4: Implement bottom-sheet CSS**

Append to `src/web/web-mobile.css` (adapt selectors to observed modal roots):

```css
@media (max-width: 600px) {
  .is-web [class*="detail-modal"],
  .is-web [class*="wiki-modal"] {
    position: fixed !important;
    inset: auto 0 0 0 !important;   /* pin to bottom, full width */
    width: 100% !important;
    max-width: 100% !important;
    max-height: 85vh !important;
    border-radius: 14px 14px 0 0 !important;
    overflow-y: auto !important;
  }
}
```

- [ ] **Step 5: Verify in browser + run test**

Confirm modal opens as a bottom sheet and is dismissable at 390px. Then:

Run: `npx playwright test --config tests/playground/playwright.config.js --project=mobile -g "skill detail modal is near-fullscreen"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js
git commit -m "feat(web): render detail/wiki modals as bottom sheets on phone"
```

---

### Task 9: Tablet 2-column reflow (601–1024px)

**Files:**
- Modify: `src/web/web-mobile.css`
- Test: `tests/playground/specs/mobile.spec.js`
- Modify: `tests/playground/playwright.config.js` (add a `tablet` project)

**Interfaces:**
- Consumes: `#subtab-build` (skills + traits). The Build/Equipment subnav still switches subtabs; the 2-column layout applies within the Build subtab (Skills column + Traits column).
- Produces: at 601–1024px the Build subtab lays skills and traits side-by-side in two columns; no horizontal overflow.

- [ ] **Step 1: Add a tablet Playwright project**

Modify `tests/playground/playwright.config.js` projects to add:

```js
    {
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
```

Update the mobile-only `test.skip` guard in `mobile.spec.js` so overflow/tablet tests behave: change the top-of-file guard to skip only the phone-specific tests, or gate per-test with `viewport.width`. Concretely, remove the file-level `test.skip` and instead add per-test guards where a test is phone-only (e.g. the compact-topbar and bottom-sheet tests): `test.skip(({ viewport }) => viewport.width > 600, "phone-only")` inside those tests' bodies is not valid; instead wrap with `test("...", async ({ page, viewport }) => { test.skip(viewport.width > 600, "phone-only"); ... })`.

- [ ] **Step 2: Write the failing tablet test**

Add to `mobile.spec.js`:

```js
test("build subtab is two columns on tablet", async ({ page, viewport }) => {
  test.skip(viewport.width <= 600 || viewport.width > 1024, "tablet-only");
  await page.goto(ENTRY);
  await pickCoreGuardian(page);
  // Skills host and specializations host should sit side-by-side (overlapping y-range).
  const layout = await page.evaluate(() => {
    const a = document.querySelector("#skillsHost").getBoundingClientRect();
    const b = document.querySelector("#specializationsHost").getBoundingClientRect();
    return { aRight: a.right, bLeft: b.left, aLeft: a.left, bRight: b.right };
  });
  // Two columns: one starts to the right of where the other ends (in some order).
  const sideBySide = layout.bLeft >= layout.aRight - 2 || layout.aLeft >= layout.bRight - 2;
  expect(sideBySide).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx playwright test --config tests/playground/playwright.config.js --project=tablet -g "build subtab is two columns"`
Expected: FAIL (stacked, not side-by-side).

- [ ] **Step 4: Implement tablet 2-column CSS**

Append to `src/web/web-mobile.css`:

```css
@media (min-width: 601px) and (max-width: 1024px) {
  .is-web #subtab-build {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .is-web #subtab-build .toolbar-grid {
    grid-column: 1 / -1;   /* title + profession span both columns */
  }
  /* skillsHost in column 1, specializationsHost in column 2 (source order). */
}
```

- [ ] **Step 5: Verify in browser at 768px + run test**

Confirm skills/traits sit side-by-side and Equipment subtab still reads well. Then:

Run: `npx playwright test --config tests/playground/playwright.config.js --project=tablet -g "build subtab is two columns"`
Expected: PASS.

- [ ] **Step 6: Run the full suite across all projects**

Run: `npx playwright test --config tests/playground/playwright.config.js`
Expected: desktop + mobile + tablet all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/web-mobile.css tests/playground/specs/mobile.spec.js tests/playground/playwright.config.js
git commit -m "feat(web): two-column build layout on tablet"
```

---

### Task 10: SPA viewer phone refinement + comp audit

**Files:**
- Modify: `src/site/site-mobile.css`
- Modify: `src/site/mobile.js` (only if a refinement needs JS)
- Test: manual (chrome-devtools MCP) — the SPA has no Playwright harness; verify manually

**Interfaces:**
- Consumes: SPA build view (`render-build.js`) and comp view (`render-comp.js`) DOM, gated behind the existing `#app.mobile` class from `mobile.js`.
- Produces: at ≤600px, both the build view and the comp view fit the viewport with no horizontal overflow; comp party/pool cards and boon-coverage rows reflow to single column.

- [ ] **Step 1: Establish the baseline in a browser**

Serve the SPA build output (`npm run build:site` or the project's SPA build/dev command — check `src/site/vite.config.js` and `package.json` scripts; use the site dev command) and open a published build URL and a published comp URL (use an existing `?b=`/`?c=` fixture, or build one locally). At 390px, screenshot both. Record every horizontal-overflow and cramped area (expect: comp pool cards, boon-coverage rows, wide stat tables).

- [ ] **Step 2: Add the phone refinement block for the build view**

Append to `src/site/site-mobile.css` (below the existing `@media (max-width: 1024px)` block):

```css
@media (max-width: 600px) {
  /* Build view: ensure single-column, no overflow. Adapt selectors to the
     overflow sources found in Step 1. */
  #app.mobile .build-columns,
  #app.mobile [class*="two-col"] {
    grid-template-columns: 1fr !important;
    display: grid;
  }
  #app.mobile * {
    max-width: 100%;
  }
}
```

- [ ] **Step 3: Verify the build view at 390px**

Reload the published build URL at 390px. Confirm no horizontal scroll (`document.documentElement.scrollWidth <= clientWidth + 1` via devtools console). Iterate on selectors from Step 1 until clean.

- [ ] **Step 4: Add the comp view refinements**

Append comp-specific rules to `src/site/site-mobile.css` (adapt to observed comp markup from `render-comp.js`):

```css
@media (max-width: 600px) {
  /* Comp view: party lines + pool cards stack single-column; boon rows wrap. */
  #app.mobile [class*="party"],
  #app.mobile [class*="pool"] {
    grid-template-columns: 1fr !important;
    display: grid;
  }
  #app.mobile [class*="boon-coverage"] {
    overflow-x: auto;   /* icon strip scrolls rather than breaking layout */
  }
}
```

- [ ] **Step 5: Verify the comp view at 390px and 768px**

Reload the published comp URL at 390px then 768px. Confirm no horizontal overflow at either width and that boon-coverage interactions (expand/tooltip) still work on touch. Iterate as needed.

- [ ] **Step 6: Commit**

```bash
git add src/site/site-mobile.css src/site/mobile.js
git commit -m "feat(site): phone-width refinement for build + comp views"
```

---

### Task 11: Final verification sweep + desktop regression guard

**Files:**
- Test: all of the above; no code changes unless a regression is found.

- [ ] **Step 1: Run the full Playground Playwright suite (all projects)**

Run: `npx playwright test --config tests/playground/playwright.config.js`
Expected: desktop + mobile + tablet all PASS.

- [ ] **Step 2: Manual cross-viewport check of the Playground (chrome-devtools MCP)**

At 390, 768, and 1280px: pick a profession, edit skills/traits/gear, open a detail modal, copy a share link. Confirm each works and nothing overflows. Capture a screenshot at each width.

- [ ] **Step 3: Desktop renderer regression guard**

Build/launch the desktop Electron app (project's dev/run command) and confirm the editor renders identically to before this branch — no `body.is-web` styles leaked. Spot-check the subnav, skills, traits, equipment, and a detail modal.

- [ ] **Step 4: Manual cross-viewport check of the SPA viewer**

At 390 and 768px: open a published build URL and a published comp URL; confirm no overflow and interactions work. Capture screenshots.

- [ ] **Step 5: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "test: mobile verification sweep + fixes"
```

---

## Self-Review

**Spec coverage:**
- Breakpoints (phone/tablet/desktop) → Global Constraints + Tasks 2–9. ✓
- Playground scoped mobile layer (`web-mobile.css` + `web-mobile.js`, web-only import) → Task 1. ✓
- Collapsible/single-scroll editor via existing subnav → Tasks 2, 4, 5, 6. ✓
- Skills reflow → Task 4. Traits stack → Task 5. Equipment single-col + sticky stats → Task 6. ✓
- 44px touch targets → Tasks 2, 4, 5, 6. ✓
- Custom-select touch fix + menu cap → Task 7. ✓
- Detail/wiki modal as sheet → Task 8. ✓
- Tablet 2-column → Task 9. ✓
- SPA viewer phone refinement + comp audit → Task 10. ✓
- Manual chrome-devtools verification + Playwright mobile run + desktop regression guard → Tasks 1–11, esp. Task 11. ✓

**Placeholder scan:** Some CSS child selectors (skills/traits/equipment/modals) are intentionally "inspect-then-adapt" because the exact rendered class names live in JS-built DOM not readable from static HTML; each such step includes a concrete inspection action + a working fallback rule, not a bare TODO. Acceptable given the DOM is runtime-generated.

**Type/name consistency:** `initWebMobile()` defined in Task 1, imported/called in Task 1, extended in Tasks 6/7. Playwright projects `desktop`/`mobile`/`tablet` consistent across Tasks 1, 9. `pickCoreGuardian` defined once in Task 4, reused in 5/6/8/9. Selectors (`#skillsHost`, `#specializationsHost`, `#equipmentPanel`, `#subtab-build`, `#subtab-equipment`, `.subnav__item[data-subtab]`, `#professionSelect button`, `[data-cselect-portal="1"]`) match the verified DOM.
