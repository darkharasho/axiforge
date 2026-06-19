# Settings Revamp (Sidebar-Nav Modal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the cramped single-column Settings modal into a roomier sidebar-navigation modal where one category shows at a time, with no change to settings data, persistence, or IPC.

**Architecture:** Presentation-only refactor of two files. `settings-modal.js` gets a `CATEGORIES` table that drives a left nav and per-pane headers; the existing section markup is repackaged into `.settings-modal__pane` panels (every existing element ID preserved so all wiring is untouched), and a small `_switchPane()` toggles the visible pane. `settings-modal.css` gets a flex sidebar/main/pane layout and a wider modal. All business logic (theme apply, webhook CRUD, publishing setup, shared library, cache) is reused verbatim.

**Tech Stack:** Vanilla ES-module renderer, plain CSS with `--accent`/`--panel`/`--line` design tokens, Jest 30 (`testEnvironment: "node"` by default; jsdom opted in per-file via docblock), babel-jest.

## Global Constraints

- No changes to `src/main/buildStore.js`, the preload bridge, or main-process settings IPC.
- No new persisted settings keys. Last-open category is in-memory only (resets on app restart).
- Preserve every element ID currently read in `settings-modal.js` (the `_el` map at lines 142–163 and the section IDs `sm-appearance-section`, `sm-publishing-section`, `sm-shared-library-section`): `sm-close`, `sm-theme-grid`, `sm-target-picker`, `sm-setup-row`, `sm-comp-webhooks`, `sm-add-comp-webhook`, `sm-build-webhooks`, `sm-add-build-webhook`, `sm-save-status`, `sm-clear-cache`, `sm-cache-status`, `sm-shared-status`, `sm-shared-setup`, `sm-shared-connected`, `sm-org-select`, `sm-shared-connect`, `sm-shared-disconnect`, `sm-shared-org-name`, `sm-themed-builds`.
- Icons: reuse the existing inline feather-style SVGs already in the file (gear, palette/brush, message-bubble, upload-arrow, users, database, close-X). Do not add an icon dependency.
- Theme accent tokens: active/hover use `rgba(var(--accent-rgb), 0.16)` / `0.08`.
- Run tests with `--maxWorkers=2`.
- Category order and copy (used verbatim in the `CATEGORIES` table):
  - `appearance` → title "Appearance", desc "Theme and build-page appearance."
  - `discord` → title "Discord", desc "Post comps and builds to Discord channels via webhooks."
  - `publishing` → title "Publishing", desc "Publish your builds to a public web page."
  - `shared-library` → title "Shared Library", desc "Share a build library with your organization."
  - `data` → title "Data & Cache", desc "Manage cached GW2 API data."

---

### Task 1: CSS — sidebar/main/pane layout

**Files:**
- Modify: `src/renderer/styles/settings-modal.css`
- Test: `tests/unit/settingsModalLayout.test.js` (create)

**Interfaces:**
- Consumes: existing design tokens (`--bg`, `--bg-2`, `--panel`, `--panel-2`, `--line`, `--line-soft`, `--text`, `--text-light`, `--text-dim`, `--accent`, `--accent-rgb`) and existing input/toggle/pill/webhook/btn classes (unchanged).
- Produces: classes consumed by Task 2 — `.settings-modal` (flex row, widened), `.settings-modal__sidebar`, `.settings-modal__brand`, `.settings-modal__brand-icon`, `.settings-modal__nav`, `.settings-modal__nav-item`, `.settings-modal__nav-item--active`, `.settings-modal__main`, `.settings-modal__main-header`, `.settings-modal__pane-title`, `.settings-modal__pane-desc`, `.settings-modal__pane`, `.settings-modal__pane--active`, `.settings-modal__action-buttons`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settingsModalLayout.test.js`:

```js
"use strict";

const fs = require("fs");
const path = require("path");

describe("settings-modal CSS — sidebar-nav layout", () => {
  let css;
  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(__dirname, "../../src/renderer/styles/settings-modal.css"),
      "utf8"
    );
  });

  test(".settings-modal is a horizontal flex container", () => {
    const block = css.match(/\.settings-modal\s*\{[^}]*\}/)?.[0] || "";
    expect(block).toMatch(/display\s*:\s*flex/);
    expect(block).not.toMatch(/flex-direction\s*:\s*column/);
  });

  test(".settings-modal is wider than the old 520px", () => {
    const block = css.match(/\.settings-modal\s*\{[^}]*\}/)?.[0] || "";
    const width = block.match(/width\s*:\s*(\d+)px/)?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(760);
  });

  test("sidebar and nav-item classes exist", () => {
    expect(css).toMatch(/\.settings-modal__sidebar\s*\{/);
    expect(css).toMatch(/\.settings-modal__nav-item\s*\{/);
    expect(css).toMatch(/\.settings-modal__nav-item--active\s*\{/);
  });

  test("active nav item uses the accent tint", () => {
    const block = css.match(/\.settings-modal__nav-item--active\s*\{[^}]*\}/)?.[0] || "";
    expect(block).toMatch(/rgba\(var\(--accent-rgb\)\s*,\s*0?\.16\)/);
  });

  test("inactive panes are hidden, active pane shown", () => {
    const pane = css.match(/\.settings-modal__pane\s*\{[^}]*\}/)?.[0] || "";
    expect(pane).toMatch(/display\s*:\s*none/);
    const active = css.match(/\.settings-modal__pane--active\s*\{[^}]*\}/)?.[0] || "";
    expect(active).toMatch(/display\s*:\s*block/);
  });

  test("sm-section-in keyframe to-state still resets transform to none (issue regression)", () => {
    const kf = css.match(/@keyframes\s+sm-section-in\s*\{[\s\S]*?\n\}/)?.[0] || "";
    const to = kf.match(/to\s*\{[\s\S]*?\}/)?.[0] || "";
    expect(to).not.toMatch(/transform\s*:\s*translateY\s*\(\s*0/);
    expect(to).toMatch(/transform\s*:\s*none/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/settingsModalLayout.test.js --maxWorkers=2`
Expected: FAIL (the new classes don't exist yet; `.settings-modal` is still `flex-direction: column` / width 520).

- [ ] **Step 3: Edit the CSS**

In `src/renderer/styles/settings-modal.css`:

a) Replace the `.settings-modal` rule so it is a horizontal flex container, widened, with padding removed (panes own their padding):

```css
.settings-modal {
  display: flex;
  flex-direction: row;
  width: 840px;
  max-width: calc(100vw - 48px);
  height: 560px;
  max-height: calc(100vh - 80px);
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
}
```

b) Add the sidebar + nav block:

```css
.settings-modal__sidebar {
  width: 212px;
  flex: none;
  background: var(--panel-2);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
}
.settings-modal__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  padding: 6px 10px 16px;
}
.settings-modal__brand-icon { width: 17px; height: 17px; color: var(--accent); flex: none; }
.settings-modal__nav { display: flex; flex-direction: column; gap: 2px; }
.settings-modal__nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 11px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-light);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.settings-modal__nav-item svg { width: 17px; height: 17px; opacity: 0.85; flex: none; }
.settings-modal__nav-item:hover { background: rgba(var(--accent-rgb), 0.08); color: var(--text); }
.settings-modal__nav-item--active {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
  font-weight: 600;
}
.settings-modal__nav-item--active svg { opacity: 1; }
```

c) Add the main column + pane block:

```css
.settings-modal__main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.settings-modal__main-header {
  position: relative;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.settings-modal__pane-title { margin: 0; font-size: 17px; color: var(--text); }
.settings-modal__pane-desc { margin: 3px 0 0; font-size: 12.5px; color: var(--text-dim); }
.settings-modal__body { flex: 1; overflow: auto; padding: 20px 24px; }
.settings-modal__pane { display: none; }
.settings-modal__pane--active { display: block; animation: sm-section-in 0.18s ease both; }
.settings-modal__action-buttons { display: flex; gap: 8px; }
```

d) Move the close button to the top-right of the main header. Update the existing `.settings-modal__close` positioning rule (or add) so it sits in `.settings-modal__main-header`:

```css
.settings-modal__close { position: absolute; top: 14px; right: 16px; }
```

e) Update the `.settings-modal__actions` rule so it lays out the save-status on the left and the button group on the right:

```css
.settings-modal__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-top: 1px solid var(--line);
}
```

f) Confirm the existing `@keyframes sm-section-in` ends its `to` state with `transform: none` (keep as-is if already correct — the regression test in Step 1 guards this).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/settingsModalLayout.test.js --maxWorkers=2`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Run the existing settings CSS regression test**

Run: `npx jest tests/unit/settingsModalDropdown.test.js --maxWorkers=2`
Expected: PASS (z-index and keyframe assertions still hold).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/styles/settings-modal.css tests/unit/settingsModalLayout.test.js
git commit -m "feat(settings): add sidebar-nav layout styles"
```

---

### Task 2: JS — restructure markup into sidebar + panes

**Files:**
- Modify: `src/renderer/modules/settings-modal.js:55-139` (the `_overlay.innerHTML` template) and the `_el` map at `:142-163`
- Test: `tests/unit/settingsModalNav.test.js` (create)

**Interfaces:**
- Consumes: CSS classes from Task 1.
- Produces: a module-level `CATEGORIES` array `[{ id, label, desc, icon }]` and DOM with `.settings-modal__nav-item[data-pane=<id>]` buttons + `.settings-modal__pane[data-pane=<id>]` sections, default pane `appearance` active. Consumed by Task 3 (`_switchPane`) and Task 4 (footer buttons).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settingsModalNav.test.js`:

```js
/**
 * @jest-environment jsdom
 */
"use strict";

// The four direct imports are only used inside event handlers / async render
// paths, never at module-init, so stub them to avoid pulling transitive deps.
jest.mock("../../src/renderer/modules/state.js", () => ({ state: {} }));
jest.mock("../../src/renderer/modules/custom-select.js", () => ({ renderCustomSelect: jest.fn() }));
jest.mock("../../src/renderer/modules/utils.js", () => ({
  escapeHtml: (s) => String(s),
  delay: () => Promise.resolve(),
}));
jest.mock("../../src/renderer/modules/confirm-modal.js", () => ({ showConfirmModal: jest.fn() }));

const { initSettingsModal } = require("../../src/renderer/modules/settings-modal.js");

describe("settings-modal — sidebar nav structure", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    initSettingsModal();
  });

  test("renders five nav items in order", () => {
    const items = [...document.querySelectorAll(".settings-modal__nav-item")];
    expect(items.map((b) => b.dataset.pane)).toEqual([
      "appearance", "discord", "publishing", "shared-library", "data",
    ]);
  });

  test("renders a matching pane for every nav item", () => {
    const panes = [...document.querySelectorAll(".settings-modal__pane")];
    expect(panes.map((p) => p.dataset.pane).sort()).toEqual(
      ["appearance", "data", "discord", "publishing", "shared-library"]
    );
  });

  test("appearance is the default active nav item and pane", () => {
    const activeNav = document.querySelector(".settings-modal__nav-item--active");
    expect(activeNav.dataset.pane).toBe("appearance");
    const activePane = document.querySelector(".settings-modal__pane--active");
    expect(activePane.dataset.pane).toBe("appearance");
  });

  test("preserves every wired element ID", () => {
    for (const id of [
      "sm-close", "sm-theme-grid", "sm-target-picker", "sm-setup-row",
      "sm-comp-webhooks", "sm-add-comp-webhook", "sm-build-webhooks",
      "sm-add-build-webhook", "sm-save-status", "sm-clear-cache", "sm-cache-status",
      "sm-shared-status", "sm-shared-setup", "sm-shared-connected", "sm-org-select",
      "sm-shared-connect", "sm-shared-disconnect", "sm-shared-org-name", "sm-themed-builds",
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/settingsModalNav.test.js --maxWorkers=2`
Expected: FAIL (no `.settings-modal__nav-item` elements; old markup has `.settings-modal__section` instead).

- [ ] **Step 3: Add the `CATEGORIES` table**

In `settings-modal.js`, after the `SETUP_STEPS` constant (around line 43), add (icon SVGs copied verbatim from the current section titles):

```js
const ICON = {
  gear:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  appearance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><path d="M17.5 10.5 21 3"/><path d="M3 21l5.5-5.5"/><circle cx="8" cy="16" r="3"/><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4z"/></svg>`,
  discord:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  publishing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  shared:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  data:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  close:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg>`,
};

const CATEGORIES = [
  { id: "appearance",     label: "Appearance",     desc: "Theme and build-page appearance.",                       icon: ICON.appearance },
  { id: "discord",        label: "Discord",        desc: "Post comps and builds to Discord channels via webhooks.", icon: ICON.discord },
  { id: "publishing",     label: "Publishing",     desc: "Publish your builds to a public web page.",              icon: ICON.publishing },
  { id: "shared-library", label: "Shared Library", desc: "Share a build library with your organization.",          icon: ICON.shared },
  { id: "data",           label: "Data & Cache",   desc: "Manage cached GW2 API data.",                            icon: ICON.data },
];
```

- [ ] **Step 4: Replace the `innerHTML` template**

Replace the entire `_overlay.innerHTML = \`...\`;` block (lines 55–139) with the structure below. Pane *contents* are the exact controls from the current sections (theme grid + toggle, webhook subsections, publishing picker, shared library, cache) — only their wrapping changes from `.settings-modal__section` + `<h4>` title to `.settings-modal__pane`. The section IDs `sm-appearance-section`, `sm-publishing-section`, `sm-shared-library-section` move onto their panes.

```js
  const navHtml = CATEGORIES.map((c, i) =>
    `<button type="button" class="settings-modal__nav-item${i === 0 ? " settings-modal__nav-item--active" : ""}" data-pane="${c.id}">${c.icon}<span>${c.label}</span></button>`
  ).join("");

  _overlay.innerHTML = `
    <div class="settings-modal">
      <aside class="settings-modal__sidebar">
        <div class="settings-modal__brand">${ICON.gear}<span>Settings</span></div>
        <nav class="settings-modal__nav" id="sm-nav">${navHtml}</nav>
      </aside>
      <div class="settings-modal__main">
        <div class="settings-modal__main-header">
          <h3 class="settings-modal__pane-title" id="sm-pane-title">${CATEGORIES[0].label}</h3>
          <p class="settings-modal__pane-desc" id="sm-pane-desc">${CATEGORIES[0].desc}</p>
          <button class="settings-modal__close" id="sm-close">${ICON.close}</button>
        </div>
        <div class="settings-modal__body">
          <section class="settings-modal__pane settings-modal__pane--active" data-pane="appearance" id="sm-appearance-section">
            <div class="settings-modal__theme-grid" id="sm-theme-grid"></div>
            <label class="settings-modal__toggle" id="sm-themed-builds-toggle">
              <input type="checkbox" class="settings-modal__toggle-input" id="sm-themed-builds">
              <span class="settings-modal__toggle-switch"></span>
              <span class="settings-modal__toggle-text">Themed build pages</span>
            </label>
          </section>
          <section class="settings-modal__pane" data-pane="discord">
            <div class="settings-modal__subsection">
              <label class="settings-modal__sublabel">Comp Webhooks</label>
              <div id="sm-comp-webhooks"></div>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-add-comp-webhook" type="button">+ Add Webhook</button>
            </div>
            <div class="settings-modal__subsection">
              <label class="settings-modal__sublabel">Build Webhooks</label>
              <div id="sm-build-webhooks"></div>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-add-build-webhook" type="button">+ Add Webhook</button>
            </div>
          </section>
          <section class="settings-modal__pane" data-pane="publishing" id="sm-publishing-section">
            <label class="settings-modal__label">Repository owner</label>
            <div id="sm-target-picker"></div>
            <div id="sm-setup-row" class="settings-modal__setup-row"></div>
          </section>
          <section class="settings-modal__pane" data-pane="shared-library" id="sm-shared-library-section">
            <span class="settings-modal__error" id="sm-shared-status"></span>
            <div id="sm-shared-setup">
              <label class="settings-modal__label" for="sm-org-select">Organization</label>
              <select class="settings-modal__select" id="sm-org-select">
                <option value="">Select an organization...</option>
              </select>
              <button class="settings-modal__btn settings-modal__btn--secondary" id="sm-shared-connect" type="button">Connect</button>
            </div>
            <div id="sm-shared-connected" class="settings-modal__shared-connected--hidden">
              <div class="settings-modal__shared-info">
                <span class="settings-modal__shared-org" id="sm-shared-org-name"></span>
                <span class="settings-modal__shared-repo"> / axibuilds-shared</span>
              </div>
              <button class="settings-modal__btn settings-modal__btn--danger" id="sm-shared-disconnect" type="button">Disconnect</button>
            </div>
          </section>
          <section class="settings-modal__pane" data-pane="data">
            <p class="settings-modal__hint">GW2 API responses are cached for 24 hours to speed up launch times.</p>
            <div class="settings-modal__cache-row">
              <button class="settings-modal__btn" id="sm-clear-cache" type="button">Clear API Cache</button>
              <span class="settings-modal__cache-status" id="sm-cache-status"></span>
            </div>
          </section>
        </div>
        <div class="settings-modal__actions">
          <span class="settings-modal__save-status" id="sm-save-status"></span>
          <div class="settings-modal__action-buttons">
            <button class="settings-modal__btn" id="sm-cancel" type="button">Close</button>
            <button class="settings-modal__btn settings-modal__btn--save" id="sm-done" type="button">Done</button>
          </div>
        </div>
      </div>
    </div>
  `;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/settingsModalNav.test.js --maxWorkers=2`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/settings-modal.js tests/unit/settingsModalNav.test.js
git commit -m "feat(settings): repackage sections into sidebar panes"
```

---

### Task 3: JS — pane switching behavior

**Files:**
- Modify: `src/renderer/modules/settings-modal.js` (the `initSettingsModal` wiring block, around `:168-181`)
- Test: `tests/unit/settingsModalNav.test.js` (extend)

**Interfaces:**
- Consumes: `CATEGORIES`, nav/pane DOM from Task 2.
- Produces: `_switchPane(id)` — sets `--active` on the matching nav item and pane (clearing others) and updates `#sm-pane-title` / `#sm-pane-desc` from `CATEGORIES`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/settingsModalNav.test.js` inside the existing `describe`:

```js
  test("clicking a nav item activates its pane and updates the header", () => {
    document.querySelector('.settings-modal__nav-item[data-pane="discord"]').click();

    const activeNav = document.querySelector(".settings-modal__nav-item--active");
    expect(activeNav.dataset.pane).toBe("discord");

    const activePanes = [...document.querySelectorAll(".settings-modal__pane--active")];
    expect(activePanes).toHaveLength(1);
    expect(activePanes[0].dataset.pane).toBe("discord");

    expect(document.getElementById("sm-pane-title").textContent).toBe("Discord");
    expect(document.getElementById("sm-pane-desc").textContent).toBe(
      "Post comps and builds to Discord channels via webhooks."
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/settingsModalNav.test.js -t "clicking a nav item" --maxWorkers=2`
Expected: FAIL (clicking does nothing — no handler wired yet).

- [ ] **Step 3: Add `_switchPane` and wire the nav**

Add the function (e.g. just after `initSettingsModal`):

```js
function _switchPane(id) {
  const cat = CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
  for (const item of _overlay.querySelectorAll(".settings-modal__nav-item")) {
    item.classList.toggle("settings-modal__nav-item--active", item.dataset.pane === cat.id);
  }
  for (const pane of _overlay.querySelectorAll(".settings-modal__pane")) {
    pane.classList.toggle("settings-modal__pane--active", pane.dataset.pane === cat.id);
  }
  const title = document.getElementById("sm-pane-title");
  const desc = document.getElementById("sm-pane-desc");
  if (title) title.textContent = cat.label;
  if (desc) desc.textContent = cat.desc;
}
```

Then inside `initSettingsModal`, alongside the other `addEventListener` calls, wire the nav (delegated):

```js
  _overlay.querySelector("#sm-nav").addEventListener("click", (e) => {
    const item = e.target.closest(".settings-modal__nav-item");
    if (item) _switchPane(item.dataset.pane);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/settingsModalNav.test.js --maxWorkers=2`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/settings-modal.js tests/unit/settingsModalNav.test.js
git commit -m "feat(settings): switch panes from sidebar nav"
```

---

### Task 4: JS — footer Close/Done buttons

**Files:**
- Modify: `src/renderer/modules/settings-modal.js` (the wiring block in `initSettingsModal`)
- Test: `tests/unit/settingsModalNav.test.js` (extend)

**Interfaces:**
- Consumes: `#sm-cancel`, `#sm-done` from Task 2; the existing `_close` function.
- Produces: both footer buttons dismiss the modal (settings already auto-save, so Done is a confirm-and-close).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/settingsModalNav.test.js` inside the existing `describe`:

```js
  test("Close and Done buttons both hide the overlay", () => {
    const overlay = document.querySelector(".settings-modal-overlay");
    overlay.classList.remove("settings-modal-overlay--hidden");
    document.getElementById("sm-cancel").click();
    expect(overlay.classList.contains("settings-modal-overlay--hidden")).toBe(true);

    overlay.classList.remove("settings-modal-overlay--hidden");
    document.getElementById("sm-done").click();
    expect(overlay.classList.contains("settings-modal-overlay--hidden")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/settingsModalNav.test.js -t "Close and Done" --maxWorkers=2`
Expected: FAIL (no click handlers on the new buttons; overlay stays visible).

- [ ] **Step 3: Wire the buttons**

In `initSettingsModal`, alongside `_el.close.addEventListener("click", _close);`, add:

```js
  document.getElementById("sm-cancel").addEventListener("click", _close);
  document.getElementById("sm-done").addEventListener("click", _close);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/settingsModalNav.test.js --maxWorkers=2`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/settings-modal.js tests/unit/settingsModalNav.test.js
git commit -m "feat(settings): add footer Close/Done buttons"
```

---

### Task 5: Full suite + manual in-app verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `npx jest --maxWorkers=2`
Expected: PASS, with no regressions in `settingsModalDropdown.test.js`, `settingsModalLayout.test.js`, `settingsModalNav.test.js`.

- [ ] **Step 2: Launch the app and open Settings**

Use the project's run/launch flow (see the `run` skill). Open Settings from the workspace dropdown menu.

- [ ] **Step 3: Walk the verification checklist**

Confirm each:
- Sidebar shows five categories with their icons; Appearance active by default.
- Clicking each nav item swaps the right pane and updates the header title + description; only one pane visible at a time.
- Appearance: theme grid renders with room; selecting a theme applies it; "Themed build pages" toggle persists.
- Discord: add / edit / delete a webhook in both Comp and Build lists; thread-mode pills (Channel / New Post / Thread ID) work; values persist after reopen.
- Publishing: repository-owner dropdown opens and is not clipped (issue #241 regression); setup row renders.
- Shared Library: connect/disconnect flow renders correctly (no flash of both states).
- Data & Cache: Clear API Cache works and shows status.
- Footer: save-status updates; Close, Done, header X, and Escape all dismiss the modal.

- [ ] **Step 4: Capture a screenshot for the record**

Use the in-app renderer/run screenshot to confirm the final look, then report results.

---

## Self-Review

**Spec coverage:** Layout (840×560, sidebar, per-pane header) → Tasks 1–2. Five categories with real icons + order/copy → Task 2 `CATEGORIES`. Pane switching + session memory of active pane (default appearance; in-memory) → Task 3. Close/Done footer → Task 4. Preserve all IDs / no data or IPC change → Global Constraints + Task 2 ID test. Manual verification incl. #241 dropdown regression → Task 5. All spec sections mapped.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output.

**Type/name consistency:** `CATEGORIES` (`{id,label,desc,icon}`), `_switchPane(id)`, `ICON.*`, and element IDs (`sm-nav`, `sm-pane-title`, `sm-pane-desc`, `sm-cancel`, `sm-done`) are used consistently across Tasks 2–4. Pane `data-pane` values match `CATEGORIES` ids (`shared-library`, `data`).

**Note on session memory:** The spec's "remember last-open category for the session" is satisfied implicitly — the modal is a singleton that is built once and never destroyed, so the last `_switchPane` selection persists across open/close until app restart. No extra code needed.
