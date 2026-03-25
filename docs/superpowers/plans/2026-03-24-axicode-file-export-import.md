# .axicode File Export/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable bulk export/import of builds, folders, and compositions as `.axicode` files (gzipped JSON).

**Architecture:** The file codec lives in the `@mks.haro/axicode` package. Electron main process handles file I/O via IPC. Renderer orchestrates export collection, import conflict resolution, and UI integration.

**Tech Stack:** Node.js `zlib` (built-in), Electron `dialog` (built-in), vanilla JS modules, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-03-24-axicode-file-export-import-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `axicode/src/fileCodec.js` | Encode/decode `.axicode` file buffers (gzip JSON) |
| Create | `axicode/tests/fileCodec.test.js` | Unit tests for file codec |
| Modify | `axicode/src/index.js:609-615` | Re-export fileCodec functions |
| Modify | `axicode/package.json:3` | Version bump to 1.3.0 |
| Create | `axiforge/src/main/axicodeFile.js` | IPC handlers for export/import file I/O |
| Modify | `axiforge/src/main/index.js:3,484+` | Import dialog, register IPC handlers |
| Modify | `axiforge/src/preload/index.js:63+` | Expose `exportAxicodeFile` / `importAxicodeFile` on desktopApi |
| Create | `axiforge/src/renderer/modules/import-conflict-modal.js` | Conflict resolution dialog (Promise-based singleton) |
| Create | `axiforge/src/renderer/styles/import-conflict-modal.css` | Conflict dialog styles |
| Create | `axiforge/src/renderer/modules/library/axicode-io.js` | Export collection logic + import orchestration |
| Modify | `axiforge/src/renderer/modules/library/context-menu.js:127,148,166,180,195,215` | Add export/import menu items |
| Modify | `axiforge/src/renderer/modules/library/toolbar.js:76-91` | Add Export dropdown + .axicode import item |
| Modify | `axiforge/src/renderer/modules/library/library.js:1-29,1106-1211` | Wire callbacks, import new modules |
| Modify | `axiforge/src/renderer/styles.css:16+` | Import conflict modal CSS |
| Modify | `axiforge/src/renderer/renderer.js` | Init conflict modal |

---

## Task 1: File Codec — `@mks.haro/axicode`

**Files:**
- Create: `axicode/src/fileCodec.js`
- Create: `axicode/tests/fileCodec.test.js`
- Modify: `axicode/src/index.js:609-615`
- Modify: `axicode/package.json:3`

- [ ] **Step 1: Write failing tests for `encodeAxicodeFile`**

Create `axicode/tests/fileCodec.test.js`:

```javascript
const { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile } = require("../src/index");
const zlib = require("zlib");

describe("encodeAxicodeFile", () => {
  test("returns a Buffer", () => {
    const result = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("output is valid gzip", () => {
    const result = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    const json = JSON.parse(zlib.gunzipSync(result).toString("utf-8"));
    expect(json.version).toBe(1);
    expect(json.builds).toEqual([]);
    expect(json.folders).toEqual([]);
    expect(json.comps).toEqual([]);
    expect(typeof json.exportedAt).toBe("string");
  });

  test("includes provided builds, folders, comps", () => {
    const builds = [{ id: "b1", title: "Test Build" }];
    const folders = [{ id: "f1", name: "My Folder" }];
    const comps = [{ id: "c1", name: "My Comp" }];
    const result = encodeAxicodeFile({ builds, folders, comps });
    const json = JSON.parse(zlib.gunzipSync(result).toString("utf-8"));
    expect(json.builds).toEqual(builds);
    expect(json.folders).toEqual(folders);
    expect(json.comps).toEqual(comps);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/fileCodec.test.js --no-coverage`
Expected: FAIL — `encodeAxicodeFile` is not a function

- [ ] **Step 3: Implement `encodeAxicodeFile`**

Create `axicode/src/fileCodec.js`:

```javascript
"use strict";

const zlib = require("zlib");

const CURRENT_VERSION = 1;

function encodeAxicodeFile({ builds = [], folders = [], comps = [] }) {
  const payload = {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    builds,
    folders,
    comps,
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
}

module.exports = { encodeAxicodeFile };
```

- [ ] **Step 4: Wire exports in `index.js`**

In `axicode/src/index.js`, after the comp codec exports (line 615), add:

```javascript
// File codec — bulk .axicode file encode/decode
const { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile } = require("./fileCodec");
module.exports.encodeAxicodeFile = encodeAxicodeFile;
module.exports.decodeAxicodeFile = decodeAxicodeFile;
module.exports.isValidAxicodeFile = isValidAxicodeFile;
```

Note: `decodeAxicodeFile` and `isValidAxicodeFile` don't exist yet — this is fine, they'll be `undefined` until step 7. The tests for encode will pass.

- [ ] **Step 5: Run encode tests to verify they pass**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/fileCodec.test.js --no-coverage`
Expected: 3 tests PASS

- [ ] **Step 6: Write failing tests for `decodeAxicodeFile` and `isValidAxicodeFile`**

Append to `axicode/tests/fileCodec.test.js`:

```javascript
describe("decodeAxicodeFile", () => {
  test("round-trips encode → decode", () => {
    const input = {
      builds: [{ id: "b1", title: "Test" }],
      folders: [{ id: "f1", name: "Folder" }],
      comps: [{ id: "c1", name: "Comp" }],
    };
    const encoded = encodeAxicodeFile(input);
    const decoded = decodeAxicodeFile(encoded);
    expect(decoded.version).toBe(1);
    expect(decoded.builds).toEqual(input.builds);
    expect(decoded.folders).toEqual(input.folders);
    expect(decoded.comps).toEqual(input.comps);
    expect(typeof decoded.exportedAt).toBe("string");
  });

  test("throws on non-gzip data", () => {
    expect(() => decodeAxicodeFile(Buffer.from("not gzip"))).toThrow();
  });

  test("throws on invalid JSON inside gzip", () => {
    const badGzip = zlib.gzipSync(Buffer.from("not json", "utf-8"));
    expect(() => decodeAxicodeFile(badGzip)).toThrow();
  });

  test("throws on unknown version", () => {
    const payload = JSON.stringify({ version: 999, builds: [], folders: [], comps: [] });
    const gzipped = zlib.gzipSync(Buffer.from(payload, "utf-8"));
    expect(() => decodeAxicodeFile(gzipped)).toThrow(/newer version/i);
  });

  test("throws on missing version field", () => {
    const payload = JSON.stringify({ builds: [] });
    const gzipped = zlib.gzipSync(Buffer.from(payload, "utf-8"));
    expect(() => decodeAxicodeFile(gzipped)).toThrow();
  });
});

describe("isValidAxicodeFile", () => {
  test("returns true for valid encoded file", () => {
    const encoded = encodeAxicodeFile({ builds: [], folders: [], comps: [] });
    expect(isValidAxicodeFile(encoded)).toBe(true);
  });

  test("returns false for non-buffer", () => {
    expect(isValidAxicodeFile("string")).toBe(false);
  });

  test("returns false for non-gzip buffer", () => {
    expect(isValidAxicodeFile(Buffer.from("hello"))).toBe(false);
  });

  test("returns false for gzip with bad JSON", () => {
    expect(isValidAxicodeFile(zlib.gzipSync(Buffer.from("nope")))).toBe(false);
  });

  test("returns false for gzip with wrong version", () => {
    const bad = zlib.gzipSync(Buffer.from(JSON.stringify({ version: 99 })));
    expect(isValidAxicodeFile(bad)).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify new tests fail**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/fileCodec.test.js --no-coverage`
Expected: decode/validate tests FAIL

- [ ] **Step 8: Implement `decodeAxicodeFile` and `isValidAxicodeFile`**

Update `axicode/src/fileCodec.js` to add both functions:

```javascript
"use strict";

const zlib = require("zlib");

const CURRENT_VERSION = 1;

function encodeAxicodeFile({ builds = [], folders = [], comps = [] }) {
  const payload = {
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    builds,
    folders,
    comps,
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
}

function decodeAxicodeFile(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Expected a Buffer");
  }

  let decompressed;
  try {
    decompressed = zlib.gunzipSync(buffer);
  } catch {
    throw new Error("Not a valid .axicode file: decompression failed");
  }

  let data;
  try {
    data = JSON.parse(decompressed.toString("utf-8"));
  } catch {
    throw new Error("Not a valid .axicode file: invalid JSON");
  }

  if (typeof data.version !== "number") {
    throw new Error("Not a valid .axicode file: missing version");
  }
  if (data.version > CURRENT_VERSION) {
    throw new Error(
      "This .axicode file was created with a newer version of AxiForge. Please update to import it.",
    );
  }

  return {
    version: data.version,
    exportedAt: data.exportedAt || null,
    builds: Array.isArray(data.builds) ? data.builds : [],
    folders: Array.isArray(data.folders) ? data.folders : [],
    comps: Array.isArray(data.comps) ? data.comps : [],
  };
}

function isValidAxicodeFile(buffer) {
  try {
    decodeAxicodeFile(buffer);
    return true;
  } catch {
    return false;
  }
}

module.exports = { encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile };
```

- [ ] **Step 9: Run all file codec tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest tests/fileCodec.test.js --no-coverage`
Expected: All tests PASS

- [ ] **Step 10: Version bump**

In `axicode/package.json`, change line 3:

```json
"version": "1.3.0",
```

- [ ] **Step 11: Run full axicode test suite**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest --no-coverage`
Expected: All tests PASS (existing tests unaffected)

- [ ] **Step 12: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axicode
git add src/fileCodec.js src/index.js tests/fileCodec.test.js package.json
git commit -m "feat: add .axicode file codec (encodeAxicodeFile, decodeAxicodeFile, isValidAxicodeFile)"
```

---

## Task 2: Electron IPC — Main Process + Preload

**Files:**
- Create: `axiforge/src/main/axicodeFile.js`
- Modify: `axiforge/src/main/index.js:484+`
- Modify: `axiforge/src/preload/index.js:63+`

- [ ] **Step 1: Create `axicodeFile.js` IPC handler module**

Create `axiforge/src/main/axicodeFile.js`:

```javascript
const { ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { encodeAxicodeFile, decodeAxicodeFile } = require("@mks.haro/axicode");

function registerAxicodeFileHandlers(mainWindow) {
  ipcMain.handle("axicode-file:export", async (_e, { builds, folders, comps }) => {
    const defaultName = `axiforge-export-${new Date().toISOString().slice(0, 10)}.axicode`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export .axicode File",
      defaultPath: defaultName,
      filters: [{ name: "AxiCode Files", extensions: ["axicode"] }],
    });
    if (canceled || !filePath) return { cancelled: true };

    const buffer = encodeAxicodeFile({ builds, folders, comps });
    await fs.writeFile(filePath, buffer);
    return { success: true, filePath };
  });

  ipcMain.handle("axicode-file:import", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Import .axicode File",
      filters: [{ name: "AxiCode Files", extensions: ["axicode"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { cancelled: true };

    const buffer = await fs.readFile(filePaths[0]);
    try {
      const data = decodeAxicodeFile(buffer);
      return { success: true, data };
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { registerAxicodeFileHandlers };
```

- [ ] **Step 2: Register handlers in main `index.js`**

In `axiforge/src/main/index.js`, add a require near the top (after line 26):

```javascript
const { registerAxicodeFileHandlers } = require("./axicodeFile");
```

Then find where IPC handlers are registered (after all the `ipcMain.handle` calls, around line 484 after the comp share code handlers) and add:

```javascript
  // .axicode file export/import
  registerAxicodeFileHandlers(mainWindow);
```

Note: The main window variable is `win` in `index.js` (line 199: `const win = createWindow()`). Pass `win` to the handler:

```javascript
  registerAxicodeFileHandlers(win);
```

- [ ] **Step 3: Expose in preload bridge**

In `axiforge/src/preload/index.js`, after line 63 (after `importCompShareCode`), add:

```javascript
  // .axicode file export/import
  exportAxicodeFile: (builds, folders, comps) =>
    ipcRenderer.invoke("axicode-file:export", { builds, folders, comps }),
  importAxicodeFile: () => ipcRenderer.invoke("axicode-file:import"),
```

- [ ] **Step 4: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/main/axicodeFile.js src/main/index.js src/preload/index.js
git commit -m "feat: add .axicode file IPC handlers and preload bridge"
```

---

## Task 3: Import Conflict Modal

**Files:**
- Create: `axiforge/src/renderer/modules/import-conflict-modal.js`
- Create: `axiforge/src/renderer/styles/import-conflict-modal.css`
- Modify: `axiforge/src/renderer/styles.css:16+`
- Modify: `axiforge/src/renderer/renderer.js`

- [ ] **Step 1: Create conflict modal module**

Create `axiforge/src/renderer/modules/import-conflict-modal.js`:

```javascript
// Import Conflict Modal — per-item conflict resolution dialog for .axicode imports.
// Singleton overlay, Promise-based API. Follows confirm-modal.js pattern.

let _overlay = null;
let _escHandler = null;
let _resolve = null;

export function initImportConflictModal() {
  if (typeof document === "undefined") return;
  if (_overlay) return;

  _overlay = document.createElement("div");
  _overlay.className = "icm-overlay icm-overlay--hidden";
  _overlay.innerHTML = `
    <div class="icm">
      <div class="icm__header">
        <h3 class="icm__title" id="icm-title">Import Conflicts</h3>
        <button class="icm__close" id="icm-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6L18 18"/></svg></button>
      </div>
      <div class="icm__subtitle" id="icm-subtitle"></div>
      <div class="icm__list" id="icm-list"></div>
      <div class="icm__footer">
        <div class="icm__bulk">
          <button class="icm__bulk-btn" id="icm-replace-all">Replace All</button>
          <button class="icm__bulk-btn" id="icm-copy-all">Copy All</button>
          <button class="icm__bulk-btn" id="icm-skip-all">Skip All</button>
        </div>
        <div class="icm__actions">
          <button class="icm__btn" id="icm-cancel">Cancel</button>
          <button class="icm__btn icm__btn--primary" id="icm-import">Import</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(_overlay);

  document.getElementById("icm-close").addEventListener("click", () => _dismiss(null));
  document.getElementById("icm-cancel").addEventListener("click", () => _dismiss(null));
  document.getElementById("icm-import").addEventListener("click", _handleImport);

  document.getElementById("icm-replace-all").addEventListener("click", () => _setAllDropdowns("replace"));
  document.getElementById("icm-copy-all").addEventListener("click", () => _setAllDropdowns("copy"));
  document.getElementById("icm-skip-all").addEventListener("click", () => _setAllDropdowns("skip"));
}

/**
 * Show the import conflict resolution dialog.
 * @param {{ conflicts: Array<{ type: string, imported: Object, existing: Object }>, totalCount: number }} opts
 * @returns {Promise<Map<string, string>|null>} Map<id, 'replace'|'copy'|'skip'> or null if cancelled
 */
export function showImportConflictModal({ conflicts, totalCount }) {
  if (!_overlay) return Promise.resolve(null);
  if (_resolve) _resolve(null);

  const subtitle = document.getElementById("icm-subtitle");
  subtitle.textContent = `${conflicts.length} of ${totalCount} items already exist in your library.`;

  const list = document.getElementById("icm-list");
  list.innerHTML = conflicts
    .map((c) => {
      const id = c.imported.id;
      const name = c.imported.title || c.imported.name || "Untitled";
      const typeLabel = c.type === "build" ? "Build" : c.type === "comp" ? "Comp" : "Folder";
      return `
        <div class="icm__row" data-conflict-id="${id}">
          <div class="icm__row-info">
            <span class="icm__row-type icm__row-type--${c.type}">${typeLabel}</span>
            <span class="icm__row-name">${_escapeHtml(name)}</span>
          </div>
          <select class="icm__row-select" data-conflict-id="${id}">
            <option value="copy" selected>Import as Copy</option>
            <option value="replace">Replace</option>
            <option value="skip">Skip</option>
          </select>
        </div>
      `;
    })
    .join("");

  _overlay.classList.remove("icm-overlay--hidden");
  _escHandler = (e) => { if (e.key === "Escape") _dismiss(null); };
  document.addEventListener("keydown", _escHandler);

  return new Promise((resolve) => { _resolve = resolve; });
}

function _handleImport() {
  const selects = _overlay.querySelectorAll(".icm__row-select");
  const result = new Map();
  for (const sel of selects) {
    result.set(sel.dataset.conflictId, sel.value);
  }
  _dismiss(result);
}

function _setAllDropdowns(value) {
  const selects = _overlay.querySelectorAll(".icm__row-select");
  for (const sel of selects) sel.value = value;
}

function _dismiss(result) {
  if (!_overlay) return;
  _overlay.classList.add("icm-overlay--hidden");
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

function _escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Create conflict modal CSS**

Create `axiforge/src/renderer/styles/import-conflict-modal.css`:

```css
/* Import Conflict Modal */
.icm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}

.icm-overlay--hidden {
  display: none;
}

.icm {
  background: var(--surface-secondary, #1e1e2e);
  border: 1px solid var(--border-primary, #333);
  border-radius: 12px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.icm__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-primary, #333);
}

.icm__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.icm__close {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.icm__close:hover {
  color: var(--text-primary, #fff);
  background: var(--surface-tertiary, #2a2a3e);
}

.icm__subtitle {
  padding: 12px 18px;
  font-size: 13px;
  color: var(--text-secondary, #94a3b8);
  border-bottom: 1px solid var(--border-primary, #333);
}

.icm__list {
  overflow-y: auto;
  max-height: 300px;
  flex: 1;
}

.icm__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid var(--border-subtle, #2a2a3e);
}

.icm__row:last-child {
  border-bottom: none;
}

.icm__row-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.icm__row-type {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.icm__row-type--build {
  background: var(--accent-blue, #2563eb);
  color: #fff;
}

.icm__row-type--comp {
  background: var(--accent-purple, #7c3aed);
  color: #fff;
}

.icm__row-type--folder {
  background: var(--accent-amber, #d97706);
  color: #fff;
}

.icm__row-name {
  font-size: 13px;
  color: var(--text-primary, #fff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icm__row-select {
  background: var(--surface-tertiary, #2a2a3e);
  color: var(--text-primary, #ccc);
  border: 1px solid var(--border-primary, #444);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
  flex-shrink: 0;
  cursor: pointer;
}

.icm__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid var(--border-primary, #333);
}

.icm__bulk {
  display: flex;
  gap: 12px;
}

.icm__bulk-btn {
  background: none;
  border: none;
  color: var(--accent-blue, #60a5fa);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.icm__bulk-btn:hover {
  text-decoration: underline;
}

.icm__actions {
  display: flex;
  gap: 8px;
}

.icm__btn {
  background: var(--surface-tertiary, #333);
  color: var(--text-primary, #ccc);
  border: 1px solid var(--border-primary, #555);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.icm__btn:hover {
  background: var(--surface-hover, #3a3a4e);
}

.icm__btn--primary {
  background: var(--accent-blue, #2563eb);
  color: #fff;
  border-color: var(--accent-blue, #2563eb);
}

.icm__btn--primary:hover {
  background: var(--accent-blue-hover, #1d4ed8);
}
```

- [ ] **Step 3: Import CSS in styles.css**

In `axiforge/src/renderer/styles.css`, after line 16 (`@import "./styles/confirm-modal.css";`), add:

```css
@import "./styles/import-conflict-modal.css";
```

- [ ] **Step 4: Init modal in renderer.js**

In `axiforge/src/renderer/renderer.js`, add the import at the top (with the other modal imports):

```javascript
import { initImportConflictModal } from "./modules/import-conflict-modal.js";
```

Then in the initialization section (after `initConfirmModal();`), add:

```javascript
initImportConflictModal();
```

- [ ] **Step 5: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/renderer/modules/import-conflict-modal.js src/renderer/styles/import-conflict-modal.css src/renderer/styles.css src/renderer/renderer.js
git commit -m "feat: add import conflict resolution modal"
```

---

## Task 4: Export/Import Orchestration — `axicode-io.js`

**Files:**
- Create: `axiforge/src/renderer/modules/library/axicode-io.js`

- [ ] **Step 1: Create the axicode-io module**

Create `axiforge/src/renderer/modules/library/axicode-io.js`:

```javascript
// .axicode file export/import orchestration.
// Handles export collection (selection/visible gathering, dependency resolution)
// and import flow (conflict detection, dialog, applying resolutions).

import { state } from "../state.js";
import { getVisibleBuilds, getVisibleFolders, getVisibleComps } from "./folder-store.js";
import { getSelection, getCompSelection } from "./selection.js";
import { showImportConflictModal } from "../import-conflict-modal.js";
import { nextCopyTitle } from "./library.js";
import { pushUndo } from "./undo.js";

// ─── Export ──────────────────────────────────────────────────────────────────────

/**
 * Collect items for export based on current selection or visible items.
 * @param {"selection"|"visible"} mode
 * @returns {{ builds: Object[], folders: Object[], comps: Object[] }}
 */
export function collectExportData(mode) {
  if (mode === "selection") {
    return _collectFromSelection();
  }
  return _collectFromVisible();
}

function _collectFromVisible() {
  const builds = getVisibleBuilds();
  const folders = getVisibleFolders();
  const comps = getVisibleComps();

  // For visible comps, also pull in their referenced builds
  const buildIds = new Set(builds.map((b) => b.id));
  for (const comp of comps) {
    for (const id of (comp.buildIds || [])) {
      if (!buildIds.has(id)) {
        const b = state.builds.find((x) => x.id === id);
        if (b) {
          builds.push(b);
          buildIds.add(id);
        }
      }
    }
  }

  // For visible folders, also pull in their nested contents
  const folderIds = new Set(folders.map((f) => f.id));
  for (const folder of folders) {
    _collectFolderContents(folder.id, builds, folders, comps, buildIds, folderIds);
  }

  return { builds, folders, comps };
}

function _collectFromSelection() {
  const selectedBuildIds = getSelection();
  const selectedCompIds = getCompSelection();

  const builds = [];
  const folders = [];
  const comps = [];
  const buildIds = new Set();
  const folderIds = new Set();
  const compIds = new Set();

  // Add selected builds
  for (const id of selectedBuildIds) {
    const b = state.builds.find((x) => x.id === id);
    if (b && !buildIds.has(id)) {
      builds.push(b);
      buildIds.add(id);
    }
  }

  // Add selected comps + their builds
  for (const id of selectedCompIds) {
    const c = (state.comps || []).find((x) => x.id === id);
    if (c && !compIds.has(id)) {
      comps.push(c);
      compIds.add(id);
      for (const buildId of (c.buildIds || [])) {
        if (!buildIds.has(buildId)) {
          const b = state.builds.find((x) => x.id === buildId);
          if (b) {
            builds.push(b);
            buildIds.add(buildId);
          }
        }
      }
    }
  }

  // Check if any selected builds are actually inside a folder — if so,
  // we need to check if the folder itself was selected via the build selection
  // (folders don't have their own selection array, but if the user right-clicks
  // a folder row, the context menu passes the folder ID to the export handler)

  return { builds, folders, comps };
}

/**
 * Export a specific folder and all its contents.
 * Called when right-clicking a folder → Export.
 * @param {string} folderId
 */
export function collectFolderExportData(folderId) {
  const builds = [];
  const folders = [];
  const comps = [];
  const buildIds = new Set();
  const folderIds = new Set();

  const folder = state.folders.find((f) => f.id === folderId);
  if (folder) {
    folders.push(folder);
    folderIds.add(folder.id);
    _collectFolderContents(folderId, builds, folders, comps, buildIds, folderIds);
  }

  // Also pull in builds referenced by comps
  const compIds = new Set(comps.map((c) => c.id));
  for (const comp of comps) {
    for (const id of (comp.buildIds || [])) {
      if (!buildIds.has(id)) {
        const b = state.builds.find((x) => x.id === id);
        if (b) {
          builds.push(b);
          buildIds.add(id);
        }
      }
    }
  }

  return { builds, folders, comps };
}

function _collectFolderContents(folderId, builds, folders, comps, buildIds, folderIds) {
  // Add builds in this folder
  for (const b of state.builds) {
    if (b.folderId === folderId && !buildIds.has(b.id)) {
      builds.push(b);
      buildIds.add(b.id);
    }
  }

  // Add comps in this folder
  for (const c of (state.comps || [])) {
    if (c.folderId === folderId) {
      comps.push(c);
    }
  }

  // Recurse into sub-folders
  for (const f of state.folders) {
    if (f.parentId === folderId && !folderIds.has(f.id)) {
      folders.push(f);
      folderIds.add(f.id);
      _collectFolderContents(f.id, builds, folders, comps, buildIds, folderIds);
    }
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────────

/**
 * Handle the full .axicode file import flow.
 * Opens file picker, parses, detects conflicts, shows dialog if needed, applies.
 * @param {string|null} targetFolderId - folder to import into (null = root)
 * @param {function} renderLibrary - callback to re-render the library
 * @param {function} showToast - callback to show toast notification
 */
export async function handleAxicodeImport(targetFolderId, renderLibrary, showToast) {
  const result = await window.desktopApi.importAxicodeFile();
  if (result.cancelled) return;
  if (result.error) {
    showToast(result.error, "error");
    return;
  }

  const { data } = result;
  const { builds: importBuilds, folders: importFolders, comps: importComps } = data;
  const totalCount = importBuilds.length + importFolders.length + importComps.length;

  if (totalCount === 0) {
    showToast("The .axicode file is empty.", "error");
    return;
  }

  // Detect conflicts (matching by ID)
  const conflicts = [];
  for (const b of importBuilds) {
    const existing = state.builds.find((x) => x.id === b.id);
    if (existing) conflicts.push({ type: "build", imported: b, existing });
  }
  for (const f of importFolders) {
    const existing = state.folders.find((x) => x.id === f.id);
    if (existing) conflicts.push({ type: "folder", imported: f, existing });
  }
  for (const c of importComps) {
    const existing = (state.comps || []).find((x) => x.id === c.id);
    if (existing) conflicts.push({ type: "comp", imported: c, existing });
  }

  // If conflicts, show resolution dialog
  let resolutions = null;
  if (conflicts.length > 0) {
    resolutions = await showImportConflictModal({ conflicts, totalCount });
    if (resolutions === null) return; // cancelled
  }

  // Apply import
  const undoActions = [];
  const existingBuildTitles = state.builds.map((b) => b.title || "");
  const existingFolderNames = state.folders.map((f) => f.name || "");
  const existingCompNames = (state.comps || []).map((c) => c.name || "");
  let importedCount = 0;

  // Import folders first (builds/comps reference them)
  for (const folder of importFolders) {
    const action = resolutions?.get(folder.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = state.folders.find((f) => f.id === folder.id);
      if (old) undoActions.push({ type: "folder", action: "replace", old });
      await window.desktopApi.saveFolder(folder);
    } else if (action === "copy") {
      const copy = { ...folder, id: crypto.randomUUID(), name: nextCopyTitle(folder.name, existingFolderNames) };
      if (targetFolderId && !folder.parentId) copy.parentId = targetFolderId;
      existingFolderNames.push(copy.name);
      await window.desktopApi.saveFolder(copy);
      undoActions.push({ type: "folder", action: "create", id: copy.id });
    } else {
      // No conflict — import directly
      const toSave = { ...folder };
      if (targetFolderId && !folder.parentId) toSave.parentId = targetFolderId;
      await window.desktopApi.saveFolder(toSave);
      undoActions.push({ type: "folder", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Import builds
  for (const build of importBuilds) {
    const action = resolutions?.get(build.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = state.builds.find((b) => b.id === build.id);
      if (old) undoActions.push({ type: "build", action: "replace", old: { ...old } });
      await window.desktopApi.saveBuild(build);
    } else if (action === "copy") {
      const copy = { ...build, id: crypto.randomUUID(), title: nextCopyTitle(build.title, existingBuildTitles) };
      if (targetFolderId && !build.folderId && !build.compId) copy.folderId = targetFolderId;
      existingBuildTitles.push(copy.title);
      await window.desktopApi.saveBuild(copy);
      undoActions.push({ type: "build", action: "create", id: copy.id });
    } else {
      // No conflict
      const toSave = { ...build };
      if (targetFolderId && !build.folderId && !build.compId) toSave.folderId = targetFolderId;
      await window.desktopApi.saveBuild(toSave);
      undoActions.push({ type: "build", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Import comps
  for (const comp of importComps) {
    const action = resolutions?.get(comp.id);
    if (action === "skip") continue;

    if (action === "replace") {
      const old = (state.comps || []).find((c) => c.id === comp.id);
      if (old) undoActions.push({ type: "comp", action: "replace", old: { ...old } });
      await window.desktopApi.saveComp(comp);
    } else if (action === "copy") {
      const copy = { ...comp, id: crypto.randomUUID(), name: nextCopyTitle(comp.name, existingCompNames) };
      if (targetFolderId && !comp.folderId) copy.folderId = targetFolderId;
      await window.desktopApi.saveComp(copy);
      undoActions.push({ type: "comp", action: "create", id: copy.id });
    } else {
      // No conflict
      const toSave = { ...comp };
      if (targetFolderId && !comp.folderId) toSave.folderId = targetFolderId;
      await window.desktopApi.saveComp(toSave);
      undoActions.push({ type: "comp", action: "create", id: toSave.id });
    }
    importedCount++;
  }

  // Push undo action
  pushUndo({
    type: "import-axicode",
    async undo() {
      for (const a of undoActions.reverse()) {
        if (a.action === "create") {
          if (a.type === "build") await window.desktopApi.deleteBuild(a.id);
          else if (a.type === "folder") await window.desktopApi.deleteFolder(a.id);
          else if (a.type === "comp") await window.desktopApi.deleteComp(a.id);
        } else if (a.action === "replace") {
          if (a.type === "build") await window.desktopApi.saveBuild(a.old);
          else if (a.type === "folder") await window.desktopApi.saveFolder(a.old);
          else if (a.type === "comp") await window.desktopApi.saveComp(a.old);
        }
      }
      state.builds = await window.desktopApi.listBuilds();
      state.folders = await window.desktopApi.listFolders();
      state.comps = await window.desktopApi.listComps();
      renderLibrary();
    },
  });

  // Reload state and render
  state.builds = await window.desktopApi.listBuilds();
  state.folders = await window.desktopApi.listFolders();
  state.comps = await window.desktopApi.listComps();
  renderLibrary();
  showToast(`Imported ${importedCount} item${importedCount !== 1 ? "s" : ""}`);
}

/**
 * Handle the .axicode file export flow.
 * @param {"selection"|"visible"} mode
 * @param {string|null} folderId - if exporting a specific folder
 * @param {function} showToast - callback to show toast notification
 */
export async function handleAxicodeExport(mode, folderId, showToast) {
  let data;
  if (folderId) {
    data = collectFolderExportData(folderId);
  } else {
    data = collectExportData(mode);
  }

  if (data.builds.length === 0 && data.folders.length === 0 && data.comps.length === 0) {
    showToast("Nothing to export.", "error");
    return;
  }

  const result = await window.desktopApi.exportAxicodeFile(data.builds, data.folders, data.comps);
  if (result.cancelled) return;
  if (result.success) {
    const total = data.builds.length + data.folders.length + data.comps.length;
    showToast(`Exported ${total} item${total !== 1 ? "s" : ""}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/renderer/modules/library/axicode-io.js
git commit -m "feat: add .axicode export collection and import orchestration"
```

---

## Task 5: Context Menu Integration

**Files:**
- Modify: `axiforge/src/renderer/modules/library/context-menu.js`

- [ ] **Step 1: Add `arrowUpTrayIcon` to imports**

In `context-menu.js`, add `arrowUpTrayIcon` to the heroicons import (line 8-31). Find the import block and add it:

```javascript
import {
  playIcon,
  pencilIcon,
  documentDuplicateIcon,
  starIcon,
  folderArrowDownIcon,
  tagIcon,
  clipboardDocumentIcon,
  globeAltIcon,
  informationCircleIcon,
  trashIcon,
  folderOpenIcon,
  folderPlusIcon,
  documentPlusIcon,
  plusIcon,
  clipboardIcon,
  homeIcon,
  folderIcon,
  linkIcon,
  arrowDownTrayIcon,
  arrowUpTrayIcon,
  scissorsIcon,
  axiforgeIcon,
  compPlusIcon,
} from "./heroicons.js";
```

- [ ] **Step 2: Add export to single build menu**

In `showBuildMenu()` (around line 127, after the "Copy AxiCode" item), add:

```javascript
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
```

- [ ] **Step 3: Add export to multi-select build menu**

In `showMultiSelectMenu()` (around line 146, after the Cut item), add:

```javascript
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
```

- [ ] **Step 4: Add export to single comp menu**

In `showCompMenu()` (around line 163, after the Cut item), add:

```javascript
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
```

- [ ] **Step 5: Add export to multi-comp menu**

In `showMultiCompSelectMenu()` (around line 179, after the Cut item), add:

```javascript
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("selection")),
```

- [ ] **Step 6: Add export to folder menu and .axicode to folder import submenu**

In `showFolderMenu()` (around line 192-201), add export item after the Import submenu and add `.axicode File` to the import submenu:

Change the import submenu to include `.axicode File`:

```javascript
    _submenuItem(arrowDownTrayIcon, "Import in Folder", [
      _item(linkIcon, "Build Link", null, () => _callbacks.onImportChatLink?.(folderId)),
      _item(arrowDownTrayIcon, "GW2Skills", null, () => _callbacks.onImportGw2Skills?.(folderId)),
      _item(axiforgeIcon, "AxiCode", null, () => _callbacks.onImportShareCode?.(folderId)),
      _sep(),
      _item(arrowDownTrayIcon, ".axicode File", null, () => _callbacks.onImportAxicodeFile?.(folderId)),
    ]),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicodeFolder?.(folderId)),
```

- [ ] **Step 7: Add export and .axicode import to empty area menu**

In `showEmptyMenu()` (around line 205-224), add export item and `.axicode File` to the import submenu:

Change the Import submenu:

```javascript
    _submenuItem(arrowDownTrayIcon, "Import", [
      _item(linkIcon, "Build Link", null, () => _callbacks.onImportChatLink?.()),
      _item(arrowDownTrayIcon, "GW2Skills", null, () => _callbacks.onImportGw2Skills?.()),
      _item(axiforgeIcon, "AxiCode", null, () => _callbacks.onImportShareCode?.()),
      _sep(),
      _item(arrowDownTrayIcon, ".axicode File", null, () => _callbacks.onImportAxicodeFile?.()),
    ]),
    _item(arrowUpTrayIcon, "Export (.axicode)", null, () => _callbacks.onExportAxicode?.("visible")),
```

- [ ] **Step 8: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/renderer/modules/library/context-menu.js
git commit -m "feat: add .axicode export/import items to context menus"
```

---

## Task 6: Toolbar Integration

**Files:**
- Modify: `axiforge/src/renderer/modules/library/toolbar.js`

- [ ] **Step 1: Add `arrowUpTrayIcon` to heroicons import**

In `toolbar.js` line 19, add `arrowUpTrayIcon` to the import:

```javascript
  arrowUpTrayIcon,
```

- [ ] **Step 2: Add .axicode File to Import dropdown**

In `renderToolbar()`, after the AxiCode import item (line 87-89), add:

```html
          <div class="lib-import-dropdown__sep"></div>
          <button type="button" class="lib-import-dropdown__item" data-import-type="axicode-file">
            ${arrowDownTrayIcon} .axicode File
          </button>
```

- [ ] **Step 3: Add Export dropdown between Import and New**

After the Import dropdown closing `</div>` (line 91) and before the New dropdown (line 92), add:

```html
      <div class="lib-import-dropdown" id="lib-export-dropdown">
        <button type="button" id="lib-export-btn" class="btn lib-toolbar__new-btn lib-import-dropdown__trigger">
          ${arrowUpTrayIcon} Export
        </button>
        <div class="lib-import-dropdown__menu" id="lib-export-menu">
          <button type="button" class="lib-import-dropdown__item" data-export-type="all">
            ${arrowUpTrayIcon} Export All (.axicode)
          </button>
        </div>
      </div>
```

- [ ] **Step 4: Wire toolbar events for new buttons**

In `bindToolbarEvents()`, add handlers for the new export dropdown and the `.axicode File` import item. Find where `data-import-type` click handlers are bound and add:

In the existing import menu click handler (around line 407-413), add a new `else if` case after the `sharecode` handler:

```javascript
      else if (item.dataset.importType === "axicode-file") _callbacks.onImportAxicodeFile?.();
```

For the export dropdown, add a click handler following the existing import dropdown pattern (around line 415, after the import dropdown block):

```javascript
  // Export dropdown
  const exportDropdown = container.querySelector("#lib-export-dropdown");
  const exportMenu = container.querySelector("#lib-export-menu");
  container.querySelector("#lib-export-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = exportDropdown.classList.toggle("lib-import-dropdown--open");
    if (isOpen) {
      const closeHandler = (evt) => {
        if (!exportDropdown.contains(evt.target)) {
          exportDropdown.classList.remove("lib-import-dropdown--open");
          document.removeEventListener("click", closeHandler);
        }
      };
      setTimeout(() => document.addEventListener("click", closeHandler), 0);
    }
  });
  exportMenu?.querySelectorAll("[data-export-type]").forEach((item) => {
    item.addEventListener("click", () => {
      exportDropdown.classList.remove("lib-import-dropdown--open");
      _callbacks.onExportAxicode?.("visible");
    });
  });
```

- [ ] **Step 5: Add CSS for dropdown separator**

In `axiforge/src/renderer/styles/library.css`, find the `.lib-import-dropdown` styles and add a separator rule:

```css
.lib-import-dropdown__sep {
  height: 1px;
  background: var(--border-primary, #333);
  margin: 4px 0;
}
```

- [ ] **Step 6: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/renderer/modules/library/toolbar.js src/renderer/styles/library.css
git commit -m "feat: add Export dropdown and .axicode import to toolbar"
```

---

## Task 7: Wire Callbacks in Library Orchestrator

**Files:**
- Modify: `axiforge/src/renderer/modules/library/library.js`

- [ ] **Step 1: Import axicode-io module**

In `library.js`, add import after the existing imports (around line 28, after `import { pushUndo, popUndo } from "./undo.js";`):

```javascript
import { handleAxicodeExport, handleAxicodeImport } from "./axicode-io.js";
```

- [ ] **Step 2: Add handler functions**

Add these handler functions near the other import/export handlers (around line 522, after `handleImportShareCode`):

```javascript
async function handleExportAxicode(mode) {
  await handleAxicodeExport(mode, null, showToast);
}

async function handleExportAxicodeFolder(folderId) {
  await handleAxicodeExport(null, folderId, showToast);
}

async function handleImportAxicodeFile(targetFolderId) {
  const folderId = targetFolderId ?? (state.currentFolder?.type === "custom" ? state.currentFolder.id : null);
  await handleAxicodeImport(folderId, renderLibrary, showToast);
}
```

- [ ] **Step 3: Add callbacks to `_buildSharedCallbacks`**

In `_buildSharedCallbacks()` (around line 1190, after `onImportShareCode: handleImportShareCode,`), add:

```javascript
    onExportAxicode: handleExportAxicode,
    onExportAxicodeFolder: handleExportAxicodeFolder,
    onImportAxicodeFile: handleImportAxicodeFile,
```

- [ ] **Step 4: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/axiforge
git add src/renderer/modules/library/library.js
git commit -m "feat: wire .axicode export/import callbacks in library orchestrator"
```

---

## Task 8: Integration Testing

**Files:** No new files — manual testing in the running app.

- [ ] **Step 1: Run the axicode package tests**

Run: `cd /var/home/mstephens/Documents/GitHub/axicode && npx jest --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Start the app in dev mode**

Run: `cd /var/home/mstephens/Documents/GitHub/axiforge && npm run dev`

- [ ] **Step 3: Test export from toolbar**

1. Create a few builds in the library
2. Click "Export" → "Export All (.axicode)"
3. Verify save dialog opens with `.axicode` filter
4. Save the file
5. Verify toast shows "Exported N items"

- [ ] **Step 4: Test import with no conflicts**

1. Delete the builds you just exported
2. Click "Import" → ".axicode File"
3. Select the file you exported
4. Verify builds are restored
5. Verify toast shows "Imported N items"

- [ ] **Step 5: Test import with conflicts**

1. With builds still in library, import the same `.axicode` file again
2. Verify conflict dialog appears
3. Test "Import as Copy" — verify builds appear with `(1)` suffix
4. Test "Replace All" — verify builds are overwritten
5. Test "Skip All" — verify nothing is imported
6. Test "Cancel" — verify import is aborted

- [ ] **Step 6: Test right-click export on selection**

1. Select multiple builds (Ctrl+click)
2. Right-click → "Export (.axicode)"
3. Verify only selected builds are in the exported file

- [ ] **Step 7: Test right-click export on comp**

1. Create a comp with builds
2. Right-click comp → "Export (.axicode)"
3. Verify comp and its builds are in the file

- [ ] **Step 8: Test right-click export on folder**

1. Create a folder with builds
2. Right-click folder → "Export (.axicode)"
3. Verify folder and its contents are in the file

- [ ] **Step 9: Test undo**

1. Import a `.axicode` file
2. Press Ctrl+Z
3. Verify all imported items are removed

- [ ] **Step 10: Test empty area right-click**

1. Right-click empty area → "Export (.axicode)"
2. Verify everything visible is exported
3. Right-click empty area → Import → ".axicode File"
4. Verify import works

- [ ] **Step 11: Test error cases**

1. Try importing a non-.axicode file (rename a text file)
2. Verify error message appears
3. Try exporting with nothing in library
4. Verify "Nothing to export" toast
