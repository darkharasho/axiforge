# Unique Build and Folder Names — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce globally unique build titles and folder names in the library — blocking user-initiated duplicates with an error toast, and auto-suffixing system-automated actions with ` (2)`, ` (3)`, etc.

**Architecture:** Add two pure utility functions (`isNameTaken`, `makeUniqueName`) to a new `name-utils.js` module, then wire them into the relevant handlers in `library.js`. No changes to stores or IPC.

**Tech Stack:** Vanilla JS (ES modules), Jest for unit tests. All renderer code is in `src/renderer/modules/library/`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/renderer/modules/library/name-utils.js` | **Create** | Pure functions: `isNameTaken`, `makeUniqueName` |
| `src/renderer/modules/library/library.js` | **Modify** | Wire uniqueness checks into handlers |
| `tests/unit/renderer/name-utils.test.js` | **Create** | Unit tests for both utilities |

---

## Task 1: Create `name-utils.js` with TDD

**Files:**
- Create: `src/renderer/modules/library/name-utils.js`
- Create: `tests/unit/renderer/name-utils.test.js`

---

- [ ] **Step 1.1: Write failing tests for `isNameTaken`**

Create `tests/unit/renderer/name-utils.test.js`:

```js
"use strict";

const { isNameTaken, makeUniqueName } = require("../../../src/renderer/modules/library/name-utils.js");

describe("isNameTaken", () => {
  const names = ["Warrior Build", "Ranger Build", "My Folder"];

  test("returns false when name is not in list", () => {
    expect(isNameTaken("Necromancer Build", names)).toBe(false);
  });

  test("returns true when name matches exactly", () => {
    expect(isNameTaken("Warrior Build", names)).toBe(true);
  });

  test("comparison is case-insensitive", () => {
    expect(isNameTaken("warrior build", names)).toBe(true);
    expect(isNameTaken("WARRIOR BUILD", names)).toBe(true);
  });

  test("trims whitespace before comparing", () => {
    expect(isNameTaken("  Warrior Build  ", names)).toBe(true);
  });

  test("returns false when name matches excludeName (same name rename)", () => {
    expect(isNameTaken("Warrior Build", names, "Warrior Build")).toBe(false);
  });

  test("excludeName comparison is also case-insensitive", () => {
    expect(isNameTaken("warrior build", names, "Warrior Build")).toBe(false);
  });

  test("returns true when name matches a different item (excludeName only removes own entry)", () => {
    expect(isNameTaken("Ranger Build", names, "Warrior Build")).toBe(true);
  });

  test("returns false for empty list", () => {
    expect(isNameTaken("Warrior Build", [])).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run to verify tests fail**

```bash
npx jest tests/unit/renderer/name-utils.test.js --no-coverage
```

Expected: FAIL — `Cannot find module`

---

- [ ] **Step 1.3: Write failing tests for `makeUniqueName`**

Append to `tests/unit/renderer/name-utils.test.js`:

```js
describe("makeUniqueName", () => {
  test("returns baseName when it is not taken", () => {
    expect(makeUniqueName("Warrior Build", ["Ranger Build"])).toBe("Warrior Build");
  });

  test("appends (2) when baseName is taken", () => {
    expect(makeUniqueName("Warrior Build", ["Warrior Build"])).toBe("Warrior Build (2)");
  });

  test("appends (3) when (2) is also taken", () => {
    const taken = ["Warrior Build", "Warrior Build (2)"];
    expect(makeUniqueName("Warrior Build", taken)).toBe("Warrior Build (3)");
  });

  test("skips gaps — finds first available number", () => {
    // (2) and (4) taken, should pick (3)
    const taken = ["Warrior Build", "Warrior Build (2)", "Warrior Build (4)"];
    expect(makeUniqueName("Warrior Build", taken)).toBe("Warrior Build (3)");
  });

  test("comparison is case-insensitive", () => {
    expect(makeUniqueName("warrior build", ["WARRIOR BUILD"])).toBe("warrior build (2)");
  });

  test("trims baseName", () => {
    expect(makeUniqueName("  My Build  ", [])).toBe("My Build");
  });

  test("preserves original casing of baseName", () => {
    expect(makeUniqueName("My Build", ["My Build"])).toBe("My Build (2)");
  });

  test("handles Copy suffix correctly — does not strip it", () => {
    const taken = ["Warrior (Copy)"];
    expect(makeUniqueName("Warrior (Copy)", taken)).toBe("Warrior (Copy) (2)");
  });

  test("returns baseName for empty taken list", () => {
    expect(makeUniqueName("Build", [])).toBe("Build");
  });
});
```

- [ ] **Step 1.4: Run to verify new tests also fail**

```bash
npx jest tests/unit/renderer/name-utils.test.js --no-coverage
```

Expected: FAIL — `Cannot find module`

---

- [ ] **Step 1.5: Implement `name-utils.js`**

Create `src/renderer/modules/library/name-utils.js`:

```js
/**
 * Checks whether a name is already taken in a list of existing names.
 *
 * @param {string} name - The name to test.
 * @param {string[]} takenNames - Existing names to check against.
 * @param {string|null} excludeName - If provided, this name is excluded from
 *   the check (used for renames so the item's current name doesn't block itself).
 * @returns {boolean}
 */
export function isNameTaken(name, takenNames, excludeName = null) {
  const normalized = name.trim().toLowerCase();
  const excluded = excludeName ? excludeName.trim().toLowerCase() : null;
  return takenNames.some((n) => {
    const candidate = n.trim().toLowerCase();
    if (excluded && candidate === excluded) return false;
    return candidate === normalized;
  });
}

/**
 * Returns a unique version of baseName by appending " (2)", " (3)", etc.
 * if the base name is already taken.
 *
 * @param {string} baseName - The desired name.
 * @param {string[]} takenNames - Existing names (case-insensitive comparison).
 * @returns {string} A unique name.
 */
export function makeUniqueName(baseName, takenNames) {
  const base = baseName.trim();
  if (!isNameTaken(base, takenNames)) return base;
  let counter = 2;
  while (isNameTaken(`${base} (${counter})`, takenNames)) {
    counter++;
  }
  return `${base} (${counter})`;
}
```

- [ ] **Step 1.6: Run tests — expect all to pass**

```bash
npx jest tests/unit/renderer/name-utils.test.js --no-coverage
```

Expected: All tests PASS

> **Note:** The test file uses `require()` (CommonJS) but the source uses `export` (ESM). Jest's babel transform handles this — no config change needed (same pattern used by other renderer tests in `tests/unit/renderer/`).

- [ ] **Step 1.7: Commit**

```bash
git add src/renderer/modules/library/name-utils.js tests/unit/renderer/name-utils.test.js
git commit -m "feat: add isNameTaken and makeUniqueName utilities"
```

---

## Task 2: Block duplicate folder names (user-initiated flows)

**Files:**
- Modify: `src/renderer/modules/library/library.js`

Import `isNameTaken` at the top of `library.js` (add to existing imports):

```js
import { isNameTaken, makeUniqueName } from "./name-utils.js";
```

---

- [ ] **Step 2.1: Update `handleRenameFolder` (line 407)**

Current code:
```js
async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const navItem = document.querySelector(`[data-navigate-folder="${folderId}"]`);
  const newName = await insertInlineInput(navItem, folder.name || "");
  if (!newName) { renderLibrary(); return; }
  await saveFolder({ ...folder, name: newName });
  renderLibrary();
}
```

Replace with:
```js
async function handleRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const navItem = document.querySelector(`[data-navigate-folder="${folderId}"]`);
  const newName = await insertInlineInput(navItem, folder.name || "", { fallbackName: folder.name });
  if (!newName) { renderLibrary(); return; }
  if (isNameTaken(newName, state.folders.map((f) => f.name), folder.name)) {
    showToast(`A folder named "${newName}" already exists.`, "error");
    renderLibrary();
    return;
  }
  await saveFolder({ ...folder, name: newName });
  renderLibrary();
}
```

- [ ] **Step 2.2: Update `handleNewFolder` (line 193)**

Current code:
```js
async function handleNewFolder() {
  const btn = document.getElementById("lib-new-folder-btn");
  const anchor = btn?.closest(".lib-sidebar__section-header");
  const name = await insertInlineInput(anchor, "");
  if (!name) { renderLibrary(); return; }
  await saveFolder({ name, parentId: null });
  renderLibrary();
}
```

Replace with:
```js
async function handleNewFolder() {
  const btn = document.getElementById("lib-new-folder-btn");
  const anchor = btn?.closest(".lib-sidebar__section-header");
  const name = await insertInlineInput(anchor, "");
  if (!name) { renderLibrary(); return; }
  if (isNameTaken(name, state.folders.map((f) => f.name))) {
    showToast(`A folder named "${name}" already exists.`, "error");
    renderLibrary();
    return;
  }
  await saveFolder({ name, parentId: null });
  renderLibrary();
}
```

- [ ] **Step 2.3: Update `handleNewFolderInContent` (line 203)**

Current code:
```js
async function handleNewFolderInContent() {
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  await saveFolder({ name, parentId });
  renderLibrary();
}
```

Replace with:
```js
async function handleNewFolderInContent() {
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  if (isNameTaken(name, state.folders.map((f) => f.name))) {
    showToast(`A folder named "${name}" already exists.`, "error");
    renderLibrary();
    return;
  }
  const parentId = state.currentFolder?.type === "custom" ? state.currentFolder.id : null;
  await saveFolder({ name, parentId });
  renderLibrary();
}
```

- [ ] **Step 2.4: Update `handleNewSubfolder` (line 418)**

Current code:
```js
async function handleNewSubfolder(parentId) {
  const folderEl = document.querySelector(`#lib-content [data-folder-id="${parentId}"]`);
  const name = await insertInlineInput(folderEl, "", {
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  await saveFolder({ name, parentId });
  renderLibrary();
}
```

Replace with:
```js
async function handleNewSubfolder(parentId) {
  const folderEl = document.querySelector(`#lib-content [data-folder-id="${parentId}"]`);
  const name = await insertInlineInput(folderEl, "", {
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  if (isNameTaken(name, state.folders.map((f) => f.name))) {
    showToast(`A folder named "${name}" already exists.`, "error");
    renderLibrary();
    return;
  }
  await saveFolder({ name, parentId });
  renderLibrary();
}
```

- [ ] **Step 2.5: Update `handleNewFolderAndMove` (line 455)**

Current code:
```js
async function handleNewFolderAndMove(buildIds) {
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  const folder = await saveFolder({ name, parentId: null });
  if (!folder?.id) return;
  await moveBuilds(buildIds, folder.id);
  renderLibrary();
}
```

Replace with:
```js
async function handleNewFolderAndMove(buildIds) {
  const content = document.getElementById("lib-content");
  if (!content) return;
  const name = await insertInlineInput(null, "", {
    container: content,
    className: "lib-content-inline-folder",
  });
  if (!name) { renderLibrary(); return; }
  if (isNameTaken(name, state.folders.map((f) => f.name))) {
    showToast(`A folder named "${name}" already exists.`, "error");
    renderLibrary();
    return;
  }
  const folder = await saveFolder({ name, parentId: null });
  if (!folder?.id) { renderLibrary(); return; }
  await moveBuilds(buildIds, folder.id);
  renderLibrary();
}
```

Note the `if (!folder?.id)` fix: added `renderLibrary()` to keep UI consistent.

- [ ] **Step 2.6: Run the full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: All existing tests pass, new `name-utils` tests pass.

- [ ] **Step 2.7: Manual smoke test — folder duplicate blocking**

1. Open the app and create a folder named "Test Folder"
2. Try to create another folder named "Test Folder" (any creation method)
3. Expected: error toast "A folder named "Test Folder" already exists." — no folder created
4. Try creating "test folder" (lowercase) — expected: same error (case-insensitive)
5. Rename "Test Folder" to "Test Folder" (same name) — expected: save succeeds silently
6. Rename "Test Folder" to "Test FOLDER" (case change) — expected: save succeeds

- [ ] **Step 2.8: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat: block duplicate folder names with error toast"
```

---

## Task 3: Block duplicate build names (rename flow)

**Files:**
- Modify: `src/renderer/modules/library/library.js`

- [ ] **Step 3.1: Update `handleRename` (line 225)**

Current code:
```js
async function handleRename(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const newTitle = await showPrompt("Rename build", build.title || "");
  if (!newTitle) return;
  await window.desktopApi.saveBuild({ ...build, title: newTitle });
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}
```

Replace with:
```js
async function handleRename(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const newTitle = await showPrompt("Rename build", build.title || "");
  if (!newTitle) return;
  if (isNameTaken(newTitle, state.builds.map((b) => b.title), build.title)) {
    showToast(`A build named "${newTitle}" already exists.`, "error");
    return;
  }
  await window.desktopApi.saveBuild({ ...build, title: newTitle });
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}
```

- [ ] **Step 3.2: Run tests**

```bash
npx jest --no-coverage
```

Expected: All pass.

- [ ] **Step 3.3: Manual smoke test — build rename duplicate blocking**

1. Create two builds: "Build A" and "Build B"
2. Rename "Build A" to "Build B" — expected: error toast "A build named "Build B" already exists."
3. Rename "Build A" to "build b" (lowercase) — expected: same error
4. Rename "Build A" to "Build A" (same name) — expected: save succeeds
5. Rename "Build A" to "BUILD A" (case change) — expected: save succeeds

- [ ] **Step 3.4: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat: block duplicate build names on rename"
```

---

## Task 4: Auto-suffix system-automated flows

**Files:**
- Modify: `src/renderer/modules/library/library.js`

- [ ] **Step 4.1: Update `handleDuplicate` (line 235)**

Current code:
```js
async function handleDuplicate(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const copy = { ...build };
  delete copy.id;
  copy.title = `${build.title || "Untitled"} (Copy)`;
  await window.desktopApi.saveBuild(copy);
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}
```

Replace with:
```js
async function handleDuplicate(buildId) {
  const build = state.builds.find((b) => b.id === buildId);
  if (!build) return;
  const copy = { ...build };
  delete copy.id;
  const baseName = `${build.title || "Untitled"} (Copy)`;
  copy.title = makeUniqueName(baseName, state.builds.map((b) => b.title));
  await window.desktopApi.saveBuild(copy);
  state.builds = await window.desktopApi.listBuilds();
  renderLibrary();
}
```

- [ ] **Step 4.2: Update `handleImportChatLink` (line 320)**

Current code:
```js
async function handleImportChatLink() {
  const folderId = state.currentFolder || null;
  const result = await showImportModal();
  if (!result) return;
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const saved = await window.desktopApi.importChatLink(result.link, result.name, folderId, gameMode);
    ...
```

Change the line that calls `importChatLink`:
```js
async function handleImportChatLink() {
  const folderId = state.currentFolder || null;
  const result = await showImportModal();
  if (!result) return;
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const safeName = makeUniqueName(result.name, state.builds.map((b) => b.title));
    const saved = await window.desktopApi.importChatLink(result.link, safeName, folderId, gameMode);
    ...
```

(Keep the rest of the function unchanged.)

- [ ] **Step 4.3: Update `handleImportGw2Skills` (line 337)**

Same pattern — add `safeName` before the IPC call:

```js
async function handleImportGw2Skills() {
  const folderId = state.currentFolder || null;
  const result = await showGw2SkillsImportModal();
  if (!result) return;
  showToast("Importing from GW2Skills…", "loading");
  try {
    const gameMode = state.editor?.gameMode || "pve";
    const safeName = makeUniqueName(result.name, state.builds.map((b) => b.title));
    const saved = await window.desktopApi.importGw2Skills(result.url, safeName, folderId, gameMode);
    ...
```

(Keep the rest of the function unchanged.)

- [ ] **Step 4.4: Run tests**

```bash
npx jest --no-coverage
```

Expected: All pass.

- [ ] **Step 4.5: Manual smoke test — auto-suffix flows**

**Duplicate:**
1. Create a build "Warrior Build"
2. Duplicate it — expected: new build named "Warrior Build (Copy)"
3. Duplicate it again — expected: new build named "Warrior Build (Copy) (2)"
4. Duplicate the original once more — expected: "Warrior Build (Copy) (3)"

**Import chat link:**
1. Import a build; name it "My Import" in the modal
2. Import again with the same name — expected: saves as "My Import (2)" with toast `"My Import (2)" imported`

**Import GW2Skills:**
1. Same test — import with the same name twice, expect ` (2)` suffix on second

- [ ] **Step 4.6: Commit**

```bash
git add src/renderer/modules/library/library.js
git commit -m "feat: auto-suffix duplicate names for duplicate and import flows"
```

---

## Final Verification

- [ ] **Run full test suite one last time**

```bash
npx jest --no-coverage
```

Expected: All tests pass with no regressions.
