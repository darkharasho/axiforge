# Library Skeleton Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show pulsing skeleton placeholders in the library sidebar and content area during the initial app startup loading window, matching the user's saved view mode (list/table/grid/icon).

**Architecture:** Extend the existing `skeleton.js` / `skeleton.css` infrastructure with 5 new library-specific templates. Pre-populate `#lib-sidebar` and `#lib-content` in `index.html` with static list-view skeleton HTML for instant first paint. In `renderer.js`, read `library.viewMode` from settings before the heavy data load and re-inject the correct content template if it differs from list. `renderLibrary()` clears the skeleton naturally via `innerHTML` — no teardown needed.

**Tech Stack:** Vanilla JS ES modules, plain CSS, Jest (test runner: `jest`)

**Spec:** `docs/superpowers/specs/2026-03-18-library-skeleton-loading-design.md`

---

## File Map

| File | Change |
|---|---|
| `tests/unit/renderer/skeleton.test.js` | Add tests for 5 new library templates (TDD — write first) |
| `src/renderer/styles/skeleton.css` | Add sidebar layout + 5 shape classes |
| `src/renderer/modules/skeleton.js` | Add 5 helper functions + 5 template entries |
| `src/renderer/index.html` | Pre-populate `#lib-sidebar` and `#lib-content` with static skeleton HTML |
| `src/renderer/renderer.js` | Read `library.viewMode` early in `init()`, inject matching skeleton |

---

## Task 1: Write failing tests for library skeleton templates

**Files:**
- Modify: `tests/unit/renderer/skeleton.test.js`

- [ ] **Step 1: Add the failing test suite to skeleton.test.js**

Append this entire describe block at the end of the file, after the closing `});` of the existing `injectSkeleton` describe:

```js
describe("library skeleton templates", () => {
  test("exports templates for all five library panels", () => {
    expect(skeletonTemplates).toHaveProperty("library-sidebar");
    expect(skeletonTemplates).toHaveProperty("library-list");
    expect(skeletonTemplates).toHaveProperty("library-table");
    expect(skeletonTemplates).toHaveProperty("library-grid");
    expect(skeletonTemplates).toHaveProperty("library-icon");
  });

  test("library-sidebar contains section structure and skeleton items", () => {
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-item");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-icon");
    expect(skeletonTemplates["library-sidebar"]).toContain("skel-lib-sidebar-head");
  });

  test("library-list contains 6 rows with icon placeholder", () => {
    const icons = (skeletonTemplates["library-list"].match(/skel-lib-row-icon/g) || []).length;
    expect(icons).toBe(6);
    expect(skeletonTemplates["library-list"]).toContain("lib-list-row");
  });

  test("library-table contains header row and 6 data rows matching lib-tv grid", () => {
    expect(skeletonTemplates["library-table"]).toContain("lib-tv__header");
    const rows = (skeletonTemplates["library-table"].match(/class="lib-tv__row"/g) || []).length;
    expect(rows).toBe(6);
    expect(skeletonTemplates["library-table"]).toContain("skel-lib-row-icon");
  });

  test("library-grid contains 6 cards with centered icon using lib-grid classes", () => {
    const cards = (skeletonTemplates["library-grid"].match(/class="lib-grid-card"/g) || []).length;
    expect(cards).toBe(6);
    expect(skeletonTemplates["library-grid"]).toContain("lib-grid-card__header");
    expect(skeletonTemplates["library-grid"]).toContain("skel-lib-card-icon");
  });

  test("library-icon contains 10 icon items using lib-icon classes", () => {
    const items = (skeletonTemplates["library-icon"].match(/class="lib-icon-item"/g) || []).length;
    expect(items).toBe(10);
    expect(skeletonTemplates["library-icon"]).toContain("skel-lib-icon-img");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/unit/renderer/skeleton.test.js --no-coverage
```

Expected: 6 new failures — "Cannot find property 'library-sidebar'", etc. Existing tests still pass.

---

## Task 2: Add CSS shape and layout classes

**Files:**
- Modify: `src/renderer/styles/skeleton.css`

- [ ] **Step 1: Append library skeleton CSS at the end of skeleton.css**

Add after the last existing block (`/* ── Toolbar profession dropdown skeleton ── */`):

```css
/* ── Library skeleton ──────────────────────────────────────────────────────── */
/* Sidebar layout containers */
.skel-lib-sidebar { display: flex; flex-direction: column; padding: 8px 0; }
.skel-lib-sidebar-section { padding: 4px 0; }
.skel-lib-sidebar-label { padding: 4px 10px; }
.skel-lib-sidebar-item { display: flex; align-items: center; gap: 7px; padding: 5px 10px; height: 26px; }

/* Sidebar skeleton shapes */
.skel-lib-sidebar-head { height: 9px; }
.skel-lib-sidebar-icon { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }

/* List / table row icon placeholder (matches .lib-list-row__spec-icon and .lib-tv__icon svg) */
.skel-lib-row-icon { width: 18px; height: 18px; border-radius: 4px; flex-shrink: 0; }

/* Grid card spec icon placeholder (matches .lib-grid-card__spec-icon) */
.skel-lib-card-icon { width: 40px; height: 40px; border-radius: 6px; }

/* Icon view item image placeholder (matches .lib-icon-item__icon) */
.skel-lib-icon-img { width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0; }
```

- [ ] **Step 2: Commit CSS**

```bash
git add src/renderer/styles/skeleton.css
git commit -m "feat: add library skeleton CSS shape and layout classes"
```

---

## Task 3: Implement library skeleton templates

**Files:**
- Modify: `src/renderer/modules/skeleton.js`

Note: the table/grid/icon templates reuse existing library CSS classes (`.lib-tv`, `.lib-grid`, `.lib-icon-grid`, etc.) for layout — these are always loaded since `library.css` is part of the app bundle.

- [ ] **Step 1: Add helper functions before `const skeletonTemplates`**

Insert these four helpers directly above the line `const skeletonTemplates = {` (around line 105):

```js
function libListRow(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-list-row">
    <div class="skel${c(d1)} skel-lib-row-icon"></div>
    <div class="skel${c(d1)}" style="height:10px;width:${titleW}%;border-radius:3px"></div>
    <div class="skel${c(d2)}" style="height:9px;width:54px;border-radius:8px"></div>
    <div class="skel${c(d2)}" style="height:9px;width:46px;border-radius:8px"></div>
    <div class="skel${c(d3)}" style="height:9px;width:56px;border-radius:3px"></div>
  </div>`;
}

function libTableRow(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
    <li class="lib-tv__item">
      <div class="lib-tv__row">
        <span></span>
        <span class="lib-tv__icon"><div class="skel${c(d1)} skel-lib-row-icon"></div></span>
        <span><div class="skel${c(d1)}" style="height:9px;width:${titleW}%;border-radius:3px"></div></span>
        <span><div class="skel${c(d2)}" style="height:9px;width:58px;border-radius:8px"></div></span>
        <span><div class="skel${c(d2)}" style="height:9px;width:55px;border-radius:3px"></div></span>
        <span><div class="skel${c(d3)}" style="height:9px;width:34px;border-radius:3px"></div></span>
        <span></span>
        <span></span>
        <span><div class="skel${c(d3)}" style="height:9px;width:52px;border-radius:3px"></div></span>
        <span><div class="skel${c(d1)}" style="height:9px;width:52px;border-radius:3px"></div></span>
      </div>
    </li>`;
}

function libGridCard(titleW, d1, d2, d3) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-grid-card">
    <div class="lib-grid-card__header"><div class="skel${c(d1)} skel-lib-card-icon"></div></div>
    <div class="skel${c(d1)}" style="height:10px;width:${titleW}%;border-radius:3px"></div>
    <div class="lib-grid-card__pills">
      <div class="skel${c(d2)}" style="height:9px;width:50px;border-radius:8px"></div>
      <div class="skel${c(d2)}" style="height:9px;width:40px;border-radius:8px"></div>
    </div>
    <div class="lib-grid-card__date"><div class="skel${c(d3)}" style="height:8px;width:48px;border-radius:3px"></div></div>
  </div>`;
}

function libIconItem(d1, d2, w) {
  const c = (d) => d ? ` skel-d${d}` : "";
  return `
  <div class="lib-icon-item"><div class="skel${c(d1)} skel-lib-icon-img"></div><div class="skel${c(d2)}" style="height:8px;width:${w}px;border-radius:3px"></div></div>`;
}
```

- [ ] **Step 2: Add the five template entries to `skeletonTemplates`**

Add these entries to the `skeletonTemplates` object, after the existing `dropdown` entry (before the closing `};`):

```js
  "library-sidebar": `
<div class="skel-lib-sidebar">
  <div class="skel-lib-sidebar-section">
    <div class="skel-lib-sidebar-label"><div class="skel skel-lib-sidebar-head" style="width:80px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-lib-sidebar-icon"></div><div class="skel skel-d1" style="height:9px;width:70px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:9px;width:55px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:9px;width:80px"></div></div>
  </div>
  <div class="skel-lib-sidebar-section">
    <div class="skel-lib-sidebar-label"><div class="skel skel-d2 skel-lib-sidebar-head" style="width:65px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:9px;width:65px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:9px;width:75px"></div></div>
  </div>
</div>`,

  "library-list": `
<div class="lib-list">
  ${libListRow(52, "", 1, 2)}
  ${libListRow(68, 1, 2, 3)}
  ${libListRow(43, 2, 3, 1)}
  ${libListRow(60, 3, 1, 2)}
  ${libListRow(75, 1, 2, 3)}
  ${libListRow(38, 2, 3, 1)}
</div>`,

  "library-table": `
<div class="lib-tv">
  <div class="lib-tv__header">
    <span></span>
    <span></span>
    <span><div style="height:8px;width:30px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:50px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:50px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:35px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:35px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:35px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:42px;background:#1a1a3a;border-radius:3px"></div></span>
    <span><div style="height:8px;width:42px;background:#1a1a3a;border-radius:3px"></div></span>
  </div>
  <ul class="lib-tv__tree">
    ${libTableRow(62, "", 1, 2)}
    ${libTableRow(74, 1, 2, 3)}
    ${libTableRow(45, 2, 3, 1)}
    ${libTableRow(58, 3, 1, 2)}
    ${libTableRow(80, 1, 2, 3)}
    ${libTableRow(50, 2, 3, 1)}
  </ul>
</div>`,

  "library-grid": `
<div class="lib-grid">
  ${libGridCard(70, "", 1, 2)}
  ${libGridCard(60, 1, 2, 3)}
  ${libGridCard(82, 2, 3, 1)}
  ${libGridCard(68, 3, 1, 2)}
  ${libGridCard(55, 1, 2, 3)}
  ${libGridCard(75, 2, 3, 1)}
</div>`,

  "library-icon": `
<div class="lib-icon-grid">
  ${libIconItem("", 1, 48)}
  ${libIconItem(1, 2, 38)}
  ${libIconItem(2, 3, 52)}
  ${libIconItem(3, 1, 40)}
  ${libIconItem(1, 2, 44)}
  ${libIconItem(2, 3, 50)}
  ${libIconItem(3, 1, 36)}
  ${libIconItem("", 2, 48)}
  ${libIconItem(1, 3, 42)}
  ${libIconItem(2, 1, 46)}
</div>`,
```

- [ ] **Step 3: Run tests to confirm they pass**

```bash
npx jest tests/unit/renderer/skeleton.test.js --no-coverage
```

Expected: all tests pass including the 6 new ones.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/skeleton.js
git commit -m "feat: add library skeleton templates (sidebar, list, table, grid, icon)"
```

---

## Task 4: Pre-populate index.html with static skeleton HTML

**Files:**
- Modify: `src/renderer/index.html` (lines around 373–381)

This gives instant first-paint skeleton before any JS executes, covering the gap between HTML load and `renderer.js` running. The sidebar always shows `library-sidebar`; the content always shows `library-list` (the default). Non-list-view users get the correct template re-injected by `renderer.js` within ~50ms.

- [ ] **Step 1: Replace the empty lib-sidebar div with a pre-populated version**

Find:
```html
            <div id="lib-sidebar" class="lib-sidebar"></div>
```

Replace with:
```html
            <div id="lib-sidebar" class="lib-sidebar"><div class="skel-lib-sidebar">
  <div class="skel-lib-sidebar-section">
    <div class="skel-lib-sidebar-label"><div class="skel skel-lib-sidebar-head" style="width:80px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-lib-sidebar-icon"></div><div class="skel skel-d1" style="height:9px;width:70px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:9px;width:55px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:9px;width:80px"></div></div>
  </div>
  <div class="skel-lib-sidebar-section">
    <div class="skel-lib-sidebar-label"><div class="skel skel-d2 skel-lib-sidebar-head" style="width:65px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d3 skel-lib-sidebar-icon"></div><div class="skel skel-d3" style="height:9px;width:65px"></div></div>
    <div class="skel-lib-sidebar-item"><div class="skel skel-d2 skel-lib-sidebar-icon"></div><div class="skel skel-d2" style="height:9px;width:75px"></div></div>
  </div>
</div></div>
```

- [ ] **Step 2: Replace the empty lib-content div with a pre-populated version**

Find:
```html
              <div id="lib-content" class="lib-content"></div>
```

Replace with (this is the `library-list` template inlined — must stay in sync with `skeletonTemplates["library-list"]` if that template ever changes):
```html
              <div id="lib-content" class="lib-content"><div class="lib-list">
  <div class="lib-list-row"><div class="skel skel-lib-row-icon"></div><div class="skel" style="height:10px;width:52%;border-radius:3px"></div><div class="skel skel-d1" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d1" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d2" style="height:9px;width:56px;border-radius:3px"></div></div>
  <div class="lib-list-row"><div class="skel skel-d1 skel-lib-row-icon"></div><div class="skel skel-d1" style="height:10px;width:68%;border-radius:3px"></div><div class="skel skel-d2" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d2" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d3" style="height:9px;width:56px;border-radius:3px"></div></div>
  <div class="lib-list-row"><div class="skel skel-d2 skel-lib-row-icon"></div><div class="skel skel-d2" style="height:10px;width:43%;border-radius:3px"></div><div class="skel skel-d3" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d3" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d1" style="height:9px;width:56px;border-radius:3px"></div></div>
  <div class="lib-list-row"><div class="skel skel-d3 skel-lib-row-icon"></div><div class="skel skel-d3" style="height:10px;width:60%;border-radius:3px"></div><div class="skel skel-d1" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d1" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d2" style="height:9px;width:56px;border-radius:3px"></div></div>
  <div class="lib-list-row"><div class="skel skel-d1 skel-lib-row-icon"></div><div class="skel skel-d1" style="height:10px;width:75%;border-radius:3px"></div><div class="skel skel-d2" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d2" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d3" style="height:9px;width:56px;border-radius:3px"></div></div>
  <div class="lib-list-row"><div class="skel skel-d2 skel-lib-row-icon"></div><div class="skel skel-d2" style="height:10px;width:38%;border-radius:3px"></div><div class="skel skel-d3" style="height:9px;width:54px;border-radius:8px"></div><div class="skel skel-d3" style="height:9px;width:46px;border-radius:8px"></div><div class="skel skel-d1" style="height:9px;width:56px;border-radius:3px"></div></div>
</div></div>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: pre-populate lib-sidebar and lib-content with static skeleton HTML"
```

---

## Task 5: Wire early skeleton injection in renderer.js

**Files:**
- Modify: `src/renderer/renderer.js`

`injectSkeleton` is already imported at line 7. `q()` is defined at line 53 and available throughout the file.

- [ ] **Step 1: Add early skeleton injection before the heavy data load**

Find this block in `init()` (around line 276–282):
```js
  try { _lastGameMode = (await window.desktopApi.getSetting("lastGameMode")) || "pve"; } catch { /* first run */ }
  syncGameModeToggleUI(_lastGameMode);

  const [builds, professions] = await Promise.all([
    window.desktopApi.listBuilds(),
    window.desktopApi.listProfessions(),
  ]);
```

Replace with:
```js
  try { _lastGameMode = (await window.desktopApi.getSetting("lastGameMode")) || "pve"; } catch { /* first run */ }
  syncGameModeToggleUI(_lastGameMode);

  // Library skeleton: read saved view mode and show matching skeleton during the data load window.
  // The static HTML in index.html already shows the list skeleton for first paint; this re-injects
  // the correct template if the user's saved view mode differs from list.
  let _libViewMode = "list";
  try { _libViewMode = (await window.desktopApi.getSetting("library.viewMode")) || "list"; } catch { /* first run */ }
  injectSkeleton(q("#lib-sidebar"), "library-sidebar");
  injectSkeleton(q("#lib-content"), `library-${_libViewMode}`);

  const [builds, professions] = await Promise.all([
    window.desktopApi.listBuilds(),
    window.desktopApi.listProfessions(),
  ]);
```

- [ ] **Step 2: Run the full test suite to verify nothing is broken**

```bash
npx jest --no-coverage
```

Expected: all tests pass. (There are no unit tests for `renderer.js` — visual verification in the next step covers it.)

- [ ] **Step 3: Start the app and verify the skeleton visually**

```bash
npm start
```

Verification checklist:
- Navigate to the library page (if not already there)
- Restart the app with the library as the active page (close and reopen)
- During the 0.5–2s loading window, `#lib-sidebar` and `#lib-content` should show pulsing skeleton placeholders
- After loading completes, both containers should be replaced by real data with no visible flash
- Switch view mode to grid in the library, close and reopen the app — the content skeleton should show the grid card pattern
- Switch view mode to icon, close and reopen — icon skeleton should show
- Switch view mode to table, close and reopen — table skeleton should show

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: inject library skeleton during startup data load"
```
