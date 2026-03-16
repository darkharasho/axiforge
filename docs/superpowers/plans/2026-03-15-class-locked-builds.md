# Class-Locked Builds Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock saved builds to their profession — switching class on a saved build starts a fresh draft instead of mutating the existing build.

**Architecture:** A new generic confirm modal module (JS + CSS) following the existing detail-modal/wiki-modal singleton overlay pattern. The profession dropdown's onChange handler gains a branch for saved builds that either confirms discard (if dirty) or immediately starts a new draft. A new `computeUnsavedChangeSummary()` function in editor.js provides human-readable change descriptions for the modal body.

**Tech Stack:** Vanilla JS (ES modules), CSS custom properties, existing app design system.

**Spec:** `docs/superpowers/specs/2026-03-15-class-locked-builds-design.md`

---

## Chunk 1: Confirm Modal Module

### Task 1: Create confirm modal CSS

**Files:**
- Create: `src/renderer/styles/confirm-modal.css`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Create the CSS file**

Create `src/renderer/styles/confirm-modal.css`:

```css
/* Confirm Modal — Generic reusable confirmation dialog */

.confirm-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-modal-overlay--hidden {
  display: none;
}

.confirm-modal {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  width: 420px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.confirm-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.confirm-modal__title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.confirm-modal__close {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  font-family: inherit;
  font-size: 0.78rem;
  padding: 5px 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.confirm-modal__close:hover {
  background: rgba(197, 72, 95, 0.2);
  color: #e07080;
  border-color: var(--danger);
}

.confirm-modal__body {
  padding: 18px;
  overflow-y: auto;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.5;
}

.confirm-modal__body ul {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}

.confirm-modal__body li {
  padding: 4px 0;
  color: var(--text);
}

.confirm-modal__body li::before {
  content: "\2022";
  color: var(--danger);
  margin-right: 8px;
}

.confirm-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}

.confirm-modal__btn {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 7px 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.confirm-modal__btn:hover {
  background: var(--panel);
  color: var(--text);
  border-color: var(--accent-2);
}

.confirm-modal__btn--confirm {
  background: rgba(197, 72, 95, 0.15);
  color: #e07080;
  border-color: rgba(197, 72, 95, 0.4);
}

.confirm-modal__btn--confirm:hover {
  background: rgba(197, 72, 95, 0.3);
  color: #f0909e;
  border-color: var(--danger);
}
```

- [ ] **Step 2: Add the @import to styles.css**

In `src/renderer/styles.css`, add after the last existing `@import`:

```css
@import "./styles/confirm-modal.css";
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/confirm-modal.css src/renderer/styles.css
git commit -m "style: add confirm modal CSS"
```

---

### Task 2: Create confirm modal JS module

**Files:**
- Create: `src/renderer/modules/confirm-modal.js`

- [ ] **Step 1: Create the module**

Create `src/renderer/modules/confirm-modal.js`:

```js
// Confirm Modal — Generic reusable confirmation dialog.
// Singleton overlay, Promise-based API. Follows the detail-modal/wiki-modal pattern.

let _overlay = null;
let _el = {};
let _escHandler = null;
let _resolve = null;

export function initConfirmModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "confirm-modal-overlay confirm-modal-overlay--hidden";
  _overlay.innerHTML = `
    <div class="confirm-modal">
      <div class="confirm-modal__header">
        <h3 class="confirm-modal__title" id="cm-title"></h3>
        <button class="confirm-modal__close" id="cm-close">&#x2715;</button>
      </div>
      <div class="confirm-modal__body" id="cm-body"></div>
      <div class="confirm-modal__actions">
        <button class="confirm-modal__btn" id="cm-cancel"></button>
        <button class="confirm-modal__btn confirm-modal__btn--confirm" id="cm-confirm"></button>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  _el = {
    title:   document.getElementById("cm-title"),
    body:    document.getElementById("cm-body"),
    close:   document.getElementById("cm-close"),
    cancel:  document.getElementById("cm-cancel"),
    confirm: document.getElementById("cm-confirm"),
  };

  _el.close.addEventListener("click", () => _dismiss(false));
  _el.cancel.addEventListener("click", () => _dismiss(false));
  _el.confirm.addEventListener("click", () => _dismiss(true));
}

/**
 * Show a confirmation dialog and return a Promise<boolean>.
 * @param {Object} options
 * @param {string} options.title   - Modal heading text
 * @param {string} options.body    - HTML string for the body content
 * @param {string} [options.confirmLabel="Confirm"] - Confirm button text
 * @param {string} [options.cancelLabel="Cancel"]   - Cancel button text
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
export function showConfirmModal({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel" }) {
  if (!_overlay) return Promise.resolve(false);

  // If already open, dismiss the previous one as cancelled
  if (_resolve) _resolve(false);

  _el.title.textContent = title;
  _el.body.innerHTML = body;
  _el.confirm.textContent = confirmLabel;
  _el.cancel.textContent = cancelLabel;

  _overlay.classList.remove("confirm-modal-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(false); };
  document.addEventListener("keydown", _escHandler);

  return new Promise((resolve) => { _resolve = resolve; });
}

function _dismiss(result) {
  if (!_overlay) return;
  _overlay.classList.add("confirm-modal-overlay--hidden");
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
  if (_resolve) {
    const resolve = _resolve;
    _resolve = null;
    resolve(result);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/modules/confirm-modal.js
git commit -m "feat: add generic confirm modal module"
```

---

### Task 3: Wire confirm modal init into renderer.js

**Files:**
- Modify: `src/renderer/renderer.js:1-92`

- [ ] **Step 1: Add the import**

In `src/renderer/renderer.js`, add after the detail-modal import (line 41):

```js
import { initConfirmModal } from "./modules/confirm-modal.js";
```

- [ ] **Step 2: Add the init call**

In `src/renderer/renderer.js`, add after `initDetailModal();` (line 92):

```js
initConfirmModal();
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: wire confirm modal init into renderer startup"
```

---

## Chunk 2: Unsaved Changes Summary + Profession Switch Logic

### Task 4: Add `computeUnsavedChangeSummary()` to editor.js

**Files:**
- Modify: `src/renderer/modules/editor.js:347-418`

- [ ] **Step 1: Add the function**

In `src/renderer/modules/editor.js`, add after the `captureEditorBaseline()` function (after line 366):

```js
export function computeUnsavedChangeSummary() {
  if (!state.editorBaselineSignature) return [];
  let baseline;
  try { baseline = JSON.parse(state.editorBaselineSignature); }
  catch { return []; }
  let current;
  try { current = JSON.parse(computeEditorSignature()); }
  catch { return []; }

  const changes = [];
  if (baseline.title !== current.title) changes.push("Title changed");
  if (JSON.stringify(baseline.specializations) !== JSON.stringify(current.specializations)) changes.push("Specializations modified");
  if (JSON.stringify(baseline.skills) !== JSON.stringify(current.skills)
    || JSON.stringify(baseline.underwaterSkills) !== JSON.stringify(current.underwaterSkills)) changes.push("Skills modified");
  if (JSON.stringify(baseline.equipment) !== JSON.stringify(current.equipment)) changes.push("Equipment modified");
  if (baseline.notes !== current.notes) changes.push("Notes modified");
  if (JSON.stringify(baseline.tags) !== JSON.stringify(current.tags)) changes.push("Tags modified");
  if (baseline.gameMode !== current.gameMode) changes.push("Game mode changed");
  if (JSON.stringify(baseline.selectedUnderwaterLegends) !== JSON.stringify(current.selectedUnderwaterLegends)) changes.push("Legends modified");
  return changes;
}
```

- [ ] **Step 2: Add the export to renderer.js import**

In `src/renderer/renderer.js`, add `computeUnsavedChangeSummary` to the editor.js import block (line 27-31). Add it after `computeEditorSignature`:

```js
  computeEditorSignature,
  computeUnsavedChangeSummary,
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/editor.js src/renderer/renderer.js
git commit -m "feat: add computeUnsavedChangeSummary for dirty-state diffing"
```

---

### Task 5: Update `startNewBuild()` to accept profession and skipDirtyCheck

**Files:**
- Modify: `src/renderer/renderer.js:293-305`

- [ ] **Step 1: Update the function signature and body**

Change `startNewBuild()` in `src/renderer/renderer.js` (lines 293-305) from:

```js
async function startNewBuild() {
  if (!confirmDiscardDirty("Start a new build")) return;
  const profession = state.editor.profession || state.professions[0]?.id || "";
```

To:

```js
async function startNewBuild(profession, { skipDirtyCheck = false } = {}) {
  if (!skipDirtyCheck && !confirmDiscardDirty("Start a new build")) return;
  profession = profession || state.editor.profession || state.professions[0]?.id || "";
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/renderer.js
git commit -m "feat: allow startNewBuild to accept profession and skipDirtyCheck"
```

---

### Task 6: Update profession dropdown onChange handler

**Files:**
- Modify: `src/renderer/modules/render-pages.js:1-5, 489-498`

- [ ] **Step 1: Add imports to render-pages.js**

In `src/renderer/modules/render-pages.js`, add after the existing imports (after line 5):

```js
import { showConfirmModal } from "./confirm-modal.js";
import { computeUnsavedChangeSummary } from "./editor.js";
```

- [ ] **Step 2: Replace the onChange handler**

In `src/renderer/modules/render-pages.js`, replace the profession dropdown `onChange` (lines 489-497):

```js
    onChange: async (nextProfession) => {
      const professionId = String(nextProfession || "");
      if (!professionId || professionId === state.editor.profession) return;
      state.editor.profession = professionId;
      await _callbacks.setProfession(professionId, { preserveSelections: false });
      state.detail = null;
      _callbacks.markEditorChanged({ updateBuildList: true });
      renderEditor();
    },
```

With:

```js
    onChange: async (nextProfession) => {
      const professionId = String(nextProfession || "");
      if (!professionId || professionId === state.editor.profession) return;

      if (state.editor.id) {
        // Saved build — class switch starts a new draft
        if (state.editorDirty) {
          const changes = computeUnsavedChangeSummary();
          const body = changes.length
            ? `<ul>${changes.map((c) => `<li>${c}</li>`).join("")}</ul>`
            : "<p>You have unsaved changes that will be lost.</p>";
          const confirmed = await showConfirmModal({
            title: "Discard unsaved changes?",
            body,
            confirmLabel: "Discard & Switch",
            cancelLabel: "Cancel",
          });
          if (!confirmed) {
            renderEditorForm();
            return;
          }
        }
        await _callbacks.startNewBuild(professionId, { skipDirtyCheck: true });
      } else {
        // Unsaved draft — swap in-place (current behavior)
        state.editor.profession = professionId;
        await _callbacks.setProfession(professionId, { preserveSelections: false });
        state.detail = null;
        _callbacks.markEditorChanged({ updateBuildList: true });
        renderEditor();
      }
    },
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/render-pages.js
git commit -m "feat: lock saved builds to class, prompt on dirty switch"
```

---

## Chunk 3: Manual Smoke Test

### Task 7: Manual verification

- [ ] **Step 1: Start the app**

```bash
npm start
```

- [ ] **Step 2: Test — saved build, clean, switch class**

1. Create and save a build (e.g. Warrior).
2. Switch profession dropdown to Elementalist.
3. **Expected:** No modal. Editor resets to a fresh Elementalist draft (no id, empty title).

- [ ] **Step 3: Test — saved build, dirty, switch class**

1. Load a saved build.
2. Change the title or a specialization (make it dirty).
3. Switch profession dropdown to a different class.
4. **Expected:** Confirm modal appears with bullet list of what changed.
5. Click Cancel — nothing changes, dropdown reverts.
6. Repeat, click "Discard & Switch" — fresh draft with new class.

- [ ] **Step 4: Test — unsaved draft, switch class**

1. Click "New Build" to start a fresh draft.
2. Switch profession dropdown.
3. **Expected:** No modal. Profession swaps in-place as before.

- [ ] **Step 5: Test — Escape key on modal**

1. Trigger the dirty confirm modal.
2. Press Escape.
3. **Expected:** Modal closes, no changes applied.

- [ ] **Step 6: Commit all remaining changes (if any)**

Ensure everything is committed. Final commit message:

```bash
git add -A
git commit -m "test: verify class-locked builds behavior"
```
