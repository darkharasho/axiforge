# Class-Locked Builds Design

## Problem

Currently, switching professions on a saved build mutates it in-place — resetting specializations, skills, and equipment. This is confusing because the user may not intend to overwrite their saved build when exploring a different class.

## Goal

Once a build is saved, it is locked to its class. Switching to a new class starts a fresh draft instead of modifying the saved build.

## Behavior

### Profession switch on a saved build (has `state.editor.id`)

1. User selects a new profession from the toolbar dropdown.
2. **If dirty** (`state.editorDirty === true`):
   - Show an in-app styled confirm modal listing unsaved changes (category-level summary).
   - **Confirm** → start a fresh draft with the new profession (equivalent to `startNewBuild(newProfession)`).
   - **Cancel** → revert the dropdown to the current profession, no state change.
3. **If clean** (no unsaved changes):
   - Immediately start a fresh draft with the new profession.

### Profession switch on an unsaved draft (no `state.editor.id`)

No change to current behavior — profession swaps in-place, resets specs/skills/equipment.

### `startNewBuild()` change

Accept an optional `profession` argument. When provided, use it instead of defaulting to the current editor's profession.

```js
async function startNewBuild(profession) {
  profession = profession || state.editor.profession || state.professions[0]?.id || "";
  state.editor = createEmptyEditor(profession, _lastGameMode);
  // ... rest unchanged
}
```

## Confirm Modal Module

### Files

- `src/renderer/modules/confirm-modal.js`
- `src/renderer/styles/confirm-modal.css`

### API

```js
import { initConfirmModal, showConfirmModal } from "./modules/confirm-modal.js";

// Called once at app startup
initConfirmModal();

// Returns a Promise<boolean> — true on confirm, false on cancel
const confirmed = await showConfirmModal({
  title: "Discard unsaved changes?",
  body: "<ul><li>Title changed</li><li>Skills modified</li></ul>",
  confirmLabel: "Discard & Switch",
  cancelLabel: "Cancel",
});
```

### Behavior

- Singleton overlay appended to `document.body` on init.
- Hidden/shown via `--hidden` class toggle (same pattern as detail-modal, wiki-modal).
- Escape key dismisses (resolves `false`).
- Clicking the backdrop dismisses (resolves `false`).
- Only one confirm modal at a time — calling `showConfirmModal()` while one is open replaces it.

### Visual Design

- Semi-transparent dark backdrop (`rgba(0, 0, 0, 0.72)` matching existing modals).
- Compact centered card — not full-screen.
- Panel background (`var(--panel-2)`), border (`var(--line)`), border-radius (`var(--radius)`).
- Title at top, body content in the middle, two buttons at the bottom.
- Cancel button: muted/secondary style.
- Confirm button: destructive/warning color to signal data loss.

## Unsaved Changes Summary

### Function

New export in `editor.js`:

```js
export function computeUnsavedChangeSummary() → string[]
```

Parses `state.editorBaselineSignature` and the current `computeEditorSignature()` as JSON, compares field-by-field, and returns an array of human-readable strings:

- `"Title changed"` — if `title` differs
- `"Specializations modified"` — if `specializations` array differs
- `"Skills modified"` — if `skills` or `underwaterSkills` differ
- `"Equipment modified"` — if any equipment sub-field differs
- `"Notes modified"` — if `notes` differs
- `"Tags modified"` — if `tags` differs
- `"Game mode changed"` — if `gameMode` differs

Category-level only — no individual trait/skill names.

### Usage

Called in the profession-switch handler to build the confirm modal body:

```js
const changes = computeUnsavedChangeSummary();
const body = `<ul>${changes.map(c => `<li>${c}</li>`).join("")}</ul>`;
```

## Integration: Profession Dropdown onChange

In `render-pages.js` line ~489, the `onChange` handler changes from:

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

To:

```js
onChange: async (nextProfession) => {
  const professionId = String(nextProfession || "");
  if (!professionId || professionId === state.editor.profession) return;

  if (state.editor.id) {
    // Saved build — class switch starts a new draft
    if (state.editorDirty) {
      const changes = computeUnsavedChangeSummary();
      const body = `<ul>${changes.map(c => `<li>${c}</li>`).join("")}</ul>`;
      const confirmed = await showConfirmModal({
        title: "Discard unsaved changes?",
        body,
        confirmLabel: "Discard & Switch",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return; // revert dropdown handled by re-render
    }
    await _callbacks.startNewBuild(professionId);
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

## Replacing `confirmDiscardDirty`

The existing `confirmDiscardDirty()` in `editor.js` uses `window.confirm()`. This is a separate concern from the class-lock feature, but the new confirm modal can eventually replace it. For this change, only the profession-switch path uses the new modal. Other callers of `confirmDiscardDirty` (`startNewBuild`, `importBuildJsonFromClipboard`) remain unchanged for now.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/modules/confirm-modal.js` | **New** — generic confirm modal module |
| `src/renderer/styles/confirm-modal.css` | **New** — confirm modal styles |
| `src/renderer/modules/editor.js` | Add `computeUnsavedChangeSummary()` export |
| `src/renderer/modules/render-pages.js` | Update profession dropdown `onChange` handler |
| `src/renderer/renderer.js` | Update `startNewBuild()` to accept optional profession arg; import and call `initConfirmModal()` |
| `src/renderer/index.html` | Add `<link>` for confirm-modal.css |
