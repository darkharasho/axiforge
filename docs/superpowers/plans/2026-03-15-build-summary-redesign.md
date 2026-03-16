# Build Summary Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the collapsible build summary section from the editor, move action buttons to the subnav bar, and enrich build library cards with spec/skill details.

**Architecture:** Two independent UI changes sharing no new code. Part 1 relocates buttons from a `<details>` block to the subnav bar with an overflow menu. Part 2 enriches build card rendering with data already available on saved build objects.

**Tech Stack:** Vanilla JS, CSS, HTML (Electron renderer)

**Spec:** `docs/superpowers/specs/2026-03-15-build-summary-redesign.md`

---

## File Map

| File | Role |
|------|------|
| `src/renderer/index.html` | Remove `<details>` block (lines 92-106), add buttons + overflow to subnav (lines 63-70) |
| `src/renderer/styles/layout.css` | Add `.subnav__actions`, `.subnav__overflow-btn`, `.subnav__overflow-menu`, `.subnav__overflow-item`, `.subnav__save-dot`. Remove `margin-left: auto` from `.game-mode-toggle` |
| `src/renderer/styles/cards.css` | Remove `.build-summary-*` and `.dirty-badge` CSS (lines 251-262, 436-506). Add `.build-card__header`, `.build-card__pills`, `.build-card__pill`, `.build-card__pill--elite`, `.build-card__detail` |
| `src/renderer/modules/render-pages.js` | Rewrite `renderEditorMeta()`, update `renderEditorForm()`, enrich `renderBuildList()` |
| `src/renderer/renderer.js` | Update DOM cache, rewire event handlers, add overflow menu toggle/close logic |
| `src/renderer/modules/utils.js` | Add `formatShortDate()` helper |

---

## Chunk 1: Subnav Buttons & Remove Build Summary

### Task 1: Add `formatShortDate` utility

**Files:**
- Modify: `src/renderer/modules/utils.js:12-17`

- [ ] **Step 1: Add `formatShortDate` function after existing `formatDate`**

In `src/renderer/modules/utils.js`, add after the `formatDate` function (after line 17):

```js
export function formatShortDate(value) {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/utils.js
git commit -m "feat: add formatShortDate utility for build cards"
```

---

### Task 2: Restructure subnav HTML — add action buttons and overflow menu

**Files:**
- Modify: `src/renderer/index.html:63-106`

- [ ] **Step 1: Replace the subnav and remove the details block**

Replace the `<nav id="subnav">` block (lines 63-70) with:

```html
        <nav id="subnav" class="subnav subnav--visible">
          <button class="subnav__item subnav__item--active" data-subtab="build" type="button"><span class="subnav__icon">&#9876;</span> Build</button>
          <button class="subnav__item" data-subtab="equipment" type="button"><span class="subnav__icon">&#9775;</span> Equipment</button>
          <div class="subnav__actions">
            <button id="saveBuildBtn" class="btn btn-primary subnav__save-btn" type="button">
              <span id="saveDot" class="subnav__save-dot hidden"></span>
              Save
            </button>
            <button id="publishSiteBtn" class="btn btn-primary" type="button">Publish</button>
            <div id="publishStatus" class="publish-status"></div>
            <div class="subnav__overflow">
              <button id="overflowMenuBtn" class="subnav__overflow-btn" type="button" title="More actions">&#x22EF;</button>
              <div id="overflowMenu" class="subnav__overflow-menu hidden">
                <button id="duplicateBuildBtn" class="subnav__overflow-item" type="button">
                  <span class="subnav__overflow-icon">&#x2398;</span> Duplicate
                </button>
                <button id="copyBuildBtn" class="subnav__overflow-item hidden" type="button">
                  <span class="subnav__overflow-icon">&#x2750;</span> Copy JSON
                </button>
                <button id="pasteBuildBtn" class="subnav__overflow-item hidden" type="button">
                  <span class="subnav__overflow-icon">&#x2709;</span> Paste JSON
                </button>
              </div>
            </div>
            <div class="game-mode-toggle">
              <button class="game-mode-toggle__btn game-mode-toggle__btn--active" data-mode="pve" type="button">PvE</button>
              <button class="game-mode-toggle__btn" data-mode="wvw" type="button">WvW</button>
            </div>
          </div>
        </nav>
```

- [ ] **Step 2: Remove the entire `<details id="buildSummaryDetails">` block**

**Important:** After Step 1, line numbers have shifted. Locate the block by searching for `id="buildSummaryDetails"`, not by line number. Delete from `<details id="buildSummaryDetails"` through the closing `</details>` tag. The `<section class="panel panel--toolbar">` should now only contain the `.toolbar-grid` div.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: move action buttons to subnav, remove build summary details block"
```

---

### Task 3: Add subnav action styles to layout.css

**Files:**
- Modify: `src/renderer/styles/layout.css:289-319`

- [ ] **Step 1: Remove `margin-left: auto` from `.game-mode-toggle`**

In `src/renderer/styles/layout.css`, change `.game-mode-toggle` (line 290) from `margin-left: auto` to just removing that property. The rule becomes:

```css
.game-mode-toggle {
  display: flex;
  border-radius: 4px;
  overflow: hidden;
}
```

- [ ] **Step 2: Add subnav action styles**

Add the following after the `.subnav__item--active` rule (after line 220) in `src/renderer/styles/layout.css`:

```css
.subnav__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.subnav__save-btn {
  display: flex;
  align-items: center;
  gap: 5px;
}

.subnav__save-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffb347;
  flex-shrink: 0;
}

.subnav__overflow {
  position: relative;
}

.subnav__overflow-btn {
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #7a9abf;
  font-size: 16px;
  cursor: pointer;
  letter-spacing: 2px;
  transition: background 0.15s, color 0.15s;
}

.subnav__overflow-btn:hover {
  background: rgba(80, 132, 163, 0.12);
  color: var(--text, #c8dff0);
}

.subnav__overflow-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 160px;
  background: rgba(10, 17, 34, 0.98);
  border: 1px solid #2a3f69;
  border-radius: 8px;
  padding: 4px 0;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.subnav__overflow-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: #c8dff0;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.subnav__overflow-item:hover {
  background: rgba(80, 132, 163, 0.15);
}

.subnav__overflow-icon {
  font-size: 14px;
  opacity: 0.7;
  width: 18px;
  text-align: center;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/layout.css
git commit -m "style: add subnav action button and overflow menu styles"
```

---

### Task 4: Remove old build summary CSS

**Files:**
- Modify: `src/renderer/styles/cards.css:251-262, 436-506`

- [ ] **Step 1: Remove `.dirty-badge` rule**

Delete lines 251-262 (the `.dirty-badge` rule) from `src/renderer/styles/cards.css`.

- [ ] **Step 2: Remove all `.build-summary-*` rules**

Delete lines 436-506 (from `.build-summary-details` through `.build-summary__value`) from `src/renderer/styles/cards.css`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/cards.css
git commit -m "style: remove build summary and dirty badge CSS"
```

---

### Task 5: Update renderer.js — DOM cache, event wiring, overflow menu

**Files:**
- Modify: `src/renderer/renderer.js:63-74, 486-554`

- [ ] **Step 1: Update DOM element cache**

In the `el` object (around line 63), make these changes:

- **Delete** line 67: `editorDirtyBadge:  q("#editorDirtyBadge"),`
- **Delete** line 68: `buildSummary:      q("#buildSummary"),`
- **Add** after `saveBuildBtn` (line 63): `saveDot:           q("#saveDot"),`
- **Add** after `pasteBuildBtn` (line 66): `overflowMenuBtn:   q("#overflowMenuBtn"),`
- **Add** after the new `overflowMenuBtn`: `overflowMenu:      q("#overflowMenu"),`

The `publishSiteBtn` (line 69) and `publishStatus` (line 74) references stay as-is — the element IDs haven't changed, just their DOM location.

- [ ] **Step 2: Add overflow menu toggle and close logic**

After the existing event listeners for paste (around line 506), add:

```js
  // Overflow menu toggle
  el.overflowMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.overflowMenu.classList.toggle("hidden");
  });

  // Close overflow menu on outside click or Escape
  document.addEventListener("click", () => {
    el.overflowMenu.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") el.overflowMenu.classList.add("hidden");
  });

  // Close overflow menu when any item is clicked
  el.overflowMenu.addEventListener("click", () => {
    el.overflowMenu.classList.add("hidden");
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: wire up subnav buttons and overflow menu toggle"
```

---

### Task 6: Rewrite `renderEditorMeta()` and update `renderEditorForm()`

**Files:**
- Modify: `src/renderer/modules/render-pages.js:471-531`

- [ ] **Step 1: Update `renderEditorForm()` references**

In `renderEditorForm()` (lines 471-482), the references to `_el.publishSiteBtn`, `_el.copyBuildBtn`, and `_el.duplicateBuildBtn` remain valid because the element IDs haven't changed — they've just moved in the DOM. No changes needed to this function.

- [ ] **Step 2: Rewrite `renderEditorMeta()` to only manage save dot**

Replace the entire `renderEditorMeta()` function (lines 488-531) with:

```js
export function renderEditorMeta() {
  if (state.editorDirty) {
    _el.saveDot.classList.remove("hidden");
  } else {
    _el.saveDot.classList.add("hidden");
  }
}
```

The Save button text "Save" is static in the HTML. The `<span id="saveDot">` is a child element inside the button, so we only toggle its visibility — do NOT use `textContent` on the button as that would destroy the span child.

- [ ] **Step 3: Add `saveDot` to the DOM cache passed from renderer.js**

In `src/renderer/renderer.js`, ensure `saveDot` is included in the `el` object (done in Task 5 Step 1). The `initRenderPagesDom(el)` call already passes the full `el` object, so `_el.saveDot` will be available in render-pages.js.

- [ ] **Step 4: Remove the `_el.buildSummary` reference**

Since we removed `buildSummary` from the DOM cache in Task 5, and the old `renderEditorMeta()` was the only consumer, no further cleanup is needed.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "feat: simplify renderEditorMeta to save-dot only"
```

---

## Chunk 2: Enriched Build Library Cards

### Task 7: Add build card CSS styles

**Files:**
- Modify: `src/renderer/styles/cards.css` (after `.build-card__actions`, around line 216)

- [ ] **Step 1: Add new build card styles**

Add after the `.build-card__actions` rule:

```css
.build-card__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.build-card__date {
  font-size: 0.7rem;
  color: #7a9abf;
  white-space: nowrap;
}

.build-card__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.build-card__pill {
  background: #1a2844;
  border: 1px solid #2a3f69;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.65rem;
  color: #c8dff0;
  font-weight: 500;
}

.build-card__pill--mode {
  color: #9eb8e5;
}

.build-card__pill--elite {
  background: rgba(78, 168, 255, 0.1);
  border-color: rgba(78, 168, 255, 0.3);
  color: #7ab8f5;
}

.build-card__detail {
  margin-top: 4px;
  font-size: 0.68rem;
  color: #7a9abf;
  line-height: 1.5;
}

.build-card__detail-label {
  color: #9eb8e5;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/cards.css
git commit -m "style: add enriched build card pill and detail styles"
```

---

### Task 8: Enrich `renderBuildList()` card rendering

**Files:**
- Modify: `src/renderer/modules/render-pages.js:348-356`
- Modify: `src/renderer/modules/utils.js` (import)

- [ ] **Step 1: Import `formatShortDate` in render-pages.js**

Update the import line at the top of `src/renderer/modules/render-pages.js` (line 2):

```js
import { escapeHtml, formatDate, formatShortDate, formatPagesStatus, makeButton, matchesBuildQuery, delay } from "./utils.js";
```

- [ ] **Step 2: Rewrite the card innerHTML in `renderBuildList()`**

Replace the card rendering block (lines 348-356) with:

```js
  for (const build of visible) {
    const card = document.createElement("article");
    const active = build.id && build.id === state.editor.id;
    const dirtySuffix = active && state.editorDirty ? " | Unsaved edits" : "";
    card.className = `build-card ${active ? "build-card--active" : ""}`;

    // Extract enriched data from saved build
    const specNames = (build.specializations || [])
      .map((s) => s.name)
      .filter(Boolean);
    const eliteSpec = (build.specializations || []).find((s) => s.elite);
    const skillNames = [
      build.skills?.heal?.name || "",
      ...((build.skills?.utility || []).map((s) => s?.name || "")),
      build.skills?.elite?.name || "",
    ].filter(Boolean);

    // Build pills
    let pillsHtml = `<span class="build-card__pill">${escapeHtml(build.profession || "Unknown")}</span>`;
    pillsHtml += `<span class="build-card__pill build-card__pill--mode">${escapeHtml((build.gameMode || "pve").toUpperCase())}</span>`;
    if (eliteSpec) {
      pillsHtml += `<span class="build-card__pill build-card__pill--elite">${escapeHtml(eliteSpec.name)}</span>`;
    }

    // Build detail lines
    let detailHtml = "";
    if (specNames.length) {
      detailHtml += `<div class="build-card__detail"><span class="build-card__detail-label">Specs:</span> ${escapeHtml(specNames.join(" \u00B7 "))}</div>`;
    }
    if (skillNames.length) {
      detailHtml += `<div class="build-card__detail"><span class="build-card__detail-label">Skills:</span> ${escapeHtml(skillNames.join(" \u00B7 "))}</div>`;
    }

    card.innerHTML = `
      <div class="build-card__header">
        <h3>${escapeHtml(build.title || "Untitled Build")}${escapeHtml(dirtySuffix)}</h3>
        <span class="build-card__date">${escapeHtml(formatShortDate(build.updatedAt))}</span>
      </div>
      <div class="build-card__pills">${pillsHtml}</div>
      ${detailHtml}
    `;
```

The rest of the function (action buttons creation from line 358 onward) stays unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/render-pages.js src/renderer/modules/utils.js
git commit -m "feat: enrich build library cards with specs, skills, and pill tags"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Launch the app**

```bash
npm start
```

- [ ] **Step 2: Verify subnav buttons**

1. Confirm Save and Publish buttons appear in the subnav bar, right side
2. Edit a build — confirm orange dot appears on Save button
3. Save — confirm dot disappears
4. Click ⋯ — confirm dropdown with "Duplicate" appears
5. Click outside or press Escape — confirm dropdown closes
6. If dev mode (localhost): confirm Copy JSON and Paste JSON appear in dropdown

- [ ] **Step 3: Verify build library cards**

1. Navigate to Build Library page
2. Confirm each card shows: title, short date, profession/mode/elite pills, spec line, skill line
3. Confirm cards with no elite spec don't show the blue pill
4. Confirm cards with no skills/specs omit those lines
5. Confirm Load, Publish, Delete buttons still work

- [ ] **Step 4: Verify editor toolbar is clean**

1. Confirm no collapsible details section below the Title/Profession/Tags row
2. Confirm the toolbar panel is just the input grid

- [ ] **Step 5: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "feat: build summary redesign — complete"
```
